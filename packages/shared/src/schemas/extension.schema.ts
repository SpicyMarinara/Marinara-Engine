// ──────────────────────────────────────────────
// Extension Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

// Generous-but-finite size caps. CSS and JS are stored as TEXT in SQLite
// and emitted verbatim into the page, so an unbounded payload would be a
// real DoS surface even past basicAuth.
const MAX_EXTENSION_CSS_BYTES = 256 * 1024; // 256 KiB
const MAX_EXTENSION_JS_BYTES = 1024 * 1024; // 1 MiB

// `z.string().max(n)` counts UTF-16 code units, so a CSS file full of
// multi-byte characters could blow past the SQLite-row budget while still
// passing validation. Measure actual UTF-8 bytes instead. Inlined rather
// than calling `TextEncoder` so the shared package stays runtime-agnostic
// (the `dom`/`node` libs aren't enabled in `tsconfig.base.json`).
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) {
      // High surrogate — the pair encodes one supplementary code point as 4 UTF-8 bytes.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

const cssByteLimit = (value: string | null | undefined) => value == null || utf8ByteLength(value) <= MAX_EXTENSION_CSS_BYTES;
const jsByteLimit = (value: string | null | undefined) => value == null || utf8ByteLength(value) <= MAX_EXTENSION_JS_BYTES;

const cssByteMessage = `CSS must be at most ${MAX_EXTENSION_CSS_BYTES} bytes`;
const jsByteMessage = `JS must be at most ${MAX_EXTENSION_JS_BYTES} bytes`;

export const createExtensionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  css: z.string().nullable().optional().refine(cssByteLimit, { message: cssByteMessage }),
  js: z.string().nullable().optional().refine(jsByteLimit, { message: jsByteMessage }),
  enabled: z.boolean().optional(),
  installedAt: z.string().datetime().optional(),
});

export const updateExtensionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    css: z.string().nullable().optional().refine(cssByteLimit, { message: cssByteMessage }),
    js: z.string().nullable().optional().refine(jsByteLimit, { message: jsByteMessage }),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Must update at least one field",
  });

export type CreateExtensionInput = z.infer<typeof createExtensionSchema>;
export type UpdateExtensionInput = z.infer<typeof updateExtensionSchema>;
