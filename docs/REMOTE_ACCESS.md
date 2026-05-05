# Remote Access — Setting Up Basic Auth or an IP Allowlist

If you're seeing **`403 Forbidden`** when you try to open Marinara Engine from a phone, a Docker container, a Tailscale device, or any other machine that isn't the one running the server, this guide is for you.

By default Marinara only answers requests coming from the same machine (`127.0.0.1` / `::1`). Anything else — your phone on the same Wi-Fi, a Tailscale tablet, a browser hitting the Docker port — gets blocked until you tell Marinara who's allowed in. This is intentional: if your server ever ends up reachable from the public internet, an unprotected install would be wide open. The fix is to set up one of the access methods below and restart.

> **TL;DR** — If you just want it to work and you're on a network you trust (home Wi-Fi, Docker on your own machine, your own Tailnet): set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `.env`, restart, and use those credentials when the browser prompts. That covers 95% of cases.

## Which option do I pick?

| Your situation | Pick this | Section |
| --- | --- | --- |
| Phone, tablet, or laptop on your home Wi-Fi | **Basic Auth** | [Option 1](#option-1-basic-auth-recommended) |
| Docker / Podman container, accessing from the host or LAN | **Basic Auth** | [Option 1](#option-1-basic-auth-recommended) |
| Tailscale, ZeroTier, or another VPN you control | **Basic Auth** *or* IP Allowlist | [Option 1](#option-1-basic-auth-recommended) / [Option 2](#option-2-ip-allowlist) |
| Public-internet exposure (custom domain, port forwarding) | **Basic Auth + HTTPS** | [Option 1](#option-1-basic-auth-recommended) + [HTTPS](#serving-over-https) |
| You really, really don't want a password and your network is fully trusted | Private-network bypass | [Option 3](#option-3-private-network-bypass-no-password) |

Basic Auth is the most flexible choice — works from any IP, no per-device setup, and the browser remembers it. The IP Allowlist is handy when your client devices have stable IPs (Tailscale, static LAN leases) and you'd rather not type a password.

## Before you start: where's `.env`?

All access settings live in your `.env` file in the project root (next to `package.json`). If you don't have one yet:

```bash
cp .env.example .env
```

Edit it with any text editor. After saving, **restart Marinara** for changes to take effect. Quick reference for each install method:

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

## Serving over HTTPS

Two options when you're exposing Marinara beyond a trusted network:

1. **Built-in TLS** — set `SSL_CERT` and `SSL_KEY` to the paths of your certificate and private key. Use Let's Encrypt (`certbot`) or `mkcert` for local development.
2. **Reverse proxy** — front Marinara with nginx, Caddy, Traefik, or a Cloudflare Tunnel. The proxy handles TLS termination and you keep `BASIC_AUTH_*` on the Marinara side (or replace it with proxy-level auth).

For sensitive deployments, consider Tailscale or Cloudflare Access — they avoid exposing the port to the open internet entirely.

## Verifying it works

After restarting, from your remote device:

1. Open `http://<host-ip>:7860` (or your container/Tailscale address).
2. Basic Auth: you should see a browser password prompt. Enter your credentials.
3. IP Allowlist: the page should load directly with no prompt.
4. Private-network bypass: the page should load directly with no prompt, **only** if your client IP is in a private-network range.

Still getting a 403? Check:

- Did you restart the server after editing `.env`?
- Is the client IP what you expect? Marinara logs the blocked IP to the server console.
- For Docker: are you connecting to the published port, or directly to the container IP?
- For Tailscale: is the connecting device's `100.x.y.z` address in the allowlist (if you're using Option 2)?

Different error than 403?

- **Connection refused / timeout** — the server isn't bound to a reachable interface. Set `HOST=0.0.0.0` in `.env`.
- **404 / wrong page** — you're hitting the wrong port. Default is `7860`; check `PORT` in `.env`.
- **CORS error in the browser console** — set `CORS_ORIGINS` to include the URL you're connecting from (e.g. `http://192.168.1.10:7860`).

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
