// ──────────────────────────────────────────────
// Zustand Store: UI Slice
// ──────────────────────────────────────────────
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type Panel =
  | "chat"
  | "characters"
  | "lorebooks"
  | "presets"
  | "connections"
  | "agents"
  | "personas"
  | "settings"
  | "bot-browser";
type FontSize = 12 | 14 | 16 | 17 | 19 | 22;
export type VisualTheme = "default" | "sillytavern";
export type HudPosition = "top" | "left" | "right";
export type TrackerPanelSide = "left" | "right";
export type TrackerDataPanelSection = "world" | "persona" | "characters" | "quests" | "custom";
export type TrackerPanelCollapsedSections = Partial<Record<TrackerDataPanelSection, boolean>>;
export type TrackerPanelSectionOrder = TrackerDataPanelSection[];
export type EchoChamberSide = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type UserStatus = "active" | "idle" | "dnd";
export type RoleplayAvatarStyle = "circles" | "rectangles" | "panel";
export type GameDialogueDisplayMode = "classic" | "stacked";
export interface FloatingWidgetPosition {
  x: number;
  y: number;
}
export const APP_LANGUAGE_OPTIONS = [{ id: "en", label: "English" }] as const;
export type AppLanguage = (typeof APP_LANGUAGE_OPTIONS)[number]["id"];

export interface GameSetupLearnedOptions {
  genres: string[];
  tones: string[];
  settings: string[];
  goals: string[];
  preferences: string[];
}

export interface GameSetupRememberedText {
  playerGoals: string;
  preferences: string;
}

export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 480;
export const RIGHT_PANEL_WIDTH_MIN = 280;
export const RIGHT_PANEL_WIDTH_MAX = 520;
export const TRACKER_PANEL_WIDTH_DEFAULT = 288;
export const TRACKER_PANEL_WIDTH_MIN = 220;
export const TRACKER_PANEL_WIDTH_MAX = 440;
const IMAGE_DIMENSION_MIN = 64;
const IMAGE_DIMENSION_MAX = 4096;
const GAME_SETUP_LEARNED_LIMIT = 60;
export const TRACKER_DATA_PANEL_SECTIONS: TrackerDataPanelSection[] = [
  "world",
  "persona",
  "characters",
  "quests",
  "custom",
];
const ROLEPLAY_AVATAR_SCALE_MIN = 0.75;
const ROLEPLAY_AVATAR_SCALE_MAX = 2.5;
const ROLEPLAY_SPRITE_SCALE_MIN = 0.5;
const ROLEPLAY_SPRITE_SCALE_MAX = 1.75;

const DEFAULT_GAME_SETUP_LEARNED_OPTIONS: GameSetupLearnedOptions = {
  genres: [],
  tones: [],
  settings: [],
  goals: [],
  preferences: [],
};

const DEFAULT_GAME_SETUP_REMEMBERED_TEXT: GameSetupRememberedText = {
  playerGoals: "",
  preferences: "",
};

function clampImageDimension(value: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(IMAGE_DIMENSION_MIN, Math.min(IMAGE_DIMENSION_MAX, rounded));
}

function clampTrackerPanelWidth(value: unknown) {
  const width = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : TRACKER_PANEL_WIDTH_DEFAULT;
  return Math.max(TRACKER_PANEL_WIDTH_MIN, Math.min(TRACKER_PANEL_WIDTH_MAX, width));
}

function normalizeTrackerPanelCollapsedSections(value: unknown): TrackerPanelCollapsedSections {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const collapsed: TrackerPanelCollapsedSections = {};
  for (const section of TRACKER_DATA_PANEL_SECTIONS) {
    if (raw[section] === true) collapsed[section] = true;
  }
  return collapsed;
}

function normalizeTrackerPanelSectionOrder(value: unknown): TrackerPanelSectionOrder {
  const order: TrackerPanelSectionOrder = [];
  const seen = new Set<TrackerDataPanelSection>();
  const raw = Array.isArray(value) ? value : [];

  for (const section of raw) {
    if (!TRACKER_DATA_PANEL_SECTIONS.includes(section as TrackerDataPanelSection)) continue;
    const validSection = section as TrackerDataPanelSection;
    if (seen.has(validSection)) continue;
    seen.add(validSection);
    order.push(validSection);
  }

  for (const section of TRACKER_DATA_PANEL_SECTIONS) {
    if (!seen.has(section)) order.push(section);
  }

  return order;
}

function normalizeLearnedGameSetupOption(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function normalizeRememberedGameSetupText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 2000);
}

function mergeLearnedGameSetupOptions(existing: string[] | undefined, incoming: unknown[]) {
  const byKey = new Map<string, string>();

  for (const value of existing ?? []) {
    const normalized = normalizeLearnedGameSetupOption(value);
    if (normalized) byKey.set(normalized.toLowerCase(), normalized);
  }

  for (const value of [...incoming].reverse()) {
    const normalized = normalizeLearnedGameSetupOption(value);
    if (!normalized) continue;
    byKey.delete(normalized.toLowerCase());
    byKey.set(normalized.toLowerCase(), normalized);
  }

  return [...byKey.values()].reverse().slice(0, GAME_SETUP_LEARNED_LIMIT);
}

/** Legacy browser-local custom theme preserved for one-time migration. */
export interface CustomTheme {
  id: string;
  name: string;
  /** Raw CSS that gets injected as a <style> tag */
  css: string;
  /** When this theme was installed */
  installedAt: string;
}

/**
 * Pre-migration shape of a browser-local extension. Only used to read
 * existing localStorage state and replay it against the server
 * (`/api/extensions`) on first load — see `useLegacyExtensionMigration`.
 * New extensions go directly through the server-synced hooks in
 * `use-extensions.ts` and use the canonical `InstalledExtension` type
 * exported from `@marinara-engine/shared`.
 */
