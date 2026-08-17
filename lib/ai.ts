import type { AuditReport, Chain } from "@/types"
import { DAPPSTER_FEE_SOLIDITY_REQUIREMENTS, hasRequiredDeploymentFee } from "@/lib/deployment-fee"
import { getChainAdapter } from "@/lib/chain-adapters"
import { compileSolidity } from "@/lib/solidity"
import { parseMoveSourceBundle } from "@/lib/move-source-bundle"
import { assertSolanaGenerationSafety, solanaContractSafetyIssues, solanaFrontendSafetyIssues } from "@/lib/solana-generation-safety"
import { normalizeGenerationWarnings } from "@/lib/generation-output"

type Generation = { contract: string; contractName?: string; programName?: string; frontend: string; deployInstructions: string; warnings: string[] }
type GenerationOptions = { evmChainId?: number; signal?: AbortSignal }
type XAIWorkload = "generation" | "repair" | "audit"

const evmPrompt = `You are an expert Solidity developer. Generate one production-ready, directly deployable smart contract using Solidity ^0.8.20, OpenZeppelin 5.x where possible, NatSpec, checks-effects-interactions, events, and sensible defaults. The main contract MUST have a zero-argument constructor so it can be deployed non-custodially from the browser; use msg.sender as the initial owner and expose owner-only configuration functions when customization is needed. ${DAPPSTER_FEE_SOLIDITY_REQUIREMENTS} Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. The Solidity source itself MUST compile. When embedding JSON, SVG, or another double-quoted format in Solidity, wrap those fragments in single-quoted Solidity string literals or escape every embedded double quote; never emit an unescaped construct such as "data:application/json,{"name":...". The frontend must be one complete React component using ethers v6, hooks, Tailwind classes, wallet connection, all contract interactions, and read the deployed address from window.__DAPPSTER__.contractAddress. Declare the main contract interface in a constant named ABI and include every callable function, event, custom error, and public-state-variable getter. Dappster will replace ABI with the authoritative compiler output before preview and publication. In every transaction catch block display window.__DAPPSTER__.decodeError(error), never error.shortMessage or error.message directly.`
const solanaPrompt = `You are an expert Solana security engineer using Anchor 0.30.1. Generate a production-ready program and frontend, not a sketch. Return only strict JSON with contract, programName, frontend, deployInstructions, warnings. Before returning, perform an adversarial consistency review of every instruction and fix every issue you find. Every PDA seed used by the client, account constraints, ctx.bumps and invoke_signed must match byte-for-byte. For each token CPI, the authority account must equal the actual authority of the source token account or mint, and new_with_signer/with_signer must use the seeds of that exact authority PDA, never the seeds of another account. All generated SPL-token programs must support both the legacy Token Program and Token-2022: use anchor_spl::token_interface, InterfaceAccount<'info, Mint>, InterfaceAccount<'info, TokenAccount>, Interface<'info, TokenInterface>, token_interface CPI helpers, and token::token_program = token_program on initialized token accounts. Never use classic-only anchor_spl::token accounts or Program<'info, Token>. Constrain every token account by the intended mint and authority. Include all stored fields in account space calculations, including the 8-byte discriminator, 32 bytes per Pubkey, enum/option prefixes, and bounded String/Vec lengths. Prefer InitSpace plus #[max_len] when dynamic data is required. Use init for a single active per-wallet PDA; use init_if_needed only for genuinely idempotent initialization with explicit anti-reinitialization state transitions. Use checked arithmetic, reject zero amounts and invalid durations, use checked timestamp conversion/addition, and distinguish per-deposit limits from global vault caps. Fixed mints from the user request must be enforced by account constraints, not only by the frontend. Anchor assertion helpers are macros: always write require!(...), require_eq!(...), require_neq!(...), require_keys_eq!(...), require_keys_neq!(...), require_gt!(...), and require_gte!(...) with the exclamation mark. The frontend must be one complete self-contained React component using @solana/web3.js v1 and @coral-xyz/anchor 0.30.1 with direct Phantom connection through window.phantom?.solana or window.solana. Never use require(), PhantomWalletAdapter, wallet-adapter React providers, WalletMultiButton, or any dependency that requires a bundler. Use provider.publicKey after connect; never call provider.request({ method: "getAccountInfo" }). Construct the Connection only as new Connection(window.__DAPPSTER__.solanaRpcUrl, "confirmed"); never call clusterApiUrl and never hardcode a Devnet or Mainnet endpoint. Treat every Solana address as case-sensitive: trim user input but never call toLowerCase() or toUpperCase() on wallet, mint, token-account, PDA, or Program ID strings. Before a transaction that uses a user-entered mint, call window.__DAPPSTER__.assertSolanaAccount(connection, mintPublicKey, "SPL token mint") and show its cluster-specific error. Read the mint account with connection.getAccountInfo, accept only TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID as its owner, and use that owner as tokenProgramId when deriving ATAs and populating tokenProgram accounts; never hardcode the legacy token program. Construct an AnchorProvider with provider.publicKey, bound signTransaction, and bound signAllTransactions. Construct Program only as new Program(window.__DAPPSTER__.solanaIdl, anchorProvider); Anchor 0.30 removed the separate programId constructor argument. For every Anchor instruction argument typed u64, i64, u128, i128, u256, or i256, pass new anchor.BN(String(value)); never Number(), parseInt(), parseFloat(), JavaScript bigint, or a raw input string. Perform decimal and whole-token scaling with BN arithmetic and reject fractional or unsafe values. Read the deployed program address only from window.__DAPPSTER__.contractAddress. Never hardcode the Fg6PaFpo example or placeholders such as YOUR_PROGRAM_ID, TOKEN_MINT, or replace_me. Do not import an IDL or any local file; Dappster injects the compiler-generated IDL. The frontend must derive the same PDAs and pass the same accounts required by the Rust program.`
const nonEvmPrompts: Partial<Record<Chain, string>> = {
  sui: `You are an expert Sui Move developer. Generate a complete Sui Move package with Move.toml and source module content, object ownership and capability-based access control, checked inputs, events, tests, and upgrade considerations. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. In contract, every file MUST begin with an exact separator line in this format: ===== FILE: Move.toml =====, ===== FILE: sources/main.move =====, or ===== FILE: tests/main_tests.move =====. Use only relative paths under sources/ or tests/, never Markdown fences, and include no prose outside those files. The package named address must resolve to 0x0 for publication. The frontend must be one complete React component using @mysten/sui and the Sui wallet standard.`,
  aptos: `You are an expert Aptos Move developer. Generate a complete Aptos Move package with Move.toml and source module content, resources or objects, signer validation, events, tests, and safe arithmetic. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. In contract, every file MUST begin with an exact separator line in this format: ===== FILE: Move.toml =====, ===== FILE: sources/main.move =====, or ===== FILE: tests/main_tests.move =====. Use only relative paths under sources/ or tests/, never Markdown fences, and include no prose outside those files. Use the named address dappster_package for every module and declare dappster_package = "_" in Move.toml so Dappster can bind it to the publishing wallet at compile time. The frontend must be one complete React component using @aptos-labs/ts-sdk and the Aptos wallet adapter.`,
  cosmos: `You are an expert CosmWasm developer. Generate a complete Rust CosmWasm contract with Cargo.toml, instantiate, execute and query messages, state, errors, schema entrypoints, and unit tests. Avoid assuming one Cosmos chain or denomination. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. Put every required source file in contract using clear file separators. The frontend must be one complete React component using CosmJS and a wallet-standard compatible Cosmos wallet.`,
  ton: `You are an expert TON smart-contract developer. Generate a complete modern Tact contract, including messages, state initialization, access control, bounced-message handling, tests, and deployment configuration. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. Put every required source file in contract using clear file separators. The frontend must be one complete React component using @ton/core and TonConnect.`,
  near: `You are an expert NEAR smart-contract developer. Generate a production-oriented Rust contract with Cargo.toml, near-sdk state, initialization, access control, storage accounting, promise-safe callbacks, events, and tests. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. Put every required source file in contract using clear file separators. The frontend must be one complete React component using the current NEAR JavaScript APIs and wallet selector.`,
  starknet: `You are an expert Starknet Cairo developer. Generate a complete Scarb project with a Cairo contract, components where useful, events, custom errors, access control, tests for Starknet Foundry, and declare/deploy instructions. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. Put every required source file in contract using clear file separators. The frontend must be one complete React component using starknet.js and a Starknet wallet-standard connector.`,
  algorand: `You are an expert Algorand smart-contract developer. Generate a complete AlgoKit project using Algorand Python/PuyaPy, ARC-56 typed interfaces, explicit state and box-storage accounting, grouped-transaction validation, access control, and tests. Return only strict JSON with contract, contractName, frontend, deployInstructions, warnings. Put every required source file in contract using clear file separators. The frontend must be one complete React component using algosdk and an Algorand wallet-standard connector.`,
}
const auditPrompt = `You are a senior smart contract security auditor. Analyze all vulnerability classes, access control, arithmetic, reentrancy or CPI safety, denial of service, oracle risks, ownership, PDA validation, and gas opportunities. Return only valid JSON with summary, severity_counts {critical,high,medium,low,info}, findings [{id,severity,title,description,location,impact,recommendation,fix}], gas_optimizations [{title,savings_estimate,fix}], overall_score, passed.`
const solidityRepairPrompt = `You repair Solidity compiler errors. Preserve the contract's product behavior, storage layout, access control, public interface, events, custom errors, and exact mandatory Dappster deployment-fee block. Make only changes needed for the source to compile. For embedded JSON or SVG, use single-quoted Solidity strings or correctly escape embedded double quotes. Return only strict JSON with one field named contract containing the complete repaired Solidity source.`
const compilerRepairPrompts: Partial<Record<Chain, string>> = {
  solana: `You repair Solana Anchor 0.30 Rust compiler errors. Preserve product behavior, instructions, accounts, PDA seeds, signer and ownership checks, events, errors, and public interfaces. Keep the complete program in one lib.rs source, retain declare_id!, and use Anchor macros with their required exclamation marks. Make only changes required for cargo build-sbf to compile. Return only strict JSON with one field named contract containing the complete repaired Rust source.`,
  sui: `You repair Sui Move compiler errors. Preserve product behavior, modules, objects, capabilities, entry functions, events, access control, and public interfaces. Preserve the exact ===== FILE: path ===== source-bundle format and return every required file including Move.toml. Make only changes required by sui move build. Return only strict JSON with one field named contract containing the complete repaired source bundle.`,
  aptos: `You repair Aptos Move compiler errors. Preserve product behavior, modules, resources or objects, entry functions, events, signer checks, access control, and public interfaces. Preserve the exact ===== FILE: path ===== source-bundle format, the dappster_package named address, and every required file including Move.toml. Make only changes required by aptos move build-publish-payload. Return only strict JSON with one field named contract containing the complete repaired source bundle.`,
}
const frontendRepairPrompt = `You repair a generated Dappster React frontend without changing its smart contract. Return only strict JSON with one field named frontend containing one complete self-contained React component. Preserve the requested product behavior and every contract interaction. The source must run directly in a browser through Babel standalone: use ES module imports only, never CommonJS require(), never import local files, and never depend on a bundler. Read the deployed address from window.__DAPPSTER__.contractAddress. For EVM use ethers v6 and window.__DAPPSTER__.decodeError(error). For Solana connect directly through window.phantom?.solana or window.solana, use @solana/web3.js and @coral-xyz/anchor, read window.__DAPPSTER__.solanaIdl, construct Connection only from window.__DAPPSTER__.solanaRpcUrl, and never import or reference @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, @solana/wallet-adapter-phantom, React wallet-adapter providers, WalletMultiButton, WalletProvider, or PhantomWalletAdapter. Solana addresses are case-sensitive: trim them but never lowercase or uppercase them. Validate a user-entered mint with window.__DAPPSTER__.assertSolanaAccount before submitting a transaction. Every u64, i64, u128, i128, u256, or i256 Anchor instruction argument must be new anchor.BN(String(value)), never Number(), parseInt(), parseFloat(), JavaScript bigint, or a raw input string; use BN arithmetic for unit scaling.`
const solanaReviewPrompt = `You are the mandatory final security reviewer for a generated Anchor 0.30.1 dApp. Return only one strict JSON object with contract, programName, frontend, deployInstructions, warnings. Preserve the requested product behavior while repairing every correctness or security defect in the supplied program and frontend. Verify instruction authorization, one-time initialization, PDA derivations, ctx.bumps, account ownership, signer requirements, close destinations, token mint/authority constraints, CPI authority and invoke_signed seeds, checked arithmetic, timestamps, zero values, per-user versus global limits, exact account allocation, and replay/reinitialization behavior. For every token transfer, prove that the authority supplied to the CPI owns the source token account and that signer seeds derive that same authority PDA. Every SPL-token program must use anchor_spl::token_interface with InterfaceAccount and TokenInterface so legacy SPL and Token-2022 mints both work. The frontend must read the mint account owner, accept only TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID, and use the detected program for ATA derivation and instruction accounts. Verify the frontend against the Rust accounts and arguments. Use AnchorProvider and exactly new Program(window.__DAPPSTER__.solanaIdl, anchorProvider), direct Phantom injection, @solana/web3.js v1, and no require(), local IDL imports, wallet-adapter UI components, placeholders, or hardcoded deployed Program ID. Construct Connection only from window.__DAPPSTER__.solanaRpcUrl, never from clusterApiUrl or a hardcoded endpoint. Preserve the exact case of every Solana address and validate user-entered mint accounts on the configured cluster with window.__DAPPSTER__.assertSolanaAccount before sending. Every u64, i64, u128, i128, u256, or i256 Anchor instruction argument must be new anchor.BN(String(value)), never Number(), parseInt(), parseFloat(), JavaScript bigint, or a raw input string; use BN arithmetic for unit scaling. Do not merely describe problems in warnings: fix them in the returned sources. Warnings may contain only residual product or operational risks that cannot be fixed in code.`

