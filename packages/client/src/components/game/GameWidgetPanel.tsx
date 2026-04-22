// ──────────────────────────────────────────────
// Game: HUD Widget Renderers
//
// Pre-built React components for each widget type.
// The model picks a type + config during setup;
// the renderer handles all visual presentation.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import type { HudWidget } from "@marinara-engine/shared";
import { useUpdateGameWidgets } from "../../hooks/use-game";
import { cn } from "../../lib/utils";
import { useGameModeStore } from "../../stores/game-mode.store";
import { Modal } from "../ui/Modal";
import { PanelLockButton, useDraggablePanel } from "./DraggablePanel";

// ── Public API ──

interface GameWidgetPanelProps {
  widgets: HudWidget[];
  position: "hud_left" | "hud_right";
  /** Chat id used to scope persisted lock + position so layouts don't bleed across games. */
  chatId: string;
  /** Ref to the game surface element used as a drag boundary. */
  constraintsRef?: RefObject<HTMLElement | null>;
}

interface MobileWidgetPanelProps {
  widgets: HudWidget[];
  position: "hud_left" | "hud_right";
  chatId: string;
}

interface WidgetEditorDraft {
  value: string;
  max: string;
  count: string;
  seconds: string;
  running: boolean;
  stats: Array<{ name: string; value: string }>;
  items: string;
}

/** Maximum number of custom HUD widgets displayed. */
const MAX_WIDGETS = 4;

const EMPTY_WIDGET_DRAFT: WidgetEditorDraft = {
  value: "",
  max: "",
  count: "",
  seconds: "",
  running: false,
  stats: [],
  items: "",
};

function getVisibleWidgets(widgets: HudWidget[], position: "hud_left" | "hud_right") {
  return widgets.filter((w) => w.position === position && w.type !== "inventory_grid").slice(0, MAX_WIDGETS);
}

function createWidgetEditorDraft(widget: HudWidget): WidgetEditorDraft {
  return {
    value: widget.config.value != null ? String(widget.config.value) : "",
    max: widget.config.max != null ? String(widget.config.max) : "",
    count: widget.config.count != null ? String(widget.config.count) : "",
    seconds: widget.config.seconds != null ? String(widget.config.seconds) : "",
    running: Boolean(widget.config.running),
    stats: Array.isArray(widget.config.stats)
      ? widget.config.stats.map((stat) => ({ name: stat.name, value: String(stat.value ?? "") }))
      : [],
    items: Array.isArray(widget.config.items) ? widget.config.items.join("\n") : "",
  };
}

function parseNumberDraft(
  rawValue: string,
  fallback: number,
  options?: { integer?: boolean; min?: number; max?: number },
) {
  const trimmed = rawValue.trim();
  if (!trimmed) return fallback;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;

  let nextValue = options?.integer ? Math.round(parsed) : parsed;
  if (typeof options?.min === "number") nextValue = Math.max(options.min, nextValue);
  if (typeof options?.max === "number") nextValue = Math.min(options.max, nextValue);
  return nextValue;
}