export interface LegacyInstalledExtension {
  id: string;
  name: string;
  description: string;
  css?: string;
  js?: string;
  enabled: boolean;
  installedAt: string;
}

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanel: Panel;
  trackerPanelEnabled: boolean;
  trackerPanelOpen: boolean;
  trackerPanelSide: TrackerPanelSide;
  trackerPanelHideHudWidgets: boolean;
  trackerPanelUseExpressionSprites: boolean;
  trackerPanelWidth: number;
  trackerPanelCollapsedSections: TrackerPanelCollapsedSections;
  trackerPanelSectionOrder: TrackerPanelSectionOrder;
  settingsTab: string;
  modal: { type: string; props?: Record<string, unknown> } | null;
  theme: "dark" | "light";
  chatBackground: string | null;
  /** When set, the main area shows the full-page character editor instead of chat */
  characterDetailId: string | null;
  /** When set, the main area shows the full-page lorebook editor instead of chat */
  lorebookDetailId: string | null;
  /** When set, the main area shows the full-page preset editor instead of chat */
  presetDetailId: string | null;
  /** When set, the main area shows the full-page connection editor instead of chat */
  connectionDetailId: string | null;
  /** When set, the main area shows the full-page agent editor. Value is the agent *type* id (e.g. "world-state") */
  agentDetailId: string | null;
  /** When set, the main area shows the full-page tool editor */
  toolDetailId: string | null;
  /** When set, the main area shows the full-page persona editor */
  personaDetailId: string | null;
  /** When set, the main area shows the full-page regex script editor */
  regexDetailId: string | null;
  /** When true, the main area shows the browser */
  botBrowserOpen: boolean;
  /** When true, the main area shows the game assets browser */
  gameAssetsBrowserOpen: boolean;
  /** When true, the main area shows the full-page character library */
  characterLibraryOpen: boolean;
  /** True when any open detail editor has unsaved changes */
  editorDirty: boolean;

  // ── Settings (persisted) ──
  fontSize: FontSize;
  language: AppLanguage;
  /** Font size for chat messages (px) */
  chatFontSize: number;
  /** Custom font family name (empty = default Inter) */
  fontFamily: string;
  enableStreaming: boolean;
  debugMode: boolean;
  /** Typewriter speed: 1 (very slow) to 100 (instant). Controls how fast streaming tokens appear. */
  streamingSpeed: number;
  /** When true, Game mode narration segments are revealed in full as soon as they become active. */
  gameInstantTextReveal: boolean;
  /**
   * When true, the mouse wheel skips through past assistant turns in Game mode (up = back,
   * down = forward) and clicking the scene background acts like the Next button. While
   * scrolled into the past, the Next button changes to "Return" so the player can jump back
   * to where they were reading.
   */
  gameMiddleMouseNav: boolean;
  /** Game mode dialogue layout: classic VN box or a VN box with a scrollable segment history above it. */
  gameDialogueDisplayMode: GameDialogueDisplayMode;
  /** Game narration text speed: 1 (very slow) to 100 (instant). Controls the typewriter in game mode. */
  gameTextSpeed: number;
  /** Delay in ms between auto-advancing narration segments when auto-play is enabled. */
  gameAutoPlayDelay: number;
  /** When true, generated game image prompts are shown for review before provider calls are sent. */
  reviewImagePromptsBeforeSend: boolean;
  imageBackgroundWidth: number;
  imageBackgroundHeight: number;
  imagePortraitWidth: number;
  imagePortraitHeight: number;
  imageSelfieWidth: number;
  imageSelfieHeight: number;

  messageGrouping: boolean;
  showTimestamps: boolean;
  showModelName: boolean;
  showTokenUsage: boolean;
  showMessageNumbers: boolean;
  guideGenerations: boolean;
  showQuickRepliesMenu: boolean;
  showQuickReplyPostOnly: boolean;
  showQuickReplyGuide: boolean;
  showQuickReplyImpersonate: boolean;
  confirmBeforeDelete: boolean;
  /** Number of messages to load per page (0 = load all) */
  messagesPerPage: number;
  /** Bold quoted dialogue in chat messages; color highlighting can still remain when this is off */
  boldDialogue: boolean;
  /** When true, model responses are trimmed back to the last complete sentence before saving. */
  trimIncompleteModelOutput: boolean;
  /** When true, chat inputs show a microphone button for browser speech-to-text dictation. */
  speechToTextEnabled: boolean;
  /** When true, show the global Spotify mini player in the app chrome. */
  spotifyPlayerEnabled: boolean;
  /** Mobile Spotify widget collapsed state. */
  spotifyMobileWidgetCollapsed: boolean;
  /** Mobile Spotify widget position in viewport pixels. */
  spotifyMobileWidgetPosition: FloatingWidgetPosition;
  /** When true, Roleplay and Conversation modes support arrow-key and touch-swipe navigation between message swipes. */
  intuitiveSwipeNavigation: boolean;
  /** When true, moving past the newest swipe on the latest assistant message creates a new reroll. */
  intuitiveSwipeRerollLatest: boolean;
  /** When true, pressing Up Arrow with an empty chat input opens the last user message for editing (Conversation/Roleplay). */
  editLastMessageOnArrowUp: boolean;

  // ── Text Appearance ──
  /** Color for narrator text in RP mode (empty = default amber) */
  narrationFontColor: string;
  /** Opacity for narrator text (0–100) */
  narrationOpacity: number;
  /** Color for chat message text (empty = theme default) */
  chatFontColor: string;
  /** Opacity for roleplay message backgrounds (0–100) */
  chatFontOpacity: number;
  /** Layout style for roleplay message avatars */
  roleplayAvatarStyle: RoleplayAvatarStyle;
  /** Scale multiplier for Roleplay message avatars. */
  roleplayAvatarScale: number;
  /** Default scale multiplier for Roleplay full-body sprites. */
  roleplaySpriteScale: number;
  /** Scale multiplier for Game mode VN dialogue portraits. */
  gameAvatarScale: number;
  /** Scale multiplier for Game mode center full-body sprites. */
  gameFullBodySpriteScale: number;
  /** Text outline/stroke width in px (0 = off) */
  textStrokeWidth: number;
  /** Text outline/stroke color */
  textStrokeColor: string;

  // ── Visual Theme ──
  visualTheme: VisualTheme;

  // ── Conversation Gradient (per color-scheme) ──
  convoGradient: {
    dark: { from: string; to: string };
    light: { from: string; to: string };
  };

  // ── Sound ──
  convoNotificationSound: boolean;
  rpNotificationSound: boolean;

  // ── Custom Conversation Prompt ──
  /** User's custom default system prompt for new conversations (null = built-in default). */
  customConversationPrompt: string | null;

  // ── Schedule Generation Preferences ──
  /** Free-form user guidance injected into the conversation-mode schedule generation prompt (empty = unset). */
  scheduleGenerationPreferences: string;
  /** Custom Game setup chips learned from previous games. Synced so they follow the user. */
  learnedGameSetupOptions: GameSetupLearnedOptions;
  /** Last submitted free-text Game setup fields. Synced so new games can start from the previous setup. */
  rememberedGameSetupText: GameSetupRememberedText;

  // ── Input ──
  enterToSendRP: boolean;
  enterToSendConvo: boolean;
  enterToSendGame: boolean;

  // ── Roleplay Effects ──
  weatherEffects: boolean;

  // ── HUD Layout ──
  hudPosition: HudPosition;

  // ── Legacy Custom Themes & Extensions ──
  /** Legacy active custom theme id (null = built-in default). Migration only. */
  activeCustomTheme: string | null;
  /** Legacy browser-local custom themes. Migration only. */
  customThemes: CustomTheme[];
  /** True once legacy browser-local themes have been migrated to the server. */
  hasMigratedCustomThemesToServer: boolean;
  /** Legacy browser-local extensions. Migration only — see useLegacyExtensionMigration. */
  installedExtensions: LegacyInstalledExtension[];
  /** True once legacy browser-local extensions have been migrated to the server. */
  hasMigratedExtensionsToServer: boolean;

  // ── Onboarding ──
  hasCompletedOnboarding: boolean;
  /** True once the user has permanently disabled the in-game tutorial (? icon still re-opens). */
  gameTutorialDisabled: boolean;

  // ── Dismissals ──
  linkApiBannerDismissed: boolean;

  // ── EchoChamber ──
  echoChamberOpen: boolean;
  echoChamberSide: EchoChamberSide;

  // ── User Status ──
  /** The user's manually chosen status. Persisted. */
  userStatusManual: UserStatus;
  /** Effective status: matches manual, but auto-flips to "idle" on inactivity */
  userStatus: UserStatus;
  /** Optional short activity shown with the user's status in Conversation mode. */
  userActivity: string;

  // ── Impersonate Settings ──
  /** Custom prompt template for /impersonate (empty = use server default). Persisted. */
  impersonatePromptTemplate: string;
  /** Show a quick /impersonate button in the chat input toolbar. Persisted. */
  impersonateShowQuickButton: boolean;
  /** When true, CYOA choices generate impersonate requests instead of normal user messages. Persisted. */
  impersonateCyoaChoices: boolean;
  /** Override preset used when impersonating (null = use chat default). Persisted. */
  impersonatePresetId: string | null;
  /** Override connection used when impersonating (null = use chat default). Persisted. */
  impersonateConnectionId: string | null;
  /** When true, suppress agent pipeline during impersonate. Persisted. */
  impersonateBlockAgents: boolean;

  /** Transient: true when center content area is too narrow (overflow detected) */
  centerCompact: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  toggleTrackerPanel: () => void;
  setTrackerPanelEnabled: (enabled: boolean) => void;
  setTrackerPanelOpen: (open: boolean) => void;
  setTrackerPanelSide: (side: TrackerPanelSide) => void;
  setTrackerPanelHideHudWidgets: (hidden: boolean) => void;
  setTrackerPanelUseExpressionSprites: (enabled: boolean) => void;
  setTrackerPanelWidth: (width: number) => void;
  setTrackerPanelSectionOrder: (order: TrackerPanelSectionOrder) => void;
  setTrackerPanelSectionCollapsed: (section: TrackerDataPanelSection, collapsed: boolean) => void;
  toggleTrackerPanelSectionCollapsed: (section: TrackerDataPanelSection) => void;
  openRightPanel: (panel: Panel) => void;
  closeRightPanel: () => void;
  toggleRightPanel: (panel: Panel) => void;
  setSettingsTab: (tab: string) => void;
  openModal: (type: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setChatBackground: (url: string | null) => void;
  openCharacterDetail: (id: string) => void;
  closeCharacterDetail: () => void;
  openLorebookDetail: (id: string) => void;
  closeLorebookDetail: () => void;
  openPresetDetail: (id: string) => void;
  closePresetDetail: () => void;
  openConnectionDetail: (id: string) => void;
  closeConnectionDetail: () => void;
  openAgentDetail: (agentType: string) => void;
  closeAgentDetail: () => void;
  openToolDetail: (id: string) => void;
  closeToolDetail: () => void;
  openPersonaDetail: (id: string) => void;
  closePersonaDetail: () => void;
  openRegexDetail: (id: string) => void;
  closeRegexDetail: () => void;
  openCharacterLibrary: () => void;
  closeCharacterLibrary: () => void;
  openBotBrowser: () => void;
  closeBotBrowser: () => void;
  openGameAssetsBrowser: () => void;
  closeGameAssetsBrowser: () => void;

  /** Returns true if any full-page detail editor is currently open */
  hasAnyDetailOpen: () => boolean;
  /** Close all detail editors at once */
  closeAllDetails: () => void;
  /** Update the editor dirty flag (called by detail editors when their dirty state changes) */
  setEditorDirty: (dirty: boolean) => void;

  // Settings actions
  setFontSize: (size: FontSize) => void;
  setLanguage: (language: AppLanguage) => void;
  setChatFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setEnableStreaming: (v: boolean) => void;
  setDebugMode: (v: boolean) => void;
  setStreamingSpeed: (v: number) => void;
  setGameInstantTextReveal: (v: boolean) => void;
  setGameMiddleMouseNav: (v: boolean) => void;
  setGameDialogueDisplayMode: (v: GameDialogueDisplayMode) => void;
  setGameTextSpeed: (v: number) => void;
  setGameAutoPlayDelay: (v: number) => void;
  setReviewImagePromptsBeforeSend: (v: boolean) => void;
  setImageBackgroundDimensions: (width: number, height: number) => void;
  setImagePortraitDimensions: (width: number, height: number) => void;
  setImageSelfieDimensions: (width: number, height: number) => void;

  setMessageGrouping: (v: boolean) => void;
  setShowTimestamps: (v: boolean) => void;
  setShowModelName: (v: boolean) => void;
  setShowTokenUsage: (v: boolean) => void;
  setShowMessageNumbers: (v: boolean) => void;
  setGuideGenerations: (v: boolean) => void;
  setShowQuickRepliesMenu: (v: boolean) => void;
  setShowQuickReplyPostOnly: (v: boolean) => void;
  setShowQuickReplyGuide: (v: boolean) => void;
  setShowQuickReplyImpersonate: (v: boolean) => void;
  setConfirmBeforeDelete: (v: boolean) => void;
  setMessagesPerPage: (n: number) => void;
  setBoldDialogue: (v: boolean) => void;
  setTrimIncompleteModelOutput: (v: boolean) => void;
  setSpeechToTextEnabled: (v: boolean) => void;
  setSpotifyPlayerEnabled: (v: boolean) => void;
  setSpotifyMobileWidgetCollapsed: (v: boolean) => void;
  setSpotifyMobileWidgetPosition: (position: FloatingWidgetPosition) => void;
  setIntuitiveSwipeNavigation: (v: boolean) => void;
  setIntuitiveSwipeRerollLatest: (v: boolean) => void;
  setEditLastMessageOnArrowUp: (v: boolean) => void;
  setNarrationFontColor: (v: string) => void;
  setNarrationOpacity: (v: number) => void;
  setChatFontColor: (v: string) => void;
  setChatFontOpacity: (v: number) => void;
  setRoleplayAvatarStyle: (v: RoleplayAvatarStyle) => void;
  setRoleplayAvatarScale: (v: number) => void;
  setRoleplaySpriteScale: (v: number) => void;
  setGameAvatarScale: (v: number) => void;
  setGameFullBodySpriteScale: (v: number) => void;
  setTextStrokeWidth: (v: number) => void;
  setTextStrokeColor: (v: string) => void;
  setCenterCompact: (v: boolean) => void;
  setVisualTheme: (v: VisualTheme) => void;
  setConvoGradientField: (scheme: "dark" | "light", field: "from" | "to", value: string) => void;
  setConvoNotificationSound: (v: boolean) => void;
  setRpNotificationSound: (v: boolean) => void;
  setCustomConversationPrompt: (v: string | null) => void;
  setScheduleGenerationPreferences: (v: string) => void;
  rememberGameSetupOptions: (
    options: Partial<GameSetupLearnedOptions>,
    text?: Partial<GameSetupRememberedText>,
  ) => void;
  forgetGameSetupOption: (group: keyof GameSetupLearnedOptions, value: string) => void;
  setEnterToSendRP: (v: boolean) => void;
  setEnterToSendConvo: (v: boolean) => void;
  setEnterToSendGame: (v: boolean) => void;
  setWeatherEffects: (v: boolean) => void;
  setHudPosition: (v: HudPosition) => void;

  // Impersonate settings actions
  setImpersonatePromptTemplate: (v: string) => void;
  setImpersonateShowQuickButton: (v: boolean) => void;
  setImpersonateCyoaChoices: (v: boolean) => void;
  setImpersonatePresetId: (id: string | null) => void;
  setImpersonateConnectionId: (id: string | null) => void;
  setImpersonateBlockAgents: (v: boolean) => void;

  /** Legacy migration helpers for browser-local custom themes. */
  setHasMigratedCustomThemesToServer: (v: boolean) => void;
  clearLegacyCustomThemes: () => void;
  setActiveCustomTheme: (id: string | null) => void;
  addCustomTheme: (theme: CustomTheme) => void;
  updateCustomTheme: (id: string, patch: Partial<Pick<CustomTheme, "name" | "css">>) => void;
  removeCustomTheme: (id: string) => void;
  /** Legacy migration helpers for browser-local extensions. */
  setHasMigratedExtensionsToServer: (v: boolean) => void;
  clearLegacyExtensions: () => void;
  setHasCompletedOnboarding: (v: boolean) => void;
  setGameTutorialDisabled: (v: boolean) => void;
  dismissLinkApiBanner: () => void;
  toggleEchoChamber: () => void;
  setEchoChamberSide: (side: EchoChamberSide) => void;
  setUserStatus: (status: UserStatus) => void;
  setUserStatusManual: (status: UserStatus) => void;
  setUserActivity: (activity: string) => void;
}

