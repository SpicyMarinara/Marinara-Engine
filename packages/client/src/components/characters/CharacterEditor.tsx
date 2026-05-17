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
  useCleanupSavedSprites,
  useRestoreSpriteCleanupBackup,
  useSpriteCapabilities,
  useCharacterVersions,
  useRestoreCharacterVersion,
  useDeleteCharacterVersion,
  spriteKeys,
  type CharacterGalleryImage,
  type SpriteInfo,
} from "../../hooks/use-characters";
import { useUIStore } from "../../stores/ui.store";
import { lorebookKeys, useLorebook } from "../../hooks/use-lorebooks";
import { useStartChatFromCharacter } from "../../hooks/use-start-chat-from-character";
import { useConnections } from "../../hooks/use-connections";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { SpriteGenerationModal } from "../ui/SpriteGenerationModal";
import { AvatarGenerationModal } from "../ui/AvatarGenerationModal";
import { AvatarCropWidget } from "../ui/AvatarCropWidget";
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
  Eraser,
  Wand2,
  UserPlus,
  History,
  RotateCcw,
} from "lucide-react";
import { cn, generateClientId, getAvatarCropStyle, type AvatarCrop, type LegacyAvatarCrop } from "../../lib/utils";
import { extractColorsFromImage } from "../../lib/avatar-color-extraction";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import { ColorPicker } from "../ui/ColorPicker";
import { TrackerCardColorControls } from "../ui/TrackerCardColorControls";
import { ExpandedTextarea } from "../ui/ExpandedTextarea";
import { Modal } from "../ui/Modal";
import { SpriteFrameEditor } from "../ui/SpriteFrameEditor";
import { SpriteWandCleanupEditor } from "../ui/SpriteWandCleanupEditor";
import { ExportFormatDialog, type ExportFormatChoice } from "../ui/ExportFormatDialog";
import type { CharacterCardVersion, CharacterData, RPGStatsConfig } from "@marinara-engine/shared";
import { parseTrackerCardColorConfig, serializeTrackerCardColorConfig } from "../../lib/tracker-card-colors";

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

interface AltDescriptionEntry {
  id: string;
  label: string;
  content: string;
  active: boolean;
}

interface ParsedCharacter {
  id: string;
  data: string;
  comment: string;
  avatarPath: string | null;
  spriteFolderPath: string | null;
}

