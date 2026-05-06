import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  CloudSun,
  ImagePlus,
  MapPin,
  Package,
  Pencil,
  Plus,
  Scroll,
  Sparkles,
  SlidersHorizontal,
  Swords,
  Target,
  Thermometer,
  Users,
  X,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { useAgentConfigs, useUpdateAgent, type AgentConfigRow } from "../../hooks/use-agents";
import type {
  CharacterStat,
  CustomTrackerField,
  InventoryItem,
  PresentCharacter,
  QuestProgress,
} from "@marinara-engine/shared";

interface CombinedPlayerPanelProps {
  showPersona: boolean;
  showCharacters: boolean;
  showQuests: boolean;
  showCustomTracker: boolean;
  personaStats: CharacterStat[];
  onUpdatePersonaStats: (bars: CharacterStat[]) => void;
  personaStatus?: string;
  onUpdatePersonaStatus?: (status: string) => void;
  characters: PresentCharacter[];
  onUpdateCharacters: (chars: PresentCharacter[]) => void;
  inventory: InventoryItem[];
  onUpdateInventory: (items: InventoryItem[]) => void;
  quests: QuestProgress[];
  onUpdateQuests: (quests: QuestProgress[]) => void;
  customTrackerFields: CustomTrackerField[];
  onUpdateCustomTracker: (fields: CustomTrackerField[]) => void;
  onClose: () => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

function TrackerSectionRefresh({
  agentType,
  onRerunSingleTracker,
  busy,
  title,
}: {
  agentType: string;
  onRerunSingleTracker?: (agentType: string) => void;
  busy?: boolean;
  /** Tooltip when hovering the refresh control */
  title?: string;
}) {
  if (!onRerunSingleTracker) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onRerunSingleTracker(agentType);
      }}
      disabled={busy}
      title={title ?? `Re-run ${agentType} only`}
      className="rounded p-0.5 text-[var(--muted-foreground)]/50 transition-colors hover:bg-[var(--accent)] hover:text-purple-300 disabled:opacity-40"
    >
      <RefreshCw size="0.625rem" className={busy ? "animate-spin" : ""} />
    </button>
  );
}

const EMPTY_STATE = "text-[0.625rem] text-[var(--muted-foreground)]/60 text-center py-1";

