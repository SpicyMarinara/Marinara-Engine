// ──────────────────────────────────────────────
// Combat Encounter Modal — Full turn-based combat UI
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo, Component, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Swords,
  Shield,
  X,
  Flag,
  Loader2,
  AlertTriangle,
  Trophy,
  Skull,
  PersonStanding,
  Send,
  Crosshair,
  Sparkles,
  FlaskConical,
  RefreshCw,
  Zap,
  Wand2,
} from "lucide-react";
import { useEncounterStore } from "../../stores/encounter.store";
import { useEncounter } from "../../hooks/use-encounter";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import type { CombatPartyMember, CombatEnemy, CombatAttack, NarrativeStyle, Lorebook } from "@marinara-engine/shared";

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function HPBar({ current, max, isParty }: { current: number; max: number; isParty?: boolean }) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100));
  const isDead = current <= 0;
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10">
      <motion.div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          isDead
            ? "bg-gray-600"
            : isParty
              ? pct > 50
                ? "bg-emerald-500"
                : pct > 25
                  ? "bg-yellow-500"
                  : "bg-red-500"
              : pct > 50
                ? "bg-red-500"
                : pct > 25
                  ? "bg-orange-500"
                  : "bg-red-300",
        )}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[0.625rem] font-bold text-white drop-shadow-sm">
        {current}/{max}
      </span>
    </div>
  );
}

function StatusBadges({ statuses }: { statuses: Array<{ name: string; emoji: string; duration: number }> }) {
  if (!statuses?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {statuses.map((s, i) => (
        <span
          key={i}
          title={`${s.name} (${s.duration} turns)`}
          className="rounded-md bg-white/10 px-1.5 py-0.5 text-[0.625rem]"
        >
          {s.emoji} {s.duration}
        </span>
      ))}
    </div>
  );
}

function EnemyCard({ enemy, index: _index, isDead }: { enemy: CombatEnemy; index: number; isDead: boolean }) {
  return (
    <motion.div
      layout
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all",
        isDead
          ? "border-white/5 bg-white/5 opacity-40 grayscale"
          : "border-red-500/20 bg-red-500/5 hover:border-red-500/40",
      )}
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: isDead ? 0.4 : 1, y: 0 }}
    >
      <div className="text-2xl">{enemy.sprite || "👹"}</div>
      <h4 className="text-xs font-bold text-white/90">{enemy.name}</h4>
      <div className="w-full">
        <HPBar current={enemy.hp} max={enemy.maxHp} />
      </div>
      <StatusBadges statuses={enemy.statuses} />
      {enemy.description && <p className="mt-1 text-[0.625rem] leading-tight text-white/40">{enemy.description}</p>}
      {isDead && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
          <Skull size="1.25rem" className="text-red-400/60" />
        </div>
      )}
    </motion.div>
  );
}

function PartyCard({ member }: { member: CombatPartyMember }) {
  const isDead = member.hp <= 0;
  return (
    <motion.div
      layout
      className={cn(
        "relative flex items-center gap-3 rounded-xl border p-3 transition-all",
        isDead
          ? "border-white/5 bg-white/5 opacity-40 grayscale"
          : member.isPlayer
            ? "border-blue-500/20 bg-blue-500/5"
            : "border-emerald-500/20 bg-emerald-500/5",
      )}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: isDead ? 0.4 : 1, y: 0 }}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          member.isPlayer ? "bg-blue-500/20 text-blue-300" : "bg-emerald-500/20 text-emerald-300",
        )}
      >
        {member.name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-xs font-bold text-white/90">
          {member.name} {member.isPlayer && <span className="text-blue-400">(You)</span>}
        </h4>
        <HPBar current={member.hp} max={member.maxHp} isParty />
        <StatusBadges statuses={member.statuses} />
      </div>
      {isDead && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
          <Skull size="1rem" className="text-red-400/60" />
        </div>
      )}
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Target Selection Overlay
// ──────────────────────────────────────────────

interface TargetSelectionProps {
  attackType: string;
  enemies: CombatEnemy[];
  party: CombatPartyMember[];
  onSelect: (target: string) => void;
  onCancel: () => void;
}

