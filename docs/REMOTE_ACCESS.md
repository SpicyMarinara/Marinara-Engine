# Remote Access — Setting Up Basic Auth or an IP Allowlist

If you're seeing **`403 Forbidden`** when you try to open Marinara Engine from a phone, a Docker container, a Tailscale device, or any other machine that isn't the one running the server, this guide is for you.

By default Marinara only answers requests from three trusted sources:

1. **Loopback** (`127.0.0.1` / `::1`) — the machine running the server itself.
2. **Your Tailnet** (`100.64.0.0/10`) — Tailscale peers, since joining your tailnet already required your Tailscale account.
3. **Docker containers on the same host** (`172.16.0.0/12`) — bridge IPs aren't reachable from outside the host.

Anything else — your phone on the same Wi-Fi, a public-internet client, a coffee-shop laptop — gets blocked until you tell Marinara who's allowed in. If those defaults are too permissive for your setup (rare; see [Option 4](#option-4-tailscale-or-docker-bypass-interface-scoped-on-by-default)), set `BYPASS_AUTH_TAILSCALE=false` / `BYPASS_AUTH_DOCKER=false`.

> **TL;DR** — If you only ever access Marinara over Tailscale, or only from Docker containers on the same host, **you don't need to do anything** — it already works. If you also want to reach it from a phone on your home Wi-Fi or another LAN device: set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `.env`, restart, and use those credentials when the browser prompts. That covers 95% of cases.

## Which option do I pick?