function parseJson<T>(value: string): T {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  return JSON.parse(cleaned) as T
}

function assertGenerationStructure(generation: Generation, chain: Chain, options: { skipSolanaSafety?: boolean } = {}) {
  if (!generation || typeof generation !== "object" || Array.isArray(generation)) throw new Error("Generated output is structurally invalid")
  generation.warnings = normalizeGenerationWarnings(generation.warnings)
  if (typeof generation.contract !== "string" || generation.contract.trim().length < 80) throw new Error("Generated contract source is missing or incomplete")
  if (typeof generation.frontend !== "string" || generation.frontend.trim().length < 80) throw new Error("Generated frontend source is missing or incomplete")
  if (typeof generation.deployInstructions !== "string" || !generation.deployInstructions.trim()) throw new Error("Generated deployment instructions are missing")
  if (!Array.isArray(generation.warnings) || !generation.warnings.every(value => typeof value === "string")) throw new Error("Generated warnings are invalid")
  if (chain === "solana") {
    if (!/#\s*\[\s*program\s*\]/.test(generation.contract)) throw new Error("Generated Solana source is missing its #[program] module")
    if (!/anchor_lang::prelude::\*/.test(generation.contract)) throw new Error("Generated Solana source is missing the Anchor prelude")
    if (!options.skipSolanaSafety) assertSolanaGenerationSafety(generation.contract, generation.frontend)
  }
  if (chain === "sui" || chain === "aptos") parseMoveSourceBundle(generation.contract, chain)
}

function xaiModelFor(workload: XAIWorkload) {
  if (workload === "generation") return process.env.XAI_GENERATION_MODEL || "grok-4.20-0309-non-reasoning"
  if (workload === "repair") return process.env.XAI_REPAIR_MODEL || process.env.XAI_MODEL || "grok-4.5"
  return process.env.XAI_AUDIT_MODEL || process.env.XAI_MODEL || "grok-4.5"
}

async function callXAI(system: string, prompt: string, workload: XAIWorkload = "generation", signal?: AbortSignal) {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not configured")
  const response = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", signal, headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: xaiModelFor(workload), temperature: workload === "generation" ? 0.2 : 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }) })
  if (!response.ok) throw new Error(`Generation provider failed (${response.status})`)
  const json = await response.json() as { choices: { message: { content: string } }[] }
  return json.choices[0]?.message.content
}

async function callClaude(system: string, prompt: string) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured")
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 8192, temperature: 0, system, messages: [{ role: "user", content: prompt }] }) })
  if (!response.ok) throw new Error(`Audit provider failed (${response.status})`)
  const json = await response.json() as { content: { type: string; text: string }[] }
  return json.content.find(block => block.type === "text")?.text
}

