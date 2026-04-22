# Run via Container (Docker / Podman)

## Docker

### Pre-built Image

```bash
docker compose up -d
```

Then open **<http://127.0.0.1:7860>**.

Data (SQLite database, uploads, fonts, default backgrounds) is stored in the named volume `marinara-data`. To inspect it:

```bash
docker volume inspect marinara-data
```

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
docker run -d -p 7860:7860 -v marinara-data:/app/data marinara-engine
```

## Podman

Podman is a drop-in replacement for Docker with better security features. Rootless mode is supported out of the box — no daemon required.

**Pre-built image:**

```bash
podman compose up -d
```

Or:

```bash
podman run -d -p 7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:latest
```

> **Note:** `podman compose` requires the [`podman-compose`](https://github.com/containers/podman-compose/) plugin. On most distributions you can install it with `sudo dnf install podman-compose` (Fedora), `sudo apt install podman-compose` (Debian/Ubuntu), or `pip install podman-compose`.

## Lite Image (Optional)

A **lite** image variant is available that trades some offline features for a significantly smaller footprint (~60 % smaller than the full image). It is built on [Wolfi](https://wolfi.dev/) — a minimal, CVE-focused Linux (un)distribution designed for containers.

### What is removed

| Feature                                    | Why it’s heavy                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Local sidecar model (llama-server / Gemma) | Native runtime libs (`libssl`, `libgomp`, `libvulkan`), large model downloads |
| Local embedding model (all-MiniLM-L6-v2)   | `onnxruntime-node`, `onnxruntime-web`, `@huggingface/transformers`            |
| Memory recall (semantic search)            | Depends on the local embedding model                                          |
| `sharp` native image processing            | Platform-specific native binaries                                             |

All core features — chat, roleplay, game mode, agents, lorebooks, characters, connections to remote LLM APIs — work exactly the same. You just need an external API connection (OpenRouter, OpenAI, Ollama, etc.) for all LLM features instead of being able to run a model locally via ME.


### Pre-built image

```bash
docker pull ghcr.io/pasta-devs/marinara-engine:lite
docker run -d -p 7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:lite
```

Or with Podman:

```bash
podman run -d -p 7860:7860 -v marinara-data:/app/data ghcr.io/pasta-devs/marinara-engine:lite
```

### Build from source

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
docker build -f Dockerfile.lite -t marinara-engine:lite .
docker run -d -p 7860:7860 -v marinara-data:/app/data marinara-engine:lite
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
