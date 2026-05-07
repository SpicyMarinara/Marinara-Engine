# Run via Container (Docker / Podman)

## Docker

### Pre-built Image

```bash
docker compose up -d
```

Then open **<http://127.0.0.1:7860>**.

Compose binds to `127.0.0.1` by default. To expose the container to your LAN, change the port mapping to `${PORT:-7860}:7860`, set `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`, and `ADMIN_SECRET`, then restart. See [Access Control](../CONFIGURATION.md#access-control).

Data (file-backed storage, uploads, fonts, default backgrounds) is stored in the named volume `marinara-data`. To inspect it:

```bash
docker volume inspect marinara-data
```

On startup, the official image repairs ownership of `/app/data` for named volumes, then drops back to the non-root runtime user. This lets older Docker installs migrate to file-backed storage without manual `chown` steps.

To pull the latest image and restart:

```bash
docker compose down && docker compose pull && docker compose up -d
```

### Build from Source

If you prefer to build the image yourself:

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
docker build -t marinara-engine .
docker run -d -p 127.0.0.1:7860:7860 -v marinara-data:/app/data marinara-engine
```

## Podman

Podman is a drop-in replacement for Docker with better security features. Rootless mode is supported out of the box — no daemon required.

**Pre-built image:**

```bash
podman compose up -d
```

Or:

```bash
podman run -d -p 127.0.0.1:7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:latest
```

> **Note:** `podman compose` requires the [`podman-compose`](https://github.com/containers/podman-compose/) plugin. On most distributions you can install it with `sudo dnf install podman-compose` (Fedora), `sudo apt install podman-compose` (Debian/Ubuntu), or `pip install podman-compose`.

## Lite Image (Optional)

A **lite** image variant is available that trades some offline features for a significantly smaller footprint (~60 % smaller than the full image). It is built on [Wolfi](https://wolfi.dev/) — a minimal, CVE-focused Linux (un)distribution designed for containers.

> **Raspberry Pi 4 / Cortex-A72 note:** Known affected lite images include `1.5.7-lite`, `1.5.8-lite`, and the `:lite` tag published for v1.5.8 on 2026-05-05. They can crash with `SIGILL` on Pi 4-class ARM CPUs during outgoing LLM API calls because of an upstream Wolfi `nodejs-24` aarch64 regression. Until Wolfi publishes a fixed Node package, use the regular `:latest` image on those devices, or pin the last known-good lite image by digest:
>
> ```yaml
> image: ghcr.io/pasta-devs/marinara-engine@sha256:726b3c82468a1e1b0ed84579c754202d700e8cf27861465d1c41fd2dc99adab8
> ```
>
> See [Lite container crashes on Raspberry Pi 4 / Cortex-A72](../TROUBLESHOOTING.md#lite-container-crashes-on-raspberry-pi-4--cortex-a72) for details.

### What is removed

| Feature                                    | Why it’s heavy                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Local sidecar model (llama-server / Gemma) | Native runtime libs (`libssl`, `libgomp`, `libvulkan`), large model downloads |
| Local embedding model (all-MiniLM-L6-v2)   | `onnxruntime-node`, `onnxruntime-web`, `@huggingface/transformers`            |
| Memory recall (semantic search)            | Depends on the local embedding model                                          |

All core features — chat, roleplay, game mode, agents, lorebooks, characters, connections to remote LLM APIs — work exactly the same. You just need an external API connection (OpenRouter, OpenAI, Ollama, etc.) for all LLM features instead of being able to run a model locally via ME.

### Pre-built image

```bash
docker pull ghcr.io/pasta-devs/marinara-engine:lite
docker run -d -p 127.0.0.1:7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:lite
```

Or with Podman:

```bash
podman run -d -p 127.0.0.1:7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:lite
```

### Build from source

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
docker build -f Dockerfile.lite -t marinara-engine:lite .
docker run -d -p 127.0.0.1:7860:7860 -v marinara-data:/app/data marinara-engine:lite
```

> **Note:** The lite image is published alongside each versioned release (e.g. `ghcr.io/pasta-devs/marinara-engine:1.5.4-lite`). It is **not** published on every push to `main`.

## Updating

### Docker

Pull the latest image and restart:

```bash
docker compose down && docker compose pull && docker compose up -d
```

### Podman

```bash
podman compose down && podman compose pull && podman compose up -d
```

### In-App Update Check

You can also go to **Settings → Advanced → Updates** and click **Check for Updates**. For container installs, the UI shows the command to run: `docker compose pull && docker compose up -d`.

> Container images are published from `v*` release tags. Auto-update is not available for container installs; you pull new images manually.

---

## See Also

- [Configuration Reference](../CONFIGURATION.md) — environment variables and `.env` setup
- [Troubleshooting](../TROUBLESHOOTING.md) — common issues and fixes (includes container permission fixes)