export function CombinedPlayerPanel({
  showPersona,
  showCharacters,
  showQuests,
  showCustomTracker,
  personaStats,
  onUpdatePersonaStats,
  personaStatus = "",
  onUpdatePersonaStatus,
  characters,
  onUpdateCharacters,
  inventory,
  onUpdateInventory,
  quests,
  onUpdateQuests,
  customTrackerFields,
  onUpdateCustomTracker,
  onClose,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CombinedPlayerPanelProps) {
  const updateBar = (idx: number, field: "value" | "max" | "name", val: number | string) => {
    const next = [...personaStats];
    next[idx] = { ...next[idx]!, [field]: val };
    onUpdatePersonaStats(next);
  };

  const addCharacter = () => {
    onUpdateCharacters([
      ...characters,
      {
        characterId: `manual-${Date.now()}`,
        name: "New Character",
        emoji: "👤",
        mood: "",
        appearance: null,
        outfit: null,
        customFields: {},
        stats: [],
        thoughts: null,
      },
    ]);
  };
  const removeCharacter = (idx: number) => onUpdateCharacters(characters.filter((_, i) => i !== idx));
  const updateCharacter = (idx: number, updated: PresentCharacter) => {
    const next = [...characters];
    next[idx] = updated;
    onUpdateCharacters(next);
  };

  const addItem = () => {
    onUpdateInventory([...inventory, { name: "New Item", description: "", quantity: 1, location: "on_person" }]);
  };
  const removeItem = (idx: number) => onUpdateInventory(inventory.filter((_, i) => i !== idx));
  const updateItem = (idx: number, updated: InventoryItem) => {
    const next = [...inventory];
    next[idx] = updated;
    onUpdateInventory(next);
  };

  const addQuest = () => {
    onUpdateQuests([
      ...quests,
      {
        questEntryId: `manual-${Date.now()}`,
        name: "New Quest",
        currentStage: 0,
        objectives: [{ text: "Objective 1", completed: false }],
        completed: false,
      },
    ]);
  };
  const removeQuest = (idx: number) => onUpdateQuests(quests.filter((_, i) => i !== idx));
  const updateQuest = (idx: number, updated: QuestProgress) => {
    const next = [...quests];
    next[idx] = updated;
    onUpdateQuests(next);
  };

  const addCustomField = () => {
    onUpdateCustomTracker([...customTrackerFields, { name: "New Field", value: "" }]);
  };
  const removeCustomField = (idx: number) => onUpdateCustomTracker(customTrackerFields.filter((_, i) => i !== idx));
  const updateCustomField = (idx: number, updated: CustomTrackerField) => {
    const next = [...customTrackerFields];
    next[idx] = updated;
    onUpdateCustomTracker(next);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <Swords size="0.625rem" /> Trackers
        </span>
        <button
          onClick={onClose}
          className="text-[var(--muted-foreground)]/50 hover:text-[var(--foreground)] transition-colors"
        >
          <X size="0.75rem" />
        </button>
      </div>
      <div className="overflow-y-auto max-h-[min(calc(75vh-2rem),30rem)] divide-y divide-[var(--border)]">
        {showPersona && (
          <div className="p-2">
            <PersonaStatusField value={personaStatus} onSave={onUpdatePersonaStatus} />
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[0.625rem] font-semibold text-violet-300/70 uppercase tracking-wider">
                Persona Stats
              </span>
              <TrackerSectionRefresh
                agentType="persona-stats"
                onRerunSingleTracker={onRerunSingleTracker}
                busy={isTrackerRetryBusy}
                title="Re-run persona tracker (stats + inventory)"
              />
            </div>
            <div className="space-y-2">
              {personaStats.length === 0 && <div className={EMPTY_STATE}>No stats tracked</div>}
              {personaStats.map((bar, idx) => (
                <StatBarEditable
                  key={bar.name}
                  stat={bar}
                  onUpdateName={(name) => updateBar(idx, "name", name)}
                  onUpdateValue={(value) => updateBar(idx, "value", value)}
                  onUpdateMax={(value) => updateBar(idx, "max", value)}
                />
              ))}
            </div>
          </div>
        )}

        {showCharacters && (
          <div className="p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[0.625rem] font-semibold text-purple-300/70 uppercase tracking-wider flex items-center gap-1">
                <Users size="0.5625rem" /> Characters ({characters.length})
              </span>
              <span className="flex items-center gap-1">
                <TrackerSectionRefresh
                  agentType="character-tracker"
                  onRerunSingleTracker={onRerunSingleTracker}
                  busy={isTrackerRetryBusy}
                  title="Re-run character tracker only"
                />
                <button
                  onClick={addCharacter}
                  className="flex items-center gap-0.5 text-[0.625rem] text-purple-400 hover:text-purple-300 transition-colors"
                >
                  <Plus size="0.625rem" /> Add
                </button>
              </span>
            </div>
            <div className="space-y-2">
              {characters.length === 0 && <div className={EMPTY_STATE}>No characters in scene</div>}
              {characters.map((char, idx) => (
                <div key={char.characterId ?? idx} className="rounded-lg bg-[var(--muted)]/20 p-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <InlineEdit
                      value={char.emoji || "👤"}
                      onSave={(value) => updateCharacter(idx, { ...char, emoji: value })}
                      className="w-8 text-center !text-sm"
                    />
                    <InlineEdit
                      value={char.name}
                      onSave={(value) => updateCharacter(idx, { ...char, name: value })}
                      className="flex-1 !font-medium"
                      placeholder="Name"
                    />
                    <button
                      onClick={() => removeCharacter(idx)}
                      className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
                      title="Remove character"
                    >
                      <X size="0.625rem" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pl-1">
                    <LabeledEdit
                      label="Mood"
                      value={char.mood}
                      onSave={(value) => updateCharacter(idx, { ...char, mood: value })}
                    />
                    <LabeledEdit
                      label="Look"
                      value={char.appearance ?? ""}
                      onSave={(value) => updateCharacter(idx, { ...char, appearance: value || null })}
                    />
                    <LabeledEdit
                      label="Outfit"
                      value={char.outfit ?? ""}
                      onSave={(value) => updateCharacter(idx, { ...char, outfit: value || null })}
                    />
                    <LabeledEdit
                      label="Thinks"
                      value={char.thoughts ?? ""}
                      onSave={(value) => updateCharacter(idx, { ...char, thoughts: value || null })}
                    />
                  </div>
                  {char.stats?.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-[var(--border)]">
                      {char.stats.map((stat, statIndex) => (
                        <StatBarEditable
                          key={stat.name}
                          stat={stat}
                          onUpdateValue={(value) => {
                            const next = [...(char.stats ?? [])];
                            next[statIndex] = { ...next[statIndex]!, value };
                            updateCharacter(idx, { ...char, stats: next });
                          }}
                          onUpdateMax={(value) => {
                            const next = [...(char.stats ?? [])];
                            next[statIndex] = { ...next[statIndex]!, max: value };
                            updateCharacter(idx, { ...char, stats: next });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {showPersona && (
          <div className="p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[0.625rem] font-semibold text-amber-300/70 uppercase tracking-wider flex items-center gap-1">
                <Package size="0.5625rem" /> Inventory ({inventory.length})
              </span>
              <button
                onClick={addItem}
                className="flex items-center gap-0.5 text-[0.625rem] text-amber-400 hover:text-amber-300 transition-colors"
              >
                <Plus size="0.625rem" /> Add
              </button>
            </div>
            <div className="space-y-1">
              {inventory.length === 0 && <div className={EMPTY_STATE}>Inventory empty</div>}
              {inventory.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
                  <Package size="0.625rem" className="shrink-0 text-amber-400/60" />
                  <InlineEdit
                    value={item.name}
                    onSave={(value) => updateItem(idx, { ...item, name: value })}
                    className="flex-1"
                    placeholder="Item name"
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { ...item, quantity: Math.max(0, Number(e.target.value)) })}
                    className="w-8 bg-transparent text-center text-[0.5625rem] text-[var(--foreground)]/60 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title="Quantity"
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
                    title="Remove item"
                  >
                    <X size="0.5625rem" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {showQuests && (
          <div className="p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[0.625rem] font-semibold text-emerald-300/70 uppercase tracking-wider flex items-center gap-1">
                <Scroll size="0.5625rem" /> Quests ({quests.length})
              </span>
              <span className="flex items-center gap-1">
                <TrackerSectionRefresh
                  agentType="quest"
                  onRerunSingleTracker={onRerunSingleTracker}
                  busy={isTrackerRetryBusy}
                  title="Re-run quest tracker only"
                />
                <button
                  onClick={addQuest}
                  className="flex items-center gap-0.5 text-[0.625rem] text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <Plus size="0.625rem" /> Add
                </button>
              </span>
            </div>
            <div className="space-y-2">
              {quests.length === 0 && <div className={EMPTY_STATE}>No active quests</div>}
              {quests.map((quest, idx) => (
                <QuestCardEditable
                  key={quest.questEntryId || idx}
                  quest={quest}
                  onUpdate={(updatedQuest) => updateQuest(idx, updatedQuest)}
                  onRemove={() => removeQuest(idx)}
                />
              ))}
            </div>
          </div>
        )}

        {showCustomTracker && (
          <div className="p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[0.625rem] font-semibold text-cyan-300/70 uppercase tracking-wider flex items-center gap-1">
                <SlidersHorizontal size="0.5625rem" /> Custom ({customTrackerFields.length})
              </span>
              <span className="flex items-center gap-1">
                <TrackerSectionRefresh
                  agentType="custom-tracker"
                  onRerunSingleTracker={onRerunSingleTracker}
                  busy={isTrackerRetryBusy}
                  title="Re-run custom tracker only"
                />
                <button
                  onClick={addCustomField}
                  className="flex items-center gap-0.5 text-[0.625rem] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <Plus size="0.625rem" /> Add
                </button>
              </span>
            </div>
            <div className="space-y-1">
              {customTrackerFields.length === 0 && <div className={EMPTY_STATE}>No fields tracked</div>}
              {customTrackerFields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
                  <SlidersHorizontal size="0.625rem" className="shrink-0 text-cyan-400/60" />
                  <InlineEdit
                    value={field.name}
                    onSave={(value) => updateCustomField(idx, { ...field, name: value })}
                    className="flex-1 min-w-0"
                    placeholder="Field name"
                  />
                  <span className="text-[var(--muted-foreground)]/40 text-[0.5rem]">=</span>
                  <InlineEdit
                    value={field.value}
                    onSave={(value) => updateCustomField(idx, { ...field, value })}
                    className="flex-1 min-w-0"
                    placeholder="Value"
                  />
                  <button
                    onClick={() => removeCustomField(idx)}
                    className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
                    title="Remove field"
                  >
                    <X size="0.5625rem" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface PersonaStatsPanelProps {
  bars: CharacterStat[];
  onUpdate: (bars: CharacterStat[]) => void;
  status?: string;
  onUpdateStatus?: (status: string) => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

export function PersonaStatsPanel({
  bars,
  onUpdate,
  status = "",
  onUpdateStatus,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: PersonaStatsPanelProps) {
  const updateBar = (idx: number, field: "value" | "max" | "name", val: number | string) => {
    const next = [...bars];
    next[idx] = { ...next[idx]!, [field]: val };
    onUpdate(next);
  };

  return (
    <>
      <div className="border-b border-[var(--border)] p-2">
        <PersonaStatusField value={status} onSave={onUpdateStatus} />
      </div>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          Persona Stats
        </span>
        <TrackerSectionRefresh
          agentType="persona-stats"
          onRerunSingleTracker={onRerunSingleTracker}
          busy={isTrackerRetryBusy}
          title="Re-run persona tracker (stats + inventory)"
        />
      </div>
      <div className="p-2 space-y-2">
        {bars.map((bar, idx) => (
          <StatBarEditable
            key={bar.name}
            stat={bar}
            onUpdateName={(name) => updateBar(idx, "name", name)}
            onUpdateValue={(value) => updateBar(idx, "value", value)}
            onUpdateMax={(value) => updateBar(idx, "max", value)}
          />
        ))}
      </div>
    </>
  );
}

interface CharactersPanelProps {
  characters: PresentCharacter[];
  onUpdate: (chars: PresentCharacter[]) => void;
  chatId?: string;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

export function CharactersPanel({
  characters,
  onUpdate,
  chatId,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CharactersPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadIdx, setUploadIdx] = useState<number | null>(null);

  // ── Auto-generate toggle ──
  const { data: agentConfigs } = useAgentConfigs();
  const updateAgent = useUpdateAgent();
  const trackerConfig = useMemo(() => {
    if (!agentConfigs) return null;
    return (agentConfigs as AgentConfigRow[]).find((a) => a.type === "character-tracker") ?? null;
  }, [agentConfigs]);
  const trackerSettings = useMemo(() => {
    if (!trackerConfig?.settings) return {} as Record<string, unknown>;
    try {
      return typeof trackerConfig.settings === "string" ? JSON.parse(trackerConfig.settings) : trackerConfig.settings;
    } catch {
      return {} as Record<string, unknown>;
    }
  }, [trackerConfig]);
  const autoGenEnabled = !!(trackerSettings as Record<string, unknown>).autoGenerateAvatars;
  const toggleAutoGenerate = useCallback(() => {
    if (!trackerConfig) return;
    const newVal = !autoGenEnabled;
    const { autoGenerateAvatars: _, ...rest } = trackerSettings as Record<string, unknown>;
    const newSettings = newVal ? { ...rest, autoGenerateAvatars: true } : rest;
    updateAgent.mutate({ id: trackerConfig.id, settings: newSettings });
  }, [trackerConfig, autoGenEnabled, trackerSettings, updateAgent]);

  const handleAvatarUpload = useCallback(
    async (idx: number, file: File) => {
      const char = characters[idx];
      if (!char || !chatId) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        try {
          const res = await api.post<{ avatarPath: string }>(`/avatars/npc/${chatId}`, {
            name: char.name,
            avatar: dataUrl,
          });
          const next = [...characters];
          next[idx] = { ...char, avatarPath: res.avatarPath };
          onUpdate(next);
        } catch {
          // silently fail
        }
      };
      reader.readAsDataURL(file);
    },
    [characters, chatId, onUpdate],
  );

  const addCharacter = () => {
    onUpdate([
      ...characters,
      {
        characterId: `manual-${Date.now()}`,
        name: "New Character",
        emoji: "👤",
        mood: "",
        appearance: null,
        outfit: null,
        customFields: {},
        stats: [],
        thoughts: null,
      },
    ]);
  };

  const removeCharacter = (idx: number) => {
    onUpdate(characters.filter((_, i) => i !== idx));
  };

  const updateCharacter = (idx: number, updated: PresentCharacter) => {
    const next = [...characters];
    next[idx] = updated;
    onUpdate(next);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <Users size="0.625rem" /> Present Characters
        </span>
        <div className="flex items-center gap-2">
          <TrackerSectionRefresh
            agentType="character-tracker"
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run character tracker only"
          />
          {trackerConfig && (
            <button
              onClick={toggleAutoGenerate}
              className={cn(
                "flex items-center gap-1 text-[0.5625rem] transition-colors",
                autoGenEnabled
                  ? "text-purple-400"
                  : "text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]",
              )}
              title={autoGenEnabled ? "Auto-generate avatars: ON" : "Auto-generate avatars: OFF"}
            >
              <Sparkles size="0.5625rem" />
              <span className="hidden sm:inline">Auto</span>
            </button>
          )}
          <button
            onClick={addCharacter}
            className="flex items-center gap-0.5 text-[0.625rem] text-purple-400 hover:text-purple-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </div>
      </div>
      <div className="p-2 space-y-2">
        {characters.length === 0 && <div className={cn(EMPTY_STATE, "py-2")}>No characters in scene</div>}
        {characters.map((char, idx) => (
          <div key={char.characterId ?? idx} className="rounded-lg bg-[var(--muted)]/20 p-2 space-y-1">
            <div className="flex items-center gap-1.5">
              {/* Avatar circle or emoji fallback */}
              {char.avatarPath ? (
                <button
                  onClick={() => {
                    setUploadIdx(idx);
                    fileInputRef.current?.click();
                  }}
                  className="shrink-0 rounded-full overflow-hidden ring-1 ring-purple-400/40 hover:ring-purple-400/80 transition-all"
                  title="Change avatar"
                >
                  <img src={char.avatarPath} alt={char.name} className="w-8 h-8 object-cover" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setUploadIdx(idx);
                    fileInputRef.current?.click();
                  }}
                  className="shrink-0 w-8 h-8 rounded-full bg-[var(--muted)]/30 flex items-center justify-center text-[var(--muted-foreground)]/50 hover:text-purple-400 hover:bg-[var(--muted)]/50 transition-all ring-1 ring-[var(--border)]"
                  title="Upload avatar"
                >
                  <ImagePlus size="0.75rem" />
                </button>
              )}
              <InlineEdit
                value={char.name}
                onSave={(value) => updateCharacter(idx, { ...char, name: value })}
                className="flex-1 !font-medium"
                placeholder="Name"
              />
              <button
                onClick={() => removeCharacter(idx)}
                className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
                title="Remove character"
              >
                <X size="0.625rem" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pl-1">
              <LabeledEdit
                label="Mood"
                value={char.mood}
                onSave={(value) => updateCharacter(idx, { ...char, mood: value })}
              />
              <LabeledEdit
                label="Look"
                value={char.appearance ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, appearance: value || null })}
              />
              <LabeledEdit
                label="Outfit"
                value={char.outfit ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, outfit: value || null })}
              />
              <LabeledEdit
                label="Thinks"
                value={char.thoughts ?? ""}
                onSave={(value) => updateCharacter(idx, { ...char, thoughts: value || null })}
              />
            </div>
            {char.stats?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-[var(--border)]">
                {char.stats.map((stat, statIndex) => (
                  <StatBarEditable
                    key={stat.name}
                    stat={stat}
                    onUpdateValue={(value) => {
                      const next = [...(char.stats ?? [])];
                      next[statIndex] = { ...next[statIndex]!, value };
                      updateCharacter(idx, { ...char, stats: next });
                    }}
                    onUpdateMax={(value) => {
                      const next = [...(char.stats ?? [])];
                      next[statIndex] = { ...next[statIndex]!, max: value };
                      updateCharacter(idx, { ...char, stats: next });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadIdx !== null) handleAvatarUpload(uploadIdx, file);
          e.target.value = "";
        }}
      />
    </>
  );
}

interface InventoryPanelProps {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
}

export function InventoryPanel({ items, onUpdate }: InventoryPanelProps) {
  const addItem = () => {
    onUpdate([...items, { name: "New Item", description: "", quantity: 1, location: "on_person" }]);
  };

  const removeItem = (idx: number) => {
    onUpdate(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, updated: InventoryItem) => {
    const next = [...items];
    next[idx] = updated;
    onUpdate(next);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <Package size="0.625rem" /> Inventory ({items.length})
        </span>
        <button
          onClick={addItem}
          className="flex items-center gap-0.5 text-[0.625rem] text-amber-400 hover:text-amber-300 transition-colors"
        >
          <Plus size="0.625rem" /> Add
        </button>
      </div>
      <div className="p-2 space-y-1">
        {items.length === 0 && <div className={cn(EMPTY_STATE, "py-2")}>Inventory empty</div>}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
            <Package size="0.625rem" className="shrink-0 text-amber-400/60" />
            <InlineEdit
              value={item.name}
              onSave={(value) => updateItem(idx, { ...item, name: value })}
              className="flex-1 min-w-0"
              placeholder="Item name"
            />
            <input
              type="number"
              value={item.quantity}
              onChange={(e) => updateItem(idx, { ...item, quantity: Math.max(0, Number(e.target.value)) })}
              className="w-8 bg-transparent text-center text-[0.5625rem] text-[var(--foreground)]/60 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              title="Quantity"
            />
            <button
              onClick={() => removeItem(idx)}
              className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
              title="Remove item"
            >
              <X size="0.5625rem" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

interface QuestsPanelProps {
  quests: QuestProgress[];
  onUpdate: (quests: QuestProgress[]) => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

export function QuestsPanel({ quests, onUpdate, onRerunSingleTracker, isTrackerRetryBusy }: QuestsPanelProps) {
  const addQuest = () => {
    onUpdate([
      ...quests,
      {
        questEntryId: `manual-${Date.now()}`,
        name: "New Quest",
        currentStage: 0,
        objectives: [{ text: "Objective 1", completed: false }],
        completed: false,
      },
    ]);
  };

  const removeQuest = (idx: number) => {
    onUpdate(quests.filter((_, i) => i !== idx));
  };

  const updateQuest = (idx: number, updated: QuestProgress) => {
    const next = [...quests];
    next[idx] = updated;
    onUpdate(next);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <Scroll size="0.625rem" /> Quests ({quests.length})
        </span>
        <span className="flex items-center gap-1">
          <TrackerSectionRefresh
            agentType="quest"
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run quest tracker only"
          />
          <button
            onClick={addQuest}
            className="flex items-center gap-0.5 text-[0.625rem] text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </span>
      </div>
      <div className="p-2 space-y-2">
        {quests.length === 0 && <div className={cn(EMPTY_STATE, "py-2")}>No active quests</div>}
        {quests.map((quest, idx) => (
          <QuestCardEditable
            key={quest.questEntryId || idx}
            quest={quest}
            onUpdate={(updatedQuest) => updateQuest(idx, updatedQuest)}
            onRemove={() => removeQuest(idx)}
          />
        ))}
      </div>
    </>
  );
}

interface CustomTrackerPanelProps {
  fields: CustomTrackerField[];
  onUpdate: (fields: CustomTrackerField[]) => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

export function CustomTrackerPanel({
  fields,
  onUpdate,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CustomTrackerPanelProps) {
  const addField = () => {
    onUpdate([...fields, { name: "New Field", value: "" }]);
  };

  const removeField = (idx: number) => {
    onUpdate(fields.filter((_, i) => i !== idx));
  };

  const updateField = (idx: number, updated: CustomTrackerField) => {
    const next = [...fields];
    next[idx] = updated;
    onUpdate(next);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <SlidersHorizontal size="0.625rem" /> Custom Tracker ({fields.length})
        </span>
        <span className="flex items-center gap-1">
          <TrackerSectionRefresh
            agentType="custom-tracker"
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run custom tracker only"
          />
          <button
            onClick={addField}
            className="flex items-center gap-0.5 text-[0.625rem] text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </span>
      </div>
      <div className="p-2 space-y-1">
        {fields.length === 0 && <div className={cn(EMPTY_STATE, "py-2")}>No fields tracked — add one above</div>}
        {fields.map((field, idx) => (
          <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
            <SlidersHorizontal size="0.625rem" className="shrink-0 text-cyan-400/60" />
            <InlineEdit
              value={field.name}
              onSave={(value) => updateField(idx, { ...field, name: value })}
              className="flex-1 min-w-0"
              placeholder="Field name"
            />
            <span className="text-[var(--muted-foreground)]/40 text-[0.5rem]">=</span>
            <InlineEdit
              value={field.value}
              onSave={(value) => updateField(idx, { ...field, value })}
              className="flex-1 min-w-0"
              placeholder="Value"
            />
            <button
              onClick={() => removeField(idx)}
              className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
              title="Remove field"
            >
              <X size="0.5625rem" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

interface CombinedWorldPanelProps {
  location: string;
  date: string;
  time: string;
  weather: string;
  temperature: string;
  onSaveLocation: (v: string) => void;
  onSaveDate: (v: string) => void;
  onSaveTime: (v: string) => void;
  onSaveWeather: (v: string) => void;
  onSaveTemperature: (v: string) => void;
  weatherEmoji: string;
  pinColor: string;
  tempColor: string;
  onClose: () => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}

export function CombinedWorldPanel({
  location,
  date,
  time,
  weather,
  temperature,
  onSaveLocation,
  onSaveDate,
  onSaveTime,
  onSaveWeather,
  onSaveTemperature,
  weatherEmoji,
  pinColor,
  tempColor,
  onClose,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CombinedWorldPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <CloudSun size="0.625rem" /> World State
        </span>
        <span className="flex items-center gap-1">
          <TrackerSectionRefresh
            agentType="world-state"
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run world state tracker only"
          />
          <button
            onClick={onClose}
            className="text-[var(--muted-foreground)]/50 hover:text-[var(--foreground)] transition-colors"
          >
            <X size="0.75rem" />
          </button>
        </span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        <WorldFieldRow
          icon={<MapPin size="0.8125rem" className={pinColor} />}
          label="Location"
          value={location}
          onSave={onSaveLocation}
          accent="text-emerald-300"
        />
        <WorldFieldRow
          icon={<CalendarDays size="0.8125rem" className="text-violet-400" />}
          label="Date"
          value={date}
          onSave={onSaveDate}
          accent="text-violet-300"
        />
        <WorldFieldRow
          icon={<Clock size="0.8125rem" className="text-amber-400" />}
          label="Time"
          value={time}
          onSave={onSaveTime}
          accent="text-amber-300"
        />
        <WorldFieldRow
          icon={<span className="text-sm leading-none">{weatherEmoji}</span>}
          label="Weather"
          value={weather}
          onSave={onSaveWeather}
          accent="text-sky-300"
        />
        <WorldFieldRow
          icon={<Thermometer size="0.8125rem" className={tempColor} />}
          label="Temperature"
          value={temperature}
          onSave={onSaveTemperature}
          accent="text-rose-300"
        />
      </div>
    </>
  );
}

function InlineEdit({
  value,
  onSave,
  placeholder,
  className,
  scrollOnHover = false,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  scrollOnHover?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef(0);
  const isTouchRef = useRef(false);
  const [showTip, setShowTip] = useState(false);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  const handleTouchStart = () => {
    isTouchRef.current = true;
  };

  const handleClick = () => {
    if (!isTouchRef.current) {
      setDraft(value);
      setEditing(true);
      return;
    }

    isTouchRef.current = false;
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      setShowTip(false);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      setDraft(value);
      setEditing(true);
    } else {
      setShowTip(true);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      tipTimerRef.current = setTimeout(() => setShowTip(false), 2500);
    }
    lastTapRef.current = now;
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commit}
        className={cn(
          "bg-[var(--muted)]/20 rounded px-1.5 py-0.5 text-[0.625rem] text-[var(--foreground)] outline-none border border-[var(--border)] focus:border-purple-400/40",
          className,
        )}
        placeholder={placeholder}
      />
    );
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      title={value || undefined}
      className={cn(
        "group relative flex items-center gap-1 text-left hover:bg-[var(--muted)]/20 rounded px-0.5 transition-colors min-w-0",
        className,
      )}
    >
      <span
        className={cn(
          "text-[0.625rem] text-[var(--foreground)]/70 overflow-hidden whitespace-nowrap scrollbar-hide min-w-0",
          scrollOnHover && value && "roleplay-hud-scroll-field",
        )}
      >
        {scrollOnHover && value ? (
          <span className={cn("roleplay-hud-scroll-track", showTip && "roleplay-hud-scroll-track--active")}>
            <span className="pr-6">{value}</span>
            <span className="pr-6" aria-hidden>
              {value}
            </span>
          </span>
        ) : (
          value || <span className="italic text-[var(--muted-foreground)]/50">{placeholder ?? "—"}</span>
        )}
      </span>
      <Pencil size="0.4375rem" className="opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />
      {showTip && value && (
        <span className="absolute bottom-full left-0 mb-1 max-w-[12rem] break-words rounded bg-[var(--popover)] border border-[var(--border)] px-1.5 py-1 text-[0.5625rem] text-[var(--foreground)]/80 z-[9999] pointer-events-none animate-message-in whitespace-normal">
          {value}
        </span>
      )}
    </button>
  );
}

function PersonaStatusField({ value, onSave }: { value: string; onSave?: (v: string) => void }) {
  return (
    <div className="mb-2 rounded-lg border border-violet-400/15 bg-violet-500/5 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5">
        <Sparkles size="0.5625rem" className="text-violet-300/60" />
        <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-violet-200/65">
          Current Status
        </span>
      </div>
      <InlineEdit
        value={value}
        onSave={onSave ?? (() => {})}
        className="w-full !text-[0.6875rem] !text-[var(--foreground)]/85"
        placeholder="Status not tracked"
        scrollOnHover
      />
    </div>
  );
}

function StatBarEditable({
  stat,
  onUpdateName,
  onUpdateValue,
  onUpdateMax,
}: {
  stat: CharacterStat;
  onUpdateName?: (name: string) => void;
  onUpdateValue: (v: number) => void;
  onUpdateMax: (v: number) => void;
}) {
  const pct = stat.max > 0 ? Math.min(100, Math.max(0, (stat.value / stat.max) * 100)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        {onUpdateName ? (
          <InlineEdit
            value={stat.name}
            onSave={onUpdateName}
            className="!text-[0.625rem] !font-medium !text-[var(--foreground)]/80"
            placeholder="Stat name"
          />
        ) : (
          <span className="text-[0.625rem] font-medium text-[var(--foreground)]/80">{stat.name}</span>
        )}
        <div className="flex items-center gap-0.5 shrink-0 text-[0.5625rem] text-[var(--muted-foreground)]/60">
          <input
            type="number"
            value={stat.value}
            onChange={(e) => onUpdateValue(Number(e.target.value))}
            className="w-12 bg-transparent text-right outline-none text-[var(--foreground)]/80 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span>/</span>
          <input
            type="number"
            value={stat.max}
            onChange={(e) => onUpdateMax(Number(e.target.value))}
            className="w-12 bg-transparent outline-none text-[var(--foreground)]/80 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--muted)]/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: stat.color || "#8b5cf6" }}
        />
      </div>
    </div>
  );
}

function QuestCardEditable({
  quest,
  onUpdate,
  onRemove,
}: {
  quest: QuestProgress;
  onUpdate: (q: QuestProgress) => void;
  onRemove: () => void;
}) {
  const addObjective = () => {
    onUpdate({
      ...quest,
      objectives: [...quest.objectives, { text: "New objective", completed: false }],
    });
  };

  const toggleObjective = (idx: number) => {
    const next = [...quest.objectives];
    next[idx] = { ...next[idx]!, completed: !next[idx]!.completed };
    onUpdate({ ...quest, objectives: next });
  };

  const removeObjective = (idx: number) => {
    onUpdate({ ...quest, objectives: quest.objectives.filter((_, objectiveIndex) => objectiveIndex !== idx) });
  };

  const updateObjectiveText = (idx: number, text: string) => {
    const next = [...quest.objectives];
    next[idx] = { ...next[idx]!, text };
    onUpdate({ ...quest, objectives: next });
  };

  const completed = quest.objectives.filter((objective) => objective.completed).length;
  const total = quest.objectives.length;

  return (
    <div className="rounded-lg bg-[var(--muted)]/20 p-2">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onUpdate({ ...quest, completed: !quest.completed })}
          title={quest.completed ? "Mark incomplete" : "Mark complete"}
        >
          {quest.completed ? (
            <CheckCircle2 size="0.6875rem" className="text-emerald-400 shrink-0" />
          ) : (
            <Target size="0.6875rem" className="text-amber-400 shrink-0" />
          )}
        </button>
        <InlineEdit
          value={quest.name}
          onSave={(value) => onUpdate({ ...quest, name: value })}
          className={cn("flex-1 !font-medium", quest.completed && "line-through opacity-50")}
          placeholder="Quest name"
        />
        {total > 0 && (
          <span className="text-[0.5625rem] text-[var(--muted-foreground)]/60">
            {completed}/{total}
          </span>
        )}
        <button
          onClick={onRemove}
          className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
          title="Remove quest"
        >
          <X size="0.5625rem" />
        </button>
      </div>
      {!quest.completed && (
        <div className="mt-1 space-y-0.5 pl-4">
          {quest.objectives.map((objective, idx) => (
            <div key={idx} className="group flex items-center gap-1 text-[0.5625rem]">
              <button onClick={() => toggleObjective(idx)}>
                {objective.completed ? (
                  <CheckCircle2 size="0.5rem" className="text-emerald-400/60 shrink-0" />
                ) : (
                  <Circle size="0.5rem" className="text-[var(--muted-foreground)]/40 shrink-0" />
                )}
              </button>
              <InlineEdit
                value={objective.text}
                onSave={(value) => updateObjectiveText(idx, value)}
                className={cn("flex-1", objective.completed && "line-through opacity-50")}
                placeholder="Objective"
              />
              <button
                onClick={() => removeObjective(idx)}
                className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)]/40 hover:text-red-500 transition-all shrink-0"
              >
                <X size="0.4375rem" />
              </button>
            </div>
          ))}
          <button
            onClick={addObjective}
            className="flex items-center gap-0.5 text-[0.5rem] text-[var(--muted-foreground)]/40 hover:text-[var(--muted-foreground)] transition-colors mt-0.5"
          >
            <Plus size="0.4375rem" /> objective
          </button>
        </div>
      )}
    </div>
  );
}

function LabeledEdit({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[0.5625rem] text-[var(--muted-foreground)]/60 w-10 shrink-0">{label}</span>
      <InlineEdit value={value} onSave={onSave} className="flex-1 min-w-0" placeholder="—" scrollOnHover />
    </div>
  );
}

function WorldFieldRow({
  icon,
  label,
  value,
  onSave,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onSave: (v: string) => void;
  accent: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      inputRef.current?.focus();
    }
  }, [editing, value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 group/row hover:bg-[var(--muted)]/20 transition-colors">
      <div className="shrink-0 w-5 flex items-center justify-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[0.5625rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/60 mb-0.5">
          {label}
        </div>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commit}
            className={cn(
              "w-full bg-transparent text-[0.6875rem] font-medium outline-none placeholder:text-[var(--muted-foreground)]/40",
              accent,
            )}
            placeholder={label}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={cn(
              "w-full text-left text-[0.6875rem] font-medium truncate",
              value ? "text-[var(--foreground)]/80" : "text-[var(--muted-foreground)]/50 italic",
            )}
          >
            {value || `Set ${label.toLowerCase()}…`}
          </button>
        )}
      </div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 text-[var(--muted-foreground)]/30 opacity-0 group-hover/row:opacity-100 transition-opacity"
          title={`Edit ${label.toLowerCase()}`}
        >
          <Pencil size="0.625rem" />
        </button>
      )}
    </div>
  );
}
