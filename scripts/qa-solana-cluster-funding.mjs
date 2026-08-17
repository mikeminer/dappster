import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")
const walletProvider = await readFile(new URL("../components/WalletProvider.tsx", import.meta.url), "utf8")
const quoteRoute = await readFile(new URL("../app/api/contracts/solana/quote/route.ts", import.meta.url), "utf8")
const deployRoute = await readFile(new URL("../app/api/contracts/solana/deploy/route.ts", import.meta.url), "utf8")
const deployLibrary = await readFile(new URL("../lib/solana-program-deploy.ts", import.meta.url), "utf8")

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
assert.match(promptBuilder, /"mainnet-beta": "solana:mainnet"/, "Mainnet must map to the explicit Wallet Standard mainnet identifier.")
assert.match(promptBuilder, /<option value="mainnet-beta">Mainnet<\/option>/, "The public cluster label must be Mainnet, while retaining the SDK's internal mainnet-beta value.")
assert.doesNotMatch(promptBuilder, /<option value="mainnet-beta">Mainnet Beta<\/option>/, "The public cluster selector must not expose the internal mainnet-beta name.")
assert.match(promptBuilder, /solanaCluster === "devnet"[\s\S]*Testnet Mode[\s\S]*Mainnet SOL is never used[\s\S]*Devnet SOL is never accepted for a Mainnet deployment/, "Cluster guidance must describe Devnet and Mainnet separately.")
assert.match(promptBuilder, /Developer Settings → Testnet Mode/, "The interface must explain Phantom's Testnet Mode requirement.")
assert.doesNotMatch(promptBuilder, /signedFundingBytes|sendRawTransaction\(signedFundingBytes/, "Funding must not use the old raw injected-SDK broadcast path.")

assert.match(walletProvider, /cluster === "devnet"[\s\S]*NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL[\s\S]*NEXT_PUBLIC_SOLANA_RPC_URL/, "The browser provider must select distinct Devnet and Mainnet RPCs.")
assert.match(quoteRoute, /quoteSolanaProgramDeployment\(built\.byteLength, input\.cluster\)/, "The quote must use the requested cluster.")
assert.match(quoteRoute, /cluster: input\.cluster/, "The deployment job must persist the requested cluster.")
assert.match(deployRoute, /job\.cluster !== input\.cluster/, "Deployment must reject a job from a different cluster.")
assert.match(deployRoute, /verifySolanaDeployFunding\(\{[\s\S]*cluster: input\.cluster/, "Funding verification must use the requested cluster.")
assert.match(deployLibrary, /cluster === "devnet"[\s\S]*SOLANA_DEVNET_RPC_URL[\s\S]*SOLANA_MAINNET_RPC_URL/, "Server-side quote, funding verification and deployment must resolve cluster-specific RPCs.")

console.log("Solana cluster-aware funding checks passed")
