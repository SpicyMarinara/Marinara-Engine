// Server-side execution timeout for compiled regex tests against chat context.
//
// The shared static check (isPatternSafe) catches the common ReDoS shapes before
// compilation, but expert-crafted patterns can still pass that check and explode
// on specific input. This wrapper runs the regex.test call inside a fresh V8 vm
// context with a hard timeout — the engine inserts interrupt checks during
// regex execution, so catastrophic backtracking aborts instead of stalling the
// event loop indefinitely.
//
// On timeout: log a warning with the pattern source so the lorebook author can
// see why an entry stopped activating, and return false. We deliberately do NOT
// fall back to literal substring on timeout — the pattern compiled and may have
// matched on simpler input; substituting literal-substring semantics here would
// cause silent surprise matches.

import * as vm from "node:vm";
import { logger } from "../../lib/logger.js";

/** Default per-call timeout for a single regex.test against chat context, in ms. */
export const DEFAULT_REGEX_TIMEOUT_MS = 50;

/** Build a regex executor that runs `regex.test(text)` under a vm timeout. */
export function createTimeoutRegexExecutor(timeoutMs: number = DEFAULT_REGEX_TIMEOUT_MS) {
  return function vmRegexExecutor(regex: RegExp, text: string): boolean {
    // The vm context only needs the regex + text; we recompile inside the vm so
    // the interrupt check is wired through the new isolate's regex execution.
    const context = vm.createContext({ __pattern: regex.source, __flags: regex.flags, __text: text });
    try {
      const result = vm.runInContext("(new RegExp(__pattern, __flags)).test(__text)", context, {
        timeout: timeoutMs,
        displayErrors: false,
      });
      return Boolean(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // V8 surfaces timeouts as "Script execution timed out." — log warn and skip the entry.
      if (message.includes("timed out")) {
        logger.warn(
          "Lorebook regex /%s/%s exceeded %dms timeout against chat context (length=%d) — entry will not match this scan",
          regex.source,
          regex.flags,
          timeoutMs,
          text.length,
        );
        return false;
      }
      // Contract: non-timeout errors (rare — invalid regex would have thrown at compile time
      // upstream, before we got here) are re-thrown so testKeyword's outer try/catch can swap
      // in its literal-substring fallback. Do NOT swallow here — that catch in
      // packages/shared/src/utils/lorebook-keyword-matching.ts is the intended landing pad,
      // and silently returning false would mask a real executor-side bug.
      throw err;
    }
  };
}

/** Default executor used by keyword-scanner.ts. */
export const vmRegexExecutor = createTimeoutRegexExecutor();
