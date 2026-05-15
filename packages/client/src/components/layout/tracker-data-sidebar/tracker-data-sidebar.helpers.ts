import type { CSSProperties } from "react";
import type {
  CharacterStat,
  GameState,
  Persona,
  PresentCharacter,
  TrackerCardColorConfig,
} from "@marinara-engine/shared";
import type { SpriteInfo } from "../../../hooks/use-characters";
import {
  DEFAULT_TRACKER_CARD_ACCENT,
  getTrackerCardCssPaintValue,
  getTrackerCardFinish,
  getTrackerCardPaintOpacity,
  getTrackerCardPortraitStageBackground,
  getTrackerCardSkinFinish,
  getTrackerCardSolidColor,
  getTrackerCardStylePalette,
  getTrackerCardStyleVars,
  normalizeTrackerCardColorMode,
  parseTrackerCardColorConfig,
  type TrackerCardStylePalette,
} from "../../../lib/tracker-card-colors";
import {
  FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
  PERSONA_ADD_STAT_DENSITY_HEIGHT_REM,
  PERSONA_STAT_ALLOWANCE_REM,
  PERSONA_STAT_DENSITY_HEIGHT_REM,
  type PersonaPortraitMode,
  type TrackerStatDensity,
  type TrackerStatDisplayScale,
} from "./tracker-data-sidebar.constants";

export function trackerStatStackHeight(statCount: number, density: TrackerStatDensity, includeAdd: boolean) {
  return (
    statCount * PERSONA_STAT_DENSITY_HEIGHT_REM[density] +
    (includeAdd ? PERSONA_ADD_STAT_DENSITY_HEIGHT_REM[density] : 0)
  );
}

export function personaStatStackHeight(statCount: number, density: TrackerStatDensity, includeAdd: boolean) {
  return trackerStatStackHeight(statCount, density, includeAdd);
}

export function getPersonaStatDensity(
  statCount: number,
  portraitMode: PersonaPortraitMode,
  includeAdd: boolean,
): TrackerStatDensity {
  const allowance = PERSONA_STAT_ALLOWANCE_REM[portraitMode];
  if (personaStatStackHeight(statCount, "normal", includeAdd) <= allowance) return "normal";
  if (personaStatStackHeight(statCount, "compact", includeAdd) <= allowance) return "compact";
  return "tight";
}

export function getFeaturedCharacterStatDensity(
  statCount: number,
  includeAdd: boolean,
  allowance = FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
): TrackerStatDensity {
  if (trackerStatStackHeight(statCount, "normal", includeAdd) <= allowance) return "normal";
  if (trackerStatStackHeight(statCount, "compact", includeAdd) <= allowance) return "compact";
  return "tight";
}

export function getTrackerStatDisplayScale(
  statCount: number,
  density: TrackerStatDensity,
  fillAvailable: boolean,
  includeAdd: boolean,
): TrackerStatDisplayScale {
  if (!fillAvailable || density !== "normal") return "standard";
  return statCount + (includeAdd ? 1 : 0) <= 4 ? "spacious" : "roomy";
}

export function visibleText(value: string | number | null | undefined, fallback = "Unknown") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

export const WORLD_GRID_BASE_CLASS = "grid-cols-[2.5rem_2.5rem_minmax(0,1fr)]";
export const WORLD_GRID_BALANCED_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(6.25rem,1fr)_minmax(7.5rem,1.35fr)]";
export const WORLD_GRID_FORECAST_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(7rem,1.05fr)_minmax(7.25rem,1.2fr)]";
export const WORLD_GRID_LOCATION_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(5.5rem,0.8fr)_minmax(8.75rem,1.65fr)]";

export function getWorldTileTextNeed(value: string | null | undefined, fallback: string) {
  const text = visibleText(value, fallback).replace(/\s+/g, " ");
  const longestWord = text.split(" ").reduce((longest, word) => Math.max(longest, word.length), 0);
  return text.length + longestWord * 0.7;
}

