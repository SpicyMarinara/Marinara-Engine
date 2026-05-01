// ──────────────────────────────────────────────
// Middleware: IP Allowlist
// ──────────────────────────────────────────────
// Set IP_ALLOWLIST env var to a comma-separated list of allowed IPs or CIDRs.
// Examples:
//   IP_ALLOWLIST=192.168.1.100
//   IP_ALLOWLIST=192.168.1.0/24,10.0.0.5,203.0.113.42
//   IP_ALLOWLIST=::1,192.168.1.0/24
//
// When unset or empty, all IPs are allowed (no restriction).
// Loopback addresses (127.0.0.1, ::1, ::ffff:127.0.0.1) are always allowed
// so you can never lock yourself out of local access.

import type { FastifyRequest, FastifyReply } from "fastify";
import { getIpAllowlist } from "../config/runtime-config.js";
import { logger } from "../lib/logger.js";

// ── CIDR helpers ──

interface CIDREntry {
  /** 4 bytes for IPv4, 16 bytes for IPv6 */
  bytes: number[];
  prefixLen: number;
}

/** Parse a single IP string into a normalised byte array (always 16 bytes — IPv6). */
function ipToBytes(ip: string): number[] | null {
  let addr = ip.trim();

  // Strip IPv6 zone id (e.g. %eth0)
  const zoneIdx = addr.indexOf("%");
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  // Try parsing as IPv4
  const ipv4Parts = addr.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p))) {
    const nums = ipv4Parts.map(Number);
    if (nums.every((n) => n >= 0 && n <= 255)) {
      // Map to IPv6-mapped IPv4: ::ffff:a.b.c.d
      return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...nums];
    }
  }

  // Handle IPv4-mapped IPv6 (::ffff:a.b.c.d)
  if (addr.toLowerCase().startsWith("::ffff:") && addr.includes(".")) {
    const v4Part = addr.slice(7);
    return ipToBytes(v4Part);
  }

  // Parse IPv6
  try {
    // Expand :: shorthand
    const expanded = expandIPv6(addr);
    if (!expanded) return null;
    return expanded;
  } catch {
    return null;
  }
}

/** Expand an IPv6 address string into 16 bytes. */
function expandIPv6(addr: string): number[] | null {
  const parts = addr.split("::");
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 ? (parts[1] ? parts[1].split(":") : []) : [];

  if (parts.length === 1 && left.length !== 8) return null;

  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    const val = parseInt(g, 16);
    if (isNaN(val) || val < 0 || val > 0xffff) return null;
    bytes.push((val >> 8) & 0xff, val & 0xff);
  }
  return bytes;
}

/** Parse "ip" or "ip/prefix" into a CIDREntry. */
function parseCIDR(entry: string): CIDREntry | null {
  const slashIdx = entry.indexOf("/");
  const ip = slashIdx === -1 ? entry : entry.slice(0, slashIdx);
  const bytes = ipToBytes(ip);
  if (!bytes) return null;

  let prefixLen: number;
  if (slashIdx === -1) {
    prefixLen = 128; // single host
  } else {
    prefixLen = parseInt(entry.slice(slashIdx + 1), 10);
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return null;

    // If the original was an IPv4 CIDR (e.g. /24), shift it into the IPv6-mapped range
    const isV4 = ip.includes(".") && !ip.includes(":");
    if (isV4 && prefixLen <= 32) {
      prefixLen += 96; // offset into the ::ffff: prefix
    }
  }

  return { bytes, prefixLen };
}

/** Check if the given IP bytes match the CIDR entry. */
function matchesCIDR(ipBytes: number[], cidr: CIDREntry): boolean {
  const fullBytes = Math.floor(cidr.prefixLen / 8);
  const remainingBits = cidr.prefixLen % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== cidr.bytes[i]) return false;
  }

  if (remainingBits > 0 && fullBytes < ipBytes.length && fullBytes < cidr.bytes.length) {
    const mask = 0xff << (8 - remainingBits);
    if ((ipBytes[fullBytes]! & mask) !== (cidr.bytes[fullBytes]! & mask)) return false;
  }

  return true;
}

// ── Loopback CIDRs (always allowed) ──
const LOOPBACK_CIDRS: CIDREntry[] = [parseCIDR("127.0.0.1")!, parseCIDR("::1")!];

// ── Build allowlist on startup ──

function buildAllowlist(raw: string | null): CIDREntry[] | null {
  if (!raw) return null; // no restriction

  const entries: CIDREntry[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const cidr = parseCIDR(trimmed);
    if (!cidr) {
      logger.warn(`[ip-allowlist] Ignoring invalid entry: "${trimmed}"`);
      continue;
    }
    entries.push(cidr);
  }

  if (entries.length === 0) return null; // all entries were invalid → no restriction
  return entries;
}

let cachedAllowlist: {
  raw: string | null;
  entries: CIDREntry[] | null;
  announced: boolean;
} | null = null;

function getAllowlist() {
  const raw = getIpAllowlist();
  if (!cachedAllowlist || cachedAllowlist.raw !== raw) {
    cachedAllowlist = {
      raw,
      entries: buildAllowlist(raw),
      announced: false,
    };
  }

  if (cachedAllowlist.entries && !cachedAllowlist.announced) {
    logger.info(`[ip-allowlist] Restricting access to: ${cachedAllowlist.raw}  (+ loopback always allowed)`);
    cachedAllowlist.announced = true;
  }

  return cachedAllowlist.entries;
}

// ── Reusable predicates (shared with basic-auth) ──

/** True if the given IP string is a loopback address. */
export function isLoopbackIp(ip: string): boolean {
  const bytes = ipToBytes(ip);
  if (!bytes) return false;
  for (const lb of LOOPBACK_CIDRS) {
    if (matchesCIDR(bytes, lb)) return true;
  }
  return false;
}

/**
 * True if the given IP is configured in the active IP_ALLOWLIST.
 * Returns false when no allowlist is configured (so callers can decide
 * what to do with "no list" vs "list says no").
 */
export function isInIpAllowlist(ip: string): boolean {
  const allowlist = getAllowlist();
  if (!allowlist) return false;
  const bytes = ipToBytes(ip);
  if (!bytes) return false;
  for (const entry of allowlist) {
    if (matchesCIDR(bytes, entry)) return true;
  }
  return false;
}

// ── Fastify onRequest hook ──

export function ipAllowlistHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const allowlist = getAllowlist();

  // No allowlist configured → allow everything
  if (!allowlist) return done();

  const ip = request.ip;
  const bytes = ipToBytes(ip);

  // If we can't parse the IP, deny
  if (!bytes) {
    reply.status(403).send({ error: "Forbidden" });
    return;
  }

  // Loopback is always allowed
  for (const lb of LOOPBACK_CIDRS) {
    if (matchesCIDR(bytes, lb)) return done();
  }

  // Check the allowlist
  for (const entry of allowlist) {
    if (matchesCIDR(bytes, entry)) return done();
  }

  reply.status(403).send({ error: "Forbidden" });
}
