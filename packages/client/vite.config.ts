import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const ENABLE_SOURCE_MAPS = process.env.VITE_ENABLE_SOURCEMAP === "true";
const PWA_DISABLED = Boolean(process.env.SKIP_PWA);

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
  if (id.includes("@tanstack")) return "vendor-tanstack";
  if (id.includes("framer-motion")) return "vendor-motion";
  if (id.includes("zustand")) return "vendor-state";
  if (id.includes("lucide-react")) return "vendor-icons";
  if (id.includes("dompurify") || id.includes("sonner")) return "vendor-ui";

  return "vendor-misc";
}

function bundleBudget(): Plugin {
  return {
    name: "bundle-budget",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((item): item is import("rollup").OutputChunk => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          sizeKb: Buffer.byteLength(chunk.code, "utf8") / 1024,
          isEntry: chunk.isEntry,
        }))
        .sort((a, b) => b.sizeKb - a.sizeKb);

      const lines = chunks.slice(0, 10).map((chunk) => {
        const label = chunk.isEntry ? "entry" : "chunk";
        return `  - ${chunk.fileName} (${label}, ${chunk.sizeKb.toFixed(2)} kB)`;
      });
      if (lines.length > 0) {
        console.log(["[bundle] Largest JS chunks:", ...lines].join("\n"));
      }

      const oversizedEntries = chunks.filter((chunk) => chunk.isEntry && chunk.sizeKb > 1000);
      if (oversizedEntries.length > 0) {
        this.error(
          `Main eager bundle exceeded 1000 kB: ${oversizedEntries
            .map((chunk) => `${chunk.fileName} (${chunk.sizeKb.toFixed(2)} kB)`)
            .join(", ")}`,
        );
      }

      const oversizedChunks = chunks.filter((chunk) => chunk.sizeKb > 500);
      if (oversizedChunks.length > 0) {
        this.error(
          `Chunk size warning budget exceeded: ${oversizedChunks
            .map((chunk) => `${chunk.fileName} (${chunk.sizeKb.toFixed(2)} kB)`)
            .join(", ")}`,
        );
      }
    },
  };
}

/** Stub for virtual:pwa-register when the real PWA plugin is skipped (e.g. Termux). */
function pwaStub(): Plugin {
  const id = "virtual:pwa-register";
  const resolved = "\0" + id;
  return {
    name: "pwa-stub",
    resolveId(source) {
      if (source === id) return resolved;
    },
    load(loadedId) {
      if (loadedId === resolved) return "export function registerSW() { return () => {}; }";
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    bundleBudget(),
    !PWA_DISABLED
      ? VitePWA({
          injectRegister: false,
          registerType: "autoUpdate",
          devOptions: { enabled: false },
          manifest: false, // We use the static manifest.json in public/
          workbox: {
            // Intentionally exclude html so index.html is not precached and does not interfere with the PWA stale-version/update flow.
            globPatterns: ["**/*.{js,css,png,svg,ico,woff2}"],
            navigateFallbackAllowlist: [],
            runtimeCaching: [
              {
                urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/"),
                handler: "NetworkOnly",
              },
            ],
          },
        })
      : pwaStub(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT ?? 7860}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: ENABLE_SOURCE_MAPS,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  esbuild: {
    // Strip debug console.log in production; keep warn/error
    pure: process.env.NODE_ENV === "production" ? ["console.log"] : [],
  },
});
