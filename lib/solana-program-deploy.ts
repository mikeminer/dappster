import { createHash, createHmac } from "crypto"
import bs58 from "bs58"
import nacl from "tweetnacl"
import { Sandbox } from "@vercel/sandbox"
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import type { SolanaDeploymentCluster } from "./solana-deployment"
import { solanaDeployAuthorizationMessage } from "./solana-deploy-auth"

const BUILDER_NAME = "dappster-solana-builder-v1"
const PROGRAM_CRATE_NAME = "dappster_program"
const MAX_SOURCE_BYTES = 200_000
const MAX_PROGRAM_BYTES = 2_000_000
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000
const TOOLCHAIN_BIN = "/vercel/sandbox/.local/share/solana/install/active_release/bin"
const CARGO_BIN = "/vercel/sandbox/.cargo/bin"
const IDL_BUILDER_ROOT = "/vercel/sandbox/.cache/dappster-anchor-idl-builder-v0.31.1"
const IDL_BUILDER_MANIFEST = `${IDL_BUILDER_ROOT}/Cargo.toml`
export const SOLANA_DEPLOY_MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
const LAMPORTS_PER_SIGNATURE = 5_000
const MIN_DEPLOY_FEE_BUFFER = 2_000_000
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
const UPGRADEABLE_BUFFER_METADATA_BYTES = 37
const UPGRADEABLE_PROGRAM_BYTES = 36
const UPGRADEABLE_PROGRAMDATA_METADATA_BYTES = 45
const UPGRADEABLE_WRITE_CHUNK_BYTES = 900
const DEVNET_RECOVERY_AIRDROP_MIN_LAMPORTS = 100_000_000
const PROGRAM_WRITE_RATE_LIMIT_RETRIES = 7
const PROGRAM_WRITE_BATCH_SIZE = 8
const PROGRAM_WRITE_PUBLIC_RPC_DELAY_MS = 325
const PROGRAM_WRITE_PRIVATE_RPC_DELAY_MS = 50
const PROGRAM_WRITE_CONFIRM_TIMEOUT_MS = 75_000

function commandError(label: string, stdout: string, stderr: string) {
  const details = [stderr, stdout].filter(Boolean).join("\n").slice(-12_000)
  return new Error(`${label} non riuscita${details ? `:\n${details}` : ""}`)
}

function sandboxApiError(error: unknown) {
  if (!(error instanceof Error)) return new Error("Solana build sandbox unavailable")
  const providerError = error as Error & { text?: unknown; json?: unknown }
  let detail = ""
  if (providerError.json && typeof providerError.json === "object") {
    const json = providerError.json as { error?: { message?: unknown }; message?: unknown }
    const candidate = json.error?.message ?? json.message
    if (typeof candidate === "string") detail = candidate
  }
  if (!detail && typeof providerError.text === "string") detail = providerError.text
  const normalized = detail.replace(/\s+/g, " ").trim().slice(0, 2_000)
  return new Error(`Solana build sandbox unavailable: ${normalized || error.message}`)
}

function sandboxCredentials() {
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  return token && teamId && projectId ? { token, teamId, projectId } : {}
}

async function runSandboxCommand(sandbox: Sandbox, ...args: Parameters<Sandbox["runCommand"]>) {
  try {
    return await sandbox.runCommand(...args)
  } catch (error) {
    throw sandboxApiError(error)
  }
}

