// ──────────────────────────────────────────────
// Game Audio Score — Rule-Based Selectors
//
// Music uses the structured format:
// music:<state>:<genre>:<intensity>:<filename>
//
// Scene analysis provides compact direction fields (genre, intensity,
// location kind); the server/client pick actual asset tags deterministically.
// ──────────────────────────────────────────────

import type { GameActiveState } from "../types/game.js";

export const MUSIC_GENRES = [
  "fantasy",
  "horror",
  "romance",
  "mystery",
  "scifi",
  "modern",
  "slice_of_life",
  "adventure",
  "drama",
  "custom",
] as const;
export type MusicGenre = (typeof MUSIC_GENRES)[number];

export const MUSIC_INTENSITIES = ["calm", "tense", "intense"] as const;
export type MusicIntensity = (typeof MUSIC_INTENSITIES)[number];

export const LOCATION_KINDS = ["interior", "exterior", "underground", "urban", "nature"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface MusicScoreInput {
  state: GameActiveState;
  /** Small tie-breaker only. Main music selection comes from musicGenre/musicIntensity. */
  weather?: string | null;
  /** Small tie-breaker only. Main music selection comes from musicGenre/musicIntensity. */
  timeOfDay?: string | null;
  musicGenre?: MusicGenre | string | null;
  musicIntensity?: MusicIntensity | string | null;
  currentMusic?: string | null;
  recentMusic?: string[] | null;
  availableMusic: string[];
}

export interface AmbientScoreInput {
  state: GameActiveState;
  weather?: string | null;
  timeOfDay?: string | null;
  locationKind?: LocationKind | string | null;
  currentAmbient?: string | null;
  availableAmbient: string[];
  /** LLM-selected background tag — fallback only when locationKind is missing. */
  background?: string | null;
}

type ParsedMusicTag = {
  tag: string;
  state: GameActiveState;
  genre: MusicGenre;
  intensity: MusicIntensity;
  keywords: string[];
};

const GAME_STATES = new Set<GameActiveState>(["exploration", "dialogue", "combat", "travel_rest"]);
const MUSIC_GENRE_SET = new Set<string>(MUSIC_GENRES);
const MUSIC_INTENSITY_SET = new Set<string>(MUSIC_INTENSITIES);
const LOCATION_KIND_SET = new Set<string>(LOCATION_KINDS);

const INTENSITY_RANK: Record<MusicIntensity, number> = {
  calm: 0,
  tense: 1,
  intense: 2,
};

const STATE_DEFAULT_INTENSITY: Record<GameActiveState, MusicIntensity> = {
  exploration: "tense",
  dialogue: "calm",
  combat: "intense",
  travel_rest: "calm",
};

const WEATHER_INTENSITY: Record<string, MusicIntensity> = {
  storm: "intense",
  stormy: "intense",
  blizzard: "intense",
  sandstorm: "intense",
  fog: "tense",
  foggy: "tense",
  rain: "tense",
  rainy: "tense",
  heavy_rain: "tense",
  frost: "tense",
  snowy: "tense",
};

const TIME_INTENSITY: Record<string, MusicIntensity> = {
  evening: "tense",
  night: "tense",
  midnight: "tense",
};

const WEATHER_KEYWORDS: Record<string, string[]> = {
  clear: ["clear", "sun", "light", "warm"],
  cloudy: ["cloud", "overcast"],
  fog: ["fog", "mist"],
  foggy: ["fog", "mist"],
  rainy: ["rain", "storm"],
  rain: ["rain", "storm"],
  stormy: ["storm", "thunder"],
  storm: ["storm", "thunder"],
  snowy: ["snow", "frost", "ice"],
  snow: ["snow", "frost", "ice"],
  frost: ["snow", "frost", "ice"],
  windy: ["wind"],
  wind: ["wind"],
};

const TIME_KEYWORDS: Record<string, string[]> = {
  dawn: ["dawn", "morning", "light"],
  morning: ["morning", "light"],
  noon: ["day", "light"],
  afternoon: ["day", "light"],
  evening: ["evening", "dusk"],
  night: ["night", "dark"],
  midnight: ["night", "midnight", "dark"],
};

// Weather → preferred ambient keywords
const WEATHER_AMBIENT: Record<string, string[]> = {
  clear: ["birds", "wind", "water"],
  cloudy: ["wind"],
  overcast: ["wind", "eerie"],
  rain: ["rain"],
  rainy: ["rain"],
  heavy_rain: ["rain", "howling"],
  storm: ["rain", "thunder", "howling"],
  stormy: ["rain", "thunder", "howling"],
  snow: ["wind", "howling"],
  snowy: ["wind", "howling"],
  blizzard: ["wind", "howling"],
  frost: ["wind", "howling"],
  fog: ["eerie", "wind"],
  foggy: ["eerie", "wind"],
  wind: ["wind", "howling"],
  windy: ["wind", "howling"],
  hail: ["rain", "wind"],
  sandstorm: ["wind", "howling"],
  heat_wave: ["birds"],
};

// Time → preferred ambient keywords
const TIME_AMBIENT: Record<string, string[]> = {
  dawn: ["birds"],
  morning: ["birds"],
  noon: [],
  afternoon: [],
  evening: ["crickets"],
  night: ["crickets", "eerie"],
  midnight: ["eerie", "crickets"],
};

// State → preferred ambient keywords
const STATE_AMBIENT: Record<GameActiveState, string[]> = {
  exploration: ["nature", "birds", "wind", "water", "river"],
  dialogue: ["crowd", "murmur", "interior"],
  combat: ["wind", "rain"],
  travel_rest: ["rain-on-roof", "river", "water", "birds"],
};

const LOCATION_AMBIENT: Record<LocationKind, string[]> = {
  interior: ["interior", "rain-on-roof", "eerie", "dungeon", "murmur"],
  exterior: ["nature", "wind", "birds", "water", "river"],
  underground: ["dungeon", "cave", "eerie", "water", "drip"],
  urban: ["urban", "crowd", "murmur", "commotion"],
  nature: ["nature", "birds", "wind", "water", "river", "crickets"],
};

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized && normalized !== "null" ? normalized : null;
}

