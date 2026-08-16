import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.match(
  promptBuilder,
  /new Connection\(clusterApiUrl\(targetSolanaCluster\), "confirmed"\)/,
  "The wallet request must use the canonical endpoint for the selected Solana cluster.",
)
assert.match(
  promptBuilder,
  /adapter\.sendTransaction\(fundingTransaction, walletClusterConnection/,
  "Funding must use the cluster-aware Wallet Standard send path.",
)
assert.doesNotMatch(
  promptBuilder,
  /adapter\.signTransaction\(fundingTransaction\)/,
  "Direct signing omits the Solana cluster and can make Phantom simulate Devnet funding on Mainnet.",
)
assert.match(
  promptBuilder,
  /genesisHash !== SOLANA_GENESIS_HASH\[targetSolanaCluster\]/,
  "The selected RPC must still be verified by genesis hash before funding.",
)
assert.match(
  promptBuilder,
  /quote\.cluster !== targetSolanaCluster/,
  "The backend quote cluster must still match the UI selection.",
)
assert.match(
  promptBuilder,
  /targetSolanaCluster === "devnet" && adapter\.standard !== true/,
  "Devnet funding must reject legacy adapters that cannot communicate the requested chain.",
)

console.log("Solana cluster-aware funding checks passed")
