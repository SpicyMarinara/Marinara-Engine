// ──────────────────────────────────────────────
// Panel: Settings (polished)
// ──────────────────────────────────────────────
import {
  useUIStore,
  type CustomTheme,
  type InstalledExtension,
  type VisualTheme,
  type HudPosition,
} from "../../stores/ui.store";
import { cn } from "../../lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Upload,
  X,
  Image,
  Trash2,
  Check,
  Loader2,
  Palette,
  Puzzle,
  CloudRain,
  FileCode2,
  Power,
  LayoutDashboard,
  PowerOff,
  Paintbrush,
  AlertTriangle,
  Tag,
  Pencil,
  Code,
  Plus,
  Save,
  Eye,
  EyeOff,
  Download,
  FolderOpen,
} from "lucide-react";
import { useClearAllData } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { chatKeys } from "../../hooks/use-chats";
import { HelpTooltip } from "../ui/HelpTooltip";

const TABS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "themes", label: "Themes" },
  { id: "extensions", label: "Extensions" },
  { id: "import", label: "Import" },
  { id: "advanced", label: "Advanced" },
] as const;

export function SettingsPanel() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);

  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div className="flex flex-wrap border-b border-[var(--sidebar-border)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={cn(
              "relative px-3 py-2.5 text-xs font-medium transition-colors",
              settingsTab === tab.id
                ? "text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
            {settingsTab === tab.id && (
              <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--primary)]" />
            )}
          </button>
        ))}
      </div>

      <div className="p-3">
        {settingsTab === "general" && <GeneralSettings />}
        {settingsTab === "appearance" && <AppearanceSettings />}
        {settingsTab === "themes" && <ThemesSettings />}
        {settingsTab === "extensions" && <ExtensionsSettings />}
        {settingsTab === "import" && <ImportSettings />}
        {settingsTab === "advanced" && <AdvancedSettings />}
      </div>
    </div>
  );
}

function GeneralSettings() {
  const enableStreaming = useUIStore((s) => s.enableStreaming);
  const setEnableStreaming = useUIStore((s) => s.setEnableStreaming);
  const streamingFps = useUIStore((s) => s.streamingFps);
  const setStreamingFps = useUIStore((s) => s.setStreamingFps);
  const enterToSend = useUIStore((s) => s.enterToSend);
  const setEnterToSend = useUIStore((s) => s.setEnterToSend);
  const confirmBeforeDelete = useUIStore((s) => s.confirmBeforeDelete);
  const setConfirmBeforeDelete = useUIStore((s) => s.setConfirmBeforeDelete);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const setMessagesPerPage = useUIStore((s) => s.setMessagesPerPage);

  return (
    <div className="flex flex-col gap-3 animate-fade-in-up">
      <div className="text-xs text-[var(--muted-foreground)]">General application settings.</div>

      <ToggleSetting
        label="Enable streaming responses"
        checked={enableStreaming}
        onChange={setEnableStreaming}
        help="When on, AI responses appear word-by-word as they're generated. When off, the full response appears at once after completion."
      />

      {/* Streaming FPS */}
      <label className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
        <span className="text-xs">Streaming smoothness</span>
        <select
          value={String(streamingFps)}
          onChange={(e) => setStreamingFps(Number(e.target.value) as 30 | 60)}
          className="rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs"
        >
          <option value="30">30 FPS</option>
          <option value="60">60 FPS</option>
        </select>
        <HelpTooltip text="How often the streaming text updates on screen. 60 FPS is smoother but uses slightly more CPU. 30 FPS is lighter on older hardware." />
      </label>

      <ToggleSetting
        label="Send message on Enter"
        checked={enterToSend}
        onChange={setEnterToSend}
        help="When on, pressing Enter sends your message. When off, Enter creates a new line and you must click the send button."
      />

      <ToggleSetting
        label="Confirm before deleting"
        checked={confirmBeforeDelete}
        onChange={setConfirmBeforeDelete}
        help="Shows a confirmation dialog before permanently deleting chats, characters, or other items. Recommended to keep on."
      />

      {/* Messages per page */}
      <label className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
        <span className="text-xs">Messages per page</span>
        <input
          type="number"
          min={0}
          max={500}
          value={messagesPerPage}
          onChange={(e) => setMessagesPerPage(Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0)))}
          className="w-16 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs"
        />
        <HelpTooltip text="How many messages to load at a time. Click 'Load More' in the chat to see older messages. Set to 0 to load all messages at once." />
      </label>
    </div>
  );
}

function AppearanceSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const visualTheme = useUIStore((s) => s.visualTheme);
  const setVisualTheme = useUIStore((s) => s.setVisualTheme);
  const chatBackground = useUIStore((s) => s.chatBackground);
  const setChatBackground = useUIStore((s) => s.setChatBackground);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const setFontFamily = useUIStore((s) => s.setFontFamily);
  const fontSize = useUIStore((s) => s.fontSize);
  const setFontSize = useUIStore((s) => s.setFontSize);
  const chatFontSize = useUIStore((s) => s.chatFontSize);
  const setChatFontSize = useUIStore((s) => s.setChatFontSize);
  const weatherEffects = useUIStore((s) => s.weatherEffects);
  const setWeatherEffects = useUIStore((s) => s.setWeatherEffects);
  const hudPosition = useUIStore((s) => s.hudPosition);
  const setHudPosition = useUIStore((s) => s.setHudPosition);

  // Fetch available custom fonts from data/fonts/
  const { data: customFonts } = useQuery<{ filename: string; family: string; url: string }[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: 60_000,
  });

  // Inject @font-face rules for custom fonts
  React.useEffect(() => {
    if (!customFonts?.length) return;
    const id = "marinara-custom-fonts";
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = customFonts
      .map((f) => `@font-face { font-family: "${f.family}"; src: url("${f.url}"); font-display: swap; }`)
      .join("\n");
  }, [customFonts]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      {/* ── Visual Style ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Paintbrush size={12} className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Visual Style</span>
          <HelpTooltip text="Choose how the entire app looks. 'Marinara' uses a retro Y2K aesthetic with glow effects. 'SillyTavern' uses a clean, minimal look inspired by the original SillyTavern." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              {
                id: "default" as VisualTheme,
                label: "Default (Marinara)",
                desc: "Y2K / retro aesthetic with glow effects",
              },
              {
                id: "sillytavern" as VisualTheme,
                label: "SillyTavern",
                desc: "Classic SillyTavern look — clean & minimal",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setVisualTheme(opt.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-xs transition-all",
                visualTheme === opt.id
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]"
                  : "border-[var(--border)] hover:border-[var(--primary)]/40",
              )}
            >
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] text-[var(--muted-foreground)] leading-tight">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Color Scheme{" "}
          <HelpTooltip text="Switch between dark and light mode. Dark mode is easier on the eyes in low-light environments." />
        </span>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as "dark" | "light")}
          className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Font{" "}
          <HelpTooltip text="Choose the font used across the app. 'Default (Inter)' is optimized for screen readability. Drop .ttf, .otf, .woff, or .woff2 font files into the data/fonts/ folder to add custom fonts." />
        </span>
        <select
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
        >
          <option value="">Default (Inter)</option>
          {customFonts?.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </select>
        {(!customFonts || customFonts.length === 0) && (
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Drop font files (.ttf, .otf, .woff, .woff2) into the <span className="font-medium">data/fonts/</span> folder
            to add custom fonts.
          </p>
        )}
        <button
          onClick={() => api.post("/fonts/open-folder").catch(() => {})}
          className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <FolderOpen size={12} />
          Open Fonts Folder
        </button>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Display Size{" "}
          <HelpTooltip text="Adjusts the base font size across the whole app. Larger sizes improve readability. Default is 14px." />
        </span>
        <select
          value={String(fontSize)}
          onChange={(e) => setFontSize(Number(e.target.value) as 12 | 14 | 16 | 17)}
          className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
        >
          <option value="12">Small</option>
          <option value="14">Default</option>
          <option value="16">Large</option>
          <option value="17">Extra Large</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Chat Font Size{" "}
          <HelpTooltip text="Adjusts the font size of chat messages. Drag the slider to find your preferred reading size. Default is 16px." />
        </span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={12}
            max={48}
            step={1}
            value={chatFontSize}
            onChange={(e) => setChatFontSize(Number(e.target.value))}
            className="flex-1 accent-[var(--primary)]"
          />
          <span className="text-xs tabular-nums text-[var(--muted-foreground)] w-8 text-right">{chatFontSize}px</span>
        </div>
      </label>

      {/* ── Effects ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <CloudRain size={12} className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Effects</span>
          <HelpTooltip text="Visual effects that enhance the roleplay atmosphere. Weather particles like rain, snow, and fog appear based on the story context." />
        </div>
        <ToggleSetting
          label="Dynamic weather effects (rain, snow, fog, etc.)"
          checked={weatherEffects}
          onChange={setWeatherEffects}
        />
        <p className="text-[10px] text-[var(--muted-foreground)] pl-6">
          Shows animated weather particles based on in-story weather and time of day. Requires the{" "}
          <span className="font-medium">World State</span> agent to be enabled so weather data is extracted from the
          narrative.
        </p>
      </div>

      {/* ── Widget Position ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <LayoutDashboard size={12} className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Widget Position</span>
          <HelpTooltip text="Choose where the roleplay HUD widgets (stats, inventory, characters, etc.) are displayed on screen. 'Top' shows them in a horizontal bar above the chat. 'Left' or 'Right' stacks them vertically along the edge." />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["top", "left", "right"] as HudPosition[]).map((pos) => (
            <button
              key={pos}
              onClick={() => setHudPosition(pos)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-all",
                hudPosition === pos
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]"
                  : "border-[var(--border)] hover:border-[var(--primary)]/40",
              )}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat Background Picker ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium inline-flex items-center gap-1">
            Chat Background{" "}
            <HelpTooltip text="Upload a custom image to use as the background of the chat area. Supports JPG, PNG, and WebP. Remove to use the default background." />
          </span>
          {chatBackground && (
            <button
              onClick={() => setChatBackground(null)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
            >
              <X size={10} /> Remove
            </button>
          )}
        </div>
        <BackgroundPicker selected={chatBackground} onSelect={setChatBackground} />
      </div>
    </div>
  );
}

function BackgroundPicker({ selected, onSelect }: { selected: string | null; onSelect: (url: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingTags, setEditingTags] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const qc = useQueryClient();

  const { data: backgrounds } = useQuery({
    queryKey: ["backgrounds"],
    queryFn: () =>
      api.get<Array<{ filename: string; url: string; originalName: string | null; tags: string[] }>>("/backgrounds"),
  });

  const { data: allTags } = useQuery({
    queryKey: ["background-tags"],
    queryFn: () => api.get<string[]>("/backgrounds/tags"),
  });

  const deleteBg = useMutation({
    mutationFn: (filename: string) => api.delete(`/backgrounds/${filename}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backgrounds"] });
      qc.invalidateQueries({ queryKey: ["background-tags"] });
    },
  });

  const updateTags = useMutation({
    mutationFn: ({ filename, tags }: { filename: string; tags: string[] }) =>
      api.patch(`/backgrounds/${filename}/tags`, { tags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backgrounds"] });
      qc.invalidateQueries({ queryKey: ["background-tags"] });
    },
  });

  const renameBg = useMutation({
    mutationFn: ({ filename, name }: { filename: string; name: string }) =>
      api.patch<{ success: boolean; oldFilename: string; filename: string; url: string }>(
        `/backgrounds/${filename}/rename`,
        { name },
      ),
    onSuccess: (data) => {
      // If the renamed file was the selected background, update the selection
      const oldUrl = `/api/backgrounds/file/${encodeURIComponent(data.oldFilename)}`;
      if (selected === oldUrl) {
        onSelect(data.url);
      }
      setRenamingFile(null);
      qc.invalidateQueries({ queryKey: ["backgrounds"] });
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/backgrounds/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        qc.invalidateQueries({ queryKey: ["backgrounds"] });
        onSelect(data.url);
      }
    } catch {
      // ignore
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const addTag = (filename: string, currentTags: string[]) => {
    const tag = tagInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 _-]/g, "");
    if (!tag || currentTags.includes(tag)) return;
    updateTags.mutate({ filename, tags: [...currentTags, tag] });
    setTagInput("");
  };

  const removeTag = (filename: string, currentTags: string[], tagToRemove: string) => {
    updateTags.mutate({ filename, tags: currentTags.filter((t) => t !== tagToRemove) });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Upload button */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/50"
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {uploading ? "Uploading..." : "Upload Background"}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      {/* Background grid */}
      {backgrounds && backgrounds.length > 0 && (
        <div className="flex flex-col gap-2">
          {backgrounds.map((bg) => {
            const isSelected = selected === bg.url;
            const isEditing = editingTags === bg.filename;
            return (
              <div key={bg.filename} className="flex flex-col gap-1">
                {/* Thumbnail row */}
                <div className="group relative flex gap-2">
                  <button
                    onClick={() => onSelect(isSelected ? null : bg.url)}
                    className={cn(
                      "aspect-video w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                      isSelected
                        ? "border-[var(--primary)] shadow-md shadow-[var(--primary)]/20"
                        : "border-transparent hover:border-[var(--muted-foreground)]/30",
                    )}
                  >
                    <img src={bg.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    {isSelected && (
                      <div
                        className="absolute inset-0 flex items-center justify-center bg-black/30"
                        style={{ width: "6rem" }}
                      >
                        <Check size={14} className="text-white" />
                      </div>
                    )}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                    <div className="flex items-center gap-1">
                      {renamingFile === bg.filename ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (renameInput.trim())
                              renameBg.mutate({ filename: bg.filename, name: renameInput.trim() });
                          }}
                        >
                          <input
                            type="text"
                            value={renameInput}
                            onChange={(e) => setRenameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setRenamingFile(null);
                            }}
                            className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                            autoFocus
                          />
                          <button
                            type="submit"
                            disabled={!renameInput.trim() || renameBg.isPending}
                            className="shrink-0 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[9px] text-[var(--primary-foreground)] disabled:opacity-40"
                          >
                            {renameBg.isPending ? "…" : "Save"}
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="truncate text-[10px] text-[var(--muted-foreground)]">{bg.filename}</span>
                          <button
                            onClick={() => {
                              // Pre-fill with filename without extension
                              const nameWithoutExt = bg.filename.replace(/\.[^.]+$/, "");
                              setRenameInput(nameWithoutExt);
                              setRenamingFile(bg.filename);
                            }}
                            className="shrink-0 rounded-md p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--primary)] group-hover:opacity-100"
                            title="Rename"
                          >
                            <Pencil size={9} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selected === bg.url) onSelect(null);
                          deleteBg.mutate(bg.filename);
                        }}
                        className="ml-auto shrink-0 rounded-md p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--destructive)] group-hover:opacity-100"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                    {/* Tags */}
                    <div className="flex flex-wrap items-center gap-1">
                      {bg.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 rounded-full bg-[var(--secondary)] px-1.5 py-0 text-[9px] text-[var(--muted-foreground)]"
                        >
                          {tag}
                          {isEditing && (
                            <button
                              onClick={() => removeTag(bg.filename, bg.tags, tag)}
                              className="ml-0.5 hover:text-[var(--destructive)]"
                            >
                              <X size={8} />
                            </button>
                          )}
                        </span>
                      ))}
                      <button
                        onClick={() => {
                          setEditingTags(isEditing ? null : bg.filename);
                          setTagInput("");
                        }}
                        className={cn(
                          "rounded-full p-0.5 transition-colors",
                          isEditing
                            ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                            : "text-[var(--muted-foreground)]/60 hover:text-[var(--primary)]",
                        )}
                        title="Edit tags"
                      >
                        <Tag size={9} />
                      </button>
                    </div>
                    {/* Tag input */}
                    {isEditing && (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addTag(bg.filename, bg.tags);
                            }
                            if (e.key === "Escape") setEditingTags(null);
                          }}
                          placeholder="Add tag…"
                          className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                          autoFocus
                          list={`tag-suggestions-${bg.filename}`}
                        />
                        <datalist id={`tag-suggestions-${bg.filename}`}>
                          {(allTags ?? [])
                            .filter((t) => !bg.tags.includes(t))
                            .map((t) => (
                              <option key={t} value={t} />
                            ))}
                        </datalist>
                        <button
                          onClick={() => addTag(bg.filename, bg.tags)}
                          disabled={!tagInput.trim()}
                          className="shrink-0 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[9px] text-[var(--primary-foreground)] disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(!backgrounds || backgrounds.length === 0) && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-center">
          <Image size={20} className="text-[var(--muted-foreground)]/40" />
          <p className="text-[10px] text-[var(--muted-foreground)]">No backgrounds uploaded yet</p>
        </div>
      )}
    </div>
  );
}

