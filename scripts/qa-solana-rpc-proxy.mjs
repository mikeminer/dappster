import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const frontendShell = await readFile(new URL("../lib/frontend-shell.ts", import.meta.url), "utf8")
const solanaFrontend = await readFile(new URL("../lib/solana-frontend.ts", import.meta.url), "utf8")
const proxyRoute = await readFile(new URL("../app/api/public/solana-rpc/route.ts", import.meta.url), "utf8")

assert.match(frontendShell, /solanaBrowserRpcUrl\(solanaCluster\)/)
assert.match(frontendShell, /buildSolanaRuntimeCompatibilityScript\(solanaIdl, solanaCluster\)/)
assert.doesNotMatch(frontendShell, /solanaRpcUrl:[\s\S]{0,180}api\.mainnet-beta\.solana\.com/)
assert.match(solanaFrontend, /DAPPSTER_SOLANA_RPC_PROXY/)
assert.match(solanaFrontend, /https:\/\/dappster\.fun\/api\/public\/solana-rpc/)
assert.match(solanaFrontend, /\?cluster=\$\{cluster\}/)
assert.match(proxyRoute, /process\.env\.SOLANA_MAINNET_RPC_URL/)
assert.match(proxyRoute, /process\.env\.SOLANA_DEVNET_RPC_URL/)
assert.match(proxyRoute, /"https:\/\/solana-rpc\.publicnode\.com"/)
assert.match(proxyRoute, /retryableRpcFailure/)
assert.match(proxyRoute, /ALLOWED_METHODS/)
assert.match(proxyRoute, /enforceRateLimit/)

console.log("Solana browser RPC proxy checks passed")