export function getWorldDashboardGridClass(
  weather: string | null | undefined,
  temperature: string | null | undefined,
  location: string | null | undefined,
) {
  const forecastNeed =
    getWorldTileTextNeed(weather, "Set weather") + Math.min(8, getWorldTileTextNeed(temperature, "--") * 0.35);
  const locationNeed = getWorldTileTextNeed(location, "Set location");
  const hasLocation = visibleText(location, "").length > 0;
  if (hasLocation && locationNeed >= forecastNeed + 2) return WORLD_GRID_LOCATION_HEAVY_CLASS;
  if (forecastNeed >= locationNeed + 4) return WORLD_GRID_FORECAST_HEAVY_CLASS;
  if (locationNeed >= forecastNeed + 6) return WORLD_GRID_LOCATION_HEAVY_CLASS;
  return WORLD_GRID_BALANCED_CLASS;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getNumberValueWidth(value: number) {
  const text = Number.isFinite(value) ? String(value) : "0";
  return `${Math.min(7, Math.max(1.15, text.length + 0.35))}ch`;
}

export const WORLD_MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const WORLD_MONTH_ALIASES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function getWorldDateDisplay(date: string | null | undefined) {
  const text = (date ?? "").trim();
  if (!text) return { month: "DATE", day: "--", year: "", raw: "" };

  const isoMatch = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const monthIndex = Number(isoMatch[2]) - 1;
    return {
      month: WORLD_MONTH_LABELS[monthIndex] ?? "DATE",
      day: String(Number(isoMatch[3])).padStart(2, "0"),
      year: isoMatch[1]!,
      raw: text,
    };
  }

  const numericDate = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numericDate) {
    const first = Number(numericDate[1]);
    const second = Number(numericDate[2]);
    const day = first > 12 ? first : second;
    const monthIndex = (first > 12 ? second : first) - 1;
    return {
      month: WORLD_MONTH_LABELS[monthIndex] ?? "DATE",
      day: String(day).padStart(2, "0"),
      year: numericDate[3]!,
      raw: text,
    };
  }

  const namedMonthFirst = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/i,
  );
  if (namedMonthFirst) {
    const monthIndex = WORLD_MONTH_ALIASES[namedMonthFirst[1]!.toLowerCase()];
    return {
      month: monthIndex === undefined ? "DATE" : (WORLD_MONTH_LABELS[monthIndex] ?? "DATE"),
      day: String(Number(namedMonthFirst[2])).padStart(2, "0"),
      year: namedMonthFirst[3] ?? "",
      raw: text,
    };
  }

  const dayFirst = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\.|,)?(?:\s+(\d{2,4}))?\b/i,
  );
  if (dayFirst) {
    const monthIndex = WORLD_MONTH_ALIASES[dayFirst[2]!.toLowerCase()];
    return {
      month: monthIndex === undefined ? "DATE" : (WORLD_MONTH_LABELS[monthIndex] ?? "DATE"),
      day: String(Number(dayFirst[1])).padStart(2, "0"),
      year: dayFirst[3] ?? "",
      raw: text,
    };
  }

  const firstNumber = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  return {
    month: "DATE",
    day: firstNumber ? String(Number(firstNumber[1])).padStart(2, "0") : text.slice(0, 3).toUpperCase(),
    year: "",
    raw: text,
  };
}

export function getWorldTimeDisplay(time: string | null | undefined) {
  const text = (time ?? "").trim();
  if (!text) return { main: "--:--", suffix: "", raw: "", hour: null, minute: null };

  const twentyFourHour = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    return {
      main: `${twentyFourHour[1]!.padStart(2, "0")}:${twentyFourHour[2]}`,
      suffix: "",
      hour,
      minute,
      raw: text,
    };
  }

  const meridiem = text.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*([ap])\.?m?\.?\b/i);
  if (meridiem) {
    const displayHour = Number(meridiem[1]);
    const minute = Number(meridiem[2] ?? "00");
    const marker = meridiem[3]!.toLowerCase();
    const hour = marker === "p" ? (displayHour % 12) + 12 : displayHour % 12;
    return {
      main: `${meridiem[1]!.padStart(2, "0")}:${meridiem[2] ?? "00"}`,
      suffix: `${meridiem[3]!.toUpperCase()}M`,
      hour,
      minute,
      raw: text,
    };
  }

  return { main: text, suffix: "", raw: text, hour: null, minute: null };
}

export function getStatPercent(stat: CharacterStat) {
  if (!Number.isFinite(stat.max) || stat.max <= 0) return 0;
  return Math.max(0, Math.min(100, (stat.value / stat.max) * 100));
}

