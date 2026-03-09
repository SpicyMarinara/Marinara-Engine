// ──────────────────────────────────────────────
// Character Editor — Full-page detail view
// Replaces the chat area when editing a character.
// Sections: Metadata, Description, Personality, Backstory,
//           Appearance, Scenario, Dialogue, Advanced, Lorebook
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import {
  useCharacter,
  useUpdateCharacter,
  useUploadAvatar,
  useDeleteCharacter,
  useCharacterSprites,
  useUploadSprite,
  useDeleteSprite,
  type SpriteInfo,
} from "../../hooks/use-characters";
import { useUIStore } from "../../stores/ui.store";
import {
  ArrowLeft,
  Save,
  User,
  FileText,
  Heart,
  BookOpen,
  Eye,
  MapPin,
  MessageCircle,
  Settings2,
  Library,
  Camera,
  Trash2,
  Star,
  StarOff,
  Tag,
  X,
  AlertTriangle,
  Image,
  Upload,
  Plus,
  Palette,
  Download,
  FolderOpen,
  Loader2,
  Swords,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import { ColorPicker } from "../ui/ColorPicker";
import type { CharacterData, RPGStatsConfig } from "@marinara-engine/shared";

// ── Tabs ──
const TABS = [
  { id: "metadata", label: "Metadata", icon: User },
  { id: "description", label: "Description", icon: FileText },
  { id: "personality", label: "Personality", icon: Heart },
  { id: "backstory", label: "Backstory", icon: BookOpen },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "scenario", label: "Scenario", icon: MapPin },
  { id: "dialogue", label: "Dialogue", icon: MessageCircle },
  { id: "sprites", label: "Sprites", icon: Image },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "stats", label: "Stats", icon: Swords },
  { id: "advanced", label: "Advanced", icon: Settings2 },
  { id: "lorebook", label: "Lorebook", icon: Library },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface ParsedCharacter {
  id: string;
  data: string;
  avatarPath: string | null;
  spriteFolderPath: string | null;
}

