import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.doesNotMatch(
  promptBuilder,
  /adapter\.sendTransaction\(fundingTransaction/,
  "Phantom must not choose or broadcast the funding network.",
)
assert.match(
  promptBuilder,
  /setDeployStage\("funding-ready"\)[\s\S]*?new Promise<void>\(resolve => \{ solanaFundingApprovalRef\.current = resolve \}\)[\s\S]*?signSolanaFundingWithPhantom\(targetSolanaCluster,/,
  "Funding must wait for a fresh explicit user click before opening Phantom.",
)
assert.match(
  promptBuilder,
  /async function signSolanaFundingWithPhantom[\s\S]*phantom\.solana\.switchNetwork\(cluster === "devnet" \? "devnet" : "mainnet"\)[\s\S]*phantom\.solana\.signTransaction\(transaction\)/,
  "Phantom must switch and sign through the same SDK session.",
)
assert.doesNotMatch(promptBuilder, /wallet\?\.features\["solana:signTransaction"\]/, "Funding must not switch with one Phantom API and sign with another.")
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
assert.doesNotMatch(
  promptBuilder,
  /adapter\.standard/,
  "Devnet funding must not fall back to a separate Wallet Standard signing session.",
)
assert.match(promptBuilder, /signedTransaction\.recentBlockhash !== transaction\.recentBlockhash/, "The signed transaction must preserve the Devnet blockhash.")
assert.match(promptBuilder, /signedTransaction\.feePayer\?\.equals\(new PublicKey\(expectedWalletAddress\)\)/, "The signed transaction must preserve the verified payer.")

console.log("Solana cluster-aware funding checks passed")
