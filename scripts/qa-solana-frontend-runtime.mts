import assert from "node:assert/strict"
import { buildSolanaImportAliases, buildSolanaRuntimeCompatibilityScript } from "../lib/solana-frontend.ts"

const runtime = buildSolanaRuntimeCompatibilityScript()

assert.doesNotThrow(() => new Function(runtime))
assert.match(runtime, /window\.__DAPPSTER_SOLANA_RUNTIME__/)
assert.match(runtime, /modules\.phantomWalletAdapter \|\| \{\}/)
assert.match(runtime, /Object\.assign\(window, modules\.web3, modules\.anchor, modules\.splToken/)
assert.match(runtime, /runtime\.preview && window\.PublicKey/)
assert.match(runtime, /Replaced an invalid Solana public key/)
assert.match(runtime, /11111111111111111111111111111111/)
assert.match(runtime, /window\.SolanaWeb3 = modules\.web3/)
assert.match(runtime, /window\.anchorWeb3 = modules\.web3/)
assert.match(runtime, /const previewProvider = \{/)
assert.match(runtime, /if \(!window\.phantom\.solana\) window\.phantom\.solana = previewProvider/)
assert.match(runtime, /if \(!window\.solana\) window\.solana = window\.phantom\.solana/)
assert.match(runtime, /Wallet signing is disabled in the isolated Dappster preview/)
assert.ok(
  runtime.indexOf("window.Buffer = modules.Buffer") < runtime.indexOf("Object.assign(window, modules.web3"),
  "Buffer must be available before the Phantom adapter module loads",
)

class MockPublicKey {
  value: string
  constructor(value: string) { this.value = value }
  toBase58() { return this.value }
}
const previewWindow: Record<string, any> = {
  __DAPPSTER__: { chain: "solana", preview: true },
  __DAPPSTER_SOLANA_RUNTIME__: {
    web3: { PublicKey: MockPublicKey },
    anchor: { web3: { PublicKey: MockPublicKey } },
    splToken: {},
    Buffer: Uint8Array,
    phantomWalletAdapter: {},
  },
}
new Function("window", runtime)(previewWindow)
await previewWindow.__DAPPSTER_SOLANA_READY__
assert.equal(previewWindow.phantom.solana.isPhantom, true)
assert.equal(previewWindow.solana, previewWindow.phantom.solana)
assert.equal((await previewWindow.solana.connect()).publicKey.toBase58(), "11111111111111111111111111111111")
await assert.rejects(() => previewWindow.solana.signTransaction({}), /Wallet signing is disabled/)

const aliases = buildSolanaImportAliases(`
  import * as SolanaWeb3 from "@solana/web3.js"
  import { Connection as RpcConnection, PublicKey } from "@solana/web3.js"
  import Anchor, { web3 as anchorWeb3 } from "@coral-xyz/anchor"
  import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
`)
assert.match(aliases, /const SolanaWeb3 = window\.solanaWeb3;/)
assert.match(aliases, /const RpcConnection = window\.solanaWeb3\.Connection;/)
assert.match(aliases, /const PublicKey = window\.solanaWeb3\.PublicKey;/)
assert.match(aliases, /const Anchor = \(window\.anchor\.default \|\| window\.anchor\);/)
assert.match(aliases, /const anchorWeb3 = window\.anchor\.web3;/)
assert.match(aliases, /const PhantomWalletAdapter = window\.phantomWalletAdapter\.PhantomWalletAdapter;/)

console.log("Solana frontend runtime compatibility checks passed")