export function CharacterEditor() {
  const characterId = useUIStore((s) => s.characterDetailId);
  const closeDetail = useUIStore((s) => s.closeCharacterDetail);
  const { data: rawCharacter, isLoading } = useCharacter(characterId);
  const updateCharacter = useUpdateCharacter();
  const uploadAvatar = useUploadAvatar();
  const deleteCharacter = useDeleteCharacter();

  const [activeTab, setActiveTab] = useState<TabId>("metadata");
  const [formData, setFormData] = useState<CharacterData | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse the character when it loads
  useEffect(() => {
    if (!rawCharacter) return;
    const char = rawCharacter as ParsedCharacter;
    try {
      const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
      setFormData(parsed as CharacterData);
      setAvatarPreview(char.avatarPath);
    } catch {
      setFormData(null);
    }
  }, [rawCharacter]);

  const updateField = useCallback(<K extends keyof CharacterData>(key: K, value: CharacterData[K]) => {
    setFormData((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }, []);

  const updateExtension = useCallback((key: string, value: unknown) => {
    setFormData((prev) => {
      if (!prev) return prev;
      return { ...prev, extensions: { ...prev.extensions, [key]: value } };
    });
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!characterId || !formData) return;
    setSaving(true);
    try {
      await updateCharacter.mutateAsync({ id: characterId, data: formData as unknown as Record<string, unknown> });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !characterId) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      try {
        await uploadAvatar.mutateAsync({ id: characterId, avatar: dataUrl });
      } catch {
        // revert on failure
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    if (!characterId) return;
    if (!confirm("Are you sure you want to delete this character?")) return;
    await deleteCharacter.mutateAsync(characterId);
    closeDetail();
  };

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeDetail();
  }, [dirty, closeDetail]);

  const forceClose = useCallback(() => {
    setShowUnsavedWarning(false);
    setDirty(false);
    closeDetail();
  }, [closeDetail]);

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag || !formData) return;
    if (formData.tags.includes(tag)) return;
    updateField("tags", [...formData.tags, tag]);
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    if (!formData) return;
    updateField(
      "tags",
      formData.tags.filter((t) => t !== tag),
    );
  };

  if (isLoading || !formData) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-16 w-16 rounded-2xl" />
          <div className="shimmer h-3 w-32 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <button
          onClick={handleClose}
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Avatar */}
        <div
          className="group relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink-400 to-rose-500 shadow-md shadow-pink-500/20"
          onClick={() => fileInputRef.current?.click()}
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt={formData.name} className="h-full w-full object-cover" />
          ) : (
            <User size={22} className="text-white" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={16} className="text-white" />
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        </div>

        <div className="min-w-0 flex-1">
          <input
            value={formData.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full bg-transparent text-lg font-bold outline-none"
            placeholder="Character name"
          />
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {formData.creator ? `by ${formData.creator}` : "No creator"} · v{formData.character_version || "1.0"}
          </p>
        </div>

        {/* Favorite toggle */}
        <button
          onClick={() => updateExtension("fav", !formData.extensions.fav)}
          className={cn(
            "rounded-xl p-2 transition-all",
            formData.extensions.fav ? "text-yellow-400" : "text-[var(--muted-foreground)] hover:text-yellow-400",
          )}
          title={formData.extensions.fav ? "Remove from favorites" : "Add to favorites"}
        >
          {formData.extensions.fav ? <Star size={18} fill="currentColor" /> : <StarOff size={18} />}
        </button>

        {/* Export */}
        <button
          onClick={() => api.download(`/characters/${characterId}/export`)}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export character"
        >
          <Download size={18} />
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          title="Delete character"
        >
          <Trash2 size={18} />
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium transition-all",
            dirty
              ? "bg-gradient-to-r from-pink-400 to-purple-500 text-white shadow-md shadow-pink-500/20 hover:shadow-lg active:scale-[0.98]"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)] cursor-not-allowed",
          )}
        >
          <Save size={13} />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── Unsaved changes warning ── */}
      {showUnsavedWarning && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertTriangle size={15} className="shrink-0 text-amber-500" />
          <p className="flex-1 text-xs font-medium text-amber-500">You have unsaved changes. Close without saving?</p>
          <button
            onClick={() => setShowUnsavedWarning(false)}
            className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            Keep editing
          </button>
          <button
            onClick={forceClose}
            className="rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-500 transition-all hover:bg-amber-500/25"
          >
            Discard & close
          </button>
          <button
            onClick={async () => {
              await handleSave();
              closeDetail();
            }}
            className="rounded-lg bg-gradient-to-r from-pink-400 to-purple-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md"
          >
            Save & close
          </button>
        </div>
      )}

      {/* ── Body: Tabs + Content ── */}
      <div className="flex flex-1 overflow-hidden max-md:flex-col">
        {/* Tab Rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all text-left max-md:whitespace-nowrap max-md:px-2.5 max-md:py-1.5",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-pink-400/15 to-purple-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 max-md:p-4">
          <div className="mx-auto max-w-2xl">
            {activeTab === "metadata" && (
              <MetadataTab
                formData={formData}
                updateField={updateField}
                updateExtension={updateExtension}
                newTag={newTag}
                setNewTag={setNewTag}
                addTag={addTag}
                removeTag={removeTag}
              />
            )}
            {activeTab === "description" && (
              <TextareaTab
                title="Description"
                subtitle="The character's general description. This is sent in every prompt as part of the character's identity."
                value={formData.description}
                onChange={(v) => updateField("description", v)}
                placeholder="Describe who this character is, their role, and their key traits…"
                rows={12}
              />
            )}
            {activeTab === "personality" && (
              <TextareaTab
                title="Personality"
                subtitle="A concise summary of the character's personality traits, temperament, and behavioral patterns."
                value={formData.personality}
                onChange={(v) => updateField("personality", v)}
                placeholder="Energetic, curious, and fiercely loyal. Speaks in short bursts. Has a habit of…"
                rows={8}
              />
            )}
            {activeTab === "backstory" && (
              <TextareaTab
                title="Backstory"
                subtitle="The character's history, origin story, and formative life events."
                value={(formData.extensions.backstory as string) ?? ""}
                onChange={(v) => updateExtension("backstory", v)}
                placeholder="Born in a small village on the outskirts of the empire…"
                rows={12}
              />
            )}
            {activeTab === "appearance" && (
              <TextareaTab
                title="Appearance"
                subtitle="Detailed physical description — height, build, hair, eyes, clothing, distinguishing features."
                value={(formData.extensions.appearance as string) ?? ""}
                onChange={(v) => updateExtension("appearance", v)}
                placeholder="Tall and willowy with silver-streaked dark hair. Wears a battered leather coat over…"
                rows={8}
              />
            )}
            {activeTab === "scenario" && (
              <TextareaTab
                title="Scenario"
                subtitle="The default setting or situation where interactions take place."
                value={formData.scenario}
                onChange={(v) => updateField("scenario", v)}
                placeholder="A bustling port city during a trade festival. The streets are alive with merchants and performers…"
                rows={8}
              />
            )}
            {activeTab === "dialogue" && <DialogueTab formData={formData} updateField={updateField} />}
            {activeTab === "advanced" && (
              <AdvancedTab formData={formData} updateField={updateField} updateExtension={updateExtension} />
            )}
            {activeTab === "sprites" && characterId && <SpritesTab characterId={characterId} />}
            {activeTab === "colors" && (
              <ColorsTab formData={formData} updateExtension={updateExtension} avatarUrl={avatarPreview} />
            )}
            {activeTab === "stats" && <StatsTab formData={formData} updateExtension={updateExtension} />}
            {activeTab === "lorebook" && <LorebookTab formData={formData} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-tab components
// ──────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
    </div>
  );
}

function TextareaTab({
  title,
  subtitle,
  value,
  onChange,
  placeholder,
  rows = 8,
}: {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <div>
      <SectionHeader title={title} subtitle={subtitle} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
      />
      <p className="mt-1.5 text-right text-[10px] text-[var(--muted-foreground)]">{value.length} characters</p>
    </div>
  );
}

function MetadataTab({
  formData,
  updateField,
  updateExtension,
  newTag,
  setNewTag,
  addTag,
  removeTag,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
  newTag: string;
  setNewTag: (v: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Metadata" subtitle="Basic character info — name, creator, version, tags." />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Name{" "}
            <HelpTooltip text="The character's display name. This is what appears in chat and is used as {{char}} in prompts." />
          </span>
          <input
            value={formData.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          />
        </label>
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Creator{" "}
            <HelpTooltip text="The person who made this character. Useful for giving credit when sharing characters." />
          </span>
          <input
            value={formData.creator}
            onChange={(e) => updateField("creator", e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="Your name"
          />
        </label>
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Version <HelpTooltip text="Version number for tracking changes to this character definition over time." />
          </span>
          <input
            value={formData.character_version}
            onChange={(e) => updateField("character_version", e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="1.0"
          />
        </label>
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Talkativeness{" "}
            <HelpTooltip text="How often this character speaks in group chats. 0% = rarely speaks unless addressed, 100% = responds to almost everything." />
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={formData.extensions.talkativeness}
            onChange={(e) => updateExtension("talkativeness", parseFloat(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {Math.round(formData.extensions.talkativeness * 100)}%
          </span>
        </label>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          Tags{" "}
          <HelpTooltip text="Labels for organizing characters. Use tags like 'fantasy', 'sci-fi', 'OC' etc. to categorize and search." />
        </span>
        <div className="flex flex-wrap gap-1.5">
          {formData.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--primary)]"
            >
              <Tag size={10} />
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full transition-colors hover:text-[var(--destructive)]"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="Add tag…"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none focus:border-[var(--primary)]/40"
          />
          <button
            onClick={addTag}
            className="rounded-xl bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
          >
            Add
          </button>
        </div>
      </div>

      {/* Creator Notes */}
      <label className="block space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          Creator Notes{" "}
          <HelpTooltip text="Private notes about this character — tips for use, known quirks, recommended settings. Not sent to the AI." />
        </span>
        <textarea
          value={formData.creator_notes}
          onChange={(e) => updateField("creator_notes", e.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Notes about this character, intended use, tips for best results…"
        />
      </label>
    </div>
  );
}

