import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * Monaco vendors its own copy of DOMPurify (esm/vs/base/browser/dompurify/dompurify.js) instead of
 * importing the npm package, so a package override alone would not change what ships. This points
 * that one import at the npm package, which pnpm-workspace.yaml pins to a patched version. Both
 * export the same default DOMPurify instance. Remove with the override (issue #41).
 */
function patchedDompurify(): Plugin {
  return {
    name: "panoptic:patched-dompurify",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer?.includes("monaco-editor") || !source.endsWith("dompurify/dompurify.js")) return null;
      return this.resolve("dompurify", importer, { skipSelf: true });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [patchedDompurify(), svelte()],

  build: {
    // WebView2 is evergreen Chromium, so target it directly (top-level await, modern syntax).
    target: "chrome120",
    // Monaco is one ~3.3 MB chunk by design (core editor plus the contributions in docs/query-editor.md).
    // It is fetched when a connection is first selected and created when the first query tab opens
    // (ADR 0006), never at start-up, so the default 500 kB warning does not apply to it.
    chunkSizeWarningLimit: 3500,
    // Never inline assets as data: URIs. The CSP is default-src 'self' with no img-src, so a data: image
    // is blocked: the 1.6 KB logo, under the 4 KB default limit, showed in tauri dev but not in the
    // installed build. Emitting every asset as a file keeps the CSP as strict as it is.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: "index.html", bench: "bench.html" },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
