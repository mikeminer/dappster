import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const frontendShell = await readFile(resolve(root, "lib", "frontend-shell.ts"), "utf8")
const ipfsRoute = await readFile(resolve(root, "app", "ipfs", "[cid]", "route.ts"), "utf8")
const runtimeOrigin = "https://dappster.fun/runtime"
const expectedAssets = ["react.production.min.js", "react-dom.production.min.js", "babel.min.js"]

assert.match(frontendShell, new RegExp(runtimeOrigin.replaceAll(".", "\\.")))
for (const asset of expectedAssets) assert.match(frontendShell, new RegExp(asset.replaceAll(".", "\\.")))
assert.doesNotMatch(frontendShell, /<script[^>]+unpkg\.com\/(?:react|react-dom|@babel\/standalone)/)
assert.match(frontendShell, /export function rewritePreviewDependencies/)
assert.match(ipfsRoute, /rewritePreviewDependencies\(await upstream\.text\(\)\)/)

for (const asset of expectedAssets) {
  await access(resolve(root, "public", "runtime", asset))
}

console.log("Preview runtime QA passed: generated and legacy shells use Dappster-hosted dependencies.")
