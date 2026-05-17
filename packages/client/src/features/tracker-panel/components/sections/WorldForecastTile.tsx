import type { TrackerPanelSizeProfile, TrackerTemperatureUnit } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import {
  getTemperatureColor,
  getTemperatureGaugeDisplay,
  getWeatherEmoji,
} from "../../lib/world-state-display";
import { visibleText } from "../../lib/tracker-display";
import { FittedText } from "../controls/InlineControls";
import { WorldRenderedEdit, WorldTileShell } from "./WorldEditableTile";

export function WorldForecastTile({
  weather,
  temperature,
  trackerPanelSizeProfile,
  trackerTemperatureUnit,
  onSaveWeather,
  onSaveTemperature,
}: {
  weather: string | null | undefined;
  temperature: string | null | undefined;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  trackerTemperatureUnit: TrackerTemperatureUnit;
  onSaveWeather?: (value: string) => void;
  onSaveTemperature?: (value: string) => void;
}) {
  const weatherText = visibleText(weather, "Set weather");
  const temperatureDisplay = getTemperatureGaugeDisplay(temperature, trackerTemperatureUnit);
  const useHorizontalTempRail = trackerPanelSizeProfile !== "compact";
  return (
    <WorldTileShell label="Forecast" className="min-h-[3.125rem]">
      <div className="@container relative h-full min-w-0 overflow-hidden">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 z-0 -translate-y-1/2 select-none text-[2.75rem] leading-none opacity-[0.085] saturate-125 @min-[7rem]:text-[3.25rem] @min-[10rem]:text-[4rem] @min-[14rem]:text-[4.65rem]",
            useHorizontalTempRail
              ? "right-[4rem] @min-[7rem]:right-[4.15rem] @min-[10rem]:right-[4.25rem] @min-[14rem]:right-[4.35rem]"
              : "right-[2rem] @min-[7rem]:right-[2.3rem] @min-[10rem]:right-[2.7rem] @min-[14rem]:right-[3.05rem]",
          )}
        >
          {getWeatherEmoji(weather)}
        </div>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_28%,transparent)_0%,transparent_48%),radial-gradient(ellipse_at_82%_45%,color-mix(in_srgb,var(--primary)_10%,transparent)_0%,transparent_58%)]" />
        <div className="pointer-events-none absolute inset-1 z-[1] rounded-[3px] opacity-[0.14] [background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_24%,transparent)_0_1px,transparent_1px_7px)]" />
        <WorldRenderedEdit
          label="Weather"
          value={weather}
          onSave={onSaveWeather}
          placeholder="Set weather"
          className={cn(
            "relative z-[2] flex h-full min-w-0 flex-col justify-center overflow-hidden px-1.5 py-1 text-left @min-[10rem]:px-2",
            useHorizontalTempRail
              ? "pr-[4.75rem] @min-[7rem]:pr-[4.9rem] @min-[10rem]:pr-[5rem] @min-[14rem]:pr-[5.1rem]"
              : "pr-[2.65rem] @min-[7rem]:pr-[2.95rem] @min-[10rem]:pr-[3.35rem] @min-[14rem]:pr-[3.85rem]",
          )}
          inputClassName={cn(
            "text-left text-[0.75rem]",
            useHorizontalTempRail
              ? "pr-[4.75rem] @min-[7rem]:pr-[4.9rem] @min-[10rem]:pr-[5rem] @min-[14rem]:pr-[5.1rem]"
              : "pr-[2.65rem] @min-[7rem]:pr-[2.95rem] @min-[10rem]:pr-[3.35rem] @min-[14rem]:pr-[3.85rem]",
          )}
          editHintClassName={cn(
            useHorizontalTempRail
              ? "right-[4.45rem] @min-[7rem]:right-[4.6rem] @min-[10rem]:right-[4.7rem] @min-[14rem]:right-[4.8rem]"
              : "right-[2.45rem] @min-[7rem]:right-[2.65rem] @min-[10rem]:right-[2.95rem] @min-[14rem]:right-[3.25rem]",
          )}
        >
          <WorldWeatherLabel text={weatherText} trackerPanelSizeProfile={trackerPanelSizeProfile} />
        </WorldRenderedEdit>
        <div
          className={cn(
            "absolute bottom-0.5 right-0.5 top-0.5 z-[3]",
            useHorizontalTempRail
              ? "w-[4.15rem] @min-[7rem]:w-[4.25rem] @min-[10rem]:w-[4.35rem] @min-[14rem]:w-[4.45rem]"
              : "w-[2.3rem] @min-[7rem]:w-[2.45rem] @min-[10rem]:bottom-0.5 @min-[10rem]:top-auto @min-[10rem]:h-[2.95rem] @min-[10rem]:w-[2.7rem] @min-[14rem]:w-[3rem]",
          )}
        >
          <WorldRenderedEdit
            label="Temp"
            value={temperature}
            onSave={onSaveTemperature}
            placeholder="Set temp"
            className={cn(
              "h-full w-full rounded-[3px] bg-[color-mix(in_srgb,var(--background)_38%,transparent)] text-center shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent),0_0_8px_color-mix(in_srgb,var(--background)_30%,transparent)] ring-1 ring-[var(--border)]/24 hover:!bg-[color-mix(in_srgb,var(--background)_46%,transparent)]",
              useHorizontalTempRail
                ? "grid grid-cols-[minmax(0,1fr)_1.4rem] items-center gap-0.5 py-0.5 pl-0.5 pr-1 @min-[10rem]:grid-cols-[minmax(0,1fr)_1.5rem] @min-[14rem]:gap-1 @min-[14rem]:pl-1 @min-[14rem]:pr-1.5"
                : "flex flex-col items-center justify-center gap-[0.125rem] px-0 pb-0.5 pt-0.5 @min-[10rem]:gap-0.5 @min-[10rem]:pt-0.5",
            )}
            inputClassName={cn("text-center text-[0.625rem]", useHorizontalTempRail && "text-[0.6875rem]")}
            showEditHint={false}
          >
            <span
              className={cn(
                "min-w-0 truncate font-black leading-none tracking-normal drop-shadow-sm",
                useHorizontalTempRail
                  ? "justify-self-end text-right text-[0.625rem] @min-[10rem]:text-[0.6875rem] @min-[14rem]:text-[0.75rem]"
                  : "text-[0.5625rem] @min-[10rem]:text-[0.625rem]",
                getTemperatureColor(temperature),
              )}
            >
              {temperatureDisplay.label}
            </span>
            <span
              className={cn(
                "flex min-w-0 items-center justify-center overflow-visible",
                useHorizontalTempRail ? "h-full w-full" : "order-first h-[1.55rem] w-full @min-[14rem]:h-[1.6rem]",
              )}
            >
              <WorldThermometerGauge
                display={temperatureDisplay}
                variant={useHorizontalTempRail ? "expanded" : "compact"}
              />
            </span>
          </WorldRenderedEdit>
        </div>
      </div>
    </WorldTileShell>
  );
}