export function normalizeMusicGenre(value: unknown): MusicGenre | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  const aliases: Record<string, MusicGenre> = {
    sci_fi: "scifi",
    science_fiction: "scifi",
    slice: "slice_of_life",
    slice_of_life: "slice_of_life",
    sliceoflife: "slice_of_life",
    everyday: "slice_of_life",
    cozy: "slice_of_life",
  };

  if (aliases[normalized]) return aliases[normalized];
  return MUSIC_GENRE_SET.has(normalized) ? (normalized as MusicGenre) : null;
}

export function normalizeMusicIntensity(value: unknown): MusicIntensity | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  const aliases: Record<string, MusicIntensity> = {
    low: "calm",
    soft: "calm",
    peaceful: "calm",
    rest: "calm",
    medium: "tense",
    suspense: "tense",
    suspenseful: "tense",
    dramatic: "tense",
    high: "intense",
    action: "intense",
    climax: "intense",
    combat: "intense",
    urgent: "intense",
  };

  if (aliases[normalized]) return aliases[normalized];
  return MUSIC_INTENSITY_SET.has(normalized) ? (normalized as MusicIntensity) : null;
}

export function normalizeLocationKind(value: unknown): LocationKind | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  const aliases: Record<string, LocationKind> = {
    indoors: "interior",
    inside: "interior",
    room: "interior",
    dungeon: "underground",
    cave: "underground",
    city: "urban",
    town: "urban",
    street: "urban",
    outdoors: "exterior",
    outside: "exterior",
    wilderness: "nature",
    forest: "nature",
  };

  if (aliases[normalized]) return aliases[normalized];
  return LOCATION_KIND_SET.has(normalized) ? (normalized as LocationKind) : null;
}

function parseMusicTag(tag: string): ParsedMusicTag | null {
  const parts = tag.split(":");
  if (parts.length < 5 || parts[0] !== "music") return null;

  const state = parts[1] as GameActiveState | undefined;
  if (!state || !GAME_STATES.has(state)) return null;

  const genre = normalizeMusicGenre(parts[2]);
  const intensity = normalizeMusicIntensity(parts[3]);
  if (!genre || !intensity) return null;

  const keywords = parts
    .slice(2)
    .join(":")
    .toLowerCase()
    .split(/[:\-_]+/)
    .filter((part) => part.length > 1);

  return { tag, state, genre, intensity, keywords };
}

