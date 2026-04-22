// ──────────────────────────────────────────────
// Full-Page Custom Tool Editor
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useMemo } from "react";
import { useUIStore } from "../../stores/ui.store";
import { showConfirmDialog } from "../../lib/app-dialogs";
import {
  useCustomTools,
  useCreateCustomTool,
  useUpdateCustomTool,
  useDeleteCustomTool,
  type CustomToolRow,
} from "../../hooks/use-custom-tools";
import {
  ArrowLeft,
  Save,
  Wrench,
  Check,
  AlertCircle,
  X,
  Info,
  Globe,
  FileText,
  Code2,
  Trash2,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";

const EXEC_TYPES = [
  { value: "static", label: "Static Result", icon: FileText, description: "Returns a fixed string when called." },
  { value: "webhook", label: "Webhook", icon: Globe, description: "Sends a POST request to an external URL." },
  { value: "script", label: "Script", icon: Code2, description: "Runs a JavaScript expression server-side." },
] as const;

// ═══════════════════════════════════════════════
//  Main Editor
// ═══════════════════════════════════════════════
export function ToolEditor() {
  const toolDetailId = useUIStore((s) => s.toolDetailId);
  const closeToolDetail = useUIStore((s) => s.closeToolDetail);

  const { data: allTools } = useCustomTools();
  const createTool = useCreateCustomTool();
  const updateTool = useUpdateCustomTool();
  const deleteTool = useDeleteCustomTool();

  const dbTool = useMemo(() => {
    if (!toolDetailId || !allTools) return null;
    return (allTools as CustomToolRow[]).find((t) => t.id === toolDetailId) ?? null;
  }, [toolDetailId, allTools]);

  const isNew = toolDetailId === "__new__";

  // ── Local state ──
  const [localName, setLocalName] = useState("");
  const [localDesc, setLocalDesc] = useState("");
  const [localExecType, setLocalExecType] = useState<"static" | "webhook" | "script">("static");
  const [localWebhookUrl, setLocalWebhookUrl] = useState("");
  const [localStaticResult, setLocalStaticResult] = useState("");
  const [localScriptBody, setLocalScriptBody] = useState("");
  const [localParams, setLocalParams] = useState<ParamDef[]>([]);
  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (dbTool) {
      setLocalName(dbTool.name);
      setLocalDesc(dbTool.description);
      setLocalExecType(dbTool.executionType as "static" | "webhook" | "script");
      setLocalWebhookUrl(dbTool.webhookUrl ?? "");
      setLocalStaticResult(dbTool.staticResult ?? "");
      setLocalScriptBody(dbTool.scriptBody ?? "");
      // Parse params from schema
      try {
        const schema = JSON.parse(dbTool.parametersSchema || "{}");
        const props = schema.properties ?? {};
        const req: string[] = schema.required ?? [];
        setLocalParams(
          Object.entries(props).map(([name, p]) => {
            const prop = p as { type?: string; description?: string };
            return {
              name,
              type: prop.type ?? "string",
              description: prop.description ?? "",
              required: req.includes(name),
            };
          }),
        );
      } catch {
        setLocalParams([]);
      }
    } else if (isNew) {
      setLocalName("");
      setLocalDesc("");
      setLocalExecType("static");
      setLocalWebhookUrl("");
      setLocalStaticResult("");
      setLocalScriptBody("");
      setLocalParams([]);
    }
    setDirty(false);
    setSaveError(null);
  }, [toolDetailId, dbTool, isNew]);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeToolDetail();
  }, [dirty, closeToolDetail]);

  const openToolDetail = useUIStore((s) => s.openToolDetail);

  const buildParamsSchema = useCallback(() => {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of localParams) {
      if (!p.name.trim()) continue;
      properties[p.name] = { type: p.type, description: p.description };
      if (p.required) required.push(p.name);
    }
    return { type: "object", properties, required };
  }, [localParams]);

  const handleSave = useCallback(async () => {
    if (!toolDetailId) return;
    setSaveError(null);

    if (!localName.trim()) {
      setSaveError("Tool name is required.");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(localName)) {
      setSaveError("Tool name must be lowercase snake_case (e.g. my_tool).");
      return;
    }
    if (!localDesc.trim()) {
      setSaveError("Description is required.");
      return;
    }

    const payload = {
      name: localName,
      description: localDesc,
      parametersSchema: buildParamsSchema(),
      executionType: localExecType,
      webhookUrl: localExecType === "webhook" ? localWebhookUrl || null : null,
      staticResult: localExecType === "static" ? localStaticResult || null : null,
      scriptBody: localExecType === "script" ? localScriptBody || null : null,
      enabled: true,
    };

    try {
      if (dbTool) {
        await updateTool.mutateAsync({ id: dbTool.id, ...payload });
      } else {
        const created = (await createTool.mutateAsync(payload)) as { id?: string } | undefined;
        if (created?.id) openToolDetail(created.id);
      }
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save tool");
    }
  }, [
    toolDetailId,
    localName,
    localDesc,
    localExecType,
    localWebhookUrl,
    localStaticResult,
    localScriptBody,
    dbTool,
    createTool,
    updateTool,
    buildParamsSchema,
    openToolDetail,
  ]);

  const handleDelete = async () => {
    if (!dbTool) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Tool",
        message: "Delete this custom tool? This cannot be undone.",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteTool.mutateAsync(dbTool.id);
    closeToolDetail();
  };

  // ── Not found ──
  if (!toolDetailId || (!dbTool && !isNew)) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Tool not found.
      </div>
    );
  }

  const isPending = createTool.isPending || updateTool.isPending;
  const execMeta = EXEC_TYPES.find((e) => e.value === localExecType) ?? EXEC_TYPES[0];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <button
          onClick={handleClose}
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          <ArrowLeft size="1.125rem" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
          <Wrench size="1.125rem" />
        </div>
        <input
          value={localName}
          onChange={(e) => {
            setLocalName(e.target.value);
            markDirty();
          }}
          className="flex-1 bg-transparent font-mono text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="tool_name"
        />
        <div className="flex items-center gap-1.5">
          {saveError && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-red-400">
              <AlertCircle size="0.6875rem" /> Error
            </span>
          )}
          {savedFlash && !dirty && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-emerald-400">
              <Check size="0.6875rem" /> Saved
            </span>
          )}
          {dirty && !saveError && <span className="mr-2 text-[0.625rem] font-medium text-amber-400">Unsaved</span>}
          {dbTool && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/15 active:scale-[0.98]"
            >
              <Trash2 size="0.8125rem" /> Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" /> Save
          </button>
        </div>
      </div>

      {/* Unsaved warning */}
      {showUnsavedWarning && (
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              onClick={() => closeToolDetail()}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                await handleSave();
                closeToolDetail();
              }}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertCircle size="0.8125rem" />
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="rounded-lg px-2 py-0.5 hover:bg-red-500/20">
            <X size="0.75rem" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* ── Name hint ── */}
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">
            Tool name must be lowercase snake_case (e.g.{" "}
            <code className="rounded bg-[var(--secondary)] px-1">check_weather</code>). This is the identifier the AI
            will use to call this function.
          </p>

          {/* ── Description ── */}
          <FieldGroup
            label="Description"
            icon={<Info size="0.875rem" className="text-[var(--primary)]" />}
            help="Tell the AI what this tool does. Be descriptive — the AI reads this to decide when and how to call your tool."
          >
            <input
              value={localDesc}
              onChange={(e) => {
                setLocalDesc(e.target.value);
                markDirty();
              }}
              className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="Describe what this tool does — the AI reads this to decide when to call it…"
            />
          </FieldGroup>

          {/* ── Parameters ── */}
          <FieldGroup
            label="Parameters"
            icon={<Code2 size="0.875rem" className="text-[var(--primary)]" />}
            help="The input arguments the AI can pass when calling this tool. Each parameter has a name, type, and description."
          >
            <p className="text-[0.625rem] text-[var(--muted-foreground)] mb-3">
              Define the arguments the AI can pass when calling this tool.
            </p>
            <div className="space-y-2">
              {localParams.map((param, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-xl bg-[var(--card)] p-3 ring-1 ring-[var(--border)]"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={param.name}
                        onChange={(e) => {
                          const next = [...localParams];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setLocalParams(next);
                          markDirty();
                        }}
                        placeholder="param_name"
                        className="w-32 rounded-lg bg-[var(--secondary)] px-2 py-1.5 font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-[var(--ring)]"
                      />
                      <select
                        value={param.type}
                        onChange={(e) => {
                          const next = [...localParams];
                          next[idx] = { ...next[idx], type: e.target.value };
                          setLocalParams(next);
                          markDirty();
                        }}
                        className="rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-[var(--ring)]"
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="array">array</option>
                        <option value="object">object</option>
                      </select>
                      <label className="flex items-center gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        <input
                          type="checkbox"
                          checked={param.required}
                          onChange={(e) => {
                            const next = [...localParams];
                            next[idx] = { ...next[idx], required: e.target.checked };
                            setLocalParams(next);
                            markDirty();
                          }}
                          className="rounded"
                        />
                        Required
                      </label>
                    </div>
                    <input
                      value={param.description}
                      onChange={(e) => {
                        const next = [...localParams];
                        next[idx] = { ...next[idx], description: e.target.value };
                        setLocalParams(next);
                        markDirty();
                      }}
                      placeholder="Description of this parameter…"
                      className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-[var(--ring)]"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setLocalParams(localParams.filter((_, i) => i !== idx));
                      markDirty();
                    }}
                    className="mt-1 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                  >
                    <Minus size="0.75rem" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setLocalParams([...localParams, { name: "", type: "string", description: "", required: false }]);
                  markDirty();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <Plus size="0.75rem" /> Add Parameter
              </button>
            </div>
          </FieldGroup>

          {/* ── Execution Type ── */}
          <FieldGroup label="Execution Type" icon={<Wrench size="0.875rem" className="text-[var(--primary)]" />}>
            <div className="grid grid-cols-3 gap-2">
              {EXEC_TYPES.map((et) => {
                const isActive = localExecType === et.value;
                const Icon = et.icon;
                return (
                  <button
                    key={et.value}
                    onClick={() => {
                      setLocalExecType(et.value);
                      markDirty();
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs ring-1 transition-all",
                      isActive
                        ? "bg-[var(--primary)]/10 ring-[var(--primary)] text-[var(--primary)]"
                        : "ring-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <Icon size="1rem" />
                    <span className="font-medium">{et.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.625rem] text-[var(--muted-foreground)]">{execMeta.description}</p>
          </FieldGroup>

          {/* ── Execution Config ── */}
          {localExecType === "static" && (
            <FieldGroup label="Static Result" icon={<FileText size="0.875rem" className="text-[var(--primary)]" />}>
              <textarea
                value={localStaticResult}
                onChange={(e) => {
                  setLocalStaticResult(e.target.value);
                  markDirty();
                }}
                rows={5}
                placeholder='{"result": "OK"}'
                className="w-full resize-y rounded-xl bg-[var(--secondary)] px-4 py-3 font-mono text-xs leading-relaxed ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                This string is returned as-is when the AI calls this tool. Useful for informational tools or
                placeholders.
              </p>
            </FieldGroup>
          )}

          {localExecType === "webhook" && (
            <FieldGroup label="Webhook URL" icon={<Globe size="0.875rem" className="text-[var(--primary)]" />}>
              <input
                value={localWebhookUrl}
                onChange={(e) => {
                  setLocalWebhookUrl(e.target.value);
                  markDirty();
                }}
                placeholder="https://api.example.com/my-tool"
                className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 font-mono text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                A POST request will be sent with{" "}
                <code className="rounded bg-[var(--secondary)] px-1">{"{ tool, arguments }"}</code> as JSON body.
                Response is returned to the AI.
              </p>
            </FieldGroup>
          )}

          {localExecType === "script" && (
            <FieldGroup label="Script Body" icon={<Code2 size="0.875rem" className="text-[var(--primary)]" />}>
              <textarea
                value={localScriptBody}
                onChange={(e) => {
                  setLocalScriptBody(e.target.value);
                  markDirty();
                }}
                rows={10}
                placeholder={
                  "// args is an object with the parameters\n// Return a value or object\nconst result = args.x + args.y;\nreturn { sum: result };"
                }
                className="w-full resize-y rounded-xl bg-[var(--secondary)] px-4 py-3 font-mono text-xs leading-relaxed ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Write JavaScript. Has access to <code className="rounded bg-[var(--secondary)] px-1">args</code>,{" "}
                <code className="rounded bg-[var(--secondary)] px-1">JSON</code>,{" "}
                <code className="rounded bg-[var(--secondary)] px-1">Math</code>,{" "}
                <code className="rounded bg-[var(--secondary)] px-1">Date</code>. Must{" "}
                <code className="rounded bg-[var(--secondary)] px-1">return</code> a result.
              </p>
            </FieldGroup>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Shared Components
// ═══════════════════════════════════════════════

interface ParamDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

function FieldGroup({
  label,
  icon,
  help,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold text-[var(--foreground)]">{label}</h3>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}