export function getWeatherEmoji(weather: string | null | undefined) {
  const text = (weather ?? "").toLowerCase();
  if (text.includes("thunder") || text.includes("lightning")) return "⛈️";
  if (text.includes("blizzard")) return "🌨️";
  if (text.includes("heavy rain") || text.includes("downpour") || text.includes("storm")) return "🌧️";
  if (text.includes("rain") || text.includes("drizzle") || text.includes("shower")) return "🌦️";
  if (text.includes("hail")) return "🧊";
  if (text.includes("snow") || text.includes("sleet") || text.includes("frost")) return "❄️";
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) return "🌫️";
  if (text.includes("sand") || text.includes("dust")) return "🏜️";
  if (text.includes("ash") || text.includes("volcanic") || text.includes("smoke")) return "🌋";
  if (text.includes("ember") || text.includes("fire") || text.includes("inferno")) return "🔥";
  if (text.includes("wind") || text.includes("breez") || text.includes("gust")) return "💨";
  if (text.includes("cherry") || text.includes("blossom") || text.includes("petal")) return "🌸";
  if (text.includes("aurora") || text.includes("northern light")) return "🌌";
  if (text.includes("cloud") || text.includes("overcast") || text.includes("grey") || text.includes("gray"))
    return "☁️";
  if (text.includes("clear") || text.includes("sunny") || text.includes("bright")) return "☀️";
  if (text.includes("hot") || text.includes("swelter")) return "🥵";
  if (text.includes("cold") || text.includes("freez")) return "🥶";
  return "🌤️";
}

export function getForecastWeatherTextClass(weather: string | null | undefined) {
  const text = visibleText(weather, "Set weather");
  const normalized = text.replace(/\s+/g, " ").trim();
  const wordCount = normalized ? normalized.split(" ").length : 0;
  const length = normalized.length;
  const longestWord = normalized.split(" ").reduce((longest, word) => Math.max(longest, word.length), 0);

  if (length > 44 || wordCount > 5 || longestWord > 16) {
    return "text-[0.46875rem] leading-[0.5625rem] @min-[7rem]:text-[0.53125rem] @min-[7rem]:leading-[0.65625rem] @min-[10rem]:text-[0.625rem] @min-[10rem]:leading-[0.75rem] @min-[14rem]:text-[0.6875rem] @min-[14rem]:leading-[0.8125rem]";
  }
  if (length > 30 || wordCount > 4 || longestWord > 12) {
    return "text-[0.53125rem] leading-[0.65625rem] @min-[7rem]:text-[0.59375rem] @min-[7rem]:leading-[0.71875rem] @min-[10rem]:text-[0.6875rem] @min-[10rem]:leading-[0.8125rem] @min-[14rem]:text-[0.75rem] @min-[14rem]:leading-[0.875rem]";
  }
  if (length > 16 || wordCount > 2) {
    return "text-[0.625rem] leading-[0.75rem] @min-[7rem]:text-[0.6875rem] @min-[7rem]:leading-[0.8125rem] @min-[10rem]:text-[0.8125rem] @min-[10rem]:leading-[0.925rem] @min-[14rem]:text-[0.9375rem] @min-[14rem]:leading-[1.05rem]";
  }
  return "text-[0.8125rem] leading-[0.9rem] @min-[7rem]:text-[0.9375rem] @min-[7rem]:leading-[1rem] @min-[10rem]:text-[1.0625rem] @min-[10rem]:leading-[1.1rem] @min-[14rem]:text-[1.1875rem] @min-[14rem]:leading-[1.2rem] @min-[18rem]:text-[1.25rem] @min-[18rem]:leading-[1.25rem]";
}