function inferMusicIntensity(
  state: GameActiveState,
  weather?: string | null,
  timeOfDay?: string | null,
): MusicIntensity {
  const weatherIntensity = weather ? WEATHER_INTENSITY[weather.toLowerCase()] : null;
  if (weatherIntensity && INTENSITY_RANK[weatherIntensity] > INTENSITY_RANK[STATE_DEFAULT_INTENSITY[state]]) {
    return weatherIntensity;
  }

  const timeIntensity = timeOfDay ? TIME_INTENSITY[timeOfDay.toLowerCase()] : null;
  if (timeIntensity && INTENSITY_RANK[timeIntensity] > INTENSITY_RANK[STATE_DEFAULT_INTENSITY[state]]) {
    return timeIntensity;
  }

  return STATE_DEFAULT_INTENSITY[state];
}

function musicAccentScore(candidate: ParsedMusicTag, weather?: string | null, timeOfDay?: string | null): number {
  const keywords = new Set<string>();
  for (const keyword of weather ? (WEATHER_KEYWORDS[weather.toLowerCase()] ?? []) : []) {
    keywords.add(keyword);
  }
  for (const keyword of timeOfDay ? (TIME_KEYWORDS[timeOfDay.toLowerCase()] ?? []) : []) {
    keywords.add(keyword);
  }
  if (!keywords.size) return 0;

  let score = 0;
  for (const keyword of keywords) {
    if (candidate.keywords.some((part) => part.includes(keyword) || keyword.includes(part))) score += 1;
  }
  return Math.min(score, 2);
}

function scoreStructuredMusic(
  candidate: ParsedMusicTag,
  desiredGenre: MusicGenre | null,
  desiredIntensity: MusicIntensity,
  hasExactGenre: boolean,
  weather?: string | null,
  timeOfDay?: string | null,
): number {
  let score = 10;

  if (desiredGenre) {
    if (candidate.genre === desiredGenre) {
      score += 12;
    } else if (candidate.genre === "custom") {
      score += 2;
    } else if (hasExactGenre) {
      score -= 4;
    }
  }

  const distance = Math.abs(INTENSITY_RANK[candidate.intensity] - INTENSITY_RANK[desiredIntensity]);
  score += distance === 0 ? 8 : distance === 1 ? 3 : -4;
  score += musicAccentScore(candidate, weather, timeOfDay);

  return score;
}

/**
 * Pick the best music tag for the current game context.
 * Returns `null` when the current music is already appropriate or no structured music exists for this state.
 */
export function scoreMusic(input: MusicScoreInput): string | null {
  const { state, weather, timeOfDay, currentMusic, recentMusic, availableMusic } = input;
  if (!availableMusic.length) return null;

  const desiredGenre = normalizeMusicGenre(input.musicGenre);
  const desiredIntensity =
    normalizeMusicIntensity(input.musicIntensity) ?? inferMusicIntensity(state, weather, timeOfDay);

  const candidates = availableMusic
    .map((tag) => parseMusicTag(tag))
    .filter((candidate): candidate is ParsedMusicTag => !!candidate && candidate.state === state);
  if (!candidates.length) return null;

  const hasExactGenre = desiredGenre ? candidates.some((candidate) => candidate.genre === desiredGenre) : false;
  const scored = candidates.map((candidate) => ({
    tag: candidate.tag,
    score: scoreStructuredMusic(candidate, desiredGenre, desiredIntensity, hasExactGenre, weather, timeOfDay),
  }));

  const recentSet = new Set((recentMusic ?? []).filter((tag) => tag && tag !== currentMusic));
  const nonCurrent = scored.filter((entry) => entry.tag !== currentMusic);
  const nonRecent = nonCurrent.filter((entry) => !recentSet.has(entry.tag));
  const poolBase = nonRecent.length > 0 ? nonRecent : nonCurrent.length > 0 ? nonCurrent : scored;
  if (!poolBase.length) return null;

  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const currentScore = currentMusic ? scored.find((entry) => entry.tag === currentMusic)?.score : undefined;
  const poolBestScore = Math.max(...poolBase.map((entry) => entry.score));
  const rotationWindow = currentScore !== undefined && currentScore >= bestScore - 1 ? 8 : 1;
  const selectionPool = poolBase.filter((entry) => entry.score >= poolBestScore - rotationWindow);
  return pickRandom(selectionPool).tag;
}

