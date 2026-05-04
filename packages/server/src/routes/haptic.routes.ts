// ──────────────────────────────────────────────
// Routes: Haptic Feedback (Buttplug.io)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { hapticService } from "../services/haptic/buttplug-service.js";
import type { HapticDeviceCommand } from "@marinara-engine/shared";
import { isHapticsRemoteAllowed } from "../config/runtime-config.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";

const MAX_HAPTIC_INTENSITY = 1;
const MAX_HAPTIC_DURATION_SECONDS = 30;
const MIN_COMMAND_INTERVAL_MS = 200;
let lastCommandAt = 0;

function clampCommand(cmd: HapticDeviceCommand): HapticDeviceCommand {
  return {
    ...cmd,
    intensity:
      typeof cmd.intensity === "number" && Number.isFinite(cmd.intensity)
        ? Math.max(0, Math.min(MAX_HAPTIC_INTENSITY, cmd.intensity))
        : cmd.intensity,
    duration:
      typeof cmd.duration === "number" && Number.isFinite(cmd.duration)
        ? Math.max(0, Math.min(MAX_HAPTIC_DURATION_SECONDS, cmd.duration))
        : cmd.duration,
  };
}

export async function hapticRoutes(app: FastifyInstance) {
  // ── GET /status ──
  app.get("/status", async () => {
    return hapticService.status();
  });

  // ── POST /connect ──
  app.post<{ Body: { url?: string } }>("/connect", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic connection", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    try {
      await hapticService.connect(req.body?.url);
      return hapticService.status();
    } catch (err) {
      reply.status(502);
      return { error: `Failed to connect to Intiface Central: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // ── POST /disconnect ──
  app.post("/disconnect", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic disconnect", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    await hapticService.disconnect();
    return hapticService.status();
  });

  // ── POST /scan/start ──
  app.post("/scan/start", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic scanning", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    try {
      await hapticService.startScanning();
      return { scanning: true };
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── POST /scan/stop ──
  app.post("/scan/stop", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic scanning", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    await hapticService.stopScanning();
    return { scanning: false };
  });

  // ── GET /devices ──
  app.get("/devices", async () => {
    return { devices: hapticService.devices };
  });

  // ── POST /command ──
  app.post<{ Body: HapticDeviceCommand }>("/command", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic command", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    const now = Date.now();
    if (now - lastCommandAt < MIN_COMMAND_INTERVAL_MS) {
      return reply.status(429).send({ error: "Haptic commands are rate limited" });
    }
    lastCommandAt = now;
    try {
      await hapticService.executeCommand(clampCommand(req.body));
      return { ok: true };
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── POST /stop-all ──
  app.post("/stop-all", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Haptic stop-all", loopbackOnly: !isHapticsRemoteAllowed() })) return;
    await hapticService.stopAll();
    return { ok: true };
  });
}
