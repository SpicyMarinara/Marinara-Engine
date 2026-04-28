// ──────────────────────────────────────────────
// Persona Editor — Full-page detail view
// Replaces the chat area when editing a persona.
// Sections: Description, Personality, Backstory,
//           Appearance, Scenario
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { usePersonas, useUpdatePersona, useUploadPersonaAvatar, useDeletePersona } from "../../hooks/use-characters";
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
  Camera,
  Trash2,
  AlertTriangle,
  Palette,
  Activity,
  Plus,
  X,
  Maximize2,
  Tag,
  Image,
  Upload,
  FolderOpen,
  Loader2,
  Wand2,
  ImageDown,
} from "lucide-react";
import { cn, generateClientId } from "../../lib/utils";
import { showAlertDialog, showConfirmDialog } from "../../lib/app-dialogs";
import { extractColorsFromImage } from "../../lib/avatar-color-extraction";
import { HelpTooltip } from "../ui/HelpTooltip";
import { ColorPicker } from "../ui/ColorPicker";
import { ExpandedTextarea } from "../ui/ExpandedTextarea";
import { api } from "../../lib/api-client";
import {
  useCharacterSprites,
  useUploadSprite,
  useDeleteSprite,
  useSpriteCapabilities,
  spriteKeys,
  type SpriteInfo,
} from "../../hooks/use-characters";
import { useQueryClient } from "@tanstack/react-query";
import { SpriteGenerationModal } from "../ui/SpriteGenerationModal";

// ── Tabs ──
const TABS = [
  { id: "description", label: "Description", icon: FileText },
  { id: "personality", label: "Personality", icon: Heart },
  { id: "backstory", label: "Backstory", icon: BookOpen },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "scenario", label: "Scenario", icon: MapPin },
  { id: "sprites", label: "Sprites", icon: Image },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "stats", label: "Stats", icon: Activity },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AltDescriptionEntry {
  id: string;
  label: string;
  content: string;
  active: boolean;
}

interface PersonaFormData {
  name: string;
  comment: string;
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  appearance: string;
  nameColor: string;
  dialogueColor: string;
  boxColor: string;
  personaStats: string;
  altDescriptions: AltDescriptionEntry[];
  tags: string[];
}

interface PersonaRow {
  id: string;
  name: string;
  comment?: string;
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  appearance: string;
  avatarPath: string | null;
  isActive: string | boolean;
  nameColor?: string;
  dialogueColor?: string;
  boxColor?: string;
  personaStats?: string;
  altDescriptions?: string;
  tags?: string;
}