function TargetSelection({ attackType, enemies, party, onSelect, onCancel }: TargetSelectionProps) {
  return (
    <motion.div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="w-80 max-w-[90vw] rounded-2xl border border-white/10 bg-[#1a1a2e] p-5 shadow-2xl"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white/90">
          <Crosshair size="1rem" className="text-red-400" />
          Select Target
        </h3>

        <div className="flex flex-col gap-2">
          {/* AoE option */}
          {(attackType === "AoE" || attackType === "both") && (
            <button
              onClick={() => onSelect("all-enemies")}
              className="flex items-center gap-3 rounded-xl border border-orange-500/20 bg-orange-500/10 p-3 text-left transition-all hover:border-orange-500/40 hover:bg-orange-500/20"
            >
              <span className="text-lg">💥</span>
              <div>
                <div className="text-xs font-bold text-white/90">All Enemies</div>
                <div className="text-[0.625rem] text-white/40">Area of Effect</div>
              </div>
            </button>
          )}

          {attackType === "both" && (
            <div className="py-1 text-center text-[0.625rem] font-bold uppercase tracking-wider text-white/20">or</div>
          )}

          {/* Individual enemies */}
          {attackType !== "AoE" &&
            enemies
              .filter((e) => e.hp > 0)
              .map((enemy, i) => (
                <button
                  key={i}
                  onClick={() => onSelect(enemy.name)}
                  className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-left transition-all hover:border-red-500/40 hover:bg-red-500/15"
                >
                  <span className="text-lg">{enemy.sprite || "👹"}</span>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white/90">{enemy.name}</div>
                    <div className="text-[0.625rem] text-white/40">
                      {enemy.hp}/{enemy.maxHp} HP
                    </div>
                  </div>
                </button>
              ))}

          {/* Party members (for heals/buffs) */}
          {attackType !== "AoE" &&
            party
              .filter((m) => m.hp > 0)
              .map((member, i) => (
                <button
                  key={`party-${i}`}
                  onClick={() => onSelect(member.name)}
                  className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-left transition-all hover:border-emerald-500/40 hover:bg-emerald-500/15"
                >
                  <span className="text-lg">✨</span>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white/90">
                      {member.name} {member.isPlayer && "(You)"}
                    </div>
                    <div className="text-[0.625rem] text-white/40">
                      {member.hp}/{member.maxHp} HP
                    </div>
                  </div>
                </button>
              ))}
        </div>

        <button
          onClick={onCancel}
          className="mt-3 w-full rounded-xl border border-white/10 py-2 text-xs text-white/50 hover:bg-white/5"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Config Modal
// ──────────────────────────────────────────────

function NarrativeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: NarrativeStyle;
  onChange: (v: NarrativeStyle) => void;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold text-white/70">{label}</h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select
          value={value.tense}
          onChange={(e) => onChange({ ...value, tense: e.target.value as any })}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
        >
          <option value="present">Present Tense</option>
          <option value="past">Past Tense</option>
        </select>
        <select
          value={value.person}
          onChange={(e) => onChange({ ...value, person: e.target.value as any })}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
        >
          <option value="first">First Person</option>
          <option value="second">Second Person</option>
          <option value="third">Third Person</option>
        </select>
        <select
          value={value.narration}
          onChange={(e) => onChange({ ...value, narration: e.target.value as any })}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
        >
          <option value="omniscient">Omniscient</option>
          <option value="limited">Limited</option>
        </select>
        <input
          value={value.pov}
          onChange={(e) => onChange({ ...value, pov: e.target.value })}
          placeholder="narrator"
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80 placeholder:text-white/30"
        />
      </div>
    </div>
  );
}

