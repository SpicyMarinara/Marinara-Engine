import { type ReactNode } from "react";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { getOppositeTrackerProfileSide, type TrackerProfileSide } from "../../lib/tracker-profile-layout";
import { FittedText, InlineEdit } from "./InlineControls";

const NAMEPLATE_CLASS = cn(
  "relative isolate z-[3] col-span-full h-5 min-h-5 overflow-hidden",
  "rounded-t-[0.5625rem] border-b border-[color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_18%,transparent)]",
  "bg-[image:var(--tracker-profile-nameplate)]",
  "py-0",
  "shadow-[0_0_4px_color-mix(in_srgb,var(--tracker-profile-nameplate-glow)_38%,transparent),inset_0_-1px_0_color-mix(in_srgb,var(--foreground)_2%,transparent)]",
);
const NAMEPLATE_TOP_AURA_CLASS =
  "pointer-events-none absolute inset-x-8 top-0 h-1 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_32%,transparent),transparent_78%)] opacity-45 [mask-image:linear-gradient(90deg,transparent_0%,transparent_8%,black_28%,black_72%,transparent_92%,transparent_100%)]";
const NAMEPLATE_TOP_GLINT_CLASS =
  "pointer-events-none absolute inset-x-12 top-0 h-px bg-[image:var(--tracker-profile-accent-layer)] opacity-[var(--tracker-profile-accent-highlight-opacity,0.32)] [mask-image:linear-gradient(90deg,transparent_0%,black_22%,black_78%,transparent_100%)]";
const NAMEPLATE_JOIN_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 h-[5px] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--tracker-profile-surface-solid)_12%,transparent))] opacity-48";
const NAMEPLATE_CLASP_BASE_CLASS = "pointer-events-none absolute top-0 z-[1] h-full w-4";
const NAMEPLATE_CONTROL_CLASP_POSITION_BY_SIDE = {
  left: "left-[1.25rem]",
  right: "right-[1.25rem]",
} satisfies Record<TrackerProfileSide, string>;
const NAMEPLATE_ORNAMENT_CLASP_POSITION_BY_SIDE = {
  left: "left-[1.5rem]",
  right: "right-[1.5rem]",
} satisfies Record<TrackerProfileSide, string>;
const NAMEPLATE_CLASP_TONE_CLASS = {
  control: "opacity-[0.58]",
  ornament: "opacity-[0.46]",
} satisfies Record<"control" | "ornament", string>;
const NAMEPLATE_CLASP_DIAMOND_CLASS =
  "absolute left-1/2 top-1/2 h-[0.875rem] w-[0.875rem] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_58%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--background)_10%,transparent),transparent_42%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_8%,transparent))] shadow-[inset_1px_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_-1px_-1px_0_color-mix(in_srgb,var(--background)_24%,transparent),0_0_3px_color-mix(in_srgb,var(--tracker-profile-nameplate-glow)_16%,transparent)]";
const NAMEPLATE_CLASP_CENTER_CLASS =
  "absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_52%,transparent)] bg-[color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_10%,transparent)] shadow-[0_0_3px_color-mix(in_srgb,var(--tracker-profile-nameplate-glow)_16%,transparent)]";
const NAMEPLATE_CLASP_TOP_STROKE_CLASS =
  "absolute left-1/2 top-0 h-px w-3 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_40%,transparent)_50%,transparent)]";
const NAMEPLATE_CLASP_BOTTOM_STROKE_CLASS =
  "absolute bottom-0 left-1/2 h-px w-3 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-accent-solid)_34%,transparent)_50%,transparent)]";
const NAMEPLATE_NAME_ACCENT_BASE_CLASS =
  "pointer-events-none absolute top-1/2 z-[0] grid -translate-y-1/2 items-center gap-2 opacity-[0.42]";
const NAMEPLATE_NAME_ACCENT_CLASS_BY_SPACE = {
  open: "inset-x-10 grid-cols-[minmax(0,1fr)_minmax(4.25rem,7.75rem)_minmax(0,1fr)]",
  reserved: "inset-x-8 grid-cols-[minmax(0,1fr)_minmax(4.75rem,7rem)_minmax(0,1fr)]",
} satisfies Record<"open" | "reserved", string>;
const NAMEPLATE_NAME_ACCENT_BAR_CLASS =
  "h-[2px] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--tracker-profile-display-solid)_34%,transparent)_42%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_16%,transparent)_58%,transparent)] opacity-65 [mask-image:linear-gradient(90deg,transparent_0%,black_20%,black_80%,transparent_100%)]";