export async function repairEvmContract(source: string, compilerError: string, signal?: AbortSignal) {
  const output = await callXAI(solidityRepairPrompt, `Compiler error:\n${compilerError.slice(0, 6000)}\n\nComplete Solidity source:\n${source}`, "repair", signal)
  if (!output) throw new Error("AI provider returned an empty repair response")
  const repaired = parseJson<{ contract?: string }>(output).contract?.trim()
  if (!repaired) throw new Error("AI provider returned an invalid Solidity repair")
  return repaired.replace(/^```(?:solidity)?\s*/i, "").replace(/\s*```$/, "")
}

export async function repairGeneratedContract(chain: Extract<Chain, "solana" | "sui" | "aptos">, source: string, compilerError: string) {
  const system = compilerRepairPrompts[chain]
  if (!system) throw new Error(`Automatic compiler repair is not configured for ${chain}`)
  const output = await callXAI(system, `Compiler error:\n${compilerError.slice(0, 6000)}\n\nComplete generated source:\n${source}`, "repair")
  if (!output) throw new Error("AI provider returned an empty repair response")
  const repaired = parseJson<{ contract?: string }>(output).contract?.trim()
  if (!repaired) throw new Error("AI provider returned an invalid compiler repair")
  return repaired.replace(/^```(?:rust|move)?\s*/i, "").replace(/\s*```$/, "")
}

