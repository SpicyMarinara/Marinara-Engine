// ──────────────────────────────────────────────
// Game: Character Sheet Modal (tabletop-style character sheet)
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Heart,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { cn, getAvatarCropStyle } from "../../lib/utils";

export interface GameCharacterSheetGameCard {
  shortDescription: string;
  class: string;
  abilities: string[];
  strengths: string[];
  weaknesses: string[];
  extra: Record<string, string>;
  rpgStats?: {
    attributes: Array<{ name: string; value: number }>;
    hp: { value: number; max: number };
  };
}

export interface CharacterSheetCard {
  title: string;
  subtitle?: string;
  mood?: string;
  status?: string;
  level?: number;
  avatarUrl?: string | null;
  avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
  stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
  inventory?: Array<{ name: string; quantity?: number; location?: string }>;
  customFields?: Record<string, string>;
  gameCard?: GameCharacterSheetGameCard;
}

interface GameCharacterSheetProps {
  card: CharacterSheetCard;
  onClose: () => void;
  onSave?: (gameCard: GameCharacterSheetGameCard | undefined) => Promise<void> | void;
  onRegenerate?: () => Promise<void> | void;
  isRegenerating?: boolean;
}

interface GameCardDraft {
  shortDescription: string;
  class: string;
  abilities: string[];
  strengths: string[];
  weaknesses: string[];
  extraEntries: Array<{ key: string; value: string }>;
  rpgStatsEnabled: boolean;
  attributes: Array<{ name: string; value: number }>;
  hpValue: number;
  hpMax: number;
}

type DraftListField = "abilities" | "strengths" | "weaknesses";

const DEFAULT_ATTRIBUTES = [
  { name: "STR", value: 10 },
  { name: "DEX", value: 10 },
  { name: "CON", value: 10 },
  { name: "INT", value: 10 },
  { name: "WIS", value: 10 },
  { name: "CHA", value: 10 },
];

// Mirrors server's attributeModifier in skill-check.service.ts: floor((score - 10) / 2).
function formatAttributeModifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

const FIELD_LABEL_CLASS = "text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]";
const TEXT_INPUT_CLASS =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/40";
const NUMBER_INPUT_CLASS =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-2.5 py-1.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/40";

function normalizeTextValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeNumberValue(value: unknown, fallback: number) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeDraftListSource(value: unknown) {
  const entries = Array.isArray(value) ? value.map((entry) => normalizeTextValue(entry).trim()).filter(Boolean) : [];
  return entries.length > 0 ? entries : [""];
}

function normalizeDraftExtraEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ key: "", value: "" }];
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => ({
      key: normalizeTextValue(key).trim(),
      value: normalizeTextValue(entryValue).trim(),
    }))
    .filter((entry) => entry.key || entry.value);

  return entries.length > 0 ? entries : [{ key: "", value: "" }];
}

function normalizeDraftAttributes(value: unknown) {
  if (!Array.isArray(value)) {
    return DEFAULT_ATTRIBUTES.map((attr) => ({ ...attr }));
  }

  const entries = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const name = normalizeTextValue(raw.name).trim();
      if (!name) return null;
      return {
        name,
        value: normalizeNumberValue(raw.value, 0),
      };
    })
    .filter((entry): entry is { name: string; value: number } => !!entry);

  return entries;
}

function createDraft(gameCard?: GameCharacterSheetGameCard): GameCardDraft {
  // Stored sheets can contain AI-generated or legacy values, so coerce them before binding to form inputs.
  const rawGameCard = gameCard as (Record<string, unknown> & { rpgStats?: Record<string, unknown> }) | undefined;
  const rawRpgStats =
    rawGameCard?.rpgStats && typeof rawGameCard.rpgStats === "object" && !Array.isArray(rawGameCard.rpgStats)
      ? rawGameCard.rpgStats
      : undefined;
  const rawHp =
    rawRpgStats?.hp && typeof rawRpgStats.hp === "object" && !Array.isArray(rawRpgStats.hp)
      ? (rawRpgStats.hp as Record<string, unknown>)
      : undefined;

  return {
    shortDescription: normalizeTextValue(rawGameCard?.shortDescription).trim(),
    class: normalizeTextValue(rawGameCard?.class).trim(),
    abilities: normalizeDraftListSource(rawGameCard?.abilities),
    strengths: normalizeDraftListSource(rawGameCard?.strengths),
    weaknesses: normalizeDraftListSource(rawGameCard?.weaknesses),
    extraEntries: normalizeDraftExtraEntries(rawGameCard?.extra),
    rpgStatsEnabled: !!rawRpgStats,
    attributes: normalizeDraftAttributes(rawRpgStats?.attributes),
    hpValue: normalizeNumberValue(rawHp?.value, 100),
    hpMax: Math.max(1, normalizeNumberValue(rawHp?.max, 100)),
  };
}

