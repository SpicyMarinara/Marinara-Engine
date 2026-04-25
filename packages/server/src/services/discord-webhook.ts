// ──────────────────────────────────────────────
// Discord Webhook Mirror — one-way message relay
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
// Posts messages to a Discord channel webhook with per-character identity.
// Webhook API: https://discord.com/developers/docs/resources/webhook#execute-webhook

const DISCORD_WEBHOOK_REGEX = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Validate that a string looks like a Discord webhook URL. */
export function isValidDiscordWebhook(url: string): boolean {
  return DISCORD_WEBHOOK_REGEX.test(url.trim());
}

interface WebhookPayload {
  content: string;
  username?: string;
  avatar_url?: string;
}

// ── Per-webhook rate-limit queue (Discord allows ~5 req/5s per webhook) ──
const MIN_INTERVAL_MS = 1200; // ~50 req/min — safe headroom
const webhookQueues = new Map<string, { busy: boolean; queue: Array<() => Promise<void>> }>();

function enqueue(webhookUrl: string, task: () => Promise<void>) {
  let entry = webhookQueues.get(webhookUrl);
  if (!entry) {
    entry = { busy: false, queue: [] };
    webhookQueues.set(webhookUrl, entry);
  }
  entry.queue.push(task);
  drain(webhookUrl);
}

async function drain(webhookUrl: string) {
  const entry = webhookQueues.get(webhookUrl);
  if (!entry || entry.busy) return;
  entry.busy = true;
  while (entry.queue.length > 0) {
    const task = entry.queue.shift()!;
    try {
      await task();
    } catch {
      /* logged inside task */
    }
    if (entry.queue.length > 0) await sleep(MIN_INTERVAL_MS);
  }
  entry.busy = false;
  // Clean up empty queue entries to prevent unbounded Map growth
  if (entry.queue.length === 0) {
    webhookQueues.delete(webhookUrl);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Post a message to a Discord webhook.
 * Fire-and-forget — errors are logged but never thrown to callers.
 * Messages are queued per-webhook to respect Discord's rate limits.
 */
export function postToDiscordWebhook(
  webhookUrl: string,
  opts: { content: string; username?: string; avatarUrl?: string },
): void {
  if (!isValidDiscordWebhook(webhookUrl)) return;

  const content = opts.content.trim();
  if (!content) return;

  enqueue(webhookUrl, async () => {
    // Discord caps content at 2000 chars
    const truncated = content.length > 1997 ? content.slice(0, 1997) + "..." : content;

    const body: WebhookPayload = { content: truncated };
    if (opts.username) body.username = opts.username.slice(0, 80);
    if (opts.avatarUrl) body.avatar_url = opts.avatarUrl;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Respect Discord rate limit (429)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || "2") * 1000;
        await sleep(retryAfter);
      } else if (!res.ok) {
        logger.error("[discord-webhook] POST failed (%d): %s", res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      logger.error(err, "[discord-webhook] Network error");
    }
  });
}
