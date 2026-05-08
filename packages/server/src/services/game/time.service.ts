// ──────────────────────────────────────────────
// Game: Time Progression Service
//
// Deterministic time advancement based on player
// actions. No LLM needed — server ticks the clock.
// ──────────────────────────────────────────────

export interface GameTime {
  /** In-game day number (starting from 1) */
  day: number;
  /** Hour (0–23) */
  hour: number;
  /** Minute (0–59) */
  minute: number;
}

export type TimeOfDay = "dawn" | "morning" | "afternoon" | "evening" | "night" | "midnight";

const TIME_OF_DAY_HOURS: Record<TimeOfDay, number> = {
  dawn: 6,
  morning: 8,
  afternoon: 14,
  evening: 18,
  night: 21,
  midnight: 0,
};

/** Minutes advanced per action type. */
const ACTION_DURATIONS: Record<string, number> = {
  dialogue: 15,
  explore: 30,
  combat_round: 5,
  combat_end: 15,
  rest_short: 60,
  rest_long: 480,
  travel: 120,
  craft: 45,
  shop: 20,
  investigate: 25,
  default: 15,
};

/** Advance the game clock by a given action type. Returns the new time. */
export function advanceTime(current: GameTime, action: string): GameTime {
  const minutes = ACTION_DURATIONS[action] ?? ACTION_DURATIONS.default!;
  return addMinutes(current, minutes);
}

/** Add a specific number of minutes to the clock. */
export function addMinutes(current: GameTime, minutes: number): GameTime {
  let totalMinutes = current.day * 24 * 60 + current.hour * 60 + current.minute + minutes;

  const day = Math.floor(totalMinutes / (24 * 60));
  totalMinutes -= day * 24 * 60;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return { day: Math.max(1, day), hour, minute };
}

/** Get the time-of-day label for the current hour. */
export function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  if (hour >= 20) return "night";
  return "midnight";
}

/** Apply a scene analyzer time-of-day label without inventing a day skip on repeated labels. */
export function setTimeOfDay(current: GameTime, label: TimeOfDay): GameTime {
  const currentLabel = getTimeOfDay(current.hour);
  if (label === currentLabel) return current;

  const targetHour = TIME_OF_DAY_HOURS[label];
  const targetDay = targetHour <= current.hour ? current.day + 1 : current.day;
  return { ...current, day: targetDay, hour: targetHour, minute: 0 };
}

/** Format time as a human-readable string for narration injection. */
export function formatGameTime(time: GameTime): string {
  const tod = getTimeOfDay(time.hour);
  const hourStr = time.hour.toString().padStart(2, "0");
  const minStr = time.minute.toString().padStart(2, "0");
  return `Day ${time.day}, ${hourStr}:${minStr} (${tod})`;
}

/** Create the initial game time (Day 1, morning). */
export function createInitialTime(): GameTime {
  return { day: 1, hour: 8, minute: 0 };
}
