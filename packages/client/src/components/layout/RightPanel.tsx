// ──────────────────────────────────────────────
// Layout: Right Panel (polished with panel transitions)
// ──────────────────────────────────────────────
import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { X, Users, BookOpen, FileText, Link, Sparkles, Settings, UserCircle, Bot } from "lucide-react";
import { useUIStore } from "../../stores/ui.store";

const CharactersPanel = lazy(() =>
  import("../panels/CharactersPanel").then((module) => ({ default: module.CharactersPanel })),
);
const LorebooksPanel = lazy(() =>
  import("../panels/LorebooksPanel").then((module) => ({ default: module.LorebooksPanel })),
);
const PresetsPanel = lazy(() => import("../panels/PresetsPanel").then((module) => ({ default: module.PresetsPanel })));
const ConnectionsPanel = lazy(() =>
  import("../panels/ConnectionsPanel").then((module) => ({ default: module.ConnectionsPanel })),
);
const AgentsPanel = lazy(() => import("../panels/AgentsPanel").then((module) => ({ default: module.AgentsPanel })));
const PersonasPanel = lazy(() =>
  import("../panels/PersonasPanel").then((module) => ({ default: module.PersonasPanel })),
);
const SettingsPanel = lazy(() =>
  import("../panels/SettingsPanel").then((module) => ({ default: module.SettingsPanel })),
);
const BotBrowserPanel = lazy(() =>
  import("../panels/BotBrowserPanel").then((module) => ({ default: module.BotBrowserPanel })),
);

const PANEL_CONFIG: Record<string, { title: string; icon: ReactNode; gradient: string }> = {
  "bot-browser": { title: "Browser", icon: <Bot size="0.875rem" />, gradient: "from-cyan-400 to-blue-500" },
  characters: { title: "Characters", icon: <Users size="0.875rem" />, gradient: "from-pink-400 to-rose-500" },
  lorebooks: { title: "Lorebooks", icon: <BookOpen size="0.875rem" />, gradient: "from-amber-400 to-orange-500" },
  presets: { title: "Presets", icon: <FileText size="0.875rem" />, gradient: "from-purple-400 to-violet-500" },
  connections: { title: "Connections", icon: <Link size="0.875rem" />, gradient: "from-sky-400 to-blue-500" },
  agents: { title: "Agents", icon: <Sparkles size="0.875rem" />, gradient: "from-pink-300 to-purple-400" },
  personas: { title: "Personas", icon: <UserCircle size="0.875rem" />, gradient: "from-emerald-400 to-teal-500" },
  settings: { title: "Settings", icon: <Settings size="0.875rem" />, gradient: "from-gray-400 to-gray-500" },
};

const PANELS: Record<string, LazyExoticComponent<ComponentType>> = {
  "bot-browser": BotBrowserPanel,
  characters: CharactersPanel,
  lorebooks: LorebooksPanel,
  presets: PresetsPanel,
  connections: ConnectionsPanel,
  agents: AgentsPanel,
  personas: PersonasPanel,
  settings: SettingsPanel,
};

// Module-level set survives component remounts (e.g. mobile AnimatePresence unmount/remount)
const mountedPanels = new Set<string>();

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}

export function RightPanel() {
  const panel = useUIStore((s) => s.rightPanel);
  const close = useUIStore((s) => s.closeRightPanel);

  // Add synchronously so the current panel is in the set for this render.
  // Module-level Set is not React state, so mutating it during render is safe.
  mountedPanels.add(panel);

  const config = PANEL_CONFIG[panel] ?? { title: "Panel", icon: null, gradient: "from-slate-400 to-slate-500" };

  return (
    <section
      data-component="RightPanel"
      aria-label={config.title}
      className="mari-right-panel-content flex h-full flex-col"
    >
      {/* Header - OS window style */}
      <div className="mari-right-panel-header relative flex h-12 flex-shrink-0 items-center justify-between bg-[var(--card)]/80 px-4 backdrop-blur-sm">
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br ${config.gradient} text-white shadow-sm`}
          >
            {config.icon}
          </div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{config.title}</h2>
        </div>
        <button
          onClick={close}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-90"
        >
          <X size="0.875rem" />
        </button>
      </div>

      {/* Content — keep visited panels mounted but hidden to avoid re-animation */}
      <div className="relative flex-1 overflow-hidden">
        {Object.entries(PANELS).map(([key, PanelComp]) => {
          if (!mountedPanels.has(key)) return null;
          const active = key === panel;
          return (
            <div
              key={key}
              className={`absolute inset-0 overflow-y-auto ${active ? "" : "hidden"}`}
              aria-hidden={!active}
            >
              <Suspense fallback={active ? <PanelFallback /> : null}>
                <PanelComp />
              </Suspense>
            </div>
          );
        })}
      </div>
    </section>
  );
}
