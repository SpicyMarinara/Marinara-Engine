import type { CSSProperties } from "react";
import type { GameState } from "@marinara-engine/shared";
import type { TrackerTemperatureUnit } from "../../../stores/ui.store";
import { visibleText } from "./tracker-display";

export const WORLD_GRID_BASE_CLASS = "grid-cols-[2.5rem_2.5rem_minmax(0,1fr)]";
export const WORLD_FREEFORM_DATE_GRID_BASE_CLASS = "grid-cols-[minmax(3.8rem,4.45rem)_2.5rem_minmax(0,1fr)]";
export const WORLD_GRID_BALANCED_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(6.25rem,1fr)_minmax(7.5rem,1.35fr)]";
export const WORLD_GRID_FORECAST_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(7rem,1.05fr)_minmax(7.25rem,1.2fr)]";
export const WORLD_GRID_LOCATION_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[2.5rem_2.5rem_minmax(7rem,0.95fr)_minmax(9rem,1.45fr)]";
export const WORLD_FREEFORM_DATE_GRID_BALANCED_CLASS =
  "@min-[380px]:grid-cols-[minmax(4.1rem,4.7rem)_2.5rem_minmax(5rem,0.86fr)_minmax(7.25rem,1.35fr)]";
export const WORLD_FREEFORM_DATE_GRID_FORECAST_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[minmax(4.1rem,4.7rem)_2.5rem_minmax(5.75rem,1fr)_minmax(6.75rem,1.1fr)]";
export const WORLD_FREEFORM_DATE_GRID_LOCATION_HEAVY_CLASS =
  "@min-[380px]:grid-cols-[minmax(4.1rem,4.7rem)_2.5rem_minmax(5rem,0.75fr)_minmax(8.25rem,1.45fr)]";

type WorldDashboardGridClassOptions = {
  hasFreeformDate?: boolean;
};

export function getWorldTileTextNeed(value: string | null | undefined, fallback: string) {
  const text = visibleText(value, fallback).replace(/\s+/g, " ");
  const longestWord = text.split(" ").reduce((longest, word) => Math.max(longest, word.length), 0);
  return text.length + longestWord * 0.7;
}