async function reviewSolanaGeneration(productPrompt: string, generation: Generation, signal?: AbortSignal) {
  const reviewPayload = {
    ...generation,
    contract: generation.contract.slice(0, 140_000),
    frontend: generation.frontend.slice(0, 80_000),
    deployInstructions: generation.deployInstructions.slice(0, 12_000),
  }
  const output = await callXAI(solanaReviewPrompt, [
    `Original product request:\n${productPrompt.slice(0, 6000)}`,
    `Generated JSON to review and repair:\n${JSON.stringify(reviewPayload)}`,
  ].join("\n\n"), "repair", signal)
  if (!output) throw new Error("Solana safety review returned an empty response")
  const reviewed = parseJson<Generation>(output)
  // The reviewer can occasionally reintroduce a bundler-only wallet adapter.
  // Validate its shape here, then run the targeted browser-frontend repair below.
  assertGenerationStructure(reviewed, "solana", { skipSolanaSafety: true })
  return reviewed
}

async function repairSolanaFrontendPreflight(productPrompt: string, generation: Generation, signal?: AbortSignal) {
  let candidate = generation
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const issues = solanaFrontendSafetyIssues(candidate.frontend)
    if (!issues.length) {
      assertGenerationStructure(candidate, "solana")
      return candidate
    }
    const frontend = await repairGeneratedFrontend({
      chain: "solana",
      productPrompt,
      contractSource: candidate.contract,
      frontendSource: candidate.frontend,
      previewError: `Dappster browser-safety preflight failed:\n- ${issues.join("\n- ")}`,
      signal,
    })
    candidate = { ...candidate, frontend }
  }
  assertGenerationStructure(candidate, "solana")
  return candidate
}

