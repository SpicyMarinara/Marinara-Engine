// ──────────────────────────────────────────────
// Character Editor — Full-page detail view
// Replaces the chat area when editing a character.
// Sections: Metadata, Description, Personality, Backstory,
//           Appearance, Scenario, Dialogue, Advanced, Lorebook
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCharacter,
  useUpdateCharacter,
  useUploadAvatar,
  useDeleteCharacter,
  useDuplicateCharacter,
  useCreatePersona,
  useUploadPersonaAvatar,
  useCharacterSprites,
  useCharacterGalleryImages,
  useUploadCharacterGalleryImage,
  useDeleteCharacterGalleryImage,
  useUploadSprite,
  useDeleteSprite,
  useSpriteCapabilities,
  spriteKeys,
  type CharacterGalleryImage,
  type SpriteInfo,
} from "../../hooks/use-characters";
import { useUIStore } from "../../stores/ui.store";
import { lorebookKeys } from "../../hooks/use-lorebooks";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { SpriteGenerationModal } from "../ui/SpriteGenerationModal";
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
  Copy,
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
  FolderOpen,
  Loader2,
  Swords,
  Crop,
  Maximize2,
  ImageDown,
  Download,
  Wand2,
  UserPlus,
} from "lucide-react";
import { cn, getAvatarCropStyle } from "../../lib/utils";
import { extractColorsFromImage } from "../../lib/avatar-color-extraction";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import { ColorPicker } from "../ui/ColorPicker";
import { ExpandedTextarea } from "../ui/ExpandedTextarea";
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
  { id: "gallery", label: "Gallery", icon: Camera },
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
  const duplicateCharacter = useDuplicateCharacter();
  const createPersona = useCreatePersona();
  const uploadPersonaAvatar = useUploadPersonaAvatar();

  const [activeTab, setActiveTab] = useState<TabId>("metadata");
  const [formData, setFormData] = useState<CharacterData | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
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
    } catch (err: any) {
      console.error("[CharacterEditor] Save failed:", err);
      toast.error(err?.message ?? "Failed to save character. Check the console for details.");
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
    if (
      !(await showConfirmDialog({
        title: "Delete Character",
        message: "Are you sure you want to delete this character?",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteCharacter.mutateAsync(characterId);
    closeDetail();
  };

  const getAvatarDataUrl = useCallback(async (src: string) => {
    if (src.startsWith("data:")) return src;

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error("Failed to read character avatar");
    }

    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Failed to convert avatar"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to convert avatar"));
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleImportAsPersona = useCallback(async () => {
    if (!formData) return;

    const personaName = formData.name.trim();
    if (!personaName) {
      toast.error("Character needs a name before it can be imported as a persona.");
      return;
    }

    const rpgStats = formData.extensions.rpgStats as RPGStatsConfig | undefined;
    const personaStats = rpgStats
      ? JSON.stringify({
          enabled: !!rpgStats.enabled,
          bars: [
            { name: "Satiety", value: 100, max: 100, color: "#f59e0b" },
            { name: "Energy", value: 100, max: 100, color: "#22c55e" },
            { name: "Hygiene", value: 100, max: 100, color: "#3b82f6" },
            { name: "Mood", value: 100, max: 100, color: "#ec4899" },
          ],
          rpgStats,
        })
      : "";

    try {
      const created = (await createPersona.mutateAsync({
        name: personaName,
        comment: formData.creator_notes ?? "",
        description: formData.description ?? "",
        personality: formData.personality ?? "",
        scenario: formData.scenario ?? "",
        backstory: (formData.extensions.backstory as string) ?? "",
        appearance: (formData.extensions.appearance as string) ?? "",
        nameColor: (formData.extensions.nameColor as string) ?? "",
        dialogueColor: (formData.extensions.dialogueColor as string) ?? "",
        boxColor: (formData.extensions.boxColor as string) ?? "",
        personaStats,
        altDescriptions: "[]",
        tags: JSON.stringify(formData.tags ?? []),
      })) as { id?: string };

      const personaId = created?.id;
      if (!personaId) {
        throw new Error("Persona was created without an id");
      }

      if (avatarPreview) {
        try {
          const avatarDataUrl = await getAvatarDataUrl(avatarPreview);
          const extMatch = avatarDataUrl.match(/^data:image\/([\w+]+)/);
          const ext = extMatch?.[1]?.replace("+xml", "") || "png";
          await uploadPersonaAvatar.mutateAsync({
            id: personaId,
            avatar: avatarDataUrl,
            filename: `persona-${personaId}-${Date.now()}.${ext}`,
          });
        } catch (error) {
          console.warn("[CharacterEditor] Failed to copy avatar to imported persona:", error);
          toast.error("Persona imported, but the avatar could not be copied.");
          return;
        }
      }

      toast.success(`Imported "${personaName}" as a persona.`);
    } catch (error) {
      console.error("[CharacterEditor] Failed to import character as persona:", error);
      toast.error(error instanceof Error ? error.message : "Failed to import character as persona.");
    }
  }, [avatarPreview, createPersona, formData, getAvatarDataUrl, uploadPersonaAvatar]);

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
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-2 max-md:px-3">
        <button
          onClick={handleClose}
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
          title="Back"
        >
          <ArrowLeft size="1.125rem" />
        </button>

        {/* Avatar */}
        <div
          className="group relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink-400 to-rose-500 shadow-md shadow-pink-500/20 max-md:h-10 max-md:w-10"
          onClick={() => fileInputRef.current?.click()}
        >
          {avatarPreview ? (
            <img
              src={avatarPreview}
              alt={formData.name}
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(
                formData.extensions.avatarCrop as { zoom: number; offsetX: number; offsetY: number } | undefined,
              )}
            />
          ) : (
            <User size="1.375rem" className="text-white" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size="1rem" className="text-white" />
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
          {formData.extensions.fav ? <Star size="1.125rem" fill="currentColor" /> : <StarOff size="1.125rem" />}
        </button>

        {/* Export */}
        <button
          onClick={() => api.download(`/characters/${characterId}/export`)}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export character"
        >
          <svg width="1.125rem" height="1.125rem" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M10 13V3m0 0l-4 4m4-4l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="3" y="15" width="14" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>

        {/* Import as persona */}
        <button
          onClick={handleImportAsPersona}
          disabled={createPersona.isPending || uploadPersonaAvatar.isPending}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-emerald-500/10 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          title="Import character as persona"
        >
          {createPersona.isPending || uploadPersonaAvatar.isPending ? (
            <Loader2 size="1.125rem" className="animate-spin" />
          ) : (
            <UserPlus size="1.125rem" />
          )}
        </button>

        {/* Export as PNG */}
        <button
          onClick={() => api.download(`/characters/${characterId}/export-png`, "character.png")}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export as PNG card"
        >
          <ImageDown size="1.125rem" />
        </button>
        {/* Duplicate */}
        <button
          onClick={() => {
            if (!characterId) return;
            duplicateCharacter.mutate(characterId, {
              onSuccess: () => {
                toast.success("Character duplicated");
              },
            });
          }}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-sky-400/10 hover:text-sky-400"
          title="Duplicate character"
        >
          <Copy size="1.125rem" />
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          title="Delete character"
        >
          <Trash2 size="1.125rem" />
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
          <Save size="0.8125rem" />
          <span className="max-md:hidden">{saving ? "Saving…" : "Save"}</span>
        </button>
      </div>

      {/* ── Unsaved changes warning ── */}
      {showUnsavedWarning && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertTriangle size="0.9375rem" className="shrink-0 text-amber-500" />
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
      <div className="flex flex-1 overflow-hidden @max-5xl:flex-col">
        {/* Tab Rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 @max-5xl:w-full @max-5xl:flex-row @max-5xl:overflow-x-auto @max-5xl:border-r-0 @max-5xl:border-b @max-5xl:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all text-left @max-5xl:whitespace-nowrap @max-5xl:px-2.5 @max-5xl:py-1.5",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-pink-400/15 to-purple-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon size="0.875rem" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
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
                avatarPreview={avatarPreview}
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
            {activeTab === "sprites" && characterId && (
              <SpritesTab
                characterId={characterId}
                defaultAppearance={(formData.extensions.appearance as string) ?? formData.description}
                defaultAvatarUrl={avatarPreview}
              />
            )}
            {activeTab === "gallery" && characterId && (
              <CharacterGalleryTab characterId={characterId} characterName={formData.name} />
            )}
            {activeTab === "colors" && (
              <ColorsTab formData={formData} updateExtension={updateExtension} avatarUrl={avatarPreview} />
            )}
            {activeTab === "stats" && <StatsTab formData={formData} updateExtension={updateExtension} />}
            {activeTab === "lorebook" && <LorebookTab characterId={characterId} formData={formData} />}
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
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-4">
        <SectionHeader title={title} subtitle={subtitle} />
        <button
          onClick={() => setExpanded(true)}
          className="mt-0.5 shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Expand editor"
        >
          <Maximize2 size="0.875rem" />
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
      />
      <p className="mt-1.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">{value.length} characters</p>
      <ExpandedTextarea
        open={expanded}
        onClose={() => setExpanded(false)}
        title={title}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
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
  avatarPreview,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
  newTag: string;
  setNewTag: (v: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  avatarPreview: string | null;
}) {
  const crop = (formData.extensions.avatarCrop as { zoom: number; offsetX: number; offsetY: number } | undefined) ?? {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };

  const setCrop = (next: { zoom: number; offsetX: number; offsetY: number }) => {
    updateExtension("avatarCrop", next);
  };

  // Drag-to-reposition state
  const dragRef = useRef<{ startX: number; startY: number; startOX: number; startOY: number } | null>(null);
  const didDragRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [showFullImage, setShowFullImage] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (crop.zoom <= 1) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOX: crop.offsetX, startOY: crop.offsetY };
    didDragRef.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !previewRef.current) return;
    didDragRef.current = true;
    const rect = previewRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / rect.height) * 100;
    const maxOffset = ((crop.zoom - 1) / crop.zoom) * 50;
    const ox = Math.max(-maxOffset, Math.min(maxOffset, dragRef.current.startOX + dx / crop.zoom));
    const oy = Math.max(-maxOffset, Math.min(maxOffset, dragRef.current.startOY + dy / crop.zoom));
    setCrop({ ...crop, offsetX: Math.round(ox * 100) / 100, offsetY: Math.round(oy * 100) / 100 });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="space-y-5">
      <SectionHeader title="Metadata" subtitle="Basic character info — name, creator, version, tags." />

      {/* Avatar Crop / Zoom */}
      {avatarPreview && (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            <Crop size="0.75rem" /> Avatar Zoom & Position
          </span>
          <div className="flex items-start gap-4 max-sm:flex-col max-sm:items-center">
            {/* Preview */}
            <div
              ref={previewRef}
              className="relative h-28 w-28 shrink-0 cursor-grab overflow-hidden rounded-full bg-black/20 ring-2 ring-[var(--border)] active:cursor-grabbing touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={() => {
                if (crop.zoom <= 1 || !didDragRef.current) setShowFullImage(true);
              }}
              title="Click to view full image"
            >
              <img
                src={avatarPreview}
                alt={formData.name}
                className="h-full w-full object-cover"
                draggable={false}
                style={{
                  transform:
                    crop.zoom > 1 ? `scale(${crop.zoom}) translate(${crop.offsetX}%, ${crop.offsetY}%)` : undefined,
                }}
              />
            </div>
            {/* Controls */}
            <div className="flex flex-1 flex-col gap-2">
              <label className="space-y-1">
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">Zoom: {crop.zoom.toFixed(2)}x</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={crop.zoom}
                  onChange={(e) => {
                    const z = parseFloat(e.target.value);
                    const maxOffset = ((z - 1) / z) * 50;
                    setCrop({
                      zoom: z,
                      offsetX: Math.max(-maxOffset, Math.min(maxOffset, crop.offsetX)),
                      offsetY: Math.max(-maxOffset, Math.min(maxOffset, crop.offsetY)),
                    });
                  }}
                  className="w-full accent-[var(--primary)]"
                />
              </label>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                {crop.zoom > 1 ? "Drag the preview to reposition" : "Click preview to view full image"}
              </p>
              {crop.zoom > 1 && (
                <button
                  type="button"
                  onClick={() => setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })}
                  className="self-start rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-all hover:text-[var(--foreground)]"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          {showFullImage && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
              onClick={() => setShowFullImage(false)}
            >
              <img
                src={avatarPreview}
                alt={formData.name}
                className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
              />
              <button
                onClick={() => setShowFullImage(false)}
                className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              >
                <X size="1rem" />
              </button>
            </div>
          )}
        </div>
      )}

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
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">
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
              className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--primary)]"
            >
              <Tag size="0.625rem" />
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full transition-colors hover:text-[var(--destructive)]"
              >
                <X size="0.625rem" />
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
  const [expandedField, setExpandedField] = useState<"first_mes" | "mes_example" | number | null>(null);

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
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            First Message{" "}
            <HelpTooltip text="The character's opening message when a new chat starts. Good first messages set the scene and establish the character's voice." />
          </span>
          <button
            onClick={() => setExpandedField("first_mes")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
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
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 pr-16 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40"
              placeholder={`Greeting #${i + 1}…`}
            />
            <div className="absolute right-2 top-2 flex items-center gap-0.5">
              <button
                onClick={() => setExpandedField(i)}
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                title="Expand editor"
              >
                <Maximize2 size="0.75rem" />
              </button>
              <button
                onClick={() => removeGreeting(i)}
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
              >
                <Trash2 size="0.75rem" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Example Messages */}
      <label className="block space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Example Dialogue{" "}
            <HelpTooltip text="Sample conversations showing how the character talks. Helps the AI learn the character's speaking style, vocabulary, and mannerisms." />
          </span>
          <button
            onClick={() => setExpandedField("mes_example")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <p className="text-[0.625rem] text-[var(--muted-foreground)]/70">
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

      <ExpandedTextarea
        open={expandedField === "first_mes"}
        onClose={() => setExpandedField(null)}
        title="First Message"
        value={formData.first_mes}
        onChange={(value) => updateField("first_mes", value)}
        placeholder="What does the character say when they first meet someone? Use *asterisks* for actions…"
      />
      <ExpandedTextarea
        open={expandedField === "mes_example"}
        onClose={() => setExpandedField(null)}
        title="Example Dialogue"
        value={formData.mes_example}
        onChange={(value) => updateField("mes_example", value)}
        placeholder={"<START>\n{{user}}: Hello!\n{{char}}: *waves excitedly* Hey there!"}
      />
      {formData.alternate_greetings.map((g, i) => (
        <ExpandedTextarea
          key={i}
          open={expandedField === i}
          onClose={() => setExpandedField(null)}
          title={`Alternate Greeting #${i + 1}`}
          value={g}
          onChange={(value) => updateGreeting(i, value)}
          placeholder={`Greeting #${i + 1}…`}
        />
      ))}
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
  const [expandedField, setExpandedField] = useState<"system_prompt" | "post_history" | "depth_prompt" | null>(null);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Advanced"
        subtitle="System prompt, post-history instructions, and depth prompt injection."
      />

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            System Prompt{" "}
            <HelpTooltip text="Overrides or appends to the main system prompt when this character is active. Use this for character-specific instructions the AI must follow." />
          </span>
          <button
            onClick={() => setExpandedField("system_prompt")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <textarea
          value={formData.system_prompt}
          onChange={(e) => updateField("system_prompt", e.target.value)}
          rows={6}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm outline-none placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          placeholder="Override or append to the system prompt for this character…"
        />
      </label>

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Post-History Instructions{" "}
            <HelpTooltip text="Text inserted after the chat history, right before the AI generates. Great for reminders like 'stay in character' or 'respond in 2 paragraphs'." />
          </span>
          <button
            onClick={() => setExpandedField("post_history")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
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
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            Depth Prompt{" "}
            <HelpTooltip text="Injects text at a specific position in the chat history. Depth 0 = at the end, depth 4 = 4 messages back. Useful for persistent reminders." />
          </span>
          <button
            onClick={() => setExpandedField("depth_prompt")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
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

      <ExpandedTextarea
        open={expandedField === "system_prompt"}
        onClose={() => setExpandedField(null)}
        title="System Prompt"
        value={formData.system_prompt}
        onChange={(value) => updateField("system_prompt", value)}
        placeholder="Override or append to the system prompt for this character…"
      />
      <ExpandedTextarea
        open={expandedField === "post_history"}
        onClose={() => setExpandedField(null)}
        title="Post-History Instructions"
        value={formData.post_history_instructions}
        onChange={(value) => updateField("post_history_instructions", value)}
        placeholder="Text inserted after the chat history but before generation…"
      />
      <ExpandedTextarea
        open={expandedField === "depth_prompt"}
        onClose={() => setExpandedField(null)}
        title="Depth Prompt"
        value={depthPrompt.prompt}
        onChange={(value) => updateExtension("depth_prompt", { ...depthPrompt, prompt: value })}
        placeholder="Prompt injected at a specific depth in the chat history…"
      />
    </div>
  );
}

// ── Sprites Tab ──

function CharacterGalleryTab({ characterId, characterName }: { characterId: string; characterName?: string }) {
  const { data: images, isLoading } = useCharacterGalleryImages(characterId);
  const upload = useUploadCharacterGalleryImage(characterId);
  const remove = useDeleteCharacterGalleryImage(characterId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<CharacterGalleryImage | null>(null);

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      upload.mutate(formData);
      e.target.value = "";
    },
    [upload],
  );

  const handleDelete = useCallback(
    async (image: CharacterGalleryImage) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Character Image",
          message: "Delete this character gallery image?",
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      remove.mutate(image.id);
      if (lightbox?.id === image.id) setLightbox(null);
    },
    [lightbox?.id, remove],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Character Gallery"
        subtitle="Keep reference art, alternate outfits, and other character images attached to this character even if chats get deleted."
      />

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
      >
        <Upload size="1rem" />
        {upload.isPending ? "Uploading…" : "Upload Character Image"}
      </button>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer aspect-square rounded-xl" />
          ))}
        </div>
      ) : images && images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image) => (
            <div
              key={image.id}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)]/30 hover:shadow-md"
            >
              <button className="block aspect-square w-full bg-[var(--secondary)]" onClick={() => setLightbox(image)}>
                <img
                  src={image.url}
                  alt={image.prompt || characterName || "Character image"}
                  className="h-full w-full object-cover"
                />
              </button>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/25 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <span className="max-w-[8rem] truncate text-[0.6875rem] font-medium text-white/85">
                  {new Date(image.createdAt).toLocaleDateString()}
                </span>
                <div className="flex gap-1">
                  <a
                    href={image.url}
                    download
                    className="rounded-lg bg-white/15 p-1.5 text-white transition-colors hover:bg-white/25"
                    title="Download"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download size="0.75rem" />
                  </a>
                  <button
                    onClick={() => void handleDelete(image)}
                    className="rounded-lg bg-red-500/35 p-1.5 text-white transition-colors hover:bg-red-500/55"
                    title="Delete"
                  >
                    <Trash2 size="0.75rem" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-12 text-center">
          <Camera size="1.75rem" className="text-[var(--muted-foreground)]/40" />
          <div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">No character images yet</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]/60">
              Upload images here to keep them tied to {characterName || "this character"} instead of a specific chat.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h4 className="mb-1.5 text-xs font-semibold">How this differs from chat gallery</h4>
        <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
          <li>• These images belong to the character, so deleting a chat does not remove them.</li>
          <li>• Use this for reference sheets, outfit variants, or imported ST-style character image packs.</li>
          <li>• Chat gallery is still best for scene-specific illustrations and generated message attachments.</li>
        </ul>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 max-md:pt-[env(safe-area-inset-top)]"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw] w-[min(90vw,90vh)]" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.url}
              alt={lightbox.prompt || characterName || "Character image"}
              className="max-h-[85vh] w-full rounded-lg object-contain shadow-2xl"
            />
            <div className="absolute right-2 top-2 flex gap-2">
              <a
                href={lightbox.url}
                download
                className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              >
                <Download size="0.875rem" />
              </a>
              <button
                onClick={() => setLightbox(null)}
                className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              >
                <X size="0.875rem" />
              </button>
            </div>
          </div>
        </div>
      )}
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