export function getWorldDashboardGridClass(
  weather: string | null | undefined,
  temperature: string | null | undefined,
  location: string | null | undefined,
  options: WorldDashboardGridClassOptions = {},
) {
  const { hasFreeformDate = false } = options;
  const forecastNeed =
    getWorldTileTextNeed(weather, "Set weather") + Math.min(8, getWorldTileTextNeed(temperature, "--") * 0.35);
  const locationNeed = getWorldTileTextNeed(location, "Set location");
  const hasLocation = visibleText(location, "").length > 0;
  if (hasLocation && locationNeed >= forecastNeed + 2) {
    return hasFreeformDate ? WORLD_FREEFORM_DATE_GRID_LOCATION_HEAVY_CLASS : WORLD_GRID_LOCATION_HEAVY_CLASS;
  }
  if (forecastNeed >= locationNeed + 4) {
    return hasFreeformDate ? WORLD_FREEFORM_DATE_GRID_FORECAST_HEAVY_CLASS : WORLD_GRID_FORECAST_HEAVY_CLASS;
  }
  if (locationNeed >= forecastNeed + 6) {
    return hasFreeformDate ? WORLD_FREEFORM_DATE_GRID_LOCATION_HEAVY_CLASS : WORLD_GRID_LOCATION_HEAVY_CLASS;
  }
  return hasFreeformDate ? WORLD_FREEFORM_DATE_GRID_BALANCED_CLASS : WORLD_GRID_BALANCED_CLASS;
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

function getFreeformDateParts(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const ofMatch = normalized.match(/^(.+?)\s+of\s+(.+)$/i);
  if (ofMatch) {
    return {
      main: ofMatch[2]!.trim(),
      detail: ofMatch[1]!.trim(),
    };
  }

  const commaParts = normalized.split(/\s*,\s*/).filter(Boolean);
  if (commaParts.length > 1) {
    return {
      main: commaParts[0]!,
      detail: commaParts.slice(1).join(", "),
    };
  }

  const words = normalized.split(" ");
  if (words.length > 2) {
    return {
      main: words.slice(0, 2).join(" "),
      detail: words.slice(2).join(" "),
    };
  }

  return {
    main: normalized,
    detail: "",
  };
}

function getCalendarDateDisplay({
  month,
  day,
  year = "",
  raw,
}: {
  month: string;
  day: string;
  year?: string;
  raw: string;
}) {
  return {
    kind: "calendar" as const,
    month,
    day,
    year,
    raw,
    main: "",
    detail: "",
  };
}

export function getWorldDateDisplay(date: string | null | undefined) {
  const text = (date ?? "").trim();
  if (!text) return { kind: "empty" as const, month: "DATE", day: "--", year: "", raw: "", main: "", detail: "" };

  const isoMatch = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const monthIndex = Number(isoMatch[2]) - 1;
    return getCalendarDateDisplay({
      month: WORLD_MONTH_LABELS[monthIndex] ?? "DATE",
      day: String(Number(isoMatch[3])).padStart(2, "0"),
      year: isoMatch[1]!,
      raw: text,
    });
  }

  const numericDate = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numericDate) {
    const first = Number(numericDate[1]);
    const second = Number(numericDate[2]);
    const day = first > 12 ? first : second;
    const monthIndex = (first > 12 ? second : first) - 1;
    return getCalendarDateDisplay({
      month: WORLD_MONTH_LABELS[monthIndex] ?? "DATE",
      day: String(day).padStart(2, "0"),
      year: numericDate[3]!,
      raw: text,
    });
  }

  const namedMonthFirst = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/i,
  );
  if (namedMonthFirst) {
    const monthIndex = WORLD_MONTH_ALIASES[namedMonthFirst[1]!.toLowerCase()];
    return getCalendarDateDisplay({
      month: monthIndex === undefined ? "DATE" : (WORLD_MONTH_LABELS[monthIndex] ?? "DATE"),
      day: String(Number(namedMonthFirst[2])).padStart(2, "0"),
      year: namedMonthFirst[3] ?? "",
      raw: text,
    });
  }

  const dayFirst = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\.|,)?(?:\s+(\d{2,4}))?\b/i,
  );
  if (dayFirst) {
    const monthIndex = WORLD_MONTH_ALIASES[dayFirst[2]!.toLowerCase()];
    return getCalendarDateDisplay({
      month: monthIndex === undefined ? "DATE" : (WORLD_MONTH_LABELS[monthIndex] ?? "DATE"),
      day: String(Number(dayFirst[1])).padStart(2, "0"),
      year: dayFirst[3] ?? "",
      raw: text,
    });
  }

  const freeform = getFreeformDateParts(text);
  return {
    kind: "freeform" as const,
    month: "DATE",
    day: "",
    year: "",
    raw: text,
    main: freeform.main,
    detail: freeform.detail,
  };
}

export type WorldDateDisplay = ReturnType<typeof getWorldDateDisplay>;

export function getWorldTimeDisplay(time: string | null | undefined) {
  const text = (time ?? "").trim();
  if (!text) return { main: "--:--", suffix: "", raw: "", hour: null, minute: null };

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

  return { main: text, suffix: "", raw: text, hour: null, minute: null };
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

export function parseTemperatureValue(temperature: string | null | undefined) {
  const match = (temperature ?? "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const numeric = parseFloat(match[0]!);
  if (/°?\s*f/i.test(temperature ?? "")) return (numeric - 32) * (5 / 9);
  return numeric;
}

function formatTemperatureValue(celsius: number, unit: TrackerTemperatureUnit) {
  if (unit === "fahrenheit") return `${Math.round(celsius * (9 / 5) + 32)}°F`;
  return `${Math.round(celsius)}°C`;
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
  if (value === null) return "text-[var(--muted-foreground)]/70";
  if (value < 0) return "text-blue-400";
  if (value < 15) return "text-sky-400";
  if (value < 30) return "text-lime-500";
  return "text-red-400";
}

export function getTemperatureGaugeDisplay(
  temperature: string | null | undefined,
  unit: TrackerTemperatureUnit = "celsius",
) {
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
            ? "rgb(132 204 22)"
            : "rgb(248 113 113)";

  return {
    color,
    label: parsed !== null ? formatTemperatureValue(parsed, unit) : visibleText(temperature, "--"),
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
