import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.match(
  promptBuilder,
  /new Connection\(clusterApiUrl\(targetSolanaCluster\), "confirmed"\)/,
  "Wallet funding must use the canonical endpoint that Wallet Standard maps to the selected cluster.",
)
assert.doesNotMatch(
  promptBuilder,
  /walletClusterConnection\.getGenesisHash\(\)/,
  "The Phantom-opening path must not block on another public RPC request after funding is ready.",
)
assert.match(
  promptBuilder,
  /setDeployStage\("funding-ready"\)[\s\S]*?new Promise<void>\(resolve => \{ solanaFundingApprovalRef\.current = resolve \}\)[\s\S]*?adapter\.sendTransaction\(fundingTransaction, walletClusterConnection/,
  "Funding must wait for a fresh explicit user click before opening Phantom.",
)
assert.match(
  promptBuilder,
  /deployStage !== "funding-ready"/,
  "The funding-ready action must remain enabled so the user can explicitly open Phantom.",
)
assert.match(
  promptBuilder,
  /adapter\.sendTransaction\(fundingTransaction, walletClusterConnection/,
  "Funding must use the supported wallet-adapter approval flow with the selected-cluster connection.",
)
assert.doesNotMatch(
  promptBuilder,
  /feature\.signTransaction\(/,
  "Dappster must not bypass Phantom's supported approval flow with a direct Wallet Standard feature call.",
)
assert.match(
  promptBuilder,
  /connection\.getBalance\(adapter\.publicKey, "confirmed"\)/,
  "The selected-cluster balance must be checked before opening Phantom.",
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