export function parseTemperatureValue(temperature: string | null | undefined) {
  const match = (temperature ?? "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const numeric = parseFloat(match[0]!);
  if (/°?\s*f/i.test(temperature ?? "")) return Math.round((numeric - 32) * (5 / 9));
  return Math.round(numeric);
}

export function getTemperatureKeywordHint(temperature: string | null | undefined) {
  const text = (temperature ?? "").toLowerCase();
  if (/\b(freez|frigid|arctic|glacial|sub-?zero|blizzard)/.test(text)) return -10;
  if (/\b(cold|chill|frost|wintry|icy|bitter|nipp)/.test(text)) return 2;
  if (/\b(cool|brisk|crisp|refresh)/.test(text)) return 12;
  if (/\b(mild|pleasant|comfort|temperate|fair)/.test(text)) return 20;
  if (/\b(warm|balmy|toasty|muggy|humid|stuffy|sultry)/.test(text)) return 28;
  if (/\b(hot|swelter|blaz|scorch|burn|heat|boil|sear|bak)/.test(text)) return 38;
  return null;
}

export function getTemperatureColor(temperature: string | null | undefined) {
  const parsed = parseTemperatureValue(temperature);
  const value = parsed ?? getTemperatureKeywordHint(temperature);
  if (value === null) return "text-rose-400/50";
  if (value < 0) return "text-blue-400";
  if (value < 15) return "text-sky-400";
  if (value < 30) return "text-amber-400";
  return "text-red-400";
}

export function getTemperatureGaugeDisplay(temperature: string | null | undefined) {
  const parsed = parseTemperatureValue(temperature);
  const hinted = getTemperatureKeywordHint(temperature);
  const value = parsed ?? hinted;
  const percent =
    value === null ? 42 : Math.max(8, Math.min(96, Math.round(((Math.max(-12, Math.min(42, value)) + 12) / 54) * 100)));
  const color =
    value === null
      ? "color-mix(in srgb, var(--primary) 42%, var(--muted-foreground) 28%)"
      : value < 0
        ? "rgb(96 165 250)"
        : value < 15
          ? "rgb(56 189 248)"
          : value < 30
            ? "rgb(163 230 53)"
            : "rgb(248 113 113)";

  return {
    color,
    label: parsed !== null ? `${parsed}°C` : visibleText(temperature, "--"),
    percent,
  };
}

export function getLocationPinColor(location: string | null | undefined) {
  const text = (location ?? "").toLowerCase();
  if (
    /\b(sea|ocean|lake|river|pond|creek|bay|shore|beach|harbor|harbour|port|coast|marsh|swamp|waterfall|spring|well|dock|canal|dam|reef|lagoon|estuary|fjord|cove)\b/.test(
      text,
    )
  ) {
    return "text-blue-400";
  }
  if (
    /\b(mountain|hill|cliff|peak|ridge|canyon|gorge|cave|cavern|mine|quarry|summit|bluff|crag|volcano|crater|mesa|plateau|ravine|boulder)\b/.test(
      text,
    )
  ) {
    return "text-amber-700";
  }
  if (
    /\b(city|town|village|castle|palace|fortress|market|shop|inn|tavern|bar|pub|guild|district|quarter|bazaar|temple|church|cathedral|shrine|tower|gate|square|plaza|street|alley|arena|throne|court|capitol|capital|metro|subway)\b/.test(
      text,
    )
  ) {
    return "text-purple-400";
  }
  if (
    /\b(room|hall|chamber|dungeon|cellar|basement|attic|library|study|bedroom|kitchen|office|lab|laboratory|vault|corridor|passage|cabin|hut|tent|interior|house|home|building|apartment|manor|lodge|dormitor|warehouse|prison|cell|jail)\b/.test(
      text,
    )
  ) {
    return "text-amber-300";
  }
  if (
    /\b(forest|wood|grove|jungle|garden|park|field|meadow|glade|clearing|plain|prairie|steppe|savanna|farm|ranch|orchard|vineyard|glen|vale|valley|thicket|copse|heath|moor|desert|tundra|waste|wild|trail|path|road)\b/.test(
      text,
    )
  ) {
    return "text-emerald-400";
  }
  return "text-emerald-400";
}

export function getWorldAmbienceStyle(state: GameState | null): CSSProperties {
  const weather = (state?.weather ?? "").toLowerCase();
  const location = (state?.location ?? "").toLowerCase();
  const time = (state?.time ?? "").toLowerCase();
  const temperature = (state?.temperature ?? "").toLowerCase();
  const tempValue = parseTemperatureValue(state?.temperature) ?? getTemperatureKeywordHint(state?.temperature);
  let primary = "var(--primary)";
  let secondary = "var(--accent)";
  let primaryMix = 20;
  let secondaryMix = 22;

  if (weather.includes("rain") || weather.includes("storm") || weather.includes("thunder")) {
    primary = "rgb(56 189 248)";
    secondary = "rgb(59 130 246)";
    primaryMix = 24;
    secondaryMix = 30;
  } else if (
    weather.includes("snow") ||
    weather.includes("frost") ||
    weather.includes("blizzard") ||
    (tempValue !== null && tempValue < 4)
  ) {
    primary = "rgb(186 230 253)";
    secondary = "rgb(96 165 250)";
    primaryMix = 18;
    secondaryMix = 24;
  } else if (
    weather.includes("fire") ||
    weather.includes("ash") ||
    weather.includes("sunny") ||
    temperature.includes("hot") ||
    (tempValue !== null && tempValue > 32) ||
    /\b(desert|waste|volcano|forge|lava|dune)\b/.test(location)
  ) {
    primary = "rgb(245 158 11)";
    secondary = "rgb(244 63 94)";
    primaryMix = 24;
    secondaryMix = 26;
  } else if (/\b(night|midnight|dusk|moon|evening)\b/.test(time)) {
    primary = "rgb(129 140 248)";
    secondary = "rgb(168 85 247)";
    primaryMix = 22;
    secondaryMix = 26;
  } else if (/\b(forest|grove|garden|field|meadow|wild|trail|river|lake|sea|shore)\b/.test(location)) {
    primary = "rgb(52 211 153)";
    secondary = "rgb(132 204 22)";
    primaryMix = 18;
    secondaryMix = 20;
  } else if (/\b(city|market|inn|tavern|castle|room|hall|tower|street|shop|temple)\b/.test(location)) {
    primary = "var(--primary)";
    secondary = "rgb(168 85 247)";
    primaryMix = 22;
    secondaryMix = 20;
  }

  return {
    background:
      `linear-gradient(135deg, color-mix(in srgb, color-mix(in srgb, var(--card) ${100 - primaryMix}%, ${primary} ${primaryMix}%) 58%, transparent), ` +
      `color-mix(in srgb, color-mix(in srgb, var(--background) ${100 - secondaryMix}%, ${secondary} ${secondaryMix}%) 52%, transparent))`,
  };
}

export function getSolidCssColor(value: string | null | undefined) {
  return getTrackerCardSolidColor(value);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function opacityWeight(value: number) {
  return clampPercent(value) / 100;
}

function scalePercent(value: number, opacity: number) {
  return Math.round(value * opacityWeight(opacity));
}

export interface TrackerProfileColors {
  dialogueColor?: string | null;
  nameColor?: string | null;
  boxColor?: string | null;
  trackerCardColors?: TrackerCardColorConfig | null;
}

type TrackerProfilePalette = TrackerCardStylePalette;

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getTrackerProfilePalette(
  profileColors: TrackerProfileColors | null | undefined,
  fallbackAccent = DEFAULT_TRACKER_CARD_ACCENT,
): TrackerProfilePalette {
  const trackerCardColors = profileColors?.trackerCardColors ?? null;
  const mode = normalizeTrackerCardColorMode(trackerCardColors?.mode);
  const finish = getTrackerCardFinish(trackerCardColors, mode);
  const opacity = getTrackerCardPaintOpacity(trackerCardColors);
  const effectiveColors = mode === "default" ? null : mode === "custom" ? trackerCardColors : profileColors;
  const effectiveFallback = mode === "chat" ? fallbackAccent : DEFAULT_TRACKER_CARD_ACCENT;

  return getTrackerCardStylePalette({
    colors: effectiveColors,
    finish,
    opacity,
    portraitStageBackground: getTrackerCardPortraitStageBackground(trackerCardColors),
    fallbackAccent: effectiveFallback,
  });
}

function withTrackerProfileStyle(palette: TrackerProfilePalette, background?: string): CSSProperties {
  const vars = getTrackerCardStyleVars({ palette, background });
  const style: CSSProperties & {
    "--tracker-profile-accent": string;
    "--tracker-profile-accent-layer": string;
    "--tracker-profile-dialogue": string;
    "--tracker-profile-dialogue-border": string;
    "--tracker-profile-dialogue-glow": string;
    "--tracker-profile-display-layer": string;
    "--tracker-profile-display-solid": string;
    "--tracker-profile-icon": string;
    "--tracker-profile-box": string;
    "--tracker-profile-box-layer": string;
    "--tracker-profile-frame": string;
    "--tracker-profile-frame-blend": string;
    "--tracker-profile-panel": string;
    "--tracker-profile-panel-blend": string;
    "--tracker-profile-panel-strong": string;
    "--tracker-profile-panel-strong-blend": string;
    "--tracker-profile-portrait-base": string;
    "--tracker-profile-portrait-bottom-glow-opacity": string;
    "--tracker-profile-portrait-bottom-rule-opacity": string;
    "--tracker-profile-portrait-media-blur": string;
    "--tracker-profile-portrait-media-opacity": string;
    "--tracker-profile-portrait-media-saturate": string;
    "--tracker-profile-portrait-light": string;
    "--tracker-profile-portrait-light-opacity": string;
    "--tracker-profile-portrait-rim": string;
    "--tracker-profile-portrait-rim-opacity": string;
    "--tracker-profile-portrait-side-mask-opacity": string;
    "--tracker-profile-portrait-veil": string;
    "--tracker-profile-muted-panel": string;
    "--tracker-profile-muted-panel-blend": string;
    "--tracker-profile-rule": string;
    "--tracker-profile-surface": string;
    "--tracker-profile-surface-blend": string;
    "--tracker-profile-slot-rule": string;
    "--tracker-profile-slot-shadow": string;
    "--tracker-profile-slot-surface": string;
    "--tracker-profile-slot-surface-blend": string;
    "--tracker-profile-tint-opacity": string;
    "--tracker-profile-display-opacity": string;
    "--tracker-profile-contrast-soft-top": string;
    "--tracker-profile-contrast-soft-mid": string;
    "--tracker-profile-contrast-soft-bottom": string;
    "--tracker-profile-contrast-strong-top": string;
    "--tracker-profile-contrast-strong-mid": string;
    "--tracker-profile-contrast-strong-bottom": string;
    "--tracker-profile-muted-text": string;
    "--tracker-profile-number-text": string;
    "--tracker-profile-row-rule": string;
    "--tracker-profile-stat-fill-glow": string;
    "--tracker-profile-stat-fill-highlight": string;
    "--tracker-profile-stat-track": string;
    "--tracker-profile-stat-track-blend": string;
    "--tracker-profile-stat-track-ring": string;
    "--tracker-profile-stat-track-shadow": string;
    "--tracker-profile-text": string;
    "--tracker-inline-foreground": string;
    "--tracker-inline-muted": string;
    "--tracker-inline-number": string;
    "--tracker-inline-rule": string;
    "--primary"?: string;
  } = {
    "--tracker-profile-accent": vars.accent,
    "--tracker-profile-accent-layer": vars.accentLayer,
    "--tracker-profile-dialogue": vars.accent,
    "--tracker-profile-dialogue-border": vars.dialogueBorder,
    "--tracker-profile-dialogue-glow": vars.dialogueGlow,
    "--tracker-profile-display-layer": vars.displayLayer,
    "--tracker-profile-display-solid": vars.displaySolid,
    "--tracker-profile-icon": vars.displaySolid,
    "--tracker-profile-box": vars.box,
    "--tracker-profile-box-layer": vars.boxLayer,
    "--tracker-profile-frame": vars.frame,
    "--tracker-profile-frame-blend": vars.frameBlend,
    "--tracker-profile-panel": vars.panel,
    "--tracker-profile-panel-blend": vars.panelBlend,
    "--tracker-profile-panel-strong": vars.panelStrong,
    "--tracker-profile-panel-strong-blend": vars.panelStrongBlend,
    "--tracker-profile-portrait-base": vars.portraitBase,
    "--tracker-profile-portrait-bottom-glow-opacity": vars.portraitBottomGlowOpacity,
    "--tracker-profile-portrait-bottom-rule-opacity": vars.portraitBottomRuleOpacity,
    "--tracker-profile-portrait-media-blur": vars.portraitMediaBlur,
    "--tracker-profile-portrait-media-opacity": vars.portraitMediaOpacity,
    "--tracker-profile-portrait-media-saturate": vars.portraitMediaSaturate,
    "--tracker-profile-portrait-light": vars.portraitLight,
    "--tracker-profile-portrait-light-opacity": vars.portraitLightOpacity,
    "--tracker-profile-portrait-rim": vars.portraitRim,
    "--tracker-profile-portrait-rim-opacity": vars.portraitRimOpacity,
    "--tracker-profile-portrait-side-mask-opacity": vars.portraitSideMaskOpacity,
    "--tracker-profile-portrait-veil": vars.portraitVeil,
    "--tracker-profile-muted-panel": vars.mutedPanel,
    "--tracker-profile-muted-panel-blend": vars.mutedPanelBlend,
    "--tracker-profile-rule": vars.rule,
    "--tracker-profile-surface": vars.surface,
    "--tracker-profile-surface-blend": vars.surfaceBlend,
    "--tracker-profile-slot-rule": vars.slotRule,
    "--tracker-profile-slot-shadow": vars.slotShadow,
    "--tracker-profile-slot-surface": vars.slotSurface,
    "--tracker-profile-slot-surface-blend": vars.slotSurfaceBlend,
    "--tracker-profile-tint-opacity": vars.tintOpacity,
    "--tracker-profile-display-opacity": vars.displayOpacity,
    "--tracker-profile-contrast-soft-top": vars.contrastSoftTop,
    "--tracker-profile-contrast-soft-mid": vars.contrastSoftMid,
    "--tracker-profile-contrast-soft-bottom": vars.contrastSoftBottom,
    "--tracker-profile-contrast-strong-top": vars.contrastStrongTop,
    "--tracker-profile-contrast-strong-mid": vars.contrastStrongMid,
    "--tracker-profile-contrast-strong-bottom": vars.contrastStrongBottom,
    "--tracker-profile-muted-text": vars.mutedText,
    "--tracker-profile-number-text": vars.numberText,
    "--tracker-profile-row-rule": vars.rowRule,
    "--tracker-profile-stat-fill-glow": vars.statFillGlow,
    "--tracker-profile-stat-fill-highlight": vars.statFillHighlight,
    "--tracker-profile-stat-track": vars.statTrack,
    "--tracker-profile-stat-track-blend": vars.statTrackBlend,
    "--tracker-profile-stat-track-ring": vars.statTrackRing,
    "--tracker-profile-stat-track-shadow": vars.statTrackShadow,
    "--tracker-profile-text": vars.text,
    "--tracker-inline-foreground": "var(--tracker-profile-text)",
    "--tracker-inline-muted": "var(--tracker-profile-muted-text)",
    "--tracker-inline-number": "var(--tracker-profile-number-text)",
    "--tracker-inline-rule": "var(--tracker-profile-row-rule)",
    background: vars.background,
    backgroundBlendMode: vars.backgroundBlendMode,
  };

  if (palette.accent !== DEFAULT_TRACKER_CARD_ACCENT) {
    style["--primary"] = palette.accent;
  }

  return style;
}

export function getPersonaProfileColors(persona: Persona | null): TrackerProfileColors {
  return {
    dialogueColor: persona?.dialogueColor,
    nameColor: persona?.nameColor,
    boxColor: persona?.boxColor,
    trackerCardColors: parseTrackerCardColorConfig(persona?.trackerCardColors),
  };
}

export function getPersonaAmbienceStyle(
  persona: Persona | null,
  options: { paintBackground?: boolean } = {},
): CSSProperties {
  const palette = getTrackerProfilePalette(getPersonaProfileColors(persona));
  const style = withTrackerProfileStyle(palette);

  if (options.paintBackground === false) {
    delete style.background;
    delete style.backgroundBlendMode;
  }

  return style;
}

export function getPersonaInitial(persona: Persona | null) {
  return visibleText(persona?.name, "P").slice(0, 1).toUpperCase();
}

export function getCharacterProfileColors(rawData: unknown): TrackerProfileColors | null {
  try {
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const data = record?.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
    const extensions =
      data?.extensions && typeof data.extensions === "object" && !Array.isArray(data.extensions)
        ? (data.extensions as Record<string, unknown>)
        : null;

    const trackerCardColorsRaw = extensions?.trackerCardColors;
    const profileColors: TrackerProfileColors = {
      dialogueColor: getTrackerCardCssPaintValue(getStringValue(extensions?.dialogueColor)),
      nameColor: getTrackerCardCssPaintValue(getStringValue(extensions?.nameColor)),
      boxColor: getTrackerCardCssPaintValue(getStringValue(extensions?.boxColor)),
      ...(trackerCardColorsRaw !== undefined && {
        trackerCardColors: parseTrackerCardColorConfig(trackerCardColorsRaw),
      }),
    };

    return profileColors.dialogueColor ||
      profileColors.nameColor ||
      profileColors.boxColor ||
      profileColors.trackerCardColors
      ? profileColors
      : null;
  } catch {
    return null;
  }
}

export function getCharacterAmbienceStyle(
  character: PresentCharacter,
  profileColors?: TrackerProfileColors | null,
): CSSProperties {
  const palette = getTrackerProfilePalette(
    profileColors,
    getSolidCssColor(character.stats?.find((stat) => stat.color)?.color) ?? DEFAULT_TRACKER_CARD_ACCENT,
  );
  const finish = getTrackerCardSkinFinish(palette.finish);
  const boxMix = scalePercent(Math.min(32, Math.round(finish.surfaceBoxMix * 0.9)), palette.opacity.boxColorOpacity);
  const displayMix = scalePercent(
    Math.min(28, Math.round(finish.surfaceDisplayMix * 0.85)),
    palette.opacity.nameColorOpacity,
  );
  return withTrackerProfileStyle(
    palette,
    `linear-gradient(135deg, color-mix(in srgb, var(--card) ${100 - boxMix}%, ${palette.box} ${boxMix}%), ` +
      `color-mix(in srgb, var(--background) ${100 - displayMix}%, ${palette.displaySolid} ${displayMix}%))`,
  );
}

export function getCharacterPortraitFallback(character: PresentCharacter) {
  const emoji = character.emoji?.trim();
  if (emoji && emoji !== "?") return emoji;
  const initial = visibleText(character.name, "C").slice(0, 1).toUpperCase();
  return initial === "?" ? "C" : initial;
}

export function getCharacterFeatureKey(character: PresentCharacter, index: number) {
  const stableId = character.characterId || character.name || `character-${index}`;
  return stableId;
}

export function parseMetadataRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function parseAgentSettings(settings: unknown): Record<string, unknown> {
  if (!settings) return {};
  if (typeof settings === "string") {
    try {
      const parsed = JSON.parse(settings);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

export function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function normalizeMaybeJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return normalizeStringArray(JSON.parse(trimmed));
  } catch {
    return [trimmed];
  }
}

export function normalizeLookupText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeSpriteExpressionMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const expressions: Record<string, string> = {};
  for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
    if (typeof expression !== "string") continue;
    const trimmed = expression.trim();
    if (key && trimmed) expressions[key] = trimmed;
  }
  return expressions;
}

export function getLatestSpriteExpressionsFromMessages(
  messages: Array<{ role?: string; extra?: unknown }> | undefined,
) {
  if (!messages?.length) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const extra = parseMetadataRecord(message.extra);
    const expressions = normalizeSpriteExpressionMap(extra.spriteExpressions);
    if (Object.keys(expressions).length > 0) return expressions;
  }
  return null;
}