async function ensureSolanaToolchain(sandbox: Sandbox) {
  const existing = await runSandboxCommand(sandbox, {
    cmd: "bash",
    args: ["-lc", `test -x ${TOOLCHAIN_BIN}/cargo-build-sbf && test -x ${CARGO_BIN}/cargo`],
  })
  if (existing.exitCode === 0) return

  const packages = await runSandboxCommand(sandbox, {
    cmd: "dnf",
    // Vercel Sandbox uses Amazon Linux 2023, which already ships curl-minimal.
    // Installing the full `curl` package alongside it makes DNF fail because
    // both packages provide the same binaries.
    args: ["install", "-y", "gcc", "gcc-c++", "make", "openssl-devel", "pkgconf-pkg-config", "git", "tar", "gzip", "bzip2", "xz"],
    sudo: true,
  })
  if (packages.exitCode !== 0) throw commandError("Installazione dipendenze build", await packages.stdout(), await packages.stderr())

  const curl = await runSandboxCommand(sandbox, { cmd: "bash", args: ["-lc", "command -v curl && curl --version"] })
  if (curl.exitCode !== 0) throw commandError("Verifica curl della sandbox", await curl.stdout(), await curl.stderr())

  const install = await runSandboxCommand(sandbox, {
    cmd: "bash",
    args: ["-lc", "curl -sSfL https://release.anza.xyz/v2.1.21/install | sh"],
    env: { HOME: "/vercel/sandbox" },
  })
  if (install.exitCode !== 0) throw commandError("Installazione toolchain Solana", await install.stdout(), await install.stderr())

  const rust = await runSandboxCommand(sandbox, {
    cmd: "bash",
    args: ["-lc", `test -x ${CARGO_BIN}/cargo || curl -sSfL https://sh.rustup.rs | sh -s -- -y --profile minimal`],
    env: { HOME: "/vercel/sandbox" },
  })
  if (rust.exitCode !== 0) throw commandError("Installazione toolchain Rust", await rust.stdout(), await rust.stderr())
}

async function ensureAnchorIdlBuilder(sandbox: Sandbox) {
  const prepare = await runSandboxCommand(sandbox, {
    cmd: "mkdir",
    args: ["-p", `${IDL_BUILDER_ROOT}/src`],
  })
  if (prepare.exitCode !== 0) {
    throw commandError("Preparazione generatore IDL Anchor", await prepare.stdout(), await prepare.stderr())
  }
  await sandbox.writeFiles([
    {
      path: IDL_BUILDER_MANIFEST,
      content: `[package]
name = "dappster-anchor-idl-builder"
version = "0.1.0"
edition = "2021"

[dependencies]
anchor-lang-idl = { version = "=0.1.2", features = ["build"] }
anyhow = "=1.0.98"
serde_json = "=1.0.140"
`,
    },
    {
      path: `${IDL_BUILDER_ROOT}/src/main.rs`,
      content: `use anchor_lang_idl::build::IdlBuilder;
use std::{env, path::PathBuf};

fn main() -> anyhow::Result<()> {
    let program_path = env::args().nth(1).ok_or_else(|| anyhow::anyhow!("program path is required"))?;
    // Anchor 0.30.1 requires this pinned nightly for proc-macro IDL generation.
    env::set_var("RUSTUP_TOOLCHAIN", "nightly-2024-05-09");
    let idl = IdlBuilder::new()
        .program_path(PathBuf::from(program_path))
        .resolution(true)
        .skip_lint(true)
        .cargo_args(vec!["--locked".to_string()])
        .build()?;
    println!("{}", serde_json::to_string_pretty(&idl)?);
    Ok(())
}
`,
    },
  ])
}

