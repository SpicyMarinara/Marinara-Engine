// ──────────────────────────────────────────────
// Service: Buttplug.io Device Manager
// ──────────────────────────────────────────────
import { logger } from "../../lib/logger.js";
// Singleton service that connects to an Intiface Central server
// and manages haptic device discovery, tracking, and command execution.
//
// Intiface Central runs locally and exposes a WebSocket at ws://localhost:12345.
// This service wraps the buttplug.io client library for use in the generation pipeline.

import {
  ButtplugClient,
  ButtplugNodeWebsocketClientConnector,
  ButtplugClientDevice,
  DeviceOutput,
  DeviceOutputValueConstructor,
  OutputType,
} from "buttplug";
import type { HapticDevice, HapticCapability, HapticDeviceCommand, HapticStatus } from "@marinara-engine/shared";

const DEFAULT_SERVER_URL = "ws://127.0.0.1:12345";

/** OutputType values we map to capabilities. */
const CAPABILITY_TYPES: Array<{ type: OutputType; cap: HapticCapability }> = [
  { type: OutputType.Vibrate, cap: "vibrate" },
  { type: OutputType.Rotate, cap: "rotate" },
  { type: OutputType.Oscillate, cap: "oscillate" },
  { type: OutputType.Constrict, cap: "constrict" },
  { type: OutputType.Inflate, cap: "inflate" },
  { type: OutputType.Position, cap: "position" },
  { type: OutputType.PositionWithDuration, cap: "position" },
];

/** Map our action strings to buttplug OutputType. */
const ACTION_TO_OUTPUT: Partial<Record<HapticDeviceCommand["action"], OutputType>> = {
  vibrate: OutputType.Vibrate,
  rotate: OutputType.Rotate,
  oscillate: OutputType.Oscillate,
  constrict: OutputType.Constrict,
  inflate: OutputType.Inflate,
};

function normalizeAction(action: unknown): HapticDeviceCommand["action"] | null {
  if (typeof action !== "string") return null;
  const key = action
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (key === "positionwithduration" || key === "hwpositionwithduration" || key === "linear") return "position";
  if (key === "vibrate") return "vibrate";
  if (key === "rotate") return "rotate";
  if (key === "oscillate") return "oscillate";
  if (key === "constrict") return "constrict";
  if (key === "inflate") return "inflate";
  if (key === "position") return "position";
  if (key === "stop") return "stop";
  return null;
}