function EncounterConfig() {
  const settings = useEncounterStore((s) => s.settings);
  const updateSettings = useEncounterStore((s) => s.updateSettings);
  const closeConfigModal = useEncounterStore((s) => s.closeConfigModal);
  const spellbookId = useEncounterStore((s) => s.spellbookId);
  const setSpellbookId = useEncounterStore((s) => s.setSpellbookId);
  const { initEncounter } = useEncounter();

  const { data: lorebooks } = useLorebooks("spellbook");
  const spellbooks = (lorebooks ?? []) as Lorebook[];

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={closeConfigModal}
    >
      <motion.div
        className="w-[26.25rem] max-w-[95vw] rounded-2xl border border-white/10 bg-[#1a1a2e] p-5 sm:p-6 shadow-2xl"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 flex items-center gap-2 text-base font-bold text-white/90">
          <Swords size="1.125rem" className="text-red-400" />
          Configure Combat Narrative
        </h2>

        <div className="space-y-5">
          <NarrativeSelect
            label="⚔️ Combat Narration"
            value={settings.combatNarrative}
            onChange={(v) => updateSettings({ combatNarrative: v })}
          />

          <NarrativeSelect
            label="📜 Summary Narration"
            value={settings.summaryNarrative}
            onChange={(v) => updateSettings({ summaryNarrative: v })}
          />

          {/* Spellbook selection */}
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-white/70">
              <Wand2 size="0.75rem" className="text-indigo-400" />
              Spellbook
            </h4>
            <p className="text-[0.625rem] leading-relaxed text-white/40">
              Attach a spellbook so the AI knows which spells and abilities are available in combat.
            </p>
            <select
              value={spellbookId ?? ""}
              onChange={(e) => setSpellbookId(e.target.value || null)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
            >
              <option value="">None</option>
              {spellbooks.map((lb) => (
                <option key={lb.id} value={lb.id}>
                  {lb.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={closeConfigModal}
            className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-medium text-white/50 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={() => initEncounter(settings)}
            className="flex-1 rounded-xl bg-gradient-to-r from-red-600 to-orange-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 transition-all hover:shadow-xl hover:shadow-red-500/30 active:scale-95"
          >
            <Swords size="0.875rem" className="mr-1.5 inline" />
            Begin Combat
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Combat Log
// ──────────────────────────────────────────────

function CombatLog() {
  const pendingLogs = useEncounterStore((s) => s.pendingLogs);
  const clearPendingLogs = useEncounterStore((s) => s.clearPendingLogs);
  const [entries, setEntries] = useState<Array<{ message: string; type: string }>>([
    { message: "Combat begins!", type: "system" },
  ]);
  const logRef = useRef<HTMLDivElement>(null);

  // Animate pending logs in sequentially
  useEffect(() => {
    if (!pendingLogs.length) return;
    let i = 0;
    const interval = setInterval(() => {
      if (i < pendingLogs.length) {
        const entry = pendingLogs[i];
        i++;
        if (entry) setEntries((prev) => [...prev, entry]);
      } else {
        clearInterval(interval);
        clearPendingLogs();
      }
    }, 350);
    return () => clearInterval(interval);
  }, [pendingLogs, clearPendingLogs]);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      ref={logRef}
      className="scrollbar-thin max-h-40 overflow-y-auto rounded-xl border border-white/5 bg-black/30 p-3"
    >
      <AnimatePresence>
        {entries.map(
          (e, i) =>
            e && (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "mb-1 whitespace-pre-wrap text-xs leading-relaxed",
                  e.type === "system" && "italic text-white/30",
                  e.type === "player-action" && "font-semibold text-blue-300",
                  e.type === "enemy-action" && "text-red-300",
                  e.type === "party-action" && "text-emerald-300",
                  e.type === "narrative" && "text-white/70",
                )}
              >
                {e.message}
              </motion.div>
            ),
        )}
      </AnimatePresence>
    </div>
  );
}

// ──────────────────────────────────────────────
// Player Controls
// ──────────────────────────────────────────────

function PlayerControls({ onAction }: { onAction: (text: string) => void }) {
  const playerActions = useEncounterStore((s) => s.playerActions);
  const isProcessing = useEncounterStore((s) => s.isProcessing);
  const party = useEncounterStore((s) => s.party);
  const enemies = useEncounterStore((s) => s.enemies);
  const [customInput, setCustomInput] = useState("");
  const [targetSelection, setTargetSelection] = useState<{
    attackName: string;
    attackType: string;
  } | null>(null);

  if (!Array.isArray(party) || party.length === 0) {
    return (
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-center">
        <AlertTriangle size="1.5rem" className="mx-auto mb-2 text-yellow-400" />
        <p className="text-xs text-yellow-300">Waiting for combat data...</p>
      </div>
    );
  }

  const player = party.find((m) => m.isPlayer);
  if (!player || player.hp <= 0) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
        <Skull size="1.5rem" className="mx-auto mb-2 text-red-400" />
        <p className="text-xs text-red-300">You have been defeated...</p>
      </div>
    );
  }

  const attacks = Array.isArray(playerActions?.attacks)
    ? playerActions.attacks
    : Array.isArray(player.attacks)
      ? player.attacks
      : [];
  const items = Array.isArray(playerActions?.items)
    ? playerActions.items
    : Array.isArray(player.items)
      ? player.items
      : [];

  const handleAttack = (attack: CombatAttack) => {
    setTargetSelection({ attackName: attack.name, attackType: attack.type });
  };

  const handleItem = (item: string) => {
    setTargetSelection({ attackName: item, attackType: "single-target" });
  };

  const handleTargetSelected = (target: string) => {
    if (!targetSelection) return;
    const { attackName } = targetSelection;
    const actionText =
      target === "all-enemies" ? `Uses ${attackName} targeting all enemies!` : `Uses ${attackName} on ${target}!`;
    setTargetSelection(null);
    onAction(actionText);
  };

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return;
    onAction(customInput.trim());
    setCustomInput("");
  };

  const typeIcon = (t: string) => (t === "AoE" ? "💥" : t === "both" ? "⚡" : "🎯");

  return (
    <>
      <div className="space-y-3 rounded-xl border border-white/5 bg-white/5 p-4">
        <h3 className="flex items-center gap-2 text-xs font-bold text-white/70">
          <Zap size="0.875rem" className="text-yellow-400" />
          Your Actions
        </h3>

        {/* Attacks */}
        {attacks.length > 0 && (
          <div>
            <div className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-white/30">Attacks</div>
            <div className="flex flex-wrap gap-1.5">
              {attacks.map((atk, i) => (
                <button
                  key={i}
                  disabled={isProcessing}
                  onClick={() => handleAttack(atk)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-all hover:border-red-500/40 hover:bg-red-500/20 disabled:opacity-30"
                >
                  <Swords size="0.75rem" />
                  {atk.name}
                  <span className="text-[0.625rem] opacity-60">{typeIcon(atk.type)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Items */}
        {items.length > 0 && (
          <div>
            <div className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-white/30">Items</div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((item, i) => (
                <button
                  key={i}
                  disabled={isProcessing}
                  onClick={() => handleItem(item)}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-30"
                >
                  <FlaskConical size="0.75rem" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom action */}
        <div>
          <div className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-white/30">
            Custom Action
          </div>
          <div className="flex gap-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isProcessing && handleCustomSubmit()}
              placeholder="Describe what you do..."
              disabled={isProcessing}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 disabled:opacity-30"
            />
            <button
              onClick={handleCustomSubmit}
              disabled={isProcessing || !customInput.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-30"
            >
              <Send size="0.875rem" />
            </button>
          </div>
        </div>
      </div>

      {/* Target selection overlay */}
      <AnimatePresence>
        {targetSelection && (
          <TargetSelection
            attackType={targetSelection.attackType}
            enemies={enemies}
            party={party}
            onSelect={handleTargetSelected}
            onCancel={() => setTargetSelection(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ──────────────────────────────────────────────
// Combat End Screen
// ──────────────────────────────────────────────

function CombatEndScreen() {
  const combatResult = useEncounterStore((s) => s.combatResult);
  const summaryStatus = useEncounterStore((s) => s.summaryStatus);
  const { closeEncounter } = useEncounter();

  const config: Record<string, { icon: typeof Trophy; color: string; label: string }> = {
    victory: { icon: Trophy, color: "text-emerald-400", label: "VICTORY" },
    defeat: { icon: Skull, color: "text-red-400", label: "DEFEAT" },
    fled: { icon: PersonStanding, color: "text-orange-400", label: "FLED" },
    interrupted: { icon: Flag, color: "text-gray-400", label: "INTERRUPTED" },
  };

  const c = config[combatResult ?? "interrupted"];
  const Icon = c.icon;

  return (
    <motion.div
      className="flex flex-col items-center justify-center py-12"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Icon size="4rem" className={cn(c.color, "mb-4")} />
      <h2 className={cn("mb-2 text-3xl font-black uppercase tracking-wider", c.color)}>{c.label}</h2>

      {summaryStatus === "generating" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-white/50">
          <Loader2 size="1rem" className="animate-spin" />
          Generating combat summary...
        </div>
      )}

      {summaryStatus === "done" && (
        <>
          <p className="mt-2 text-sm text-white/50">Combat summary has been added to the chat.</p>
          <button
            onClick={closeEncounter}
            className="mt-6 rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white/80 transition-all hover:bg-white/20"
          >
            Close Combat Window
          </button>
        </>
      )}

      {summaryStatus === "error" && (
        <>
          <p className="mt-2 text-sm text-red-400">Failed to generate summary.</p>
          <button
            onClick={closeEncounter}
            className="mt-6 rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white/80 transition-all hover:bg-white/20"
          >
            Close Anyway
          </button>
        </>
      )}
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Main Modal
// ──────────────────────────────────────────────

function EncounterModalInner() {
  const active = useEncounterStore((s) => s.active);
  const showConfigModal = useEncounterStore((s) => s.showConfigModal);
  const initialized = useEncounterStore((s) => s.initialized);
  const isLoading = useEncounterStore((s) => s.isLoading);
  const isProcessing = useEncounterStore((s) => s.isProcessing);
  const error = useEncounterStore((s) => s.error);
  const party = useEncounterStore((s) => s.party);
  const enemies = useEncounterStore((s) => s.enemies);
  const environment = useEncounterStore((s) => s.environment);
  const styleNotes = useEncounterStore((s) => s.styleNotes);
  const combatResult = useEncounterStore((s) => s.combatResult);
  const { sendAction, concludeEncounter, closeEncounter, initEncounter } = useEncounter();
  const settings = useEncounterStore((s) => s.settings);

  const handleAction = useCallback(
    (text: string) => {
      // Append player action to local log display
      useEncounterStore.setState((s) => ({
        pendingLogs: [...s.pendingLogs, { message: `You: ${text}`, type: "player-action" }],
      }));
      sendAction(text);
    },
    [sendAction],
  );

  // Environment-based gradient
  const envGradient = useMemo(() => {
    const t = styleNotes?.environmentType?.toLowerCase() ?? "default";
    const grads: Record<string, string> = {
      forest: "from-green-950/80 to-emerald-900/60",
      dungeon: "from-gray-950/80 to-purple-950/60",
      desert: "from-amber-950/80 to-orange-900/60",
      cave: "from-slate-950/80 to-gray-900/60",
      city: "from-zinc-950/80 to-slate-900/60",
      ruins: "from-stone-950/80 to-amber-950/60",
      snow: "from-blue-950/80 to-cyan-900/60",
      water: "from-blue-950/80 to-teal-900/60",
      castle: "from-purple-950/80 to-indigo-900/60",
      wasteland: "from-amber-950/80 to-red-950/60",
      plains: "from-lime-950/80 to-green-900/60",
      mountains: "from-slate-950/80 to-blue-950/60",
      swamp: "from-green-950/80 to-yellow-950/60",
      volcanic: "from-red-950/80 to-orange-950/60",
      spaceship: "from-indigo-950/80 to-violet-900/60",
      mansion: "from-rose-950/80 to-pink-900/60",
    };
    return grads[t] ?? "from-slate-950/80 to-indigo-950/60";
  }, [styleNotes]);

  return (
    <AnimatePresence>
      {/* Config Modal */}
      {showConfigModal && <EncounterConfig />}

      {/* Main Combat Modal */}
      {active && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center max-md:pt-[env(safe-area-inset-top)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            className={cn(
              "relative flex h-[85dvh] w-[37.5rem] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b shadow-2xl",
              envGradient,
            )}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", bounce: 0.2 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 bg-black/30 px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white/90">
                <Swords size="1rem" className="text-red-400" />
                Combat Encounter
              </h2>
              <div className="flex items-center gap-2">
                {initialized && !combatResult && (
                  <button
                    onClick={async () => {
                      if (
                        await showConfirmDialog({
                          title: "Conclude Encounter",
                          message: "Conclude this encounter early?",
                          confirmLabel: "Conclude",
                          tone: "destructive",
                        })
                      ) {
                        concludeEncounter();
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[0.6875rem] text-white/50 transition-all hover:bg-white/10"
                  >
                    <Flag size="0.75rem" />
                    Conclude
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (
                      await showConfirmDialog({
                        title: "End Combat",
                        message: "Close and end this combat?",
                        confirmLabel: "End Combat",
                        tone: "destructive",
                      })
                    ) {
                      closeEncounter();
                    }
                  }}
                  className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white/80"
                >
                  <X size="1rem" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
              {/* Loading state */}
              {isLoading && !initialized && (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <Loader2 size="2rem" className="animate-spin text-red-400" />
                  <p className="text-sm text-white/50">Initializing combat encounter...</p>
                </div>
              )}

              {/* Error state */}
              {error && !initialized && (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <AlertTriangle size="2rem" className="text-red-400" />
                  <p className="max-w-sm text-center text-sm text-red-300">{error}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => initEncounter(settings)}
                      className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-medium text-white"
                    >
                      <RefreshCw size="0.75rem" />
                      Retry
                    </button>
                    <button
                      onClick={closeEncounter}
                      className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/50 hover:bg-white/5"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              {/* Combat end screen */}
              {combatResult && <CombatEndScreen />}

              {/* Active combat */}
              {initialized && !combatResult && (
                <div className="space-y-4">
                  {/* Environment */}
                  <div className="rounded-xl bg-white/5 p-3 text-center text-xs text-white/50">
                    🏔️ {environment || "Battle Arena"}
                  </div>

                  {/* Enemies */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-400">
                      <Skull size="0.875rem" />
                      Enemies
                    </h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {Array.isArray(enemies) &&
                        enemies.map((enemy, i) => <EnemyCard key={i} enemy={enemy} index={i} isDead={enemy.hp <= 0} />)}
                    </div>
                  </div>

                  {/* Party */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-blue-400">
                      <Shield size="0.875rem" />
                      Party
                    </h3>
                    <div className="space-y-2">
                      {Array.isArray(party) && party.map((member, i) => <PartyCard key={i} member={member} />)}
                    </div>
                  </div>

                  {/* Combat Log */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white/50">
                      <Sparkles size="0.875rem" />
                      Combat Log
                    </h3>
                    <CombatLog />
                  </div>

                  {/* Processing indicator */}
                  {isProcessing && (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-white/40">
                      <Loader2 size="0.875rem" className="animate-spin" />
                      Processing action...
                    </div>
                  )}

                  {/* Player Controls */}
                  {!isProcessing && <PlayerControls onAction={handleAction} />}

                  {/* Error during combat */}
                  {error && initialized && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-center text-xs text-red-300">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Error boundary to prevent combat crashes from black-screening the app ──
class EncounterErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center max-md:pt-[env(safe-area-inset-top)]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative flex max-w-md flex-col items-center gap-4 rounded-2xl border border-red-500/20 bg-gray-950 p-8 shadow-2xl">
            <AlertTriangle size="2.5rem" className="text-red-400" />
            <h3 className="text-sm font-bold text-white/90">Combat Error</h3>
            <p className="text-center text-xs text-white/50">
              Something went wrong during combat. This is usually caused by the AI returning unexpected data.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onReset();
              }}
              className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-medium text-white transition-all hover:bg-red-500"
            >
              Close Encounter
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function EncounterModal() {
  const { closeEncounter } = useEncounter();
  return (
    <EncounterErrorBoundary onReset={closeEncounter}>
      <EncounterModalInner />
    </EncounterErrorBoundary>
  );
}