function DialogueTab({
  formData,
  updateField,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
}) {
  const addGreeting = () => {
    updateField("alternate_greetings", [...formData.alternate_greetings, ""]);
  };

  const updateGreeting = (i: number, value: string) => {
    const copy = [...formData.alternate_greetings];
    copy[i] = value;
    updateField("alternate_greetings", copy);
  };

  const removeGreeting = (i: number) => {
    updateField(
      "alternate_greetings",
      formData.alternate_greetings.filter((_, idx) => idx !== i),
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Dialogue & Greetings"
        subtitle="First message, example dialogue, and alternate greetings."
      />

      {/* First Message */}
      <label className="block space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          First Message{" "}
          <HelpTooltip text="The character's opening message when a new chat starts. Good first messages set the scene and establish the character's voice." />
        </span>
        <textarea
          value={formData.first_mes}
          onChange={(e) => updateField("first_mes", e.target.value)}
          rows={6}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="What does the character say when they first meet someone? Use *asterisks* for actions…"
        />
      </label>

      {/* Alternate Greetings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Alternate Greetings ({formData.alternate_greetings.length})
            <HelpTooltip text="Alternative first messages for variety. When starting a new chat, you can pick which greeting to use." />
          </span>
          <button
            onClick={addGreeting}
            className="rounded-xl bg-[var(--primary)]/15 px-3 py-1 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
          >
            + Add
          </button>
        </div>
        {formData.alternate_greetings.map((g, i) => (
          <div key={i} className="relative">
            <textarea
              value={g}
              onChange={(e) => updateGreeting(i, e.target.value)}
              rows={3}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 pr-10 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40"
              placeholder={`Greeting #${i + 1}…`}
            />
            <button
              onClick={() => removeGreeting(i)}
              className="absolute right-2 top-2 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Example Messages */}
      <label className="block space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          Example Dialogue{" "}
          <HelpTooltip text="Sample conversations showing how the character talks. Helps the AI learn the character's speaking style, vocabulary, and mannerisms." />
        </span>
        <p className="text-[10px] text-[var(--muted-foreground)]/70">
          {"Use <START> to separate exchanges. Use {{user}} and {{char}} as placeholders."}
        </p>
        <textarea
          value={formData.mes_example}
          onChange={(e) => updateField("mes_example", e.target.value)}
          rows={10}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 font-mono text-xs leading-relaxed outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder={"<START>\n{{user}}: Hello!\n{{char}}: *waves excitedly* Hey there!"}
        />
      </label>
    </div>
  );
}

function AdvancedTab({
  formData,
  updateField,
  updateExtension,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
}) {
  const depthPrompt = formData.extensions.depth_prompt ?? { prompt: "", depth: 4, role: "system" as const };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Advanced"
        subtitle="System prompt, post-history instructions, and depth prompt injection."
      />

      <label className="block space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          System Prompt{" "}
          <HelpTooltip text="Overrides or appends to the main system prompt when this character is active. Use this for character-specific instructions the AI must follow." />
        </span>
        <textarea
          value={formData.system_prompt}
          onChange={(e) => updateField("system_prompt", e.target.value)}
          rows={6}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Override or append to the system prompt for this character…"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          Post-History Instructions{" "}
          <HelpTooltip text="Text inserted after the chat history, right before the AI generates. Great for reminders like 'stay in character' or 'respond in 2 paragraphs'." />
        </span>
        <textarea
          value={formData.post_history_instructions}
          onChange={(e) => updateField("post_history_instructions", e.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Text inserted after the chat history but before generation…"
        />
      </label>

      {/* Depth Prompt */}
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          Depth Prompt{" "}
          <HelpTooltip text="Injects text at a specific position in the chat history. Depth 0 = at the end, depth 4 = 4 messages back. Useful for persistent reminders." />
        </span>
        <textarea
          value={depthPrompt.prompt}
          onChange={(e) => updateExtension("depth_prompt", { ...depthPrompt, prompt: e.target.value })}
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none focus:border-[var(--primary)]/40"
          placeholder="Prompt injected at a specific depth in the chat history…"
        />
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted-foreground)]">Depth</span>
            <input
              type="number"
              min={0}
              max={100}
              value={depthPrompt.depth}
              onChange={(e) =>
                updateExtension("depth_prompt", { ...depthPrompt, depth: parseInt(e.target.value) || 0 })
              }
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-center text-xs outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted-foreground)]">Role</span>
            <select
              value={depthPrompt.role}
              onChange={(e) => updateExtension("depth_prompt", { ...depthPrompt, role: e.target.value })}
              className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none"
            >
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Sprites Tab ──

