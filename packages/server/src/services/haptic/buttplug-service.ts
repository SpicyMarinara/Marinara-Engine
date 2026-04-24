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
  DeviceOutputValueConstructor,
  DeviceOutputPositionWithDurationConstructor,
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
const ACTION_TO_OUTPUT: Record<string, OutputType> = {
  vibrate: OutputType.Vibrate,
  rotate: OutputType.Rotate,
  oscillate: OutputType.Oscillate,
  constrict: OutputType.Constrict,
  inflate: OutputType.Inflate,
  position: OutputType.PositionWithDuration,
};

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

    // Handle stop command
    if (cmd.action === "stop") {
      for (const device of targets) {
        await device.stop();
      }
      return;
    }

    const outputType = ACTION_TO_OUTPUT[cmd.action];
    if (!outputType) throw new Error(`Unknown action: ${cmd.action}`);

    const rawIntensity = cmd.intensity ?? 0.5;
    const rawDuration = cmd.duration ?? 0;
    const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity)) : 0.5;
    const duration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;

    for (const device of targets) {
      if (!device.hasOutput(outputType)) continue;

      if (cmd.action === "position") {
        // Position/linear commands use duration in ms
        const durationMs = (duration || 1) * 1000;
        const posCmd = new DeviceOutputPositionWithDurationConstructor().percent(intensity, durationMs);
        await device.runOutput(posCmd);
      } else {
        const outCmd = new DeviceOutputValueConstructor(outputType).percent(intensity);
        await device.runOutput(outCmd);
      }
    }

    // Schedule auto-stop if duration is specified and action isn't position
    if (duration > 0 && cmd.action !== "position") {
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
