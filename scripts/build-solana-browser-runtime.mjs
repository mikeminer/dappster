import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = resolve(root, "public", "runtime")

await mkdir(outputDirectory, { recursive: true })
await build({
  entryPoints: [resolve(root, "scripts", "solana-browser-runtime-entry.ts")],
  inject: [resolve(root, "scripts", "solana-browser-buffer-shim.ts")],
  outfile: resolve(outputDirectory, "solana-runtime.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  define: { global: "globalThis" },
  banner: { js: "/* Dappster self-hosted Solana runtime */" },
  legalComments: "none",
})

const browserRuntimeAssets = [
  ["react/umd/react.production.min.js", "react.production.min.js"],
  ["react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
  ["@babel/standalone/babel.min.js", "babel.min.js"],
]

await Promise.all(browserRuntimeAssets.map(([packagePath, outputName]) =>
  copyFile(resolve(root, "node_modules", packagePath), resolve(outputDirectory, outputName)),
))
