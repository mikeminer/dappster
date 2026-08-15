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
assert.ok(
  runtime.indexOf("window.Buffer = modules.Buffer") < runtime.indexOf("Object.assign(window, modules.web3"),
  "Buffer must be available before the Phantom adapter module loads",
)

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