const DEFAULT_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "embarrassed",
  "thinking",
  "laughing",
  "worried",
  "scared",
  "disgusted",
  "love",
  "smirk",
  "crying",
  "determined",
  "hurt",
];

function SpritesTab({ characterId }: { characterId: string }) {
  const { data: sprites, isLoading } = useCharacterSprites(characterId);
  const uploadSprite = useUploadSprite();
  const deleteSprite = useDeleteSprite();
  const [newExpression, setNewExpression] = useState("");
  const [uploading, setUploading] = useState(false);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingExpressionRef = useRef("");

  const existingExpressions = new Set((sprites as SpriteInfo[] | undefined)?.map((s) => s.expression) ?? []);
  const suggestedExpressions = DEFAULT_EXPRESSIONS.filter((e) => !existingExpressions.has(e));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const expression =
      pendingExpressionRef.current ||
      newExpression
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_");
    if (!expression) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await uploadSprite.mutateAsync({
          characterId,
          expression,
          image: reader.result as string,
        });
        setNewExpression("");
        pendingExpressionRef.current = "";
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const startUpload = (expression: string) => {
    pendingExpressionRef.current = expression;
    fileInputRef.current?.click();
  };

  /** Upload an entire folder of images — each filename becomes the expression name. */
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter to image files only
    const imageFiles = Array.from(files).filter((f) => /\.(png|jpg|jpeg|gif|webp|avif)$/i.test(f.name));
    if (imageFiles.length === 0) return;

    setFolderProgress({ done: 0, total: imageFiles.length });

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]!;
      // Derive expression name from filename (strip extension, lowercase, sanitize)
      const expression = file.name
        .replace(/\.[^.]+$/, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_");
      if (!expression) continue;

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      try {
        await uploadSprite.mutateAsync({ characterId, expression, image: dataUrl });
      } catch {
        // Skip failed uploads, continue with the rest
      }
      setFolderProgress({ done: i + 1, total: imageFiles.length });
    }

    setFolderProgress(null);
    e.target.value = "";
  };

  const handleDelete = async (expression: string) => {
    if (!confirm(`Delete sprite for "${expression}"?`)) return;
    await deleteSprite.mutateAsync({ characterId, expression });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Character Sprites"
        subtitle="Upload VN-style sprites for different expressions. The Expression Engine agent will select the appropriate sprite during roleplay."
      />

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        // @ts-expect-error — webkitdirectory is a non-standard but widely-supported attribute
        webkitdirectory=""
        className="hidden"
        onChange={handleFolderUpload}
      />

      {/* Upload new expression */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <Upload size={13} className="text-[var(--y2k-pink)]" />
            Add Sprite
          </h4>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={!!folderProgress}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
            title="Select a folder of PNGs — each filename becomes the expression name"
          >
            <FolderOpen size={13} />
            Upload Folder
          </button>
        </div>

        {/* Folder upload progress */}
        {folderProgress && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size={12} className="animate-spin text-[var(--y2k-pink)]" />
            Uploading {folderProgress.done}/{folderProgress.total} sprites…
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newExpression}
            onChange={(e) => setNewExpression(e.target.value)}
            placeholder="Expression name (e.g. happy, sad, angry)…"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newExpression.trim()) startUpload(newExpression.trim().toLowerCase());
            }}
          />
          <button
            onClick={() => newExpression.trim() && startUpload(newExpression.trim().toLowerCase())}
            disabled={!newExpression.trim() || uploading}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--y2k-pink)] to-[var(--y2k-purple)] px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md disabled:opacity-40"
          >
            <Plus size={13} />
            Upload
          </button>
        </div>

        {/* Quick expression buttons */}
        {suggestedExpressions.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--muted-foreground)] mb-1.5">Quick add:</p>
            <div className="flex flex-wrap gap-1">
              {suggestedExpressions.slice(0, 12).map((expr) => (
                <button
                  key={expr}
                  onClick={() => startUpload(expr)}
                  className="rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  {expr}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sprite grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : (sprites as SpriteInfo[] | undefined)?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {(sprites as SpriteInfo[]).map((sprite) => (
            <div
              key={sprite.expression}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)]/30 hover:shadow-md"
            >
              <div className="aspect-[3/4] bg-[var(--secondary)]">
                <img src={sprite.url} alt={sprite.expression} className="h-full w-full object-contain" />
              </div>
              <div className="flex items-center justify-between p-2">
                <span className="text-[11px] font-medium capitalize">{sprite.expression}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startUpload(sprite.expression)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Replace"
                  >
                    <Upload size={11} />
                  </button>
                  <button
                    onClick={() => handleDelete(sprite.expression)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-12 text-center">
          <Image size={28} className="text-[var(--muted-foreground)]/40" />
          <div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">No sprites yet</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]/60">
              Upload expression sprites above. Use transparent PNGs for best results.
            </p>
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h4 className="mb-1.5 text-xs font-semibold">How sprites work</h4>
        <ul className="space-y-1 text-[11px] text-[var(--muted-foreground)]">
          <li>
            • Upload sprites one by one, or use <strong className="text-[var(--foreground)]">Upload Folder</strong> to
            bulk-import a folder of PNGs (each filename = expression name, e.g. admiration.png → "admiration")
          </li>
          <li>
            • Enable the <strong className="text-[var(--foreground)]">Expression Engine</strong> agent in the Agents
            panel
          </li>
          <li>• During roleplay, the agent will detect emotions and display the matching sprite</li>
          <li>• Sprites appear as VN-style overlays in the chat area</li>
        </ul>
      </div>
    </div>
  );
}

