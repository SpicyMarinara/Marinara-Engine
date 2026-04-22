// ──────────────────────────────────────────────
// Panel: Agents & Tools
// ──────────────────────────────────────────────
import { useState } from "react";
import { Sparkles, Pencil, Plus, Wrench, ChevronDown, Trash2, Regex, PenLine, Radar, Puzzle } from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import { useAgentConfigs, useDeleteAgent, type AgentConfigRow } from "../../hooks/use-agents";
import { useCustomTools, useDeleteCustomTool, type CustomToolRow } from "../../hooks/use-custom-tools";
import {
  useRegexScripts,
  useDeleteRegexScript,
  useCreateRegexScript,
  type RegexScriptRow,
} from "../../hooks/use-regex-scripts";
import { BUILT_IN_AGENTS, type AgentCategory } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";

export function AgentsPanel() {
  const { data: agentConfigs, isLoading } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const { data: regexScripts } = useRegexScripts();
  const deleteAgent = useDeleteAgent();
  const deleteTool = useDeleteCustomTool();
  const deleteRegex = useDeleteRegexScript();
  const openAgentDetail = useUIStore((s) => s.openAgentDetail);
  const openToolDetail = useUIStore((s) => s.openToolDetail);
  const openRegexDetail = useUIStore((s) => s.openRegexDetail);
  const createRegexScript = useCreateRegexScript();
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"category" | "status">("category");

  // Handler for importing regex scripts from JSON (supports ST format and native)
  const handleImportRegex = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept a single object or an array
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) throw new Error("No regex scripts found in file");
      let imported = 0;
      for (const obj of arr) {
        // Resolve name: ST uses scriptName, native uses name
        const name = obj.name || obj.scriptName;
        // ST wraps regex in /delimiters/flags — extract pattern and flags
        let findRegex = obj.findRegex ?? "";
        let flags = obj.flags ?? "gi";
        const delimited = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
        if (delimited) {
          findRegex = delimited[1];
          flags = delimited[2] || "g";
        }
        if (!name || !findRegex) continue;
        // ST placement uses numbers: 1 = user_input, 2 = ai_output
        const stPlacementMap: Record<number, string> = { 1: "user_input", 2: "ai_output" };
        let placement: string[] = ["ai_output"];
        if (Array.isArray(obj.placement)) {
          const mapped = obj.placement
            .map((p: unknown) => (typeof p === "number" ? stPlacementMap[p] : p))
            .filter((p: unknown): p is string => p === "ai_output" || p === "user_input");
          if (mapped.length > 0) placement = mapped;
        }
        // ST uses disabled (inverted), native uses enabled
        let enabled = true;
        if (typeof obj.enabled === "boolean") enabled = obj.enabled;
        else if (typeof obj.enabled === "string") enabled = obj.enabled !== "false";
        else if (typeof obj.disabled === "boolean") enabled = !obj.disabled;

        await createRegexScript.mutateAsync({
          name,
          enabled,
          findRegex,
          replaceString: obj.replaceString ?? "",
          trimStrings: obj.trimStrings ?? [],
          placement,
          flags,
          promptOnly: obj.promptOnly ?? false,
          order: obj.order ?? 0,
          minDepth: obj.minDepth ?? null,
          maxDepth: obj.maxDepth ?? null,
        });
        imported++;
      }
      setImportSuccess(`Imported ${imported} regex script(s).`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import regex scripts");
    }
    event.target.value = ""; // reset file input
  };

  // Custom agents = DB entries whose type doesn't match any built-in
  const customAgents = ((agentConfigs ?? []) as AgentConfigRow[]).filter(
    (c) => !BUILT_IN_AGENTS.some((b) => b.id === c.type),
  );
  const configByType = new Map(((agentConfigs ?? []) as AgentConfigRow[]).map((config) => [config.type, config]));

  const statusAgents = [
    ...BUILT_IN_AGENTS.map((agent) => ({
      id: agent.id,
      type: agent.id,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      enabled: configByType.get(agent.id)?.enabled !== "false",
      custom: false,
    })),
    ...customAgents.map((agent) => ({
      id: agent.id,
      type: agent.type,
      name: agent.name,
      description: agent.description,
      category: "custom" as const,
      enabled: agent.enabled !== "false",
      custom: true,
    })),
  ];

  const activeAgents = statusAgents.filter((agent) => agent.enabled);
  const inactiveAgents = statusAgents.filter((agent) => !agent.enabled);

  const handleCreateAgent = () => {
    // Create a new custom agent immediately in DB then open editor
    openAgentDetail("__new__");
  };

  const handleCreateTool = () => {
    openToolDetail("__new__");
  };

  const handleCreateRegex = () => {
    openRegexDetail("__new__");
  };

  return (
    <div className="flex flex-col gap-1 p-3">
      {isLoading && <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">Loading...</div>}

      <div className="mb-1 flex items-center gap-1 rounded-lg bg-[var(--secondary)] p-1 ring-1 ring-[var(--border)]">
        <button
          onClick={() => setViewMode("category")}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[0.625rem] font-medium transition-all",
            viewMode === "category"
              ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/25"
              : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          By Category
        </button>
        <button
          onClick={() => setViewMode("status")}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[0.625rem] font-medium transition-all",
            viewMode === "status"
              ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/25"
              : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          By Status
        </button>
      </div>

      {/* ── Regex Scripts (moved to top) ── */}
      <PanelSection
        title="Regex Scripts"
        icon={<Regex size="0.8125rem" />}
        action={
          <div className="flex items-center gap-1">
            <button
              onClick={handleCreateRegex}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
              title="Create regex script"
            >
              <Plus size="0.8125rem" />
            </button>
            <label
              className="inline-flex items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] cursor-pointer"
              title="Import regex scripts from JSON"
            >
              <input type="file" accept="application/json" className="hidden" onChange={handleImportRegex} />
              <svg
                width="0.9375rem"
                height="0.9375rem"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 3v10m0 0l-4-4m4 4l4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x="3" y="17" width="14" height="2" rx="1" fill="currentColor" />
              </svg>
            </label>
          </div>
        }
      >
        <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
          Find/replace patterns applied to AI output or user input — like SillyTavern regex scripts.
        </div>
        {importError && <div className="text-xs text-red-500 mb-1">{importError}</div>}
        {importSuccess && <div className="text-xs text-green-500 mb-1">{importSuccess}</div>}
        {!regexScripts || (regexScripts as RegexScriptRow[]).length === 0 ? (
          <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No regex scripts yet.</p>
        ) : (
          (regexScripts as RegexScriptRow[]).map((script) => {
            const placements = (() => {
              try {
                return JSON.parse(script.placement) as string[];
              } catch {
                return [];
              }
            })();
            const enabled = script.enabled === "true";
            return (
              <div
                key={script.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                  !enabled && "opacity-50",
                )}
              >
                <Regex size="0.875rem" className="mt-0.5 shrink-0 text-orange-400" />
                <button className="min-w-0 flex-1 text-left" onClick={() => openRegexDetail(script.id)}>
                  <div className="text-xs font-medium">{script.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {placements.map((p: string) => (
                      <span
                        key={p}
                        className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]"
                      >
                        {p === "ai_output" ? "AI" : "User"}
                      </span>
                    ))}
                    <span className="text-[0.5625rem] text-[var(--muted-foreground)] font-mono truncate max-w-[6.25rem]">
                      /{script.findRegex}/{script.flags}
                    </span>
                  </div>
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                  title="Edit script"
                  onClick={() => openRegexDetail(script.id)}
                >
                  <Pencil size="0.8125rem" />
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                  title="Delete script"
                  onClick={async () => {
                    if (
                      await showConfirmDialog({
                        title: "Delete Regex Script",
                        message: `Delete "${script.name}"?`,
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })
                    ) {
                      deleteRegex.mutate(script.id);
                    }
                  }}
                >
                  <Trash2 size="0.8125rem" />
                </button>
              </div>
            );
          })
        )}
      </PanelSection>

      {viewMode === "category" ? (
        <>
          {/* ── Built-in Agents ── */}
          {[
            {
              category: "writer" as AgentCategory,
              title: "Writer Agents",
              icon: <PenLine size="0.8125rem" />,
              desc: "Prose quality, continuity, directions, and narrative flow.",
            },
            {
              category: "tracker" as AgentCategory,
              title: "Tracker Agents",
              icon: <Radar size="0.8125rem" />,
              desc: "Track world state, expressions, quests, backgrounds, and characters.",
            },
            {
              category: "misc" as AgentCategory,
              title: "Misc Agents",
              icon: <Puzzle size="0.8125rem" />,
              desc: "Utilities, combat, illustrations, and other helpers.",
            },
          ].map(({ category, title, icon, desc }) => {
            const agents = BUILT_IN_AGENTS.filter((a) => a.category === category);
            return (
              <PanelSection key={category} title={title} icon={icon}>
                <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">{desc}</div>
                {!agents.length ? (
                  <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">
                    No agents in this category.
                  </p>
                ) : (
                  agents.map((agent) =>
                    renderAgentCard({
                      id: agent.id,
                      type: agent.id,
                      name: agent.name,
                      description: agent.description,
                      category: agent.category,
                      enabled: configByType.get(agent.id)?.enabled !== "false",
                      custom: false,
                      openAgentDetail,
                    }),
                  )
                )}
              </PanelSection>
            );
          })}
        </>
      ) : (
        <>
          <PanelSection title="Enabled Agents" icon={<Sparkles size="0.8125rem" />}>
            <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
              Built-ins default to active unless explicitly disabled in their config.
            </div>
            {!activeAgents.length ? (
              <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No active agents.</p>
            ) : (
              activeAgents.map((agent) => renderAgentCard({ ...agent, openAgentDetail }))
            )}
          </PanelSection>
          <PanelSection title="Disabled Agents" icon={<Sparkles size="0.8125rem" />}>
            {!inactiveAgents.length ? (
              <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No inactive agents.</p>
            ) : (
              inactiveAgents.map((agent) => renderAgentCard({ ...agent, openAgentDetail }))
            )}
          </PanelSection>
        </>
      )}

      {viewMode === "category" && (
        <PanelSection
          title="Custom Agents"
          icon={<Sparkles size="0.8125rem" />}
          action={
            <button
              onClick={handleCreateAgent}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
              title="Create custom agent"
            >
              <Plus size="0.8125rem" />
            </button>
          }
        >
          <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
            Create your own AI agents with custom instructions and settings.
          </div>
          {!customAgents.length ? (
            <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No custom agents yet.</p>
          ) : (
            customAgents.map((agent) => {
              return (
                <div
                  key={agent.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                    agent.enabled === "false" && "opacity-55",
                  )}
                >
                  <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => openAgentDetail(agent.id)}>
                    <div className="text-xs font-medium font-mono">{agent.name}</div>
                    <div className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
                      {agent.description || "No description"}
                    </div>
                  </button>
                  <button
                    className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                    title="Edit agent"
                    onClick={() => openAgentDetail(agent.id)}
                  >
                    <Pencil size="0.8125rem" />
                  </button>
                  <button
                    className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                    title="Delete agent"
                    onClick={async () => {
                      if (
                        await showConfirmDialog({
                          title: "Delete Agent",
                          message: `Delete "${agent.name}"?`,
                          confirmLabel: "Delete",
                          tone: "destructive",
                        })
                      ) {
                        deleteAgent.mutate(agent.id);
                      }
                    }}
                  >
                    <Trash2 size="0.8125rem" />
                  </button>
                </div>
              );
            })
          )}
        </PanelSection>
      )}

      {/* ── Custom Function Tools ── */}
      <PanelSection
        title="Custom Tools"
        icon={<Wrench size="0.8125rem" />}
        action={
          <button
            onClick={handleCreateTool}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Create custom tool"
          >
            <Plus size="0.8125rem" />
          </button>
        }
      >
        <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
          Define custom functions the AI can call during generation (webhook, script, or static).
        </div>
        {!customTools || (customTools as CustomToolRow[]).length === 0 ? (
          <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No custom tools yet.</p>
        ) : (
          (customTools as CustomToolRow[]).map((tool) => (
            <div
              key={tool.id}
              className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <Wrench size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
              <button className="min-w-0 flex-1 text-left" onClick={() => openToolDetail(tool.id)}>
                <div className="text-xs font-medium font-mono">{tool.name}</div>
                <div className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
                  {tool.description || "No description"}
                </div>
              </button>
              <span className="mt-0.5 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                {tool.executionType}
              </span>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                title="Edit tool"
                onClick={() => openToolDetail(tool.id)}
              >
                <Pencil size="0.8125rem" />
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                title="Delete tool"
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: "Delete Tool",
                      message: `Delete "${tool.name}"?`,
                      confirmLabel: "Delete",
                      tone: "destructive",
                    })
                  ) {
                    deleteTool.mutate(tool.id);
                  }
                }}
              >
                <Trash2 size="0.8125rem" />
              </button>
            </div>
          ))
        )}
      </PanelSection>
    </div>
  );
}