export async function repairGeneratedFrontend(input: {
  chain: Chain
  productPrompt: string
  contractSource: string
  frontendSource: string
  previewError: string
  signal?: AbortSignal
}) {
  const output = await callXAI(frontendRepairPrompt, [
    `Target ecosystem: ${getChainAdapter(input.chain).name}`,
    `Original product request:\n${input.productPrompt.slice(0, 4000)}`,
    `Preview error to fix:\n${input.previewError.slice(0, 4000)}`,
    `Smart-contract source (do not modify):\n${input.contractSource.slice(0, 100000)}`,
    `Current frontend source:\n${input.frontendSource.slice(0, 60000)}`,
  ].join("\n\n"), "repair", input.signal)
  if (!output) throw new Error("AI provider returned an empty frontend repair response")
  const frontend = parseJson<{ frontend?: string }>(output).frontend?.trim()
    .replace(/^```(?:tsx|typescript|jsx)?\s*/i, "")
    .replace(/\s*```$/, "")
  if (!frontend || frontend.length < 80 || !/export\s+default/.test(frontend)) {
    throw new Error("AI provider returned an invalid frontend repair")
  }
  return frontend
}

export async function generateQueuedSolanaDraft(prompt: string, signal?: AbortSignal) {
  const output = await callXAI(solanaPrompt, prompt, "generation", signal)
  if (!output) throw new Error("AI provider returned an empty Solana generation response")
  const generation = parseJson<Generation>(output)
  // The dedicated review and repair workers own the adversarial safety pass.
  // This phase only guarantees that a complete draft can be persisted safely.
  assertGenerationStructure(generation, "solana", { skipSolanaSafety: true })
  return generation
}

export async function reviewQueuedSolanaGeneration(productPrompt: string, generation: Generation, signal?: AbortSignal) {
  return reviewSolanaGeneration(productPrompt, generation, signal)
}