function SpritesTab({
  characterId,
  defaultAppearance,
  defaultAvatarUrl,
}: {
  characterId: string;
  defaultAppearance?: string;
  defaultAvatarUrl?: string | null;
}) {
  type SpriteCategory = "expressions" | "full-body";

  const { data: sprites, isLoading } = useCharacterSprites(characterId);
  const { data: spriteCapabilities } = useSpriteCapabilities();
  const uploadSprite = useUploadSprite();
  const deleteSprite = useDeleteSprite();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SpriteCategory>("expressions");
  const [newExpression, setNewExpression] = useState("");
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number } | null>(null);
  const [spriteGenOpen, setSpriteGenOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingExpressionRef = useRef("");

  const allSprites = (sprites as SpriteInfo[] | undefined) ?? [];
  const visibleSprites = allSprites.filter((s) =>
    category === "full-body" ? s.expression.startsWith("full_") : !s.expression.startsWith("full_"),
  );
  const existingExpressions = new Set(
    visibleSprites.map((s) => (category === "full-body" ? s.expression.replace(/^full_/, "") : s.expression)),
  );
  const suggestedExpressions = DEFAULT_EXPRESSIONS.filter((e) => !existingExpressions.has(e));
  const spriteGenerationUnavailable = spriteCapabilities?.spriteGenerationAvailable === false;
  const spriteGenerationReason = spriteCapabilities?.reason ?? "Sprite generation is unavailable on this platform.";

  const normalizeExpressionForCategory = (raw: string) => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");
    if (!cleaned) return "";
    if (category === "full-body") {
      return cleaned.startsWith("full_") ? cleaned : `full_${cleaned}`;
    }
    return cleaned.replace(/^full_/, "");
  };

  const displayExpression = (stored: string) => (category === "full-body" ? stored.replace(/^full_/, "") : stored);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const expression = pendingExpressionRef.current || normalizeExpressionForCategory(newExpression);
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
    if (!expression) return;
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
      const expression = file.name.replace(/\.[^.]+$/, "").trim();
      const normalized = normalizeExpressionForCategory(expression);
      if (!normalized) continue;

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      try {
        await uploadSprite.mutateAsync({ characterId, expression: normalized, image: dataUrl });
      } catch {
        // Skip failed uploads, continue with the rest
      }
      setFolderProgress({ done: i + 1, total: imageFiles.length });
    }

    setFolderProgress(null);
    e.target.value = "";
  };

  const handleDelete = async (expression: string) => {
    if (
      !(await showConfirmDialog({
        title: "Delete Sprite",
        message: `Delete sprite for "${expression}"?`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteSprite.mutateAsync({ characterId, expression });
  };

  const downloadSpriteFile = useCallback(async (sprite: SpriteInfo) => {
    const response = await fetch(sprite.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${sprite.expression}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = sprite.filename || `${sprite.expression}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, []);

  const handleExportSprites = useCallback(
    async (spritesToExport: SpriteInfo[], modeLabel: string) => {
      if (spritesToExport.length === 0) return;

      setExporting(true);
      let successCount = 0;

      try {
        for (const sprite of spritesToExport) {
          try {
            await downloadSpriteFile(sprite);
            successCount += 1;
          } catch {
            // Continue exporting remaining sprites.
          }
        }

        if (successCount > 0) {
          toast.success(
            modeLabel === "all"
              ? `Exported ${successCount} sprite${successCount === 1 ? "" : "s"}.`
              : `Exported ${successCount} ${category === "full-body" ? "full-body" : "expression"} sprite${successCount === 1 ? "" : "s"}.`,
          );
        } else {
          toast.error("No sprites were exported. Please try again.");
        }
      } finally {
        setExporting(false);
      }
    },
    [category, downloadSpriteFile],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Character Sprites"
        subtitle="Upload VN-style sprites for different expressions. The Expression Engine agent will select the appropriate sprite during roleplay."
      />

      <div className="inline-flex rounded-xl bg-[var(--secondary)] p-1 ring-1 ring-[var(--border)]">
        <button
          onClick={() => setCategory("expressions")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            category === "expressions"
              ? "bg-[var(--primary)]/15 text-[var(--primary)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          Facial Expressions
        </button>
        <button
          onClick={() => setCategory("full-body")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            category === "full-body"
              ? "bg-[var(--primary)]/15 text-[var(--primary)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          Full-body
        </button>
      </div>

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
            <Upload size="0.8125rem" className="text-[var(--primary)]" />
            Add Sprite
          </h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSpriteGenOpen(true)}
              disabled={spriteGenerationUnavailable}
              className="flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-3 py-1.5 text-[0.6875rem] font-medium text-purple-400 ring-1 ring-purple-500/20 transition-all hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                spriteGenerationUnavailable ? spriteGenerationReason : "Generate sprites using AI image generation"
              }
            >
              <Wand2 size="0.8125rem" />
              Generate Sprite
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={!!folderProgress}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
              title="Select a folder of PNGs — each filename becomes the expression name"
            >
              <FolderOpen size="0.8125rem" />
              Upload Folder
            </button>
            <button
              onClick={() => handleExportSprites(visibleSprites, "visible")}
              disabled={exporting || visibleSprites.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
              title="Download currently visible sprites for external editing"
            >
              <ImageDown size="0.8125rem" />
              {exporting ? "Exporting..." : `Export ${category === "full-body" ? "Full-body" : "Expressions"}`}
            </button>
            <button
              onClick={() => handleExportSprites(allSprites, "all")}
              disabled={exporting || allSprites.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
              title="Download all sprites across both categories"
            >
              <ImageDown size="0.8125rem" />
              Export All
            </button>
          </div>
        </div>

        {/* Folder upload progress */}
        {folderProgress && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.75rem" className="animate-spin text-[var(--primary)]" />
            Uploading {folderProgress.done}/{folderProgress.total} sprites…
          </div>
        )}
        {spriteGenerationUnavailable && (
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {spriteGenerationReason}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newExpression}
            onChange={(e) => setNewExpression(e.target.value)}
            placeholder={
              category === "full-body"
                ? "Pose name (e.g. idle, walk, battle_stance)…"
                : "Expression name (e.g. happy, sad, angry)…"
            }
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newExpression.trim()) {
                startUpload(normalizeExpressionForCategory(newExpression));
              }
            }}
          />
          <button
            onClick={() => newExpression.trim() && startUpload(normalizeExpressionForCategory(newExpression))}
            disabled={!newExpression.trim() || uploading}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:shadow-md disabled:opacity-40"
          >
            <Plus size="0.8125rem" />
            Upload
          </button>
        </div>

        {/* Quick expression buttons */}
        {category === "expressions" && suggestedExpressions.length > 0 && (
          <div>
            <p className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">Quick add:</p>
            <div className="flex flex-wrap gap-1">
              {suggestedExpressions.slice(0, 12).map((expr) => (
                <button
                  key={expr}
                  onClick={() => startUpload(expr)}
                  className="rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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
      ) : visibleSprites.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {visibleSprites.map((sprite) => (
            <div
              key={sprite.expression}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)]/30 hover:shadow-md"
            >
              <div className="aspect-[3/4] bg-[var(--secondary)]">
                <img src={sprite.url} alt={sprite.expression} loading="lazy" className="h-full w-full object-contain" />
              </div>
              <div className="flex items-center justify-between p-2">
                <span
                  className="max-w-[10rem] truncate text-[0.6875rem] font-medium capitalize"
                  title={displayExpression(sprite.expression)}
                >
                  {displayExpression(sprite.expression)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
                  <button
                    onClick={() => void downloadSpriteFile(sprite)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Download"
                  >
                    <ImageDown size="0.6875rem" />
                  </button>
                  <button
                    onClick={() => startUpload(sprite.expression)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Replace"
                  >
                    <Upload size="0.6875rem" />
                  </button>
                  <button
                    onClick={() => handleDelete(sprite.expression)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    title="Delete"
                  >
                    <Trash2 size="0.6875rem" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-12 text-center">
          <Image size="1.75rem" className="text-[var(--muted-foreground)]/40" />
          <div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">No sprites yet</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]/60">
              {category === "full-body"
                ? "Upload full-body sprites above. Use transparent PNGs for best results."
                : "Upload expression sprites above. Use transparent PNGs for best results."}
            </p>
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h4 className="mb-1.5 text-xs font-semibold">How sprites work</h4>
        <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
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

      {/* Sprite Generation Modal */}
      <SpriteGenerationModal
        open={spriteGenOpen}
        onClose={() => setSpriteGenOpen(false)}
        entityId={characterId}
        initialSpriteType={category === "full-body" ? "full-body" : "expressions"}
        defaultAppearance={defaultAppearance}
        defaultAvatarUrl={defaultAvatarUrl}
        onSpritesGenerated={() => {
          queryClient.invalidateQueries({ queryKey: spriteKeys.list(characterId) });
        }}
      />
    </div>
  );
}

// ── Stats Tab ──

const DEFAULT_RPG_STATS: RPGStatsConfig = {
  enabled: false,
  attributes: [
    { name: "STR", value: 10 },
    { name: "DEX", value: 10 },
    { name: "CON", value: 10 },
    { name: "INT", value: 10 },
    { name: "WIS", value: 10 },
    { name: "CHA", value: 10 },
  ],
  hp: { value: 100, max: 100 },
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
    update({ attributes: [...stats.attributes, { name: "NEW", value: 10 }] });
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
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Stats will be injected into the prompt and tracked by the Character Tracker agent.
          </p>
        </div>
      </label>

      {stats.enabled && (
        <>
          {/* HP */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-xs font-semibold">Hit Points (HP)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">Max:</span>
              <input
                type="number"
                value={stats.hp.max}
                onChange={(e) => update({ hp: { ...stats.hp, max: parseInt(e.target.value) || 1 } })}
                className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                min={1}
              />
            </div>
          </div>

          {/* Attributes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Attributes</h3>
              <button
                onClick={addAttribute}
                className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-purple-400 transition-colors hover:bg-purple-500/25"
              >
                <Plus size="0.75rem" />
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
                  <button
                    onClick={() => removeAttribute(i)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                  >
                    <X size="0.75rem" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
            <h4 className="mb-1.5 text-xs font-semibold">How stats work</h4>
            <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
              <li>
                &bull; <strong className="text-[var(--foreground)]">HP</strong> — Injected into the prompt so the AI
                knows the character&apos;s current health.
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
        {extracting ? <Loader2 size="0.875rem" className="animate-spin" /> : <Palette size="0.875rem" />}
        {extracting ? "Extracting..." : avatarUrl ? "Extract Colors from Avatar" : "Upload an avatar first"}
      </button>

      {/* Preview card */}
      <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-3">
        <p className="text-[0.625rem] font-medium uppercase tracking-widest text-[var(--muted-foreground)]">Preview</p>
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-600 ring-2 ring-purple-400/20">
            <User size="1rem" className="text-white" />
          </div>
          <div className="flex-1 space-y-1">
            <span
              className="text-[0.75rem] font-bold tracking-tight"
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
              className="rounded-2xl rounded-tl-sm px-4 py-3 text-[0.8125rem] leading-[1.8] backdrop-blur-md ring-1 ring-white/8"
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
          'Text inside dialogue quotation marks ("", “”, «», 「」, 『』) will be automatically colored with this, and can also be bolded from Settings.'
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
        <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
          <li>
            &bull; <strong className="text-[var(--foreground)]">Name color</strong> — Applied to the character&apos;s
            display name in chat. Gradients use CSS linear-gradient.
          </li>
          <li>
            &bull; <strong className="text-[var(--foreground)]">Dialogue color</strong> — All text inside dialogue
            quotation marks is automatically colored with this value, and can optionally be bolded from Settings.
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

function LorebookTab({ characterId, formData }: { characterId: string | null; formData: CharacterData }) {
  const book = formData.character_book;
  const entries = book?.entries ?? [];
  const qc = useQueryClient();
  const openLorebookDetail = useUIStore((s) => s.openLorebookDetail);
  const [importing, setImporting] = useState(false);
  const importMetadata =
    formData.extensions.importMetadata && typeof formData.extensions.importMetadata === "object"
      ? (formData.extensions.importMetadata as Record<string, unknown>)
      : {};
  const embeddedLorebookMetadata =
    importMetadata.embeddedLorebook && typeof importMetadata.embeddedLorebook === "object"
      ? (importMetadata.embeddedLorebook as Record<string, unknown>)
      : {};
  const linkedLorebookId =
    typeof embeddedLorebookMetadata.lorebookId === "string" ? embeddedLorebookMetadata.lorebookId : null;
  const hasEmbeddedLorebook = entries.length > 0 || embeddedLorebookMetadata.hasEmbeddedLorebook === true;

  const handleImportEmbeddedLorebook = async () => {
    if (!characterId) return;
    setImporting(true);
    try {
      const result = await api.post<{
        success: boolean;
        lorebookId: string;
        entriesImported: number;
        reimported?: boolean;
      }>(`/characters/${characterId}/embedded-lorebook/import`);
      qc.invalidateQueries({ queryKey: lorebookKeys.all });
      if (result.lorebookId) {
        qc.invalidateQueries({ queryKey: ["characters", "detail", characterId] });
      }
      toast.success(
        result.reimported
          ? `Reimported ${result.entriesImported} embedded lorebook entr${result.entriesImported === 1 ? "y" : "ies"}`
          : `Imported ${result.entriesImported} embedded lorebook entr${result.entriesImported === 1 ? "y" : "ies"}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import embedded lorebook");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Character Lorebook"
        subtitle="World-building entries embedded in this character. Triggered by keywords in conversation."
      />

      {hasEmbeddedLorebook && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5">
          <button
            type="button"
            onClick={handleImportEmbeddedLorebook}
            disabled={!characterId || importing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              importing || !characterId
                ? "cursor-not-allowed bg-[var(--accent)] text-[var(--muted-foreground)]"
                : "bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25",
            )}
          >
            {importing ? <Loader2 size="0.75rem" className="animate-spin" /> : <Library size="0.75rem" />}
            {linkedLorebookId ? "Reimport Embedded Lorebook" : "Import Embedded Lorebook"}
          </button>
          {linkedLorebookId && (
            <button
              type="button"
              onClick={() => openLorebookDetail(linkedLorebookId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
            >
              <Library size="0.75rem" />
              Edit Linked Lorebook
            </button>
          )}
          <span className="text-[0.6875rem] text-[var(--muted-foreground)]">
            {linkedLorebookId
              ? "Opens the lorebook editor where you can add, edit, or delete entries."
              : "Imports this embedded lorebook into Marinara as a linked lorebook."}
          </span>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-12 text-center">
          <Library size="1.5rem" className="text-[var(--muted-foreground)]/40" />
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
                  <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                    Keys: {entry.keys.join(", ")}{" "}
                    {entry.secondary_keys.length > 0 && `· Secondary: ${entry.secondary_keys.join(", ")}`}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-medium",
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
