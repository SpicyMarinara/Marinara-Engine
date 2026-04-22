import { useRef, useState } from "react";
import type { GenerationParameters } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "./HelpTooltip";

export type EditableGenerationParameters = Pick<
  GenerationParameters,
  | "temperature"
  | "maxTokens"
  | "topP"
  | "topK"
  | "frequencyPenalty"
  | "presencePenalty"
  | "reasoningEffort"
  | "verbosity"
>;

type EditableGenerationParameterOverrides = Partial<EditableGenerationParameters>;

const REASONING_LEVELS = [null, "low", "medium", "high", "maximum"] as const;
const VERBOSITY_LEVELS = [null, "low", "medium", "high"] as const;

export const CHAT_PARAMETER_DEFAULTS: EditableGenerationParameters = {
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  topK: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "maximum",
  verbosity: "high",
};

export const ROLEPLAY_PARAMETER_DEFAULTS: EditableGenerationParameters = {
  temperature: 1,
  maxTokens: 8192,
  topP: 1,
  topK: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "maximum",
  verbosity: "high",
};

export function parseEditableGenerationParameters(raw: unknown): EditableGenerationParameterOverrides | null {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const next: EditableGenerationParameterOverrides = {};

  if (typeof source.temperature === "number") next.temperature = source.temperature;
  if (typeof source.maxTokens === "number") next.maxTokens = source.maxTokens;
  if (typeof source.topP === "number") next.topP = source.topP;
  if (typeof source.topK === "number") next.topK = source.topK;
  if (typeof source.frequencyPenalty === "number") next.frequencyPenalty = source.frequencyPenalty;
  if (typeof source.presencePenalty === "number") next.presencePenalty = source.presencePenalty;
  if (
    source.reasoningEffort === null ||
    source.reasoningEffort === "low" ||
    source.reasoningEffort === "medium" ||
    source.reasoningEffort === "high" ||
    source.reasoningEffort === "maximum"
  ) {
    next.reasoningEffort = source.reasoningEffort;
  }
  if (
    source.verbosity === null ||
    source.verbosity === "low" ||
    source.verbosity === "medium" ||
    source.verbosity === "high"
  ) {
    next.verbosity = source.verbosity;
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function getEditableGenerationParameters(
  defaults: EditableGenerationParameters,
  overrides: unknown,
): EditableGenerationParameters {
  return { ...defaults, ...(parseEditableGenerationParameters(overrides) ?? {}) };
}

export function GenerationParametersFields({
  value,
  onChange,
}: {
  value: EditableGenerationParameters;
  onChange: (next: EditableGenerationParameters) => void;
}) {
  const set = <K extends keyof EditableGenerationParameters>(key: K, nextValue: EditableGenerationParameters[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ParamInput
          label="Temperature"
          help="Controls randomness. Lower values make output more focused and deterministic; higher values make it more creative and varied."
          value={value.temperature}
          onChange={(nextValue) => set("temperature", nextValue)}
          min={0}
          max={2}
          step={0.05}
        />
        <ParamInput
          label="Max Tokens"
          help="The maximum number of tokens the model can generate in a single response. Higher values allow longer replies."
          value={value.maxTokens}
          onChange={(nextValue) => set("maxTokens", nextValue)}
          min={1}
          max={32768}
          step={256}
        />
        <ParamInput
          label="Top P"
          help="Nucleus sampling: only considers tokens whose cumulative probability reaches this threshold. Lower values make output more focused."
          value={value.topP}
          onChange={(nextValue) => set("topP", nextValue)}
          min={0}
          max={1}
          step={0.05}
        />
        <ParamInput
          label="Top K"
          help="Limits the model to only consider the top K most likely tokens at each step. 0 disables this limit."
          value={value.topK}
          onChange={(nextValue) => set("topK", nextValue)}
          min={0}
          max={500}
          step={1}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ParamInput
          label="Frequency"
          help="Penalizes tokens based on how often they've already appeared. Positive values reduce repetition; negative values encourage it."
          value={value.frequencyPenalty}
          onChange={(nextValue) => set("frequencyPenalty", nextValue)}
          min={-2}
          max={2}
          step={0.05}
        />
        <ParamInput
          label="Presence"
          help="Penalizes tokens that have appeared at all, regardless of frequency. Positive values encourage the model to talk about new topics."
          value={value.presencePenalty}
          onChange={(nextValue) => set("presencePenalty", nextValue)}
          min={-2}
          max={2}
          step={0.05}
        />
      </div>
      <div className="space-y-2">
        <div>
          <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
            Reasoning Effort
            <HelpTooltip
              text="How much the model should 'think' before responding. Higher effort produces more thoughtful, nuanced output but uses more tokens and is slower."
              size="0.625rem"
            />
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {REASONING_LEVELS.map((level) => (
              <button
                key={level ?? "none"}
                onClick={() => set("reasoningEffort", level)}
                className={cn(
                  "rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
                  value.reasoningEffort === level
                    ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
                    : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                )}
              >
                {level ? level.charAt(0).toUpperCase() + level.slice(1) : "None"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
            Verbosity
            <HelpTooltip
              text="Controls how long and detailed responses should be. Low keeps things concise; high encourages elaborate, descriptive output."
              size="0.625rem"
            />
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {VERBOSITY_LEVELS.map((level) => (
              <button
                key={level ?? "none"}
                onClick={() => set("verbosity", level)}
                className={cn(
                  "rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
                  value.verbosity === level
                    ? "bg-blue-400/15 text-blue-400 ring-1 ring-blue-400/30"
                    : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                )}
              >
                {level ? level.charAt(0).toUpperCase() + level.slice(1) : "None"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  help,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  help?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const prevValue = useRef(value);

  if (value !== prevValue.current) {
    prevValue.current = value;
    setDraft(String(value));
  }

  const commit = () => {
    const nextValue = parseFloat(draft);
    if (!Number.isNaN(nextValue) && nextValue >= min && nextValue <= max) {
      onChange(nextValue);
      setDraft(String(nextValue));
      return;
    }
    setDraft(String(value));
  };

  return (
    <div>
      <label className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
        {label}
        {help && <HelpTooltip text={help} size="0.625rem" />}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        min={min}
        max={max}
        step={step}
        className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
      />
    </div>
  );
}