const NAMEPLATE_NAME_HALO_CLASS =
  "pointer-events-none absolute left-1/2 top-1/2 z-[0] h-3.5 w-[min(58%,9.25rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--tracker-profile-display-solid)_10%,transparent)_0%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_4%,transparent)_46%,transparent_72%)] opacity-40";
const PRIMARY_CONTROL_SLOT_CLASS = "absolute top-1/2 z-20 -translate-y-1/2";
const PRIMARY_CONTROL_WASH_BASE_CLASS = "pointer-events-none absolute inset-y-0 w-14 opacity-22";
const PRIMARY_CONTROL_WASH_CLASS_BY_SIDE = {
  left: "left-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_8%,transparent),transparent)]",
  right:
    "right-0 bg-[linear-gradient(270deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_8%,transparent),transparent)]",
} satisfies Record<TrackerProfileSide, string>;
const SECONDARY_CONTROLS_CLASS =
  "absolute top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 opacity-65 transition-opacity focus-within:opacity-100 hover:opacity-100";
const SECONDARY_CONTROL_WASH_BASE_CLASS = "pointer-events-none absolute inset-y-0 w-10 opacity-18";
const SECONDARY_CONTROL_WASH_CLASS_BY_SIDE = {
  left: "left-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_6%,transparent),transparent)]",
  right:
    "right-0 bg-[linear-gradient(270deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_6%,transparent),transparent)]",
} satisfies Record<TrackerProfileSide, string>;
const NAME_EDIT_CLASS =
  "relative z-[1] h-5 w-full min-w-0 overflow-hidden px-0 py-0 text-[0.75rem] font-bold leading-5 text-[color:var(--tracker-profile-nameplate-text)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.42)] @min-[340px]:text-[0.8125rem] @min-[380px]:justify-center @min-[380px]:text-center";
const NAME_PREVIEW_CLASS =
  "relative z-[1] w-full text-[0.75rem] font-bold leading-5 text-[color:var(--tracker-profile-nameplate-text)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.42)] @min-[340px]:text-[0.8125rem]";

export const TRACKER_PROFILE_NAMEPLATE_ICON_BUTTON_CLASS =
  "flex h-4 w-4 items-center justify-center rounded-full border border-transparent bg-[color-mix(in_srgb,var(--background)_18%,transparent)] text-[var(--tracker-profile-icon)]/54 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tracker-profile-dialogue-border)_20%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-all hover:border-[color-mix(in_srgb,var(--primary)_32%,transparent)] hover:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_9%,transparent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-95";
export const TRACKER_PROFILE_NAMEPLATE_ICON_BUTTON_ACTIVE_CLASS =
  "border-[color-mix(in_srgb,var(--primary)_46%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)] shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_12%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]";
export const TRACKER_PROFILE_NAMEPLATE_HEADER_BUTTON_CLASS =
  "flex h-4 w-4 items-center justify-center rounded-sm text-[var(--muted-foreground)]/45 opacity-70 transition-all hover:bg-[var(--primary)]/8 hover:text-[var(--tracker-profile-icon)]/75 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/55 focus-visible:opacity-100 active:scale-95";

function TrackerProfileNameplateClasp({
  side,
  tone = "ornament",
}: {
  side: TrackerProfileSide;
  tone?: "control" | "ornament";
}) {
  const positionClass =
    tone === "control"
      ? NAMEPLATE_CONTROL_CLASP_POSITION_BY_SIDE[side]
      : NAMEPLATE_ORNAMENT_CLASP_POSITION_BY_SIDE[side];

  return (
    <div aria-hidden="true" className={cn(NAMEPLATE_CLASP_BASE_CLASS, positionClass, NAMEPLATE_CLASP_TONE_CLASS[tone])}>
      <div className={NAMEPLATE_CLASP_TOP_STROKE_CLASS} />
      <div className={NAMEPLATE_CLASP_DIAMOND_CLASS} />
      <div className={NAMEPLATE_CLASP_CENTER_CLASS} />
      <div className={NAMEPLATE_CLASP_BOTTOM_STROKE_CLASS} />
    </div>
  );
}