function sourceForProgram(source: string, programId: string) {
  let normalizedSource = source.replace(
    /^(\s*)(require(?:_eq|_neq|_keys_eq|_keys_neq|_gt|_gte)?)(\s*)\(/gm,
    "$1$2!$3(",
  )
  // Anchor's Accounts derive expects the associated-token program type to be
  // a local identifier. AI-generated sources sometimes qualify the type all
  // the way through anchor_spl, which compiles for SBF but fails during the
  // separate IDL build performed with the idl-build feature.
  if (/anchor_spl::associated_token::AssociatedToken/.test(normalizedSource)) {
    normalizedSource = normalizedSource
      .split("\n")
      .map(line => /^\s*use\b/.test(line)
        ? line
        : line.replaceAll("anchor_spl::associated_token::AssociatedToken", "AssociatedToken"))
      .join("\n")
    if (!/^\s*use\s+anchor_spl::associated_token::AssociatedToken\s*;/m.test(normalizedSource)) {
      normalizedSource = `use anchor_spl::associated_token::AssociatedToken;\n${normalizedSource}`
    }
  }
  const declaration = `declare_id!("${programId}");`
  if (/declare_id!\s*\(\s*"[1-9A-HJ-NP-Za-km-z]+"\s*\)\s*;/.test(normalizedSource)) {
    return normalizedSource.replace(/declare_id!\s*\(\s*"[1-9A-HJ-NP-Za-km-z]+"\s*\)\s*;/, declaration)
  }
  return `use anchor_lang::prelude::*;\n${declaration}\n${normalizedSource}`
}

function cargoManifest() {
  return `[package]
name = "${PROGRAM_CRATE_NAME}"
version = "0.1.0"
edition = "2021"
rust-version = "1.79"
resolver = "2"

[lib]
crate-type = ["cdylib", "lib"]
name = "${PROGRAM_CRATE_NAME}"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = { version = "=0.30.1", features = ["init-if-needed"] }
anchor-spl = "=0.30.1"
blake3 = "=1.8.2"
constant_time_eq = "=0.3.1"
base64ct = "=1.6.0"
indexmap = "=2.11.4"
syn = "=2.0.87"
proc-macro2 = "=1.0.86"
`
}

function anchorManifest(programId: string) {
  return `[toolchain]
anchor_version = "0.31.1"

[features]
resolution = true
skip-lint = true

[programs.localnet]
${PROGRAM_CRATE_NAME} = "${programId}"

[provider]
cluster = "Localnet"
wallet = "/vercel/sandbox/.config/solana/id.json"

[workspace]
members = ["."]
`
}

export function verifySolanaDeployAuthorization(input: {
  dappId: string
  cluster: SolanaDeploymentCluster
  jobId?: string
  wallet: string
  signature: string
}) {
  const publicKey = new PublicKey(input.wallet)
  let signature: Uint8Array
  try {
    signature = bs58.decode(input.signature)
  } catch {
    throw new Error("Firma Phantom non valida")
  }
  const message = new TextEncoder().encode(solanaDeployAuthorizationMessage(input.dappId, input.cluster, input.jobId))
  if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) throw new Error("Phantom non ha autorizzato questo deploy")
  return publicKey
}

