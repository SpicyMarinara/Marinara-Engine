// ──────────────────────────────────────────────
// Panel: Settings (polished)
// ──────────────────────────────────────────────
import {
  APP_LANGUAGE_OPTIONS,
  useUIStore,
  type InstalledExtension,
  type RoleplayAvatarStyle,
  type VisualTheme,
} from "../../stores/ui.store";
import { cn, generateClientId } from "../../lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { forceRefreshSpa } from "@/lib/browser-runtime";
import React, { useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { APP_VERSION, type Theme } from "@marinara-engine/shared";
import {
  findDuplicateTheme,
  useCreateTheme,
  useDeleteTheme,
  useSetActiveTheme,
  useThemes,
  useUpdateTheme,
} from "../../hooks/use-themes";
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
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useClearAllData, useExpungeData, type ExpungeScope } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { chatKeys } from "../../hooks/use-chats";
import { HelpTooltip } from "../ui/HelpTooltip";
import { ConversationSoundSetting, ToggleSetting } from "./settings/SettingControls";
import { DraftNumberInput } from "../ui/DraftNumberInput";

const TABS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "themes", label: "Themes" },
  { id: "extensions", label: "Extensions" },
  { id: "import", label: "Import" },
  { id: "advanced", label: "Advanced" },
] as const;

const SETTINGS_COMPONENTS: Record<(typeof TABS)[number]["id"], React.FC> = {
  general: React.memo(GeneralSettings),
  appearance: React.memo(AppearanceSettings),
  themes: React.memo(ThemesSettings),
  extensions: React.memo(ExtensionsSettings),
  import: React.memo(ImportSettings),
  advanced: React.memo(AdvancedSettings),
};

const EXPUNGE_SCOPE_OPTIONS: Array<{ id: ExpungeScope; label: string; description: string }> = [
  {
    id: "chats",
    label: "Chats & Messages",
    description: "Chats, folders, messages, scene/OOC data, and chat runtime state.",
  },
  {
    id: "characters",
    label: "Characters",
    description: "Characters and character groups. Professor Mari is always preserved.",
  },
  { id: "personas", label: "Personas", description: "Personas and persona groups." },
  { id: "lorebooks", label: "Lorebooks", description: "Lorebooks and lorebook entries." },
  { id: "presets", label: "Presets", description: "Prompt presets, groups, sections, and variables." },
  { id: "connections", label: "Connections", description: "API connections and model endpoints." },
  {
    id: "automation",
    label: "Automation & Themes",
    description: "Agents, tools, regex scripts, synced themes, and automation state.",
  },
  {
    id: "media",
    label: "Media & Assets",
    description: "Backgrounds, avatars, sprites, gallery items, fonts, and knowledge-source files.",
  },
];

const ROLEPLAY_AVATAR_STYLE_OPTIONS: Array<{ id: RoleplayAvatarStyle; label: string; desc: string }> = [
  {
    id: "circles",
    label: "Small Circles",
    desc: "Compact portrait bubbles beside each roleplay message.",
  },
  {
    id: "panel",
    label: "Glued Side Panel",
    desc: "A taller portrait strip fused into the message bubble.",
  },
];

// Module-level set survives component remounts (e.g. mobile AnimatePresence unmount/remount)
const mountedSettingsTabs = new Set<string>();

