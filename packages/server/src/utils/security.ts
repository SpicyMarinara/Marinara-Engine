import { promises as dns } from "node:dns";
import { createHash, timingSafeEqual } from "node:crypto";
import { basename, extname, relative, resolve, sep, win32 } from "node:path";
import { Agent } from "undici";
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
const RESERVED_IPV6_CIDRS = ["::/128", "::1/128", "64:ff9b::/96", "100::/64", "2001:db8::/32"];

type CidrEntry = { bytes: number[]; prefixLen: number };
type AgentOptions = ConstructorParameters<typeof Agent>[0];

export interface OutboundUrlPolicy {
  allowLocal?: boolean;
  allowLoopback?: boolean;
  allowMdns?: boolean;
  allowedProtocols?: string[];
  maxRedirects?: number;
  /**
   * Optional name of the env var that, when set to true, would allow this
   * fetch. Surfaced verbatim in the rejection error so the user knows which
   * flag to flip (e.g. PROVIDER_LOCAL_URLS_ENABLED, IMAGE_LOCAL_URLS_ENABLED).
   */
  flagName?: string;
}

export interface SafeFetchOptions extends Omit<RequestInit, "dispatcher"> {
  policy?: OutboundUrlPolicy;
  maxResponseBytes?: number;
  allowedContentTypes?: string[];
  bufferResponse?: boolean;
  agentOptions?: Omit<AgentOptions, "connect">;
  dispatcher?: unknown;
}

export function parseBoolean(value: unknown): boolean {
  return typeof value === "string" ? /^(1|true|yes|on)$/i.test(value.trim()) : value === true;
}