/**
 * Returns the subset of UI state that is synced to the server so it persists
 * across devices and browsers. Excludes legacy migration flags, auto-computed
 * fields (userStatus), and items tracked via their own server resources
 * (custom themes, extensions).
 */
export function pickSyncedSettings(state: UIState) {
  return {
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    trackerPanelEnabled: state.trackerPanelEnabled,
    trackerPanelOpen: state.trackerPanelOpen,
    trackerPanelSide: state.trackerPanelSide,
    trackerPanelHideHudWidgets: state.trackerPanelHideHudWidgets,
    trackerPanelUseExpressionSprites: state.trackerPanelUseExpressionSprites,
    trackerPanelWidth: state.trackerPanelWidth,
    trackerPanelCollapsedSections: state.trackerPanelCollapsedSections,
    trackerPanelSectionOrder: state.trackerPanelSectionOrder,
    theme: state.theme,
    chatBackground: state.chatBackground,
    fontSize: state.fontSize,
    language: state.language,
    chatFontSize: state.chatFontSize,
    fontFamily: state.fontFamily,
    enableStreaming: state.enableStreaming,
    streamingSpeed: state.streamingSpeed,
    gameInstantTextReveal: state.gameInstantTextReveal,
    gameMiddleMouseNav: state.gameMiddleMouseNav,
    gameDialogueDisplayMode: state.gameDialogueDisplayMode,
    gameTextSpeed: state.gameTextSpeed,
    gameAutoPlayDelay: state.gameAutoPlayDelay,
    reviewImagePromptsBeforeSend: state.reviewImagePromptsBeforeSend,
    imageBackgroundWidth: state.imageBackgroundWidth,
    imageBackgroundHeight: state.imageBackgroundHeight,
    imagePortraitWidth: state.imagePortraitWidth,
    imagePortraitHeight: state.imagePortraitHeight,
    imageSelfieWidth: state.imageSelfieWidth,
    imageSelfieHeight: state.imageSelfieHeight,

    messageGrouping: state.messageGrouping,
    showTimestamps: state.showTimestamps,
    showModelName: state.showModelName,
    showTokenUsage: state.showTokenUsage,
    showMessageNumbers: state.showMessageNumbers,
    guideGenerations: state.guideGenerations,
    showQuickRepliesMenu: state.showQuickRepliesMenu,
    showQuickReplyPostOnly: state.showQuickReplyPostOnly,
    showQuickReplyGuide: state.showQuickReplyGuide,
    showQuickReplyImpersonate: state.showQuickReplyImpersonate,
    confirmBeforeDelete: state.confirmBeforeDelete,
    messagesPerPage: state.messagesPerPage,
    boldDialogue: state.boldDialogue,
    trimIncompleteModelOutput: state.trimIncompleteModelOutput,
    speechToTextEnabled: state.speechToTextEnabled,
    spotifyPlayerEnabled: state.spotifyPlayerEnabled,
    spotifyMobileWidgetCollapsed: state.spotifyMobileWidgetCollapsed,
    spotifyMobileWidgetPosition: state.spotifyMobileWidgetPosition,
    intuitiveSwipeNavigation: state.intuitiveSwipeNavigation,
    intuitiveSwipeRerollLatest: state.intuitiveSwipeRerollLatest,
    editLastMessageOnArrowUp: state.editLastMessageOnArrowUp,
    narrationFontColor: state.narrationFontColor,
    narrationOpacity: state.narrationOpacity,
    chatFontColor: state.chatFontColor,
    chatFontOpacity: state.chatFontOpacity,
    roleplayAvatarStyle: state.roleplayAvatarStyle,
    roleplayAvatarScale: state.roleplayAvatarScale,
    roleplaySpriteScale: state.roleplaySpriteScale,
    gameAvatarScale: state.gameAvatarScale,
    gameFullBodySpriteScale: state.gameFullBodySpriteScale,
    textStrokeWidth: state.textStrokeWidth,
    textStrokeColor: state.textStrokeColor,
    visualTheme: state.visualTheme,
    convoGradient: state.convoGradient,
    enterToSendRP: state.enterToSendRP,
    enterToSendConvo: state.enterToSendConvo,
    weatherEffects: state.weatherEffects,
    hudPosition: state.hudPosition,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
    gameTutorialDisabled: state.gameTutorialDisabled,
    linkApiBannerDismissed: state.linkApiBannerDismissed,
    echoChamberSide: state.echoChamberSide,
    userStatusManual: state.userStatusManual,
    userActivity: state.userActivity,
    convoNotificationSound: state.convoNotificationSound,
    rpNotificationSound: state.rpNotificationSound,
    customConversationPrompt: state.customConversationPrompt,
    scheduleGenerationPreferences: state.scheduleGenerationPreferences,
    impersonatePromptTemplate: state.impersonatePromptTemplate,
    impersonateShowQuickButton: state.impersonateShowQuickButton,
    impersonateCyoaChoices: state.impersonateCyoaChoices,
    impersonatePresetId: state.impersonatePresetId,
    impersonateConnectionId: state.impersonateConnectionId,
    impersonateBlockAgents: state.impersonateBlockAgents,
    learnedGameSetupOptions: state.learnedGameSetupOptions,
    rememberedGameSetupText: state.rememberedGameSetupText,
  };
}