export function isSpriteLookupCharacterId(characterId: string | null | undefined) {
  const id = characterId?.trim();
  return !!id && !id.startsWith("manual-") && !id.startsWith("party-npc:");
}

export function getSpriteExpressionForCharacter(
  expressions: Record<string, string>,
  character: PresentCharacter,
  spriteCharacterId: string | null,
) {
  if (spriteCharacterId && expressions[spriteCharacterId]) return expressions[spriteCharacterId];
  if (character.characterId && expressions[character.characterId]) return expressions[character.characterId];
  if (character.name && expressions[character.name]) return expressions[character.name];
  return undefined;
}

export function getCharacterExpressionHint(character: PresentCharacter, spriteExpression?: string | null) {
  if (spriteExpression?.trim()) return spriteExpression.trim();
  const text = [character.mood, character.thoughts].filter(Boolean).join(" ").toLowerCase();
  if (/\b(angry|furious|rage|snarl|seeth)\b/.test(text)) return "angry";
  if (/\b(sad|sorrow|cry|tears|weep|grief)\b/.test(text)) return "sad";
  if (/\b(happy|joy|laugh|smile|cheer|delight|giggl)\b/.test(text)) return "happy";
  if (/\b(surpris|shock|gasp|startle)\b/.test(text)) return "surprised";
  if (/\b(scared|afraid|fear|panic|trembl)\b/.test(text)) return "scared";
  if (/\b(blush|embarrass|fluster|shy)\b/.test(text)) return "embarrassed";
  if (/\b(think|ponder|wonder|consider|hmm)\b/.test(text)) return "thinking";
  if (/\b(worr|anxious|nervous|concern|dread)\b/.test(text)) return "worried";
  if (/\b(smirk|sly|teas|mischiev)\b/.test(text)) return "smirk";
  if (/\b(determin|resolv|steadfast)\b/.test(text)) return "determined";
  return "neutral";
}

export function resolveSpriteUrl(sprites: SpriteInfo[] | undefined, expression: string) {
  const spriteList = (sprites ?? []).filter((sprite) => !sprite.expression.toLowerCase().startsWith("full_"));
  if (spriteList.length === 0) return null;
  const exprLower = expression.toLowerCase();
  const exact = spriteList.find((sprite) => sprite.expression.toLowerCase() === exprLower);
  if (exact) return exact.url;
  const partial = spriteList.find((sprite) => {
    const stored = sprite.expression.toLowerCase();
    return stored.includes(exprLower) || exprLower.includes(stored);
  });
  if (partial) return partial.url;
  const neutral = spriteList.find((sprite) => {
    const stored = sprite.expression.toLowerCase();
    return stored === "neutral" || stored === "default" || stored === "idle";
  });
  return neutral?.url ?? spriteList[0]?.url ?? null;
}