function coerceStatValue(rawValue: string, fallback: number | string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return typeof fallback === "number" ? fallback : "";
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function buildUpdatedWidgetConfig(widget: HudWidget, draft: WidgetEditorDraft): HudWidget["config"] {
  const nextConfig = { ...widget.config };

  switch (widget.type) {
    case "progress_bar":
    case "gauge":
    case "relationship_meter":
      nextConfig.value = parseNumberDraft(
        draft.value,
        typeof widget.config.value === "number" ? widget.config.value : 0,
        {
          min: 0,
        },
      );
      nextConfig.max = parseNumberDraft(draft.max, typeof widget.config.max === "number" ? widget.config.max : 100, {
        min: 1,
      });
      return nextConfig;
    case "counter":
      nextConfig.count = parseNumberDraft(
        draft.count,
        typeof widget.config.count === "number" ? widget.config.count : 0,
        {
          integer: true,
        },
      );
      return nextConfig;
    case "stat_block":
      nextConfig.stats = draft.stats.map((stat, index) => {
        const existingStat = widget.config.stats?.[index];
        return {
          name: stat.name,
          value: coerceStatValue(stat.value, existingStat?.value ?? ""),
        };
      });
      return nextConfig;
    case "list":
      nextConfig.items = draft.items
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      return nextConfig;
    case "timer":
      nextConfig.seconds = parseNumberDraft(
        draft.seconds,
        typeof widget.config.seconds === "number" ? widget.config.seconds : 0,
        { integer: true, min: 0 },
      );
      nextConfig.running = draft.running;
      return nextConfig;
    default:
      return nextConfig;
  }
}

function useWidgetEditor(widgets: HudWidget[], chatId: string) {
  const setHudWidgets = useGameModeStore((s) => s.setHudWidgets);
  const updateGameWidgets = useUpdateGameWidgets();
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);

  const editingWidget = useMemo(
    () => widgets.find((widget) => widget.id === editingWidgetId) ?? null,
    [editingWidgetId, widgets],
  );

  useEffect(() => {
    if (editingWidgetId && !editingWidget) {
      setEditingWidgetId(null);
    }
  }, [editingWidget, editingWidgetId]);

  const openEditor = useCallback((widget: HudWidget) => {
    setEditingWidgetId(widget.id);
  }, []);

  const closeEditor = useCallback(() => {
    if (updateGameWidgets.isPending) return;
    setEditingWidgetId(null);
  }, [updateGameWidgets.isPending]);

  const saveWidget = useCallback(
    async (nextConfig: HudWidget["config"]) => {
      if (!editingWidget) return;

      const previousWidgets = widgets;
      const nextWidgets = widgets.map((widget) =>
        widget.id === editingWidget.id ? { ...widget, config: nextConfig } : widget,
      );

      setHudWidgets(nextWidgets);

      try {
        await updateGameWidgets.mutateAsync({ chatId, widgets: nextWidgets });
        toast.success(`${editingWidget.label} updated.`);
        setEditingWidgetId(null);
      } catch {
        setHudWidgets(previousWidgets);
        toast.error("Failed to save widget changes.");
      }
    },
    [chatId, editingWidget, setHudWidgets, updateGameWidgets, widgets],
  );

  return {
    editingWidget,
    openEditor,
    closeEditor,
    saveWidget,
    isSaving: updateGameWidgets.isPending,
  };
}

/** Renders a panel of model-defined widgets for a given position. */
export function GameWidgetPanel({ widgets, position, chatId, constraintsRef }: GameWidgetPanelProps) {
  const filtered = getVisibleWidgets(widgets, position);
  const { editingWidget, openEditor, closeEditor, saveWidget, isSaving } = useWidgetEditor(widgets, chatId);

  if (filtered.length === 0) return null;

  return (
    <>
      <div className="pointer-events-auto flex flex-col gap-2">
        {filtered.map((w) => (
          <WidgetCard
            key={`${chatId}:${w.id}`}
            widget={w}
            chatId={chatId}
            constraintsRef={constraintsRef}
            onEdit={openEditor}
          />
        ))}
      </div>
      <WidgetEditorModal
        widget={editingWidget}
        open={!!editingWidget}
        onClose={closeEditor}
        onSave={saveWidget}
        isSaving={isSaving}
      />
    </>
  );
}