export function SettingsPanel() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  mountedSettingsTabs.add(settingsTab);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex flex-shrink-0 flex-wrap border-b border-[var(--sidebar-border)]">
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

      <div className="relative min-h-0 flex-1">
        {TABS.map((tab) => {
          if (!mountedSettingsTabs.has(tab.id)) return null;
          const Comp = SETTINGS_COMPONENTS[tab.id];
          const active = settingsTab === tab.id;
          return (
            <div
              key={tab.id}
              className="absolute inset-0 overflow-y-auto p-3"
              style={active ? undefined : { clipPath: "inset(100%)", pointerEvents: "none" }}
            >
              <Comp />
            </div>
          );
        })}
      </div>
    </div>
  );
}
function GeneralSettings() {
  const language = useUIStore((s) => s.language);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const enableStreaming = useUIStore((s) => s.enableStreaming);
  const setEnableStreaming = useUIStore((s) => s.setEnableStreaming);
  const streamingSpeed = useUIStore((s) => s.streamingSpeed);
  const setStreamingSpeed = useUIStore((s) => s.setStreamingSpeed);
  const gameInstantTextReveal = useUIStore((s) => s.gameInstantTextReveal);
  const setGameInstantTextReveal = useUIStore((s) => s.setGameInstantTextReveal);
  const gameTextSpeed = useUIStore((s) => s.gameTextSpeed);
  const setGameTextSpeed = useUIStore((s) => s.setGameTextSpeed);
  const gameAutoPlayDelay = useUIStore((s) => s.gameAutoPlayDelay);
  const setGameAutoPlayDelay = useUIStore((s) => s.setGameAutoPlayDelay);
  const enterToSendRP = useUIStore((s) => s.enterToSendRP);
  const setEnterToSendRP = useUIStore((s) => s.setEnterToSendRP);
  const enterToSendConvo = useUIStore((s) => s.enterToSendConvo);
  const setEnterToSendConvo = useUIStore((s) => s.setEnterToSendConvo);
  const enterToSendGame = useUIStore((s) => s.enterToSendGame);
  const setEnterToSendGame = useUIStore((s) => s.setEnterToSendGame);
  const confirmBeforeDelete = useUIStore((s) => s.confirmBeforeDelete);
  const setConfirmBeforeDelete = useUIStore((s) => s.setConfirmBeforeDelete);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const setMessagesPerPage = useUIStore((s) => s.setMessagesPerPage);
  const boldDialogue = useUIStore((s) => s.boldDialogue);
  const setBoldDialogue = useUIStore((s) => s.setBoldDialogue);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--muted-foreground)]">General application settings.</div>

      <label className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 text-xs font-medium">
          Language
          <HelpTooltip text="Choose the app language. Only English is available right now, but this setting is persisted so future translation PRs can extend it cleanly." />
        </span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as (typeof APP_LANGUAGE_OPTIONS)[number]["id"])}
          className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
        >
          {APP_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          English is the only bundled language for now. Future translations can add more options here without changing
          the settings shape.
        </p>
      </label>

      <ToggleSetting
        label="Enable streaming responses"
        checked={enableStreaming}
        onChange={setEnableStreaming}
        help="When on, AI responses appear word-by-word as they're generated. When off, the full response appears at once after completion."
      />

      {/* Streaming Speed */}
      <label
        className={cn(
          "flex flex-col gap-1.5 rounded-lg p-1 transition-colors",
          enableStreaming ? "hover:bg-[var(--secondary)]/50" : "opacity-40 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">Streaming speed</span>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{streamingSpeed}</span>
          <HelpTooltip text="How fast streaming tokens appear on screen. Lower values give a slower typewriter effect so you can read along. Higher values show text almost instantly." />
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={streamingSpeed}
          onChange={(e) => setStreamingSpeed(Number(e.target.value))}
          className="w-full accent-[var(--primary)]"
        />
        <div className="flex justify-between text-[0.625rem] text-[var(--muted-foreground)]">
          <span>Slow</span>
          <span>Fast</span>
        </div>
      </label>

      <ToggleSetting
        label="Instantly reveal game text"
        checked={gameInstantTextReveal}
        onChange={setGameInstantTextReveal}
        help="When enabled, Game mode narration segments appear fully as soon as you enter them. This skips the typewriter effect and hides the narration speed control."
      />

      {/* Game Narration Text Speed */}
      {!gameInstantTextReveal && (
        <label className="flex flex-col gap-1.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
          <div className="flex items-center gap-2">
            <span className="text-xs">Game narration speed</span>
            <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{gameTextSpeed}</span>
            <HelpTooltip text="How fast the typewriter effect displays narration text in Game mode. Lower values give a slower cinematic reveal. Higher values show text almost instantly." />
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={gameTextSpeed}
            onChange={(e) => setGameTextSpeed(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between text-[0.625rem] text-[var(--muted-foreground)]">
            <span>Slow</span>
            <span>Fast</span>
          </div>
        </label>
      )}

      {/* Game Auto-Play Delay */}
      <label className="flex flex-col gap-1.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
        <div className="flex items-center gap-2">
          <span className="text-xs">Game auto-play segment delay</span>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
            {(gameAutoPlayDelay / 1000).toFixed(1)}s
          </span>
          <HelpTooltip text="Pause between each narration segment when auto-play is enabled in Game mode. Enable auto-play via the ▶ button next to Next." />
        </div>
        <input
          type="range"
          min={200}
          max={5000}
          step={100}
          value={gameAutoPlayDelay}
          onChange={(e) => setGameAutoPlayDelay(Number(e.target.value))}
          className="w-full accent-[var(--primary)]"
        />
        <div className="flex justify-between text-[0.625rem] text-[var(--muted-foreground)]">
          <span>Short</span>
          <span>Long</span>
        </div>
      </label>

      {/* Send on Enter — inline toggles per mode */}
      <div className="flex flex-col gap-1.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
        <div className="flex items-center gap-2">
          <span className="text-xs">Send on Enter</span>
          <HelpTooltip text="Choose which chat modes send on Enter. When off, Enter creates a new line and you press Ctrl/Cmd+Enter to send." />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setEnterToSendRP(!enterToSendRP)}
            className={cn(
              "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-all",
              enterToSendRP
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
            )}
          >
            Roleplay
          </button>
          <button
            onClick={() => setEnterToSendConvo(!enterToSendConvo)}
            className={cn(
              "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-all",
              enterToSendConvo
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
            )}
          >
            Conversations
          </button>
          <button
            onClick={() => setEnterToSendGame(!enterToSendGame)}
            className={cn(
              "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-all",
              enterToSendGame
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
            )}
          >
            Game
          </button>
        </div>
      </div>

      <ToggleSetting
        label="Confirm before deleting"
        checked={confirmBeforeDelete}
        onChange={setConfirmBeforeDelete}
        help="Shows a confirmation dialog before permanently deleting chats, characters, or other items. Recommended to keep on."
      />

      {/* Messages per page */}
      <label className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
        <span className="text-xs">Messages per page</span>
        <DraftNumberInput
          value={messagesPerPage}
          min={0}
          max={500}
          onCommit={(nextValue) => setMessagesPerPage(Math.max(0, Math.min(500, nextValue)))}
          className="w-16 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs"
        />
        <HelpTooltip text="How many messages to load at a time. Click 'Load More' in the chat to see older messages. Set to 0 to load all messages at once." />
      </label>

      <ToggleSetting
        label="Bold dialogue in quotes"
        checked={boldDialogue ?? true}
        onChange={setBoldDialogue}
        help={
          'When on, text inside quotation marks ("like this") is bolded in addition to its dialogue highlight color. Turn it off to keep the color without bold.'
        }
      />

      {/* Game Assets Folders */}
      <div className="rounded-xl bg-[var(--secondary)]/50 p-4 ring-1 ring-[var(--border)]">
        <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">Game Asset Folders</div>
        <div className="flex flex-wrap gap-2">
          {(["music", "ambient", "sfx", "sprites", "backgrounds"] as const).map((folder) => (
            <button
              key={folder}
              onClick={() => api.post("/game-assets/open-folder", { subfolder: folder }).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.6875rem] font-medium capitalize text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <FolderOpen size="0.75rem" />
              {folder}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
          Drop <code className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[var(--foreground)]/70">.mp3</code>,{" "}
          <code className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[var(--foreground)]/70">.ogg</code>, or{" "}
          <code className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[var(--foreground)]/70">.wav</code> files into
          the subfolder that matches the vibe (e.g. combat music → <strong>music/combat</strong>, forest ambience →{" "}
          <strong>ambient/nature</strong>). Restart or rescan assets for changes to take effect.
        </p>
      </div>
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
  const convoGradientFrom = useUIStore((s) => s.convoGradientFrom);
  const setConvoGradientFrom = useUIStore((s) => s.setConvoGradientFrom);
  const convoGradientTo = useUIStore((s) => s.convoGradientTo);
  const setConvoGradientTo = useUIStore((s) => s.setConvoGradientTo);
  const [draftFrom, setDraftFrom] = useState(convoGradientFrom);
  const [draftTo, setDraftTo] = useState(convoGradientTo);
  const fontSize = useUIStore((s) => s.fontSize);
  const setFontSize = useUIStore((s) => s.setFontSize);
  const chatFontSize = useUIStore((s) => s.chatFontSize);
  const setChatFontSize = useUIStore((s) => s.setChatFontSize);
  const weatherEffects = useUIStore((s) => s.weatherEffects);
  const setWeatherEffects = useUIStore((s) => s.setWeatherEffects);

  // Text appearance
  const chatFontColor = useUIStore((s) => s.chatFontColor);
  const setChatFontColor = useUIStore((s) => s.setChatFontColor);
  const chatFontOpacity = useUIStore((s) => s.chatFontOpacity);
  const setChatFontOpacity = useUIStore((s) => s.setChatFontOpacity);
  const roleplayAvatarStyle = useUIStore((s) => s.roleplayAvatarStyle);
  const setRoleplayAvatarStyle = useUIStore((s) => s.setRoleplayAvatarStyle);
  const textStrokeWidth = useUIStore((s) => s.textStrokeWidth);
  const setTextStrokeWidth = useUIStore((s) => s.setTextStrokeWidth);
  const textStrokeColor = useUIStore((s) => s.textStrokeColor);
  const setTextStrokeColor = useUIStore((s) => s.setTextStrokeColor);
  const [draftChatFontColor, setDraftChatFontColor] = useState(chatFontColor || "#c3c2c2");
  const [draftStrokeColor, setDraftStrokeColor] = useState(textStrokeColor);

  // Custom fonts — query is pre-warmed in App.tsx, no fetch here
  const { data: customFonts } = useQuery<{ filename: string; family: string; url: string }[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: Infinity,
  });

  // Google Fonts download
  const [googleFontName, setGoogleFontName] = useState("");
  const queryClient = useQueryClient();
  const googleFontMutation = useMutation({
    mutationFn: (family: string) =>
      api.post<{ filename: string; family: string; url: string }>("/fonts/google/download", { family }),
    onSuccess: (data) => {
      toast.success(`Installed "${data.family}"`);
      setGoogleFontName("");
      queryClient.invalidateQueries({ queryKey: ["custom-fonts"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to download font");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {/* ── Visual Style ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Paintbrush size="0.75rem" className="text-[var(--muted-foreground)]" />
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
              <span className="text-[0.625rem] text-[var(--muted-foreground)] leading-tight">{opt.desc}</span>
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
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">
            Drop font files (.ttf, .otf, .woff, .woff2) into the <span className="font-medium">data/fonts/</span> folder
            to add custom fonts.
          </p>
        )}
        <button
          onClick={() => api.post("/fonts/open-folder").catch(() => {})}
          className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <FolderOpen size="0.75rem" />
          Open Fonts Folder
        </button>
      </label>

      {/* ── Google Fonts ── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Google Fonts{" "}
          <HelpTooltip text="Download a font directly from Google Fonts by name. Browse available fonts at fonts.google.com and type the exact name here." />
        </span>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={googleFontName}
            onChange={(e) => setGoogleFontName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && googleFontName.trim() && !googleFontMutation.isPending) {
                googleFontMutation.mutate(googleFontName.trim());
              }
            }}
            placeholder="e.g. Fira Code, Lora, Poppins…"
            className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow placeholder:text-[var(--muted-foreground)]/50 focus:ring-[var(--primary)]"
          />
          <button
            onClick={() => googleFontMutation.mutate(googleFontName.trim())}
            disabled={!googleFontName.trim() || googleFontMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {googleFontMutation.isPending ? (
              <Loader2 size="0.75rem" className="animate-spin" />
            ) : (
              <Download size="0.75rem" />
            )}
            {googleFontMutation.isPending ? "Downloading…" : "Add"}
          </button>
        </div>
        <a
          href="https://fonts.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[0.625rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors inline-flex items-center gap-1"
        >
          Browse fonts at fonts.google.com →
        </a>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium inline-flex items-center gap-1">
          Display Size{" "}
          <HelpTooltip text="Adjusts the base font size across the whole app. Larger sizes improve readability. Default is 17px." />
        </span>
        <select
          value={String(fontSize)}
          onChange={(e) => setFontSize(Number(e.target.value) as 12 | 14 | 16 | 17 | 19 | 22)}
          className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
        >
          <option value="12">Tiny</option>
          <option value="14">Small</option>
          <option value="16">Medium</option>
          <option value="17">Default</option>
          <option value="19">Large</option>
          <option value="22">Huge</option>
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

      {/* ── Text Appearance ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <Paintbrush size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Text Appearance</span>
          <HelpTooltip text="Customize the look of chat message text. Chat Text Color sets the default font color for all non-dialogue text. Background Opacity controls the transparency of roleplay message bubbles." />
        </div>

        {/* Chat Text Color */}
        <div className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-medium">Chat Text Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draftChatFontColor}
              onChange={(e) => {
                setDraftChatFontColor(e.target.value);
                setChatFontColor(e.target.value);
              }}
              className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
            />
            <input
              type="text"
              value={draftChatFontColor}
              onChange={(e) => {
                setDraftChatFontColor(e.target.value);
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setChatFontColor(e.target.value);
              }}
              onBlur={() => setDraftChatFontColor(chatFontColor || "#c3c2c2")}
              className="w-24 rounded-md bg-[var(--secondary)] px-2 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            />
          </div>
        </div>

        {/* Roleplay Messages Background Opacity */}
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-medium">Roleplay Messages Background Opacity</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={chatFontOpacity}
              onChange={(e) => setChatFontOpacity(Number(e.target.value))}
              className="flex-1 accent-[var(--primary)]"
            />
            <span className="text-xs tabular-nums text-[var(--muted-foreground)] w-8 text-right">
              {chatFontOpacity}%
            </span>
          </div>
        </label>
        <button
          onClick={() => {
            setChatFontColor("");
            setDraftChatFontColor("#c3c2c2");
            setChatFontOpacity(90);
          }}
          className="text-[0.625rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors self-start"
        >
          Reset to default
        </button>

        {/* Text Stroke */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium inline-flex items-center gap-1">
            Text Outline / Stroke
            <HelpTooltip text="Adds an outline around chat text for better readability over backgrounds. Set width to 0 to disable." />
          </span>
          <div className="flex items-center gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[0.625rem] text-[var(--muted-foreground)]">Width</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={textStrokeWidth}
                  onChange={(e) => setTextStrokeWidth(Number(e.target.value))}
                  className="flex-1 accent-[var(--primary)]"
                />
                <span className="text-xs tabular-nums text-[var(--muted-foreground)] w-10 text-right">
                  {textStrokeWidth}px
                </span>
              </div>
            </label>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={draftStrokeColor}
                  onChange={(e) => {
                    setDraftStrokeColor(e.target.value);
                    setTextStrokeColor(e.target.value);
                  }}
                  className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
                />
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setTextStrokeWidth(0.5);
              setTextStrokeColor("#000000");
              setDraftStrokeColor("#000000");
            }}
            className="text-[0.625rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors self-start"
          >
            Reset to default
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Image size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Roleplay Avatars</span>
          <HelpTooltip text="Choose how avatars sit next to roleplay messages. Small Circles keeps the current compact layout. Glued Side Panel embeds a larger portrait strip into the message bubble itself." />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLEPLAY_AVATAR_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRoleplayAvatarStyle(opt.id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-xs transition-all",
                roleplayAvatarStyle === opt.id
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]"
                  : "border-[var(--border)] hover:border-[var(--primary)]/40",
              )}
            >
              <div className="w-full overflow-hidden rounded-md bg-[var(--secondary)]/80 ring-1 ring-[var(--border)]/70">
                {opt.id === "circles" ? (
                  <div className="flex h-14 items-center px-3">
                    <div className="relative flex-1 rounded-2xl rounded-tl-sm bg-black/25 px-3 py-2">
                      <div className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-rose-400 to-orange-300 shadow-[0_0_0_2px_rgba(255,255,255,0.16)]" />
                      <div className="ml-4 h-1.5 w-14 rounded-full bg-white/20" />
                      <div className="mt-1.5 ml-4 h-1.5 w-20 rounded-full bg-white/12" />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-14 items-stretch overflow-hidden">
                    <div className="relative w-14 overflow-hidden border-r border-white/8 bg-gradient-to-b from-rose-400/60 via-orange-300/45 to-transparent">
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[32%] backdrop-blur-[4px] [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.25)_28%,rgba(0,0,0,0.8)_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.25)_28%,rgba(0,0,0,0.8)_100%)]" />
                      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0)_0%,rgba(255,255,255,0)_72%,rgba(113,113,122,0.84)_92%,rgba(113,113,122,1)_100%)]" />
                    </div>
                    <div className="flex-1 px-3 py-2">
                      <div className="h-1.5 w-14 rounded-full bg-white/20" />
                      <div className="mt-1.5 h-1.5 w-20 rounded-full bg-white/12" />
                    </div>
                  </div>
                )}
              </div>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[0.625rem] leading-tight text-[var(--muted-foreground)]">{opt.desc}</span>
            </button>
          ))}
        </div>
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          The larger panel crops portraits from the top on short messages and fades them back into the bubble background
          on taller ones.
        </p>
      </div>

      {/* ── Effects ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <CloudRain size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Effects</span>
          <HelpTooltip text="Visual effects that enhance the roleplay atmosphere. Weather particles like rain, snow, and fog appear based on the story context." />
        </div>
        <ToggleSetting
          label="Dynamic weather effects (rain, snow, fog, etc.)"
          checked={weatherEffects}
          onChange={setWeatherEffects}
        />
        <p className="text-[0.625rem] text-[var(--muted-foreground)] pl-6">
          Shows animated weather particles based on in-story weather and time of day. Requires the{" "}
          <span className="font-medium">World State</span> agent to be enabled so weather data is extracted from the
          narrative.
        </p>
      </div>

      {/* ── Conversation Gradient ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Palette size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Conversation Theme</span>
          <HelpTooltip text="Set a background gradient for all Conversation-mode chats, similar to Discord." />
        </div>
        {/* Preview */}
        <div
          className="h-16 rounded-lg ring-1 ring-[var(--border)]"
          style={{ background: `linear-gradient(135deg, ${convoGradientFrom}, ${convoGradientTo})` }}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={convoGradientFrom}
                onChange={(e) => {
                  setConvoGradientFrom(e.target.value);
                  setDraftFrom(e.target.value);
                }}
                className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
              />
              <input
                type="text"
                value={draftFrom}
                onChange={(e) => {
                  setDraftFrom(e.target.value);
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setConvoGradientFrom(e.target.value);
                }}
                onBlur={() => setDraftFrom(convoGradientFrom)}
                className="w-full rounded-md bg-[var(--secondary)] px-2 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={convoGradientTo}
                onChange={(e) => {
                  setConvoGradientTo(e.target.value);
                  setDraftTo(e.target.value);
                }}
                className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
              />
              <input
                type="text"
                value={draftTo}
                onChange={(e) => {
                  setDraftTo(e.target.value);
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setConvoGradientTo(e.target.value);
                }}
                onBlur={() => setDraftTo(convoGradientTo)}
                className="w-full rounded-md bg-[var(--secondary)] px-2 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
              />
            </div>
          </label>
        </div>
        <button
          onClick={() => {
            setConvoGradientFrom("#0a0a0e");
            setConvoGradientTo("#1c2133");
            setDraftFrom("#0a0a0e");
            setDraftTo("#1c2133");
          }}
          className="text-[0.625rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors self-start"
        >
          Reset to default
        </button>
      </div>

      {/* ── Conversation Sound ── */}
      <ConversationSoundSetting />

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
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.625rem] text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
            >
              <X size="0.625rem" /> Remove
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
        {uploading ? <Loader2 size="0.875rem" className="animate-spin" /> : <Upload size="0.875rem" />}
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
                        <Check size="0.875rem" className="text-white" />
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
                            className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.625rem] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                            autoFocus
                          />
                          <button
                            type="submit"
                            disabled={!renameInput.trim() || renameBg.isPending}
                            className="shrink-0 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--primary-foreground)] disabled:opacity-40"
                          >
                            {renameBg.isPending ? "…" : "Save"}
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{bg.filename}</span>
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
                            <Pencil size="0.5625rem" />
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
                        <Trash2 size="0.625rem" />
                      </button>
                    </div>
                    {/* Tags */}
                    <div className="flex flex-wrap items-center gap-1">
                      {bg.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 rounded-full bg-[var(--secondary)] px-1.5 py-0 text-[0.5625rem] text-[var(--muted-foreground)]"
                        >
                          {tag}
                          {isEditing && (
                            <button
                              onClick={() => removeTag(bg.filename, bg.tags, tag)}
                              className="ml-0.5 hover:text-[var(--destructive)]"
                            >
                              <X size="0.5rem" />
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
                        <Tag size="0.5625rem" />
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
                          className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.625rem] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
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
                          className="shrink-0 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--primary-foreground)] disabled:opacity-40"
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
          <Image size="1.25rem" className="text-[var(--muted-foreground)]/40" />
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">No backgrounds uploaded yet</p>
        </div>
      )}
    </div>
  );
}

