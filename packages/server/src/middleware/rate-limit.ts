import type { FastifyReply, FastifyRequest } from "fastify";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  limit: number;
  windowMs: number;
  key: string;
};

const DEFAULT_RULE: RateLimitRule = { key: "default", limit: 600, windowMs: 60_000 };

const ROUTE_RULES: Array<{ pattern: RegExp; rule: RateLimitRule }> = [
  { pattern: /^\/api\/generate(?:\/|$)/, rule: { key: "generate", limit: 60, windowMs: 60_000 } },
  { pattern: /^\/api\/tts(?:\/|$)/, rule: { key: "tts", limit: 90, windowMs: 60_000 } },
  { pattern: /^\/api\/connections\/[^/]+\/test-image(?:\?|$)/, rule: { key: "image-test", limit: 20, windowMs: 60_000 } },
  { pattern: /^\/api\/import\/st-bulk(?:\/|$)/, rule: { key: "bulk-import", limit: 20, windowMs: 60_000 } },
  { pattern: /^\/api\/backup(?:\/|$)/, rule: { key: "backup", limit: 30, windowMs: 60_000 } },
  { pattern: /^\/api\/updates\/apply(?:\?|$)/, rule: { key: "updates-apply", limit: 5, windowMs: 60_000 } },
  {
    pattern: /^\/api\/sidecar\/(?:runtime\/install|reinstall|download|model)(?:\/|\?|$)/,
    rule: { key: "sidecar-privileged", limit: 20, windowMs: 60_000 },
  },
  { pattern: /^\/api\/haptic\/command(?:\?|$)/, rule: { key: "haptic-command", limit: 30, windowMs: 60_000 } },
];

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function selectRule(url: string): RateLimitRule {
  const path = url.split("?")[0] ?? url;
  return ROUTE_RULES.find((entry) => entry.pattern.test(path))?.rule ?? DEFAULT_RULE;
}

function sweepExpired(now: number) {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimitHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!request.url.startsWith("/api/")) return done();

  const now = Date.now();
  sweepExpired(now);

  const rule = selectRule(request.url);
  const key = `${rule.key}:${request.ip}`;
  const bucket = buckets.get(key);
  const activeBucket = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + rule.windowMs };
  activeBucket.count += 1;
  buckets.set(key, activeBucket);

  const remaining = Math.max(0, rule.limit - activeBucket.count);
  reply.header("RateLimit-Limit", String(rule.limit));
  reply.header("RateLimit-Remaining", String(remaining));
  reply.header("RateLimit-Reset", String(Math.ceil(activeBucket.resetAt / 1000)));

  if (activeBucket.count > rule.limit) {
    reply.header("Retry-After", String(Math.ceil((activeBucket.resetAt - now) / 1000)));
    reply.status(429).send({ error: "Too many requests" });
    return;
  }

  done();
}

export function resetRateLimitBucketsForTests() {
  buckets.clear();
  lastSweepAt = 0;
}
