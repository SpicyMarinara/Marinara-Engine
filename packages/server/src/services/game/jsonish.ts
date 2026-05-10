function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json|markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");
}

function extractObjectCandidate(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) return raw.trim();

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < raw.length; i++) {
    const char = raw[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1).trim();
    }
  }

  const end = raw.lastIndexOf("}");
  return end > start ? raw.slice(start, end + 1).trim() : raw.slice(start).trim();
}

function sanitizeControlCharsInStrings(raw: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString) {
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        if (char === "\n") output += "\\n";
        else if (char === "\r") output += "\\r";
        else if (char === "\t") output += "\\t";
        else output += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
    }
    output += char;
  }

  return output;
}

function stripCommentsOutsideStrings(raw: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    const next = raw[i + 1];
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (!inString && char === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }
    if (!inString && char === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    output += char;
  }

  return output;
}

function insertMissingPropertyCommas(raw: string): string {
  return raw.replace(/(["}\]])(\s*\n\s*)("[$A-Za-z_][^"\n]{0,120}"\s*:)/g, "$1,$2$3");
}

function removeTrailingCommas(raw: string): string {
  return raw.replace(/,\s*([}\]])/g, "$1");
}

function repairJsonish(raw: string): string {
  return removeTrailingCommas(
    insertMissingPropertyCommas(stripCommentsOutsideStrings(sanitizeControlCharsInStrings(raw))),
  );
}

function unwrapJsonString(value: unknown): unknown {
  let next = value;
  for (let depth = 0; depth < 2 && typeof next === "string"; depth++) {
    const nested = stripFences(next.trim());
    if (!nested.startsWith("{") && !nested.startsWith("[")) break;

    try {
      next = JSON.parse(nested);
    } catch {
      break;
    }
  }
  return next;
}

export function parseGameJsonish(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return unwrapJsonString(JSON.parse(trimmed));
  } catch {
    // Continue through the increasingly tolerant parse path below.
  }

  const unfenced = stripFences(trimmed);
  try {
    return unwrapJsonString(JSON.parse(unfenced.trim()));
  } catch {
    // Continue.
  }

  const candidate = extractObjectCandidate(unfenced);
  try {
    return unwrapJsonString(JSON.parse(repairJsonish(candidate)));
  } catch {
    return unwrapJsonString(JSON.parse(candidate));
  }
}