async function compileSolanaProgramInSandbox(source: string, programId: string) {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new Error("Il programma Solana supera il limite di 200 KB")
  const jobId = createHash("sha256").update(`${programId}:${source}`).digest("hex").slice(0, 24)
  const workspace = `/vercel/sandbox/jobs/${jobId}`
  let sandbox: Sandbox
  try {
    sandbox = await Sandbox.getOrCreate({
      ...sandboxCredentials(),
      name: BUILDER_NAME,
      runtime: "node24",
      persistent: true,
      timeout: SANDBOX_TIMEOUT_MS,
      resources: { vcpus: 4 },
      keepLastSnapshots: { count: 2 },
    })
  } catch (error) {
    throw sandboxApiError(error)
  }
  // Keep setup outside onCreate so a partially-created persistent sandbox can
  // repair itself on the next request instead of being permanently unusable.
  await ensureSolanaToolchain(sandbox)
  await ensureAnchorIdlBuilder(sandbox)

  const prepareWorkspace = await runSandboxCommand(sandbox, {
    cmd: "mkdir",
    args: ["-p", `${workspace}/src`, `${workspace}/target/deploy`],
  })
  if (prepareWorkspace.exitCode !== 0) {
    throw commandError("Preparazione workspace Solana", await prepareWorkspace.stdout(), await prepareWorkspace.stderr())
  }
  await sandbox.writeFiles([
    { path: `${workspace}/Cargo.toml`, content: cargoManifest() },
    { path: `${workspace}/Anchor.toml`, content: anchorManifest(programId) },
    { path: `${workspace}/src/lib.rs`, content: sourceForProgram(source, programId) },
  ])

  // Solana 2.1 ships Cargo 1.79. Generate the dependency lockfile with the
  // current Cargo resolver first, constrained to that MSRV, so transitive
  // crates requiring Edition 2024 are replaced by compatible releases.
  const lock = await runSandboxCommand(sandbox, {
    cmd: `${CARGO_BIN}/cargo`,
    args: ["generate-lockfile", "--manifest-path", `${workspace}/Cargo.toml`],
    cwd: workspace,
    env: {
      HOME: "/vercel/sandbox",
      PATH: `${CARGO_BIN}:${TOOLCHAIN_BIN}:/usr/local/bin:/usr/bin:/bin`,
      CARGO_TERM_COLOR: "never",
      CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS: "fallback",
      CARGO_HTTP_CAINFO: "/etc/pki/tls/certs/ca-bundle.crt",
      SSL_CERT_FILE: "/etc/pki/tls/certs/ca-bundle.crt",
    },
  })
  if (lock.exitCode !== 0) {
    throw commandError("Risoluzione dipendenze Solana", await lock.stdout(), await lock.stderr())
  }

  const build = await runSandboxCommand(sandbox, {
    cmd: `${TOOLCHAIN_BIN}/cargo-build-sbf`,
    args: ["--manifest-path", `${workspace}/Cargo.toml`, "--sbf-out-dir", `${workspace}/target/deploy`, "--", "--locked"],
    cwd: workspace,
    env: {
      HOME: "/vercel/sandbox",
      PATH: `${TOOLCHAIN_BIN}:${CARGO_BIN}:/usr/local/bin:/usr/bin:/bin`,
      CARGO_TERM_COLOR: "never",
      CARGO_HTTP_CAINFO: "/etc/pki/tls/certs/ca-bundle.crt",
      SSL_CERT_FILE: "/etc/pki/tls/certs/ca-bundle.crt",
    },
  })
  const stdout = await build.stdout()
  const stderr = await build.stderr()
  if (build.exitCode !== 0) throw commandError("Compilazione del programma Solana", stdout, stderr)

  const artifact = await sandbox.readFileToBuffer({ path: `${workspace}/target/deploy/${PROGRAM_CRATE_NAME}.so` })
  if (!artifact?.length) throw new Error("La compilazione non ha prodotto un programma .so")
  if (artifact.length > MAX_PROGRAM_BYTES) throw new Error("Il programma compilato supera il limite di 2 MB")
  const idlBuild = await runSandboxCommand(sandbox, {
    cmd: `${CARGO_BIN}/cargo`,
    args: ["run", "--quiet", "--release", "--manifest-path", IDL_BUILDER_MANIFEST, "--", workspace],
    cwd: workspace,
    env: {
      HOME: "/vercel/sandbox",
      PATH: `${CARGO_BIN}:${TOOLCHAIN_BIN}:/usr/local/bin:/usr/bin:/bin`,
      CARGO_TERM_COLOR: "never",
      CARGO_HTTP_CAINFO: "/etc/pki/tls/certs/ca-bundle.crt",
      SSL_CERT_FILE: "/etc/pki/tls/certs/ca-bundle.crt",
    },
  })
  const idlStdout = await idlBuild.stdout()
  const idlStderr = await idlBuild.stderr()
  if (idlBuild.exitCode !== 0) throw commandError("Generazione IDL Anchor", idlStdout, idlStderr)
  let idl: Record<string, unknown>
  try {
    idl = JSON.parse(idlStdout) as Record<string, unknown>
  } catch {
    throw new Error("Anchor non ha prodotto un IDL JSON valido")
  }
  idl.address = programId
  return { artifact: new Uint8Array(artifact), byteLength: artifact.length, idl }
}

export async function compileSolanaProgram(source: string, programId: string) {
  try {
    return await compileSolanaProgramInSandbox(source, programId)
  } catch (error) {
    if (error && typeof error === "object" && ("text" in error || "json" in error)) throw sandboxApiError(error)
    throw error
  }
}

function relayerKeypair() {
  const encoded = process.env.SOLANA_DEPLOYER_KEYPAIR || process.env.SOLANA_CREDIT_CONSUMER_KEYPAIR
  if (!encoded) throw new Error("Il wallet tecnico per i deploy Solana non è configurato")
  try {
    const parsed = encoded.trim().startsWith("[")
      ? Uint8Array.from(JSON.parse(encoded) as number[])
      : bs58.decode(encoded.trim())
    return Keypair.fromSecretKey(parsed)
  } catch {
    throw new Error("SOLANA_DEPLOYER_KEYPAIR non contiene una keypair Solana valida")
  }
}