type WorldWeatherLabelPlan =
  | {
      kind: "headline";
      minScale: number;
    }
  | {
      kind: "phrase";
      lines: string[];
      density: "comfortable" | "dense";
      minScale: number;
    };

function getBalancedWeatherLines(text: string, lineCount: 2 | 3) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text];
  if (words.length <= lineCount) return words;

  const candidates: string[][] = [];
  if (lineCount === 2) {
    for (let firstBreak = 1; firstBreak < words.length; firstBreak += 1) {
      candidates.push([words.slice(0, firstBreak).join(" "), words.slice(firstBreak).join(" ")]);
    }
  } else {
    for (let firstBreak = 1; firstBreak < words.length - 1; firstBreak += 1) {
      for (let secondBreak = firstBreak + 1; secondBreak < words.length; secondBreak += 1) {
        candidates.push([
          words.slice(0, firstBreak).join(" "),
          words.slice(firstBreak, secondBreak).join(" "),
          words.slice(secondBreak).join(" "),
        ]);
      }
    }
  }

  return candidates.reduce((best, candidate) => {
    const scoreLines = (lines: string[]) => {
      const lengths = lines.map((line) => line.length);
      const longest = Math.max(...lengths);
      const shortest = Math.min(...lengths);
      const isolatedTinyWordPenalty = lines.some((line) => line.length <= 3 && !line.includes(" ")) ? 8 : 0;
      return longest * 2 + (longest - shortest) + isolatedTinyWordPenalty;
    };

    return scoreLines(candidate) < scoreLines(best) ? candidate : best;
  }, candidates[0] ?? [text]);
}

