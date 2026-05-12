type RegexReplaceMatch = {
  match: string;
  captures: string[];
  offset: number;
  input: string;
  groups?: Record<string, string>;
};

type CaseMode = "none" | "upper" | "lower";
type OneShotCaseMode = "upper-first" | "lower-first" | null;
const CASE_COMMANDS = new Set(["U", "L", "E", "u", "l"]);

function readCapture(captures: string[], index: number): string | null {
  if (index < 1 || index > captures.length) return null;
  return captures[index - 1] ?? "";
}

function applyCase(
  value: string,
  mode: CaseMode,
  oneShot: OneShotCaseMode,
): { value: string; oneShot: OneShotCaseMode } {
  let result = mode === "upper" ? value.toUpperCase() : mode === "lower" ? value.toLowerCase() : value;
  if (oneShot && result.length > 0) {
    result =
      oneShot === "upper-first"
        ? result.charAt(0).toUpperCase() + result.slice(1)
        : result.charAt(0).toLowerCase() + result.slice(1);
    return { value: result, oneShot: null };
  }
  return { value: result, oneShot };
}

function expandRegexReplacementToken(replacement: string, index: number, ctx: RegexReplaceMatch) {
  const next = replacement[index + 1];
  if (!next) return { value: "$", nextIndex: index + 1 };

  if (next === "$") return { value: "$", nextIndex: index + 2 };
  if (next === "&") return { value: ctx.match, nextIndex: index + 2 };
  if (next === "`") return { value: ctx.input.slice(0, ctx.offset), nextIndex: index + 2 };
  if (next === "'") return { value: ctx.input.slice(ctx.offset + ctx.match.length), nextIndex: index + 2 };

  if (next === "<") {
    const closeIndex = replacement.indexOf(">", index + 2);
    if (closeIndex > index + 2) {
      const name = replacement.slice(index + 2, closeIndex);
      if (ctx.groups && Object.prototype.hasOwnProperty.call(ctx.groups, name)) {
        return { value: ctx.groups[name] ?? "", nextIndex: closeIndex + 1 };
      }
    }
    return { value: "$", nextIndex: index + 1 };
  }

  if (/\d/.test(next)) {
    const twoDigit = replacement.slice(index + 1, index + 3);
    if (/^\d{2}$/.test(twoDigit)) {
      const twoDigitValue = readCapture(ctx.captures, Number(twoDigit));
      if (twoDigitValue !== null) return { value: twoDigitValue, nextIndex: index + 3 };
    }

    const oneDigitValue = readCapture(ctx.captures, Number(next));
    if (oneDigitValue !== null) return { value: oneDigitValue, nextIndex: index + 2 };
  }

  return { value: "$", nextIndex: index + 1 };
}

export function expandRegexReplacement(replacement: string, ctx: RegexReplaceMatch): string {
  let result = "";
  let index = 0;
  let caseMode: CaseMode = "none";
  let oneShotCaseMode: OneShotCaseMode = null;

  const append = (value: string) => {
    const transformed = applyCase(value, caseMode, oneShotCaseMode);
    result += transformed.value;
    oneShotCaseMode = transformed.oneShot;
  };

  while (index < replacement.length) {
    const char = replacement[index];

    if (char === "\\") {
      const next = replacement[index + 1];
      const escapedCommand = next === "\\" ? replacement[index + 2] : undefined;
      if (escapedCommand && CASE_COMMANDS.has(escapedCommand)) {
        append(`\\${escapedCommand}`);
        index += 3;
        continue;
      }
      if (next === "U") {
        caseMode = "upper";
        index += 2;
        continue;
      }
      if (next === "L") {
        caseMode = "lower";
        index += 2;
        continue;
      }
      if (next === "E") {
        caseMode = "none";
        index += 2;
        continue;
      }
      if (next === "u") {
        oneShotCaseMode = "upper-first";
        index += 2;
        continue;
      }
      if (next === "l") {
        oneShotCaseMode = "lower-first";
        index += 2;
        continue;
      }
    }

    if (char === "$") {
      const token = expandRegexReplacementToken(replacement, index, ctx);
      append(token.value);
      index = token.nextIndex;
      continue;
    }

    append(char ?? "");
    index += 1;
  }

  return result;
}

export function applyRegexReplacement(
  text: string,
  regex: RegExp,
  replacement: string,
  resolveReplacement?: (replacement: string) => string,
): string {
  return text.replace(regex, (...args: unknown[]) => {
    const hasGroups = typeof args.at(-1) === "object" && args.at(-1) !== null;
    const groups = hasGroups ? (args.at(-1) as Record<string, string>) : undefined;
    const input = args.at(hasGroups ? -2 : -1) as string;
    const offset = args.at(hasGroups ? -3 : -2) as number;
    const match = args[0] as string;
    const captures = args.slice(1, hasGroups ? -3 : -2).map((capture) => (capture == null ? "" : String(capture)));
    return expandRegexReplacement(resolveReplacement ? resolveReplacement(replacement) : replacement, {
      match,
      captures,
      offset,
      input,
      groups,
    });
  });
}
