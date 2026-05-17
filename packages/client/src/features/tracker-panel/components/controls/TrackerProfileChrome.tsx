import { type CSSProperties } from "react";
import { cn } from "../../../../lib/utils";

export const TRACKER_PROFILE_CARD_FRAME_CLASS = cn(
  "relative isolate min-w-0 overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tracker-profile-rule)_82%,transparent)]",
  "bg-[image:var(--tracker-profile-material)] shadow-[0_0_10px_color-mix(in_srgb,var(--tracker-profile-dialogue-glow)_14%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_-1px_0_color-mix(in_srgb,var(--background)_32%,transparent)]",
  "transition-colors duration-200 [background-blend-mode:var(--tracker-profile-material-blend)]",
);

export const TRACKER_PROFILE_CARD_SURFACE_CLASS = cn(
  "relative isolate min-w-0 overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tracker-profile-rule)_84%,transparent)]",
  "bg-[image:var(--tracker-profile-material)] shadow-[0_0_9px_color-mix(in_srgb,var(--tracker-profile-dialogue-glow)_12%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_-1px_0_color-mix(in_srgb,var(--background)_32%,transparent)]",
  "transition-colors duration-200 [background-blend-mode:var(--tracker-profile-material-blend)]",
);

export const TRACKER_PROFILE_BODY_TONE_OVERLAY_CLASS =
  "pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_10%,transparent)_0%,transparent_34%,color-mix(in_srgb,var(--background)_22%,transparent)_100%)] opacity-[var(--tracker-profile-accent-wash-opacity,1)]";

export const TRACKER_PROFILE_BODY_BOTTOM_RULE_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--tracker-profile-rule)] opacity-90";

export const TRACKER_PROFILE_SURFACE_TEXTURE_CLASS =
  "pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-soft-light [background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_14%,transparent)_0_1px,transparent_1px_8px),repeating-linear-gradient(0deg,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_14%,transparent)_0_1px,transparent_1px_6px)] [mask-image:linear-gradient(180deg,black_0%,black_78%,transparent_100%)]";

export const TRACKER_PROFILE_SURFACE_TOP_RULE_CLASS =
  "pointer-events-none absolute inset-x-4 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--tracker-profile-rule)_56%,transparent)] opacity-90";

export const TRACKER_PROFILE_FIELD_TILE_CLASS =
  "group/field relative isolate grid min-h-0 min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 overflow-hidden rounded-[3px] border border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_28%,transparent)] bg-[image:var(--tracker-profile-field-material)] px-1 py-1 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_2%,transparent),inset_0_-4px_10px_color-mix(in_srgb,var(--background)_24%,transparent)] transition-colors [background-blend-mode:var(--tracker-profile-field-material-blend)] hover:border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_38%,transparent)]";

export const TRACKER_PROFILE_MATERIAL_PANEL_CLASS =
  "isolate overflow-hidden bg-[image:var(--tracker-profile-panel-material)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)] [background-blend-mode:var(--tracker-profile-panel-material-blend)] before:pointer-events-none before:absolute before:inset-x-5 before:top-0 before:z-[1] before:h-px before:bg-[linear-gradient(90deg,transparent,var(--tracker-profile-rule)_56%,transparent)] before:opacity-75 before:[mask-image:linear-gradient(90deg,transparent_0%,black_16%,black_62%,transparent_88%,transparent_100%)] before:content-['']";

export const TRACKER_PROFILE_STATUS_STRIP_CLASS =
  "relative flex min-w-0 items-start gap-1.5 overflow-hidden rounded-[5px] border border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent)] bg-[image:var(--tracker-profile-field-material)] text-[0.6875rem] leading-[0.875rem] shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--background)_34%,transparent)] [background-blend-mode:var(--tracker-profile-field-material-blend)] before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_48%,transparent),transparent)] before:opacity-70 before:[mask-image:linear-gradient(90deg,transparent_0%,black_20%,black_78%,transparent_100%)] before:content-['']";

export const TRACKER_PROFILE_EMPTY_SURFACE_CLASS =
  "relative overflow-hidden rounded-[5px] border border-dashed border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_34%,transparent)] bg-[image:var(--tracker-profile-field-material)] text-center text-[0.6875rem] text-[color-mix(in_srgb,var(--tracker-profile-muted-text)_58%,transparent)] shadow-[inset_0_1px_5px_color-mix(in_srgb,var(--background)_36%,transparent)] [background-blend-mode:var(--tracker-profile-field-material-blend)] before:pointer-events-none before:absolute before:inset-0 before:opacity-[0.12] before:[background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_16%,transparent)_0_1px,transparent_1px_8px)] before:content-['']";