/** Mobile: collapsed emoji pills that expand into full widget on tap. */
export function MobileWidgetPanel({ widgets, position, chatId }: MobileWidgetPanelProps) {
  const filtered = getVisibleWidgets(widgets, position);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { editingWidget, openEditor, closeEditor, saveWidget, isSaving } = useWidgetEditor(widgets, chatId);

  if (filtered.length === 0) return null;

  return (
    <>
      <div className={cn("pointer-events-auto flex flex-col gap-1.5", position === "hud_right" && "items-end")}>
        {filtered.map((w) => {
          const isExpanded = expandedId === w.id;
          const accent = w.accent ?? "#a78bfa";

          if (isExpanded) {
            return (
              <div
                key={w.id}
                className="w-40 overflow-hidden rounded-lg border bg-black/70 backdrop-blur-md transition-all"
                style={{ borderColor: `${accent}30` }}
              >
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-left">
                  {w.icon && <span className="text-xs">{w.icon}</span>}
                  <span className="flex-1 truncate text-[0.6875rem] font-semibold" style={{ color: accent }}>
                    {w.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditor(w)}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                    title={`Edit ${w.label}`}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                    title="Collapse widget"
                  >
                    ×
                  </button>
                </div>
                <div className="border-t px-2.5 py-2" style={{ borderColor: `${accent}15` }}>
                  <WidgetBody widget={w} />
                </div>
              </div>
            );
          }

          return (
            <button
              key={w.id}
              onClick={() => setExpandedId(w.id)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border bg-black/60 text-base backdrop-blur-md transition-transform active:scale-95"
              style={{ borderColor: `${accent}30` }}
              title={w.label}
            >
              {w.icon || "📊"}
            </button>
          );
        })}
      </div>
      <WidgetEditorModal
        widget={editingWidget}
        open={!!editingWidget}
        onClose={closeEditor}
        onSave={saveWidget}
        isSaving={isSaving}
      />
    </>
  );
}

// ── Widget Card Wrapper ──

function WidgetCard({
  widget,
  chatId,
  constraintsRef,
  onEdit,
}: {
  widget: HudWidget;
  chatId: string;
  constraintsRef?: RefObject<HTMLElement | null>;
  onEdit: (widget: HudWidget) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const accent = widget.accent ?? "#a78bfa";
  const { locked, toggleLocked, x, y, handleDragEnd } = useDraggablePanel(chatId, `widget:${widget.id}`);

  return (
    <motion.div
      drag={!locked}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={constraintsRef as RefObject<Element>}
      onDragEnd={handleDragEnd}
      style={{ x, y, borderColor: `${accent}30` }}
      className={cn(
        "w-full overflow-hidden rounded-lg border bg-black/60 backdrop-blur-md transition-colors",
        !locked && "cursor-grab ring-1 ring-white/20 active:cursor-grabbing",
      )}
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        {widget.icon && <span className="text-xs">{widget.icon}</span>}
        <span
          className="flex-1 overflow-x-auto scrollbar-hide whitespace-nowrap text-[0.6875rem] font-semibold"
          style={{ color: accent }}
        >
          {widget.label}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(widget);
          }}
          className="flex h-5 w-5 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          title={`Edit ${widget.label}`}
        >
          <Pencil size={10} />
        </button>
        <PanelLockButton locked={locked} onToggle={toggleLocked} size={10} />
        <span className="text-[0.5rem] text-white/30">{collapsed ? "+" : "-"}</span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="border-t px-2.5 py-2" style={{ borderColor: `${accent}15` }}>
          <WidgetBody widget={widget} />
        </div>
      )}
    </motion.div>
  );
}

// ── Widget Body Router ──

function WidgetBody({ widget }: { widget: HudWidget }) {
  switch (widget.type) {
    case "progress_bar":
      return <ProgressBarWidget widget={widget} />;
    case "gauge":
      return <GaugeWidget widget={widget} />;
    case "relationship_meter":
      return <RelationshipMeterWidget widget={widget} />;
    case "counter":
      return <CounterWidget widget={widget} />;
    case "stat_block":
      return <StatBlockWidget widget={widget} />;
    case "list":
      return <ListWidget widget={widget} />;
    case "inventory_grid":
      return <InventoryGridWidget widget={widget} />;
    case "timer":
      return <TimerWidget widget={widget} />;
    default:
      return <p className="text-[0.625rem] text-white/40">Unknown widget type</p>;
  }
}