function rpcUrl(cluster: SolanaDeploymentCluster) {
  if (cluster === "devnet") return process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com"
  return process.env.SOLANA_MAINNET_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
}

export function solanaDeployFundingMemo(jobId: string, nonce: string) {
  return `dappster-deploy:${jobId}:${nonce}`
}

export function createSolanaProgramKeypair(seedMaterial?: string) {
  if (!seedMaterial) return Keypair.generate()
  const payer = relayerKeypair()
  const seed = createHmac("sha256", payer.secretKey.slice(0, 32)).update(seedMaterial).digest().subarray(0, 32)
  return Keypair.fromSeed(seed)
}

export async function selectSolanaProgramForDeployment(
  primaryProgram: Keypair,
  recoveryProgram: Keypair,
  cluster: SolanaDeploymentCluster,
) {
  const connection = new Connection(rpcUrl(cluster), { commitment: "confirmed", confirmTransactionInitialTimeout: 120_000 })
  const primaryAccount = await connection.getAccountInfo(primaryProgram.publicKey, "confirmed")
  if (!primaryAccount || primaryAccount.executable) return primaryProgram

  const recoveryAccount = await connection.getAccountInfo(recoveryProgram.publicKey, "confirmed")
  if (recoveryAccount && !recoveryAccount.executable) {
    throw new Error("Both the original and recovery Program IDs contain incomplete accounts")
  }
  return recoveryProgram
}

export async function quoteSolanaProgramDeployment(byteLength: number, cluster: SolanaDeploymentCluster) {
  const payer = relayerKeypair()
  const connection = new Connection(rpcUrl(cluster), { commitment: "confirmed", confirmTransactionInitialTimeout: 120_000 })
  const [bufferRentLamports, programRentLamports] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(UPGRADEABLE_BUFFER_METADATA_BYTES + byteLength, "confirmed"),
    connection.getMinimumBalanceForRentExemption(UPGRADEABLE_PROGRAM_BYTES, "confirmed"),
  ])
  // The loader drains the buffer into the ProgramData account during deploy,
  // so the ProgramData rent must not be charged a second time.
  const rentLamports = bufferRentLamports + programRentLamports
  const signatureCount = 2 + Math.ceil(byteLength / UPGRADEABLE_WRITE_CHUNK_BYTES) + 2 + 1
  const networkFeeLamports = Math.max(MIN_DEPLOY_FEE_BUFFER, Math.ceil(signatureCount * LAMPORTS_PER_SIGNATURE * 1.15))
  const requiredLamports = rentLamports + networkFeeLamports
  return { payer: payer.publicKey.toBase58(), rentLamports, networkFeeLamports, requiredLamports }
}

export async function verifySolanaDeployFunding(input: {
  cluster: SolanaDeploymentCluster
  wallet: string
  signature: string
  requiredLamports: number
  expectedMemo: string
}) {
  const payer = relayerKeypair().publicKey
  const wallet = new PublicKey(input.wallet)
  const connection = new Connection(rpcUrl(input.cluster), { commitment: "confirmed", confirmTransactionInitialTimeout: 120_000 })
  const deadline = Date.now() + 90_000
  let transaction = await connection.getParsedTransaction(input.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
  while (!transaction && Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([input.signature], { searchTransactionHistory: true })).value[0]
    if (status?.err) throw new Error("The SOL funding transaction failed and was not charged. Try deployment again.")
    await new Promise(resolve => setTimeout(resolve, 2_000))
    transaction = await connection.getParsedTransaction(input.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
  }
  if (!transaction) throw new Error("The SOL funding transaction is not confirmed yet. Retry deployment without sending SOL again.")
  if (transaction.meta?.err) throw new Error("The SOL funding transaction failed and was not charged. Try deployment again.")
  if (!transaction.transaction.message.accountKeys.some(key => key.signer && key.pubkey.equals(wallet))) throw new Error("Il wallet collegato non ha firmato il finanziamento")
  const hasMemo = transaction.transaction.message.instructions.some(instruction => {
    if (!instruction.programId.equals(SOLANA_DEPLOY_MEMO_PROGRAM)) return false
    if ("parsed" in instruction) return instruction.parsed === input.expectedMemo
    try { return Buffer.from(bs58.decode(instruction.data)).toString("utf8") === input.expectedMemo } catch { return false }
  })
  let transferredLamports = 0
  const hasTransfer = transaction.transaction.message.instructions.some(instruction => {
    if (!("parsed" in instruction) || !instruction.programId.equals(SystemProgram.programId) || instruction.parsed?.type !== "transfer") return false
    const info = instruction.parsed.info as { source?: string; destination?: string; lamports?: number }
    const matches = info.source === wallet.toBase58() && info.destination === payer.toBase58() && Number(info.lamports) >= input.requiredLamports
    if (matches) transferredLamports = Number(info.lamports)
    return matches
  })
  if (!hasMemo || !hasTransfer) throw new Error(`Invia almeno ${input.requiredLamports} lamport al wallet tecnico dalla stessa transazione richiesta da Dappster`)
  return { transferredLamports }
}

function loaderInstructionData(discriminator: number, size = 4) {
  const data = Buffer.alloc(size)
  data.writeUInt32LE(discriminator, 0)
  return data
}

function initializeBufferInstruction(buffer: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    data: loaderInstructionData(0),
  })
}

