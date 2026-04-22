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
export type EchoChamberSide = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type UserStatus = "active" | "idle" | "dnd";
export type RoleplayAvatarStyle = "circles" | "panel";
export const APP_LANGUAGE_OPTIONS = [{ id: "en", label: "English" }] as const;
export type AppLanguage = (typeof APP_LANGUAGE_OPTIONS)[number]["id"];

const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 480;
const RIGHT_PANEL_WIDTH_MIN = 280;
const RIGHT_PANEL_WIDTH_MAX = 520;

/** Legacy browser-local custom theme preserved for one-time migration. */
export interface CustomTheme {
  id: string;
  name: string;
  /** Raw CSS that gets injected as a <style> tag */
  css: string;
  /** When this theme was installed */
  installedAt: string;
}

/** A user-installed extension (JS/CSS) */
export interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  /** CSS to inject */
  css?: string;
  /** JavaScript to execute */
  js?: string;
  /** Whether the extension is enabled */
  enabled: boolean;
  installedAt: string;
}

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanel: Panel;
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
  /** Typewriter speed: 1 (very slow) to 100 (instant). Controls how fast streaming tokens appear. */
  streamingSpeed: number;
  /** When true, Game mode narration segments are revealed in full as soon as they become active. */
  gameInstantTextReveal: boolean;
  /** Game narration text speed: 1 (very slow) to 100 (instant). Controls the typewriter in game mode. */
  gameTextSpeed: number;
  /** Delay in ms between auto-advancing narration segments when auto-play is enabled. */
  gameAutoPlayDelay: number;
  debugMode: boolean;
  messageGrouping: boolean;
  showTimestamps: boolean;
  showModelName: boolean;
  showTokenUsage: boolean;
  showMessageNumbers: boolean;
  confirmBeforeDelete: boolean;
  /** Number of messages to load per page (0 = load all) */
  messagesPerPage: number;
  /** Bold quoted dialogue in chat messages; color highlighting can still remain when this is off */
  boldDialogue: boolean;

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
  /** Text outline/stroke width in px (0 = off) */
  textStrokeWidth: number;
  /** Text outline/stroke color */
  textStrokeColor: string;

  // ── Visual Theme ──
  visualTheme: VisualTheme;

  // ── Conversation Gradient ──
  convoGradientFrom: string;
  convoGradientTo: string;

  // ── Sound ──
  convoNotificationSound: boolean;
  rpNotificationSound: boolean;

  // ── Custom Conversation Prompt ──
  /** User's custom default system prompt for new conversations (null = built-in default). */
  customConversationPrompt: string | null;

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
  installedExtensions: InstalledExtension[];

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

  /** Transient: true when center content area is too narrow (overflow detected) */
  centerCompact: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
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
  openBotBrowser: () => void;
  closeBotBrowser: () => void;

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
  setStreamingSpeed: (v: number) => void;
  setGameInstantTextReveal: (v: boolean) => void;
  setGameTextSpeed: (v: number) => void;
  setGameAutoPlayDelay: (v: number) => void;
  setDebugMode: (v: boolean) => void;
  setMessageGrouping: (v: boolean) => void;
  setShowTimestamps: (v: boolean) => void;
  setShowModelName: (v: boolean) => void;
  setShowTokenUsage: (v: boolean) => void;
  setShowMessageNumbers: (v: boolean) => void;
  setConfirmBeforeDelete: (v: boolean) => void;
  setMessagesPerPage: (n: number) => void;
  setBoldDialogue: (v: boolean) => void;
  setNarrationFontColor: (v: string) => void;
  setNarrationOpacity: (v: number) => void;
  setChatFontColor: (v: string) => void;
  setChatFontOpacity: (v: number) => void;
  setRoleplayAvatarStyle: (v: RoleplayAvatarStyle) => void;
  setTextStrokeWidth: (v: number) => void;
  setTextStrokeColor: (v: string) => void;
  setCenterCompact: (v: boolean) => void;
  setVisualTheme: (v: VisualTheme) => void;
  setConvoGradientFrom: (v: string) => void;
  setConvoGradientTo: (v: string) => void;
  setConvoNotificationSound: (v: boolean) => void;
  setRpNotificationSound: (v: boolean) => void;
  setCustomConversationPrompt: (v: string | null) => void;
  setEnterToSendRP: (v: boolean) => void;
  setEnterToSendConvo: (v: boolean) => void;
  setEnterToSendGame: (v: boolean) => void;
  setWeatherEffects: (v: boolean) => void;
  setHudPosition: (v: HudPosition) => void;
  /** Legacy migration helpers for browser-local custom themes. */
  setHasMigratedCustomThemesToServer: (v: boolean) => void;
  clearLegacyCustomThemes: () => void;
  setActiveCustomTheme: (id: string | null) => void;
  addCustomTheme: (theme: CustomTheme) => void;
  updateCustomTheme: (id: string, patch: Partial<Pick<CustomTheme, "name" | "css">>) => void;
  removeCustomTheme: (id: string) => void;
  addExtension: (ext: InstalledExtension) => void;
  removeExtension: (id: string) => void;
  toggleExtension: (id: string) => void;
  setHasCompletedOnboarding: (v: boolean) => void;
  setGameTutorialDisabled: (v: boolean) => void;
  dismissLinkApiBanner: () => void;
  toggleEchoChamber: () => void;
  setEchoChamberSide: (side: EchoChamberSide) => void;
  setUserStatus: (status: UserStatus) => void;
  setUserStatusManual: (status: UserStatus) => void;
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
    theme: state.theme,
    chatBackground: state.chatBackground,
    fontSize: state.fontSize,
    language: state.language,
    chatFontSize: state.chatFontSize,
    fontFamily: state.fontFamily,
    enableStreaming: state.enableStreaming,
    streamingSpeed: state.streamingSpeed,
    gameInstantTextReveal: state.gameInstantTextReveal,
    gameTextSpeed: state.gameTextSpeed,
    gameAutoPlayDelay: state.gameAutoPlayDelay,
    debugMode: state.debugMode,
    messageGrouping: state.messageGrouping,
    showTimestamps: state.showTimestamps,
    showModelName: state.showModelName,
    showTokenUsage: state.showTokenUsage,
    showMessageNumbers: state.showMessageNumbers,
    confirmBeforeDelete: state.confirmBeforeDelete,
    messagesPerPage: state.messagesPerPage,
    boldDialogue: state.boldDialogue,
    narrationFontColor: state.narrationFontColor,
    narrationOpacity: state.narrationOpacity,
    chatFontColor: state.chatFontColor,
    chatFontOpacity: state.chatFontOpacity,
    roleplayAvatarStyle: state.roleplayAvatarStyle,
    textStrokeWidth: state.textStrokeWidth,
    textStrokeColor: state.textStrokeColor,
    visualTheme: state.visualTheme,
    convoGradientFrom: state.convoGradientFrom,
    convoGradientTo: state.convoGradientTo,
    enterToSendRP: state.enterToSendRP,
    enterToSendConvo: state.enterToSendConvo,
    weatherEffects: state.weatherEffects,
    hudPosition: state.hudPosition,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
    gameTutorialDisabled: state.gameTutorialDisabled,
    linkApiBannerDismissed: state.linkApiBannerDismissed,
    echoChamberSide: state.echoChamberSide,
    userStatusManual: state.userStatusManual,
    convoNotificationSound: state.convoNotificationSound,
    rpNotificationSound: state.rpNotificationSound,
    customConversationPrompt: state.customConversationPrompt,
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
      editorDirty: false,

      // Settings defaults
      fontSize: 17 as FontSize,
      language: "en" as AppLanguage,
      chatFontSize: 16,
      fontFamily: "",
      enableStreaming: true,
      streamingSpeed: 50,
      gameInstantTextReveal: false,
      gameTextSpeed: 50,
      gameAutoPlayDelay: 3000,
      debugMode: false,
      messageGrouping: true,
      showTimestamps: false,
      showModelName: false,
      showTokenUsage: false,
      showMessageNumbers: false,
      confirmBeforeDelete: true,
      messagesPerPage: 20,
      boldDialogue: true,
      narrationFontColor: "",
      narrationOpacity: 80,
      chatFontColor: "",
      chatFontOpacity: 90,
      roleplayAvatarStyle: "circles" as RoleplayAvatarStyle,
      textStrokeWidth: 0.5,
      textStrokeColor: "#000000",
      visualTheme: "default" as VisualTheme,
      convoGradientFrom: "#0a0a0e",
      convoGradientTo: "#1c2133",
      convoNotificationSound: true,
      rpNotificationSound: true,
      customConversationPrompt: null,
      enterToSendRP: false,
      enterToSendConvo: true,
      enterToSendGame: true,
      weatherEffects: true,
      hudPosition: "top" as HudPosition,
      activeCustomTheme: null,
      customThemes: [],
      hasMigratedCustomThemesToServer: false,
      installedExtensions: [],
      hasCompletedOnboarding: false,
      gameTutorialDisabled: false,
      linkApiBannerDismissed: false,
      echoChamberOpen: false,
      echoChamberSide: "bottom-right" as EchoChamberSide,
      userStatusManual: "active" as const,
      userStatus: "active" as UserStatus,
      centerCompact: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width)) }),
      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_MIN, Math.min(RIGHT_PANEL_WIDTH_MAX, width)) }),

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
          characterDetailId: null,
          lorebookDetailId: null,
          presetDetailId: null,
          connectionDetailId: null,
          agentDetailId: null,
          toolDetailId: null,
          ...(window.innerWidth < 768 && { rightPanelOpen: false }),
        }),
      closeRegexDetail: () => set({ regexDetailId: null, editorDirty: false }),
      openBotBrowser: () =>
        set({
          botBrowserOpen: true,
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
          s.botBrowserOpen
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
          botBrowserOpen: false,
          editorDirty: false,
        }),
      setEditorDirty: (dirty) => set({ editorDirty: dirty }),

      // Settings actions
      setFontSize: (size) => set({ fontSize: size }),
      setLanguage: (language) => set({ language }),
      setChatFontSize: (size) => set({ chatFontSize: size }),
      setFontFamily: (family) => set({ fontFamily: family }),
      setEnableStreaming: (v) => set({ enableStreaming: v }),
      setStreamingSpeed: (v) => set({ streamingSpeed: Math.max(1, Math.min(100, v)) }),
      setGameInstantTextReveal: (v) => set({ gameInstantTextReveal: v }),
      setGameTextSpeed: (v) => set({ gameTextSpeed: Math.max(1, Math.min(100, v)) }),
      setGameAutoPlayDelay: (v) => set({ gameAutoPlayDelay: Math.max(200, Math.min(10000, Math.round(v))) }),
      setDebugMode: (v) => set({ debugMode: v }),
      setMessageGrouping: (v) => set({ messageGrouping: v }),
      setShowTimestamps: (v) => set({ showTimestamps: v }),
      setShowModelName: (v) => set({ showModelName: v }),
      setShowTokenUsage: (v) => set({ showTokenUsage: v }),
      setShowMessageNumbers: (v) => set({ showMessageNumbers: v }),
      setConfirmBeforeDelete: (v) => set({ confirmBeforeDelete: v }),
      setMessagesPerPage: (n) => set({ messagesPerPage: n }),
      setBoldDialogue: (v) => set({ boldDialogue: v }),
      setNarrationFontColor: (v) => set({ narrationFontColor: v }),
      setNarrationOpacity: (v) => set({ narrationOpacity: Math.max(0, Math.min(100, v)) }),
      setChatFontColor: (v) => set({ chatFontColor: v }),
      setChatFontOpacity: (v) => set({ chatFontOpacity: Math.max(0, Math.min(100, v)) }),
      setRoleplayAvatarStyle: (v) => set({ roleplayAvatarStyle: v }),
      setTextStrokeWidth: (v) => set({ textStrokeWidth: Math.max(0, Math.min(5, v)) }),
      setTextStrokeColor: (v) => set({ textStrokeColor: v }),
      setCenterCompact: (v) => set({ centerCompact: v }),
      setVisualTheme: (v) => set({ visualTheme: v }),
      setConvoGradientFrom: (v) => set({ convoGradientFrom: v }),
      setConvoGradientTo: (v) => set({ convoGradientTo: v }),
      setConvoNotificationSound: (v) => set({ convoNotificationSound: v }),
      setRpNotificationSound: (v) => set({ rpNotificationSound: v }),
      setCustomConversationPrompt: (v) => set({ customConversationPrompt: v }),
      setEnterToSendRP: (v) => set({ enterToSendRP: v }),
      setEnterToSendConvo: (v) => set({ enterToSendConvo: v }),
      setEnterToSendGame: (v) => set({ enterToSendGame: v }),
      setWeatherEffects: (v) => set({ weatherEffects: v }),
      setHudPosition: (v) => set({ hudPosition: v }),
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
      addExtension: (ext) => set((s) => ({ installedExtensions: [...s.installedExtensions, ext] })),
      removeExtension: (id) =>
        set((s) => ({
          installedExtensions: s.installedExtensions.filter((e) => e.id !== id),
        })),
      toggleExtension: (id) =>
        set((s) => ({
          installedExtensions: s.installedExtensions.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
        })),
      setHasCompletedOnboarding: (v) => set({ hasCompletedOnboarding: v }),
      setGameTutorialDisabled: (v) => set({ gameTutorialDisabled: v }),
      dismissLinkApiBanner: () => set({ linkApiBannerDismissed: true }),
      toggleEchoChamber: () => set((s) => ({ echoChamberOpen: !s.echoChamberOpen })),
      setEchoChamberSide: (side) => set({ echoChamberSide: side }),
      setUserStatus: (status) => set({ userStatus: status }),
      setUserStatusManual: (status) => set({ userStatusManual: status, userStatus: status }),
    }),
    {
      name: "marinara-engine-ui",
      version: 9,
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
        return persisted;
      },
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        theme: state.theme,
        chatBackground: state.chatBackground,
        fontSize: state.fontSize,
        language: state.language,
        chatFontSize: state.chatFontSize,
        fontFamily: state.fontFamily,
        enableStreaming: state.enableStreaming,
        streamingSpeed: state.streamingSpeed,
        gameInstantTextReveal: state.gameInstantTextReveal,
        gameTextSpeed: state.gameTextSpeed,
        gameAutoPlayDelay: state.gameAutoPlayDelay,
        debugMode: state.debugMode,
        messageGrouping: state.messageGrouping,
        showTimestamps: state.showTimestamps,
        showModelName: state.showModelName,
        showTokenUsage: state.showTokenUsage,
        showMessageNumbers: state.showMessageNumbers,
        confirmBeforeDelete: state.confirmBeforeDelete,
        messagesPerPage: state.messagesPerPage,
        boldDialogue: state.boldDialogue,
        narrationFontColor: state.narrationFontColor,
        narrationOpacity: state.narrationOpacity,
        chatFontColor: state.chatFontColor,
        chatFontOpacity: state.chatFontOpacity,
        roleplayAvatarStyle: state.roleplayAvatarStyle,
        textStrokeWidth: state.textStrokeWidth,
        textStrokeColor: state.textStrokeColor,
        visualTheme: state.visualTheme,
        convoGradientFrom: state.convoGradientFrom,
        convoGradientTo: state.convoGradientTo,
        enterToSendRP: state.enterToSendRP,
        enterToSendConvo: state.enterToSendConvo,
        enterToSendGame: state.enterToSendGame,
        weatherEffects: state.weatherEffects,
        hudPosition: state.hudPosition,
        hasMigratedCustomThemesToServer: state.hasMigratedCustomThemesToServer,
        activeCustomTheme: state.activeCustomTheme,
        customThemes: state.customThemes,
        installedExtensions: state.installedExtensions,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        linkApiBannerDismissed: state.linkApiBannerDismissed,
        echoChamberSide: state.echoChamberSide,
        userStatusManual: state.userStatusManual,
        userStatus: state.userStatus,
        convoNotificationSound: state.convoNotificationSound,
        rpNotificationSound: state.rpNotificationSound,
        customConversationPrompt: state.customConversationPrompt,
      }),
    },
  ),
);