export function assertInsideDir(rootDir: string, candidatePath: string): string {
  const pathApi = /^[A-Za-z]:[\\/]|^\\\\/.test(rootDir) || /^[A-Za-z]:[\\/]|^\\\\/.test(candidatePath) ? win32 : null;
  const root = pathApi ? pathApi.resolve(rootDir) : resolve(rootDir);
  const candidate = pathApi ? pathApi.resolve(candidatePath) : resolve(candidatePath);
  const relativePath = pathApi ? pathApi.relative(root, candidate) : relative(root, candidate);
  const separator = pathApi ? pathApi.sep : sep;
  const isAbsoluteRelativePath = pathApi ? pathApi.isAbsolute(relativePath) : false;
  if (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${separator}`) && !isAbsoluteRelativePath)
  ) {
    return candidate;
  }
  throw new Error("Path escapes the allowed directory");
}

export function safeBasename(value: string, fallback = "file"): string {
  const name = basename(value)
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .trim();
  return name || fallback;
}

export function isAllowedImageBuffer(buffer: Buffer, expectedExt?: string): { ext: string; mimeType: string } | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mimeType: "image/jpeg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", mimeType: "image/webp" };
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return { ext: "gif", mimeType: "image/gif" };
  }
  if (
    expectedExt?.toLowerCase() === ".avif" &&
    buffer.length >= 16 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    const boxSize = buffer.readUInt32BE(0);
    const brandEnd = Math.min(buffer.length, boxSize > 0 ? boxSize : buffer.length);
    const acceptedBrands = new Set(["avif", "avis"]);
    if (acceptedBrands.has(buffer.subarray(8, 12).toString("ascii"))) {
      return { ext: "avif", mimeType: "image/avif" };
    }
    for (let offset = 16; offset + 4 <= brandEnd; offset += 4) {
      if (acceptedBrands.has(buffer.subarray(offset, offset + 4).toString("ascii"))) {
        return { ext: "avif", mimeType: "image/avif" };
      }
    }
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

function normalizeHostnameForAddress(hostname: string): string {
  const trimmed = hostname.trim();
  const bracketMatch = trimmed.match(/^\[(.*)]$/);
  return bracketMatch?.[1] ?? trimmed;
}

function isIpLiteral(hostname: string): boolean {
  return Boolean(ipToBytes(normalizeHostnameForAddress(hostname)));
}

function isLocalHostname(hostname: string): boolean {
  const lower = normalizeHostnameForAddress(hostname).replace(/\.$/, "").toLowerCase();
  return LOCALHOST_NAMES.has(lower) || RESERVED_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostnameForAddress(hostname).replace(/\.$/, "").toLowerCase();
  return LOCALHOST_NAMES.has(normalized) || isLoopbackIp(normalized);
}

function isMdnsHostname(hostname: string): boolean {
  return normalizeHostnameForAddress(hostname).replace(/\.$/, "").toLowerCase().endsWith(".local");
}

export function normalizeLoopbackUrl(url: string | URL): string {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const normalized = normalizeHostnameForAddress(parsed.hostname).replace(/\.$/, "").toLowerCase();
  if (LOCALHOST_NAMES.has(normalized)) {
    parsed.hostname = "127.0.0.1";
  }
  return parsed.toString();
}

async function resolveHostname(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalized = normalizeHostnameForAddress(hostname);
  if (isIpLiteral(normalized)) {
    return [{ address: normalized, family: normalized.includes(":") ? 6 : 4 }];
  }
  const records = await dns.lookup(normalized, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6 ? [{ address: record.address, family: record.family }] : [],
  );
}

function isBlockedResolvedAddress(address: string, policy: OutboundUrlPolicy): boolean {
  if (!isReservedIp(address)) return false;
  return !(policy.allowLoopback && isLoopbackIp(address));
}

function preferIpv4Records(records: Array<{ address: string; family: 4 | 6 }>): Array<{ address: string; family: 4 | 6 }> {
  return [...records].sort((a, b) => a.family - b.family);
}

function flagHint(policy: OutboundUrlPolicy): string {
  if (!policy.flagName) return "";
  return ` Set ${policy.flagName}=true in your .env file to allow this (changes take effect within ~2s without a restart).`;
}

function describeBlockedAddresses(addresses: Array<{ address: string }>, policy: OutboundUrlPolicy): string {
  const blocked = addresses.filter((record) => isBlockedResolvedAddress(record.address, policy)).map((record) => record.address);
  if (blocked.length === 0) return "";
  return ` (resolved to ${blocked.join(", ")})`;
}

async function validateResolvedAddresses(
  hostname: string,
  policy: OutboundUrlPolicy,
  originalUrl?: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const addresses = await resolveHostname(hostname);
  if (policy.allowMdns && isMdnsHostname(hostname)) {
    const preferred = preferIpv4Records(addresses);
    if (preferred.length === 0) {
      const target = originalUrl ?? hostname;
      throw new Error(`Refused to fetch ${target}: hostname '${hostname}' did not resolve to any address.`);
    }
    return preferred;
  }

  if (!policy.allowLocal && addresses.length === 0) {
    // DNS failure (NXDOMAIN, SRV mismatch, etc.). Setting the local-URLs flag
    // wouldn't help here, so don't tell the operator to flip it.
    const target = originalUrl ?? hostname;
    throw new Error(`Refused to fetch ${target}: hostname '${hostname}' did not resolve to any address.`);
  }
  if (
    !policy.allowLocal &&
    addresses.some((record) => isBlockedResolvedAddress(record.address, policy))
  ) {
    // Genuine policy.allowLocal-driven rejection — naming the flag is useful.
    const target = originalUrl ?? hostname;
    throw new Error(
      `Refused to fetch ${target}: '${hostname}'${describeBlockedAddresses(addresses, policy)} is in a private, loopback, metadata, or reserved IP range.${flagHint(policy)}`,
    );
  }
  return addresses;
}

export async function validateOutboundUrl(url: string | URL, policy: OutboundUrlPolicy = {}): Promise<URL> {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const original = typeof url === "string" ? url : parsed.toString();
  const allowedProtocols = policy.allowedProtocols ?? ["https:"];
  if (!allowedProtocols.includes(parsed.protocol)) {
    // Protocol gate is independent of policy.allowLocal — flipping
    // PROVIDER_LOCAL_URLS_ENABLED won't allow gopher://, ftp://, etc.
    // Don't append the flag hint to this rejection.
    throw new Error(
      `Refused to fetch ${original}: protocol '${parsed.protocol.replace(/:$/, "")}' is not allowed (allowed: ${allowedProtocols.map((proto) => proto.replace(/:$/, "")).join(", ")}).`,
    );
  }

  if (!policy.allowLocal) {
    if (
      isLocalHostname(parsed.hostname) &&
      !(policy.allowLoopback && isLoopbackHostname(parsed.hostname)) &&
      !(policy.allowMdns && isMdnsHostname(parsed.hostname))
    ) {
      // Genuine policy.allowLocal-driven rejection — naming the flag is useful.
      throw new Error(
        `Refused to fetch ${original}: hostname '${parsed.hostname}' is local or reserved.${flagHint(policy)}`,
      );
    }

    await validateResolvedAddresses(parsed.hostname, policy, original);
  }

  return parsed;
}

async function validateOutboundUrlForFetch(
  url: string | URL,
  policy: OutboundUrlPolicy = {},
  agentOptions?: Omit<AgentOptions, "connect">,
): Promise<{ url: URL; dispatcher?: Agent }> {
  const parsed = await validateOutboundUrl(url, policy);
  if (policy.allowLocal) return { url: parsed, dispatcher: agentOptions ? new Agent(agentOptions) : undefined };

  const original = typeof url === "string" ? url : parsed.toString();
  const addresses = await validateResolvedAddresses(parsed.hostname, policy, original);
  let used = false;
  const dispatcher = new Agent({
    ...(agentOptions ?? {}),
    connect: {
      lookup(_hostname, options, callback) {
        if (used) {
          callback(new Error("Outbound URL resolver was reused unexpectedly"), "", 4);
          return;
        }
        used = true;
        const family = options.family === 4 || options.family === 6 ? options.family : undefined;
        const selected = addresses.find((record) => !family || record.family === family) ?? addresses[0]!;
        if (options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    },
  });
  return { url: parsed, dispatcher };
}

async function readCappedResponse(response: Response, maxBytes: number, dispatcher?: Agent): Promise<Response> {
  if (!response.body) {
    await dispatcher?.close().catch(() => undefined);
    return response;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
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
  } finally {
    await dispatcher?.close().catch(() => undefined);
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function capStreamingResponse(response: Response, maxBytes: number, dispatcher?: Agent): Response {
  if (!response.body) {
    void dispatcher?.close().catch(() => undefined);
    return response;
  }
  let total = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            await dispatcher?.close().catch(() => undefined);
            return;
          }

          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            await dispatcher?.close().catch(() => undefined);
            controller.error(new Error(`Outbound response exceeded ${maxBytes} bytes`));
            return;
          }

          controller.enqueue(value);
        }
      } catch (err) {
        await dispatcher?.close().catch(() => undefined);
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeFetch(url: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    policy,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    allowedContentTypes,
    bufferResponse = true,
    agentOptions,
    dispatcher,
    ...init
  } = options;
  if (dispatcher && !policy?.allowLocal) {
    throw new Error("Custom fetch dispatchers are only allowed for explicit local-provider requests");
  }

  let current = await validateOutboundUrlForFetch(url, policy, dispatcher ? undefined : agentOptions);
  const redirects = policy?.maxRedirects ?? MAX_REDIRECTS;

  for (let i = 0; i <= redirects; i += 1) {
    const internalDispatcher = dispatcher ? undefined : current.dispatcher;
    const response = await fetch(current.url, {
      ...init,
      redirect: "manual",
      dispatcher: dispatcher ?? internalDispatcher,
    } as unknown as RequestInit);
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      if (i === redirects) throw new Error("Outbound request exceeded redirect limit");
      await internalDispatcher?.close().catch(() => undefined);
      current = await validateOutboundUrlForFetch(
        new URL(response.headers.get("location")!, current.url),
        policy,
        agentOptions,
      );
      continue;
    }

    if (allowedContentTypes?.length) {
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType || !allowedContentTypes.some((allowed) => contentType.includes(allowed.toLowerCase()))) {
        await internalDispatcher?.close().catch(() => undefined);
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Outbound response content type is not allowed: ${contentType}`);
      }
    }

    return bufferResponse
      ? readCappedResponse(response, maxResponseBytes, internalDispatcher)
      : capStreamingResponse(response, maxResponseBytes, internalDispatcher);
  }

  throw new Error("Outbound request exceeded redirect limit");
}

export function sanitizePathFilename(filename: string, allowedExts?: Set<string>): string {
  const safe = safeBasename(filename);
  const ext = extname(safe).toLowerCase();
  if (allowedExts && !allowedExts.has(ext)) throw new Error(`Unsupported file type: ${ext}`);
  return safe;
}
