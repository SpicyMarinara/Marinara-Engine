import { type ReactNode } from "react";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit } from "../controls/InlineControls";

export type CompactCharacterFieldTone = "mood" | "appearance" | "outfit" | "thoughts";

const COMPACT_CHARACTER_FIELD_TONE_CLASSES: Record<CompactCharacterFieldTone, { icon: string }> = {
  mood: {
    icon: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_70%,var(--tracker-profile-text)_30%)] opacity-80",
  },
  appearance: {
    icon: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_58%,var(--tracker-profile-text)_42%)] opacity-80",
  },
  outfit: {
    icon: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_50%,var(--tracker-profile-text)_50%)] opacity-80",
  },
  thoughts: {
    icon: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_62%,var(--tracker-profile-text)_38%)] opacity-80",
  },
};

export const COMPACT_CHARACTER_MOOD_EDIT_CLASS =
  "font-medium italic text-[color-mix(in_srgb,var(--tracker-profile-text)_82%,var(--tracker-profile-accent-solid)_18%)] [--foreground:color-mix(in_srgb,var(--tracker-profile-text)_82%,var(--tracker-profile-accent-solid)_18%)] [--muted-foreground:color-mix(in_srgb,var(--tracker-profile-muted-text)_78%,var(--tracker-profile-accent-solid)_22%)]";
export const COMPACT_CHARACTER_MOOD_STATIC_CLASS =
  "font-medium italic text-[color-mix(in_srgb,var(--tracker-profile-text)_82%,var(--tracker-profile-accent-solid)_18%)]";

export function CompactCharacterField({
  icon,
  accessibleLabel,
  value,
  placeholder,
  onSave,
  tone,
  readable = false,
  className,
  valueClassName,
}: {
  icon: ReactNode;
  accessibleLabel: string;
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  tone: CompactCharacterFieldTone;
  readable?: boolean;
  className?: string;
  valueClassName?: string;
}) {
  if (!onSave && !value) return null;
  const toneClasses = COMPACT_CHARACTER_FIELD_TONE_CLASSES[tone];

  return (
    <div
      className={cn(
        "group/field relative isolate grid min-h-[1rem] min-w-0 grid-cols-[0.9375rem_minmax(0,1fr)] items-center gap-1 overflow-hidden rounded-[4px] border border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_24%,transparent)] bg-[image:var(--tracker-profile-field-material)] px-1 py-px text-[0.5625rem] leading-[0.875rem] text-[color:var(--tracker-profile-muted-text)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_1.5%,transparent)] transition-colors [background-blend-mode:var(--tracker-profile-field-material-blend)] before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--tracker-profile-rule)_10%,transparent)_0_1px,transparent_1px_7px)] before:opacity-24 before:mix-blend-soft-light before:content-[''] after:pointer-events-none after:absolute after:bottom-px after:right-px after:z-[1] after:h-3 after:w-[60%] after:origin-bottom-right after:-skew-x-6 after:bg-[linear-gradient(90deg,transparent_0%,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_62%,transparent)_30%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_24%,transparent)_82%,transparent_100%),linear-gradient(180deg,transparent_0%,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_54%,transparent)_42%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_22%,transparent)_86%,transparent_100%)] after:bg-no-repeat after:[background-position:right_bottom,right_bottom] after:[background-size:100%_1px,1px_78%] after:opacity-[var(--tracker-profile-accent-highlight-opacity,0.42)] after:[mask-image:linear-gradient(90deg,transparent_0%,black_22%,black_100%)] after:content-[''] hover:border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_36%,transparent)] @min-[176px]:min-h-[1.125rem] @min-[176px]:grid-cols-[1rem_minmax(0,1fr)] @min-[176px]:text-[0.625rem] @min-[176px]:leading-4",
        readable && "items-start pb-px pt-0.5",
        className,
      )}
    >
      <span
        className={cn(
          "relative z-[1] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_24%,transparent)] before:absolute before:inset-[3px] before:rounded-full before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_5%,transparent)] before:content-[''] group-hover/field:ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_36%,transparent)] group-hover/field:before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_8%,transparent)] [&>svg]:relative [&>svg]:z-[1] [&>svg]:stroke-[1.9] @min-[176px]:h-4 @min-[176px]:w-4",
          toneClasses.icon,
        )}
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
            "relative z-[1] w-full min-w-0 px-0 py-0 text-[0.5625rem] leading-[0.875rem] text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/14 @min-[176px]:text-[0.625rem]",
            readable
              ? "min-h-7 leading-[1.12] @min-[176px]:leading-[1.15]"
              : "h-3.5 @min-[176px]:h-4 @min-[176px]:leading-4",
            valueClassName,
          )}
          scrollOnHover={!readable}
          twoLinePreview={readable}
          editHintMode={readable ? "overlay" : "inline"}
          showEditHint={false}
        />
      ) : (
        <span
          className={cn(
            "relative z-[1] min-w-0 text-[color:var(--tracker-profile-text)]",
            readable ? "line-clamp-2 whitespace-normal break-words leading-[1.15]" : "truncate",
            valueClassName,
          )}
        >
          {visibleText(value, placeholder)}
        </span>
      )}
    </div>
  );
}
