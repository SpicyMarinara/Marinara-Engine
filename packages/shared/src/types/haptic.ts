// ──────────────────────────────────────────────
// Types: Haptic Feedback (Buttplug.io)
// ──────────────────────────────────────────────

/** Capability of a connected haptic device. */
export type HapticCapability = "vibrate" | "rotate" | "oscillate" | "constrict" | "inflate" | "position";

/** A connected haptic device (client-facing representation). */
export interface HapticDevice {
  /** Buttplug device index */
  index: number;
  /** Display name (e.g. "Lovense Lush") */
  name: string;
  /** Supported output types */
  capabilities: HapticCapability[];
}

/** Status of the Buttplug connection. */
export interface HapticStatus {
  connected: boolean;
  serverUrl: string | null;
  /** Server-side default URL used when the client does not provide one. */
  defaultServerUrl?: string;
  scanning: boolean;
  devices: HapticDevice[];
}

/** A haptic command to send to a device. */
export interface HapticDeviceCommand {
  /** Device index (0 = first device, "all" = broadcast to all) */
  deviceIndex: number | "all";
  /** Action type */
  action: "vibrate" | "rotate" | "oscillate" | "constrict" | "inflate" | "position" | "stop";
  /** Intensity / speed (0.0-1.0) — not used for "stop" */
  intensity?: number;
  /** Duration in seconds — 0 or omitted means indefinite until next command */
  duration?: number;
}