function getWorldWeatherLabelPlan(text: string, trackerPanelSizeProfile: TrackerPanelSizeProfile): WorldWeatherLabelPlan {
  const normalized = text.replace(/\s+/g, " ").trim();
  const words = normalized ? normalized.split(" ") : [];
  const wordCount = words.length;
  const longestWord = words.reduce((longest, word) => Math.max(longest, word.length), 0);
  const isExpanded = trackerPanelSizeProfile === "expanded";
  const isCompact = trackerPanelSizeProfile === "compact";
  const headlineLimit = isExpanded ? 13 : isCompact ? 16 : 18;
  const longestHeadlineWordLimit = isExpanded ? 12 : 16;
  const canUseHeadline =
    wordCount <= 1 ||
    (wordCount <= 2 && normalized.length <= headlineLimit && longestWord <= longestHeadlineWordLimit);

  if (canUseHeadline) {
    return {
      kind: "headline",
      minScale: longestWord > longestHeadlineWordLimit ? 0.44 : 0.56,
    };
  }

  const useThreeLines =
    !isExpanded &&
    (wordCount > (isCompact ? 4 : 5) || normalized.length > (isCompact ? 34 : 42) || longestWord > 18);
  const lines = getBalancedWeatherLines(normalized, useThreeLines ? 3 : 2);

  return {
    kind: "phrase",
    lines,
    density: lines.length >= 3 || normalized.length > 38 || longestWord > 16 ? "dense" : "comfortable",
    minScale: lines.length >= 3 ? 0.5 : 0.56,
  };
}

function getWorldWeatherPhraseTextClass(
  trackerPanelSizeProfile: TrackerPanelSizeProfile,
  density: "comfortable" | "dense",
) {
  if (density === "dense") {
    return trackerPanelSizeProfile === "expanded"
      ? "text-[0.5625rem] leading-[0.625rem] @min-[7rem]:text-[0.625rem] @min-[7rem]:leading-[0.7rem] @min-[10rem]:text-[0.6875rem] @min-[10rem]:leading-[0.75rem] @min-[14rem]:text-[0.75rem] @min-[14rem]:leading-[0.8125rem]"
      : "text-[0.625rem] leading-[0.6875rem] @min-[7rem]:text-[0.6875rem] @min-[7rem]:leading-[0.75rem] @min-[10rem]:text-[0.75rem] @min-[10rem]:leading-[0.8125rem]";
  }

  return trackerPanelSizeProfile === "expanded"
    ? "text-[0.6875rem] leading-[0.75rem] @min-[7rem]:text-[0.75rem] @min-[7rem]:leading-[0.8125rem] @min-[10rem]:text-[0.8125rem] @min-[10rem]:leading-[0.875rem] @min-[14rem]:text-[0.875rem] @min-[14rem]:leading-[0.95rem]"
    : "text-[0.75rem] leading-[0.8125rem] @min-[7rem]:text-[0.8125rem] @min-[7rem]:leading-[0.875rem] @min-[10rem]:text-[0.875rem] @min-[10rem]:leading-[0.95rem]";
}