function TrackerProfileNameAccentBars({ reserveControlSpace }: { reserveControlSpace: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        NAMEPLATE_NAME_ACCENT_BASE_CLASS,
        NAMEPLATE_NAME_ACCENT_CLASS_BY_SPACE[reserveControlSpace ? "reserved" : "open"],
      )}
    >
      <div className={NAMEPLATE_NAME_ACCENT_BAR_CLASS} />
      <div />
      <div className={NAMEPLATE_NAME_ACCENT_BAR_CLASS} />
    </div>
  );
}

export function TrackerProfileNameplate({
  value,
  placeholder,
  onSave,
  primaryControl,
  primaryControlSide = "left",
  secondaryControls,
  secondaryControlsSide,
  className,
  nameClassName,
}: {
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  primaryControl?: ReactNode;
  primaryControlSide?: TrackerProfileSide;
  secondaryControls?: ReactNode;
  secondaryControlsSide?: TrackerProfileSide;
  className?: string;
  nameClassName?: string;
}) {
  const displayValue = visibleText(value, placeholder);
  const hasPrimaryControl = !!primaryControl;
  const hasSecondaryControls = !!secondaryControls;
  const resolvedSecondaryControlsSide = secondaryControlsSide ?? getOppositeTrackerProfileSide(primaryControlSide);
  const reserveControlSpace = hasPrimaryControl || hasSecondaryControls;
  const showSecondaryControlClasp =
    hasSecondaryControls && (!hasPrimaryControl || resolvedSecondaryControlsSide !== primaryControlSide);

  return (
    <div className={cn(NAMEPLATE_CLASS, reserveControlSpace ? "px-6" : "px-2.5", className)}>
      <div className={NAMEPLATE_TOP_AURA_CLASS} />
      <div className={NAMEPLATE_TOP_GLINT_CLASS} />
      <div className={NAMEPLATE_JOIN_CLASS} />
      {hasPrimaryControl && (
        <div className={cn(PRIMARY_CONTROL_WASH_BASE_CLASS, PRIMARY_CONTROL_WASH_CLASS_BY_SIDE[primaryControlSide])} />
      )}
      {hasSecondaryControls && (
        <div
          className={cn(
            SECONDARY_CONTROL_WASH_BASE_CLASS,
            SECONDARY_CONTROL_WASH_CLASS_BY_SIDE[resolvedSecondaryControlsSide],
          )}
        />
      )}
      {hasPrimaryControl && <TrackerProfileNameplateClasp side={primaryControlSide} tone="control" />}
      {!hasPrimaryControl && !hasSecondaryControls && (
        <>
          <TrackerProfileNameplateClasp side="left" />
          <TrackerProfileNameplateClasp side="right" />
        </>
      )}
      {showSecondaryControlClasp && (
        <TrackerProfileNameplateClasp side={resolvedSecondaryControlsSide} tone="control" />
      )}
      <div className={NAMEPLATE_NAME_HALO_CLASS} />
      <TrackerProfileNameAccentBars reserveControlSpace={reserveControlSpace} />

      {hasPrimaryControl && (
        <div className={cn(PRIMARY_CONTROL_SLOT_CLASS, primaryControlSide === "left" ? "left-1" : "right-1")}>
          {primaryControl}
        </div>
      )}

      {hasSecondaryControls && (
        <div className={cn(SECONDARY_CONTROLS_CLASS, resolvedSecondaryControlsSide === "left" ? "left-1" : "right-1")}>
          {secondaryControls}
        </div>
      )}

      {onSave ? (
        <InlineEdit
          value={value ?? ""}
          onSave={onSave}
          placeholder={placeholder}
          className={cn(NAME_EDIT_CLASS, nameClassName)}
          showEditHint={false}
          fitPreview
          fitAlign="center"
          fitMinScale={0.6}
        />
      ) : (
        <FittedText
          className={cn(NAME_PREVIEW_CLASS, nameClassName)}
          title={displayValue}
          align="center"
          minScale={0.6}
        >
          {displayValue}
        </FittedText>
      )}
    </div>
  );
}
