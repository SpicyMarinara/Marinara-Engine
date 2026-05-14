# Troubleshooting

Common issues and fixes for Marinara Engine. Platform-specific installation problems are also covered in each [installation guide](INSTALLATION.md).

---

## Windows: `EPERM: operation not permitted` when installing pnpm

If you see an error like `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarnpkg'` or a corepack signature verification failure, corepack could not write to `C:\Program Files\nodejs\`.

**Fix — pick one:**

1. **Run as Administrator** — Right-click your terminal (CMD or PowerShell), select "Run as administrator", then run `start.bat` again.
2. **Install pnpm manually** — Run `npm install -g pnpm`, then run `start.bat` again. A newer pnpm is fine; the launcher no longer requires Corepack to provide one exact patch version.
3. **Update corepack** — Run `npm install -g corepack`, `corepack enable`, and `corepack prepare pnpm@10.33.2 --activate` in an Administrator terminal.

---

## Data Seems Missing After an Update

If your chats or presets appear to be missing after updating, **do not delete any data folders yet**. Marinara v1.5.7 stores live user data in `DATA_DIR/storage`, and older installs may also have a legacy `marinara-engine.db` file that can be imported.

Check both local data locations:

1. `packages/server/data/`
2. `data/`

Look for `storage/manifest.json` first. If it does not exist, look for `marinara-engine.db` plus any `-wal` and `-shm` companion files. The server logs the resolved `DATA_DIR`, `FILE_STORAGE_DIR`, and legacy import source on startup. On the first v1.5.7 launch, Marinara imports the old DB into `DATA_DIR/storage` automatically.

---

## App Not Loading on Mobile / Another Device

If you're accessing Marinara Engine from a phone or tablet on the same network and it won't connect:

- Make sure the server is bound to `0.0.0.0`, not `127.0.0.1`. The shell launchers (`start.sh`, `start-termux.sh`) default to `0.0.0.0`. If you started manually with `pnpm start`, set `HOST=0.0.0.0` in `.env` first.
- Configure `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` for ordinary LAN or public clients. Loopback remains passwordless, and Tailscale plus Docker bridge clients are trusted by default unless you set `BYPASS_AUTH_TAILSCALE=false` or `BYPASS_AUTH_DOCKER=false`.
- If you need privileged features from that device, set `ADMIN_SECRET` on the server and save it in **Settings -> Advanced -> Admin Access**.
- On mixed-trust networks, prefer `IP_ALLOWLIST` for specific trusted LAN/private-network client IPs or CIDRs instead of enabling the global `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK` compatibility switch. Configure it on the server and keep `ADMIN_SECRET` set for privileged actions.
- The compatibility switch `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true` restores old unauthenticated LAN behavior outside the default trusted Tailscale and Docker bridge ranges, but only use it on a trusted private network.
- If a save appears to succeed in the UI but does not persist (preset, persona, or settings reverts on reload), check the browser for a Marinara "Save blocked: origin not trusted" toast and the server log for `[csrf] Rejected request:`. Loopback, LAN, Tailscale (100.64.0.0/10), and Docker bridge (172.16.0.0/12) origins are auto-trusted when the browser's URL is an IP literal, so this usually only happens when you reach Marinara through a public IP or DNS name. Add it to `CSRF_TRUSTED_ORIGINS` in `.env` — comma-separated for multiple origins, for example `CSRF_TRUSTED_ORIGINS=http://203.0.113.10:7831,https://chat.example.com`. Use `*` only on a fully trusted private setup. No restart needed.
- Verify both devices are on the same Wi-Fi network.
- Check that no firewall is blocking port `7860` (or your configured `PORT`).

See the [LAN / mobile access FAQ](FAQ.md#how-do-i-access-marinara-engine-from-my-phone-or-another-device) for full setup details.

---

## Android APK Stuck on Connecting or Waiting for Server

The APK is not a standalone Marinara Engine app. It is a WebView shell that opens the local Termux server on the same Android device.

If the APK stays on the connection screen:

1. Open Termux.
2. Go to the Marinara Engine folder.
3. Run `./start-termux.sh`.
4. Wait for the launcher to finish and start the server.
5. Open the APK again.

Also confirm the APK and Termux use the same port. The default is `7860`; if you built the APK with `MARINARA_PORT=9000`, set `PORT=9000` in Termux's `.env` too.

---

## Server Starts but Browser Shows a Blank Page

- Clear the browser cache or do a hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).
- If you're using the PWA, unregister the service worker in DevTools → Application → Service Workers, then reload.
- Confirm the client was built successfully — run `pnpm build` and check for errors.

---

## Backup or Export Profile Returns 403

Loopback/local browser sessions can create backups and profile exports without an `ADMIN_SECRET` by default. If you are accessing Marinara from another device, Docker host, LAN address, or Tailscale address, privileged actions still require `ADMIN_SECRET` on the server plus the same value saved in **Settings -> Advanced -> Admin Access**.

If you intentionally want loopback to require the same secret, set `MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK=true`.

---

## Legacy Database Errors on Startup

The default v1.5.7 storage path no longer uses the persistent SQLite file as live storage. If you see legacy database or Drizzle migration errors after updating, remove any custom `STORAGE_BACKEND=sqlite` override and restart Marinara. The file-native backend imports the old `marinara-engine.db` automatically on first launch and then runs without database migrations.

---

