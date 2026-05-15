import type { ReactNode } from "react";
import { Eye, HeartPulse, ImagePlus, Maximize2, MessageCircle, Shirt, X } from "lucide-react";
import type { PresentCharacter } from "@marinara-engine/shared";
import type { TrackerPanelSide } from "../../../stores/ui.store";
import { cn } from "../../../lib/utils";
import { getCharacterAmbienceStyle, visibleText, type TrackerProfileColors } from "./tracker-data-sidebar.helpers";
import {
  FittedText,
  InlineEdit,
  TrackerProfileDisplayWash,
  TrackerProfileEdgeHighlight,
  TrackerReadabilityVeil,
} from "./tracker-data-sidebar.controls";
import { StatList } from "./tracker-data-sidebar.stats";
import { FeaturedCharacterTrackerCard } from "./FeaturedCharacterTrackerCard";

type CompactCharacterFieldTone = "appearance" | "outfit" | "thoughts";

const COMPACT_CHARACTER_FIELD_TONE_CLASSES: Record<CompactCharacterFieldTone, { icon: string }> = {
  appearance: {
    icon: "text-[color-mix(in_srgb,var(--y2k-blue)_78%,var(--foreground)_22%)] drop-shadow-[0_0_5px_color-mix(in_srgb,var(--y2k-blue)_24%,transparent)]",
  },
  outfit: {
    icon: "text-[color-mix(in_srgb,var(--y2k-pink)_80%,var(--foreground)_20%)] drop-shadow-[0_0_5px_color-mix(in_srgb,var(--y2k-pink)_24%,transparent)]",
  },
  thoughts: {
    icon: "text-[color-mix(in_srgb,var(--y2k-lavender)_76%,var(--foreground)_24%)] drop-shadow-[0_0_5px_color-mix(in_srgb,var(--y2k-lavender)_22%,transparent)]",
  },
};

const COMPACT_CHARACTER_MOOD_EDIT_CLASS =
  "font-medium italic [--foreground:color-mix(in_srgb,var(--primary)_54%,var(--y2k-lavender)_46%)] [--muted-foreground:color-mix(in_srgb,var(--primary)_44%,var(--muted-foreground)_56%)]";
const COMPACT_CHARACTER_MOOD_STATIC_CLASS =
  "font-medium italic text-[color-mix(in_srgb,var(--primary)_54%,var(--y2k-lavender)_46%)]";

function CompactCharacterField({
  icon,
  accessibleLabel,
  value,
  placeholder,
  onSave,
  tone,
  className,
}: {
  icon: ReactNode;
  accessibleLabel: string;
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  tone: CompactCharacterFieldTone;
  className?: string;
}) {
  if (!onSave && !value) return null;
  const toneClasses = COMPACT_CHARACTER_FIELD_TONE_CLASSES[tone];

  return (
    <div
      className={cn(
        "grid min-h-3.5 min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-0.5 rounded-[2px] px-0.5 py-px text-[0.5625rem] leading-[0.875rem] text-[color:var(--tracker-profile-muted-text)] hover:bg-[var(--accent)]/14 @min-[176px]:min-h-4 @min-[176px]:grid-cols-[0.875rem_minmax(0,1fr)] @min-[176px]:text-[0.625rem] @min-[176px]:leading-4",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-3 w-3 shrink-0 items-center justify-center @min-[176px]:h-3.5 @min-[176px]:w-3.5",
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
            "h-3.5 w-full min-w-0 px-0 py-0 text-[0.5625rem] leading-[0.875rem] hover:bg-[var(--accent)]/20 @min-[176px]:h-4 @min-[176px]:text-[0.625rem] @min-[176px]:leading-4",
          )}
          scrollOnHover
          showEditHint={false}
        />
      ) : (
        <span className="min-w-0 truncate text-[color:var(--tracker-profile-text)]">
          {visibleText(value, placeholder)}
        </span>
      )}
    </div>
  );
}

