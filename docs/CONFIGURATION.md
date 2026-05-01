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
| `IP_ALLOWLIST_ENABLED`           | `true`                                                   | Master switch for `IP_ALLOWLIST`. Set to `false`, `0`, `no`, or `off` to keep the list configured but disable enforcement.                                     |
| `BASIC_AUTH_USER`                | _(empty)_                                                | Username for HTTP Basic Auth. Set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` to require a password on every request. Leave either empty to disable auth.     |
| `BASIC_AUTH_PASS`                | _(empty)_                                                | Password for HTTP Basic Auth. Use a strong, random value.                                                                                                      |
| `BASIC_AUTH_REALM`               | `Marinara Engine`                                        | Realm string shown in the browser password prompt.                                                                                                             |
| `ALLOW_UNAUTHENTICATED_REMOTE`   | `false`                                                  | When neither Basic Auth nor an `IP_ALLOWLIST` entry vouches for a public-internet IP, requests are refused by default. Private-network IPs (RFC 1918, CGNAT, IPv6 ULA / link-local) are always allowed. Set to `true` to allow unauthenticated **public** access (NOT recommended on internet-facing servers). |
| `TRUSTED_PRIVATE_NETWORKS`       | _(built-in defaults)_                                    | Comma-separated IPs / CIDRs that bypass the no-auth lockdown. When set, **replaces** the defaults (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `fc00::/7`, `fe80::/10`) — include any of the defaults you still want. Useful if you want to drop a range you consider untrusted (e.g. a publicly-routable corporate /16) or substitute your own list. |
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

## Access Control

Marinara Engine ships with layered access-control mechanisms designed for users who expose the server beyond their local machine.

### Safe-by-default lockdown

By default, when no Basic Auth credentials are configured, the server **refuses connections from public-internet IPs**. Local and private-network traffic continues to work without any configuration:

- Loopback (`127.0.0.1`, `::1`) — always allowed.
- RFC 1918 private networks: `10.0.0.0/8`, `172.16.0.0/12` (covers Docker default bridge `172.17.0.0/16`), `192.168.0.0/16` — allowed automatically.
- Link-local (`169.254.0.0/16`) and IPv6 ULA / link-local (`fc00::/7`, `fe80::/10`) — allowed automatically.
- CGNAT range `100.64.0.0/10` (Tailscale, carrier NAT) — allowed automatically.
- Anything in `IP_ALLOWLIST` — allowed.

This means Docker containers, Kubernetes pods, your phone on the LAN, and Tailscale peers all "just work" without any extra config. Only requests from genuinely public IPs are blocked, which is the case that needs protecting when a port gets accidentally exposed.

Public callers in the locked-down state receive a `403 Forbidden` with a message describing the three ways out:

1. Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` (recommended for internet-facing servers).
2. Add the public IP / network to `IP_ALLOWLIST`.
3. Set `ALLOW_UNAUTHENTICATED_REMOTE=true` to opt back into the legacy "anyone can connect" behaviour for public IPs as well. Only do this if the network itself is already trusted.

> Note: the private-network exemption applies only to the lockdown. Once you set Basic Auth credentials, the password is required from every IP except loopback and explicit `IP_ALLOWLIST` matches — including from your LAN. This matches the principle of least surprise: if you set a password, you mean it.

#### Customising the private-network list

The seven default ranges above cover the vast majority of LAN / Docker / Kubernetes / Tailscale setups. If they don't match your network — for example, you have a publicly-routable corporate `/16` that is technically outside RFC 1918 but you trust it, or you want to *drop* a range you consider hostile — set `TRUSTED_PRIVATE_NETWORKS` to a comma-separated list of IPs / CIDRs. This **replaces** the defaults entirely, so include any of them you still want:

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

## Notes

- The shell launchers (`start.bat`, `start.sh`, `start-termux.sh`) source `.env` automatically. If you run `pnpm start` directly, make sure the variables are set in your environment or `.env` file.
- Container deployments can pass variables via `docker run -e` flags or a `docker-compose.yml` `environment` block instead of a `.env` file.
- `HOST=0.0.0.0` is required for LAN access. The shell launchers default to this, but `pnpm start` binds to `127.0.0.1` unless overridden.
