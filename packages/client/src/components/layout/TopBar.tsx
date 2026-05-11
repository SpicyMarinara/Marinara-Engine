// ──────────────────────────────────────────────
// Layout: Top Bar (polished, with hover glow)
// ──────────────────────────────────────────────
import { PanelLeft, Home, Settings, Link, BookOpen, Users, Sparkles, FileText, User, Bot, Folder } from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { useAgentStore } from "../../stores/agent.store";
import { cn } from "../../lib/utils";
import { SpotifyMiniPlayer } from "../spotify/SpotifyMiniPlayer";

const RIGHT_PANEL_BUTTONS = [
  { panel: "lorebooks" as const, icon: BookOpen, label: "Lorebooks", color: "from-amber-400 to-orange-500" },
  { panel: "presets" as const, icon: FileText, label: "Presets", color: "from-purple-400 to-violet-500" },
  { panel: "connections" as const, icon: Link, label: "Connections", color: "from-sky-400 to-blue-500" },
  { panel: "agents" as const, icon: Sparkles, label: "Agents", color: "from-pink-300 to-purple-400" },
  { panel: "personas" as const, icon: User, label: "Personas", color: "from-emerald-400 to-teal-500" },
] as const;

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const failedAgentCount = useAgentStore((s) => s.failedAgentTypes.length);

  const isBotBrowserActive = rightPanelOpen && rightPanel === "bot-browser";
  const isCharactersPanelActive = rightPanelOpen && rightPanel === "characters";
  const gameAssetsBrowserOpen = useUIStore((s) => s.gameAssetsBrowserOpen);
  const openGameAssetsBrowser = useUIStore((s) => s.openGameAssetsBrowser);
  const closeGameAssetsBrowser = useUIStore((s) => s.closeGameAssetsBrowser);

  return (
    <header
      data-component="TopBar"
      className="mari-topbar relative z-10 flex h-12 flex-shrink-0 items-center justify-between bg-[var(--card)]/80 px-3 backdrop-blur-sm"
    >
      {/* Subtle bottom border only */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />

      {/* Left section: window controls + chat info */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          onClick={toggleSidebar}
          data-tour="sidebar-toggle"
          className="rounded-lg p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-95"
          title="Chats"
        >
          <PanelLeft size="1.125rem" />
        </button>

        <button
          onClick={() => {
            setActiveChatId(null);
            closeAllDetails();
          }}
          className="rounded-lg p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-95"
          title="Home"
        >
          <Home size="1.125rem" />
        </button>
        <SpotifyMiniPlayer />
      </div>

      {/* Right section - Panel toggles */}
      <nav
        data-tour="panel-buttons"
        aria-label="Panel navigation"
        className="flex items-center gap-0.5 rounded-xl p-1 max-sm:gap-0 max-sm:p-0.5"
      >
        {/* Browser */}
        <button
          onClick={() => toggleRightPanel("bot-browser")}
          className={cn(
            "relative rounded-lg p-2 transition-all duration-200 max-sm:p-1.5",
            isBotBrowserActive
              ? "bg-[var(--accent)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
          )}
          title="Browser"
        >
          <Bot size="0.9375rem" />
          {isBotBrowserActive && (
            <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
          )}
        </button>

        <button
          onClick={() => toggleRightPanel("characters")}
          className={cn(
            "relative rounded-lg p-2 transition-all duration-200 max-sm:p-1.5",
            isCharactersPanelActive
              ? "bg-[var(--accent)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
          )}
          title="Characters"
        >
          <Users size="0.9375rem" />
          {isCharactersPanelActive && (
            <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-pink-400 to-rose-500" />
          )}
        </button>

        {RIGHT_PANEL_BUTTONS.map(({ panel, icon: Icon, label, color }) => {
          const isActive = rightPanelOpen && rightPanel === panel;
          return (
            <button
              key={panel}
              onClick={() => toggleRightPanel(panel)}
              className={cn(
                "relative rounded-lg p-2 transition-all duration-200 max-sm:p-1.5",
                isActive
                  ? "bg-[var(--accent)] text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
              )}
              title={label}
            >
              <Icon size="0.9375rem" />
              {isActive && (
                <span
                  className={cn(
                    "absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r",
                    color,
                  )}
                />
              )}
              {panel === "agents" && failedAgentCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-[var(--card)]" />
              )}
            </button>
          );
        })}

        {/* Game Assets */}
        <button
          onClick={() => (gameAssetsBrowserOpen ? closeGameAssetsBrowser() : openGameAssetsBrowser())}
          className={cn(
            "relative rounded-lg p-2 transition-all duration-200 max-sm:p-1.5",
            gameAssetsBrowserOpen
              ? "bg-[var(--accent)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
          )}
          title="Assets"
        >
          <Folder size="0.9375rem" />
          {gameAssetsBrowserOpen && (
            <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" />
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => toggleRightPanel("settings")}
          className={cn(
            "relative rounded-lg p-2 transition-all duration-200 max-sm:p-1.5",
            rightPanelOpen && rightPanel === "settings"
              ? "bg-[var(--accent)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
          )}
          title="Settings"
        >
          <Settings size="0.9375rem" />
          {rightPanelOpen && rightPanel === "settings" && (
            <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-gray-400 to-gray-500" />
          )}
        </button>
      </nav>
    </header>
  );
}