export const TRACKER_PROFILE_INSTRUMENT_SHELF_CLASS =
  "group/statbox relative isolate flex min-h-0 flex-col overflow-x-hidden border-t border-[color-mix(in_srgb,var(--tracker-profile-rule)_44%,transparent)] bg-[image:var(--tracker-profile-panel-material)] px-1 py-1.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_8px_14px_color-mix(in_srgb,var(--background)_32%,transparent),inset_0_-12px_20px_color-mix(in_srgb,var(--background)_40%,transparent)] [background-blend-mode:var(--tracker-profile-panel-material-blend)]";

export const TRACKER_PROFILE_INSTRUMENT_SHELF_LEDGE_CLASS =
  "pointer-events-none absolute inset-x-0 top-0 z-[1] h-3 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_74%,var(--tracker-profile-surface-solid)_18%),color-mix(in_srgb,var(--background)_42%,transparent)_42%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_-1px_0_color-mix(in_srgb,var(--tracker-profile-rule)_42%,transparent)]";

export const TRACKER_PROFILE_INSTRUMENT_SHELF_GLEAM_CLASS =
  "pointer-events-none absolute inset-x-3 top-0 z-[2] h-px bg-[image:var(--tracker-profile-accent-layer)] opacity-[var(--tracker-profile-accent-highlight-opacity,0.32)] [mask-image:linear-gradient(90deg,transparent_0%,black_16%,black_72%,transparent_94%,transparent_100%)]";

export const TRACKER_PROFILE_INSTRUMENT_SHELF_PINLINES_CLASS = cn(
  TRACKER_PROFILE_SURFACE_TEXTURE_CLASS,
  "z-0 opacity-[0.2] [mask-image:linear-gradient(180deg,black_0%,black_74%,transparent_100%)]",
);

export const TRACKER_PROFILE_INSTRUMENT_SHELF_ETCH_CLASS =
  "pointer-events-none absolute inset-x-2 bottom-1 z-0 h-9 rounded-[4px] opacity-[0.16] [background-image:repeating-linear-gradient(90deg,color-mix(in_srgb,var(--tracker-profile-rule)_36%,transparent)_0_1px,transparent_1px_13px)] [mask-image:linear-gradient(90deg,transparent_0%,black_12%,black_88%,transparent_100%)]";

export const TRACKER_PROFILE_INSTRUMENT_SHELF_BOTTOM_RAIL_CLASS =
  "pointer-events-none absolute inset-x-6 bottom-1 z-[1] h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-accent-solid)_34%,transparent)_18%,color-mix(in_srgb,var(--tracker-profile-rule)_32%,transparent)_50%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_34%,transparent)_82%,transparent)] opacity-[var(--tracker-profile-accent-highlight-opacity,0.28)]";

export function TrackerReadabilityVeil({ strength = "soft" }: { strength?: "soft" | "strong" }) {
  const background =
    strength === "strong"
      ? "linear-gradient(180deg,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-strong-top,40%),transparent) 0%,color-mix(in srgb,var(--card) var(--tracker-profile-contrast-strong-mid,30%),transparent) 52%,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-strong-bottom,42%),transparent) 100%)"
      : "linear-gradient(180deg,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-soft-top,30%),transparent) 0%,color-mix(in srgb,var(--card) var(--tracker-profile-contrast-soft-mid,22%),transparent) 58%,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-soft-bottom,32%),transparent) 100%)";

  return <div className="pointer-events-none absolute inset-0 z-0" style={{ background }} />;
}

export function TrackerProfileDisplayWash({ className, opacity }: { className?: string; opacity?: string }) {
  const style = {
    "--tracker-profile-display-wash-local-opacity": opacity ?? "var(--tracker-profile-body-wash-opacity)",
  } as CSSProperties;

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}
      style={style}
    >
      <div className="absolute inset-0 bg-[image:var(--tracker-profile-display-layer)] opacity-[var(--tracker-profile-display-wash-local-opacity)] mix-blend-soft-light" />
    </div>
  );
}