function writeBufferInstruction(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Uint8Array) {
  const data = loaderInstructionData(1, 16 + bytes.length)
  data.writeUInt32LE(offset, 4)
  data.writeBigUInt64LE(BigInt(bytes.length), 8)
  Buffer.from(bytes).copy(data, 16)
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  })
}

function deployUpgradeableInstruction(payer: PublicKey, program: PublicKey, buffer: PublicKey, maxDataLength: number) {
  const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
  const data = loaderInstructionData(2, 12)
  data.writeBigUInt64LE(BigInt(maxDataLength), 4)
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: program, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data,
  })
}

function setUpgradeAuthorityInstruction(program: PublicKey, currentAuthority: PublicKey, newAuthority: PublicKey) {
  const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
      { pubkey: newAuthority, isSigner: false, isWritable: false },
    ],
    data: loaderInstructionData(4),
  })
}

function closeBufferInstruction(buffer: PublicKey, recipient: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: loaderInstructionData(5),
  })
}

async function sendLoaderTransaction(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  label: string,
  options: { rateLimitRetries?: number } = {},
) {
  const rateLimitRetries = options.rateLimitRetries ?? 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendAndConfirmTransaction(connection, transaction, signers, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        maxRetries: 20,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const rateLimited = /(?:\b429\b|too many requests|rate[ -]?limit)/i.test(message)
      if (rateLimited && attempt < rateLimitRetries) {
        const delayMs = Math.min(15_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 250)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }

      let logs: string[] | undefined
      if (error instanceof SendTransactionError) {
        try { logs = await error.getLogs(connection) ?? undefined } catch { logs = error.logs ?? undefined }
      }
      throw new Error(`${label} failed: ${message}${logs?.length ? `\n${logs.join("\n")}` : ""}`)
    }
  }
}