function normalizeList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeExtraEntries(entries: Array<{ key: string; value: string }>) {
  const next: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value.trim();
    if (!key || !value) continue;
    next[key] = value;
  }
  return next;
}

function normalizeDraft(draft: GameCardDraft): GameCharacterSheetGameCard | undefined {
  const extra = normalizeExtraEntries(draft.extraEntries);
  const abilities = normalizeList(draft.abilities);
  const strengths = normalizeList(draft.strengths);
  const weaknesses = normalizeList(draft.weaknesses);
  const shortDescription = draft.shortDescription.trim();
  const charClass = draft.class.trim();
  const attributes = draft.attributes
    .map((attr) => ({
      name: attr.name.trim(),
      value: Number.isFinite(attr.value) ? attr.value : 0,
    }))
    .filter((attr) => attr.name);

  const rpgStats = draft.rpgStatsEnabled
    ? {
        attributes,
        hp: {
          value: Math.max(0, draft.hpValue),
          max: Math.max(1, draft.hpMax),
        },
      }
    : undefined;

  const hasContent =
    !!shortDescription ||
    !!charClass ||
    abilities.length > 0 ||
    strengths.length > 0 ||
    weaknesses.length > 0 ||
    Object.keys(extra).length > 0 ||
    !!rpgStats;

  if (!hasContent) return undefined;

  return {
    shortDescription,
    class: charClass,
    abilities,
    strengths,
    weaknesses,
    extra,
    ...(rpgStats ? { rpgStats } : {}),
  };
}

function hasGameData(gameCard?: GameCharacterSheetGameCard) {
  if (!gameCard) return false;
  return (
    !!gameCard.class ||
    !!gameCard.shortDescription ||
    gameCard.abilities.length > 0 ||
    gameCard.strengths.length > 0 ||
    gameCard.weaknesses.length > 0 ||
    Object.keys(gameCard.extra).length > 0
  );
}

function SectionHeader({ icon, title, className }: { icon: React.ReactNode; title: string; className?: string }) {
  return (
    <div
      className={cn(
        "mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider",
        className,
      )}
    >
      {icon}
      <span>{title}</span>
    </div>
  );
}