function ThemesSettings() {
  const customThemes = useUIStore((s) => s.customThemes);
  const activeCustomTheme = useUIStore((s) => s.activeCustomTheme);
  const setActiveCustomTheme = useUIStore((s) => s.setActiveCustomTheme);
  const addCustomTheme = useUIStore((s) => s.addCustomTheme);
  const updateCustomTheme = useUIStore((s) => s.updateCustomTheme);
  const removeCustomTheme = useUIStore((s) => s.removeCustomTheme);
  const fileRef = useRef<HTMLInputElement>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = creating new
  const [themeName, setThemeName] = useState("");
  const [themeCss, setThemeCss] = useState("");
  const [livePreview, setLivePreview] = useState(true);

  // Inject live preview CSS
  useEffect(() => {
    if (!editorOpen || !livePreview) {
      const el = document.getElementById("marinara-css-editor-preview");
      if (el) el.textContent = "";
      return;
    }
    let style = document.getElementById("marinara-css-editor-preview") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "marinara-css-editor-preview";
      document.head.appendChild(style);
    }
    style.textContent = themeCss;
    return () => {
      style!.textContent = "";
    };
  }, [editorOpen, livePreview, themeCss]);

  const openNewTheme = useCallback(() => {
    setEditingId(null);
    setThemeName("");
    setThemeCss(CSS_TEMPLATE);
    setEditorOpen(true);
  }, []);

  const openEditTheme = useCallback((theme: CustomTheme) => {
    setEditingId(theme.id);
    setThemeName(theme.name);
    setThemeCss(theme.css);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    const name = themeName.trim() || "Untitled Theme";
    if (editingId) {
      updateCustomTheme(editingId, { name, css: themeCss });
    } else {
      const theme: CustomTheme = {
        id: crypto.randomUUID(),
        name,
        css: themeCss,
        installedAt: new Date().toISOString(),
      };
      addCustomTheme(theme);
      setActiveCustomTheme(theme.id);
    }
    setEditorOpen(false);
  }, [editingId, themeName, themeCss, addCustomTheme, updateCustomTheme, setActiveCustomTheme]);

  const handleImportTheme = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();

      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        const theme: CustomTheme = {
          id: crypto.randomUUID(),
          name: parsed.name ?? file.name.replace(/\.json$/, ""),
          css: parsed.css ?? "",
          installedAt: new Date().toISOString(),
        };
        addCustomTheme(theme);
      } else {
        const theme: CustomTheme = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.css$/, ""),
          css: text,
          installedAt: new Date().toISOString(),
        };
        addCustomTheme(theme);
      }
    } catch {
      alert("Failed to import theme. Ensure it's a valid CSS or JSON file.");
    }
    e.target.value = "";
  };

  // ── CSS Editor View ──
  if (editorOpen) {
    return (
      <div className="flex flex-col gap-3 animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditorOpen(false)}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <X size={14} />
            </button>
            <span className="text-xs font-semibold">{editingId ? "Edit Theme" : "New Theme"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLivePreview(!livePreview)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors",
                livePreview
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
              )}
              title={livePreview ? "Disable live preview" : "Enable live preview"}
            >
              {livePreview ? <Eye size={11} /> : <EyeOff size={11} />}
              Preview
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[10px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 active:scale-95"
            >
              <Save size={11} />
              Save
            </button>
          </div>
        </div>

        {/* Theme name */}
        <input
          type="text"
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
          placeholder="Theme name..."
          className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50"
        />

        {/* CSS textarea */}
        <textarea
          value={themeCss}
          onChange={(e) => setThemeCss(e.target.value)}
          spellCheck={false}
          className="min-h-[360px] resize-y rounded-lg border border-[var(--border)] bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed text-emerald-300 outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-white/20"
          placeholder="/* Enter your CSS here... */"
        />

        {/* Quick reference */}
        <details className="group rounded-lg bg-[var(--secondary)]/50 ring-1 ring-[var(--border)]">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            CSS Variable Reference
          </summary>
          <div className="border-t border-[var(--border)] px-3 py-2 font-mono text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span>--background</span>
              <span className="text-white/40">Page background</span>
              <span>--foreground</span>
              <span className="text-white/40">Main text</span>
              <span>--primary</span>
              <span className="text-white/40">Accent / buttons</span>
              <span>--primary-foreground</span>
              <span className="text-white/40">Text on primary</span>
              <span>--secondary</span>
              <span className="text-white/40">Cards / inputs</span>
              <span>--card</span>
              <span className="text-white/40">Card background</span>
              <span>--border</span>
              <span className="text-white/40">Borders</span>
              <span>--muted-foreground</span>
              <span className="text-white/40">Dimmed text</span>
              <span>--sidebar</span>
              <span className="text-white/40">Sidebar bg</span>
              <span>--sidebar-border</span>
              <span className="text-white/40">Sidebar border</span>
              <span>--destructive</span>
              <span className="text-white/40">Error / delete</span>
              <span>--popover</span>
              <span className="text-white/40">Dropdown bg</span>
              <span>--accent</span>
              <span className="text-white/40">Hover highlights</span>
            </div>
          </div>
        </details>
      </div>
    );
  }

  // ── Theme List View ──
  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Palette size={12} />
        Create or import custom CSS themes to personalize the look and feel.
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={openNewTheme}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3 text-xs text-[var(--primary)] transition-all hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10"
        >
          <Plus size={14} /> Create Theme
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/50"
        >
          <Upload size={14} /> Import File
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".css,.json" className="hidden" onChange={handleImportTheme} />

      {/* Active theme: None option */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Installed Themes</span>
        <button
          onClick={() => setActiveCustomTheme(null)}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all",
            activeCustomTheme === null
              ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <Palette size={12} />
          Default Theme
          {activeCustomTheme === null && <Check size={12} className="ml-auto" />}
        </button>

        {/* Custom theme list */}
        {customThemes.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all",
              activeCustomTheme === t.id
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            <button onClick={() => setActiveCustomTheme(t.id)} className="flex flex-1 items-center gap-2 min-w-0">
              <FileCode2 size={12} className="shrink-0" />
              <span className="truncate">{t.name}</span>
              {activeCustomTheme === t.id && <Check size={12} className="shrink-0" />}
            </button>
            <button
              onClick={() => openEditTheme(t)}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]"
              title="Edit theme CSS"
            >
              <Code size={11} />
            </button>
            <button
              onClick={() => {
                const json = JSON.stringify({ name: t.name, css: t.css }, null, 2);
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${t.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
              title="Export theme"
            >
              <Download size={11} />
            </button>
            <button
              onClick={() => {
                if (activeCustomTheme === t.id) setActiveCustomTheme(null);
                removeCustomTheme(t.id);
              }}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              title="Remove theme"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        {customThemes.length === 0 && (
          <p className="py-2 text-center text-[10px] text-[var(--muted-foreground)]">
            No custom themes installed yet. Create one or import a .css file above.
          </p>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-[var(--secondary)]/50 p-2.5 text-[10px] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
        <strong>Tip:</strong> CSS themes can override any CSS variable (e.g.{" "}
        <code className="rounded bg-[var(--secondary)] px-1">--background</code>,{" "}
        <code className="rounded bg-[var(--secondary)] px-1">--primary</code>) or add custom styles. JSON themes should
        have <code className="rounded bg-[var(--secondary)] px-1">{`{ "name": "...", "css": "..." }`}</code> format.
      </div>
    </div>
  );
}

const CSS_TEMPLATE = `/* ═══════════════════════════════════════
   My Custom Theme
   ═══════════════════════════════════════ */

:root {
  /* ── Core Colors ── */
  /* --background: #0a0a0f; */
  /* --foreground: #e4e4e7; */
  /* --primary: #a78bfa; */
  /* --primary-foreground: #fff; */

  /* ── Surface Colors ── */
  /* --card: #111118; */
  /* --secondary: #1a1a24; */
  /* --accent: #252534; */
  /* --popover: #111118; */

  /* ── Borders ── */
  /* --border: #27272a; */
  /* --sidebar-border: #27272a; */

  /* ── Text ── */
  /* --muted-foreground: #71717a; */

  /* ── Sidebar ── */
  /* --sidebar: #0c0c12; */
}

/* Uncomment and edit the variables above.
   You can also add any custom CSS below: */
`;

function ExtensionsSettings() {
  const extensions = useUIStore((s) => s.installedExtensions);
  const addExtension = useUIStore((s) => s.addExtension);
  const removeExtension = useUIStore((s) => s.removeExtension);
  const toggleExtension = useUIStore((s) => s.toggleExtension);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImportExtension = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();

      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        const ext: InstalledExtension = {
          id: crypto.randomUUID(),
          name: parsed.name ?? file.name.replace(/\.json$/, ""),
          description: parsed.description ?? "",
          css: parsed.css ?? undefined,
          enabled: true,
          installedAt: new Date().toISOString(),
        };
        addExtension(ext);
      } else if (file.name.endsWith(".css")) {
        const ext: InstalledExtension = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.css$/, ""),
          description: "CSS extension imported from file",
          css: text,
          enabled: true,
          installedAt: new Date().toISOString(),
        };
        addExtension(ext);
      } else {
        alert("Only .json and .css extension files are supported.");
      }
    } catch {
      alert("Failed to import extension.");
    }
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Puzzle size={12} />
        Install custom extensions to add new features and styles.
      </div>

      {/* Import button */}
      <button
        onClick={() => fileRef.current?.click()}
        className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/50"
      >
        <Upload size={14} /> Import Extension (.json or .css)
      </button>
      <input ref={fileRef} type="file" accept=".json,.css" className="hidden" onChange={handleImportExtension} />

      {/* Extension list */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Installed Extensions</span>

        {extensions.map((ext) => (
          <div
            key={ext.id}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all",
              ext.enabled
                ? "bg-[var(--secondary)] text-[var(--secondary-foreground)]"
                : "bg-[var(--secondary)]/40 text-[var(--muted-foreground)]",
            )}
          >
            <button
              onClick={() => toggleExtension(ext.id)}
              className={cn(
                "rounded p-0.5 transition-colors",
                ext.enabled
                  ? "text-emerald-400 hover:text-emerald-300"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
              title={ext.enabled ? "Disable extension" : "Enable extension"}
            >
              {ext.enabled ? <Power size={12} /> : <PowerOff size={12} />}
            </button>
            <div className="flex flex-1 flex-col min-w-0">
              <span className="truncate font-medium">{ext.name}</span>
              {ext.description && (
                <span className="truncate text-[10px] text-[var(--muted-foreground)]">{ext.description}</span>
              )}
            </div>
            <button
              onClick={() => removeExtension(ext.id)}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              title="Remove extension"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        {extensions.length === 0 && (
          <p className="py-2 text-center text-[10px] text-[var(--muted-foreground)]">
            No extensions installed. Import a .json or .css extension file above.
          </p>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-[var(--secondary)]/50 p-2.5 text-[10px] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
        <strong>JSON format:</strong>{" "}
        <code className="rounded bg-[var(--secondary)] px-1">{`{ "name": "...", "description": "...", "css": "..." }`}</code>
        . Extensions can inject custom CSS to modify the UI.
      </div>
    </div>
  );
}

function ImportSettings() {
  const openModal = useUIStore((s) => s.openModal);
  const qc = useQueryClient();
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  const handleMarinaraImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      const res = await fetch("/api/import/marinara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      const data = await res.json();
      if (data.success) {
        qc.invalidateQueries();
        alert(`Imported ${data.name ?? data.type} successfully!`);
      } else {
        alert(`Import failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      alert("Import failed. Make sure this is a valid .marinara.json file.");
    }
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-3 animate-fade-in-up">
      <div className="text-xs text-[var(--muted-foreground)]">
        Import data from Marinara exports, SillyTavern, or other tools.
      </div>

      {/* Marinara import */}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500/20 to-orange-500/20 px-3 py-3 text-xs font-semibold ring-1 ring-pink-500/30 transition-all hover:ring-pink-500/50 active:scale-[0.98]">
        <Upload size={16} />
        Import Marinara File (.marinara.json)
        <input type="file" accept=".json" onChange={handleMarinaraImport} className="hidden" />
      </label>

      <div className="retro-divider" />

      {/* Bulk ST import */}
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        SillyTavern Import
      </span>

      <button
        onClick={() => openModal("st-bulk-import")}
        className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500/20 to-purple-500/20 px-3 py-3 text-xs font-semibold ring-1 ring-violet-500/30 transition-all hover:ring-violet-500/50 active:scale-[0.98]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Import from SillyTavern Folder
      </button>

      <div className="flex flex-col gap-2">
        <ImportButton
          label="Import Character (JSON/PNG)"
          accept=".json,.png"
          endpoint="/import/st-character"
          mode="auto"
        />
        <ImportButton
          label="Import Chat (JSONL)"
          accept=".jsonl"
          endpoint="/import/st-chat"
          mode="file"
          onImported={(data) => {
            qc.invalidateQueries({ queryKey: chatKeys.list() });
            if (data.chatId) setActiveChatId(data.chatId);
          }}
        />
        <ImportButton label="Import Preset (JSON)" accept=".json" endpoint="/import/st-preset" mode="json" />
        <ImportButton label="Import Lorebook (JSON)" accept=".json" endpoint="/import/st-lorebook" mode="json" />
      </div>
    </div>
  );
}

function ImportButton({
  label,
  accept,
  endpoint,
  mode = "file",
  onImported,
}: {
  label: string;
  accept: string;
  endpoint: string;
  mode?: "file" | "json" | "auto";
  onImported?: (data: any) => void;
}) {
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let res: Response;

      // "auto" mode: send binary files (PNG) as multipart, JSON files as JSON body
      const effectiveMode = mode === "auto" ? (file.name.toLowerCase().endsWith(".json") ? "json" : "file") : mode;

      if (effectiveMode === "json") {
        const text = await file.text();
        const json = JSON.parse(text);
        // Pass filename as fallback name for lorebook imports
        if (endpoint.includes("lorebook")) {
          json.__filename = file.name.replace(/\.json$/i, "");
        }
        res = await fetch(`/api${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(json),
        });
      } else {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch(`/api${endpoint}`, {
          method: "POST",
          body: formData,
        });
      }
      const data = await res.json();
      if (data.success) {
        if (onImported) {
          onImported(data);
        } else {
          alert(`Imported successfully!`);
        }
      } else {
        alert(`Import failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      alert("Import failed.");
    }
    e.target.value = "";
  };

  return (
    <label className="flex cursor-pointer items-center justify-center rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]">
      {label}
      <input type="file" accept={accept} onChange={handleImport} className="hidden" />
    </label>
  );
}

function AdvancedSettings() {
  const debugMode = useUIStore((s) => s.debugMode);
  const setDebugMode = useUIStore((s) => s.setDebugMode);
  const messageGrouping = useUIStore((s) => s.messageGrouping);
  const setMessageGrouping = useUIStore((s) => s.setMessageGrouping);
  const showTimestamps = useUIStore((s) => s.showTimestamps);
  const setShowTimestamps = useUIStore((s) => s.setShowTimestamps);
  const showModelName = useUIStore((s) => s.showModelName);
  const setShowModelName = useUIStore((s) => s.setShowModelName);
  const clearAllData = useClearAllData();
  const [confirmStep, setConfirmStep] = useState(0); // 0=idle, 1=first click, 2=confirmed

  return (
    <div className="flex flex-col gap-3 animate-fade-in-up">
      <div className="text-xs text-[var(--muted-foreground)]">Advanced settings for power users.</div>

      <ToggleSetting
        label="Group consecutive messages"
        checked={messageGrouping}
        onChange={setMessageGrouping}
        help="Combines multiple messages from the same sender into a visual group, reducing clutter in the chat."
      />
      <ToggleSetting
        label="Show message timestamps"
        checked={showTimestamps}
        onChange={setShowTimestamps}
        help="Displays the date and time each message was sent next to it in the chat."
      />
      <ToggleSetting
        label="Show model name on messages"
        checked={showModelName}
        onChange={setShowModelName}
        help="Displays which AI model generated each response, shown as a small label on assistant messages."
      />
      <ToggleSetting
        label="Debug mode (log prompts to console)"
        checked={debugMode}
        onChange={setDebugMode}
        help="Logs the full prompt and API request/response to the browser console. Useful for advanced users debugging prompt formatting."
      />

      {/* ── Danger Zone ── */}
      <div className="retro-divider" />
      <div className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--destructive)]">
          <AlertTriangle size={14} />
          Danger Zone
        </div>
        <p className="text-[10px] text-[var(--muted-foreground)]">
          This will permanently delete <strong>all</strong> characters, chats, messages, presets, lorebooks,
          backgrounds, sprites, personas, and connections. This action cannot be undone.
        </p>
        {confirmStep === 0 && (
          <button
            onClick={() => setConfirmStep(1)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95"
          >
            <Trash2 size={13} />
            Clear All Data
          </button>
        )}
        {confirmStep === 1 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 rounded-lg bg-[var(--destructive)]/15 p-2.5 text-[11px] text-[var(--destructive)] font-medium">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Are you sure? This will erase everything. There is no undo.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmStep(0)}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--secondary)] active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmStep(2);
                  clearAllData.mutate(undefined, {
                    onSettled: () => setConfirmStep(0),
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95"
              >
                <Trash2 size={12} />
                Yes, Delete Everything
              </button>
            </div>
          </div>
        )}
        {confirmStep === 2 && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size={14} className="animate-spin" />
            Clearing all data…
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSetting({
  label,
  checked,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
      />
      <span className="text-xs">{label}</span>
      {help && (
        <span onClick={(e) => e.preventDefault()}>
          <HelpTooltip text={help} />
        </span>
      )}
    </label>
  );
}