function renderAgentCard({
  id,
  type,
  name,
  description,
  category,
  enabled,
  custom,
  openAgentDetail,
}: {
  id: string;
  type: string;
  name: string;
  description: string;
  category: AgentCategory | "custom";
  enabled: boolean;
  custom: boolean;
  openAgentDetail: (id: string) => void;
}) {
  return (
    <div
      key={id}
      className={cn(
        "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
        !enabled && "opacity-55",
      )}
    >
      <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
      <button className="min-w-0 flex-1 text-left" onClick={() => openAgentDetail(custom ? id : type)}>
        <div className="truncate text-xs font-medium font-mono">{name}</div>
        <div className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
          {description || "No description"}
        </div>
        <div className="mt-1 text-[0.5625rem] uppercase tracking-wide text-[var(--muted-foreground)]/80">
          {custom ? "custom" : category}
        </div>
      </button>
      <button
        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
        title="Edit agent"
        onClick={() => openAgentDetail(custom ? id : type)}
      >
        <Pencil size="0.8125rem" />
      </button>
    </div>
  );
}

// ── Collapsible section ──
function PanelSection({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border)] pb-1 mb-1 last:border-b-0">
      <div className="flex items-center gap-1.5 px-1 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-left">
          <span className="text-[var(--muted-foreground)]">{icon}</span>
          <span className="text-[0.6875rem] font-semibold">{title}</span>
          <ChevronDown
            size="0.6875rem"
            className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
          />
        </button>
        {action}
      </div>
      {open && <div className="px-0.5">{children}</div>}
    </div>
  );
}
