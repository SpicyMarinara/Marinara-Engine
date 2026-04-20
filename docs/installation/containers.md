# Run via Container (Docker / Podman)

## Pre-built Image (Docker)

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

## Build from Source (Docker)

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