export function TrackerProfileEdgeHighlight({
  className,
  strength = "soft",
  showBottom = true,
}: {
  className?: string;
  strength?: "soft" | "strong";
  showBottom?: boolean;
}) {
  const edgeOpacityClass =
    strength === "strong"
      ? "opacity-[var(--tracker-profile-accent-highlight-opacity,0.42)]"
      : "opacity-[var(--tracker-profile-accent-highlight-opacity,0.32)]";

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}>
      <div
        className={cn(
          "absolute inset-0 rounded-[inherit] ring-1 ring-inset shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--background)_22%,transparent),0_0_9px_color-mix(in_srgb,var(--tracker-profile-dialogue-glow)_34%,transparent)]",
          strength === "strong"
            ? "ring-[color-mix(in_srgb,var(--tracker-profile-rule)_76%,transparent)]"
            : "ring-[color-mix(in_srgb,var(--tracker-profile-rule)_52%,transparent)]",
        )}
      />
      <div
        className={cn(
          "absolute inset-x-5 top-0 h-[2px] bg-[image:var(--tracker-profile-accent-layer)] [mask-image:linear-gradient(90deg,transparent_0%,black_20%,black_80%,transparent_100%)]",
          strength === "strong"
            ? "opacity-[var(--tracker-profile-accent-highlight-opacity,0.42)]"
            : "opacity-[var(--tracker-profile-accent-highlight-opacity,0.32)]",
        )}
      />
      <div
        className={cn(
          "absolute inset-y-4 left-0 w-px bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent)_24%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_22%,transparent)_52%,transparent_86%)]",
          edgeOpacityClass,
        )}
      />
      <div
        className={cn(
          "absolute inset-y-4 right-0 w-px bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent)_24%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_22%,transparent)_52%,transparent_86%)]",
          edgeOpacityClass,
        )}
      />
      {showBottom && (
        <div
          className={cn(
            "absolute inset-x-5 bottom-0 h-px bg-[image:var(--tracker-profile-accent-layer)] [mask-image:linear-gradient(90deg,transparent_0%,black_18%,black_82%,transparent_100%)]",
            strength === "strong"
              ? "opacity-[var(--tracker-profile-accent-highlight-opacity,0.32)]"
              : "opacity-[var(--tracker-profile-accent-highlight-opacity,0.24)]",
          )}
        />
      )}
    </div>
  );
}

export function TrackerPortraitStageBackdrop({ media, className }: { media?: string | null; className?: string }) {
  const boxLayerStyle = {
    backgroundImage: "var(--tracker-profile-surface-layer)",
    opacity: "var(--tracker-profile-tint-opacity, 0.12)",
  } as CSSProperties;
  const mediaEchoStyle = {
    filter:
      "blur(var(--tracker-profile-portrait-media-blur, 1.25rem)) saturate(var(--tracker-profile-portrait-media-saturate, 1.18))",
    maskImage: "radial-gradient(ellipse at 50% 48%, black 0%, black 56%, transparent 82%)",
    opacity: "var(--tracker-profile-portrait-media-opacity, 0.18)",
    WebkitMaskImage: "radial-gradient(ellipse at 50% 48%, black 0%, black 56%, transparent 82%)",
  } as CSSProperties;
  const sideMaskStyle = {
    maskImage: "linear-gradient(180deg, black 0%, black 62%, transparent 100%)",
    opacity: "var(--tracker-profile-portrait-side-mask-opacity, 1)",
    WebkitMaskImage: "linear-gradient(180deg, black 0%, black 62%, transparent 100%)",
  } as CSSProperties;
  const lightStyle = {
    backgroundImage: "var(--tracker-profile-portrait-light)",
    opacity: "var(--tracker-profile-portrait-light-opacity, 0.7)",
  } as CSSProperties;
  const rimStyle = {
    backgroundImage: "var(--tracker-profile-portrait-rim)",
    opacity: "var(--tracker-profile-portrait-rim-opacity, 0.52)",
  } as CSSProperties;
  const bottomGlowStyle = {
    opacity: "var(--tracker-profile-portrait-bottom-glow-opacity, 0.75)",
  } as CSSProperties;
  const bottomRuleStyle = {
    opacity: "var(--tracker-profile-portrait-bottom-rule-opacity, 0.75)",
  } as CSSProperties;

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}>
      <div className="absolute inset-0 bg-[image:var(--tracker-profile-portrait-base)]" />
      <div className="absolute inset-0" style={boxLayerStyle} />
      {media ? (
        <img
          src={media}
          alt=""
          aria-hidden="true"
          className="absolute inset-[-10%] h-[120%] w-[120%] object-cover object-center"
          style={mediaEchoStyle}
          draggable={false}
        />
      ) : null}
      <div className="absolute inset-0" style={lightStyle} />
      <div className="absolute inset-0 bg-[image:var(--tracker-profile-portrait-veil)]" />
      <div
        className="absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
        style={sideMaskStyle}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(270deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
        style={sideMaskStyle}
      />
      <div
        className="absolute inset-x-2 bottom-0 h-1/2 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_16%,transparent),transparent_72%)]"
        style={bottomGlowStyle}
      />
      <div className="absolute inset-0" style={rimStyle} />
      <div
        className="absolute inset-x-3 bottom-2 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-accent-solid)_48%,transparent),transparent)]"
        style={bottomRuleStyle}
      />
    </div>
  );
}
