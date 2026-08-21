import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { buildCompanionUi } from "./src/main/companion/buildUi";

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: "src/main/app/main.ts",
      },
    },
    // Bundle local workspace packages (raw TS with NodeNext .js imports)
    // into the main bundle — they must not be left external, or Node ESM would
    // load untranspiled src/*.ts at runtime.
    plugins: [
      externalizeDepsPlugin({ exclude: ["@pi-desk/code-index", "@pi-desk/session-todo", "@pi-desk/mcp-bridge", "pi-mcp-adapter"] }),
      // pi-mcp-adapter's sampling-handler imports `complete` from the pi-ai
      // root entry, but pi-ai only exports it from the compat entrypoint (which
      // re-exports everything from index). Rewrite the specifier in the bundled
      // adapter source so it resolves to @earendil-works/pi-ai/compat at
      // runtime; pi-ai itself stays external (no duplicate inlined copy).
      {
        name: "pi-ai-root-to-compat",
        enforce: "pre",
        transform(code, id) {
          if (id.includes("pi-mcp-adapter")) {
            return code.replace(/from "@earendil-works\/pi-ai"/g, 'from "@earendil-works/pi-ai/compat"');
          }
          return null;
        },
      },
    ],
  },
  preload: {
    build: {
      lib: {
        entry: "src/preload/index.ts",
      },
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "preload.cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: "companion-iife",
        // Vite empties outDir after buildStart, so write after emit.
        async closeBundle() {
          await buildCompanionUi();
        },
        configureServer() {
          void buildCompanionUi();
        },
      },
    ],
  },
});
