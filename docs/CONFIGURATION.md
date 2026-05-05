# Configuration

Marinara Engine is configured through environment variables. Copy `.env.example` to `.env` in the project root to get started:

```bash
cp .env.example .env
```

The example file uses safe, active `KEY=value` defaults. To change a setting, edit the value after `=`; lines that start with `#` are explanatory comments and are ignored by the launchers.

## Environment Variables

| Variable                                    | Default                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                      | `7860`                                                   | Server port. Keep Android builds, launchers, Docker, and Termux on the same value.                                                                                                                                                                                                                                                                                                                                                 |
| `HOST`                                      | `127.0.0.1` (`pnpm start`) / `0.0.0.0` (shell launchers) | Bind address. Set to `0.0.0.0` to allow access from other devices on your network.                                                                                                                                                                                                                                                                                                                                                 |
| `AUTO_OPEN_BROWSER`                         | `true`                                                   | Whether the shell launchers auto-open the local app URL. Set to `false`, `0`, `no`, or `off` to disable. Does not apply to the Android WebView wrapper.                                                                                                                                                                                                                                                                            |
| `AUTO_CREATE_DEFAULT_CONNECTION`            | `true`                                                   | Whether Marinara auto-creates the built-in OpenRouter Free starter connection when no saved connections exist. Set to `false`, `0`, `no`, or `off` to disable.                                                                                                                                                                                                                                                                     |
| `TZ`                                        | _(system default; containers are often `UTC`)_           | Optional IANA timezone used for time-based features like character schedules.                                                                                                                                                                                                                                                                                                                                                      |
| `STORAGE_BACKEND`                           | `files`                                                  | Durable storage backend. `files` stores user data under `DATA_DIR/storage`; `sqlite` opts into the legacy persistent SQLite database.                                                                                                                                                                                                                                                                                              |
| `FILE_STORAGE_DIR`                          | `<DATA_DIR>/storage`                                     | Override for file-native storage. Relative paths resolve from `packages/server`.                                                                                                                                                                                                                                                                                                                                                   |
| `DATABASE_URL`                              | `file:./data/marinara-engine.db`                         | Legacy SQLite import/source path. In default file-native mode this is only used to import old data when `DATA_DIR/storage` does not exist.                                                                                                                                                                                                                                                                                         |
| `ENCRYPTION_KEY`                            | _(empty)_                                                | AES key for API key encryption. Generate one with `openssl rand -hex 32`.                                                                                                                                                                                                                                                                                                                                                          |
| `ADMIN_SECRET`                              | _(empty)_                                                | Required shared secret for privileged APIs such as admin cleanup, backups, bulk import, update apply, sidecar install/download/delete, custom tool mutation, and haptics. Send as `X-Admin-Secret`.                                                                                                                                                                                                                                |
| `MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK` | `false`                                                  | When `true`, loopback/local requests to privileged APIs must also provide `ADMIN_SECRET`. By default loopback keeps desktop backup/export flows convenient while non-loopback privileged requests still require the secret.                                                                                                                                                                                                        |
| `LOG_LEVEL`                                 | `warn`                                                   | Logging verbosity (`debug`, `info`, `warn`, `error`). See [Logging Levels](#logging-levels) below for details.                                                                                                                                                                                                                                                                                                                     |
| `CORS_ORIGINS`                              | `http://localhost:5173,http://127.0.0.1:5173`            | Allowed CORS origins. Set `*` for allow-all without credentials; explicit origin lists keep credentialed CORS support.                                                                                                                                                                                                                                                                                                             |
| `SSL_CERT`                                  | _(empty)_                                                | Path to the TLS certificate. Set both `SSL_CERT` and `SSL_KEY` to enable HTTPS.                                                                                                                                                                                                                                                                                                                                                    |
| `SSL_KEY`                                   | _(empty)_                                                | Path to the TLS private key.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `IP_ALLOWLIST`                              | _(empty)_                                                | Comma-separated IPs or CIDRs to allow. Loopback is always allowed.                                                                                                                                                                                                                                                                                                                                                                 |
| `IP_ALLOWLIST_ENABLED`                      | `true`                                                   | Master switch for `IP_ALLOWLIST`. Set to `false`, `0`, `no`, or `off` to keep the list configured but disable enforcement.                                                                                                                                                                                                                                                                                                         |
| `BASIC_AUTH_USER`                           | _(empty)_                                                | Username for HTTP Basic Auth. Set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` to require a password on every request. Leave either empty to disable auth.                                                                                                                                                                                                                                                                         |
| `BASIC_AUTH_PASS`                           | _(empty)_                                                | Password for HTTP Basic Auth. Use a strong, random value.                                                                                                                                                                                                                                                                                                                                                                          |
| `BASIC_AUTH_REALM`                          | `Marinara Engine`                                        | Realm string shown in the browser password prompt.                                                                                                                                                                                                                                                                                                                                                                                 |
| `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK`     | `false`                                                  | Restores legacy unauthenticated LAN/Docker/Tailscale/private-network access when Basic Auth is unset. Leave `false` unless the network itself is trusted.                                                                                                                                                                                                                                                                          |
| `ALLOW_UNAUTHENTICATED_REMOTE`              | `false`                                                  | Allows unauthenticated public-internet IPs when Basic Auth is unset. NOT recommended.                                                                                                                                                                                                                                                                                                                                              |
| `TRUSTED_PRIVATE_NETWORKS`                  | _(built-in defaults)_                                    | Comma-separated IPs / CIDRs treated as private-network clients. This does not bypass auth by itself; it only scopes `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true`. When set, it **replaces** the defaults (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `fc00::/7`, `fe80::/10`) — include any defaults you still want. Public internet clients require `ALLOW_UNAUTHENTICATED_REMOTE=true`. |
| `CSRF_TRUSTED_ORIGINS`                      | _(empty)_                                                | Extra trusted origins for unsafe browser-origin API requests. The first-party client automatically sends `X-Marinara-CSRF`. For Docker/LAN access, use the browser-visible origin such as `http://192.168.1.10:3004`; `*` is supported only when every browser origin that can reach the server is trusted.                                                                                                                        |
| `UPDATES_APPLY_ENABLED`                     | `false`                                                  | Enables server-side update application. Update apply also requires `ADMIN_SECRET`.                                                                                                                                                                                                                                                                                                                                                 |
| `UPDATES_ALLOW_REMOTE_APPLY`                | `false`                                                  | Allows update apply from non-loopback clients when paired with auth and `ADMIN_SECRET`.                                                                                                                                                                                                                                                                                                                                            |
| `PROVIDER_LOCAL_URLS_ENABLED`               | `false`                                                  | Allows user-configured LLM/provider test/model URLs to call private/LAN/reserved addresses. Loopback provider URLs (`127.0.0.1`, `::1`, `localhost`) are allowed by default for local model servers. Needed for remote-hosted access to self-hosted provider endpoints on non-loopback addresses.                                                                                                                                  |
| `IMAGE_LOCAL_URLS_ENABLED`                  | `false`                                                  | Allows image providers and returned image downloads to call local/private addresses.                                                                                                                                                                                                                                                                                                                                               |
| `TTS_LOCAL_URLS_ENABLED`                    | `false`                                                  | Allows TTS provider URLs to call local/private addresses.                                                                                                                                                                                                                                                                                                                                                                          |
| `DEEPLX_LOCAL_URLS_ENABLED`                 | `false`                                                  | Allows DeepLX URLs to call local/private addresses.                                                                                                                                                                                                                                                                                                                                                                                |
| `WEBHOOK_LOCAL_URLS_ENABLED`                | `false`                                                  | Allows custom tool webhooks to call local/private addresses.                                                                                                                                                                                                                                                                                                                                                                       |
| `CUSTOM_TOOL_SCRIPT_ENABLED`                | `false`                                                  | Enables custom script tool execution. Script tools are stored but disabled by default because they execute local code.                                                                                                                                                                                                                                                                                                             |
| `SIDECAR_RUNTIME_INSTALL_ENABLED`           | `false`                                                  | Enables sidecar runtime installation/reinstallation from the API without requiring an explicit Admin Access header on loopback. You can also leave this disabled and enter the matching `ADMIN_SECRET` in Settings -> Advanced -> Admin Access before installing the runtime. Sidecar model downloads and deletion require `ADMIN_SECRET`.                                                                                         |
| `HAPTICS_ALLOW_REMOTE`                      | `false`                                                  | Allows haptic privileged actions from non-loopback clients when paired with auth and `ADMIN_SECRET`.                                                                                                                                                                                                                                                                                                                               |
| `IMPORT_ALLOWED_ROOTS`                      | _(empty)_                                                | Comma-separated filesystem roots that bulk import may use without a picker-issued folder token.                                                                                                                                                                                                                                                                                                                                    |
| `GIPHY_API_KEY`                             | _(empty)_                                                | Optional Giphy API key. GIF search is unavailable when unset.                                                                                                                                                                                                                                                                                                                                                                      |
| `SPOTIFY_REDIRECT_URI`                      | _(empty; derived from request)_                          | Override for the Spotify OAuth callback URL. Leave empty to derive from the incoming request (HTTPS hosts and `127.0.0.1` auto-handled). Set explicitly when TLS is terminated upstream. Must match a Redirect URI registered in the Spotify Developer Dashboard.                                                                                                                                                                  |

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

## Access Control

Marinara Engine ships with layered access-control mechanisms designed for users who expose the server beyond their local machine.

> Looking for a step-by-step walkthrough rather than a reference? See [Remote Access — Setting Up Basic Auth or an IP Allowlist](REMOTE_ACCESS.md).

### Safe-by-default lockdown

By default, when no Basic Auth credentials are configured, the server **refuses connections from every non-loopback IP**. Local browser access continues to work without any configuration:

- Loopback (`127.0.0.1`, `::1`) — always allowed.
- Anything in `IP_ALLOWLIST` — allowed.

LAN, Docker bridge, Kubernetes pod, and Tailscale-style private-network callers now require Basic Auth unless you set `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true`. This is the compatibility escape hatch for trusted private networks.

Non-loopback callers in the locked-down state receive a `403 Forbidden` with a message describing the ways out:

1. Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` (recommended for internet-facing servers).
2. Add the public IP / network to `IP_ALLOWLIST`.
3. Set `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true` to opt back into legacy unauthenticated private-network access.
4. Set `ALLOW_UNAUTHENTICATED_REMOTE=true` only when unauthenticated public access is intentional.

> Note: the private-network exemption applies only to the lockdown. Once you set Basic Auth credentials, the password is required from every IP except loopback and explicit `IP_ALLOWLIST` matches — including from your LAN. This matches the principle of least surprise: if you set a password, you mean it.

#### Customising the private-network list

The seven default ranges above cover the vast majority of LAN / Docker / Kubernetes / Tailscale setups. If they don't match your network — for example, you have a publicly-routable corporate `/16` that is technically outside RFC 1918 but you trust it, or you want to _drop_ a range you consider hostile — set `TRUSTED_PRIVATE_NETWORKS` to a comma-separated list of IPs / CIDRs. This **replaces** the defaults entirely, so include any of them you still want:

```
# Trust only my office subnet and a single specific home IP
TRUSTED_PRIVATE_NETWORKS=10.42.0.0/16,203.0.113.7

# Strip 10.0.0.0/8 from the defaults but keep the rest
TRUSTED_PRIVATE_NETWORKS=172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10,fc00::/7,fe80::/10
```

When unset, the built-in defaults are used.

### IP Allowlist

Restricts access at the network level. Set `IP_ALLOWLIST` to a comma-separated list of IPs or CIDR ranges:

```
IP_ALLOWLIST=192.168.1.0/24,203.0.113.42
```

When set, requests from any other address receive a `403 Forbidden`. Loopback addresses (`127.0.0.1`, `::1`) are **always** allowed so you cannot lock yourself out of local access.

Set `IP_ALLOWLIST_ENABLED=false` to keep the list configured while temporarily disabling enforcement (useful when troubleshooting from a new IP).

### HTTP Basic Auth

Requires a username and password on every request. Set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS`:

```
BASIC_AUTH_USER=alice
BASIC_AUTH_PASS=correct-horse-battery-staple
```

The browser will show a native password prompt the first time you visit the server and remember the credentials for the session. Leaving either variable empty disables auth.

The following requests are **exempt** from Basic Auth so you cannot lock yourself or trusted networks out:

- Loopback (`127.0.0.1`, `::1`) — if you're on the box itself, no password is needed.
- Any IP listed in `IP_ALLOWLIST` — if you've already vouched for a network at the IP layer, no second factor is required.
- The `/api/health` endpoint — so external uptime monitors and load balancers can probe the server without credentials.

> **Always pair Basic Auth with HTTPS** when exposing the server to the public internet — Basic Auth credentials are only base64-encoded, not encrypted. Set `SSL_CERT` and `SSL_KEY`, or front Marinara with a TLS-terminating reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel).