// ── Stats Tab ──

const DEFAULT_RPG_STATS: RPGStatsConfig = {
  enabled: false,
  attributes: [
    { name: "STR", value: 10, max: 20 },
    { name: "DEX", value: 10, max: 20 },
    { name: "CON", value: 10, max: 20 },
    { name: "INT", value: 10, max: 20 },
    { name: "WIS", value: 10, max: 20 },
    { name: "CHA", value: 10, max: 20 },
  ],
  hp: { value: 100, max: 100 },
  mp: { value: 50, max: 50 },
};

function StatsTab({
  formData,
  updateExtension,
}: {
  formData: CharacterData;
  updateExtension: (key: string, value: unknown) => void;
}) {
  const stats: RPGStatsConfig = (formData.extensions.rpgStats as RPGStatsConfig) ?? DEFAULT_RPG_STATS;

  const update = (patch: Partial<RPGStatsConfig>) => {
    updateExtension("rpgStats", { ...stats, ...patch });
  };

  const updateAttribute = (index: number, field: string, value: string | number) => {
    const next = [...stats.attributes];
    next[index] = { ...next[index], [field]: value };
    update({ attributes: next });
  };

  const addAttribute = () => {
    update({ attributes: [...stats.attributes, { name: "NEW", value: 10, max: 20 }] });
  };

  const removeAttribute = (index: number) => {
    update({ attributes: stats.attributes.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="RPG Stats"
        subtitle="Toggle stat tracking for this character. When enabled, the character's stats are included in the prompt and tracked by agents."
      />

      {/* Enable toggle */}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input
          type="checkbox"
          checked={stats.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="h-4 w-4 rounded accent-purple-500"
        />
        <div>
          <p className="text-sm font-medium">Enable RPG Stats</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Stats will be injected into the prompt and tracked by the Character Tracker agent.
          </p>
        </div>
      </label>

      {stats.enabled && (
        <>
          {/* HP / MP */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs font-semibold">Hit Points (HP)</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={stats.hp.value}
                  onChange={(e) => update({ hp: { ...stats.hp, value: parseInt(e.target.value) || 0 } })}
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                />
                <span className="text-xs text-[var(--muted-foreground)]">/</span>
                <input
                  type="number"
                  value={stats.hp.max}
                  onChange={(e) => update({ hp: { ...stats.hp, max: parseInt(e.target.value) || 1 } })}
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-all"
                  style={{ width: `${Math.min(100, (stats.hp.value / Math.max(1, stats.hp.max)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs font-semibold">Mana Points (MP)</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={stats.mp.value}
                  onChange={(e) => update({ mp: { ...stats.mp, value: parseInt(e.target.value) || 0 } })}
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                />
                <span className="text-xs text-[var(--muted-foreground)]">/</span>
                <input
                  type="number"
                  value={stats.mp.max}
                  onChange={(e) => update({ mp: { ...stats.mp, max: parseInt(e.target.value) || 1 } })}
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all"
                  style={{ width: `${Math.min(100, (stats.mp.value / Math.max(1, stats.mp.max)) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Attributes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Attributes</h3>
              <button
                onClick={addAttribute}
                className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2.5 py-1 text-[11px] font-medium text-purple-400 transition-colors hover:bg-purple-500/25"
              >
                <Plus size={12} />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {stats.attributes.map((attr, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <input
                    value={attr.name}
                    onChange={(e) => updateAttribute(i, "name", e.target.value)}
                    className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs font-medium"
                    placeholder="Name"
                  />
                  <input
                    type="number"
                    value={attr.value}
                    onChange={(e) => updateAttribute(i, "value", parseInt(e.target.value) || 0)}
                    className="w-16 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs"
                  />
                  <span className="text-[10px] text-[var(--muted-foreground)]">/</span>
                  <input
                    type="number"
                    value={attr.max}
                    onChange={(e) => updateAttribute(i, "max", parseInt(e.target.value) || 1)}
                    className="w-16 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs"
                  />
                  {/* Mini bar */}
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all"
                      style={{ width: `${Math.min(100, (attr.value / Math.max(1, attr.max)) * 100)}%` }}
                    />
                  </div>
                  <button
                    onClick={() => removeAttribute(i)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
            <h4 className="mb-1.5 text-xs font-semibold">How stats work</h4>
            <ul className="space-y-1 text-[11px] text-[var(--muted-foreground)]">
              <li>
                &bull; <strong className="text-[var(--foreground)]">HP &amp; MP</strong> — Injected into the prompt so
                the AI knows the character&apos;s current health and mana.
              </li>
              <li>
                &bull; <strong className="text-[var(--foreground)]">Attributes</strong> — Custom stats (STR, DEX, etc.)
                that define the character&apos;s capabilities.
              </li>
              <li>
                &bull; The Character Tracker agent adjusts these values based on narrative events (combat, healing,
                etc.).
              </li>
              <li>&bull; Values set here serve as the initial/default state for new conversations.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ── Colors Tab ──

function extractColorsFromImage(imgSrc: string): Promise<[string, string, string]> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not available"));
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Collect non-transparent, non-near-black/white pixels
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (a < 128) continue;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 15 || lum > 240) continue;
        pixels.push([r, g, b]);
      }
      if (pixels.length < 3) return reject(new Error("Not enough color data in the avatar"));

      // Simple median-cut quantization to find 3 dominant colors
      const buckets = medianCut(pixels, 3);
      const colors = buckets.map((bucket) => {
        const avg = bucket.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0] as [
          number,
          number,
          number,
        ]);
        return [
          Math.round(avg[0] / bucket.length),
          Math.round(avg[1] / bucket.length),
          Math.round(avg[2] / bucket.length),
        ] as [number, number, number];
      });

      // Sort by saturation desc — most vibrant first
      const sat = ([r, g, b]: [number, number, number]) => {
        const max = Math.max(r, g, b),
          min = Math.min(r, g, b);
        return max === 0 ? 0 : (max - min) / max;
      };
      colors.sort((a, b) => sat(b) - sat(a));

      const hex = ([r, g, b]: [number, number, number]) =>
        `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

      const nameColor = hex(colors[0]);
      const dialogueColor = hex(colors[1] ?? colors[0]);
      const boxRgb = colors[2] ?? colors[1] ?? colors[0];
      const boxColor = `rgba(${boxRgb[0]}, ${boxRgb[1]}, ${boxRgb[2]}, 0.25)`;

      resolve([nameColor, dialogueColor, boxColor]);
    };
    img.onerror = () => reject(new Error("Failed to load avatar image"));
    img.src = imgSrc;
  });
}

function medianCut(pixels: [number, number, number][], depth: number): [number, number, number][][] {
  if (depth <= 1 || pixels.length < 2) return [pixels];
  // Find channel with widest range
  let maxRange = 0,
    splitCh = 0;
  for (let ch = 0; ch < 3; ch++) {
    const vals = pixels.map((p) => p[ch]);
    const range = Math.max(...vals) - Math.min(...vals);
    if (range > maxRange) {
      maxRange = range;
      splitCh = ch;
    }
  }
  pixels.sort((a, b) => a[splitCh] - b[splitCh]);
  const mid = Math.floor(pixels.length / 2);
  return [...medianCut(pixels.slice(0, mid), depth - 1), ...medianCut(pixels.slice(mid), depth - 1)];
}

function ColorsTab({
  formData,
  updateExtension,
  avatarUrl,
}: {
  formData: CharacterData;
  updateExtension: (key: string, value: unknown) => void;
  avatarUrl: string | null;
}) {
  const nameColor = (formData.extensions.nameColor as string) ?? "";
  const dialogueColor = (formData.extensions.dialogueColor as string) ?? "";
  const boxColor = (formData.extensions.boxColor as string) ?? "";
  const [extracting, setExtracting] = useState(false);

  const handleExtract = async () => {
    if (!avatarUrl) return;
    setExtracting(true);
    try {
      const [nc, dc, bc] = await extractColorsFromImage(avatarUrl);
      updateExtension("nameColor", nc);
      updateExtension("dialogueColor", dc);
      updateExtension("boxColor", bc);
    } catch {
      // silently ignore — user can just pick colors manually
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Character Colors"
        subtitle="Customize how this character appears in chats. Colors are applied to the name, dialogue, and message bubble."
      />

      {/* Extract from avatar button */}
      <button
        type="button"
        disabled={!avatarUrl || extracting}
        onClick={handleExtract}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all",
          avatarUrl
            ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 active:scale-[0.98]"
            : "cursor-not-allowed bg-white/5 text-[var(--muted-foreground)]/50",
        )}
      >
        {extracting ? <Loader2 size={14} className="animate-spin" /> : <Palette size={14} />}
        {extracting ? "Extracting..." : avatarUrl ? "Extract Colors from Avatar" : "Upload an avatar first"}
      </button>

      {/* Preview card */}
      <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-3">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--muted-foreground)]">Preview</p>
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-600 ring-2 ring-purple-400/20">
            <User size={16} className="text-white" />
          </div>
          <div className="flex-1 space-y-1">
            <span
              className="text-[12px] font-bold tracking-tight"
              style={
                nameColor
                  ? nameColor.startsWith("linear-gradient")
                    ? {
                        background: nameColor,
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                      }
                    : { color: nameColor }
                  : { color: "rgb(192, 132, 252)" }
              }
            >
              {formData.name || "Character"}
            </span>
            <div
              className="rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] leading-[1.8] backdrop-blur-md ring-1 ring-white/8"
              style={boxColor ? { backgroundColor: boxColor } : { backgroundColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="text-white/90">*She looks at you with a warm smile.* </span>
              <strong style={dialogueColor ? { color: dialogueColor } : { color: "rgb(255, 255, 255)" }}>
                &ldquo;Hello there! How are you?&rdquo;
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Name Color */}
      <ColorPicker
        value={nameColor}
        onChange={(v) => updateExtension("nameColor", v)}
        gradient
        label="Name Display Color"
        helpText="The color (or gradient) used for the character's name in chat messages and sidebar tabs. Supports gradients!"
      />

      {/* Dialogue Color */}
      <ColorPicker
        value={dialogueColor}
        onChange={(v) => updateExtension("dialogueColor", v)}
        label="Dialogue Highlight Color"
        helpText={
          'Text inside quotation marks ("", \u201c\u201d, \u00ab\u00bb) will be automatically bold and colored with this.'
        }
      />

      {/* Box Color */}
      <ColorPicker
        value={boxColor}
        onChange={(v) => updateExtension("boxColor", v)}
        label="Message Box Color"
        helpText="Background color for this character's chat message bubbles. Use a semi-transparent color for best results (e.g. rgba)."
      />

      {/* Info */}
      <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h4 className="mb-1.5 text-xs font-semibold">How colors work</h4>
        <ul className="space-y-1 text-[11px] text-[var(--muted-foreground)]">
          <li>
            &bull; <strong className="text-[var(--foreground)]">Name color</strong> — Applied to the character&apos;s
            display name in chat. Gradients use CSS linear-gradient.
          </li>
          <li>
            &bull; <strong className="text-[var(--foreground)]">Dialogue color</strong> — All text inside double quotes
            is automatically bold and colored with this value.
          </li>
          <li>
            &bull; <strong className="text-[var(--foreground)]">Box color</strong> — Sets the background color of the
            character&apos;s message bubble in roleplay mode.
          </li>
          <li>&bull; Leave any field empty to use the default theme colors.</li>
        </ul>
      </div>
    </div>
  );
}

function LorebookTab({ formData }: { formData: CharacterData }) {
  const book = formData.character_book;
  const entries = book?.entries ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Character Lorebook"
        subtitle="World-building entries embedded in this character. Triggered by keywords in conversation."
      />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-12 text-center">
          <Library size={24} className="text-[var(--muted-foreground)]/40" />
          <div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">No lorebook entries</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]/60">
              Import a character with an embedded lorebook, or add entries via the Lorebooks panel.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={entry.id ?? i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{entry.name || `Entry #${i + 1}`}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                    Keys: {entry.keys.join(", ")}{" "}
                    {entry.secondary_keys.length > 0 && `· Secondary: ${entry.secondary_keys.join(", ")}`}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    entry.enabled
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]",
                  )}
                >
                  {entry.enabled ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--muted-foreground)] line-clamp-3">{entry.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
