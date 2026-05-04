// ──────────────────────────────────────────────
// Fastify App Factory
// ──────────────────────────────────────────────
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { getDB, closeDB, type DB } from "./db/connection.js";
import { registerRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { ipAllowlistHook } from "./middleware/ip-allowlist.js";
import { basicAuthHook } from "./middleware/basic-auth.js";
import { csrfProtectionHook } from "./middleware/csrf-protection.js";
import { rateLimitHook } from "./middleware/rate-limit.js";
import { securityHeadersHook } from "./middleware/security-headers.js";
import { runMigrations } from "./db/migrate.js";
import { seedDefaultPreset } from "./db/seed.js";
import { seedProfessorMari } from "./db/seed-mari.js";
import { seedDefaultConnection } from "./db/seed-connection.js";
import { seedDefaultBackgrounds } from "./db/seed-backgrounds.js";
import { seedDefaultGameAssets } from "./db/seed-game-assets.js";
import { seedDefaultRegexScripts } from "./db/seed-regex.js";
import { buildAssetManifest } from "./services/game/asset-manifest.service.js";
import { recoverGalleryImages } from "./services/storage/gallery-recovery.js";
import { APP_VERSION } from "@marinara-engine/shared";
import { existsSync } from "fs";
import { basename, join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBuildCommit, getBuildLabel } from "./config/build-info.js";
import {
  getCorsConfig,
  getLogLevel,
  getNodeEnv,
  isFileStorageBackend,
  isAutoCreateDefaultConnectionDisabled,
} from "./config/runtime-config.js";
import { sidecarProcessService } from "./services/sidecar/sidecar-process.service.js";

const isLite = process.env.MARINARA_LITE === "true" || process.env.MARINARA_LITE === "1";
const REVALIDATE_FILES = new Set(["index.html"]);
const NO_STORE_FILES = new Set(["manifest.json", "sw.js", "registerSW.js"]);
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export async function buildApp(https?: { cert: Buffer; key: Buffer }) {
  const corsConfig = getCorsConfig();
  const app = Fastify({
    logger: {
      level: getLogLevel(),
      transport: getNodeEnv() !== "production" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
    },
    bodyLimit: MAX_UPLOAD_BYTES, // Large profile imports can include many base64 avatars.
    ...(https && { https }),
  });

  // ── Plugins ──
  await app.register(cors, corsConfig);

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
    },
  });

  // ── Database ──
  const db = await getDB();
  app.decorate("db", db);
  app.addHook("onClose", async () => {
    try {
      await sidecarProcessService.stop();
    } catch (err) {
      app.log.error(err, "Failed to stop sidecar during shutdown");
    } finally {
      await closeDB();
    }
  });

  // ── Legacy SQLite migrations (file-native storage imports old DBs without runtime migrations) ──
  if (!isFileStorageBackend()) {
    await runMigrations(db);
  }

  // ── Seed defaults ──
  await seedDefaultPreset(db);
  await seedProfessorMari(db);
  if (isAutoCreateDefaultConnectionDisabled()) {
    app.log.info("Skipping default OpenRouter Free connection seed because AUTO_CREATE_DEFAULT_CONNECTION is disabled");
  } else {
    await seedDefaultConnection(db);
  }
  await seedDefaultRegexScripts(db);
  await seedDefaultBackgrounds();
  await seedDefaultGameAssets();

  // ── Build game asset manifest (scans game-assets + user backgrounds) ──
  buildAssetManifest();

  // ── Recover orphaned gallery images (files on disk without DB records) ──
  await recoverGalleryImages(db);

  // ── Security headers ──
  app.addHook("onRequest", securityHeadersHook);

  // ── IP Allowlist ──
  app.addHook("onRequest", ipAllowlistHook);

  // ── HTTP Basic Auth ──
  app.addHook("onRequest", basicAuthHook);

  // ── Lightweight API abuse throttling ──
  app.addHook("onRequest", rateLimitHook);

  // ── CSRF / Origin protection for unsafe API requests ──
  app.addHook("onRequest", csrfProtectionHook);

  // ── Prevent caching of API JSON responses ──
  // Without explicit Cache-Control, browsers apply heuristic caching which
  // can return stale data when React Query refetches after mutations.
  // This caused messages to vanish after generation because the refetch
  // returned a cached response without the newly saved message.
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/api/") && !reply.hasHeader("Cache-Control")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  // ── Error Handler ──
  app.setErrorHandler(errorHandler);

  // ── Routes ──
  await registerRoutes(app);

  // ── Sidecar bootstrap (background, skipped in lite mode) ──
  if (!isLite) {
    void sidecarProcessService
      .syncForCurrentConfig({ suppressKnownFailure: true, allowRuntimeInstall: false })
      .catch((error) => {
        app.log.warn({ err: error }, "sidecar bootstrap failed");
      });
  }

  // ── Serve client build in production ──
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(__dirname, "..", "..", "client", "dist");
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
      wildcard: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        const fileName = basename(filePath);

        if (REVALIDATE_FILES.has(fileName)) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return;
        }

        if (NO_STORE_FILES.has(fileName)) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return;
        }

        if (/\.[A-Za-z0-9_-]{8,}\.(css|js)$/.test(fileName)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });

    // SPA fallback — serve index.html for non-API routes
    app.setNotFoundHandler(async (req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not Found" });
      }

      reply.header("Cache-Control", "no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
      return reply.sendFile("index.html", clientDist);
    });
  }

  // ── Health Check ──
  app.get("/api/health", async () => {
    const commit = getBuildCommit();
    return {
      status: "ok",
      version: APP_VERSION,
      commit,
      build: getBuildLabel(),
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

// Type augmentation so routes can access `fastify.db`
declare module "fastify" {
  interface FastifyInstance {
    db: DB;
  }
}