export function PersonaEditor() {
  const personaId = useUIStore((s) => s.personaDetailId);
  const closeDetail = useUIStore((s) => s.closePersonaDetail);
  const { data: allPersonas, isLoading } = usePersonas();
  const updatePersona = useUpdatePersona();
  const uploadAvatar = useUploadPersonaAvatar();
  const deletePersona = useDeletePersona();

  const [activeTab, setActiveTab] = useState<TabId>("description");
  const [formData, setFormData] = useState<PersonaFormData | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const loadedPersonaIdRef = useRef<string | null>(null);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [saving, setSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Find the persona from the list
  const rawPersona = (allPersonas as PersonaRow[] | undefined)?.find((p) => p.id === personaId);

  // Parse persona into form data when it first loads (or when switching personas).
  // Important: don't overwrite local unsaved edits if server data refetches (e.g. after avatar upload).
  useEffect(() => {
    if (!rawPersona) return;

    const isSwitchingPersona = loadedPersonaIdRef.current !== rawPersona.id;
    if (!isSwitchingPersona && dirty) return;

    loadedPersonaIdRef.current = rawPersona.id;

    let parsedAltDescs: AltDescriptionEntry[] = [];
    try {
      const raw = rawPersona.altDescriptions;
      if (raw) parsedAltDescs = JSON.parse(raw);
    } catch {
      /* ignore */
    }

    setFormData({
      name: rawPersona.name,
      comment: rawPersona.comment ?? "",
      description: rawPersona.description,
      personality: rawPersona.personality ?? "",
      scenario: rawPersona.scenario ?? "",
      backstory: rawPersona.backstory ?? "",
      appearance: rawPersona.appearance ?? "",
      nameColor: rawPersona.nameColor ?? "",
      dialogueColor: rawPersona.dialogueColor ?? "",
      boxColor: rawPersona.boxColor ?? "",
      personaStats: rawPersona.personaStats ?? "",
      altDescriptions: parsedAltDescs,
      tags: (() => {
        try {
          return rawPersona.tags ? JSON.parse(rawPersona.tags) : [];
        } catch {
          return [];
        }
      })(),
    });
    setAvatarPreview(rawPersona.avatarPath);
    setDirty(false);
  }, [rawPersona, dirty]);

  // Keep avatar preview in sync with server avatar changes without touching form data.
  useEffect(() => {
    const serverAvatarPath = rawPersona?.avatarPath ?? null;
    setAvatarPreview((prev) => prev ?? serverAvatarPath);
  }, [rawPersona?.avatarPath, rawPersona?.id]);

  const updateField = useCallback(<K extends keyof PersonaFormData>(key: K, value: PersonaFormData[K]) => {
    setFormData((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!personaId || !formData) return;
    setSaving(true);
    try {
      const { altDescriptions, tags, ...rest } = formData;
      await updatePersona.mutateAsync({
        id: personaId,
        ...rest,
        altDescriptions: JSON.stringify(altDescriptions),
        tags: JSON.stringify(tags),
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !personaId) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      try {
        await uploadAvatar.mutateAsync({
          id: personaId,
          avatar: dataUrl,
          filename: `persona-${personaId}-${Date.now()}.${file.name.split(".").pop()}`,
        });
      } catch {
        setAvatarPreview(rawPersona?.avatarPath ?? null);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDelete = async () => {
    if (!personaId) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Persona",
        message: "Are you sure you want to delete this persona?",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deletePersona.mutateAsync(personaId);
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
          className="group relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md shadow-emerald-500/20 max-md:h-10 max-md:w-10"
          onClick={() => fileInputRef.current?.click()}
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt={formData.name} className="h-full w-full object-cover" />
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
            placeholder="Persona name"
          />
          <input
            value={formData.comment}
            onChange={(e) => updateField("comment", e.target.value)}
            className="w-full bg-transparent text-xs text-[var(--muted-foreground)] outline-none"
            placeholder="Comment (e.g. 'Modern AU version')"
          />
          <p className="flex items-center gap-1 truncate text-xs text-[var(--muted-foreground)]">
            Your persona
            <HelpTooltip text="This is how the AI sees you. Fill in description, personality, backstory, and appearance — just like a character card. The active persona is injected into every prompt." />
          </p>
        </div>

        {/* Export */}
        <button
          onClick={() => api.download(`/characters/personas/${personaId}/export`)}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export persona"
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

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          title="Delete persona"
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
              ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white shadow-md shadow-emerald-500/20 hover:shadow-lg active:scale-[0.98]"
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
            className="rounded-lg bg-gradient-to-r from-emerald-400 to-teal-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md"
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
                    ? "bg-gradient-to-r from-emerald-400/15 to-teal-500/15 text-emerald-400 ring-1 ring-emerald-400/20"
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
            {activeTab === "description" && (
              <DescriptionTab formData={formData} updateField={updateField} setDirty={setDirty} />
            )}
            {activeTab === "personality" && (
              <TextareaTab
                title="Personality"
                subtitle="Your personality traits, temperament, and behavioral patterns."
                value={formData.personality}
                onChange={(v) => updateField("personality", v)}
                placeholder="Calm and analytical, but quick to act when someone's in danger. Has a dry sense of humor…"
                rows={8}
              />
            )}
            {activeTab === "backstory" && (
              <TextareaTab
                title="Backstory"
                subtitle="Your character's history, origin story, and formative life events."
                value={formData.backstory}
                onChange={(v) => updateField("backstory", v)}
                placeholder="Grew up in a frontier town, apprenticed under a traveling scholar…"
                rows={12}
              />
            )}
            {activeTab === "appearance" && (
              <TextareaTab
                title="Appearance"
                subtitle="Physical description — height, build, hair, eyes, clothing, distinguishing features."
                value={formData.appearance}
                onChange={(v) => updateField("appearance", v)}
                placeholder="Average height, dark hair worn loose. Prefers practical clothing — boots, a worn jacket…"
                rows={8}
              />
            )}
            {activeTab === "scenario" && (
              <TextareaTab
                title="Scenario"
                subtitle="Your default situation or context within roleplays."
                value={formData.scenario}
                onChange={(v) => updateField("scenario", v)}
                placeholder="A wandering adventurer seeking answers about a mysterious artifact…"
                rows={8}
              />
            )}
            {activeTab === "colors" && (
              <PersonaColorsTab formData={formData} updateField={updateField} avatarUrl={avatarPreview} />
            )}
            {activeTab === "sprites" && personaId && (
              <PersonaSpritesTab
                personaId={personaId}
                defaultAppearance={formData.appearance || formData.description}
                defaultAvatarUrl={avatarPreview}
              />
            )}
            {activeTab === "stats" && <PersonaStatsTab formData={formData} updateField={updateField} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Persona Sprites Tab ──

const DEFAULT_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "thinking",
  "laughing",
  "crying",
  "blushing",
  "smirk",
];

function PersonaSpritesTab({
  personaId,
  defaultAppearance,
  defaultAvatarUrl,
}: {
  personaId: string;
  defaultAppearance?: string;
  defaultAvatarUrl?: string | null;
}) {
  type SpriteCategory = "expressions" | "full-body";

  const { data: sprites, isLoading } = useCharacterSprites(personaId);
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
        await uploadSprite.mutateAsync({ characterId: personaId, expression, image: reader.result as string });
        setNewExpression("");
        pendingExpressionRef.current = "";
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const startUpload = (expression: string) => {
    if (!expression) return;
    pendingExpressionRef.current = expression;
    fileInputRef.current?.click();
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => /\.(png|jpg|jpeg|gif|webp|avif)$/i.test(f.name));
    if (imageFiles.length === 0) return;

    setFolderProgress({ done: 0, total: imageFiles.length });
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]!;
      const expression = file.name.replace(/\.[^.]+$/, "").trim();
      const normalized = normalizeExpressionForCategory(expression);
      if (!normalized) continue;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      try {
        await uploadSprite.mutateAsync({ characterId: personaId, expression: normalized, image: dataUrl });
      } catch {
        /* skip */
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
    await deleteSprite.mutateAsync({ characterId: personaId, expression });
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
    async (spritesToExport: SpriteInfo[]) => {
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

        if (successCount === 0) {
          await showAlertDialog({
            title: "Export Failed",
            message: "No sprites were exported. Please try again.",
            tone: "destructive",
          });
        }
      } finally {
        setExporting(false);
      }
    },
    [downloadSpriteFile],
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Persona Sprites</h3>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          Upload VN-style sprites for your persona. These are used in Game Mode and roleplay with the Expression Engine.
        </p>
      </div>

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
        // @ts-expect-error — webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        className="hidden"
        onChange={handleFolderUpload}
      />

      {/* Upload new expression */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <Upload size="0.8125rem" className="text-[var(--primary)]" />
            Add Sprite
          </h4>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <button
              onClick={() => setSpriteGenOpen(true)}
              disabled={spriteGenerationUnavailable}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-purple-500/10 px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-purple-400 ring-1 ring-purple-500/20 transition-all hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
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
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
              title="Select a folder of PNGs"
            >
              <FolderOpen size="0.8125rem" />
              Upload Folder
            </button>
            <button
              onClick={() => handleExportSprites(visibleSprites)}
              disabled={exporting || visibleSprites.length === 0}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
              title="Download currently visible sprites for external editing"
            >
              <ImageDown size="0.8125rem" />
              {exporting ? "Exporting..." : `Export ${category === "full-body" ? "Full-body" : "Expressions"}`}
            </button>
            <button
              onClick={() => handleExportSprites(allSprites)}
              disabled={exporting || allSprites.length === 0}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
              title="Download all sprites across both categories"
            >
              <ImageDown size="0.8125rem" />
              Export All
            </button>
          </div>
        </div>

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

      {/* Sprite Generation Modal */}
      <SpriteGenerationModal
        open={spriteGenOpen}
        onClose={() => setSpriteGenOpen(false)}
        entityId={personaId}
        initialSpriteType={category === "full-body" ? "full-body" : "expressions"}
        defaultAppearance={defaultAppearance}
        defaultAvatarUrl={defaultAvatarUrl}
        onSpritesGenerated={() => {
          queryClient.invalidateQueries({ queryKey: spriteKeys.list(personaId) });
        }}
      />
    </div>
  );
}

// ── Persona Colors Tab ──

function PersonaColorsTab({
  formData,
  updateField,
  avatarUrl,
}: {
  formData: PersonaFormData;
  updateField: <K extends keyof PersonaFormData>(key: K, value: PersonaFormData[K]) => void;
  avatarUrl: string | null;
}) {
  const [extracting, setExtracting] = useState(false);

  const handleExtract = async () => {
    if (!avatarUrl) return;
    setExtracting(true);
    try {
      const [nameColor, dialogueColor, boxColor] = await extractColorsFromImage(avatarUrl);
      updateField("nameColor", nameColor);
      updateField("dialogueColor", dialogueColor);
      updateField("boxColor", boxColor);
    } catch {
      // silently ignore — user can just pick colors manually
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Persona Colors"
        subtitle="Customize how your persona appears in chats. Colors are applied to your name, dialogue, and message bubble."
      />

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

      <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-3">
        <p className="text-[0.625rem] font-medium uppercase tracking-widest text-[var(--muted-foreground)]">Preview</p>
        <div className="flex gap-3 flex-row-reverse">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-500 to-neutral-600 ring-2 ring-white/15">
            <User size="1rem" className="text-white" />
          </div>
          <div className="flex-1 space-y-1 items-end flex flex-col">
            <span
              className="text-[0.75rem] font-bold tracking-tight"
              style={
                formData.nameColor
                  ? formData.nameColor.startsWith("linear-gradient")
                    ? {
                        background: formData.nameColor,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "100% 100%",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                        color: "transparent",
                        display: "inline-block",
                      }
                    : { color: formData.nameColor }
                  : { color: "rgb(212, 212, 212)" }
              }
            >
              {formData.name || "You"}
            </span>
            <div
              className="rounded-2xl rounded-tr-sm px-4 py-3 text-[0.8125rem] leading-[1.8] backdrop-blur-md ring-1 ring-white/10"
              style={
                formData.boxColor
                  ? { backgroundColor: formData.boxColor }
                  : { backgroundColor: "rgba(255, 255, 255, 0.12)" }
              }
            >
              <span className="text-neutral-100">*You step forward confidently.* </span>
              <strong
                style={formData.dialogueColor ? { color: formData.dialogueColor } : { color: "rgb(255, 255, 255)" }}
              >
                &ldquo;I&apos;m ready for this.&rdquo;
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Name Color */}
      <ColorPicker
        value={formData.nameColor}
        onChange={(v) => updateField("nameColor", v)}
        gradient
        label="Name Display Color"
        helpText="The color (or gradient) used for your persona's name in chat messages and persona selectors. Supports gradients!"
      />

      {/* Dialogue Color */}
      <ColorPicker
        value={formData.dialogueColor}
        onChange={(v) => updateField("dialogueColor", v)}
        label="Dialogue Highlight Color"
        helpText={
          'Text inside dialogue quotation marks ("", “”, «», 「」, 『』) will be automatically colored with this, and can also be bolded from Settings.'
        }
      />

      {/* Box Color */}
      <ColorPicker
        value={formData.boxColor}
        onChange={(v) => updateField("boxColor", v)}
        label="Message Box Color"
        helpText="Background color for your persona's chat message bubbles. Use a semi-transparent color for best results (e.g. rgba)."
      />

      <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h4 className="mb-1.5 text-xs font-semibold">How colors work</h4>
        <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
          <li>
            &bull; <strong className="text-[var(--foreground)]">Name color</strong> — Applied to your persona&apos;s
            display name in chat. Gradients use CSS linear-gradient.
          </li>
          <li>
            &bull; <strong className="text-[var(--foreground)]">Dialogue color</strong> — All text inside dialogue
            quotation marks is automatically colored with this value, and can optionally be bolded from Settings.
          </li>
          <li>
            &bull; <strong className="text-[var(--foreground)]">Box color</strong> — Sets the background color of your
            persona&apos;s message bubble.
          </li>
          <li>&bull; Leave any field empty to use the default theme colors.</li>
        </ul>
      </div>
    </div>
  );
}

// ── Persona Stats Tab ──

interface PersonaStatBar {
  name: string;
  value: number;
  max: number;
  color: string;
}

interface PersonaRPGAttribute {
  name: string;
  value: number;
}

interface PersonaRPGStats {
  enabled: boolean;
  attributes: PersonaRPGAttribute[];
  hp: { value: number; max: number };
}

interface PersonaStatsData {
  enabled: boolean;
  bars: PersonaStatBar[];
  rpgStats?: PersonaRPGStats;
}

const DEFAULT_RPG_STATS: PersonaRPGStats = {
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

const DEFAULT_PERSONA_STATS: PersonaStatsData = {
  enabled: false,
  bars: [
    { name: "Satiety", value: 100, max: 100, color: "#f59e0b" },
    { name: "Energy", value: 100, max: 100, color: "#22c55e" },
    { name: "Hygiene", value: 100, max: 100, color: "#3b82f6" },
    { name: "Mood", value: 100, max: 100, color: "#ec4899" },
  ],
  rpgStats: DEFAULT_RPG_STATS,
};

function PersonaStatsTab({
  formData,
  updateField,
}: {
  formData: PersonaFormData;
  updateField: <K extends keyof PersonaFormData>(key: K, value: PersonaFormData[K]) => void;
}) {
  const parsed: PersonaStatsData = formData.personaStats
    ? (() => {
        try {
          return JSON.parse(formData.personaStats) as PersonaStatsData;
        } catch {
          return DEFAULT_PERSONA_STATS;
        }
      })()
    : DEFAULT_PERSONA_STATS;

  const save = (next: PersonaStatsData) => {
    updateField("personaStats", JSON.stringify(next));
  };

  const updateBar = (index: number, field: string, value: string | number) => {
    const next = [...parsed.bars];
    next[index] = { ...next[index], [field]: value };
    save({ ...parsed, bars: next });
  };

  const addBar = () => {
    save({ ...parsed, bars: [...parsed.bars, { name: "New Stat", value: 100, max: 100, color: "#8b5cf6" }] });
  };

  const removeBar = (index: number) => {
    save({ ...parsed, bars: parsed.bars.filter((_, i) => i !== index) });
  };

  // RPG Attributes helpers
  const rpgStats: PersonaRPGStats = parsed.rpgStats ?? DEFAULT_RPG_STATS;

  const updateRpg = (patch: Partial<PersonaRPGStats>) => {
    save({ ...parsed, rpgStats: { ...rpgStats, ...patch } });
  };

  const updateRpgAttribute = (index: number, field: string, value: string | number) => {
    const next = [...rpgStats.attributes];
    next[index] = { ...next[index], [field]: value };
    updateRpg({ attributes: next });
  };

  const addRpgAttribute = () => {
    updateRpg({ attributes: [...rpgStats.attributes, { name: "NEW", value: 10 }] });
  };

  const removeRpgAttribute = (index: number) => {
    updateRpg({ attributes: rpgStats.attributes.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Persona Status Bars"
        subtitle="Track your persona's physical and mental needs. These are updated by the Persona Stats agent after each message."
      />

      {/* Enable toggle */}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input
          type="checkbox"
          checked={parsed.enabled}
          onChange={(e) => save({ ...parsed, enabled: e.target.checked })}
          className="h-4 w-4 rounded accent-emerald-500"
        />
        <div>
          <p className="text-sm font-medium">Enable Persona Stats</p>
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Tracked by the Persona Stats agent. Stats appear in the HUD and are adjusted based on narrative events.
          </p>
        </div>
      </label>

      {parsed.enabled && (
        <>
          {/* Stat bars */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Status Bars</h3>
              <button
                onClick={addBar}
                className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
              >
                <Plus size="0.75rem" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {parsed.bars.map((bar, i) => (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bar.color}
                      onChange={(e) => updateBar(i, "color", e.target.value)}
                      className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                    />
                    <input
                      value={bar.name}
                      onChange={(e) => updateBar(i, "name", e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs font-medium"
                      placeholder="Stat name"
                    />
                    <span className="text-[0.625rem] text-[var(--muted-foreground)]">max:</span>
                    <input
                      type="number"
                      value={bar.max}
                      onChange={(e) => updateBar(i, "max", parseInt(e.target.value) || 1)}
                      className="w-14 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs"
                      min={1}
                    />
                    <button
                      onClick={() => removeBar(i)}
                      className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                    >
                      <X size="0.75rem" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
            <h4 className="mb-1.5 text-xs font-semibold">How persona stats work</h4>
            <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
              <li>
                &bull; <strong className="text-[var(--foreground)]">Status bars</strong> — Represent your persona&apos;s
                physical and mental state (hunger, energy, hygiene, etc.)
              </li>
              <li>
                &bull; The <strong className="text-[var(--foreground)]">Persona Stats agent</strong> adjusts values
                realistically based on what happens in the narrative.
              </li>
              <li>
                &bull; Bars are displayed in the <strong className="text-[var(--foreground)]">HUD widget</strong> during
                chat with color-coded gradients.
              </li>
              <li>&bull; Values set here serve as the initial defaults for new conversations.</li>
            </ul>
          </div>
        </>
      )}

      {/* ── RPG Attributes ── */}
      <div className="border-t border-[var(--border)] pt-6">
        <SectionHeader
          title="RPG Attributes"
          subtitle="Define your persona's RPG stats (STR, DEX, etc.) and HP — just like character cards. Tracked via Persona Stats in the game state."
        />

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <input
            type="checkbox"
            checked={rpgStats.enabled}
            onChange={(e) => updateRpg({ enabled: e.target.checked })}
            className="h-4 w-4 rounded accent-purple-500"
          />
          <div>
            <p className="text-sm font-medium">Enable RPG Attributes</p>
            <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
              Attributes are injected into the prompt and tracked via Persona Stats in the game state.
            </p>
          </div>
        </label>

        {rpgStats.enabled && (
          <>
            {/* HP */}
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs font-semibold">Hit Points (HP)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)]">Max:</span>
                <input
                  type="number"
                  value={rpgStats.hp.max}
                  onChange={(e) => updateRpg({ hp: { ...rpgStats.hp, max: parseInt(e.target.value) || 1 } })}
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-center text-sm"
                  min={1}
                />
              </div>
            </div>

            {/* Attributes */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Attributes</h3>
                <button
                  onClick={addRpgAttribute}
                  className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-purple-400 transition-colors hover:bg-purple-500/25"
                >
                  <Plus size="0.75rem" />
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {rpgStats.attributes.map((attr, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <input
                      value={attr.name}
                      onChange={(e) => updateRpgAttribute(i, "name", e.target.value)}
                      className="w-20 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs font-medium"
                      placeholder="Name"
                    />
                    <input
                      type="number"
                      value={attr.value}
                      onChange={(e) => updateRpgAttribute(i, "value", parseInt(e.target.value) || 0)}
                      className="w-16 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs"
                    />
                    <button
                      onClick={() => removeRpgAttribute(i)}
                      className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                    >
                      <X size="0.75rem" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Info */}
            <div className="mt-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
              <h4 className="mb-1.5 text-xs font-semibold">How RPG attributes work</h4>
              <ul className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
                <li>
                  &bull; <strong className="text-[var(--foreground)]">HP</strong> — Injected into the prompt so the AI
                  knows your persona&apos;s current health.
                </li>
                <li>
                  &bull; <strong className="text-[var(--foreground)]">Attributes</strong> — Custom stats (STR, DEX,
                  etc.) that define your persona&apos;s capabilities.
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
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

// ── Description Tab with Alt Descriptions ──

function DescriptionTab({
  formData,
  updateField,
  setDirty: _setDirty,
}: {
  formData: PersonaFormData;
  updateField: <K extends keyof PersonaFormData>(key: K, value: PersonaFormData[K]) => void;
  setDirty: (v: boolean) => void;
}) {
  const altDescs = formData.altDescriptions;
  const [expandedField, setExpandedField] = useState<"description" | string | null>(null);
  const [newTag, setNewTag] = useState("");

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (formData.tags.includes(tag)) return;
    updateField("tags", [...formData.tags, tag]);
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    updateField(
      "tags",
      formData.tags.filter((t) => t !== tag),
    );
  };

  const updateAltDescs = (next: AltDescriptionEntry[]) => {
    updateField("altDescriptions", next);
  };

  const addAltDesc = () => {
    updateAltDescs([...altDescs, { id: generateClientId(), label: "Extension", content: "", active: true }]);
  };

  const toggleAltDesc = (id: string) => {
    updateAltDescs(altDescs.map((d) => (d.id === id ? { ...d, active: !d.active } : d)));
  };

  const updateAltDescField = (id: string, field: "label" | "content", value: string) => {
    updateAltDescs(altDescs.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  const removeAltDesc = (id: string) => {
    updateAltDescs(altDescs.filter((d) => d.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Main description */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Description</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Your general description. This is sent in every prompt so the AI knows who you are.
            </p>
          </div>
          <button
            onClick={() => setExpandedField("description")}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <textarea
          value={formData.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Describe who you are, your role in the story, and your key traits…"
          rows={12}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/20"
        />
        <p className="mt-1.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">
          {formData.description.length} characters
        </p>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          Tags{" "}
          <HelpTooltip text="Labels for organizing personas. Use tags like 'fantasy', 'modern', 'OC' etc. to categorize and filter." />
        </span>
        <div className="flex flex-wrap gap-1.5">
          {formData.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[0.6875rem] font-medium text-emerald-400"
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add tag…"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none focus:border-emerald-400/40"
          />
          <button
            onClick={addTag}
            className="rounded-xl bg-emerald-400/15 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-all hover:bg-emerald-400/25"
          >
            Add
          </button>
        </div>
      </div>

      {/* Alt Descriptions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Description Extensions</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Toggleable additions appended to your main description. Use these for situational details like combat
              skills, relationships, or temporary states.
            </p>
          </div>
          <button
            onClick={addAltDesc}
            className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
          >
            <Plus size="0.75rem" />
            Add
          </button>
        </div>

        {altDescs.length === 0 ? (
          <p className="text-[0.6875rem] text-[var(--muted-foreground)] italic">
            No description extensions yet. Add one to toggle extra context on and off.
          </p>
        ) : (
          <div className="space-y-3">
            {altDescs.map((desc) => (
              <div
                key={desc.id}
                className={cn(
                  "rounded-xl border bg-[var(--card)] p-4 transition-all",
                  desc.active
                    ? "border-emerald-400/30 ring-1 ring-emerald-400/10"
                    : "border-[var(--border)] opacity-60",
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  {/* Toggle */}
                  <button
                    onClick={() => toggleAltDesc(desc.id)}
                    className={cn(
                      "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                      desc.active ? "bg-emerald-500" : "bg-[var(--muted-foreground)]/30",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        desc.active && "translate-x-4",
                      )}
                    />
                  </button>
                  {/* Label */}
                  <input
                    value={desc.label}
                    onChange={(e) => updateAltDescField(desc.id, "label", e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-xs font-medium outline-none focus:border-emerald-400/40"
                    placeholder="Label (e.g. Combat Skills)"
                  />
                  {/* Remove */}
                  <button
                    onClick={() => removeAltDesc(desc.id)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                    title="Remove extension"
                  >
                    <X size="0.75rem" />
                  </button>
                  {/* Expand */}
                  <button
                    onClick={() => setExpandedField(desc.id)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    title="Expand editor"
                  >
                    <Maximize2 size="0.75rem" />
                  </button>
                </div>
                {/* Content */}
                <textarea
                  value={desc.content}
                  onChange={(e) => updateAltDescField(desc.id, "content", e.target.value)}
                  placeholder="Additional description content…"
                  rows={4}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/20"
                />
                <p className="mt-1 text-right text-[0.625rem] text-[var(--muted-foreground)]">
                  {desc.content.length} characters
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <ExpandedTextarea
        open={expandedField === "description"}
        onClose={() => setExpandedField(null)}
        title="Description"
        value={formData.description}
        onChange={(value) => updateField("description", value)}
        placeholder="Describe who you are, your role in the story, and your key traits…"
      />
      {altDescs.map((desc) => (
        <ExpandedTextarea
          key={desc.id}
          open={expandedField === desc.id}
          onClose={() => setExpandedField(null)}
          title={desc.label || "Description Extension"}
          value={desc.content}
          onChange={(value) => updateAltDescField(desc.id, "content", value)}
          placeholder="Additional description content…"
        />
      ))}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold">{title}</h3>
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
        </div>
        <button
          onClick={() => setExpanded(true)}
          className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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
        className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/20"
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