async function retryRpcRateLimit<T>(operation: () => Promise<T>, label: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const rateLimited = /(?:\b429\b|too many requests|rate[ -]?limit)/i.test(message)
      if (!rateLimited || attempt >= PROGRAM_WRITE_RATE_LIMIT_RETRIES) {
        throw new Error(`${label} failed: ${message}`)
      }
      const delayMs = Math.min(15_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 250)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

async function sendProgramWriteBatch(
  connection: Connection,
  payer: Keypair,
  buffer: PublicKey,
  writes: Array<{ offset: number; bytes: Uint8Array }>,
  publicRpc: boolean,
) {
  const latestBlockhash = await retryRpcRateLimit(
    () => connection.getLatestBlockhash("confirmed"),
    "Program write blockhash",
  )
  const submitted: Array<{ offset: number; signature: string }> = []
  const sendDelayMs = publicRpc ? PROGRAM_WRITE_PUBLIC_RPC_DELAY_MS : PROGRAM_WRITE_PRIVATE_RPC_DELAY_MS

  for (const write of writes) {
    const transaction = new Transaction({
      feePayer: payer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }).add(writeBufferInstruction(buffer, payer.publicKey, write.offset, write.bytes))
    transaction.sign(payer)
    const rawTransaction = transaction.serialize()
    const signature = await retryRpcRateLimit(
      () => connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 20,
      }),
      `Program write at byte ${write.offset}`,
    )
    submitted.push({ offset: write.offset, signature })
    await new Promise(resolve => setTimeout(resolve, sendDelayMs))
  }

  const deadline = Date.now() + PROGRAM_WRITE_CONFIRM_TIMEOUT_MS
  while (Date.now() < deadline) {
    const statuses = await retryRpcRateLimit(
      () => connection.getSignatureStatuses(submitted.map(item => item.signature), { searchTransactionHistory: true }),
      `Program write confirmation at byte ${writes[0]?.offset ?? 0}`,
    )
    let confirmed = 0
    for (let index = 0; index < submitted.length; index += 1) {
      const status = statuses.value[index]
      if (status?.err) {
        throw new Error(`Program write at byte ${submitted[index].offset} failed: ${JSON.stringify(status.err)}`)
      }
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") confirmed += 1
    }
    if (confirmed === submitted.length) return

    const blockHeight = await retryRpcRateLimit(
      () => connection.getBlockHeight("confirmed"),
      "Program write block height",
    )
    if (blockHeight > latestBlockhash.lastValidBlockHeight) {
      throw new Error(`Program write batch at byte ${writes[0]?.offset ?? 0} expired before confirmation`)
    }
    await new Promise(resolve => setTimeout(resolve, 750))
  }
  throw new Error(`Program write batch at byte ${writes[0]?.offset ?? 0} was not confirmed in time`)
}

function programDataAuthority(data: Buffer) {
  if (data.length < UPGRADEABLE_PROGRAMDATA_METADATA_BYTES || data.readUInt32LE(0) !== 3) return null
  if (data[12] !== 1) return "immutable"
  return new PublicKey(data.subarray(13, 45)).toBase58()
}

async function handProgramAuthorityToUser(
  connection: Connection,
  payer: Keypair,
  program: PublicKey,
  userAuthority: PublicKey,
) {
  const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
  const account = await connection.getAccountInfo(programData, "confirmed")
  if (!account) throw new Error("ProgramData account was not created")
  const authority = programDataAuthority(Buffer.from(account.data))
  if (authority === userAuthority.toBase58()) return
  if (authority !== payer.publicKey.toBase58()) {
    throw new Error(authority === "immutable" ? "The deployed program is immutable" : "Unexpected ProgramData authority")
  }
  await sendLoaderTransaction(
    connection,
    new Transaction().add(setUpgradeAuthorityInstruction(program, payer.publicKey, userAuthority)),
    [payer],
    "Transfer of program authority",
  )
}

async function ensureTechnicalWalletBalance(
  connection: Connection,
  payer: PublicKey,
  requiredLamports: number,
  cluster: SolanaDeploymentCluster,
) {
  let balance = await connection.getBalance(payer, "confirmed")
  if (balance >= requiredLamports) return balance

  // A legacy BPFLoader2 attempt may have stranded the old Program account's
  // rent before management instructions were disabled. Devnet SOL has no
  // monetary value, so use the official RPC faucet to repair that migration
  // shortfall. Mainnet funding always remains the user's responsibility.
  if (cluster === "devnet") {
    const shortfall = requiredLamports - balance
    const airdropLamports = Math.min(
      1_000_000_000,
      Math.max(DEVNET_RECOVERY_AIRDROP_MIN_LAMPORTS, shortfall + MIN_DEPLOY_FEE_BUFFER),
    )
    try {
      const signature = await connection.requestAirdrop(payer, airdropLamports)
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
        if (status?.err) break
        balance = await connection.getBalance(payer, "confirmed")
        if (balance >= requiredLamports) return balance
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    } catch {
      // Report the exact remaining amount below if the public faucet is
      // temporarily rate-limited or disabled by the configured RPC provider.
    }
    balance = await connection.getBalance(payer, "confirmed")
  }

  if (balance < requiredLamports) {
    const missingSol = ((requiredLamports - balance) / 1_000_000_000).toFixed(9)
    throw new Error(`The technical wallet ${payer.toBase58()} is short by ${missingSol} SOL on ${cluster}. The existing deployment payment is still recorded.`)
  }
  return balance
}

