import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.match(
  promptBuilder,
  /SOLANA_WALLET_STANDARD_CHAIN[\s\S]*devnet: "solana:devnet"[\s\S]*"mainnet-beta": "solana:mainnet"/,
  "Wallet Standard requests must use the explicit chain identifier for each cluster.",
)
assert.doesNotMatch(
  promptBuilder,
  /adapter\.sendTransaction\(fundingTransaction/,
  "Phantom must not choose or broadcast the funding network.",
)
assert.match(
  promptBuilder,
  /setDeployStage\("funding-ready"\)[\s\S]*?new Promise<void>\(resolve => \{ solanaFundingApprovalRef\.current = resolve \}\)[\s\S]*?switchPhantomToSolanaCluster\(targetSolanaCluster,[\s\S]*?signSolanaFundingForCluster\(/,
  "Funding must wait for a fresh explicit user click before opening Phantom.",
)
assert.match(
  promptBuilder,
  /phantom\.solana\.switchNetwork\(cluster === "devnet" \? "devnet" : "mainnet"\)/,
  "Phantom itself must switch to the selected Solana cluster before signing.",
)
assert.match(
  promptBuilder,
  /feature\.signTransaction\(\{[\s\S]*account,[\s\S]*chain,[\s\S]*transaction:/,
  "Funding must use Wallet Standard signing with an explicit chain.",
)
assert.match(
  promptBuilder,
  /rpc\.sendRawTransaction\(signedFundingBytes/,
  "Dappster must broadcast signed funding bytes through selected-cluster RPCs.",
)
assert.match(
  promptBuilder,
  /deployStage !== "funding-ready"/,
  "The funding-ready action must remain enabled so the user can explicitly open Phantom.",
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