export function CharacterTrackerCard({
  character,
  spriteCharacterId,
  spriteExpression,
  expressionSpritesEnabled,
  characterPicture,
  profileColors,
  trackerPanelSide,
  action,
  onUpdate,
  onRemove,
  deleteMode = false,
  addMode = false,
  featured = false,
  onToggleFeatured,
  onUploadAvatar,
}: {
  character: PresentCharacter;
  spriteCharacterId?: string | null;
  spriteExpression?: string;
  expressionSpritesEnabled: boolean;
  characterPicture?: string | null;
  profileColors?: TrackerProfileColors | null;
  trackerPanelSide: TrackerPanelSide;
  action?: ReactNode;
  onUpdate?: (character: PresentCharacter) => void;
  onRemove?: () => void;
  deleteMode?: boolean;
  addMode?: boolean;
  featured?: boolean;
  onToggleFeatured?: () => void;
  onUploadAvatar?: () => void;
}) {
  if (featured) {
    return (
      <FeaturedCharacterTrackerCard
        character={character}
        spriteCharacterId={spriteCharacterId}
        spriteExpression={spriteExpression}
        expressionSpritesEnabled={expressionSpritesEnabled}
        characterPicture={characterPicture}
        profileColors={profileColors}
        trackerPanelSide={trackerPanelSide}
        action={action}
        onUpdate={onUpdate}
        onRemove={onRemove}
        deleteMode={deleteMode}
        addMode={addMode}
        onToggleFeatured={onToggleFeatured}
        onUploadAvatar={onUploadAvatar}
      />
    );
  }

  const customFields = Object.entries(character.customFields ?? {});
  const characterStats = character.stats ?? [];
  const hasDeleteAction = !!onRemove && deleteMode;
  const avatarMedia = characterPicture ?? character.avatarPath ?? null;
  const showAppearance = !!(character.appearance || onUpdate);
  const showOutfit = !!(character.outfit || onUpdate);
  const showThoughts = !!(character.thoughts || onUpdate);
  const hasDetailRows = showAppearance || showOutfit || showThoughts;
  const hasDenseContent = characterStats.length > 0 || customFields.length > 0;
  const avatarSize = hasDenseContent ? "w-[clamp(2rem,24%,2.625rem)]" : "w-[clamp(2.25rem,30%,3rem)]";
  const updateCustomField = (oldName: string, nextName: string, nextValue: string) => {
    if (!onUpdate) return;
    const nextFields = { ...(character.customFields ?? {}) };
    const trimmedName = nextName.trim();
    if (trimmedName && trimmedName !== oldName && Object.prototype.hasOwnProperty.call(nextFields, trimmedName)) {
      return;
    }
    delete nextFields[oldName];
    if (trimmedName) nextFields[trimmedName] = nextValue;
    onUpdate({ ...character, customFields: nextFields });
  };
  const addCharacterStat = () => {
    if (!onUpdate) return;
    onUpdate({
      ...character,
      stats: [...characterStats, { name: "New Stat", value: 0, max: 100, color: "var(--primary)" }],
    });
  };
  return (
    <article
      className="group/character @container relative isolate min-w-0 overflow-hidden rounded-md border border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-frame)] p-0.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-colors duration-200 hover:border-[var(--primary)]/28 [background-blend-mode:var(--tracker-profile-frame-blend)]"
      style={getCharacterAmbienceStyle(character, profileColors)}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_4%,transparent),transparent_46%,color-mix(in_srgb,var(--tracker-profile-accent)_6%,transparent))]" />
      <TrackerProfileDisplayWash className="z-0" />
      <TrackerReadabilityVeil strength={hasDenseContent || hasDetailRows ? "strong" : "soft"} />
      <TrackerProfileEdgeHighlight className="z-[2]" />
      {hasDeleteAction && (
        <div className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            title="Remove character"
          >
            <X size="0.6875rem" />
          </button>
        </div>
      )}

      <div className={cn("relative z-[1] flex items-start gap-1 @min-[176px]:gap-1.5", hasDeleteAction && "pr-7")}>
        <div className={cn("relative shrink-0", avatarSize)}>
          <button
            type="button"
            onClick={onUploadAvatar}
            disabled={!onUploadAvatar}
            title={avatarMedia ? "Change avatar" : "Upload avatar"}
            aria-label={
              avatarMedia
                ? `Change ${visibleText(character.name, "character")} avatar`
                : `Upload ${visibleText(character.name, "character")} avatar`
            }
            className={cn(
              "group/avatar relative flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--muted)] text-xs text-[var(--foreground)] shadow-[0_0_8px_var(--tracker-profile-dialogue-glow)] ring-1 ring-[var(--tracker-profile-dialogue-border)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]",
              onUploadAvatar && "cursor-pointer hover:ring-[var(--primary)]/36 active:scale-95",
              !onUploadAvatar && "cursor-default",
            )}
          >
            {avatarMedia ? (
              <img src={avatarMedia} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <span className="text-xs leading-none">{character.emoji || "?"}</span>
            )}
            {onUploadAvatar && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--background)]/48 text-[var(--tracker-profile-icon)] opacity-0 backdrop-blur-[1px] transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
                <ImagePlus size="0.6875rem" />
              </span>
            )}
          </button>
          {onToggleFeatured && (
            <button
              type="button"
              onClick={onToggleFeatured}
              title="Feature character card"
              aria-label="Feature character card"
              aria-pressed={false}
              className="absolute -left-0.5 -top-0.5 z-[2] flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_42%,transparent)] text-[var(--muted-foreground)]/45 opacity-60 shadow-[0_1px_3px_rgba(0,0,0,0.14)] backdrop-blur-sm transition-all hover:border-[var(--primary)]/24 hover:bg-[var(--primary)]/7 hover:text-[var(--tracker-profile-display-solid)]/72 hover:opacity-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/55 focus-visible:opacity-100 active:scale-95"
            >
              <Maximize2 size="0.5625rem" />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {onUpdate ? (
            <InlineEdit
              value={character.name}
              onSave={(name) => onUpdate({ ...character, name: name || "Character" })}
              placeholder="Character"
              className="h-4 w-full min-w-0 overflow-hidden px-0.5 py-0 text-[0.6875rem] font-semibold leading-4 text-[color:var(--tracker-profile-text)] @min-[176px]:h-5 @min-[176px]:text-xs @min-[176px]:leading-5"
              showEditHint={false}
              fitPreview
              fitMinScale={0.58}
            />
          ) : (
            <FittedText
              className="w-full text-[0.6875rem] font-semibold leading-4 text-[color:var(--tracker-profile-text)] @min-[176px]:text-xs @min-[176px]:leading-5"
              title={visibleText(character.name, "Character")}
              minScale={0.58}
            >
              {visibleText(character.name, "Character")}
            </FittedText>
          )}
          {(character.mood || onUpdate) && (
            <div className="mt-0.5 grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-0.5 @min-[176px]:grid-cols-[0.875rem_minmax(0,1fr)]">
              <span
                className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--primary)]/76 @min-[176px]:h-3.5 @min-[176px]:w-3.5"
                aria-label="Mood"
                title="Mood"
              >
                <HeartPulse size="0.625rem" />
              </span>
              {onUpdate ? (
                <InlineEdit
                  value={character.mood}
                  onSave={(mood) => onUpdate({ ...character, mood })}
                  placeholder="Mood"
                  className={cn(
                    "h-3.5 w-full min-w-0 overflow-hidden px-0.5 py-0 text-[0.5625rem] leading-[0.875rem] @min-[176px]:h-4 @min-[176px]:text-[0.625rem] @min-[176px]:leading-4",
                    COMPACT_CHARACTER_MOOD_EDIT_CLASS,
                  )}
                  showEditHint={false}
                  scrollOnHover
                />
              ) : (
                <div
                  className={cn(
                    "truncate text-[0.5625rem] leading-[0.875rem] @min-[176px]:text-[0.625rem] @min-[176px]:leading-4",
                    COMPACT_CHARACTER_MOOD_STATIC_CLASS,
                  )}
                >
                  {character.mood}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {hasDetailRows && (
        <div className="relative z-[1] mt-0.5 grid grid-cols-1 gap-px border-t border-[var(--tracker-profile-rule)] pt-0.5">
          {showAppearance && (
            <CompactCharacterField
              icon={<Eye size="0.6875rem" />}
              accessibleLabel="Look"
              value={character.appearance}
              placeholder="Appearance"
              onSave={onUpdate ? (appearance) => onUpdate({ ...character, appearance: appearance || null }) : undefined}
              tone="appearance"
            />
          )}
          {showOutfit && (
            <CompactCharacterField
              icon={<Shirt size="0.6875rem" />}
              accessibleLabel="Outfit"
              value={character.outfit}
              placeholder="Outfit"
              onSave={onUpdate ? (outfit) => onUpdate({ ...character, outfit: outfit || null }) : undefined}
              tone="outfit"
            />
          )}
          {showThoughts && (
            <CompactCharacterField
              icon={<MessageCircle size="0.6875rem" />}
              accessibleLabel="Thinks"
              value={character.thoughts}
              placeholder="Thoughts"
              onSave={onUpdate ? (thoughts) => onUpdate({ ...character, thoughts: thoughts || null }) : undefined}
              tone="thoughts"
              className="italic"
            />
          )}
        </div>
      )}

      {(characterStats.length > 0 || (onUpdate && addMode)) && (
        <div className="group/statbox relative z-[1] mt-0.5 border-t border-[var(--tracker-profile-rule)] pt-0.5">
          <StatList
            stats={characterStats}
            onUpdate={onUpdate ? (stats) => onUpdate({ ...character, stats }) : undefined}
            onAdd={onUpdate ? addCharacterStat : undefined}
            nameMode="truncate"
            deleteMode={deleteMode}
            addMode={addMode}
          />
        </div>
      )}

      {customFields.length > 0 && (
        <div className="relative z-[1] mt-0.5 grid gap-px border-t border-[var(--tracker-profile-rule)] pt-0.5 text-[0.5625rem] @min-[176px]:text-[0.625rem]">
          {customFields.map(([name, value]) => (
            <div
              key={name}
              className="grid min-w-0 grid-cols-[minmax(2.05rem,0.42fr)_minmax(0,1fr)] items-center gap-0.5 @min-[176px]:grid-cols-[minmax(2.35rem,0.42fr)_minmax(0,1fr)] @min-[176px]:gap-1"
            >
              {onUpdate ? (
                <InlineEdit
                  value={name}
                  onSave={(nextName) => updateCustomField(name, nextName, value)}
                  placeholder="Field"
                  className="min-w-0 px-0.5 py-0 font-medium"
                  scrollOnHover
                />
              ) : (
                <span className="truncate font-medium text-[color:var(--tracker-profile-muted-text)]">{name}</span>
              )}
              {onUpdate ? (
                <InlineEdit
                  value={value}
                  onSave={(nextValue) => updateCustomField(name, name, nextValue)}
                  placeholder="Value"
                  className="min-w-0 px-0.5 py-0"
                  scrollOnHover
                />
              ) : (
                <span className="min-w-0 truncate text-[color:var(--tracker-profile-text)]">{value}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