export async function repairQueuedSolanaGeneration(productPrompt: string, generation: Generation, signal?: AbortSignal) {
  const contractIssues = solanaContractSafetyIssues(generation.contract)
  const frontendIssues = solanaFrontendSafetyIssues(generation.frontend)
  let candidate = generation

  if (contractIssues.length) {
    candidate = await reviewSolanaGeneration(
      `${productPrompt}\n\nFinal Dappster safety issues that must be repaired:\n- ${[...contractIssues, ...frontendIssues].join("\n- ")}`,
      generation,
      signal,
    )
  } else if (frontendIssues.length) {
    const frontend = await repairGeneratedFrontend({
      chain: "solana",
      productPrompt,
      contractSource: generation.contract,
      frontendSource: generation.frontend,
      previewError: `Dappster browser-safety preflight failed:\n- ${frontendIssues.join("\n- ")}`,
      signal,
    })
    candidate = { ...generation, frontend }
  }

  assertGenerationStructure(candidate, "solana")
  return candidate
}

export async function callAI(task: "generate", prompt: string, chain: Chain, options?: GenerationOptions): Promise<Generation>
export async function callAI(task: "audit", prompt: string, chain: Chain, options?: GenerationOptions): Promise<AuditReport>
export async function callAI(task: "generate" | "audit", prompt: string, chain: Chain, options: GenerationOptions = {}) {
  const generationSystem = chain === "evm" ? evmPrompt : chain === "solana" ? solanaPrompt : nonEvmPrompts[chain]
  if (task === "generate" && !generationSystem) throw new Error(`Generation is not configured for ${getChainAdapter(chain).name}`)
  let output = task === "generate"
    ? await callXAI(generationSystem!, prompt, "generation", options.signal)
    : process.env.ANTHROPIC_API_KEY
      ? await callClaude(auditPrompt, `Chain: ${chain}\n\n${prompt}`)
      : await callXAI(auditPrompt, `Chain: ${chain}\n\n${prompt}`, "audit", options.signal)
  if (!output) throw new Error("AI provider returned an empty response")
  let parsed = parseJson<Generation | AuditReport>(output)
  if (task === "generate") {
    try {
      assertGenerationStructure(parsed as Generation, chain)
    } catch (error) {
      const validationError = error instanceof Error ? error.message : "Generated output is structurally invalid"
      const candidate = parsed as Generation
      const canRepairOnlyFrontend = chain === "solana"
        && typeof candidate.contract === "string"
        && typeof candidate.frontend === "string"
        && solanaContractSafetyIssues(candidate.contract).length === 0
        && solanaFrontendSafetyIssues(candidate.frontend).length > 0
      if (canRepairOnlyFrontend) {
        parsed = await repairSolanaFrontendPreflight(prompt, candidate, options.signal)
      } else {
        output = await callXAI(generationSystem!, `${prompt}\n\nThe previous JSON output below failed Dappster's source preflight. Repair the complete output without changing the requested product behavior, then return the full strict JSON object again.\n\nPreflight error:\n${validationError}\n\nPrevious JSON output:\n${output}`, "repair", options.signal)
        if (!output) throw new Error("AI provider returned an empty response")
        parsed = parseJson<Generation>(output)
        assertGenerationStructure(parsed, chain)
      }
    }
    if (chain === "solana") {
      parsed = await reviewSolanaGeneration(prompt, parsed as Generation, options.signal)
      parsed = await repairSolanaFrontendPreflight(prompt, parsed as Generation, options.signal)
    }
  }
  if (task === "generate" && chain === "evm") {
    const generation = parsed as Generation
    let compilerError = ""
    try {
      if (!hasRequiredDeploymentFee(generation.contract)) throw new Error("The mandatory Dappster deployment-fee block is missing or altered.")
      compileSolidity(generation.contract, generation.contractName, { chainId: options.evmChainId })
    } catch (error) {
      compilerError = error instanceof Error ? error.message : "Unknown Solidity compilation error"
    }

    if (compilerError) {
      const repairedContract = await repairEvmContract(generation.contract, compilerError, options.signal)
      parsed = { ...generation, contract: repairedContract }
      if (!hasRequiredDeploymentFee(repairedContract)) throw new Error("The repaired contract did not include the mandatory deployment fee. Please generate again.")
      try {
        compileSolidity(repairedContract, generation.contractName, { chainId: options.evmChainId })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Solidity compilation error"
        throw new Error(`The generated contract could not be repaired automatically:\n${message.slice(0, 6000)}`)
      }
    }
  }
  return parsed
}
