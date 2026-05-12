// ──────────────────────────────────────────────
// Hook: Apply Regex Scripts to text
// ──────────────────────────────────────────────
import { useCallback, useMemo } from "react";
import { useRegexScripts, type RegexScriptRow } from "./use-regex-scripts";
import { applyRegexReplacement, type RegexPlacement } from "@marinara-engine/shared";

/**
 * Parses a RegexScriptRow from DB into a usable form.
 */
function parseScript(row: RegexScriptRow) {
  const placements: RegexPlacement[] = (() => {
    try {
      return JSON.parse(row.placement);
    } catch {
      return ["ai_output"];
    }
  })();
  const trimStrings: string[] = (() => {
    try {
      return JSON.parse(row.trimStrings);
    } catch {
      return [];
    }
  })();
  return {
    ...row,
    enabledBool: row.enabled === "true",
    promptOnlyBool: row.promptOnly === "true",
    placements,
    trimStrings,
  };
}

/**
 * Applies all enabled regex scripts for a given placement to the input text.
 * @param depth — message depth (0 = latest message, 1 = one before, etc.). When
 *   undefined, depth range filtering is skipped (all scripts apply).
 */
function applyScripts(
  text: string,
  scripts: ReturnType<typeof parseScript>[],
  placement: RegexPlacement,
  options?: { promptOnly?: boolean; depth?: number; resolveMacros?: (value: string) => string },
): string {
  let result = text;
  for (const script of scripts) {
    if (!script.enabledBool) continue;
    if (!script.placements.includes(placement)) continue;
    // If we're rendering display text and script is prompt-only, skip
    if (!options?.promptOnly && script.promptOnlyBool) continue;

    // Depth range filtering
    if (options?.depth != null) {
      if (script.minDepth != null && options.depth < script.minDepth) continue;
      if (script.maxDepth != null && options.depth > script.maxDepth) continue;
    }

    try {
      const findRegex = options?.resolveMacros ? options.resolveMacros(script.findRegex) : script.findRegex;
      if (!findRegex) continue;
      const re = new RegExp(findRegex, script.flags);
      result = applyRegexReplacement(result, re, script.replaceString, (value) =>
        options?.resolveMacros ? options.resolveMacros(value) : value,
      );
      // Apply trim strings
      for (const trim of script.trimStrings) {
        const resolvedTrim = options?.resolveMacros ? options.resolveMacros(trim) : trim;
        if (resolvedTrim) result = result.split(resolvedTrim).join("");
      }
    } catch {
      // Invalid regex — skip silently
    }
  }
  return result;
}

/**
 * Hook that provides functions to apply regex transformations.
 *
 * Usage:
 *   const { applyToAIOutput, applyToUserInput } = useApplyRegex();
 *   const displayText = applyToAIOutput(message.content);
 */
export function useApplyRegex() {
  const { data: regexScripts } = useRegexScripts();

  // Pre-parse all scripts (sorted by order, which is done server-side)
  const parsedScripts = useMemo(() => {
    if (!regexScripts) return [];
    return (regexScripts as RegexScriptRow[]).map(parseScript);
  }, [regexScripts]);

  const applyToAIOutput = useCallback(
    (text: string, options?: { depth?: number; resolveMacros?: (value: string) => string }) =>
      applyScripts(text, parsedScripts, "ai_output", options),
    [parsedScripts],
  );

  const applyToUserInput = useCallback(
    (text: string, options?: { depth?: number; resolveMacros?: (value: string) => string }) =>
      applyScripts(text, parsedScripts, "user_input", options),
    [parsedScripts],
  );

  // Applies scripts in prompt context, including scripts marked prompt-only.
  const applyPromptOnly = useCallback(
    (
      text: string,
      placement: RegexPlacement,
      options?: { depth?: number; resolveMacros?: (value: string) => string },
    ) => applyScripts(text, parsedScripts, placement, { promptOnly: true, ...options }),
    [parsedScripts],
  );

  return { applyToAIOutput, applyToUserInput, applyPromptOnly };
}
