# Configuration

Marinara Engine is configured through environment variables. Copy `.env.example` to `.env` in the project root to get started:

```bash
cp .env.example .env
```

## Environment Variables

| Variable                         | Default                                                  | Description                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                           | `7860`                                                   | Server port. Keep Android builds, launchers, Docker, and Termux on the same value.                                                                             |
| `HOST`                           | `127.0.0.1` (`pnpm start`) / `0.0.0.0` (shell launchers) | Bind address. Set to `0.0.0.0` to allow access from other devices on your network.                                                                             |
| `AUTO_OPEN_BROWSER`              | `true`                                                   | Whether the shell launchers auto-open the local app URL. Set to `false`, `0`, `no`, or `off` to disable. Does not apply to the Android WebView wrapper.        |
| `AUTO_CREATE_DEFAULT_CONNECTION` | `true`                                                   | Whether Marinara auto-creates the built-in OpenRouter Free starter connection when no saved connections exist. Set to `false`, `0`, `no`, or `off` to disable. |
| `TZ`                             | _(system default; containers are often `UTC`)_           | Optional IANA timezone used for time-based features like character schedules.                                                                                  |
| `DATABASE_URL`                   | `file:./data/marinara-engine.db`                         | SQLite database path. Relative file paths resolve from `packages/server` for compatibility with existing local installs.                                       |
| `ENCRYPTION_KEY`                 | _(empty)_                                                | AES key for API key encryption. Generate one with `openssl rand -hex 32`.                                                                                      |
| `ADMIN_SECRET`                   | _(empty)_                                                | Optional shared secret for destructive admin endpoints such as `/api/admin/clear-all`.                                                                         |
| `LOG_LEVEL`                      | `warn`                                                   | Logging verbosity (`debug`, `info`, `warn`, `error`). See [Logging Levels](#logging-levels) below for details.                                                 |
| `CORS_ORIGINS`                   | `http://localhost:5173,http://127.0.0.1:5173`            | Allowed CORS origins. Set `*` for allow-all without credentials; explicit origin lists keep credentialed CORS support.                                         |
| `SSL_CERT`                       | _(empty)_                                                | Path to the TLS certificate. Set both `SSL_CERT` and `SSL_KEY` to enable HTTPS.                                                                                |
| `SSL_KEY`                        | _(empty)_                                                | Path to the TLS private key.                                                                                                                                   |
| `IP_ALLOWLIST`                   | _(empty)_                                                | Comma-separated IPs or CIDRs to allow. Loopback is always allowed.                                                                                             |
| `GIPHY_API_KEY`                  | _(empty)_                                                | Optional Giphy API key. GIF search is unavailable when unset.                                                                                                  |

## Logging Levels

All server-side logging goes through [Pino](https://getpino.io/) via a shared logger instance (`packages/server/src/lib/logger.ts`). The `LOG_LEVEL` environment variable controls the minimum severity that gets printed — anything below the configured level is silently discarded.

| Level   | What it shows                             | Typical use                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error` | Fatal and unrecoverable failures only.    | Database errors (readonly, locked), fatal agent failures that abort generation, image generation crashes, command processing exceptions.                                                                                                                                                                                                                                                                  |
| `warn`  | Errors **plus** non-fatal warnings.       | Context trimming, non-critical agent failures, empty model responses, expression/background corrections, decrypt failures, missing connections, non-fatal catch blocks.                                                                                                                                                                                                                                   |
| `info`  | Warnings **plus** operational milestones. | Server startup, seed results, Fastify per-request logs (method / URL / status / duration), agent resolution counts, character commands executed, game session lifecycle (create / start / conclude), abort requests, haptic device connections.                                                                                                                                                           |
| `debug` | Everything — full verbose output.         | Complete LLM prompts (every message role + content), full LLM responses with duration, thinking/reasoning tokens (useful in game mode where no brain icon exists), token usage breakdowns, generation timing traces, game state patches, agent pipeline details (batch composition, prompt content, parse results), scene post-processing decisions, memory recall injection, asset generation decisions. |

### Recommended settings

- **Production** — `warn` (the default). Clean output, surfaces only problems worth investigating.
- **Debugging a specific issue** — `info`. Adds request logs and operational milestones without flooding the terminal.
- **Debugging prompts or model behavior** — `debug`. Logs every message sent to every LLM call and every response received. Expect high volume.

### Example

```bash
# Docker Compose
LOG_LEVEL=debug docker compose up

# .env file
LOG_LEVEL=info

# Inline
LOG_LEVEL=debug pnpm start
```

> **Note:** Client-side (browser) logging uses the standard `console.*` API and is not controlled by `LOG_LEVEL`. Production client builds automatically strip `console.log` calls; only `console.warn` and `console.error` survive in the browser.

## Notes

- The shell launchers (`start.bat`, `start.sh`, `start-termux.sh`) source `.env` automatically. If you run `pnpm start` directly, make sure the variables are set in your environment or `.env` file.
- Container deployments can pass variables via `docker run -e` flags or a `docker-compose.yml` `environment` block instead of a `.env` file.
- `HOST=0.0.0.0` is required for LAN access. The shell launchers default to this, but `pnpm start` binds to `127.0.0.1` unless overridden.
