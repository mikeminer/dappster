import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.match(
  promptBuilder,
  /adapter\.sendTransaction\(transaction, chainBindingConnection/,
  "Funding must use the chain-aware Wallet Standard sendTransaction path.",
)
assert.match(
  promptBuilder,
  /setDeployStage\("funding-ready"\)[\s\S]*?new Promise<void>\(resolve => \{ solanaFundingApprovalRef\.current = resolve \}\)[\s\S]*?signSolanaFundingWithPhantom\(adapter, targetSolanaCluster,/,
  "Funding must wait for a fresh explicit user click before opening Phantom.",
)
assert.match(
  promptBuilder,
  /setDeployStage\("authorization-ready"\)[\s\S]*?new Promise<void>\(resolve => \{ solanaAuthorizationApprovalRef\.current = resolve \}\)[\s\S]*?adapter\.signMessage\(message\)/,
  "Deployment authorization must wait for a fresh explicit user click before opening Phantom.",
)
assert.match(
  promptBuilder,
  /async function signSolanaFundingWithPhantom[\s\S]*adapter\.standard !== true[\s\S]*account\?\.chains\.includes\(expectedChain\)/,
  "Funding must require a Wallet Standard account that advertises the selected chain.",
)
assert.doesNotMatch(promptBuilder, /@phantom\/browser-injected-sdk|phantom\.solana\.switchNetwork/, "The injected Phantom switchNetwork no-op must not be used.")
assert.match(
  promptBuilder,
  /new Connection\(clusterApiUrl\(cluster\), "confirmed"\)/,
  "The Wallet Standard chain binding must use a canonical cluster URL.",
)
assert.match(
  promptBuilder,
  /deployStage !== "funding-ready" && deployStage !== "authorization-ready"/,
  "Both explicit Phantom actions must remain enabled for a fresh user gesture.",
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
  /adapter\.standard/,
  "Devnet funding must require a Wallet Standard adapter.",
)
assert.match(promptBuilder, /SOLANA_WALLET_STANDARD_CHAIN[\s\S]*devnet: "solana:devnet"/, "Devnet must map to the explicit Wallet Standard chain identifier.")
assert.match(promptBuilder, /Developer Settings → Testnet Mode/, "The interface must explain Phantom's Testnet Mode requirement.")
assert.doesNotMatch(promptBuilder, /signedFundingBytes|sendRawTransaction\(signedFundingBytes/, "Funding must not use the old raw injected-SDK broadcast path.")

console.log("Solana cluster-aware funding checks passed")
