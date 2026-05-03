import { DEFAULT_IMPERSONATE_PROMPT } from "@marinara-engine/shared";

interface BuildImpersonateInstructionArgs {
  customPrompt?: unknown;
  direction?: string | null;
  personaName?: string | null;
  personaDescription?: string | null;
}

const LEGACY_IMPERSONATION_DIRECTION_RE =
  /^\[Impersonation instruction (?:\u2014|-) write \{\{user\}\}'s next response, steering it toward the following:\s*([\s\S]+?)\]$/;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDirection(direction: string | null | undefined): string {
  const rawDirection = normalizeText(direction);
  const legacyDirectionMatch = rawDirection.match(LEGACY_IMPERSONATION_DIRECTION_RE);
  return legacyDirectionMatch ? legacyDirectionMatch[1]!.trim() : rawDirection;
}

function punctuateDirection(direction: string): string {
  const trimmed = direction.trim();
  if (!trimmed) return "";

  const lastChar = trimmed[trimmed.length - 1];
  return lastChar && ".!?)]}\"'".includes(lastChar) ? trimmed : `${trimmed}.`;
}

function buildCustomImpersonateInstruction(customPrompt: string, direction: string): string {
  if (!direction) return customPrompt;
  return `${customPrompt} ${punctuateDirection(direction)}`;
}

function renderImpersonateTemplate(
  template: string,
  {
    direction,
    personaName,
    personaDescription,
  }: {
    direction: string;
    personaName: string;
    personaDescription: string;
  },
): string {
  return template
    .split(/\r?\n/)
    .filter((line) => {
      if (!personaDescription && line.includes("{{persona_description}}")) return false;
      if (!direction && line.includes("{{impersonate_direction}}")) return false;
      return true;
    })
    .map((line) =>
      line
        .replaceAll("{{user}}", personaName)
        .replaceAll("{{persona_description}}", personaDescription)
        .replaceAll("{{impersonate_direction}}", direction),
    )
    .join("\n")
    .trim();
}

export function buildImpersonateInstruction({
  customPrompt,
  direction,
  personaName,
  personaDescription,
}: BuildImpersonateInstructionArgs): string {
  const normalizedCustomPrompt = normalizeText(customPrompt);
  const impersonationDirection = normalizeDirection(direction);
  const personaLabel = normalizeText(personaName) || "{{user}}";
  const description = normalizeText(personaDescription);

  if (normalizedCustomPrompt) {
    const resolvedCustomPrompt = renderImpersonateTemplate(normalizedCustomPrompt, {
      direction: impersonationDirection,
      personaName: personaLabel,
      personaDescription: description,
    });
    return normalizedCustomPrompt.includes("{{impersonate_direction}}")
      ? resolvedCustomPrompt
      : buildCustomImpersonateInstruction(resolvedCustomPrompt, impersonationDirection);
  }

  return renderImpersonateTemplate(DEFAULT_IMPERSONATE_PROMPT, {
    direction: impersonationDirection,
    personaName: personaLabel,
    personaDescription: description,
  });
}