For sensitive deployments, also consider Tailscale or Cloudflare Access — they avoid exposing the port to the open internet entirely.

### Privileged APIs

Destructive or high-risk features require `ADMIN_SECRET` in addition to the global network/auth checks. The official client sends it as `X-Admin-Secret` after you save it in **Settings -> Advanced -> Admin Access**. These APIs fail closed when `ADMIN_SECRET` is unset or wrong:

- Admin data clearing and expunge.
- Backup create/download/delete, profile export, and profile import. Profile exports redact obvious secret/token/password/API-key fields by default.
- SillyTavern bulk import scan/run and folder picker/browser.
- Update apply. Update check remains read-only.
- Sidecar runtime install/reinstall, restart, model download/cancel/delete.
- Custom tool create/update/delete; script tools also require `CUSTOM_TOOL_SCRIPT_ENABLED=true`.
- Haptic connect/disconnect/scan/command/stop-all.

### Local URL Opt-Ins

Outbound provider, image, TTS, DeepLX, and webhook requests reject private/LAN/metadata destinations by default to prevent SSRF. Provider calls allow loopback endpoints (`127.0.0.1`, `::1`, `localhost`) so local OpenAI-compatible servers keep working on single-machine installs. Explicit ComfyUI and AUTOMATIC1111 image connections may use loopback or LAN/private-network hosts because those backends are normally self-hosted. Enable only the feature-specific switch you need for other non-loopback self-hosted services, such as `PROVIDER_LOCAL_URLS_ENABLED=true` for a LAN OpenAI-compatible endpoint or `IMAGE_LOCAL_URLS_ENABLED=true` for a custom image proxy on another private-network host.

Security headers and API rate limits are enabled by default. Chat HTML is sanitized after rendering transforms; SVG uploads/proxies are not accepted for avatar/background/image upload paths.

## Notes

- The shell launchers (`start.bat`, `start.sh`, `start-termux.sh`) source `.env` automatically. If you run `pnpm start` directly, make sure the variables are set in your environment or `.env` file.
- Container deployments can pass variables via `docker run -e` flags or a `docker-compose.yml` `environment` block instead of a `.env` file.
- `HOST=0.0.0.0` is required for LAN access. The shell launchers default to this, but `pnpm start` binds to `127.0.0.1` unless overridden.
