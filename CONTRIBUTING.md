# Contributing to Marinara Engine

This is the canonical contributor guide for Marinara Engine. Use it with `README.md` for the product overview, `CHANGELOG.md` for release notes, and `CLAUDE.md` only as a thin companion for maintainers using Claude.

## Development Setup

Prerequisites:

- Node.js 20+
- Git
- pnpm via the repo-pinned `packageManager` if you are not using the launchers

Typical local setup:

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
pnpm install
pnpm build
pnpm db:push
pnpm dev
```

Useful entry points:

- `pnpm dev` starts the server and client with hot reload.
- `pnpm dev:server` starts only the API server.
- `pnpm dev:client` starts only the Vite frontend.
- `start.bat`, `start.sh`, and `start-termux.sh` run the launcher flow, including git-based auto-update and optional browser auto-open.

Copy `.env.example` to `.env` when you need to change ports, HTTPS settings, or launcher behavior such as `AUTO_OPEN_BROWSER=false`.

## Repo Layout

- `packages/client` — React frontend, PWA shell, and UI components
- `packages/server` — Fastify API, SQLite integration, migrations, importers, and AI agents
- `packages/shared` — Shared types, schemas, constants, and `APP_VERSION`
- `android` — Android WebView wrapper for the Termux-served local app
- `installer` — Windows installer sources and helper scripts
- `docs/screenshots` — README and release media assets
- `start.bat`, `start.sh`, `start-termux.sh` — platform launchers

## Validation

Baseline validation:

```bash
pnpm check
```

Useful follow-up checks:

```bash
pnpm db:push
pnpm version:check
```

There is not a meaningful automated repo test suite yet. Do not present `pnpm test` as a reliable gate in docs or PR descriptions. When you change behavior, include the manual verification you performed.

## Pull Request Expectations

- Keep PRs focused. Separate unrelated refactors from user-facing fixes or documentation work.
- Explain the why clearly in the PR description. Reviewers should understand the user problem, regression, or tradeoff being addressed, not just the implementation summary.
- Update documentation in the same PR when behavior changes affect installation, updates, release flow, launchers, or platform-specific behavior.
- Include screenshots or short recordings for UI changes.
- Call out manual validation clearly, especially for launcher, installer, or Android wrapper changes.
- Avoid version drift. If your PR intentionally bumps a release, update every version-bearing file in one pass.

## Documentation Rules

- `README.md` is the user-facing overview and quickstart, not the full release log.
- `CHANGELOG.md` is the durable release-notes source and should be reusable for GitHub Releases.
- `android/README.md` is scoped to the Android wrapper around the Termux-served app.
- `CONTRIBUTING.md` is the canonical contributor and maintainer workflow document.
- If a change makes any existing doc misleading, fix that doc in the same PR.

## Versioning and Releases

Current policy:

- Canonical version source: root `package.json`
- Release tag format: `vX.Y.Z`
- Changelog authority: `CHANGELOG.md`
- Every other version-bearing file is derived and must be synchronized before tagging or publishing

Current version touchpoints:

| File                                        | Role                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `package.json`                              | Canonical application version                          |
| `packages/client/package.json`              | Derived workspace version                              |
| `packages/server/package.json`              | Derived workspace version                              |
| `packages/shared/package.json`              | Derived workspace version                              |
| `packages/shared/src/constants/defaults.ts` | Shared `APP_VERSION` used by the app and update checks |
| `installer/installer.nsi`                   | Windows installer output version                       |
| `installer/install.bat`                     | Windows installer banner text                          |
| `android/app/build.gradle`                  | Android `versionName` and `versionCode`                |

Android policy:

- `versionName` must match the app version.
- `versionCode` must increase monotonically for every shipped APK.

Release-related behavior already in the repo:

- Docker publishing is triggered by `v*` tags.
- Tagged releases are published from `CHANGELOG.md` by the GitHub release workflow.
- The server update check reads the newest GitHub `v*` tag and uses matching release metadata when it exists.
- Git-based installs can apply updates automatically; Docker installs are prompted with the pull command instead.
- Pull request CI runs `pnpm check`, `pnpm version:check`, and the tracked-installer guard.
- Built installer binaries belong on GitHub Releases and should not be committed back into the repository.

Standard release flow:

1. Bump the canonical version in root `package.json`.
2. Run `pnpm version:sync -- --android-version-code <next-code>` to sync all derived version fields.
3. Update `CHANGELOG.md`.
4. Create and push the tag `vX.Y.Z`.
5. Let the release workflow publish or update the GitHub Release from the matching changelog entry.

Release helpers now in the repo:

- `pnpm version:sync -- --android-version-code <next-code>` updates the derived version files and README release references from the root `package.json` version.
- `pnpm version:check` fails when those derived files drift out of sync.
- `pnpm guard:installer-artifacts` fails when tracked installer binaries appear under `installer/*.exe`.
- `pnpm release:notes -- <version>` renders the matching `CHANGELOG.md` entry for release publication.

## Immediate Way Forward

- Add launcher and installer smoke tests so startup parity is exercised automatically, not just by manual verification.
- Consider a release wrapper script that bumps the root version, prompts for `versionCode`, runs `pnpm version:sync`, and opens the changelog entry for editing.