export type SyncedSettings = ReturnType<typeof pickSyncedSettings>;

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      sidebarWidth: 280,
      rightPanelOpen: false,
      rightPanelWidth: 320,
      rightPanel: "chat" as Panel,
      trackerPanelEnabled: true,
      trackerPanelOpen: false,
      trackerPanelSide: "right" as TrackerPanelSide,
      trackerPanelHideHudWidgets: false,
      trackerPanelUseExpressionSprites: false,
      trackerPanelWidth: TRACKER_PANEL_WIDTH_DEFAULT,
      trackerPanelCollapsedSections: {},
      trackerPanelSectionOrder: [...TRACKER_DATA_PANEL_SECTIONS],
      settingsTab: "general",
      modal: null,
      theme: "dark" as const,
      chatBackground: null,
      characterDetailId: null,
      lorebookDetailId: null,
      presetDetailId: null,
      connectionDetailId: null,
      agentDetailId: null,
      toolDetailId: null,
      personaDetailId: null,
      regexDetailId: null,
      botBrowserOpen: false,
      gameAssetsBrowserOpen: false,
      characterLibraryOpen: false,
      editorDirty: false,

      // Settings defaults
      fontSize: 17 as FontSize,
      language: "en" as AppLanguage,
      chatFontSize: 16,
      fontFamily: "",
      enableStreaming: true,
      debugMode: false,
      streamingSpeed: 50,
      gameInstantTextReveal: false,
      gameMiddleMouseNav: false,
      gameDialogueDisplayMode: "classic" as GameDialogueDisplayMode,
      gameTextSpeed: 50,
      gameAutoPlayDelay: 3000,
      reviewImagePromptsBeforeSend: false,
      imageBackgroundWidth: 1024,
      imageBackgroundHeight: 576,
      imagePortraitWidth: 512,
      imagePortraitHeight: 512,
      imageSelfieWidth: 512,
      imageSelfieHeight: 768,

      messageGrouping: true,
      showTimestamps: false,
      showModelName: false,
      showTokenUsage: false,
      showMessageNumbers: false,
      guideGenerations: false,
      showQuickRepliesMenu: false,
      showQuickReplyPostOnly: true,
      showQuickReplyGuide: true,
      showQuickReplyImpersonate: true,
      confirmBeforeDelete: true,
      messagesPerPage: 20,
      boldDialogue: true,
      trimIncompleteModelOutput: false,
      speechToTextEnabled: false,
      spotifyPlayerEnabled: false,
      spotifyMobileWidgetCollapsed: true,
      spotifyMobileWidgetPosition: { x: 16, y: 96 },
      intuitiveSwipeNavigation: false,
      intuitiveSwipeRerollLatest: false,
      editLastMessageOnArrowUp: true,
      narrationFontColor: "",
      narrationOpacity: 80,
      chatFontColor: "",
      chatFontOpacity: 90,
      roleplayAvatarStyle: "circles" as RoleplayAvatarStyle,
      roleplayAvatarScale: 1,
      roleplaySpriteScale: 1,
      gameAvatarScale: 1,
      gameFullBodySpriteScale: 1.35,
      textStrokeWidth: 0.5,
      textStrokeColor: "#000000",
      visualTheme: "default" as VisualTheme,
      convoGradient: {
        dark: { from: "#0a0a0e", to: "#1c2133" },
        light: { from: "#f2eff7", to: "#eae6f0" },
      },
      convoNotificationSound: true,
      rpNotificationSound: true,
      customConversationPrompt: null,
      scheduleGenerationPreferences: "",
      learnedGameSetupOptions: DEFAULT_GAME_SETUP_LEARNED_OPTIONS,
      rememberedGameSetupText: DEFAULT_GAME_SETUP_REMEMBERED_TEXT,
      enterToSendRP: false,
      enterToSendConvo: true,
      enterToSendGame: true,
      weatherEffects: true,
      hudPosition: "top" as HudPosition,
      activeCustomTheme: null,
      customThemes: [],
      hasMigratedCustomThemesToServer: false,
      installedExtensions: [],
      hasMigratedExtensionsToServer: false,
      hasCompletedOnboarding: false,
      gameTutorialDisabled: false,
      linkApiBannerDismissed: false,
      echoChamberOpen: false,
      echoChamberSide: "bottom-right" as EchoChamberSide,
      userStatusManual: "active" as const,
      userStatus: "active" as UserStatus,
      userActivity: "",
      centerCompact: false,

      // Impersonate settings defaults
      impersonatePromptTemplate: "",
      impersonateShowQuickButton: false,
      impersonateCyoaChoices: false,
      impersonatePresetId: null,
      impersonateConnectionId: null,
      impersonateBlockAgents: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width)) }),
      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_MIN, Math.min(RIGHT_PANEL_WIDTH_MAX, width)) }),
      toggleTrackerPanel: () =>
        set((s) => ({
          trackerPanelOpen: s.trackerPanelEnabled ? !s.trackerPanelOpen : false,
        })),
      setTrackerPanelEnabled: (enabled) =>
        set({
          trackerPanelEnabled: enabled,
          trackerPanelOpen: enabled ? get().trackerPanelOpen : false,
        }),
      setTrackerPanelOpen: (open) =>
        set((s) => ({
          trackerPanelOpen: s.trackerPanelEnabled ? open : false,
        })),
      setTrackerPanelSide: (side) => set({ trackerPanelSide: side }),
      setTrackerPanelHideHudWidgets: (hidden) => set({ trackerPanelHideHudWidgets: hidden }),
      setTrackerPanelUseExpressionSprites: (enabled) => set({ trackerPanelUseExpressionSprites: enabled }),
      setTrackerPanelWidth: (width) => set({ trackerPanelWidth: clampTrackerPanelWidth(width) }),
      setTrackerPanelSectionOrder: (order) =>
        set({ trackerPanelSectionOrder: normalizeTrackerPanelSectionOrder(order) }),
      setTrackerPanelSectionCollapsed: (section, collapsed) =>
        set((s) => {
          const next = { ...s.trackerPanelCollapsedSections };
          if (collapsed) {
            next[section] = true;
          } else {
            delete next[section];
          }
          return { trackerPanelCollapsedSections: next };
        }),
      toggleTrackerPanelSectionCollapsed: (section) =>
        set((s) => {
          const next = { ...s.trackerPanelCollapsedSections };
          if (next[section]) {
            delete next[section];
          } else {
            next[section] = true;
          }
          return { trackerPanelCollapsedSections: next };
        }),

      openRightPanel: (panel) => set({ rightPanelOpen: true, rightPanel: panel }),
      closeRightPanel: () => set({ rightPanelOpen: false }),
      toggleRightPanel: (panel) =>
        set((s) =>
          s.rightPanelOpen && s.rightPanel === panel
            ? { rightPanelOpen: false }
            : { rightPanelOpen: true, rightPanel: panel },
        ),

      setSettingsTab: (tab) => set({ settingsTab: tab }),
      openModal: (type, props) => set({ modal: { type, props } }),
      closeModal: () => set({ modal: null }),
      setTheme: (theme) => set({ theme }),
      setChatBackground: (url) => set({ chatBackground: url }),
      openCharacterDetail: (id) =>
        set({
          characterDetailId: id,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeCharacterDetail: () => set({ characterDetailId: null, editorDirty: false }),
      openLorebookDetail: (id) =>
        set({
          lorebookDetailId: id,
          characterLibraryOpen: false,
          characterDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeLorebookDetail: () => set({ lorebookDetailId: null, editorDirty: false }),
      openPresetDetail: (id) =>
        set({
          presetDetailId: id,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closePresetDetail: () => set({ presetDetailId: null, editorDirty: false }),
      openConnectionDetail: (id) =>
        set({
          connectionDetailId: id,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          agentDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeConnectionDetail: () => set({ connectionDetailId: null, editorDirty: false }),
      openAgentDetail: (agentType) =>
        set({
          agentDetailId: agentType,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          toolDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeAgentDetail: () => set({ agentDetailId: null, editorDirty: false }),
      openToolDetail: (id) =>
        set({
          toolDetailId: id,
          agentDetailId: null,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeToolDetail: () => set({ toolDetailId: null, editorDirty: false }),
      openPersonaDetail: (id) =>
        set({
          personaDetailId: id,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          regexDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closePersonaDetail: () => set({ personaDetailId: null, editorDirty: false }),
      openRegexDetail: (id) =>
        set({
          regexDetailId: id,
          personaDetailId: null,
          characterLibraryOpen: false,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeRegexDetail: () => set({ regexDetailId: null, editorDirty: false }),
      openCharacterLibrary: () =>
        set({
          characterLibraryOpen: true,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          botBrowserOpen: false,
          editorDirty: false,
          rightPanelOpen: false,
        }),
      closeCharacterLibrary: () => set({ characterLibraryOpen: false }),
      openBotBrowser: () =>
        set({
          botBrowserOpen: true,
          gameAssetsBrowserOpen: false,
          characterLibraryOpen: false,
          regexDetailId: null,
          personaDetailId: null,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeBotBrowser: () => set({ botBrowserOpen: false }),
      openGameAssetsBrowser: () =>
        set({
          gameAssetsBrowserOpen: true,
          botBrowserOpen: false,
          characterLibraryOpen: false,
          regexDetailId: null,
          personaDetailId: null,
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeGameAssetsBrowser: () => set({ gameAssetsBrowserOpen: false }),

      hasAnyDetailOpen: () => {
        const s = get();
        return !!(
          s.characterDetailId ||
          s.lorebookDetailId ||
          s.presetDetailId ||
          s.connectionDetailId ||
          s.agentDetailId ||
          s.toolDetailId ||
          s.personaDetailId ||
          s.regexDetailId ||
          s.characterLibraryOpen ||
          s.botBrowserOpen ||
          s.gameAssetsBrowserOpen
        );
      },
      closeAllDetails: () =>
        set({
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          personaDetailId: null,
          regexDetailId: null,
          characterLibraryOpen: false,
          botBrowserOpen: false,
          gameAssetsBrowserOpen: false,
          editorDirty: false,
        }),
      setEditorDirty: (dirty) => set({ editorDirty: dirty }),

      // Settings actions
      setFontSize: (size) => set({ fontSize: size }),
      setLanguage: (language) => set({ language }),
      setChatFontSize: (size) => set({ chatFontSize: size }),
      setFontFamily: (family) => set({ fontFamily: family }),
      setEnableStreaming: (v) => set({ enableStreaming: v }),
      setDebugMode: (v) => set({ debugMode: v }),
      setStreamingSpeed: (v) => set({ streamingSpeed: Math.max(1, Math.min(100, v)) }),
      setGameInstantTextReveal: (v) => set({ gameInstantTextReveal: v }),
      setGameMiddleMouseNav: (v) => set({ gameMiddleMouseNav: v }),
      setGameDialogueDisplayMode: (v) => set({ gameDialogueDisplayMode: v }),
      setGameTextSpeed: (v) => set({ gameTextSpeed: Math.max(1, Math.min(100, v)) }),
      setGameAutoPlayDelay: (v) => set({ gameAutoPlayDelay: Math.max(200, Math.min(10000, Math.round(v))) }),
      setReviewImagePromptsBeforeSend: (v) => set({ reviewImagePromptsBeforeSend: v }),
      setImageBackgroundDimensions: (width, height) =>
        set({
          imageBackgroundWidth: clampImageDimension(width),
          imageBackgroundHeight: clampImageDimension(height),
        }),
      setImagePortraitDimensions: (width, height) =>
        set({
          imagePortraitWidth: clampImageDimension(width),
          imagePortraitHeight: clampImageDimension(height),
        }),
      setImageSelfieDimensions: (width, height) =>
        set({
          imageSelfieWidth: clampImageDimension(width),
          imageSelfieHeight: clampImageDimension(height),
        }),

      setMessageGrouping: (v) => set({ messageGrouping: v }),
      setShowTimestamps: (v) => set({ showTimestamps: v }),
      setShowModelName: (v) => set({ showModelName: v }),
      setShowTokenUsage: (v) => set({ showTokenUsage: v }),
      setShowMessageNumbers: (v) => set({ showMessageNumbers: v }),
      setGuideGenerations: (v) => set({ guideGenerations: v }),
      setShowQuickRepliesMenu: (v) => set({ showQuickRepliesMenu: v }),
      setShowQuickReplyPostOnly: (v) => set({ showQuickReplyPostOnly: v }),
      setShowQuickReplyGuide: (v) => set({ showQuickReplyGuide: v }),
      setShowQuickReplyImpersonate: (v) => set({ showQuickReplyImpersonate: v }),
      setConfirmBeforeDelete: (v) => set({ confirmBeforeDelete: v }),
      setMessagesPerPage: (n) => set({ messagesPerPage: n }),
      setBoldDialogue: (v) => set({ boldDialogue: v }),
      setTrimIncompleteModelOutput: (v) => set({ trimIncompleteModelOutput: v }),
      setSpeechToTextEnabled: (v) => set({ speechToTextEnabled: v }),
      setSpotifyPlayerEnabled: (v) => set({ spotifyPlayerEnabled: v }),
      setSpotifyMobileWidgetCollapsed: (v) => set({ spotifyMobileWidgetCollapsed: v }),
      setSpotifyMobileWidgetPosition: (position) =>
        set({
          spotifyMobileWidgetPosition: {
            x: Number.isFinite(position.x) ? Math.max(8, Math.round(position.x)) : 16,
            y: Number.isFinite(position.y) ? Math.max(8, Math.round(position.y)) : 96,
          },
        }),
      setIntuitiveSwipeNavigation: (v) => set({ intuitiveSwipeNavigation: v }),
      setIntuitiveSwipeRerollLatest: (v) => set({ intuitiveSwipeRerollLatest: v }),
      setEditLastMessageOnArrowUp: (v) => set({ editLastMessageOnArrowUp: v }),
      setNarrationFontColor: (v) => set({ narrationFontColor: v }),
      setNarrationOpacity: (v) => set({ narrationOpacity: Math.max(0, Math.min(100, v)) }),
      setChatFontColor: (v) => set({ chatFontColor: v }),
      setChatFontOpacity: (v) => set({ chatFontOpacity: Math.max(0, Math.min(100, v)) }),
      setRoleplayAvatarStyle: (v) => set({ roleplayAvatarStyle: v }),
      setRoleplayAvatarScale: (v) =>
        set({ roleplayAvatarScale: Math.max(ROLEPLAY_AVATAR_SCALE_MIN, Math.min(ROLEPLAY_AVATAR_SCALE_MAX, v)) }),
      setRoleplaySpriteScale: (v) =>
        set({ roleplaySpriteScale: Math.max(ROLEPLAY_SPRITE_SCALE_MIN, Math.min(ROLEPLAY_SPRITE_SCALE_MAX, v)) }),
      setGameAvatarScale: (v) => set({ gameAvatarScale: Math.max(0.75, Math.min(1.75, v)) }),
      setGameFullBodySpriteScale: (v) => set({ gameFullBodySpriteScale: Math.max(0.75, Math.min(2.75, v)) }),
      setTextStrokeWidth: (v) => set({ textStrokeWidth: Math.max(0, Math.min(5, v)) }),
      setTextStrokeColor: (v) => set({ textStrokeColor: v }),
      setCenterCompact: (v) => set({ centerCompact: v }),
      setVisualTheme: (v) => set({ visualTheme: v }),
      setConvoGradientField: (scheme, field, value) =>
        set((s) => ({
          convoGradient: {
            ...s.convoGradient,
            [scheme]: { ...s.convoGradient[scheme], [field]: value },
          },
        })),
      setConvoNotificationSound: (v) => set({ convoNotificationSound: v }),
      setRpNotificationSound: (v) => set({ rpNotificationSound: v }),
      setCustomConversationPrompt: (v) => set({ customConversationPrompt: v }),
      setScheduleGenerationPreferences: (v) => set({ scheduleGenerationPreferences: v }),
      rememberGameSetupOptions: (options, text) =>
        set((state) => {
          const learned = state.learnedGameSetupOptions ?? DEFAULT_GAME_SETUP_LEARNED_OPTIONS;
          const remembered = state.rememberedGameSetupText ?? DEFAULT_GAME_SETUP_REMEMBERED_TEXT;
          return {
            learnedGameSetupOptions: {
              genres: mergeLearnedGameSetupOptions(learned.genres, options.genres ?? []),
              tones: mergeLearnedGameSetupOptions(learned.tones, options.tones ?? []),
              settings: mergeLearnedGameSetupOptions(learned.settings, options.settings ?? []),
              goals: mergeLearnedGameSetupOptions(learned.goals, options.goals ?? []),
              preferences: mergeLearnedGameSetupOptions(learned.preferences, options.preferences ?? []),
            },
            rememberedGameSetupText: {
              playerGoals:
                text?.playerGoals !== undefined
                  ? normalizeRememberedGameSetupText(text.playerGoals)
                  : remembered.playerGoals,
              preferences:
                text?.preferences !== undefined
                  ? normalizeRememberedGameSetupText(text.preferences)
                  : remembered.preferences,
            },
          };
        }),
      forgetGameSetupOption: (group, value) =>
        set((state) => {
          const learned = state.learnedGameSetupOptions ?? DEFAULT_GAME_SETUP_LEARNED_OPTIONS;
          const targetKey = normalizeLearnedGameSetupOption(value).toLowerCase();
          if (!targetKey) return state;
          const next = learned[group].filter(
            (entry) => normalizeLearnedGameSetupOption(entry).toLowerCase() !== targetKey,
          );
          if (next.length === learned[group].length) return state;
          return {
            learnedGameSetupOptions: { ...learned, [group]: next },
          };
        }),
      setEnterToSendRP: (v) => set({ enterToSendRP: v }),
      setEnterToSendConvo: (v) => set({ enterToSendConvo: v }),
      setEnterToSendGame: (v) => set({ enterToSendGame: v }),
      setWeatherEffects: (v) => set({ weatherEffects: v }),
      setHudPosition: (v) => set({ hudPosition: v }),
      setImpersonatePromptTemplate: (v) => set({ impersonatePromptTemplate: v }),
      setImpersonateShowQuickButton: (v) => set({ impersonateShowQuickButton: v }),
      setImpersonateCyoaChoices: (v) => set({ impersonateCyoaChoices: v }),
      setImpersonatePresetId: (id) => set({ impersonatePresetId: id }),
      setImpersonateConnectionId: (id) => set({ impersonateConnectionId: id }),
      setImpersonateBlockAgents: (v) => set({ impersonateBlockAgents: v }),
      setHasMigratedCustomThemesToServer: (v) => set({ hasMigratedCustomThemesToServer: v }),
      clearLegacyCustomThemes: () => set({ customThemes: [], activeCustomTheme: null }),
      setActiveCustomTheme: (id) => set({ activeCustomTheme: id }),
      addCustomTheme: (theme) => set((s) => ({ customThemes: [...s.customThemes, theme] })),
      updateCustomTheme: (id, patch) =>
        set((s) => ({
          customThemes: s.customThemes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      removeCustomTheme: (id) =>
        set((s) => ({
          customThemes: s.customThemes.filter((t) => t.id !== id),
          activeCustomTheme: s.activeCustomTheme === id ? null : s.activeCustomTheme,
        })),
      setHasMigratedExtensionsToServer: (v) => set({ hasMigratedExtensionsToServer: v }),
      clearLegacyExtensions: () => set({ installedExtensions: [] }),
      setHasCompletedOnboarding: (v) => set({ hasCompletedOnboarding: v }),
      setGameTutorialDisabled: (v) => set({ gameTutorialDisabled: v }),
      dismissLinkApiBanner: () => set({ linkApiBannerDismissed: true }),
      toggleEchoChamber: () => set((s) => ({ echoChamberOpen: !s.echoChamberOpen })),
      setEchoChamberSide: (side) => set({ echoChamberSide: side }),
      setUserStatus: (status) => set({ userStatus: status }),
      setUserStatusManual: (status) => set({ userStatusManual: status, userStatus: status }),
      setUserActivity: (activity) => set({ userActivity: activity.slice(0, 120) }),
    }),
    {
      name: "marinara-engine-ui",
      version: 29,
      // Debounce localStorage writes to avoid sync I/O on every state change
      storage: createJSONStorage(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pendingName: string | null = null;
        let pendingValue: string | null = null;

        const flush = () => {
          if (pendingName !== null && pendingValue !== null) {
            localStorage.setItem(pendingName, pendingValue);
            pendingName = null;
            pendingValue = null;
          }
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        };

        // Flush pending writes before the tab closes
        if (typeof window !== "undefined") {
          window.addEventListener("beforeunload", flush);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flush();
          });
        }

        return {
          getItem: (name: string) => localStorage.getItem(name),
          setItem: (name: string, value: string) => {
            pendingName = name;
            pendingValue = value;
            if (timer) clearTimeout(timer);
            timer = setTimeout(flush, 1000);
          },
          removeItem: (name: string) => localStorage.removeItem(name),
        };
      }),
      migrate: (persisted: any, version: number) => {
        if (version === 0 && persisted.fontSize === 14) {
          persisted.fontSize = 17;
        }
        // v1 → v2: replace streamingFps (30|60) with streamingSpeed (1–100)
        if (version <= 1) {
          delete persisted.streamingFps;
          if (persisted.streamingSpeed === undefined) {
            persisted.streamingSpeed = 50;
          }
        }
        // v2 → v3: split enterToSend into per-mode toggles
        if (version <= 2) {
          const old = persisted.enterToSend;
          delete persisted.enterToSend;
          // Keep conversation default true; respect old value for RP
          if (persisted.enterToSendRP === undefined) {
            persisted.enterToSendRP = old === true ? true : false;
          }
          if (persisted.enterToSendConvo === undefined) {
            persisted.enterToSendConvo = true;
          }
        }
        // v3 → v4: add conversation notification sound default
        if (version <= 3) {
          if (persisted.convoNotificationSound === undefined) {
            persisted.convoNotificationSound = true;
          }
        }
        // v4 → v5: add RP notification sound default
        if (version <= 4) {
          if (persisted.rpNotificationSound === undefined) {
            persisted.rpNotificationSound = true;
          }
        }
        // v5 → v6: add text appearance settings
        if (version <= 5) {
          if (persisted.narrationFontColor === undefined) persisted.narrationFontColor = "";
          if (persisted.narrationOpacity === undefined) persisted.narrationOpacity = 80;
          if (persisted.chatFontColor === undefined) persisted.chatFontColor = "";
          if (persisted.chatFontOpacity === undefined) persisted.chatFontOpacity = 90;
          if (persisted.textStrokeWidth === undefined) persisted.textStrokeWidth = 0.5;
          if (persisted.textStrokeColor === undefined) persisted.textStrokeColor = "#000000";
        }
        // v6 → v7: add legacy theme migration completion flag
        if (version <= 6) {
          if (persisted.hasMigratedCustomThemesToServer === undefined) {
            persisted.hasMigratedCustomThemesToServer = false;
          }
        }
        // v7 → v8: persist right panel width
        if (version <= 7) {
          if (persisted.rightPanelWidth === undefined) {
            persisted.rightPanelWidth = 320;
          }
        }
        // v8 → v9: add roleplay avatar layout setting
        if (version <= 8) {
          if (persisted.roleplayAvatarStyle === undefined) {
            persisted.roleplayAvatarStyle = "circles";
          }
        }
        // v9 → v10: add Game mode avatar/sprite scale.
        if (version <= 9) {
          if (persisted.gameAvatarScale === undefined) {
            persisted.gameAvatarScale = 1;
          }
        }
        // v10 → v11: convert flat convoGradientFrom/To into per-scheme nested object.
        if (version <= 10) {
          if ("convoGradientFrom" in persisted || "convoGradientTo" in persisted) {
            const oldFrom = persisted.convoGradientFrom ?? "#0a0a0e";
            const oldTo = persisted.convoGradientTo ?? "#1c2133";
            persisted.convoGradient = {
              dark: { from: oldFrom, to: oldTo },
              light: { from: "#f2eff7", to: "#eae6f0" },
            };
            delete persisted.convoGradientFrom;
            delete persisted.convoGradientTo;
          }
        }
        // v11 -> v12: add Game mode dialogue display layout.
        if (version <= 11) {
          if (persisted.gameDialogueDisplayMode === undefined) {
            persisted.gameDialogueDisplayMode = "classic";
          }
        }
        // v12 -> v13: image generation prompt review and default canvas sizes.
        if (version <= 12) {
          if (persisted.reviewImagePromptsBeforeSend === undefined) {
            persisted.reviewImagePromptsBeforeSend = false;
          }
          if (persisted.imageBackgroundWidth === undefined) persisted.imageBackgroundWidth = 1024;
          if (persisted.imageBackgroundHeight === undefined) persisted.imageBackgroundHeight = 576;
          if (persisted.imagePortraitWidth === undefined) persisted.imagePortraitWidth = 512;
          if (persisted.imagePortraitHeight === undefined) persisted.imagePortraitHeight = 512;
          if (persisted.imageSelfieWidth === undefined) persisted.imageSelfieWidth = 512;
          if (persisted.imageSelfieHeight === undefined) persisted.imageSelfieHeight = 768;
        }
        // v13 -> v14: add optional custom user activity text for Conversation status.
        if (version <= 13) {
          if (persisted.userActivity === undefined) {
            persisted.userActivity = "";
          }
        }
        // v14 -> v15: remember reusable custom Game setup options.
        if (version <= 14) {
          if (persisted.learnedGameSetupOptions === undefined) {
            persisted.learnedGameSetupOptions = DEFAULT_GAME_SETUP_LEARNED_OPTIONS;
          }
        }
        // v15 -> v16: add impersonate settings and opt-in output cleanup for incomplete final sentences.
        if (version <= 15) {
          if (persisted.impersonatePromptTemplate === undefined) persisted.impersonatePromptTemplate = "";
          if (persisted.impersonateShowQuickButton === undefined) persisted.impersonateShowQuickButton = false;
          if (persisted.impersonatePresetId === undefined) persisted.impersonatePresetId = null;
          if (persisted.impersonateConnectionId === undefined) persisted.impersonateConnectionId = null;
          if (persisted.impersonateBlockAgents === undefined) persisted.impersonateBlockAgents = false;
          if (persisted.trimIncompleteModelOutput === undefined) {
            persisted.trimIncompleteModelOutput = false;
          }
        }
        // v16 -> v17: opt-in intuitive swipe/reroll shortcuts.
        if (version <= 16) {
          if (persisted.intuitiveSwipeNavigation === undefined) {
            persisted.intuitiveSwipeNavigation = false;
          }
          if (persisted.intuitiveSwipeRerollLatest === undefined) {
            persisted.intuitiveSwipeRerollLatest = false;
          }
        }
        // v17 -> v18: add legacy extension migration completion flag.
        if (version <= 17) {
          if (persisted.hasMigratedExtensionsToServer === undefined) {
            persisted.hasMigratedExtensionsToServer = false;
          }
        }
        // v18 -> v19: add impersonate CYOA opt-in and split full-body sprite scale from portrait scale.
        if (version <= 18) {
          if (persisted.impersonateCyoaChoices === undefined) persisted.impersonateCyoaChoices = false;
          if (persisted.gameFullBodySpriteScale === undefined) {
            persisted.gameFullBodySpriteScale = 1.35;
          }
        }
        // v19 -> v20: add global Spotify mini player controls.
        if (version <= 19) {
          if (persisted.spotifyPlayerEnabled === undefined) persisted.spotifyPlayerEnabled = false;
          if (persisted.spotifyMobileWidgetCollapsed === undefined) persisted.spotifyMobileWidgetCollapsed = true;
          if (persisted.spotifyMobileWidgetPosition === undefined) {
            persisted.spotifyMobileWidgetPosition = { x: 16, y: 96 };
          }
        }
        // v20 -> v21: remember Game setup free-text fields and learned preference chips.
        if (version <= 20) {
          const learned =
            persisted.learnedGameSetupOptions && typeof persisted.learnedGameSetupOptions === "object"
              ? persisted.learnedGameSetupOptions
              : {};
          persisted.learnedGameSetupOptions = {
            ...DEFAULT_GAME_SETUP_LEARNED_OPTIONS,
            ...learned,
            preferences: Array.isArray(learned.preferences) ? learned.preferences : [],
          };
          if (persisted.rememberedGameSetupText === undefined) {
            persisted.rememberedGameSetupText = DEFAULT_GAME_SETUP_REMEMBERED_TEXT;
          } else {
            persisted.rememberedGameSetupText = {
              playerGoals: normalizeRememberedGameSetupText(persisted.rememberedGameSetupText.playerGoals),
              preferences: normalizeRememberedGameSetupText(persisted.rememberedGameSetupText.preferences),
            };
          }
        }
        // v21 -> v22: add the optional centralized tracker sidebar.
        if (version <= 21) {
          if (persisted.trackerPanelOpen === undefined) persisted.trackerPanelOpen = false;
          if (persisted.trackerPanelSide === undefined) persisted.trackerPanelSide = "right";
          if (persisted.trackerPanelEnabled === undefined) persisted.trackerPanelEnabled = true;
          if (persisted.trackerPanelHideHudWidgets === undefined) persisted.trackerPanelHideHudWidgets = false;
        }
        // v22 -> v23: persist the desktop tracker sidebar width.
        if (version <= 22) {
          persisted.trackerPanelWidth = clampTrackerPanelWidth(persisted.trackerPanelWidth);
        }
        // v23 -> v24: remember collapsed tracker data panels.
        if (version <= 23) {
          persisted.trackerPanelCollapsedSections = normalizeTrackerPanelCollapsedSections(
            persisted.trackerPanelCollapsedSections,
          );
        }
        persisted.trackerPanelCollapsedSections = normalizeTrackerPanelCollapsedSections(
          persisted.trackerPanelCollapsedSections,
        );
        // v24 -> v25: require an explicit tracker-panel opt-in before expression sprites replace portraits.
        if (version <= 24 && persisted.trackerPanelUseExpressionSprites === undefined) {
          persisted.trackerPanelUseExpressionSprites = false;
        }
        if (persisted.trackerPanelUseExpressionSprites === undefined) {
          persisted.trackerPanelUseExpressionSprites = false;
        }
        // v25 -> v26: allow users to reorder tracker panel cards.
        if (version <= 25) {
          persisted.trackerPanelSectionOrder = normalizeTrackerPanelSectionOrder(persisted.trackerPanelSectionOrder);
        }
        persisted.trackerPanelSectionOrder = normalizeTrackerPanelSectionOrder(persisted.trackerPanelSectionOrder);
        // v26 -> v27: add Roleplay avatar and default sprite scale controls.
        if (version <= 26) {
          if (persisted.roleplayAvatarScale === undefined) {
            persisted.roleplayAvatarScale = 1;
          }
          if (persisted.roleplaySpriteScale === undefined) {
            persisted.roleplaySpriteScale = 1;
          }
        }
        // v27 -> v28: enable Up-Arrow recall of the last user message by default.
        if (version <= 27 && persisted.editLastMessageOnArrowUp === undefined) {
          persisted.editLastMessageOnArrowUp = true;
        }
        // v28 -> v29: preserve existing Impersonate quick-button users by moving them into Quick replies.
        if (
          version <= 28 &&
          persisted.showQuickRepliesMenu === undefined &&
          persisted.impersonateShowQuickButton === true
        ) {
          persisted.showQuickRepliesMenu = true;
          persisted.showQuickReplyPostOnly = false;
          persisted.showQuickReplyGuide = false;
          persisted.showQuickReplyImpersonate = true;
        }
        return persisted;
      },
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        trackerPanelEnabled: state.trackerPanelEnabled,
        trackerPanelOpen: state.trackerPanelOpen,
        trackerPanelSide: state.trackerPanelSide,
        trackerPanelHideHudWidgets: state.trackerPanelHideHudWidgets,
        trackerPanelUseExpressionSprites: state.trackerPanelUseExpressionSprites,
        trackerPanelWidth: state.trackerPanelWidth,
        trackerPanelCollapsedSections: state.trackerPanelCollapsedSections,
        trackerPanelSectionOrder: state.trackerPanelSectionOrder,
        theme: state.theme,
        chatBackground: state.chatBackground,
        fontSize: state.fontSize,
        language: state.language,
        chatFontSize: state.chatFontSize,
        fontFamily: state.fontFamily,
        enableStreaming: state.enableStreaming,
        debugMode: state.debugMode,
        streamingSpeed: state.streamingSpeed,
        gameInstantTextReveal: state.gameInstantTextReveal,
        gameMiddleMouseNav: state.gameMiddleMouseNav,
        gameDialogueDisplayMode: state.gameDialogueDisplayMode,
        gameTextSpeed: state.gameTextSpeed,
        gameAutoPlayDelay: state.gameAutoPlayDelay,
        reviewImagePromptsBeforeSend: state.reviewImagePromptsBeforeSend,
        imageBackgroundWidth: state.imageBackgroundWidth,
        imageBackgroundHeight: state.imageBackgroundHeight,
        imagePortraitWidth: state.imagePortraitWidth,
        imagePortraitHeight: state.imagePortraitHeight,
        imageSelfieWidth: state.imageSelfieWidth,
        imageSelfieHeight: state.imageSelfieHeight,

        messageGrouping: state.messageGrouping,
        showTimestamps: state.showTimestamps,
        showModelName: state.showModelName,
        showTokenUsage: state.showTokenUsage,
        showMessageNumbers: state.showMessageNumbers,
        guideGenerations: state.guideGenerations,
        showQuickRepliesMenu: state.showQuickRepliesMenu,
        showQuickReplyPostOnly: state.showQuickReplyPostOnly,
        showQuickReplyGuide: state.showQuickReplyGuide,
        showQuickReplyImpersonate: state.showQuickReplyImpersonate,
        confirmBeforeDelete: state.confirmBeforeDelete,
        messagesPerPage: state.messagesPerPage,
        boldDialogue: state.boldDialogue,
        trimIncompleteModelOutput: state.trimIncompleteModelOutput,
        speechToTextEnabled: state.speechToTextEnabled,
        spotifyPlayerEnabled: state.spotifyPlayerEnabled,
        spotifyMobileWidgetCollapsed: state.spotifyMobileWidgetCollapsed,
        spotifyMobileWidgetPosition: state.spotifyMobileWidgetPosition,
        intuitiveSwipeNavigation: state.intuitiveSwipeNavigation,
        intuitiveSwipeRerollLatest: state.intuitiveSwipeRerollLatest,
        narrationFontColor: state.narrationFontColor,
        narrationOpacity: state.narrationOpacity,
        chatFontColor: state.chatFontColor,
        chatFontOpacity: state.chatFontOpacity,
        roleplayAvatarStyle: state.roleplayAvatarStyle,
        roleplayAvatarScale: state.roleplayAvatarScale,
        roleplaySpriteScale: state.roleplaySpriteScale,
        gameAvatarScale: state.gameAvatarScale,
        gameFullBodySpriteScale: state.gameFullBodySpriteScale,
        textStrokeWidth: state.textStrokeWidth,
        textStrokeColor: state.textStrokeColor,
        visualTheme: state.visualTheme,
        convoGradient: state.convoGradient,
        enterToSendRP: state.enterToSendRP,
        enterToSendConvo: state.enterToSendConvo,
        enterToSendGame: state.enterToSendGame,
        weatherEffects: state.weatherEffects,
        hudPosition: state.hudPosition,
        hasMigratedCustomThemesToServer: state.hasMigratedCustomThemesToServer,
        activeCustomTheme: state.activeCustomTheme,
        customThemes: state.customThemes,
        installedExtensions: state.installedExtensions,
        hasMigratedExtensionsToServer: state.hasMigratedExtensionsToServer,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        linkApiBannerDismissed: state.linkApiBannerDismissed,
        echoChamberSide: state.echoChamberSide,
        userStatusManual: state.userStatusManual,
        userStatus: state.userStatus,
        userActivity: state.userActivity,
        convoNotificationSound: state.convoNotificationSound,
        rpNotificationSound: state.rpNotificationSound,
        customConversationPrompt: state.customConversationPrompt,
        scheduleGenerationPreferences: state.scheduleGenerationPreferences,
        impersonatePromptTemplate: state.impersonatePromptTemplate,
        impersonateShowQuickButton: state.impersonateShowQuickButton,
        impersonateCyoaChoices: state.impersonateCyoaChoices,
        impersonatePresetId: state.impersonatePresetId,
        impersonateConnectionId: state.impersonateConnectionId,
        impersonateBlockAgents: state.impersonateBlockAgents,
        learnedGameSetupOptions: state.learnedGameSetupOptions,
        rememberedGameSetupText: state.rememberedGameSetupText,
      }),
    },
  ),
);