export async function deployCompiledSolanaProgram(
  artifact: Uint8Array,
  program: Keypair,
  cluster: SolanaDeploymentCluster,
  userAuthority: PublicKey,
) {
  const payer = relayerKeypair()
  const connection = new Connection(rpcUrl(cluster), { commitment: "confirmed", confirmTransactionInitialTimeout: 120_000 })
  let selectedProgram = program
  let existing = await connection.getAccountInfo(selectedProgram.publicKey, "confirmed")
  if (existing?.executable) {
    await handProgramAuthorityToUser(connection, payer, selectedProgram.publicKey, userAuthority)
    return { programId: selectedProgram.publicKey.toBase58(), payer: payer.publicKey.toBase58() }
  }
  if (existing) throw new Error("The generated Program ID already contains an incomplete account")

  const buffer = Keypair.generate()
  const bufferSpace = UPGRADEABLE_BUFFER_METADATA_BYTES + artifact.length
  const [bufferRent, programRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(bufferSpace, "confirmed"),
    connection.getMinimumBalanceForRentExemption(UPGRADEABLE_PROGRAM_BYTES, "confirmed"),
  ])
  await ensureTechnicalWalletBalance(
    connection,
    payer.publicKey,
    bufferRent + programRent + MIN_DEPLOY_FEE_BUFFER,
    cluster,
  )

  let bufferCreated = false
  try {
    await sendLoaderTransaction(
      connection,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: buffer.publicKey,
          lamports: bufferRent,
          space: bufferSpace,
          programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        }),
        initializeBufferInstruction(buffer.publicKey, payer.publicKey),
      ),
      [payer, buffer],
      "Upgradeable buffer initialization",
    )
    bufferCreated = true

    const publicRpc = rpcUrl(cluster).includes("solana.com")
    for (let batchOffset = 0; batchOffset < artifact.length; batchOffset += UPGRADEABLE_WRITE_CHUNK_BYTES * PROGRAM_WRITE_BATCH_SIZE) {
      const writes: Array<{ offset: number; bytes: Uint8Array }> = []
      for (let index = 0; index < PROGRAM_WRITE_BATCH_SIZE; index += 1) {
        const offset = batchOffset + index * UPGRADEABLE_WRITE_CHUNK_BYTES
        if (offset >= artifact.length) break
        const bytes = artifact.slice(offset, Math.min(offset + UPGRADEABLE_WRITE_CHUNK_BYTES, artifact.length))
        writes.push({ offset, bytes })
      }
      // The batch shares one blockhash and confirms every signature in a
      // single status request. This avoids one confirmation poller per chunk,
      // which caused both RPC 429s and Vercel's five-minute timeout.
      await sendProgramWriteBatch(connection, payer, buffer.publicKey, writes, publicRpc)
    }

    await sendLoaderTransaction(
      connection,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: selectedProgram.publicKey,
          lamports: programRent,
          space: UPGRADEABLE_PROGRAM_BYTES,
          programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        }),
        deployUpgradeableInstruction(payer.publicKey, selectedProgram.publicKey, buffer.publicKey, artifact.length),
      ),
      [payer, selectedProgram],
      "Upgradeable program deployment",
    )
    bufferCreated = false
  } catch (error) {
    if (bufferCreated) {
      await sendLoaderTransaction(
        connection,
        new Transaction().add(closeBufferInstruction(buffer.publicKey, payer.publicKey, payer.publicKey)),
        [payer],
        "Upgradeable buffer cleanup",
      ).catch(() => undefined)
    }
    throw error
  }

  const account = await connection.getAccountInfo(selectedProgram.publicKey, "confirmed")
  if (!account?.executable || !account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
    throw new Error("The program is not executable under Solana Upgradeable Loader after deployment")
  }
  await handProgramAuthorityToUser(connection, payer, selectedProgram.publicKey, userAuthority)
  return { programId: selectedProgram.publicKey.toBase58(), payer: payer.publicKey.toBase58() }
}