function ThemesSettings() {
  const { data: syncedThemes = [], isLoading } = useThemes();
  const createTheme = useCreateTheme();
  const updateTheme = useUpdateTheme();
  const deleteTheme = useDeleteTheme();
  const setActiveTheme = useSetActiveTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const activeCustomTheme = syncedThemes.find((theme) => theme.isActive) ?? null;
  const isSavingTheme = createTheme.isPending || updateTheme.isPending || setActiveTheme.isPending;

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
    }
    style.textContent = themeCss;
    // Always (re-)append so it's the last <style> in <head>,
    // overriding the active-theme injector's saved CSS.
    document.head.appendChild(style);
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

  const openEditTheme = useCallback((theme: Theme) => {
    setEditingId(theme.id);
    setThemeName(theme.name);
    setThemeCss(theme.css);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const name = themeName.trim() || "Untitled Theme";
      if (editingId) {
        await updateTheme.mutateAsync({ id: editingId, name, css: themeCss });
        toast.success(`Theme "${name}" updated`);
      } else {
        const theme = await createTheme.mutateAsync({
          name,
          css: themeCss,
          installedAt: new Date().toISOString(),
        });
        await setActiveTheme.mutateAsync(theme.id);
        toast.success(`Theme "${name}" saved and activated`);
      }
      setEditorOpen(false);
    } catch (err) {
      console.error("[ThemesSettings] Failed to save theme:", err);
      toast.error("Failed to save theme. Check the browser console for details.");
    }
  }, [createTheme, editingId, setActiveTheme, themeCss, themeName, updateTheme]);

  const handleImportTheme = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let importedThemeName: string;
      let importedThemeCss: string;

      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        importedThemeName =
          typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : file.name.replace(/\.json$/, "");
        importedThemeCss = typeof parsed.css === "string" ? parsed.css : "";
      } else {
        importedThemeName = file.name.replace(/\.css$/, "");
        importedThemeCss = text;
      }

      const latestThemes = await api.get<Theme[]>("/themes");
      const duplicate = findDuplicateTheme(latestThemes, importedThemeName, importedThemeCss);
      if (duplicate) {
        toast.success(`Theme "${duplicate.name}" is already synced`);
      } else {
        await createTheme.mutateAsync({
          name: importedThemeName,
          css: importedThemeCss,
          installedAt: new Date().toISOString(),
        });
        toast.success(`Theme "${importedThemeName}" imported`);
      }
    } catch (err) {
      console.error("[ThemesSettings] Failed to import theme:", err);
      toast.error("Failed to import theme. Ensure it's a valid CSS or JSON file.");
    }
    e.target.value = "";
  };

  // ── CSS Editor View ──
  if (editorOpen) {
    return (
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditorOpen(false)}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <X size="0.875rem" />
            </button>
            <span className="text-xs font-semibold">{editingId ? "Edit Theme" : "New Theme"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLivePreview(!livePreview)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] transition-colors",
                livePreview
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
              )}
              title={livePreview ? "Disable live preview" : "Enable live preview"}
            >
              {livePreview ? <Eye size="0.6875rem" /> : <EyeOff size="0.6875rem" />}
              Preview
            </button>
            <button
              onClick={handleSave}
              disabled={isSavingTheme}
              className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingTheme ? <Loader2 size="0.6875rem" className="animate-spin" /> : <Save size="0.6875rem" />}
              {isSavingTheme ? "Saving..." : "Save"}
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
          className="min-h-[22.5rem] resize-y rounded-lg border border-[var(--border)] bg-[#0d1117] p-3 font-mono text-[0.6875rem] leading-relaxed text-emerald-300 outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-white/20"
          placeholder="/* Enter your CSS here... */"
        />

        {/* Quick reference */}
        <details className="group rounded-lg bg-[var(--secondary)]/50 ring-1 ring-[var(--border)]">
          <summary className="cursor-pointer px-3 py-2 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            CSS Variable Reference
          </summary>
          <div className="border-t border-[var(--border)] px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Palette size="0.75rem" />
        Create or import custom CSS themes. Themes sync across devices connected to this Marinara server, while
        extensions stay local to this browser.
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={openNewTheme}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3 text-xs text-[var(--primary)] transition-all hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10"
        >
          <Plus size="0.875rem" /> Create Theme
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/50"
        >
          <Download size="0.875rem" /> Import File
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".css,.json" className="hidden" onChange={handleImportTheme} />

      {/* Active theme: None option */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Installed Themes</span>
        <button
          onClick={() =>
            setActiveTheme.mutate(null, {
              onError: (err) => {
                console.error("[ThemesSettings] Failed to reset active theme:", err);
                toast.error("Failed to reset the active theme.");
              },
            })
          }
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all",
            activeCustomTheme === null
              ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <Palette size="0.75rem" />
          Default Theme
          {activeCustomTheme === null && <Check size="0.75rem" className="ml-auto" />}
        </button>

        {/* Custom theme list */}
        {syncedThemes.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all",
              activeCustomTheme?.id === t.id
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            <button
              onClick={() =>
                setActiveTheme.mutate(t.id, {
                  onError: (err) => {
                    console.error("[ThemesSettings] Failed to activate theme:", err);
                    toast.error("Failed to activate theme.");
                  },
                })
              }
              className="flex flex-1 items-center gap-2 min-w-0"
            >
              <FileCode2 size="0.75rem" className="shrink-0" />
              <span className="truncate">{t.name}</span>
              {activeCustomTheme?.id === t.id && <Check size="0.75rem" className="shrink-0" />}
            </button>
            <button
              onClick={() => openEditTheme(t)}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]"
              title="Edit theme CSS"
            >
              <Code size="0.6875rem" />
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
              <Download size="0.6875rem" />
            </button>
            <button
              onClick={() => {
                void (async () => {
                  try {
                    await deleteTheme.mutateAsync(t.id);
                    toast.success(`Theme "${t.name}" removed`);
                  } catch (err) {
                    console.error("[ThemesSettings] Failed to remove theme:", err);
                    toast.error("Failed to remove theme.");
                  }
                })();
              }}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              title="Remove theme"
            >
              <Trash2 size="0.6875rem" />
            </button>
          </div>
        ))}

        {isLoading && syncedThemes.length === 0 && (
          <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">Loading synced themes...</p>
        )}

        {!isLoading && syncedThemes.length === 0 && (
          <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
            No synced custom themes yet. Create one or import a .css file above.
          </p>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-[var(--secondary)]/50 p-2.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
        <strong>Tip:</strong> CSS themes can override any CSS variable (e.g.{" "}
        <code className="rounded bg-[var(--secondary)] px-1">--background</code>,{" "}
        <code className="rounded bg-[var(--secondary)] px-1">--primary</code>) or add custom styles. JSON themes should
        have <code className="rounded bg-[var(--secondary)] px-1">{`{ "name": "...", "css": "..." }`}</code> format.
        Imported theme files sync to this Marinara server but do not auto-activate.
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
          id: generateClientId(),
          name: parsed.name ?? file.name.replace(/\.json$/, ""),
          description: parsed.description ?? "",
          css: parsed.css ?? undefined,
          js: parsed.js ?? undefined,
          enabled: true,
          installedAt: new Date().toISOString(),
        };
        addExtension(ext);
        toast.success(`Extension "${ext.name}" installed`);
      } else if (file.name.endsWith(".js")) {
        const ext: InstalledExtension = {
          id: generateClientId(),
          name: file.name.replace(/\.js$/, ""),
          description: "JS extension imported from file",
          js: text,
          enabled: true,
          installedAt: new Date().toISOString(),
        };
        addExtension(ext);
        toast.success(`Extension "${ext.name}" installed`);
      } else if (file.name.endsWith(".css")) {
        const ext: InstalledExtension = {
          id: generateClientId(),
          name: file.name.replace(/\.css$/, ""),
          description: "CSS extension imported from file",
          css: text,
          enabled: true,
          installedAt: new Date().toISOString(),
        };
        addExtension(ext);
      } else {
        toast.error("Only .json and .css extension files are supported.");
      }
    } catch {
      toast.error("Failed to import extension.");
    }
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Puzzle size="0.75rem" />
        Install custom extensions to add new features and styles.
      </div>

      {/* Import button */}
      <button
        onClick={() => fileRef.current?.click()}
        className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/50"
      >
        <Download size="0.875rem" /> Import Extension (.json, .css, or .js)
      </button>
      <input ref={fileRef} type="file" accept=".json,.css,.js" className="hidden" onChange={handleImportExtension} />

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
              {ext.enabled ? <Power size="0.75rem" /> : <PowerOff size="0.75rem" />}
            </button>
            <div className="flex flex-1 flex-col min-w-0">
              <span className="truncate font-medium">{ext.name}</span>
              {ext.description && (
                <span className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{ext.description}</span>
              )}
            </div>
            <button
              onClick={() => removeExtension(ext.id)}
              className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              title="Remove extension"
            >
              <Trash2 size="0.6875rem" />
            </button>
          </div>
        ))}

        {extensions.length === 0 && (
          <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
            No extensions installed. Import a .json or .css extension file above.
          </p>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-[var(--secondary)]/50 p-2.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
        <strong>JSON format:</strong>{" "}
        <code className="rounded bg-[var(--secondary)] px-1">{`{ "name": "...", "description": "...", "css": "..." }`}</code>
        . Extensions can inject custom CSS and/or JavaScript to modify the UI.
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
        toast.success(`Imported ${data.name ?? data.type} successfully!`);
      } else {
        toast.error(`Import failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      toast.error("Import failed. Make sure this is a valid .marinara.json file.");
    }
    e.target.value = "";
  };

  const handleProfileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      if (envelope.type !== "marinara_profile") {
        toast.error("Not a valid profile export file.");
        return;
      }
      const res = await fetch("/api/backup/import-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = await res.json();
      if (data.success) {
        qc.invalidateQueries();
        const s = data.imported;
        toast.success(
          `Imported: ${s.characters} characters, ${s.personas} personas, ${s.lorebooks} lorebooks, ${s.presets} presets, ${s.agents} agents, ${s.themes ?? 0} themes`,
        );
      } else {
        toast.error(`Import failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      toast.error("Import failed. Make sure this is a valid profile JSON file.");
    }
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--muted-foreground)]">
        Import data from Marinara exports, SillyTavern, or other tools. Full profile imports also restore synced custom
        themes.
      </div>

      {/* Profile import */}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 px-3 py-3 text-xs font-semibold ring-1 ring-emerald-500/30 transition-all hover:ring-emerald-500/50 active:scale-[0.98]">
        <Download size="1rem" />
        Import Profile (Full Export)
        <input type="file" accept=".json" onChange={handleProfileImport} className="hidden" />
      </label>

      {/* Marinara import */}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500/20 to-orange-500/20 px-3 py-3 text-xs font-semibold ring-1 ring-pink-500/30 transition-all hover:ring-pink-500/50 active:scale-[0.98]">
        <Download size="1rem" />
        Import Marinara File (.marinara.json)
        <input type="file" accept=".json" onChange={handleMarinaraImport} className="hidden" />
      </label>

      <div className="retro-divider" />

      {/* Bulk ST import */}
      <span className="text-[0.625rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
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
        // Pass filename as fallback name for lorebook/preset imports
        if (endpoint.includes("lorebook") || endpoint.includes("preset")) {
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
          toast.success("Imported successfully!");
        }
      } else {
        toast.error(`Import failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      toast.error("Import failed.");
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
  const showTokenUsage = useUIStore((s) => s.showTokenUsage);
  const setShowTokenUsage = useUIStore((s) => s.setShowTokenUsage);
  const showMessageNumbers = useUIStore((s) => s.showMessageNumbers);
  const setShowMessageNumbers = useUIStore((s) => s.setShowMessageNumbers);
  const clearAllData = useClearAllData();
  const expungeData = useExpungeData();
  const [selectedScopes, setSelectedScopes] = useState<ExpungeScope[]>(["chats"]);
  const [confirmAction, setConfirmAction] = useState<"selected" | "all" | null>(null);
  const [exportingProfile, setExportingProfile] = useState(false);
  const [refreshingSpa, setRefreshingSpa] = useState(false);

  const handleExportProfile = async () => {
    setExportingProfile(true);
    try {
      const res = await fetch("/api/backup/export-profile");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "marinara-profile.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Profile exported!");
    } catch {
      toast.error("Failed to export profile");
    } finally {
      setExportingProfile(false);
    }
  };

  const handleForceRefreshSpa = async () => {
    if (refreshingSpa) {
      return;
    }

    setRefreshingSpa(true);

    try {
      toast.info("Clearing caches and refreshing app…");
      await forceRefreshSpa();
    } catch (err) {
      setRefreshingSpa(false);
      toast.error(err instanceof Error ? err.message : "Failed to refresh the app");
    }
  };

  const qc = useQueryClient();
  const [creatingBackup, setCreatingBackup] = useState(false);

  /**
   * Download a full backup to a user-chosen location.
   *
   * Uses the File System Access API (`showSaveFilePicker`) when available so
   * the browser opens a native "Save As" dialog — this is important on Android
   * and iOS, where the server-side `data/backups/` folder isn't reachable
   * without root. Falls back to an anchor-triggered download (which routes
   * through the browser's default Downloads handling).
   */
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await fetch("/api/backup/download", { method: "POST" });
      if (!res.ok) throw new Error("Backup failed");

      // Pull the filename from Content-Disposition if provided
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const suggestedName = filenameMatch?.[1] ?? `marinara-backup-${timestamp}.zip`;

      const blob = await res.blob();

      // Preferred path: native "Save As" dialog (Chromium desktop, some Android)
      const w = window as typeof window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
        }>;
      };
      if (typeof w.showSaveFilePicker === "function") {
        try {
          const handle = await w.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: "Marinara backup archive",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          toast.success("Backup saved!");
          qc.invalidateQueries({ queryKey: ["backups"] });
          return;
        } catch (err) {
          // User cancelled the native picker — treat as a silent no-op
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Any other failure falls through to the anchor fallback
        }
      }

      // Fallback: anchor download. On Android Chrome this routes through the
      // system Downloads handler (which typically prompts the user or drops
      // the file in the Downloads folder, both of which are user-accessible).
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded!");
      qc.invalidateQueries({ queryKey: ["backups"] });
    } catch {
      toast.error("Failed to create backup");
    } finally {
      setCreatingBackup(false);
    }
  };

  const { data: backups } = useQuery<{ name: string; createdAt: string; path: string }[]>({
    queryKey: ["backups"],
    queryFn: () => api.get("/backup"),
  });

  const health = useQuery<{
    status: string;
    timestamp: string;
    version: string;
    commit: string | null;
    build: string;
  }>({
    queryKey: ["health"],
    queryFn: () => api.get("/health"),
    staleTime: 60_000,
  });

  const deleteBackupMutation = useMutation({
    mutationFn: (name: string) => api.delete(`/backup/${name}`),
    onSuccess: () => {
      toast.success("Backup deleted");
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
  });

  const updateCheck = useQuery<{
    currentVersion: string;
    currentCommit: string | null;
    currentBuild: string;
    latestVersion: string;
    updateAvailable: boolean;
    versionUpdate?: boolean;
    commitsBehind?: number;
    releaseUrl: string;
    releaseNotes: string;
    publishedAt: string;
    installType: "git" | "standalone";
  }>({
    queryKey: ["update-check"],
    queryFn: () => api.get("/updates/check"),
    enabled: false,
    retry: false,
  });

  const applyUpdate = useMutation({
    mutationFn: () => api.post<{ status: string; message: string }>("/updates/apply"),
    onSuccess: (data) => {
      if (data.status === "already_up_to_date") {
        toast.info(data.message);
      } else {
        toast.success(data.message);
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    },
  });

  const currentReleaseLabel = `v${health.data?.version ?? updateCheck.data?.currentVersion ?? APP_VERSION}`;
  const currentCommit = health.data?.commit ?? updateCheck.data?.currentCommit ?? null;
  const currentBuildLabel = currentCommit ? `Build: ${currentCommit.slice(0, 7)}` : "Build: unavailable";
  const isClearing = clearAllData.isPending || expungeData.isPending;
  const isAllScopesSelected = selectedScopes.length === EXPUNGE_SCOPE_OPTIONS.length;

  const toggleScope = (scope: ExpungeScope) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope],
    );
  };

  const runExpunge = (mode: "selected" | "all") => {
    if (mode === "all") {
      clearAllData.mutate(undefined, {
        onSuccess: () => toast.success("All selected data was cleared. Runtime caches were reset immediately."),
        onError: () => toast.error("Failed to clear all data."),
        onSettled: () => setConfirmAction(null),
      });
      return;
    }

    expungeData.mutate(selectedScopes, {
      onSuccess: () => toast.success("Selected data was cleared. Runtime caches were reset immediately."),
      onError: () => toast.error("Failed to clear selected data."),
      onSettled: () => setConfirmAction(null),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--muted-foreground)]">Advanced settings for power users.</div>

      {/* ── Updates ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <RefreshCw size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Updates</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => updateCheck.refetch()}
            disabled={updateCheck.isFetching}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {updateCheck.isFetching ? (
              <>
                <Loader2 size="0.8125rem" className="animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <RefreshCw size="0.8125rem" />
                Check for Updates
              </>
            )}
          </button>
          <div className="flex flex-col text-[0.6875rem] text-[var(--muted-foreground)]">
            <span>Release: {currentReleaseLabel}</span>
            <span>{currentBuildLabel}</span>
          </div>
        </div>

        {updateCheck.data && !updateCheck.data.updateAvailable && (
          <div className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-2 ring-1 ring-[var(--border)]">
            <Check size="0.8125rem" className="text-green-500 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs">You're on the latest release ({currentReleaseLabel})</span>
              <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{currentBuildLabel}</span>
            </div>
          </div>
        )}

        {updateCheck.data?.updateAvailable && (
          <div className="flex flex-col gap-2 rounded-lg bg-[var(--secondary)] p-2.5 ring-1 ring-[var(--border)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {updateCheck.data.versionUpdate
                  ? `v${updateCheck.data.latestVersion} available`
                  : `${updateCheck.data.commitsBehind ?? 1} new update${(updateCheck.data.commitsBehind ?? 1) !== 1 ? "s" : ""} available`}
              </span>
              {updateCheck.data.versionUpdate && (
                <a
                  href={updateCheck.data.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[0.625rem] text-[var(--primary)] hover:underline"
                >
                  Release notes <ExternalLink size="0.625rem" />
                </a>
              )}
            </div>
            {updateCheck.data.versionUpdate && updateCheck.data.releaseNotes && (
              <p className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-4 whitespace-pre-wrap">
                {updateCheck.data.releaseNotes}
              </p>
            )}
            {updateCheck.data.installType === "git" ? (
              <button
                onClick={() => applyUpdate.mutate()}
                disabled={applyUpdate.isPending}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {applyUpdate.isPending ? (
                  <>
                    <Loader2 size="0.8125rem" className="animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>
                    <Download size="0.8125rem" />
                    Apply Update
                  </>
                )}
              </button>
            ) : (
              <div className="flex flex-col gap-1.5">
                <a
                  href={updateCheck.data.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95"
                >
                  <Download size="0.8125rem" />
                  Download v{updateCheck.data.latestVersion}
                </a>
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Docker users:{" "}
                  <code className="rounded bg-[var(--background)] px-1 py-0.5">
                    docker compose pull && docker compose up -d
                  </code>
                </span>
              </div>
            )}
          </div>
        )}

        {updateCheck.isError && (
          <div className="flex items-center gap-1.5 rounded-lg bg-[var(--destructive)]/10 px-2.5 py-2 text-xs text-[var(--destructive)]">
            <AlertTriangle size="0.8125rem" className="shrink-0" />
            Could not check for updates. Try again later.
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleForceRefreshSpa()}
            disabled={refreshingSpa}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--background)]/70 px-3 py-2 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshingSpa ? (
              <>
                <Loader2 size="0.8125rem" className="animate-spin" />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCw size="0.8125rem" />
                Refresh App
              </>
            )}
          </button>
          <HelpTooltip
            side="bottom"
            text="Manual refresh unregisters the active service worker and clears browser caches before reloading. Marinara's stored chats, settings, and other local app data stay intact."
          />
        </div>
      </div>

      <div className="retro-divider" />
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
        label="Show token usage on messages"
        checked={showTokenUsage}
        onChange={setShowTokenUsage}
        help="Displays prompt and completion token counts on each AI message. Useful for monitoring context size and cost."
      />
      <ToggleSetting
        label="Show message numbers"
        checked={showMessageNumbers}
        onChange={setShowMessageNumbers}
        help="Displays a message number below each avatar in roleplay chats."
      />
      <ToggleSetting
        label="Debug mode (log prompts to console)"
        checked={debugMode}
        onChange={setDebugMode}
        help="Logs the full prompt and API request/response to the browser console. Useful for advanced users debugging prompt formatting."
      />

      {/* ── Backup ── */}
      <div className="retro-divider" />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Download size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs font-medium">Backup & Export</span>
          <HelpTooltip text="Download a full backup as a .zip archive (database + avatars, sprites, backgrounds, gallery, fonts, knowledge sources). Your browser will ask where to save it. Useful on mobile where the server's data folder isn't directly accessible." />
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creatingBackup}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {creatingBackup ? (
            <>
              <Loader2 size="0.8125rem" className="animate-spin" />
              Creating backup…
            </>
          ) : (
            <>
              <Download size="0.8125rem" />
              Download Backup
            </>
          )}
        </button>
        <button
          onClick={handleExportProfile}
          disabled={exportingProfile}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] transition-all hover:bg-[var(--secondary)]/80 active:scale-95 disabled:opacity-50"
        >
          {exportingProfile ? (
            <>
              <Loader2 size="0.8125rem" className="animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download size="0.8125rem" />
              Export Profile (JSON)
            </>
          )}
        </button>
        {backups && backups.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Existing backups</span>
            {backups.map((b) => (
              <div
                key={b.name}
                className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[0.6875rem] font-medium truncate">{b.name}</span>
                  <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                    {new Date(b.createdAt).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => deleteBackupMutation.mutate(b.name)}
                  className="ml-2 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                >
                  <Trash2 size="0.75rem" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Danger Zone ── */}
      <div className="retro-divider" />
      <div className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--destructive)]">
          <AlertTriangle size="0.875rem" />
          Danger Zone
        </div>
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          Permanently clear selected categories of local data. Professor Mari is always preserved, and Marinara resets
          live caches immediately after a successful expunge so stale data does not linger on screen.
        </p>
        <div className="grid gap-2">
          {EXPUNGE_SCOPE_OPTIONS.map((scope) => {
            const checked = selectedScopes.includes(scope.id);
            return (
              <label
                key={scope.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 ring-1 transition-colors",
                  checked
                    ? "bg-[var(--destructive)]/10 ring-[var(--destructive)]/25"
                    : "bg-[var(--background)]/40 ring-[var(--border)] hover:bg-[var(--secondary)]/70",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isClearing}
                  onChange={() => toggleScope(scope.id)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--destructive)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--foreground)]">{scope.label}</span>
                  <span className="block text-[0.625rem] text-[var(--muted-foreground)]">{scope.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedScopes(isAllScopesSelected ? [] : EXPUNGE_SCOPE_OPTIONS.map((scope) => scope.id))}
            disabled={isClearing}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--secondary)] active:scale-95 disabled:opacity-50"
          >
            {isAllScopesSelected ? "Clear Selection" : "Select All"}
          </button>
          <button
            onClick={() => setConfirmAction("selected")}
            disabled={selectedScopes.length === 0 || isClearing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)]/85 px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size="0.8125rem" />
            Clear Selected Data
          </button>
          <button
            onClick={() => setConfirmAction("all")}
            disabled={isClearing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            <Trash2 size="0.8125rem" />
            Clear All Data
          </button>
        </div>
        {confirmAction && (
          <div className="flex flex-col gap-2 rounded-lg bg-[var(--destructive)]/12 p-2.5">
            <div className="flex items-start gap-2 text-[0.6875rem] font-medium text-[var(--destructive)]">
              <AlertTriangle size="0.875rem" className="mt-0.5 shrink-0" />
              {confirmAction === "all"
                ? "Delete all supported data categories except Professor Mari? There is no undo."
                : `Delete ${selectedScopes.length} selected data categor${selectedScopes.length === 1 ? "y" : "ies"}? There is no undo.`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={isClearing}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--secondary)] active:scale-95 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => runExpunge(confirmAction)}
                disabled={isClearing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {isClearing ? <Loader2 size="0.75rem" className="animate-spin" /> : <Trash2 size="0.75rem" />}
                Confirm Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