| Your situation | Pick this | Section |
| --- | --- | --- |
| Tailscale, ZeroTier-on-100.64/10, or another VPN you control | **Already works** — no setup needed | [Option 4](#option-4-tailscale-or-docker-bypass-interface-scoped-on-by-default) |
| Docker / Podman container, accessing from the same host | **Already works** — no setup needed | [Option 4](#option-4-tailscale-or-docker-bypass-interface-scoped-on-by-default) |
| Phone, tablet, or laptop on your home Wi-Fi | **Basic Auth** | [Option 1](#option-1-basic-auth-recommended) |
| Public-internet exposure (custom domain, port forwarding) | **Basic Auth + HTTPS** | [Option 1](#option-1-basic-auth-recommended) + [HTTPS](#serving-over-https) |
| Stable LAN IPs and you'd rather not type a password | IP Allowlist | [Option 2](#option-2-ip-allowlist) |
| You want a password from your Tailnet / containers TOO | Disable Option 4 + use Option 1 | [Option 4](#option-4-tailscale-or-docker-bypass-interface-scoped-on-by-default) + [Option 1](#option-1-basic-auth-recommended) |
| You really, really don't want a password and your whole LAN is trusted | Private-network bypass | [Option 3](#option-3-private-network-bypass-no-password) |

Basic Auth is the most flexible choice — works from any IP, no per-device setup, and the browser remembers it. The IP Allowlist is handy when your client devices have stable IPs (Tailscale, static LAN leases) and you'd rather not type a password.

## Before you start: where's `.env`?

All access settings live in your `.env` file in the project root (next to `package.json`). If you don't have one yet:

```bash
cp .env.example .env
```

Edit it with any text editor. **Most security settings — Basic Auth credentials, IP allowlist, admin secret, CSRF origins — apply within a couple of seconds without a restart.** A handful of low-level settings (port, host, TLS cert paths, storage paths, encryption key) still need a restart; if a change you made isn't picked up, see [When a restart is required](#when-a-restart-is-required) below. Quick reference for each install method when you do need a restart:

- **Source install (Windows / macOS / Linux)** — close the launcher window, run `start.bat` / `start.sh` again.
- **Docker Compose** — `docker compose down && docker compose up -d`. You can also pass the variables in `docker-compose.yml` under `environment:` instead of using `.env`.
- **Termux (Android)** — Ctrl+C to stop, then `./start-termux.sh` again.

If you're running on a LAN or remote box and other devices still can't reach the server *at all* (different error than 403), make sure the server is binding to all interfaces with `HOST=0.0.0.0`. The shell launchers do this for you; `pnpm start` does not.

## Option 1: Basic Auth (recommended)

Add two lines to `.env`:

```env
BASIC_AUTH_USER=alice
BASIC_AUTH_PASS=correct-horse-battery-staple
```

Pick a strong, unique password — Basic Auth credentials travel with every request, so treat this like any other login. A passphrase or a generated string is better than a short password. Generate one with:

```bash
# macOS / Linux
openssl rand -base64 24

# Windows PowerShell
[Convert]::ToBase64String((1..18 | %{Get-Random -Max 256}))
```

Restart Marinara, then open it in your browser from the remote device. You'll see your browser's native password prompt — enter the username and password you set, and the browser will remember them for the rest of the session.

**What's exempt from the password:**

- Loopback (`127.0.0.1`, `::1`) — you don't need to type your password on the host machine itself.
- Anything in `IP_ALLOWLIST` — useful if you want some devices to skip the prompt (see below).
- Tailscale (`100.64.0.0/10`) and Docker bridge (`172.16.0.0/12`) traffic — bypassed by default; see [Option 4](#option-4-tailscale-or-docker-bypass-interface-scoped-on-by-default) to disable.
- `/api/health` — so uptime monitors and load balancers can keep working.

**Optional:** set `BASIC_AUTH_REALM` to customise the text the browser prompt shows (default is `Marinara Engine`).

> **Important:** if you're exposing the server to the public internet, pair Basic Auth with HTTPS. Basic Auth credentials are only base64-encoded, not encrypted — anyone watching the connection in plaintext can read them. See [Serving over HTTPS](#serving-over-https) below.

## Option 2: IP Allowlist

If you'd rather skip the password prompt and your client devices have stable IPs, set `IP_ALLOWLIST` to a comma-separated list of IPs or CIDR ranges:

```env
# Allow my whole home subnet plus a specific Tailscale address
IP_ALLOWLIST=192.168.1.0/24,100.64.1.7
```

Requests from any address that doesn't match (and isn't loopback) get a 403. Loopback is **always** allowed regardless of the list — you cannot lock yourself out of local access by misconfiguring this.

A few common patterns:

- **Home LAN** — `192.168.1.0/24` or `192.168.0.0/24` (check your router; 10.x and 172.16-31.x networks also exist).
- **Tailscale / Headscale** — your Tailnet's CGNAT range is typically `100.64.0.0/10`, but you can narrow to specific peer IPs from `tailscale status`.
- **Docker bridge** — usually `172.17.0.0/16`, but check `docker network inspect bridge` if you're routing between containers.
- **Single static address** — just the bare IP (e.g. `203.0.113.42`).

You can combine this with Basic Auth: anything in `IP_ALLOWLIST` skips the password prompt; everything else still has to authenticate. That's a nice setup for "no password from my house, password from anywhere else."

To temporarily disable enforcement without erasing your list (handy when troubleshooting from a new IP), set `IP_ALLOWLIST_ENABLED=false`.

## Option 3: Private-network bypass (no password)

If you're running on a fully trusted network — Docker on your own laptop, a personal Tailnet, your home LAN with no port forwarding — you can opt out of the lockdown without setting a password:

```env
ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true
```

This restores the legacy "open on the LAN, blocked from the public internet" behavior. It applies only to clients in standard private-network ranges:

`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10` (Tailscale CGNAT), `fc00::/7`, `fe80::/10`

Anything outside those ranges (i.e. public-internet IPs) still gets a 403. If your network uses a non-standard range or you want to trust a publicly-routable corporate subnet, override the list with `TRUSTED_PRIVATE_NETWORKS` — see [Configuration § Customising the private-network list](CONFIGURATION.md#customising-the-private-network-list).

> **Trade-off:** anyone on the same private network can reach Marinara without authenticating. That's fine on a network you control; it's not fine on shared Wi-Fi (coffee shop, airport, conference, dorm). When in doubt, use Option 1.

There is also `ALLOW_UNAUTHENTICATED_REMOTE=true` for unauthenticated public-internet access. **Do not turn this on.** If you genuinely need public access, use Basic Auth + HTTPS, or front Marinara with a reverse proxy that handles authentication (Cloudflare Access, Authelia, etc.).

## Option 4: Tailscale or Docker bypass (interface-scoped, on by default)

Two interface-scoped flags let traffic from a Tailnet or a Docker bridge skip both the IP allowlist *and* Basic Auth, the same way loopback does. **Both flags default to `true`**, so a fresh Marinara install reachable over Tailscale or from your Docker containers Just Works without any `.env` setup.

```env
# These are the defaults — listed here so you can see how to override them.
BYPASS_AUTH_TAILSCALE=true   # trusts 100.64.0.0/10 (Tailnet CGNAT)
BYPASS_AUTH_DOCKER=true      # trusts 172.16.0.0/12 (Docker bridge)
```

**Why these are safe by default:**

- A peer in your Tailnet already had to authenticate to your Tailscale account to be there. That's a stronger trust signal than "this packet came from your LAN" — anyone in the coffee shop is on your LAN. Almost no one in the coffee shop is on your tailnet.
- Docker bridge IPs are unreachable from outside the host. External traffic NATs through the bridge gateway and arrives with a different source IP, so a request that actually shows up with `172.17.x.x` or `172.18.x.x` genuinely came from a container on the same host as Marinara.

**Combines cleanly with Basic Auth:** if you set `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`, your Tailnet and Docker containers still skip the prompt while the rest of your LAN and any internet traffic still has to authenticate. That's the typical "no friction from my devices, password from anyone else" setup.

**When to set these to `false`:**

- **Your server's public connection is on a CGNAT'd ISP that uses `100.64.0.0/10`.** Some carrier-grade NAT setups use the same range Tailscale does. If that applies, an internet client could appear with a source IP that matches the bypass — and `BYPASS_AUTH_TAILSCALE=true` would let them in. To check, run `tailscale ip -4` and compare with the IP your ISP assigns to your WAN interface; if both are in `100.64.0.0/10`, either set `BYPASS_AUTH_TAILSCALE=false` or bind `HOST` to your `tailscale0` IP so the public NIC never sees the connection.
- **Your non-Docker LAN uses `172.16.x.x` / `172.20.x.x` addresses.** `BYPASS_AUTH_DOCKER=true` trusts the entire `172.16.0.0/12` block; non-Docker callers in that range would also bypass auth. Set `BYPASS_AUTH_DOCKER=false` and add the specific containers to `IP_ALLOWLIST` instead.
- **You genuinely want a password from your Tailnet / containers too** — set the corresponding flag to `false`.

The server logs an `[auth-bypass]` warning the first time a request actually exercises one of these flags, so you can confirm in the log when the bypass goes live.

## Serving over HTTPS

Two options when you're exposing Marinara beyond a trusted network:

1. **Built-in TLS** — set `SSL_CERT` and `SSL_KEY` to the paths of your certificate and private key. Use Let's Encrypt (`certbot`) or `mkcert` for local development.
2. **Reverse proxy** — front Marinara with nginx, Caddy, Traefik, or a Cloudflare Tunnel. The proxy handles TLS termination and you keep `BASIC_AUTH_*` on the Marinara side (or replace it with proxy-level auth).

For sensitive deployments, consider Tailscale or Cloudflare Access — they avoid exposing the port to the open internet entirely.

## When a restart is required

The server watches `.env` for changes and applies most updates within a couple of seconds — no restart needed. That includes `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` / `BASIC_AUTH_REALM`, `IP_ALLOWLIST` / `IP_ALLOWLIST_ENABLED`, `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK`, `ALLOW_UNAUTHENTICATED_REMOTE`, `TRUSTED_PRIVATE_NETWORKS`, `ADMIN_SECRET`, `CSRF_TRUSTED_ORIGINS`, `LOG_LEVEL`, and the various `*_LOCAL_URLS_ENABLED` / privileged-feature flags.

Changes to these still need a restart because they're bound at startup: `PORT`, `HOST`, `SSL_CERT`, `SSL_KEY`, `DATA_DIR`, `STORAGE_BACKEND`, `FILE_STORAGE_DIR`, `DATABASE_URL`, `ENCRYPTION_KEY`, `TZ`, `AUTO_OPEN_BROWSER`, `AUTO_CREATE_DEFAULT_CONNECTION`. The server logs a warning when one of these changes so you don't wonder why it didn't take effect. (Note: `CORS_ORIGINS` *is* hot-reloadable for adding/removing origins; only switching between an explicit list and `*` still needs a restart.)

## Verifying it works

After saving `.env` (and restarting if required), from your remote device:

1. Open `http://<host-ip>:7860` (or your container/Tailscale address).
2. Basic Auth: you should see a browser password prompt. Enter your credentials.
3. IP Allowlist: the page should load directly with no prompt.
4. Private-network bypass: the page should load directly with no prompt, **only** if your client IP is in a private-network range.

Still getting a 403? Check:

- Did you save `.env`? The server picks up most security changes within a couple of seconds; the server log will show an `[env-watcher] Updated:` line. If your change is on the [restart-required list](#when-a-restart-is-required), restart Marinara.
- Is the client IP what you expect? Marinara logs the blocked IP to the server console.
- For Docker: are you connecting to the published port, or directly to the container IP?
- For Tailscale: is the connecting device's `100.x.y.z` address in the allowlist (if you're using Option 2)?

Different error than 403?

- **Connection refused / timeout** — the server isn't bound to a reachable interface. Set `HOST=0.0.0.0` in `.env`.
- **404 / wrong page** — you're hitting the wrong port. Default is `7860`; check `PORT` in `.env`.
- **CORS error in the browser console** — Marinara's server log will show a `[cors]` line with the rejected origin and the exact `CORS_ORIGINS=…` line to add to `.env`. Adding it takes effect within ~2s — no restart needed.
- **`{"error": "Origin '…' is not in the trusted list (CSRF_TRUSTED_ORIGINS)."}`** — copy the offending origin into `CSRF_TRUSTED_ORIGINS` in `.env` (the error body's `hint` field has the exact line). No restart needed.
- **`Refused to fetch http://… : '…' is in a private, loopback, metadata, or reserved IP range.`** — Marinara is refusing to call your local LLM provider for SSRF safety. The error message names the exact env var to set (`PROVIDER_LOCAL_URLS_ENABLED` for LLMs, `IMAGE_LOCAL_URLS_ENABLED` for image generation, etc.). Setting it takes effect on the next request.

The full troubleshooting page is at [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## A note on privileged actions

Some destructive features (admin cleanup, backups, profile import/export, custom-tool creation, sidecar runtime install, etc.) require an additional shared secret called `ADMIN_SECRET`, on top of whatever access method you picked above. From a remote device you'll need to:

1. Set `ADMIN_SECRET=<some-strong-random-string>` in `.env` and restart.
2. Open Marinara on the remote device.
3. Go to **Settings → Advanced → Admin Access** and paste the same secret.

This is separate from Basic Auth. You can use both together — Basic Auth gates the app, `ADMIN_SECRET` gates the dangerous features.

## See also

- [Configuration Reference § Access Control](CONFIGURATION.md#access-control) — full env-var reference and edge cases.
- [FAQ § How do I access Marinara from my phone or another device?](FAQ.md#how-do-i-access-marinara-engine-from-my-phone-or-another-device) — quick walkthrough for the LAN case.
- [Troubleshooting](TROUBLESHOOTING.md) — connection issues, mobile access, Spotify on remote installs.
- [Container install guide](installation/containers.md) — Docker/Podman specifics.