## Spotify DJ Login Fails on a Remote or LAN Install

The Spotify DJ agent uses OAuth, and Spotify [tightened its redirect-URI rules in February 2025](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify): registered redirect URIs must be either `https://<any-host>` or one of the loopback literals `http://127.0.0.1` / `http://[::1]`. `localhost` and LAN IPs (e.g. `http://192.168.1.42:7860`) are rejected at registration. That means the redirect URI Marinara shows in the agent editor depends on how you reach the server:

- **Localhost** — the editor shows `http://127.0.0.1:<PORT>/api/spotify/callback`. Register that and the popup callback completes normally.
- **HTTPS deployment** — when the request reaches Marinara as `https://...` (own TLS via `SSL_CERT`/`SSL_KEY`, or a reverse proxy that sends `X-Forwarded-Proto: https`), the editor shows `https://<your-host>/api/spotify/callback`. Register that.
- **HTTPS terminated upstream where the request host doesn't match the public URL** — set `SPOTIFY_REDIRECT_URI=https://your-public-host/api/spotify/callback` in `.env` and Marinara will use it verbatim.
- **Plain-HTTP LAN/remote install** (Marinara on machine A, browser on machine B, no TLS) — Spotify won't accept `http://192.168.x.y:7860/...`, so the editor still shows the `127.0.0.1` URI. Register that anyway. The popup will fail to load on machine B (it's pointing at machine B's loopback, where nothing is listening), but the URL Spotify redirected to still contains the valid `code` and `state`. **Copy the full URL from the popup's address bar, then expand "Browser couldn't reach the callback?" under the Connect button and paste it.** Marinara will complete the token exchange server-side. The pasted URL is valid for 10 minutes.

If you'd prefer to avoid the paste-back step on a LAN install, the cleanest fix is to put the server behind HTTPS — even a self-signed cert or a reverse proxy on your LAN works.

---

## Container: Permission Denied on Volume Mount

If a Docker or Podman container fails with permission errors on the data volume:

- **Named volumes after updating:** The official images repair `/app/data` ownership at startup, then drop back to the non-root runtime user. Pull the latest image and restart with `docker compose pull && docker compose up -d`.
- **Bind mounts:** Make the host directory writable by UID/GID `1000`, or use a named volume. If your filesystem blocks container `chown`, fix ownership on the host instead.
- **SELinux (Fedora, RHEL):** Add the `:Z` suffix to the volume mount — e.g., `-v marinara-data:/app/data:Z`.
- **Rootless Podman:** Make sure the host directory is owned by your user, or use a named volume instead of a bind mount.

---

## Lite Container Crashes on Raspberry Pi 4 / Cortex-A72

If the lite container silently restarts when it sends an outgoing LLM API request on a Raspberry Pi 4 or another Cortex-A72-class ARM device, check the container exit code. Exit `132` or `SIGILL` points to a known upstream Wolfi `nodejs-24` aarch64 regression on CPUs without the optional `pmull` feature. Known affected lite images include `1.5.7-lite`, `1.5.8-lite`, and the `:lite` tag published for v1.5.8 on 2026-05-05.

The regular Debian-based `:latest` image is not affected. Until Wolfi publishes a fixed Node package, use one of these workarounds:

- Use `ghcr.io/pasta-devs/marinara-engine:latest` on the affected device.
- Pin the last known-good lite image by digest:

  ```yaml
  image: ghcr.io/pasta-devs/marinara-engine@sha256:726b3c82468a1e1b0ed84579c754202d700e8cf27861465d1c41fd2dc99adab8
  ```

The upstream tracker is [wolfi-dev/os#78694](https://github.com/wolfi-dev/os/issues/78694). Marinara's project tracker is [Pasta-Devs/Marinara-Engine#449](https://github.com/Pasta-Devs/Marinara-Engine/issues/449).

---

## Sprite Background Cleanup Still Leaves White Panels

The built-in sprite cleanup is a matte remover. It works for simple white backgrounds, but generated sprite sheets can contain disconnected white panels, shadows, gutters, or white clothing/hair that are hard to separate with thresholds.

For stronger cleanup, install the optional open-source AI background remover:

```bash
pnpm backgroundremover:install
```

Then restart Marinara and click **Reapply Cleanup** in the sprite generation review screen. If install fails:

- Make sure Python 3.9-3.11 is installed (`python3 --version` or `py -3.11 --version` on Windows). Python 3.12+ may force native `numba`/`llvmlite` builds on some machines.
- Rebuild the runtime with `pnpm backgroundremover:reinstall`.
- Set `SPRITE_BACKGROUND_REMOVAL_ENGINE=builtin` to force the old built-in cleanup while troubleshooting.
- First use may take longer because `backgroundremover` downloads U2Net model files into `DATA_DIR/background-remover/models`.
- If logs mention a corrupted U2Net model, delete the reported `.pth` cache file and retry. Marinara pins its own cache under `DATA_DIR/background-remover/models` and retries once automatically if that managed cache is incomplete.

---

## Still Stuck?

- Check the [open issues](https://github.com/Pasta-Devs/Marinara-Engine/issues) on GitHub.
- [Join the Discord](https://discord.com/invite/KdAkTg94ME) for community help.
- File a [bug report](https://github.com/Pasta-Devs/Marinara-Engine/issues/new?template=issue_report.md) with your OS, Node.js version, and the full error output.