function normalizeAltDescriptions(value: unknown): AltDescriptionEntry[] {
  const raw = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry, index) => ({
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `extension-${index}`,
      label: typeof entry.label === "string" ? entry.label : "Extension",
      content: typeof entry.content === "string" ? entry.content : "",
      active: entry.active !== false,
    }));
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
  const { startChatFromCharacter, isStartingChat } = useStartChatFromCharacter();
  const { data: connectionsList } = useConnections();

  const [activeTab, setActiveTab] = useState<TabId>("metadata");
  const [formData, setFormData] = useState<CharacterData | null>(null);
  const [characterComment, setCharacterComment] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const loadedCharacterIdRef = useRef<string | null>(null);
  const activeCharacterIdRef = useRef<string | null>(characterId);
  const dirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  const setDirtyState = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, []);
  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    setDirtyState(true);
  }, [setDirtyState]);
  useEffect(() => {
    dirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [avatarGeneratorOpen, setAvatarGeneratorOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestAvatarUploadRef = useRef<{ token: string; characterId: string } | null>(null);
  const avatarUploadInFlightRef = useRef(false);
  const imageGenerationAvailable =
    Array.isArray(connectionsList) &&
    (connectionsList as Array<{ provider?: string }>).some((connection) => connection.provider === "image_generation");

  useEffect(() => {
    activeCharacterIdRef.current = characterId;
    const upload = latestAvatarUploadRef.current;
    if (upload && upload.characterId !== characterId) {
      latestAvatarUploadRef.current = null;
      avatarUploadInFlightRef.current = false;
      setAvatarUploading(false);
    }
  }, [characterId]);

  // Parse the character when it first loads, or when switching characters.
  // Avoid overwriting unsaved local edits when a refetch follows avatar upload.
  useEffect(() => {
    if (!rawCharacter) return;
    const char = rawCharacter as ParsedCharacter;
    const isSwitchingCharacter = loadedCharacterIdRef.current !== char.id;
    if (!isSwitchingCharacter && dirtyRef.current) return;

    loadedCharacterIdRef.current = char.id;

    try {
      const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
      setFormData(parsed as CharacterData);
      setCharacterComment(char.comment ?? "");
      setAvatarPreview(char.avatarPath);
      setDirtyState(false);
    } catch {
      setFormData(null);
      setCharacterComment("");
      setAvatarPreview(null);
      setDirtyState(false);
    }
  }, [rawCharacter, setDirtyState]);

  const updateField = useCallback(<K extends keyof CharacterData>(key: K, value: CharacterData[K]) => {
    setFormData((prev) => (prev ? { ...prev, [key]: value } : prev));
    markDirty();
  }, [markDirty]);

  const setExtensionValue = useCallback((key: string, value: unknown) => {
    setFormData((prev) => {
      if (!prev) return prev;
      return { ...prev, extensions: { ...(prev.extensions ?? {}), [key]: value } };
    });
  }, []);

  const updateExtension = useCallback(
    (key: string, value: unknown) => {
      setExtensionValue(key, value);
      markDirty();
    },
    [markDirty, setExtensionValue],
  );

  const beginAvatarUpload = useCallback(() => {
    if (avatarUploadInFlightRef.current) return false;
    avatarUploadInFlightRef.current = true;
    setAvatarUploading(true);
    return true;
  }, []);

  const isCurrentAvatarUpload = useCallback((uploadToken: string, uploadCharacterId: string) => {
    const upload = latestAvatarUploadRef.current;
    return (
      upload?.token === uploadToken &&
      upload.characterId === uploadCharacterId &&
      activeCharacterIdRef.current === uploadCharacterId
    );
  }, []);

  const finishAvatarUpload = useCallback((uploadToken: string, uploadCharacterId: string) => {
    const upload = latestAvatarUploadRef.current;
    if (upload?.token !== uploadToken || upload.characterId !== uploadCharacterId) return;
    latestAvatarUploadRef.current = null;
    avatarUploadInFlightRef.current = false;
    setAvatarUploading(false);
  }, []);

  const handleSave = async () => {
    if (!characterId || !formData) return false;
    if (avatarUploadInFlightRef.current) {
      toast.error("Wait for the current avatar upload to finish before saving.");
      return false;
    }
    setSaving(true);
    const editRevisionAtSaveStart = editRevisionRef.current;
    try {
      await updateCharacter.mutateAsync({
        id: characterId,
        data: formData as unknown as Record<string, unknown>,
        comment: characterComment,
      });
      if (editRevisionRef.current === editRevisionAtSaveStart) {
        setDirtyState(false);
      }
      return true;
    } catch (err: any) {
      console.error("[CharacterEditor] Save failed:", err);
      toast.error(err?.message ?? "Failed to save character. Check the console for details.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !characterId) return;
    if (saving) {
      e.target.value = "";
      toast.error("Wait for the current save to finish before uploading an avatar.");
      return;
    }
    if (!beginAvatarUpload()) {
      e.target.value = "";
      toast.error("Wait for the current avatar upload to finish.");
      return;
    }

    const uploadCharacterId = characterId;
    const uploadToken = generateClientId();
    latestAvatarUploadRef.current = { token: uploadToken, characterId: uploadCharacterId };
    const fallbackAvatarPreview = avatarPreview;
    const fallbackAvatarCrop = formData?.extensions.avatarCrop;
    const shouldClearAvatarCrop = fallbackAvatarCrop !== undefined;
    const fallbackDirty = dirtyRef.current;
    const editRevisionAtUploadStart = editRevisionRef.current;

    const reader = new FileReader();
    reader.onload = async () => {
      if (!isCurrentAvatarUpload(uploadToken, uploadCharacterId)) return;
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      // Clear any saved avatarCrop — the new image almost certainly has different
      // framing, so the prior normalized crop coords are meaningless and would
      // produce a stale framing on the new file.
      if (shouldClearAvatarCrop) {
        setExtensionValue("avatarCrop", undefined);
      }
      if (fallbackDirty || shouldClearAvatarCrop) {
        setDirtyState(true);
      }
      try {
        await uploadAvatar.mutateAsync({ id: uploadCharacterId, avatar: dataUrl });
      } catch {
        if (!isCurrentAvatarUpload(uploadToken, uploadCharacterId)) return;
        setAvatarPreview(fallbackAvatarPreview);
        if (shouldClearAvatarCrop) {
          setExtensionValue("avatarCrop", fallbackAvatarCrop);
        }
        if (editRevisionRef.current === editRevisionAtUploadStart) {
          setDirtyState(fallbackDirty);
        }
      } finally {
        finishAvatarUpload(uploadToken, uploadCharacterId);
      }
    };
    reader.onerror = () => {
      if (!isCurrentAvatarUpload(uploadToken, uploadCharacterId)) return;
      toast.error("Failed to read avatar image.");
      finishAvatarUpload(uploadToken, uploadCharacterId);
    };
    e.target.value = "";
    try {
      reader.readAsDataURL(file);
    } catch {
      toast.error("Failed to read avatar image.");
      finishAvatarUpload(uploadToken, uploadCharacterId);
    }
  };

  const handleGeneratedAvatar = useCallback(
    async (avatarDataUrl: string) => {
      if (!characterId) return;
      if (saving) {
        throw new Error("Wait for the current save to finish before uploading an avatar.");
      }
      if (!beginAvatarUpload()) {
        throw new Error("Wait for the current avatar upload to finish.");
      }
      const uploadCharacterId = characterId;
      const uploadToken = generateClientId();
      latestAvatarUploadRef.current = { token: uploadToken, characterId: uploadCharacterId };
      const fallbackAvatarPreview = avatarPreview;
      const fallbackAvatarCrop = formData?.extensions.avatarCrop;
      const shouldClearAvatarCrop = fallbackAvatarCrop !== undefined;
      const fallbackDirty = dirtyRef.current;
      const editRevisionAtUploadStart = editRevisionRef.current;

      setAvatarPreview(avatarDataUrl);
      if (shouldClearAvatarCrop) {
        setExtensionValue("avatarCrop", undefined);
      }
      if (fallbackDirty || shouldClearAvatarCrop) {
        setDirtyState(true);
      }
      try {
        await uploadAvatar.mutateAsync({ id: uploadCharacterId, avatar: avatarDataUrl });
        if (isCurrentAvatarUpload(uploadToken, uploadCharacterId)) {
          toast.success("Character avatar generated.");
        }
      } catch (error) {
        if (isCurrentAvatarUpload(uploadToken, uploadCharacterId)) {
          setAvatarPreview(fallbackAvatarPreview);
          if (shouldClearAvatarCrop) {
            setExtensionValue("avatarCrop", fallbackAvatarCrop);
          }
          if (editRevisionRef.current === editRevisionAtUploadStart) {
            setDirtyState(fallbackDirty);
          }
        }
        throw error;
      } finally {
        finishAvatarUpload(uploadToken, uploadCharacterId);
      }
    },
    [
      avatarPreview,
      beginAvatarUpload,
      characterId,
      finishAvatarUpload,
      formData?.extensions.avatarCrop,
      isCurrentAvatarUpload,
      saving,
      setDirtyState,
      setExtensionValue,
      uploadAvatar,
    ],
  );

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
        trackerCardColors: serializeTrackerCardColorConfig(
          parseTrackerCardColorConfig(formData.extensions.trackerCardColors),
        ),
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
    if (avatarUploading) {
      toast.error("Wait for the current avatar upload to finish.");
      return;
    }
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeDetail();
  }, [avatarUploading, dirty, closeDetail]);

  const forceClose = useCallback(() => {
    if (avatarUploading) {
      toast.error("Wait for the current avatar upload to finish.");
      return;
    }
    setShowUnsavedWarning(false);
    setDirtyState(false);
    closeDetail();
  }, [avatarUploading, closeDetail, setDirtyState]);

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

  const removeAllTags = () => {
    if (!formData || formData.tags.length === 0) return;
    updateField("tags", []);
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

  const headerActionButtonClass =
    "rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] max-md:rounded-lg max-md:p-1.5";
  const saveDisabled = !dirty || saving || avatarUploading;

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => {
          if (!characterId) return;
          startChatFromCharacter({
            characterId,
            characterName: formData.name,
            mode: "roleplay",
            firstMessage: formData.first_mes,
            alternateGreetings: formData.alternate_greetings,
          });
        }}
        disabled={!characterId || isStartingChat}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 max-md:rounded-lg max-md:px-2.5 max-md:py-1.5"
        title="Start new chat"
      >
        <MessageCircle size="1rem" />
        <span className="max-sm:hidden">Start Chat</span>
      </button>

      <button
        type="button"
        onClick={() => updateExtension("fav", !formData.extensions.fav)}
        className={cn(
          "rounded-xl p-2 transition-all max-md:rounded-lg max-md:p-1.5",
          formData.extensions.fav ? "text-yellow-400" : "text-[var(--muted-foreground)] hover:text-yellow-400",
        )}
        title={formData.extensions.fav ? "Remove from favorites" : "Add to favorites"}
      >
        {formData.extensions.fav ? <Star size="1rem" fill="currentColor" /> : <StarOff size="1rem" />}
      </button>

      <button type="button" onClick={() => setExportDialogOpen(true)} className={headerActionButtonClass} title="Export character">
        <svg width="1rem" height="1rem" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
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

      <button
        type="button"
        onClick={handleImportAsPersona}
        disabled={createPersona.isPending || uploadPersonaAvatar.isPending}
        className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-emerald-500/10 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 max-md:rounded-lg max-md:p-1.5"
        title="Import character as persona"
      >
        {createPersona.isPending || uploadPersonaAvatar.isPending ? (
          <Loader2 size="1rem" className="animate-spin" />
        ) : (
          <UserPlus size="1rem" />
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          if (!characterId) return;
          duplicateCharacter.mutate(characterId, {
            onSuccess: () => {
              toast.success("Character duplicated");
            },
          });
        }}
        className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-sky-400/10 hover:text-sky-400 max-md:rounded-lg max-md:p-1.5"
        title="Duplicate character"
      >
        <Copy size="1rem" />
      </button>

      <button
        type="button"
        onClick={handleDelete}
        className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] max-md:rounded-lg max-md:p-1.5"
        title="Delete character"
      >
        <Trash2 size="1rem" />
      </button>
    </>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <ExportFormatDialog
        open={exportDialogOpen}
        title="Export Character"
        description="Native keeps Marinara metadata. Compatible exports direct Chara Card V2 JSON for other platforms."
        compatibleDescription="Exports direct Chara Card V2 JSON without the Marinara wrapper."
        showPngOption
        onClose={() => setExportDialogOpen(false)}
        onSelect={(format: ExportFormatChoice) => {
          if (!characterId) return;
          setExportDialogOpen(false);
          if (format === "compatible-png") {
            void api.download(`/characters/${characterId}/export-png`, "character.png");
          } else {
            void api.download(`/characters/${characterId}/export?format=${format}`);
          }
        }}
      />
      <AvatarGenerationModal
        open={avatarGeneratorOpen}
        title="Generate Character Avatar"
        entityName={formData.name}
        defaultAppearance={
          ((formData.extensions.appearance as string | undefined) || formData.description || formData.personality) ?? ""
        }
        defaultAvatarUrl={avatarPreview}
        onClose={() => setAvatarGeneratorOpen(false)}
        onUseAvatar={handleGeneratedAvatar}
      />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-2 max-md:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 max-md:min-w-full">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95 max-md:rounded-lg max-md:p-1.5"
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
                style={getAvatarCropStyle(formData.extensions.avatarCrop as AvatarCrop | LegacyAvatarCrop | undefined)}
              />
            ) : (
              <User size="1.375rem" className="text-white" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera size="1rem" className="text-white" />
            </div>
            {imageGenerationAvailable && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setAvatarGeneratorOpen(true);
                }}
                className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--card)]/95 text-[var(--primary)] opacity-0 shadow-md ring-1 ring-[var(--border)] transition-opacity hover:bg-[var(--card)] group-hover:opacity-100 max-md:opacity-100"
                title="Generate avatar"
              >
                <Wand2 size="0.75rem" />
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>

          <div className="min-w-0 flex-1">
            <input
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="w-full bg-transparent text-lg font-bold outline-none"
              placeholder="Character name"
            />
            <input
              value={characterComment}
              onChange={(e) => {
                setCharacterComment(e.target.value);
                markDirty();
              }}
              className="w-full bg-transparent text-xs text-[var(--muted-foreground)] outline-none"
              placeholder="Title / comment (e.g. 'Modern AU version')"
            />
            <p className="truncate text-[0.625rem] text-[var(--muted-foreground)]">
              {formData.creator ? `by ${formData.creator}` : "No creator"} · v{formData.character_version || "1.0"}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-1 md:flex">{headerActions}</div>

        {/* Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium transition-all",
            !saveDisabled
              ? "bg-gradient-to-r from-pink-400 to-purple-500 text-white shadow-md shadow-pink-500/20 hover:shadow-lg active:scale-[0.98]"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)] cursor-not-allowed",
          )}
        >
          <Save size="0.8125rem" />
          <span className="max-md:hidden">{avatarUploading ? "Uploading…" : saving ? "Saving…" : "Save"}</span>
        </button>

        <div className="flex w-full items-center justify-end gap-1 md:hidden">{headerActions}</div>
      </div>

      {/* ── Unsaved changes warning ── */}
      {showUnsavedWarning && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertTriangle size="0.9375rem" className="shrink-0 text-amber-500" />
          <p className="flex-1 text-xs font-medium text-amber-500">You have unsaved changes. Close without saving?</p>
          <button
            type="button"
            onClick={() => setShowUnsavedWarning(false)}
            className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={forceClose}
            disabled={avatarUploading}
            className="rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-500 transition-all hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discard & close
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await handleSave()) {
                closeDetail();
              }
            }}
            disabled={saving || avatarUploading}
            className="rounded-lg bg-gradient-to-r from-pink-400 to-purple-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
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
                type="button"
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
                characterId={characterId}
                formData={formData}
                characterComment={characterComment}
                updateField={updateField}
                updateExtension={updateExtension}
                newTag={newTag}
                setNewTag={setNewTag}
                addTag={addTag}
                removeTag={removeTag}
                removeAllTags={removeAllTags}
                avatarPreview={avatarPreview}
              />
            )}
            {activeTab === "description" && (
              <CharacterDescriptionTab
                formData={formData}
                updateField={updateField}
                updateExtension={updateExtension}
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

function CharacterDescriptionTab({
  formData,
  updateField,
  updateExtension,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
}) {
  const altDescs = normalizeAltDescriptions(formData.extensions?.altDescriptions);
  const [expandedField, setExpandedField] = useState<"description" | string | null>(null);

  const updateAltDescs = (next: AltDescriptionEntry[]) => {
    updateExtension("altDescriptions", next);
  };

  const addAltDesc = () => {
    updateAltDescs([...altDescs, { id: generateClientId(), label: "Extension", content: "", active: true }]);
  };

  const toggleAltDesc = (id: string) => {
    updateAltDescs(altDescs.map((desc) => (desc.id === id ? { ...desc, active: !desc.active } : desc)));
  };

  const updateAltDescField = (id: string, field: "label" | "content", value: string) => {
    updateAltDescs(altDescs.map((desc) => (desc.id === id ? { ...desc, [field]: value } : desc)));
  };

  const removeAltDesc = (id: string) => {
    updateAltDescs(altDescs.filter((desc) => desc.id !== id));
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-2 mb-4">
          <SectionHeader
            title="Description"
            subtitle="The character's general description. This is sent in every prompt as part of the character's identity."
          />
          <button
            type="button"
            onClick={() => setExpandedField("description")}
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <textarea
          value={formData.description}
          onChange={(event) => updateField("description", event.target.value)}
          placeholder="Describe who this character is, their role, and their key traits…"
          rows={12}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
        />
        <p className="mt-1.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">
          {formData.description.length} characters
        </p>
      </div>

      <div>
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Description Extensions</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Toggleable additions appended to this character's main description. Use these for situational states,
              relationships, combat details, or story-phase context.
            </p>
          </div>
          <button
            type="button"
            onClick={addAltDesc}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--primary)]/15 px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/25"
          >
            <Plus size="0.75rem" />
            Add
          </button>
        </div>

        {altDescs.length === 0 ? (
          <p className="text-[0.6875rem] italic text-[var(--muted-foreground)]">
            No description extensions yet. Add one to toggle extra character context on and off.
          </p>
        ) : (
          <div className="space-y-3">
            {altDescs.map((desc) => (
              <div
                key={desc.id}
                className={cn(
                  "rounded-xl border bg-[var(--card)] p-4 transition-all",
                  desc.active
                    ? "border-[var(--primary)]/30 ring-1 ring-[var(--primary)]/10"
                    : "border-[var(--border)] opacity-60",
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAltDesc(desc.id)}
                    className={cn(
                      "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                      desc.active ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30",
                    )}
                    title={desc.active ? "Disable extension" : "Enable extension"}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-[var(--primary-foreground)] shadow-sm transition-transform",
                        desc.active && "translate-x-4",
                      )}
                    />
                  </button>
                  <input
                    value={desc.label}
                    onChange={(event) => updateAltDescField(desc.id, "label", event.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-xs font-medium outline-none focus:border-[var(--primary)]/40"
                    placeholder="Label (e.g. Combat Skills)"
                  />
                  <button
                    type="button"
                    onClick={() => removeAltDesc(desc.id)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    title="Remove extension"
                  >
                    <X size="0.75rem" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedField(desc.id)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Expand editor"
                  >
                    <Maximize2 size="0.75rem" />
                  </button>
                </div>
                <textarea
                  value={desc.content}
                  onChange={(event) => updateAltDescField(desc.id, "content", event.target.value)}
                  placeholder="Additional description content…"
                  rows={4}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
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
        placeholder="Describe who this character is, their role, and their key traits…"
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
          type="button"
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
  characterId,
  formData,
  characterComment,
  updateField,
  updateExtension,
  newTag,
  setNewTag,
  addTag,
  removeTag,
  removeAllTags,
  avatarPreview,
}: {
  characterId: string | null;
  formData: CharacterData;
  characterComment: string;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  updateExtension: (key: string, value: unknown) => void;
  newTag: string;
  setNewTag: (v: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  removeAllTags: () => void;
  avatarPreview: string | null;
}) {
  // Read existing crop in either current or legacy shape; the widget handles both
  // and writes back the current shape on first interaction.
  const savedCrop = (formData.extensions.avatarCrop as AvatarCrop | LegacyAvatarCrop | undefined) ?? null;

  return (
    <div className="space-y-5">
      <SectionHeader title="Metadata" subtitle="Basic character info — name, creator, version, tags." />

      {/* Avatar Crop */}
      {avatarPreview && (
        <AvatarCropWidget
          src={avatarPreview}
          alt={formData.name}
          crop={savedCrop}
          onChange={(next) => updateExtension("avatarCrop", next)}
        />
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
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Version <HelpTooltip text="Version number for tracking changes to this character definition over time." />
          </span>
          <input
            value={formData.character_version}
            onChange={(e) => updateField("character_version", e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            placeholder="1.0"
          />
          <CharacterVersionHistoryPanel
            characterId={characterId}
            currentData={formData}
            currentComment={characterComment}
            currentAvatarPath={avatarPreview}
          />
        </div>
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
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Tags{" "}
            <HelpTooltip text="Labels for organizing characters. Use tags like 'fantasy', 'sci-fi', 'OC' etc. to categorize and search." />
          </span>
          {formData.tags.length > 0 && (
            <button
              type="button"
              onClick={removeAllTags}
              className="rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
            >
              Remove All
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {formData.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--primary)]"
            >
              <Tag size="0.625rem" />
              {tag}
              <button
                type="button"
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
            type="button"
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

const VERSION_COMPARE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description" },
  { key: "personality", label: "Personality" },
  { key: "scenario", label: "Scenario" },
  { key: "first_mes", label: "First Message" },
  { key: "mes_example", label: "Example Dialogue" },
  { key: "extensions.backstory", label: "Backstory" },
  { key: "extensions.appearance", label: "Appearance" },
  { key: "creator_notes", label: "Creator Notes" },
  { key: "system_prompt", label: "System Prompt" },
  { key: "post_history_instructions", label: "Post-History Instructions" },
];

function getVersionFieldValue(data: CharacterData, key: string): string {
  if (key === "extensions.backstory" || key === "extensions.appearance") {
    const extensionKey = key.split(".")[1] ?? "";
    const value = data.extensions?.[extensionKey];
    return typeof value === "string" ? value : "";
  }
  const value = data[key as keyof CharacterData];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function formatVersionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getVersionTitle(version: CharacterCardVersion): string {
  return version.version?.trim() ? `v${version.version}` : "Untitled version";
}

function CharacterVersionHistoryPanel({
  characterId,
  currentData,
  currentComment,
  currentAvatarPath,
}: {
  characterId: string | null;
  currentData: CharacterData;
  currentComment: string;
  currentAvatarPath: string | null;
}) {
  const { data: versions = [], isLoading } = useCharacterVersions(characterId);
  const restoreVersion = useRestoreCharacterVersion();
  const deleteVersion = useDeleteCharacterVersion();
  const [selectedVersion, setSelectedVersion] = useState<CharacterCardVersion | null>(null);

  if (!characterId) return null;

  const handleRestore = async (version: CharacterCardVersion) => {
    const confirmed = await showConfirmDialog({
      title: "Restore Character Version",
      message: `Restore ${currentData.name || "this character"} to ${getVersionTitle(version)}? The current card will become exactly that saved version without creating another history entry.`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;
    try {
      await restoreVersion.mutateAsync({ id: characterId, versionId: version.id });
      toast.success(`Restored ${getVersionTitle(version)}.`);
      setSelectedVersion(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore character version.");
    }
  };

  const handleDeleteVersion = async (version: CharacterCardVersion) => {
    const confirmed = await showConfirmDialog({
      title: "Delete Saved Version",
      message: `Delete ${getVersionTitle(version)} from version history? This does not change the current character card.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteVersion.mutateAsync({ id: characterId, versionId: version.id });
      toast.success(`Deleted ${getVersionTitle(version)}.`);
      setSelectedVersion((current) => (current?.id === version.id ? null : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete character version.");
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
          <History size="0.75rem" />
          Version history
        </span>
        <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
          {isLoading ? "Loading" : `${versions.length} saved`}
        </span>
      </div>

      {versions.length === 0 ? (
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
          Previous card states will appear here after the next edit.
        </p>
      ) : (
        <div className="mt-2 flex max-h-36 flex-col gap-1.5 overflow-y-auto pr-1">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => setSelectedVersion(version)}
                className="min-w-0 flex-1 text-left"
                title="Compare with current card"
              >
                <span className="block truncate text-[0.6875rem] font-medium text-[var(--foreground)]">
                  {getVersionTitle(version)}
                </span>
                <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                  {formatVersionTimestamp(version.createdAt)}
                  {version.source ? ` · ${version.source}` : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleRestore(version)}
                disabled={restoreVersion.isPending || deleteVersion.isPending}
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                title="Restore this version"
              >
                {restoreVersion.isPending ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <RotateCcw size="0.75rem" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteVersion(version)}
                disabled={restoreVersion.isPending || deleteVersion.isPending}
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-50"
                title="Delete this saved version"
              >
                {deleteVersion.isPending && deleteVersion.variables?.versionId === version.id ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <Trash2 size="0.75rem" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!selectedVersion}
        onClose={() => setSelectedVersion(null)}
        title={selectedVersion ? `Compare ${getVersionTitle(selectedVersion)}` : "Compare Version"}
        width="max-w-5xl"
      >
        {selectedVersion && (
          <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-xs md:grid-cols-2">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Current card</p>
                <p className="mt-1 text-[var(--muted-foreground)]">
                  v{currentData.character_version || "1.0"}
                  {currentComment ? ` · ${currentComment}` : ""}
                  {currentAvatarPath ? " · has avatar" : ""}
                </p>
              </div>
              <div>
                <p className="font-semibold text-[var(--foreground)]">{getVersionTitle(selectedVersion)}</p>
                <p className="mt-1 text-[var(--muted-foreground)]">
                  {formatVersionTimestamp(selectedVersion.createdAt)}
                  {selectedVersion.reason ? ` · ${selectedVersion.reason}` : ""}
                  {selectedVersion.avatarPath ? " · has avatar" : ""}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {VERSION_COMPARE_FIELDS.map((field) => {
                const currentValue = getVersionFieldValue(currentData, field.key);
                const savedValue = getVersionFieldValue(selectedVersion.data, field.key);
                const changed = currentValue !== savedValue;
                if (!changed && !currentValue && !savedValue) return null;
                return (
                  <div key={field.key} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--foreground)]">{field.label}</span>
                      {changed && (
                        <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[0.625rem] font-medium text-[var(--primary)]">
                          changed
                        </span>
                      )}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="min-h-20 whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2 text-xs leading-relaxed text-[var(--foreground)]">
                        {currentValue || <span className="text-[var(--muted-foreground)]">Empty</span>}
                      </div>
                      <div className="min-h-20 whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2 text-xs leading-relaxed text-[var(--foreground)]">
                        {savedValue || <span className="text-[var(--muted-foreground)]">Empty</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => handleRestore(selectedVersion)}
                disabled={restoreVersion.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {restoreVersion.isPending ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <RotateCcw size="0.75rem" />
                )}
                Restore this version
              </button>
            </div>
          </div>
        )}
      </Modal>
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
            type="button"
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
            type="button"
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
                type="button"
                onClick={() => setExpandedField(i)}
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                title="Expand editor"
              >
                <Maximize2 size="0.75rem" />
              </button>
              <button
                type="button"
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
            type="button"
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
            type="button"
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
            type="button"
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
            type="button"
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
      const input = e.currentTarget;
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      upload.mutate(files, {
        onSettled: () => {
          input.value = "";
        },
      });
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

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
      >
        <Upload size="1rem" />
        {upload.isPending ? "Uploading…" : "Upload Character Images"}
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
              <button type="button" className="block aspect-square w-full bg-[var(--secondary)]" onClick={() => setLightbox(image)}>
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
                    type="button"
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
                type="button"
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
  const cleanupSavedSprites = useCleanupSavedSprites();
  const restoreSpriteCleanupBackup = useRestoreSpriteCleanupBackup();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SpriteCategory>("expressions");
  const [newExpression, setNewExpression] = useState("");
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cleaningSprites, setCleaningSprites] = useState(false);
  const [savedCleanupStrength, setSavedCleanupStrength] = useState(35);
  const [restoringCleanup, setRestoringCleanup] = useState(false);
  const [lastCleanupBackupId, setLastCleanupBackupId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [framingSprite, setFramingSprite] = useState<SpriteInfo | null>(null);
  const [savingFrame, setSavingFrame] = useState(false);
  const [wandCleanupSprite, setWandCleanupSprite] = useState<SpriteInfo | null>(null);
  const [savingWandCleanup, setSavingWandCleanup] = useState(false);
  const [deleteSpriteRequest, setDeleteSpriteRequest] = useState<SpriteInfo | null>(null);
  const [deletingSprites, setDeletingSprites] = useState<"single" | "all" | null>(null);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number } | null>(null);
  const [spriteGenOpen, setSpriteGenOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingExpressionRef = useRef("");

  const allSprites = (sprites as SpriteInfo[] | undefined) ?? [];
  const portraitExpressionNames = allSprites
    .filter((s) => !s.expression.toLowerCase().startsWith("full_"))
    .map((s) => s.expression);
  const visibleSprites = allSprites.filter((s) =>
    category === "full-body" ? s.expression.startsWith("full_") : !s.expression.startsWith("full_"),
  );
  const existingExpressions = new Set(
    visibleSprites.map((s) => (category === "full-body" ? s.expression.replace(/^full_/, "") : s.expression)),
  );
  const suggestedExpressions = DEFAULT_EXPRESSIONS.filter((e) => !existingExpressions.has(e));
  const spriteGenerationUnavailable = spriteCapabilities?.spriteGenerationAvailable === false;
  const spriteGenerationReason = spriteCapabilities?.reason ?? "Sprite generation is unavailable on this platform.";
  const backgroundCleanupUnavailable = spriteCapabilities?.backgroundRemovalAvailable === false;
  const backgroundCleanupReason = spriteCapabilities?.reason ?? "Background cleanup is unavailable on this platform.";
  const backgroundRemoverUnavailable = spriteCapabilities?.backgroundRemover?.installed === false;
  const backgroundRemoverReason =
    spriteCapabilities?.backgroundRemover?.reason ?? "Local backgroundremover is not installed.";

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

  const displayExpression = useCallback(
    (stored: string) => (category === "full-body" ? stored.replace(/^full_/, "") : stored),
    [category],
  );

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

  const handleDeleteSingleSprite = useCallback(async () => {
    if (!deleteSpriteRequest) return;
    setDeletingSprites("single");
    try {
      await deleteSprite.mutateAsync({ characterId, expression: deleteSpriteRequest.expression });
      setDeleteSpriteRequest(null);
    } finally {
      setDeletingSprites(null);
    }
  }, [characterId, deleteSprite, deleteSpriteRequest]);

  const handleDeleteVisibleSprites = useCallback(async () => {
    if (visibleSprites.length === 0) return;
    setDeletingSprites("all");
    try {
      for (const sprite of visibleSprites) {
        await deleteSprite.mutateAsync({ characterId, expression: sprite.expression });
      }
      setDeleteSpriteRequest(null);
    } finally {
      setDeletingSprites(null);
    }
  }, [characterId, deleteSprite, visibleSprites]);

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

  const handleCleanVisibleSprites = useCallback(async () => {
    if (visibleSprites.length === 0) return;

    const modeLabel = category === "full-body" ? "full-body" : "expression";
    if (
      !(await showConfirmDialog({
        title: "Clean Sprite Backgrounds",
        message: `Run the local backgroundremover model on ${visibleSprites.length} saved ${modeLabel} sprite${visibleSprites.length === 1 ? "" : "s"} at strength ${savedCleanupStrength}? Marinara will keep a restore point in case the cleanup looks wrong.`,
        confirmLabel: "Clean",
      }))
    ) {
      return;
    }

    setCleaningSprites(true);
    try {
      const result = await cleanupSavedSprites.mutateAsync({
        characterId,
        expressions: visibleSprites.map((sprite) => sprite.expression),
        cleanupStrength: savedCleanupStrength,
        engine: "backgroundremover",
      });

      if (result.processed > 0) {
        setLastCleanupBackupId(result.backupId ?? null);
        toast.success(
          `Cleaned ${result.processed} saved sprite${result.processed === 1 ? "" : "s"} with backgroundremover.`,
        );
      }
      if (result.failed.length > 0) {
        toast.warning(`${result.failed.length} sprite${result.failed.length === 1 ? "" : "s"} could not be cleaned.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to clean saved sprites.");
    } finally {
      setCleaningSprites(false);
    }
  }, [category, characterId, cleanupSavedSprites, savedCleanupStrength, visibleSprites]);

  const handleRestoreLastCleanup = useCallback(async () => {
    if (!lastCleanupBackupId) return;
    setRestoringCleanup(true);
    try {
      const result = await restoreSpriteCleanupBackup.mutateAsync({
        characterId,
        backupId: lastCleanupBackupId,
      });
      if (result.restored > 0) {
        toast.success(`Restored ${result.restored} sprite${result.restored === 1 ? "" : "s"} from the cleanup backup.`);
      }
      if (result.failed.length > 0) {
        toast.warning(`${result.failed.length} sprite${result.failed.length === 1 ? "" : "s"} could not be restored.`);
      } else {
        setLastCleanupBackupId(null);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to restore sprite cleanup backup.");
    } finally {
      setRestoringCleanup(false);
    }
  }, [characterId, lastCleanupBackupId, restoreSpriteCleanupBackup]);

  const handleApplySpriteFrame = useCallback(
    async (croppedDataUrl: string) => {
      if (!framingSprite) return;

      setSavingFrame(true);
      try {
        await uploadSprite.mutateAsync({
          characterId,
          expression: framingSprite.expression,
          image: croppedDataUrl,
        });
        toast.success(`Framed ${displayExpression(framingSprite.expression)} sprite.`);
        setFramingSprite(null);
      } finally {
        setSavingFrame(false);
      }
    },
    [characterId, displayExpression, framingSprite, uploadSprite],
  );

  const handleApplyWandCleanup = useCallback(
    async (cleanedDataUrl: string) => {
      if (!wandCleanupSprite) return;

      setSavingWandCleanup(true);
      try {
        await uploadSprite.mutateAsync({
          characterId,
          expression: wandCleanupSprite.expression,
          image: cleanedDataUrl,
        });
        toast.success(`Cleaned ${displayExpression(wandCleanupSprite.expression)} sprite.`);
        setWandCleanupSprite(null);
      } finally {
        setSavingWandCleanup(false);
      }
    },
    [characterId, displayExpression, uploadSprite, wandCleanupSprite],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Character Sprites"
        subtitle="Upload VN-style sprites for different expressions. The Expression Engine agent will select the appropriate sprite during roleplay."
      />

      <div className="inline-flex rounded-xl bg-[var(--secondary)] p-1 ring-1 ring-[var(--border)]">
        <button
          type="button"
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
          type="button"
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <Upload size="0.8125rem" className="text-[var(--primary)]" />
            Add Sprite
          </h4>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <button
              type="button"
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
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={!!folderProgress}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
              title="Select a folder of PNGs — each filename becomes the expression name"
            >
              <FolderOpen size="0.8125rem" />
              Upload Folder
            </button>
            <button
              type="button"
              onClick={() => void handleCleanVisibleSprites()}
              disabled={
                cleaningSprites ||
                backgroundCleanupUnavailable ||
                backgroundRemoverUnavailable ||
                visibleSprites.length === 0
              }
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)] max-md:px-2.5"
              title={
                backgroundCleanupUnavailable
                  ? backgroundCleanupReason
                  : backgroundRemoverUnavailable
                    ? backgroundRemoverReason
                    : "Run the local backgroundremover model on the currently visible saved sprites"
              }
            >
              {cleaningSprites ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Eraser size="0.8125rem" />}
              {cleaningSprites ? "Cleaning..." : "Clean Backgrounds"}
            </button>
            <div className="relative max-md:flex-1 max-md:basis-[calc(50%-0.25rem)]">
              <button
                type="button"
                onClick={() => setExportMenuOpen((open) => !open)}
                disabled={exporting || allSprites.length === 0}
                className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-center text-[0.6875rem] font-medium leading-tight text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40 max-md:px-2.5"
                title="Choose which saved sprites to export"
              >
                <ImageDown size="0.8125rem" />
                {exporting ? "Exporting..." : "Export"}
              </button>
              {exportMenuOpen && !exporting && (
                <div className="absolute right-0 top-[calc(100%+0.35rem)] z-30 min-w-44 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-xs shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportSprites(visibleSprites, "visible");
                    }}
                    disabled={visibleSprites.length === 0}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ImageDown size="0.75rem" />
                    {category === "full-body" ? "Full-body only" : "Expressions only"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportSprites(allSprites, "all");
                    }}
                    disabled={allSprites.length === 0}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ImageDown size="0.75rem" />
                    All sprites
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--secondary)]/60 px-3 py-2">
          <span className="text-[0.6875rem] font-medium text-[var(--foreground)]">Cleanup strength</span>
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">Soft</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={savedCleanupStrength}
            onChange={(e) => setSavedCleanupStrength(Number(e.target.value))}
            disabled={cleaningSprites}
            className="min-w-40 flex-1 accent-[var(--primary)] disabled:opacity-50"
          />
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">Aggressive</span>
          <span className="w-8 text-right text-[0.6875rem] tabular-nums text-[var(--muted-foreground)]">
            {savedCleanupStrength}
          </span>
        </div>

        {/* Folder upload progress */}
        {folderProgress && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.75rem" className="animate-spin text-[var(--primary)]" />
            Uploading {folderProgress.done}/{folderProgress.total} sprites…
          </div>
        )}
        {cleaningSprites && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.75rem" className="animate-spin text-[var(--primary)]" />
            Running local backgroundremover on saved sprites…
          </div>
        )}
        {lastCleanupBackupId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <span>Last cleanup has a restore point.</span>
            <button
              type="button"
              onClick={() => void handleRestoreLastCleanup()}
              disabled={restoringCleanup}
              className="flex items-center gap-1.5 rounded-md bg-[var(--card)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
            >
              {restoringCleanup ? <Loader2 size="0.75rem" className="animate-spin" /> : <RotateCcw size="0.75rem" />}
              Undo Cleanup
            </button>
          </div>
        )}
        {spriteGenerationUnavailable && (
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {spriteGenerationReason}
          </div>
        )}
        {backgroundCleanupUnavailable && !spriteGenerationUnavailable && (
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {backgroundCleanupReason}
          </div>
        )}
        {backgroundRemoverUnavailable && !backgroundCleanupUnavailable && (
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {backgroundRemoverReason}
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
            type="button"
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
                  type="button"
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
      {framingSprite && (
        <SpriteFrameEditor
          imageUrl={framingSprite.url}
          label={displayExpression(framingSprite.expression)}
          applying={savingFrame}
          onApply={handleApplySpriteFrame}
          onClose={() => setFramingSprite(null)}
        />
      )}

      {wandCleanupSprite && (
        <SpriteWandCleanupEditor
          imageUrl={wandCleanupSprite.url}
          label={displayExpression(wandCleanupSprite.expression)}
          applying={savingWandCleanup}
          onApply={handleApplyWandCleanup}
          onClose={() => setWandCleanupSprite(null)}
        />
      )}

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
              <button
                type="button"
                onClick={() => setWandCleanupSprite(sprite)}
                className="group/preview relative block aspect-[3/4] w-full bg-[var(--secondary)]"
                title="Open wand cleanup"
              >
                <img src={sprite.url} alt={sprite.expression} loading="lazy" className="h-full w-full object-contain" />
                <span className="pointer-events-none absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--card)]/90 text-[var(--primary)] opacity-0 shadow-lg ring-1 ring-[var(--border)] transition-opacity group-hover/preview:opacity-100 max-md:opacity-100">
                  <Wand2 size="0.875rem" />
                </span>
              </button>
              <div className="flex items-center justify-between p-2">
                <span
                  className="max-w-[10rem] truncate text-[0.6875rem] font-medium capitalize"
                  title={displayExpression(sprite.expression)}
                >
                  {displayExpression(sprite.expression)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setFramingSprite(sprite)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Frame"
                  >
                    <Crop size="0.6875rem" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadSpriteFile(sprite)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Download"
                  >
                    <ImageDown size="0.6875rem" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startUpload(sprite.expression)}
                    className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Replace"
                  >
                    <Upload size="0.6875rem" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteSpriteRequest(sprite)}
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
            • To make one expression randomly rotate between variants, use a shared prefix before an underscore, e.g.
            happy_01.png and happy_blush.png are offered to the agent as "happy"
          </li>
          <li>
            • Enable the <strong className="text-[var(--foreground)]">Expression Engine</strong> agent in the Agents
            panel
          </li>
          <li>• During roleplay, the agent will detect emotions and display the matching sprite</li>
          <li>• Sprites appear as VN-style overlays in the chat area</li>
        </ul>
      </div>

      {deleteSpriteRequest && (
        <Modal
          open
          onClose={() => {
            if (!deletingSprites) setDeleteSpriteRequest(null);
          }}
          title="Delete Sprite"
          width="max-w-sm"
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-[var(--foreground)]">
              Delete sprite for "{displayExpression(deleteSpriteRequest.expression)}"?
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {visibleSprites.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteVisibleSprites()}
                  disabled={!!deletingSprites}
                  className="mr-auto inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/30 transition-colors hover:bg-[var(--destructive)]/10 disabled:opacity-50 sm:px-3 sm:text-sm"
                >
                  {deletingSprites === "all" ? (
                    <Loader2 size="0.875rem" className="animate-spin" />
                  ) : (
                    <Trash2 size="0.875rem" />
                  )}
                  Delete All {category === "full-body" ? "Full-Body" : "Expressions"}
                </button>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteSpriteRequest(null)}
                  disabled={!!deletingSprites}
                  className="rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50 sm:px-3 sm:text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteSingleSprite()}
                  disabled={!!deletingSprites}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--destructive)] px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--destructive)]/85 disabled:opacity-50 sm:px-3 sm:text-sm"
                >
                  {deletingSprites === "single" && <Loader2 size="0.875rem" className="animate-spin" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Sprite Generation Modal */}
      <SpriteGenerationModal
        open={spriteGenOpen}
        onClose={() => setSpriteGenOpen(false)}
        entityId={characterId}
        initialSpriteType={category === "full-body" ? "full-body" : "expressions"}
        existingExpressionNames={portraitExpressionNames}
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
                type="button"
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
                    type="button"
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
  const trackerCardColors = parseTrackerCardColorConfig(formData.extensions.trackerCardColors);
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
                  ? nameColor.includes("gradient(")
                    ? {
                        backgroundImage: nameColor,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "100% 100%",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                        color: "transparent",
                        display: "inline-block",
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

      <TrackerCardColorControls
        value={trackerCardColors}
        onChange={(value) => updateExtension("trackerCardColors", value)}
        chatColors={{ nameColor, dialogueColor, boxColor }}
        entityLabel="Character"
        previewName={formData.name || "Character"}
      />
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
  const rawLinkedLorebookId =
    typeof embeddedLorebookMetadata.lorebookId === "string" ? embeddedLorebookMetadata.lorebookId : null;
  // Verify the pointed-to lorebook actually exists. Cards exported from
  // another Marinara instance can carry a stale `lorebookId` in their
  // extensions, and an auto-import that errored silently can leave the
  // pointer set without a real DB row. If we trust the raw pointer the
  // "Edit Linked Lorebook" button opens an editor that can never resolve
  // (its loading state is `isLoading || !lorebook`, and a 404'd query
  // satisfies the second clause forever), so verify before showing it.
  const linkedLorebookQuery = useLorebook(rawLinkedLorebookId);
  const linkedLorebookId =
    rawLinkedLorebookId && (linkedLorebookQuery.isLoading || linkedLorebookQuery.data) ? rawLinkedLorebookId : null;
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