function clampUnit(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function durationSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function deviceName(device: ButtplugClientDevice): string {
  return device.displayName || device.name || `Device ${device.index}`;
}

/** Helper: get all devices from the client Map as an array. */
function devicesArray(client: ButtplugClient): ButtplugClientDevice[] {
  return [...client.devices.values()];
}

function deviceToDTO(device: ButtplugClientDevice): HapticDevice {
  const capabilities: HapticCapability[] = [];
  for (const { type, cap } of CAPABILITY_TYPES) {
    if (device.hasOutput(type) && !capabilities.includes(cap)) {
      capabilities.push(cap);
    }
  }
  return {
    index: device.index,
    name: device.displayName || device.name,
    capabilities,
  };
}

class ButtplugService {
  private client: ButtplugClient;
  private serverUrl: string | null = null;
  private stopTimers = new Map<number | "all", ReturnType<typeof setTimeout>>();

  constructor() {
    this.client = new ButtplugClient("Marinara Engine");

    // Track device events
    this.client.addListener("deviceadded", (device: ButtplugClientDevice) => {
      logger.info(`[haptic] Device connected: ${device.displayName || device.name} (index ${device.index})`);
    });
    this.client.addListener("deviceremoved", (device: ButtplugClientDevice) => {
      logger.info(`[haptic] Device disconnected: ${device.displayName || device.name} (index ${device.index})`);
    });
    this.client.addListener("serverdisconnect", () => {
      logger.info("[haptic] Disconnected from Intiface Central");
      this.serverUrl = null;
    });
  }

  get connected(): boolean {
    return this.client.connected;
  }

  get devices(): HapticDevice[] {
    if (!this.client.connected) return [];
    return devicesArray(this.client).map(deviceToDTO);
  }

  get scanning(): boolean {
    return this.client.isScanning;
  }

  /** Get current status. */
  status(): HapticStatus {
    return {
      connected: this.connected,
      serverUrl: this.serverUrl,
      scanning: this.scanning,
      devices: this.devices,
    };
  }

  /** Connect to Intiface Central server. */
  async connect(url?: string): Promise<void> {
    if (this.client.connected) return;
    const target = url || DEFAULT_SERVER_URL;
    const connector = new ButtplugNodeWebsocketClientConnector(target);
    await this.client.connect(connector);
    this.serverUrl = target;
    logger.info(`[haptic] Connected to Intiface Central at ${target}`);
  }

  /** Disconnect from Intiface Central. */
  async disconnect(): Promise<void> {
    if (!this.client.connected) return;
    this.clearAllTimers();
    await this.client.disconnect();
    this.serverUrl = null;
    logger.info("[haptic] Disconnected");
  }

  /** Start scanning for devices. */
  async startScanning(): Promise<void> {
    if (!this.client.connected) throw new Error("Not connected to Intiface Central");
    await this.client.startScanning();
  }

  /** Stop scanning for devices. */
  async stopScanning(): Promise<void> {
    if (!this.client.connected) return;
    await this.client.stopScanning();
  }

  /** Stop all devices. */
  async stopAll(): Promise<void> {
    if (!this.client.connected) return;
    this.clearAllTimers();
    await this.client.stopAllDevices();
  }

  /** Execute a haptic command. */
  async executeCommand(cmd: HapticDeviceCommand): Promise<void> {
    if (!this.client.connected) throw new Error("Not connected to Intiface Central");

    const targets = this.resolveTargets(cmd.deviceIndex);
    if (targets.length === 0) return;

    const action = normalizeAction(cmd.action);
    if (!action) throw new Error(`Unknown action: ${String(cmd.action)}`);

    // Handle stop command
    if (action === "stop") {
      for (const device of targets) {
        await device.stop();
      }
      return;
    }

    const outputType = ACTION_TO_OUTPUT[action];
    const intensity = clampUnit(cmd.intensity, 0.5);
    const duration = durationSeconds(cmd.duration);
    let successfulTargets = 0;
    let firstFailure: unknown = null;

    for (const device of targets) {
      try {
        if (action === "position") {
          const durationMs = Math.max(1, duration || 1) * 1000;
          if (device.hasOutput(OutputType.PositionWithDuration)) {
            await device.runOutput(DeviceOutput.PositionWithDuration.percent(intensity, durationMs));
            successfulTargets++;
          } else if (device.hasOutput(OutputType.Position)) {
            await device.runOutput(DeviceOutput.Position.percent(intensity));
            successfulTargets++;
          }
          continue;
        }

        if (!outputType || !device.hasOutput(outputType)) continue;
        const outCmd = new DeviceOutputValueConstructor(outputType).percent(intensity);
        await device.runOutput(outCmd);
        successfulTargets++;
      } catch (err) {
        firstFailure ??= err;
        logger.warn(err, "[haptic] Command %s failed for %s (index %d)", action, deviceName(device), device.index);
      }
    }

    if (successfulTargets === 0 && firstFailure) {
      throw firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure));
    }

    // Schedule auto-stop if duration is specified and action isn't position
    if (duration > 0 && action !== "position" && successfulTargets > 0) {
      const timerKey = cmd.deviceIndex;
      // Clear any existing timer for this target
      const existing = this.stopTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      this.stopTimers.set(
        timerKey,
        setTimeout(async () => {
          this.stopTimers.delete(timerKey);
          for (const device of targets) {
            try {
              await device.stop();
            } catch {
              // Device may have disconnected
            }
          }
        }, duration * 1000),
      );
    }
  }

  /** Execute multiple commands in sequence (e.g. from agent output). */
  async executeCommands(commands: HapticDeviceCommand[]): Promise<void> {
    for (const cmd of commands) {
      await this.executeCommand(cmd);
    }
  }

  private resolveTargets(deviceIndex: number | "all"): ButtplugClientDevice[] {
    const all = devicesArray(this.client);
    if (deviceIndex === "all") return all;
    const device = this.client.devices.get(deviceIndex);
    return device ? [device] : []; // return empty if index not found
  }

  private clearAllTimers(): void {
    for (const timer of this.stopTimers.values()) clearTimeout(timer);
    this.stopTimers.clear();
  }
}

/** Singleton instance — shared across the server lifetime. */
export const hapticService = new ButtplugService();
