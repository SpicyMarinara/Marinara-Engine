import { type ReactNode } from "react";
import { Eye, HeartPulse, Shirt } from "lucide-react";
import type { CharacterStat, PresentCharacter } from "@marinara-engine/shared";
import type { TrackerPanelSizeProfile } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import type { TrackerStatDensity } from "../../tracker-panel.types";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit } from "../controls/InlineControls";
import { StatList } from "../controls/StatList";
import { TRACKER_PROFILE_FIELD_TILE_CLASS } from "../controls/TrackerProfileChrome";

const FEATURED_FIELD_LIST_CLASS = "relative z-[1] grid h-full min-h-0 grid-cols-1 gap-1 overflow-hidden p-1";
const FEATURED_FIELD_ICON_CLASS =
  "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[color-mix(in_srgb,var(--tracker-profile-icon)_58%,var(--tracker-profile-text)_42%)] opacity-[0.82] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_18%,transparent)] transition-colors before:absolute before:inset-[3px] before:rounded-full before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] before:content-[''] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_78%,var(--tracker-profile-text)_22%)] group-hover/field:ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_34%,transparent)] group-hover/field:before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_6%,transparent)] [&>svg]:relative [&>svg]:z-[1] [&>svg]:stroke-[1.85]";
type FeaturedFieldTone = "mood" | "appearance" | "outfit";
const FEATURED_FIELD_ICON_TONE_CLASS = {
  mood: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_70%,var(--tracker-profile-text)_30%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_4%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_84%,var(--tracker-profile-text)_16%)]",
  appearance:
    "text-[color-mix(in_srgb,var(--tracker-profile-icon)_58%,var(--tracker-profile-text)_42%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_76%,var(--tracker-profile-text)_24%)]",
  outfit:
    "text-[color-mix(in_srgb,var(--tracker-profile-icon)_50%,var(--tracker-profile-text)_50%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_68%,var(--tracker-profile-text)_32%)]",
} satisfies Record<FeaturedFieldTone, string>;
const FEATURED_FIELD_TILE_CLASS_BY_PROFILE = {
  compact: "py-0.5",
  standard: "py-1",
  expanded: "py-1.5",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_FIELD_TEXT_CLASS_BY_PROFILE = {
  compact: "text-[0.625rem] leading-[1.12]",
  standard: "text-[0.625rem] leading-[1.16]",
  expanded: "text-[0.6875rem] leading-[1.18]",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_FIELD_PREVIEW_LINES_BY_PROFILE = {
  compact: 2,
  standard: 3,
  expanded: 4,
} satisfies Record<TrackerPanelSizeProfile, 2 | 3 | 4>;
const FEATURED_FIELD_PREVIEW_CLASS_BY_PROFILE = {
  compact: "line-clamp-2",
  standard: "line-clamp-3",
  expanded: "line-clamp-4",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_STAT_SHELF_CLASS = cn(
  "group/statbox relative isolate flex min-h-0 flex-col overflow-x-hidden border-t border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_38%,transparent)] bg-[image:var(--tracker-profile-material)] px-1 py-1.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent),inset_0_8px_14px_color-mix(in_srgb,var(--background)_22%,transparent)] [background-blend-mode:var(--tracker-profile-material-blend)] before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:z-[1] before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_34%,transparent),transparent)] before:opacity-55 before:content-['']",
  "max-h-[7.75rem] @min-[380px]:max-h-[9.25rem]",
);

function FeaturedFieldTile({
  icon,
  accessibleLabel,
  value,
  placeholder,
  onSave,
  readable = false,
  sizeProfile,
  tone,
}: {
  icon: ReactNode;
  accessibleLabel: string;
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  readable?: boolean;
  sizeProfile: TrackerPanelSizeProfile;
  tone: FeaturedFieldTone;
}) {
  const displayValue = visibleText(value, placeholder);
  const textClass = FEATURED_FIELD_TEXT_CLASS_BY_PROFILE[sizeProfile];
  const previewLines = FEATURED_FIELD_PREVIEW_LINES_BY_PROFILE[sizeProfile];

  return (
    <div className={cn(TRACKER_PROFILE_FIELD_TILE_CLASS, FEATURED_FIELD_TILE_CLASS_BY_PROFILE[sizeProfile])}>
      <span
        className={cn(FEATURED_FIELD_ICON_CLASS, FEATURED_FIELD_ICON_TONE_CLASS[tone])}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        {icon}
      </span>
      {onSave ? (
        <InlineEdit
          value={value ?? ""}
          onSave={onSave}
          placeholder={placeholder}
          className={cn(
            "w-full min-w-0 self-center px-0 py-0 text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/25",
            readable ? textClass : "h-4 text-[0.625rem] leading-4",
          )}
          editHintMode={readable ? "overlay" : "inline"}
          scrollOnHover={!readable}
          twoLinePreview={readable}
          previewLineCount={previewLines}
        />
      ) : (
        <span
          className={cn(
            "self-center text-[color:var(--tracker-profile-text)]",
            readable ? "min-h-0 break-words [align-content:start]" : "block truncate text-[0.625rem]",
            readable && textClass,
            readable && FEATURED_FIELD_PREVIEW_CLASS_BY_PROFILE[sizeProfile],
          )}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}

export function FeaturedFieldList({
  character,
  onUpdate,
  readableRows = true,
  sizeProfile,
}: {
  character: PresentCharacter;
  onUpdate?: (character: PresentCharacter) => void;
  readableRows?: boolean;
  sizeProfile: TrackerPanelSizeProfile;
}) {
  const fields = [
    {
      accessibleLabel: "Mood",
      icon: <HeartPulse size="0.75rem" />,
      key: "mood",
      onSave: onUpdate ? (mood: string) => onUpdate({ ...character, mood }) : undefined,
      placeholder: "Mood",
      show: !!(character.mood || onUpdate),
      tone: "mood" as const,
      value: character.mood,
    },
    {
      accessibleLabel: "Look",
      icon: <Eye size="0.75rem" />,
      key: "appearance",
      onSave: onUpdate ? (appearance: string) => onUpdate({ ...character, appearance: appearance || null }) : undefined,
      placeholder: "Appearance",
      show: !!(character.appearance || onUpdate),
      tone: "appearance" as const,
      value: character.appearance,
    },
    {
      accessibleLabel: "Outfit",
      icon: <Shirt size="0.75rem" />,
      key: "outfit",
      onSave: onUpdate ? (outfit: string) => onUpdate({ ...character, outfit: outfit || null }) : undefined,
      placeholder: "Outfit",
      show: !!(character.outfit || onUpdate),
      tone: "outfit" as const,
      value: character.outfit,
    },
  ].filter((field) => field.show);
  if (fields.length === 0) return null;

  return (
    <div className={FEATURED_FIELD_LIST_CLASS} style={{ gridTemplateRows: `repeat(${fields.length}, minmax(0, 1fr))` }}>
      {fields.map((field) => (
        <FeaturedFieldTile
          key={field.key}
          icon={field.icon}
          accessibleLabel={field.accessibleLabel}
          value={field.value}
          placeholder={field.placeholder}
          onSave={field.onSave}
          readable={readableRows}
          sizeProfile={sizeProfile}
          tone={field.tone}
        />
      ))}
    </div>
  );
}

export function FeaturedStatGrid({
  stats,
  onUpdate,
  onAdd,
  deleteMode,
  addMode,
  density,
  scrollable,
  wideColumns,
  className,
}: {
  stats: CharacterStat[];
  onUpdate?: (stats: CharacterStat[]) => void;
  onAdd?: () => void;
  deleteMode: boolean;
  addMode: boolean;
  density: TrackerStatDensity;
  scrollable: boolean;
  wideColumns?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(FEATURED_STAT_SHELF_CLASS, scrollable ? "overflow-y-auto" : "overflow-y-hidden", className)}>
      <div className="relative z-[2]">
        <StatList
          stats={stats}
          onUpdate={onUpdate}
          onAdd={onAdd}
          deleteMode={deleteMode}
          addMode={addMode}
          nameMode="truncate"
          density={density}
          fillAvailable={false}
          wideColumns={wideColumns}
          showWideColumnGhost={wideColumns}
          visualTone="instrument"
        />
      </div>
    </div>
  );
}
