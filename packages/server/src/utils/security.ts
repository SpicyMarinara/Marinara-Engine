import { promises as dns } from "node:dns";
import { createHash, timingSafeEqual } from "node:crypto";
import { basename, extname, relative, resolve, sep } from "node:path";
import { isLoopbackIp, isPrivateNetworkIp } from "../middleware/ip-allowlist.js";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@marinara-engine/shared";

export { CSRF_HEADER, CSRF_HEADER_VALUE };

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const LOCALHOST_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);
const RESERVED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];
const RESERVED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];
const RESERVED_IPV6_CIDRS = ["::/128", "::1/128", "::ffff:0:0/96", "64:ff9b::/96", "100::/64", "2001:db8::/32"];

type CidrEntry = { bytes: number[]; prefixLen: number };

export interface OutboundUrlPolicy {
  allowLocal?: boolean;
  allowedProtocols?: string[];
  maxRedirects?: number;
}

export interface SafeFetchOptions extends Omit<RequestInit, "dispatcher"> {
  policy?: OutboundUrlPolicy;
  maxResponseBytes?: number;
  allowedContentTypes?: string[];
  dispatcher?: unknown;
}

export function parseBoolean(value: unknown): boolean {
  return typeof value === "string" ? /^(1|true|yes|on)$/i.test(value.trim()) : value === true;
}

export function assertInsideDir(rootDir: string, candidatePath: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))) {
    return candidate;
  }
  throw new Error("Path escapes the allowed directory");
}

export function safeBasename(value: string, fallback = "file"): string {
  const name = basename(value).replace(/[\u0000-\u001f<>:"|?*]/g, "").trim();
  return name || fallback;
}

export function isAllowedImageBuffer(buffer: Buffer, expectedExt?: string): { ext: string; mimeType: string } | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", mimeType: "image/webp" };
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return { ext: "gif", mimeType: "image/gif" };
  }
  if (expectedExt?.toLowerCase() === ".avif" && buffer.length >= 12 && buffer.subarray(4, 12).toString("ascii").includes("ftyp")) {
    return { ext: "avif", mimeType: "image/avif" };
  }
  return null;
}

export function extensionFromImageMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/avif") return "avif";
  return "png";
}

export function tokenForPath(pathValue: string): string {
  return createHash("sha256").update(resolve(pathValue)).digest("base64url").slice(0, 32);
}

export function safeCompareString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const nums = parts.map(Number);
  if (!nums.every((num) => num >= 0 && num <= 255)) return null;
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...nums];
}

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
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function ipToBytes(ip: string): number[] | null {
  const withoutZone = ip.split("%")[0] ?? ip;
  if (withoutZone.toLowerCase().startsWith("::ffff:") && withoutZone.includes(".")) {
    return ipv4ToBytes(withoutZone.slice(7));
  }
  return ipv4ToBytes(withoutZone) ?? expandIPv6(withoutZone);
}

function parseCidr(entry: string): CidrEntry | null {
  const [ip, rawPrefix] = entry.split("/");
  const bytes = ipToBytes(ip ?? "");
  if (!bytes) return null;
  let prefixLen = rawPrefix === undefined ? 128 : Number.parseInt(rawPrefix, 10);
  if (!Number.isFinite(prefixLen) || prefixLen < 0 || prefixLen > 128) return null;
  if (ip?.includes(".") && !ip.includes(":") && prefixLen <= 32) prefixLen += 96;
  return { bytes, prefixLen };
}

function matchesCidr(ipBytes: number[], cidr: CidrEntry): boolean {
  const fullBytes = Math.floor(cidr.prefixLen / 8);
  const remainingBits = cidr.prefixLen % 8;
  for (let i = 0; i < fullBytes; i += 1) {
    if (ipBytes[i] !== cidr.bytes[i]) return false;
  }
  if (remainingBits > 0 && fullBytes < ipBytes.length) {
    const mask = 0xff << (8 - remainingBits);
    return (ipBytes[fullBytes]! & mask) === (cidr.bytes[fullBytes]! & mask);
  }
  return true;
}

const RESERVED_CIDRS = [...RESERVED_IPV4_CIDRS, ...RESERVED_IPV6_CIDRS]
  .map(parseCidr)
  .filter((entry): entry is CidrEntry => Boolean(entry));

function isReservedIp(ip: string): boolean {
  if (isLoopbackIp(ip) || isPrivateNetworkIp(ip)) return true;
  const bytes = ipToBytes(ip);
  if (!bytes) return true;
  return RESERVED_CIDRS.some((cidr) => matchesCidr(bytes, cidr));
}

function isIpLiteral(hostname: string): boolean {
  return Boolean(ipToBytes(hostname));
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.replace(/\.$/, "").toLowerCase();
  return LOCALHOST_NAMES.has(lower) || RESERVED_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

async function resolveHostname(hostname: string): Promise<string[]> {
  if (isIpLiteral(hostname)) return [hostname];
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function validateOutboundUrl(url: string | URL, policy: OutboundUrlPolicy = {}): Promise<URL> {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const allowedProtocols = policy.allowedProtocols ?? ["https:"];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Outbound URL protocol is not allowed: ${parsed.protocol}`);
  }

  if (!policy.allowLocal) {
    if (isLocalHostname(parsed.hostname)) {
      throw new Error("Outbound URL hostname is local or reserved");
    }

    const addresses = await resolveHostname(parsed.hostname);
    if (addresses.length === 0 || addresses.some(isReservedIp)) {
      throw new Error("Outbound URL resolved to a private, loopback, metadata, or reserved address");
    }
  }

  return parsed;
}

async function readCappedResponse(response: Response, maxBytes: number): Promise<Response> {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Outbound response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeFetch(url: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const { policy, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES, allowedContentTypes, ...init } = options;
  let current = await validateOutboundUrl(url, policy);
  const redirects = policy?.maxRedirects ?? MAX_REDIRECTS;

  for (let i = 0; i <= redirects; i += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" } as unknown as RequestInit);
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      if (i === redirects) throw new Error("Outbound request exceeded redirect limit");
      current = await validateOutboundUrl(new URL(response.headers.get("location")!, current), policy);
      continue;
    }

    if (allowedContentTypes?.length) {
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !allowedContentTypes.some((allowed) => contentType.includes(allowed.toLowerCase()))) {
        throw new Error(`Outbound response content type is not allowed: ${contentType}`);
      }
    }

    return readCappedResponse(response, maxResponseBytes);
  }

  throw new Error("Outbound request exceeded redirect limit");
}

export function sanitizePathFilename(filename: string, allowedExts?: Set<string>): string {
  const safe = safeBasename(filename);
  const ext = extname(safe).toLowerCase();
  if (allowedExts && !allowedExts.has(ext)) throw new Error(`Unsupported file type: ${ext}`);
  return safe;
}
