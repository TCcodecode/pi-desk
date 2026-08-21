import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function buildCompanionUi(outDir = join(root, "out/renderer")): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(root, "src/renderer/companion.html"), join(outDir, "companion.html"));
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/renderer/companion/main.tsx")],
    bundle: true,
    format: "iife",
    outfile: join(outDir, "companion-app.js"),
    jsx: "automatic",
    minify: true,
    target: ["es2017"],
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "css" },
  });
}