export function GameCharacterSheet({
  card,
  onClose,
  onSave,
  onRegenerate,
  isRegenerating = false,
}: GameCharacterSheetProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<GameCardDraft>(() => createDraft(card.gameCard));

  useEffect(() => {
    setIsEditing(false);
    setIsSaving(false);
    setDraft(createDraft(card.gameCard));
  }, [card]);

  const previewGameCard = isEditing ? normalizeDraft(draft) : normalizeDraft(createDraft(card.gameCard));
  const hasRpgAttributes =
    previewGameCard?.rpgStats &&
    Array.isArray(previewGameCard.rpgStats.attributes) &&
    previewGameCard.rpgStats.attributes.length > 0;
  const hasRpgHp =
    previewGameCard?.rpgStats?.hp &&
    (Number.isFinite(Number(previewGameCard.rpgStats.hp.value)) ||
      Number.isFinite(Number(previewGameCard.rpgStats.hp.max)));
  const hasRpgStats = Boolean(hasRpgAttributes || hasRpgHp);
  const hasPersistentSheetData = hasGameData(previewGameCard) || hasRpgStats;
  const hasAnyData =
    hasPersistentSheetData ||
    (card.stats?.length ?? 0) > 0 ||
    (card.inventory?.length ?? 0) > 0 ||
    Object.keys(card.customFields ?? {}).length > 0;

  const updateListItem = (field: DraftListField, index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [field]: prev[field].map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  };

  const addListItem = (field: DraftListField) => {
    setDraft((prev) => ({ ...prev, [field]: [...prev[field], ""] }));
  };

  const removeListItem = (field: DraftListField, index: number) => {
    setDraft((prev) => {
      const next = prev[field].filter((_, itemIndex) => itemIndex !== index);
      return { ...prev, [field]: next.length > 0 ? next : [""] };
    });
  };

  const updateExtraEntry = (index: number, field: "key" | "value", value: string) => {
    setDraft((prev) => ({
      ...prev,
      extraEntries: prev.extraEntries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const addExtraEntry = () => {
    setDraft((prev) => ({
      ...prev,
      extraEntries: [...prev.extraEntries, { key: "", value: "" }],
    }));
  };

  const removeExtraEntry = (index: number) => {
    setDraft((prev) => {
      const next = prev.extraEntries.filter((_, entryIndex) => entryIndex !== index);
      return { ...prev, extraEntries: next.length > 0 ? next : [{ key: "", value: "" }] };
    });
  };

  const updateAttribute = (index: number, field: "name" | "value", value: string | number) => {
    setDraft((prev) => ({
      ...prev,
      attributes: prev.attributes.map((attr, attrIndex) =>
        attrIndex === index
          ? {
              ...attr,
              [field]: field === "value" ? Number(value) || 0 : String(value),
            }
          : attr,
      ),
    }));
  };

  const addAttribute = () => {
    setDraft((prev) => ({
      ...prev,
      attributes: [...prev.attributes, { name: "NEW", value: 10 }],
    }));
  };

  const removeAttribute = (index: number) => {
    setDraft((prev) => {
      const next = prev.attributes.filter((_, attrIndex) => attrIndex !== index);
      return { ...prev, attributes: next.length > 0 ? next : DEFAULT_ATTRIBUTES.map((attr) => ({ ...attr })) };
    });
  };

  const handleCancelEdit = () => {
    setDraft(createDraft(card.gameCard));
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!onSave || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(normalizeDraft(draft));
      onClose();
    } catch {
      return;
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!onRegenerate || isSaving || isRegenerating) return;
    await onRegenerate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {(onSave || onRegenerate) && (
          <div className="absolute right-12 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Save size={13} />
                  {isSaving ? "Saving..." : "Save Sheet"}
                </button>
              </>
            ) : (
              <>
                {onRegenerate && (
                  <button
                    onClick={() => void handleRegenerate()}
                    disabled={isRegenerating || isSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
                    title="Regenerate this sheet from character and current game context"
                  >
                    <RefreshCw size={13} className={cn(isRegenerating && "animate-spin")} />
                    {isRegenerating ? "Regenerating..." : "Regenerate Sheet"}
                  </button>
                )}
                {onSave && (
                  <button
                    onClick={() => setIsEditing(true)}
                    disabled={isRegenerating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-60"
                  >
                    <Pencil size={13} />
                    Edit Sheet
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X size={18} />
        </button>

        <div className="relative border-b border-[var(--border)] bg-[var(--secondary)]/50 px-5 py-4">
          <div className="flex items-center gap-4">
            {card.avatarUrl ? (
              <span className="block h-20 w-20 overflow-hidden rounded-xl border-2 border-[var(--border)] shadow-xl">
                <img
                  src={card.avatarUrl}
                  alt={card.title}
                  className="h-full w-full object-cover"
                  style={getAvatarCropStyle(card.avatarCrop)}
                />
              </span>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--secondary)] text-2xl font-bold text-[var(--muted-foreground)]">
                {card.title[0]}
              </div>
            )}
            <div className="min-w-0 flex-1 pr-36 sm:pr-64">
              <h2 className="truncate text-lg font-bold text-[var(--foreground)]">{card.title}</h2>
              {previewGameCard?.class && (
                <p className="text-xs font-medium text-[var(--primary)]">{previewGameCard.class}</p>
              )}
              {previewGameCard?.shortDescription && !previewGameCard.class && (
                <p className="text-xs text-[var(--muted-foreground)]">{previewGameCard.shortDescription}</p>
              )}
              {card.subtitle && !previewGameCard?.class && !previewGameCard?.shortDescription && (
                <p className="text-xs text-[var(--muted-foreground)]">{card.subtitle}</p>
              )}
              {card.mood && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Heart size={11} className="text-rose-400/70" />
                  <span className="text-[0.6875rem] italic text-rose-400/70">{card.mood}</span>
                </div>
              )}
              {card.status && (
                <p className="mt-1 line-clamp-2 text-[0.6875rem] text-[var(--muted-foreground)]">{card.status}</p>
              )}
            </div>
            {card.level != null && (
              <div className="flex items-center gap-1 rounded border border-[var(--primary)]/20 bg-[var(--primary)]/10 px-1.5 py-0.5">
                <span className="text-[0.4375rem] uppercase tracking-wider text-[var(--primary)]/60">LVL</span>
                <span className="text-xs font-bold leading-none text-[var(--primary)]">{card.level}</span>
              </div>
            )}
          </div>
          {previewGameCard?.shortDescription && previewGameCard.class && (
            <p className="mt-2 text-[0.6875rem] italic text-[var(--muted-foreground)]">
              {previewGameCard.shortDescription}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isEditing && (
            <>
              <div className="border-b border-[var(--border)] px-5 py-4">
                <SectionHeader
                  icon={<Pencil size={12} />}
                  title="Sheet Details"
                  className="text-[var(--muted-foreground)]"
                />
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Class</span>
                    <input
                      type="text"
                      value={draft.class}
                      onChange={(e) => setDraft((prev) => ({ ...prev, class: e.target.value }))}
                      placeholder="Class or role"
                      className={TEXT_INPUT_CLASS}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Short Description</span>
                    <textarea
                      value={draft.shortDescription}
                      onChange={(e) => setDraft((prev) => ({ ...prev, shortDescription: e.target.value }))}
                      placeholder="Brief character summary"
                      rows={3}
                      className={cn(TEXT_INPUT_CLASS, "resize-y")}
                    />
                  </label>
                </div>
              </div>

              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <SectionHeader
                    icon={<Shield size={12} />}
                    title="RPG Attributes"
                    className="mb-0 text-[var(--muted-foreground)]"
                  />
                  <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <input
                      type="checkbox"
                      checked={draft.rpgStatsEnabled}
                      onChange={(e) => setDraft((prev) => ({ ...prev, rpgStatsEnabled: e.target.checked }))}
                      className="h-4 w-4 rounded accent-[var(--primary)]"
                    />
                    Enable
                  </label>
                </div>
                {draft.rpgStatsEnabled ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1.5">
                        <span className={FIELD_LABEL_CLASS}>Current HP</span>
                        <input
                          type="number"
                          value={draft.hpValue}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, hpValue: parseInt(e.target.value, 10) || 0 }))
                          }
                          className={NUMBER_INPUT_CLASS}
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={FIELD_LABEL_CLASS}>Max HP</span>
                        <input
                          type="number"
                          value={draft.hpMax}
                          min={1}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, hpMax: Math.max(1, parseInt(e.target.value, 10) || 1) }))
                          }
                          className={NUMBER_INPUT_CLASS}
                        />
                      </label>
                    </div>
                    <div className="space-y-2">
                      {draft.attributes.map((attr, index) => (
                        <div key={`${attr.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
                          <input
                            type="text"
                            value={attr.name}
                            onChange={(e) => updateAttribute(index, "name", e.target.value)}
                            placeholder="STR"
                            className={TEXT_INPUT_CLASS}
                          />
                          <input
                            type="number"
                            value={attr.value}
                            onChange={(e) => updateAttribute(index, "value", parseInt(e.target.value, 10) || 0)}
                            className={NUMBER_INPUT_CLASS}
                          />
                          <button
                            onClick={() => removeAttribute(index)}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-red-400"
                            title="Remove attribute"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={addAttribute}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                      >
                        <Plus size={13} />
                        Add Attribute
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Use this when the sheet should track HP and tabletop-style attributes.
                  </p>
                )}
              </div>

              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <SectionHeader
                    icon={<Zap size={12} />}
                    title="Abilities"
                    className="mb-0 text-[var(--muted-foreground)]"
                  />
                  <button
                    onClick={() => addListItem("abilities")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  >
                    <Plus size={13} />
                    Add
                  </button>
                </div>
                <div className="space-y-2">
                  {draft.abilities.map((ability, index) => (
                    <div key={`ability-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <input
                        type="text"
                        value={ability}
                        onChange={(e) => updateListItem("abilities", index, e.target.value)}
                        placeholder="Dual-wielding, Arcane shield, etc."
                        className={TEXT_INPUT_CLASS}
                      />
                      <button
                        onClick={() => removeListItem("abilities", index)}
                        className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-red-400"
                        title="Remove ability"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <SectionHeader
                        icon={<Target size={11} />}
                        title="Strengths"
                        className="mb-0 text-emerald-500/80"
                      />
                      <button
                        onClick={() => addListItem("strengths")}
                        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {draft.strengths.map((strength, index) => (
                        <div key={`strength-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <input
                            type="text"
                            value={strength}
                            onChange={(e) => updateListItem("strengths", index, e.target.value)}
                            placeholder="Reliable, quick thinker, etc."
                            className={TEXT_INPUT_CLASS}
                          />
                          <button
                            onClick={() => removeListItem("strengths", index)}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-red-400"
                            title="Remove strength"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <SectionHeader
                        icon={<AlertTriangle size={11} />}
                        title="Weaknesses"
                        className="mb-0 text-red-400/80"
                      />
                      <button
                        onClick={() => addListItem("weaknesses")}
                        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {draft.weaknesses.map((weakness, index) => (
                        <div key={`weakness-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <input
                            type="text"
                            value={weakness}
                            onChange={(e) => updateListItem("weaknesses", index, e.target.value)}
                            placeholder="Impulsive, poor swimmer, etc."
                            className={TEXT_INPUT_CLASS}
                          />
                          <button
                            onClick={() => removeListItem("weaknesses", index)}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-red-400"
                            title="Remove weakness"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <SectionHeader
                    icon={<Info size={12} />}
                    title="Details"
                    className="mb-0 text-[var(--muted-foreground)]"
                  />
                  <button
                    onClick={addExtraEntry}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  >
                    <Plus size={13} />
                    Add Detail
                  </button>
                </div>
                <p className="mb-3 text-[0.6875rem] text-[var(--muted-foreground)]">
                  Add custom details like Skills, Weapon, Element, Specialty, or Faction.
                </p>
                <div className="space-y-2">
                  {draft.extraEntries.map((entry, index) => (
                    <div
                      key={`extra-${index}`}
                      className="grid grid-cols-[10rem_minmax(0,1fr)_auto] gap-2 max-sm:grid-cols-1"
                    >
                      <input
                        type="text"
                        value={entry.key}
                        onChange={(e) => updateExtraEntry(index, "key", e.target.value)}
                        placeholder="Skills"
                        className={TEXT_INPUT_CLASS}
                      />
                      <input
                        type="text"
                        value={entry.value}
                        onChange={(e) => updateExtraEntry(index, "value", e.target.value)}
                        placeholder="Lockpicking, survival, marksmanship"
                        className={TEXT_INPUT_CLASS}
                      />
                      <button
                        onClick={() => removeExtraEntry(index)}
                        className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-red-400 max-sm:h-10"
                        title="Remove detail"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!isEditing && hasRpgStats && previewGameCard?.rpgStats && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader
                icon={<Shield size={12} />}
                title="Attributes"
                className="text-[var(--muted-foreground)]"
              />
              {hasRpgAttributes && (
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {previewGameCard.rpgStats.attributes.map((attr) => (
                    <div
                      key={attr.name}
                      className="flex flex-col items-center rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 px-2 py-1.5"
                    >
                      <span className="text-[0.5625rem] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                        {attr.name}
                      </span>
                      <span className="text-lg font-bold leading-tight text-[var(--foreground)]">{attr.value}</span>
                      <span className="text-[0.625rem] font-mono leading-none text-[var(--muted-foreground)]">
                        {formatAttributeModifier(attr.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {hasRpgHp &&
                (() => {
                  const hpMax = Math.max(1, Number(previewGameCard.rpgStats.hp.max) || 1);
                  const hpValue = Math.max(0, Math.min(hpMax, Number(previewGameCard.rpgStats.hp.value) || 0));
                  return (
                    <div>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--foreground)]/80">HP</span>
                        <span className="font-mono text-[var(--muted-foreground)]">
                          {hpValue}/{hpMax}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--secondary)] ring-1 ring-[var(--border)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(hpValue / hpMax) * 100}%`,
                            background: "#ef4444",
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}

          {card.stats && card.stats.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader icon={<Shield size={12} />} title="Stats" className="text-[var(--muted-foreground)]" />
              <div className="space-y-2">
                {card.stats.map((stat) => {
                  const max = Math.max(1, stat.max ?? 100);
                  const value = Math.max(0, Math.min(max, stat.value));
                  const width = (value / max) * 100;
                  return (
                    <div key={stat.name}>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--foreground)]/80">{stat.name}</span>
                        <span className="font-mono text-[var(--muted-foreground)]">
                          {value}/{max}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--secondary)] ring-1 ring-[var(--border)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${width}%`,
                            background: stat.color || "var(--primary)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isEditing && previewGameCard && previewGameCard.abilities.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader icon={<Zap size={12} />} title="Abilities" className="text-[var(--muted-foreground)]" />
              <div className="space-y-1">
                {previewGameCard.abilities.map((ability, index) => (
                  <div
                    key={`${ability}-${index}`}
                    className="rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]/80"
                  >
                    {ability}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isEditing &&
            previewGameCard &&
            (previewGameCard.strengths.length > 0 || previewGameCard.weaknesses.length > 0) && (
              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  {previewGameCard.strengths.length > 0 && (
                    <div>
                      <SectionHeader icon={<Target size={11} />} title="Strengths" className="text-emerald-500/80" />
                      <div className="space-y-0.5">
                        {previewGameCard.strengths.map((strength, index) => (
                          <div key={`${strength}-${index}`} className="text-[0.6875rem] text-[var(--foreground)]/70">
                            • {strength}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {previewGameCard.weaknesses.length > 0 && (
                    <div>
                      <SectionHeader
                        icon={<AlertTriangle size={11} />}
                        title="Weaknesses"
                        className="text-red-400/80"
                      />
                      <div className="space-y-0.5">
                        {previewGameCard.weaknesses.map((weakness, index) => (
                          <div key={`${weakness}-${index}`} className="text-[0.6875rem] text-[var(--foreground)]/70">
                            • {weakness}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          {!isEditing && previewGameCard && Object.keys(previewGameCard.extra).length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader icon={<Info size={12} />} title="Details" className="text-[var(--muted-foreground)]" />
              <div className="space-y-1.5 text-xs">
                {Object.entries(previewGameCard.extra).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="shrink-0 capitalize text-[var(--muted-foreground)]">
                      {key.replaceAll("_", " ")}
                    </span>
                    <span className="text-right text-[var(--foreground)]/80">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {card.inventory && card.inventory.length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader icon={<Swords size={12} />} title="Inventory" className="text-[var(--muted-foreground)]" />
              <div className="space-y-1">
                {card.inventory.map((item) => (
                  <div
                    key={`${item.name}-${item.location ?? "bag"}`}
                    className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--foreground)]/80">{item.name}</span>
                      {item.location && (
                        <span className="rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                          {item.location}
                        </span>
                      )}
                    </div>
                    {item.quantity != null && item.quantity > 1 && (
                      <span className="font-mono text-[var(--muted-foreground)]">x{item.quantity}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {card.customFields && Object.keys(card.customFields).length > 0 && (
            <div className="border-b border-[var(--border)] px-5 py-4">
              <SectionHeader icon={<Sparkles size={12} />} title="Traits" className="text-[var(--muted-foreground)]" />
              <div className="space-y-1.5 text-xs">
                {Object.entries(card.customFields).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="shrink-0 text-[var(--muted-foreground)]">{key}</span>
                    <span className="text-right text-[var(--foreground)]/80">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isEditing && !hasAnyData && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                Character data will populate as the story progresses.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