function WorldWeatherLabel({
  text,
  trackerPanelSizeProfile,
}: {
  text: string;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
}) {
  const plan = getWorldWeatherLabelPlan(text, trackerPanelSizeProfile);

  if (plan.kind === "headline") {
    return (
      <FittedText
        className="w-full max-w-full font-black leading-[0.9rem] tracking-normal text-[0.8125rem] text-[var(--foreground)]/92 drop-shadow-sm @min-[7rem]:text-[0.9375rem] @min-[7rem]:leading-[1rem] @min-[10rem]:text-[1.0625rem] @min-[10rem]:leading-[1.1rem] @min-[14rem]:text-[1.1875rem] @min-[14rem]:leading-[1.2rem] @min-[18rem]:text-[1.25rem] @min-[18rem]:leading-[1.25rem]"
        minScale={plan.minScale}
      >
        {text}
      </FittedText>
    );
  }

  return (
    <span
      className={cn(
        "flex w-full max-w-full min-w-0 flex-col justify-center overflow-hidden",
        plan.lines.length >= 3 ? "gap-0" : "gap-px",
      )}
    >
      {plan.lines.map((line, index) => (
        <FittedText
          key={`${line}-${index}`}
          className={cn(
            "w-full max-w-full font-extrabold normal-case tracking-normal text-[var(--foreground)]/92 drop-shadow-sm",
            getWorldWeatherPhraseTextClass(trackerPanelSizeProfile, plan.density),
          )}
          minScale={plan.minScale}
        >
          {line}
        </FittedText>
      ))}
    </span>
  );
}

function WorldThermometerGauge({
  display,
  variant = "compact",
}: {
  display: ReturnType<typeof getTemperatureGaugeDisplay>;
  variant?: "compact" | "expanded";
}) {
  const fillStyle = { backgroundColor: display.color };
  const expanded = variant === "expanded";
  return (
    <div className={cn("relative", expanded ? "h-[2.55rem] w-[1.15rem]" : "h-[1.55rem] w-[0.95rem]")}>
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-full border border-[var(--border)]/42 bg-[var(--background)]/52 shadow-[inset_0_0_4px_rgba(0,0,0,0.32)]",
          expanded ? "bottom-[0.58rem] h-[1.78rem] w-[0.5rem]" : "bottom-[0.42rem] h-[1rem] w-[0.42rem]",
        )}
      >
        <div
          className={cn(
            "absolute inset-x-0 overflow-hidden rounded-full",
            expanded ? "bottom-[0.15625rem] top-[0.15625rem]" : "bottom-[0.125rem] top-[0.125rem]",
          )}
        >
          <span
            className={cn(
              "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_16%,transparent)] transition-[height] duration-200",
              expanded ? "w-[0.25rem]" : "w-[0.2rem]",
            )}
            style={{ ...fillStyle, height: `${display.percent}%` }}
          />
        </div>
        <span
          className={cn(
            "absolute left-1/2 w-px -translate-x-1/2 rounded-full bg-[var(--foreground)]/18",
            expanded ? "top-[0.18rem] h-1" : "top-[0.125rem] h-0.5",
          )}
        />
      </div>
      <span
        className={cn(
          "absolute left-1/2 z-[1] -translate-x-1/2 shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_14%,transparent)]",
          expanded ? "bottom-[0.49rem] h-[0.42rem] w-[0.27rem]" : "bottom-[0.36rem] h-[0.3rem] w-[0.22rem]",
        )}
        style={fillStyle}
      />
      <div
        className={cn(
          "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border)]/42 bg-[var(--background)]/54 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.26),0_0_6px_color-mix(in_srgb,var(--primary)_9%,transparent)]",
          expanded ? "h-[0.92rem] w-[0.92rem]" : "h-[0.72rem] w-[0.72rem]",
        )}
      >
        <span className={cn("absolute rounded-full", expanded ? "inset-[0.19rem]" : "inset-[0.15rem]")} style={fillStyle} />
        <span
          className={cn(
            "absolute rounded-full bg-[var(--foreground)]/24",
            expanded ? "left-[0.3rem] top-[0.26rem] h-[0.28rem] w-[0.2rem]" : "left-[0.23rem] top-[0.2rem] h-[0.22rem] w-[0.16rem]",
          )}
        />
      </div>
    </div>
  );
}
