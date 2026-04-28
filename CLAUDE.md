# CLAUDE.md

This file is a thin maintainer note for contributors using Claude. Canonical workflow, validation, and release guidance lives in `CONTRIBUTING.md`.

## Preferred Workflow

- Start with `pnpm install`.
- Run `pnpm check` as the baseline validation command.
- Run `pnpm db:push` when server or database changes need schema verification.
- Run `pnpm version:check` when you touch release metadata, version-bearing files, or README release references.

## Repo-Specific Cautions

- Keep edits non-destructive. Do not revert unrelated work in the tree.
- Prefer focused patches that keep code, docs, and release metadata aligned in the same change.
- When preparing a PR, make the why explicit in the description so reviewers can see the user problem or rationale, not just the file changes.
- Check `README.md`, `android/README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/CONFIGURATION.md`, `docs/TROUBLESHOOTING.md`, and `docs/FAQ.md` together when install, update, or release behavior changes.

## AI-Generated Pull Request

- **Never auto-check validation or test-plan checkboxes in a PR.** Those boxes are a to-do list for the human contributor, not evidence that work is done. If you generate a test plan, leave every box unchecked.
- When preparing a PR description, list what needs manual verification clearly and explicitly. Write entries like "Manually verify X in browser" rather than "Works correctly."
- If there is no linked issue or feature request, note that one should be opened before the PR is submitted. See `CONTRIBUTING.md § Before You Open a Pull Request`.

## Version Truth

- Canonical version: root `package.json`
- Release tag format: `vX.Y.Z`
- Release-notes source: `CHANGELOG.md`
- Derived version files that must stay in sync:
  - `packages/client/package.json`
  - `packages/server/package.json`
  - `packages/shared/package.json`
  - `packages/shared/src/constants/defaults.ts`
  - `win/installer/installer.nsi`
  - `win/installer/install.bat`
  - `android/app/build.gradle`

Android-specific rule:

- `versionName` matches the app version.
- `versionCode` increments for every shipped APK.

## Safe Multi-File Updates

- When changing version numbers, bump root `package.json` first, then run `pnpm version:sync -- --android-version-code <next-code>`.
- Run `pnpm version:check` before tagging or publishing.
- Keep `CONTRIBUTING.md` authoritative. Add Claude-specific notes here only when they are operationally useful and not already covered there.

## Logging

- **Never use `console.log/warn/error` in server code.** Always import the shared Pino logger:
  ```ts
  import { logger } from "../lib/logger.js"; // adjust relative path
  ```
- Use the correct level: `logger.error` for failures, `logger.warn` for non-fatal issues, `logger.info` for operational milestones, `logger.debug` for verbose traces (prompts, timing, state patches).
- Use Pino format specifiers for multi-arg calls: `logger.info("Resolved %d agents", count)` — not `logger.info("Resolved agents:", count)`.
- Log errors with the error object first: `logger.error(err, "Import failed")`.
- Client code (`packages/client/`) should keep using `console.*` — the browser has no Pino, and production builds strip `console.log` automatically.
- See `CONTRIBUTING.md § Logging` for full guidelines and `docs/CONFIGURATION.md § Logging Levels` for the user-facing reference.

## Frontend Changes

- **Read `packages/client/.instructions.md` before editing any client code.** It is the authoritative reference for architecture, patterns, conventions, and common-mistake avoidance.
- Validate with `pnpm check` (TypeScript + ESLint). There is no automated test suite.