function inferLocationKindFromBackground(background?: string | null): LocationKind | null {
  const bgLower = (background ?? "").toLowerCase();
  if (!bgLower) return null;
  if (/(underground|dungeon|cave|catacomb|crypt|sewer|ruin)/.test(bgLower)) return "underground";
  if (/(city|street|market|town|village|alley|plaza|urban)/.test(bgLower)) return "urban";
  if (/(forest|woods|river|lake|mountain|beach|desert|valley|field|nature|swamp)/.test(bgLower)) return "nature";
  if (/(interior|room|laboratory|mansion|house|tavern|palace|hallway|bedroom|classroom|library)/.test(bgLower)) {
    return "interior";
  }
  return "exterior";
}

function ambientKeywordScore(parts: string[], keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (parts.some((part) => part.includes(kw) || kw.includes(part))) score++;
  }
  return score;
}

function weatherAllowsStormAudio(weather?: string | null): boolean {
  const normalized = normalizeToken(weather);
  return normalized === "storm" || normalized === "stormy" || normalized === "thunderstorm";
}

function ambientStormAudioScore(parts: string[], weather?: string | null): number {
  const hasStormAudio = parts.includes("thunder") || parts.includes("lightning") || parts.includes("storm");
  if (!hasStormAudio) return 0;
  return weatherAllowsStormAudio(weather) ? 2 : -6;
}

function ambientLocationScore(parts: string[], locationKind: LocationKind | null): number {
  if (!locationKind) return 0;
  const subcategory = parts[1] ?? "";

  if (locationKind === "interior") {
    if (subcategory === "interior" || parts.includes("interior")) return 4;
    if (subcategory === "nature" || subcategory === "urban") return -2;
  }

  if (locationKind === "underground") {
    if (parts.some((part) => ["dungeon", "cave", "underground"].includes(part))) return 4;
    if (subcategory === "interior") return 2;
    if (subcategory === "nature") return -1;
  }

  if (locationKind === "urban") {
    if (subcategory === "urban" || parts.includes("urban") || parts.includes("crowd")) return 4;
    if (subcategory === "nature") return -2;
  }

  if (locationKind === "nature" || locationKind === "exterior") {
    if (subcategory === "nature" || parts.includes("nature")) return 4;
    if (subcategory === "interior") return -2;
  }

  return 0;
}

/**
 * Pick the best ambient tag for the current game context.
 * Returns `null` when the current ambient is already appropriate or no match found.
 */
export function scoreAmbient(input: AmbientScoreInput): string | null {
  const { state, weather, timeOfDay, currentAmbient, availableAmbient, background } = input;
  if (!availableAmbient.length) return null;

  const locationKind = normalizeLocationKind(input.locationKind) ?? inferLocationKindFromBackground(background);
  const keywords: string[] = [];
  if (locationKind) {
    keywords.push(...LOCATION_AMBIENT[locationKind]);
  } else {
    keywords.push(...(STATE_AMBIENT[state] ?? []));
  }
  keywords.push(...(STATE_AMBIENT[state] ?? []));
  if (weather) keywords.push(...(WEATHER_AMBIENT[weather.toLowerCase()] ?? []));
  if (timeOfDay) keywords.push(...(TIME_AMBIENT[timeOfDay.toLowerCase()] ?? []));

  const scored = availableAmbient.map((tag) => {
    const parts = tag
      .toLowerCase()
      .split(/[:\-_]+/)
      .filter((part) => part.length > 1);
    const score =
      ambientLocationScore(parts, locationKind) +
      ambientKeywordScore(parts, keywords) +
      ambientStormAudioScore(parts, weather);
    return { tag, score };
  });

  for (let i = scored.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [scored[i], scored[j]] = [scored[j]!, scored[i]!];
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) return null;

  const current = currentAmbient ? scored.find((entry) => entry.tag === currentAmbient) : undefined;
  if (current && current.score >= best.score) return null;

  return best.tag;
}