function WidgetEditorModal({
  widget,
  open,
  onClose,
  onSave,
  isSaving,
}: {
  widget: HudWidget | null;
  open: boolean;
  onClose: () => void;
  onSave: (config: HudWidget["config"]) => Promise<void>;
  isSaving: boolean;
}) {
  const [draft, setDraft] = useState<WidgetEditorDraft>(EMPTY_WIDGET_DRAFT);

  useEffect(() => {
    if (widget) {
      setDraft(createWidgetEditorDraft(widget));
    }
  }, [widget]);

  const handleSave = useCallback(() => {
    if (!widget) return;
    void onSave(buildUpdatedWidgetConfig(widget, draft));
  }, [draft, onSave, widget]);

  if (!open || !widget || typeof document === "undefined") return null;

  const hintEntries = Object.entries(widget.config.valueHints ?? {});

  return createPortal(
    <Modal open={open} onClose={isSaving ? () => {} : onClose} title={`Edit ${widget.label}`} width="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Adjust this widget manually when the model misses an update.
        </p>

        {(widget.type === "progress_bar" || widget.type === "gauge" || widget.type === "relationship_meter") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Current value</span>
              <input
                type="number"
                value={draft.value}
                onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Maximum value</span>
              <input
                type="number"
                min={1}
                value={draft.max}
                onChange={(event) => setDraft((current) => ({ ...current, max: event.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
              />
            </label>
          </div>
        )}

        {widget.type === "counter" && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Count</span>
            <input
              type="number"
              value={draft.count}
              onChange={(event) => setDraft((current) => ({ ...current, count: event.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
            />
          </label>
        )}

        {widget.type === "stat_block" && (
          <div className="space-y-3">
            {draft.stats.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">This stat block has no editable values.</p>
            ) : (
              draft.stats.map((stat, index) => (
                <div
                  key={`${stat.name}:${index}`}
                  className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-end"
                >
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-[var(--muted-foreground)]">Stat</span>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]/75">
                      {stat.name}
                    </div>
                  </div>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-[var(--muted-foreground)]">Value</span>
                    <input
                      type="text"
                      value={stat.value}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          stats: current.stats.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, value: event.target.value } : entry,
                          ),
                        }))
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        )}

        {widget.type === "list" && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Items</span>
            <textarea
              value={draft.items}
              onChange={(event) => setDraft((current) => ({ ...current, items: event.target.value }))}
              rows={6}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
            />
            <span className="block text-xs text-[var(--muted-foreground)]">Enter one item per line.</span>
          </label>
        )}

        {widget.type === "timer" && (
          <div className="space-y-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Seconds remaining</span>
              <input
                type="number"
                min={0}
                value={draft.seconds}
                onChange={(event) => setDraft((current) => ({ ...current, seconds: event.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={draft.running}
                onChange={(event) => setDraft((current) => ({ ...current, running: event.target.checked }))}
                className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
              />
              Timer is running
            </label>
          </div>
        )}

        {hintEntries.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--accent)]/40 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-[var(--foreground)]">Model value hints</p>
            <div className="space-y-1 text-xs text-[var(--muted-foreground)]">
              {hintEntries.map(([key, value]) => (
                <p key={key}>
                  <span className="font-medium text-[var(--foreground)]/80">{key}:</span> {value}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}

// ── Widget Implementations ──

function ProgressBarWidget({ widget }: { widget: HudWidget }) {
  const { value = 0, max = 100, dangerBelow } = widget.config;
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const accent = widget.accent ?? "#a78bfa";
  const isDanger = dangerBelow != null && value < dangerBelow;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[0.5625rem]">
        <span className="text-white/60">{value}</span>
        <span className="text-white/30">/ {max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-all duration-700", isDanger && "animate-pulse")}
          style={{
            width: `${pct}%`,
            background: isDanger
              ? "linear-gradient(90deg, #ef4444, #f87171)"
              : `linear-gradient(90deg, ${accent}cc, ${accent})`,
          }}
        />
      </div>
    </div>
  );
}

function GaugeWidget({ widget }: { widget: HudWidget }) {
  const { value = 0, max = 100, dangerBelow } = widget.config;
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const accent = widget.accent ?? "#22c55e";
  const isDanger = dangerBelow != null && value < dangerBelow;

  // Semicircle gauge
  const angle = (pct / 100) * 180;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-12 w-24 overflow-hidden">
        {/* Track */}
        <div
          className="absolute inset-0 rounded-t-full border-4 border-b-0 border-white/10"
          style={{ borderTopColor: `${accent}20` }}
        />
        {/* Fill */}
        <div
          className="absolute bottom-0 left-1/2 h-full w-1 origin-bottom -translate-x-1/2 transition-transform duration-700"
          style={{
            transform: `translateX(-50%) rotate(${angle - 90}deg)`,
            background: isDanger ? "#ef4444" : accent,
            boxShadow: `0 0 6px ${isDanger ? "#ef444480" : accent + "60"}`,
          }}
        />
      </div>
      <span className={cn("mt-0.5 text-sm font-bold", isDanger ? "text-red-400" : "text-white/80")}>{value}</span>
    </div>
  );
}

function RelationshipMeterWidget({ widget }: { widget: HudWidget }) {
  const { value = 0, max = 100 } = widget.config;
  const milestones = Array.isArray(widget.config.milestones) ? widget.config.milestones : [];
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const accent = widget.accent ?? "#ec4899";

  // Find current milestone
  const currentMilestone = [...milestones].sort((a, b) => b.at - a.at).find((m) => value >= m.at);

  return (
    <div>
      {currentMilestone && (
        <p className="mb-1.5 text-center text-[0.5625rem] font-medium" style={{ color: accent }}>
          {currentMilestone.label}
        </p>
      )}
      <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}80, ${accent})`,
          }}
        />
        {/* Milestone markers */}
        {milestones.map((m, i) => (
          <div
            key={`${m.at}-${i}`}
            className="absolute top-0 h-full w-0.5 bg-white/20"
            style={{ left: `${(m.at / Math.max(1, max)) * 100}%` }}
            title={m.label}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[0.5rem] text-white/30">
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function CounterWidget({ widget }: { widget: HudWidget }) {
  const { count = 0 } = widget.config;
  const accent = widget.accent ?? "#f59e0b";

  return (
    <div className="flex items-center justify-center py-1">
      <span className="text-2xl font-bold tabular-nums" style={{ color: accent }}>
        {count}
      </span>
    </div>
  );
}

function StatBlockWidget({ widget }: { widget: HudWidget }) {
  const rawStats = widget.config.stats;
  const stats = Array.isArray(rawStats) ? rawStats : [];
  const accent = widget.accent ?? "#6366f1";

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {stats.map((s, i) => (
        <div key={s.name ?? i} className="flex items-center justify-between text-[0.5625rem]">
          <span className="text-white/50">{s.name}</span>
          <span className="font-mono font-bold" style={{ color: accent }}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ListWidget({ widget }: { widget: HudWidget }) {
  const rawItems = widget.config.items;
  const items = Array.isArray(rawItems) ? rawItems : [];

  return (
    <div className="space-y-0.5">
      {items.length === 0 ? (
        <p className="text-[0.5625rem] italic text-white/30">Empty</p>
      ) : (
        items.slice(0, 8).map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[0.5625rem]">
            <span className="text-white/20">*</span>
            <span className="text-white/70">{item}</span>
          </div>
        ))
      )}
    </div>
  );
}

function InventoryGridWidget({ widget }: { widget: HudWidget }) {
  const { slots = 8 } = widget.config;
  const categories = Array.isArray(widget.config.categories) ? widget.config.categories : [];
  const contents = Array.isArray(widget.config.contents) ? widget.config.contents : [];
  const accent = widget.accent ?? "#a78bfa";
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = activeCategory ? contents.filter((c) => c.slot === activeCategory) : contents;

  return (
    <div>
      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="mb-1.5 flex gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[0.5rem] transition-colors",
              !activeCategory ? "bg-white/15 text-white/80" : "text-white/40 hover:text-white/60",
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[0.5rem] capitalize transition-colors",
                activeCategory === cat ? "bg-white/15 text-white/80" : "text-white/40 hover:text-white/60",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-4 gap-1">
        {Array.from({ length: Math.min(slots, 16) }).map((_, i) => {
          const item = filtered[i];
          return (
            <div
              key={i}
              className={cn(
                "flex aspect-square items-center justify-center rounded border text-[0.5rem]",
                item ? "border-white/15 bg-white/5" : "border-white/5 bg-white/[0.02]",
              )}
              title={item?.name}
            >
              {item ? (
                <div className="flex w-full flex-col items-center overflow-hidden px-0.5 text-center">
                  <span className="w-full truncate text-white/70">{item.name}</span>
                  {item.quantity && item.quantity > 1 && (
                    <span className="text-[0.4375rem]" style={{ color: accent }}>
                      x{item.quantity}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimerWidget({ widget }: { widget: HudWidget }) {
  const { seconds = 0, running = false } = widget.config;
  const accent = widget.accent ?? "#ef4444";
  const [displaySeconds, setDisplaySeconds] = useState(seconds);
  const prevSecondsRef = useRef(seconds);

  // Reset display when the server-provided seconds value changes
  useEffect(() => {
    if (seconds !== prevSecondsRef.current) {
      setDisplaySeconds(seconds);
      prevSecondsRef.current = seconds;
    }
  }, [seconds]);

  // Count down when running
  useEffect(() => {
    if (!running || displaySeconds <= 0) return;
    const interval = setInterval(() => {
      setDisplaySeconds((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, displaySeconds]);

  const mins = Math.floor(displaySeconds / 60);
  const secs = displaySeconds % 60;

  return (
    <div className="flex items-center justify-center gap-1 py-1">
      {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />}
      <span className={cn("font-mono text-xl font-bold", running ? "animate-pulse" : "")} style={{ color: accent }}>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
    </div>
  );
}
