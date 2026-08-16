"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Check, Copy, Eye, ExternalLink, Loader2, Rocket, Sparkles, X } from "lucide-react"
import { useWallet } from "@solana/wallet-adapter-react"
import bs58 from "bs58"
import { Buffer } from "buffer"
import { clusterApiUrl, Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js"
import { createPublicClient, createWalletClient, custom, decodeEventLog, encodeDeployData, encodeFunctionData, keccak256, parseEther, type Abi } from "viem"
import { useCurrentAccount as useSuiAccount, useDAppKit, useWallets as useSuiWallets } from "@mysten/dapp-kit-react"
import { Transaction as SuiTransaction } from "@mysten/sui/transactions"
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react"
import { Network } from "@aptos-labs/ts-sdk"
import { apiFetch } from "@/lib/client-api"
import { burnCreditsFromUserWallet, clearPendingCreditBurn, type CreditBurnProof } from "@/lib/client-credit-burn"
import { getConnectedEvmWallet, LinkedEvmAccountMismatchError } from "@/lib/connected-evm-wallet"
import { DAPPSTER_DEPLOYMENT_FEE, DAPPSTER_FEE_RECIPIENT } from "@/lib/deployment-fee"
import { DAPPSTER_FACTORY_ABI, DAPPSTER_FACTORY_ADDRESS, DAPPSTER_FACTORY_RUNTIME_CODE_HASH, getFactoryBootstrapData, SAFE_SINGLETON_FACTORY } from "@/lib/deployment-factory"
import { blast, DEFAULT_EVM_CHAIN_ID, EVM_EXPLORERS, fraxtal, getEvmTransport, getSupportedEvmChain, linea, mode, optimism, robinhood, SUPPORTED_EVM_CHAINS } from "@/lib/evm-chains"
import { buildHTMLShell } from "@/lib/frontend-shell"
import { resolveIpfsUrl } from "@/lib/ipfs"
import { solanaDeployAuthorizationMessage } from "@/lib/solana-deploy-auth"
import { useSolanaDeploymentNetwork, type SolanaDeploymentCluster } from "@/components/WalletProvider"
import type { Chain } from "@/types"
import { CHAIN_ADAPTERS, CHAIN_IDS, getChainAdapter } from "@/lib/chain-adapters"
import type { AptosMoveArtifact, SuiMoveArtifact } from "@/lib/move-compiler"

const SOLANA_GENESIS_HASH: Record<SolanaDeploymentCluster, string> = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
}

type Generation = {
  dappId: string
  name: string
  contract: string
  frontend: string
  deployInstructions: string
  warnings: string[]
  creditsRemaining: number | null
  mode: "local" | "supabase"
}

type CompiledArtifact = {
  contractName: string
  abi: Abi
  bytecode: `0x${string}`
  constructorInputs: Array<{ name: string; type: string }>
  warnings: string[]
  evmVersion: "paris" | "cancun"
  repairedSource?: string
}

type InjectedEvmProvider = {
  providers?: InjectedEvmProvider[]
  isMetaMask?: boolean
  isRabby?: boolean
  isZerion?: boolean
}

function isZerionProvider(provider: unknown) {
  return Boolean((provider as InjectedEvmProvider | undefined)?.isZerion)
}

function selectDeploymentProvider(injected: unknown, chainId: number) {
  const root = injected as InjectedEvmProvider
  if (chainId !== robinhood.id) return root
  const providers = root.providers?.length ? root.providers : [root]
  const supported = providers.find(provider => provider.isMetaMask && !provider.isZerion)
    || providers.find(provider => provider.isRabby)
    || providers.find(provider => !provider.isZerion)
  if (!supported || supported.isZerion) {
    throw new Error("Zerion cannot sign this Robinhood Chain contract deployment. Open Dappster with MetaMask, Rabby, or Robinhood Wallet and connect the same address, then deploy again.")
  }
  return supported
}

type EvmContractDeployment = {
  kind: "evm"
  address: `0x${string}`
  txHash?: `0x${string}`
  chainId: number
  status: "confirmed"
}

type SolanaProgramDeployment = {
  kind: "solana"
  address: string
  cluster: "devnet" | "mainnet-beta"
  status: "confirmed"
}

type SuiPackageDeployment = {
  kind: "sui"
  address: string
  txHash: string
  network: "testnet"
  status: "confirmed"
}

type AptosPackageDeployment = {
  kind: "aptos"
  address: string
  txHash: `0x${string}`
  network: "devnet"
  status: "confirmed"
}

type SolanaDeploymentQuote = {
  jobId: string
  cluster: SolanaDeploymentCluster
  memo: string
  payer: string
  programId: string
  byteLength: number
  requiredLamports: number
  requiredSol: string
  fundingSignature: string | null
  status: "quoted" | "funded" | "deploying" | "confirmed" | "failed"
}

type CompilerRepairResult = {
  status: "repaired"
  repairedSource: string
}

type QueuedSolanaDeployment = {
  kind: "solana-job"
  jobId: string
  programId: string
  cluster: "devnet" | "mainnet-beta"
  status: "queued"
}

type PendingSolanaFunding = {
  signature: string
  blockhash: string
  lastValidBlockHeight: number
}

type ContractDeployment = EvmContractDeployment | SolanaProgramDeployment | SuiPackageDeployment | AptosPackageDeployment

type Deployment = { cid: string; url: string; creditsRemaining: number; status: "live" }
type DeployStage = "quoting" | "funding" | "queued" | "compiling" | "wallet" | "confirming" | "recording" | "burning" | "pinning" | null

type PreparedGeneration = {
  dappId: string
  prompt: string
  chain: Chain
  evmChainId?: number
  solanaCluster?: SolanaDeploymentCluster
  creditBurn: CreditBurnProof | null
  startedAt: number
}

async function loadCreditBalance() {
  const workspace = await apiFetch<{ profile?: { credits?: number } }>("/api/me")
  const credits = workspace.profile?.credits
  return typeof credits === "number" && Number.isFinite(credits) ? credits : null
}

async function hasFreeFrontendDeployment(chain: Chain) {
  const workspace = await apiFetch<{
    profile?: { plan?: string; plan_expires_at?: string | null }
    testerTiers?: { solana?: { eligible?: boolean }; evm?: { eligible?: boolean } }
  }>("/api/me")
  const profile = workspace.profile
  const activePro = profile?.plan === "pro"
    && Boolean(profile.plan_expires_at)
    && new Date(profile.plan_expires_at!).getTime() > Date.now()
  const holderBenefit = chain === "solana"
    ? workspace.testerTiers?.solana?.eligible === true
    : chain === "evm"
      ? workspace.testerTiers?.evm?.eligible === true
      : false
  return activePro || holderBenefit
}

type SavedGenerationProject = {
  id: string
  name: string
  description?: string
  chain: Chain
  contract_code?: string
  frontend_code?: string
}

const PENDING_GENERATION_KEY = "dappster-pending-generation"

function rememberProject(generation: Generation, prompt: string, chain: Chain, contract?: ContractDeployment, deployment?: Deployment, targetChainId?: number, targetSolanaCluster?: "devnet" | "mainnet-beta") {
  if (generation.mode !== "local") {
    localStorage.removeItem("dappster-projects")
    return
  }
  const current = JSON.parse(localStorage.getItem("dappster-projects") || "[]") as Record<string, unknown>[]
  const project = {
    id: generation.dappId,
    name: generation.name,
    description: prompt,
    chain,
    contract_code: generation.contract,
    frontend_code: generation.frontend,
    contract_address: contract?.address,
    contract_tx_hash: contract && contract.kind !== "solana" ? contract.txHash : undefined,
    contract_chain_id: contract?.kind === "evm" ? contract.chainId : targetChainId,
    contract_network: contract?.kind === "solana" ? contract.cluster : contract?.kind === "sui" ? "sui-testnet" : contract?.kind === "aptos" ? "aptos-devnet" : targetSolanaCluster,
    deploy_status: deployment?.status || "draft",
    ipfs_hash: deployment?.cid,
    ipfs_url: deployment?.url,
    updated_at: new Date().toISOString(),
  }
  localStorage.setItem("dappster-projects", JSON.stringify([project, ...current.filter(item => item.id !== generation.dappId)]))
}

function stageLabel(stage: DeployStage, chain: Chain, solanaCluster: SolanaDeploymentCluster) {
  const adapter = getChainAdapter(chain)
  if (stage === "quoting") return "Calculating required SOL..."
  if (stage === "funding") return `Fund the technical wallet on Solana ${solanaCluster === "devnet" ? "Devnet" : "Mainnet"}...`
  if (stage === "queued") return "Deploy queued · waiting for the Solana relayer..."
  if (stage === "compiling") return chain === "solana" ? "Compiling and deploying on Solana..." : chain === "sui" || chain === "aptos" ? `Compiling ${adapter.language} in an isolated sandbox...` : "Compiling Solidity..."
  if (stage === "wallet") return chain === "solana" ? "Authorize deployment in Phantom..." : `Confirm ${adapter.contractNoun.toLowerCase()} deployment in wallet...`
  if (stage === "confirming") return `Waiting for ${adapter.name} confirmation...`
  if (stage === "recording") return "Verifying deployment receipt..."
  if (stage === "burning") return "Confirm the 2-credit burn on Base..."
  if (stage === "pinning") return "Publishing frontend to IPFS..."
  return adapter.deploymentReady ? `Deploy ${adapter.contractNoun.toLowerCase()} + frontend` : `${adapter.name} deploy pipeline coming next`
}

function explorerUrl(deployment: ContractDeployment) {
  if (deployment.kind === "solana") return `https://explorer.solana.com/address/${deployment.address}${deployment.cluster === "devnet" ? "?cluster=devnet" : ""}`
  if (deployment.kind === "sui") return `https://suiscan.xyz/testnet/object/${deployment.address}`
  if (deployment.kind === "aptos") return `https://explorer.aptoslabs.com/account/${deployment.address}?network=devnet`
  const explorer = EVM_EXPLORERS[deployment.chainId]
  return explorer ? `${explorer}/address/${deployment.address}` : ""
}

function pendingSolanaFundingKey(jobId: string) {
  return `dappster:solana-funding:${jobId}`
}

function readPendingSolanaFunding(jobId: string): PendingSolanaFunding | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingSolanaFundingKey(jobId)) || "null") as PendingSolanaFunding | null
    return value?.signature && value.blockhash && Number.isSafeInteger(value.lastValidBlockHeight) ? value : null
  } catch {
    return null
  }
}

function transactionMatchesFunding(transaction: ParsedTransactionWithMeta | null, input: {
  wallet: PublicKey
  payer: PublicKey
  lamports: number
  memo: string
}) {
  if (!transaction || transaction.meta?.err) return false
  let hasTransfer = false
  let hasMemo = false
  for (const instruction of transaction.transaction.message.instructions) {
    if (instruction.programId.equals(SystemProgram.programId) && "parsed" in instruction && instruction.parsed?.type === "transfer") {
      const info = instruction.parsed.info as { source?: string; destination?: string; lamports?: number }
      hasTransfer ||= info.source === input.wallet.toBase58()
        && info.destination === input.payer.toBase58()
        && Number(info.lamports) >= input.lamports
    }
    if (instruction.programId.toBase58() === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
      if ("parsed" in instruction) hasMemo ||= instruction.parsed === input.memo
      else {
        try { hasMemo ||= Buffer.from(bs58.decode(instruction.data)).toString("utf8") === input.memo } catch { /* malformed memo */ }
      }
    }
  }
  return hasTransfer && hasMemo
}

async function recoverConfirmedSolanaFunding(connection: Connection, quote: SolanaDeploymentQuote, wallet: PublicKey) {
  const payer = new PublicKey(quote.payer)
  const retryRead = async <T,>(operation: () => Promise<T>) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/(?:\b429\b|too many requests|rate[ -]?limit)/i.test(message) || attempt >= 6) throw error
        const delayMs = Math.min(10_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 250)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  const recent = await retryRead(() => connection.getSignaturesForAddress(payer, { limit: 25 }, "confirmed"))
  if (!recent.length) return null
  // Some production Solana RPC providers return a single JSON-RPC object for
  // batch requests. web3.js expects an array and throws `unsafeRes.map is not
  // a function`, so read transactions individually for provider compatibility.
  // Sequential requests also reduce 429s on public and shared endpoints.
  for (const item of recent) {
    const transaction = await retryRead(() => connection.getParsedTransaction(item.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }))
    if (transactionMatchesFunding(transaction, {
      wallet,
      payer,
      lamports: quote.requiredLamports,
      memo: quote.memo,
    })) return item.signature
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return null
}

export function PromptBuilder() {
  const [chain, setChain] = useState<Chain>("evm")
  const solana = useWallet()
  const suiDAppKit = useDAppKit()
  const suiAccount = useSuiAccount()
  const suiWallets = useSuiWallets()
  const aptos = useAptosWallet()
  const [suiWalletName, setSuiWalletName] = useState("")
  const [aptosWalletName, setAptosWalletName] = useState("")
  const { cluster: solanaCluster, endpoint: solanaEndpoint, setCluster: setSolanaCluster } = useSolanaDeploymentNetwork()
  const [evmChainId, setEvmChainId] = useState<number>(DEFAULT_EVM_CHAIN_ID)
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [deployStage, setDeployStage] = useState<DeployStage>(null)
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [artifact, setArtifact] = useState<CompiledArtifact | null>(null)
  const [constructorArgs, setConstructorArgs] = useState("[]")
  const [contractDeployment, setContractDeployment] = useState<ContractDeployment | null>(null)
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [tab, setTab] = useState<"contract" | "frontend" | "instructions">("contract")
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [recoveryTxHash, setRecoveryTxHash] = useState("")
  const [error, setError] = useState("")
  const [repairNotice, setRepairNotice] = useState("")
  const generationAbortRef = useRef<AbortController | null>(null)
  const generationRunRef = useRef(0)

  useEffect(() => () => generationAbortRef.current?.abort(), [])

  useEffect(() => {
    let active = true
    void loadCreditBalance()
      .then(credits => { if (active && credits !== null) setCreditBalance(credits) })
      .catch(() => { /* Generation responses still provide the authoritative post-action balance. */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!suiWalletName && suiWallets[0]) setSuiWalletName(suiWallets[0].name)
  }, [suiWalletName, suiWallets])

  useEffect(() => {
    if (!aptosWalletName && aptos.wallets[0]) setAptosWalletName(aptos.wallets[0].name)
  }, [aptosWalletName, aptos.wallets])

  useEffect(() => {
    let active = true
    const resumePendingGeneration = async () => {
      if (document.visibilityState !== "visible" || new URLSearchParams(window.location.search).get("project")) return
      let runId: number | null = null
      try {
        const pending = JSON.parse(localStorage.getItem(PENDING_GENERATION_KEY) || "null") as PreparedGeneration | null
        if (!pending?.dappId) return
        const workspace = await apiFetch<{ dapps?: Array<{ id: string }> }>("/api/me")
        if (!workspace.dapps?.some(project => project.id === pending.dappId)) {
          localStorage.removeItem(PENDING_GENERATION_KEY)
          return
        }
        setPrompt(pending.prompt)
        setChain(pending.chain)
        if (pending.evmChainId && getSupportedEvmChain(pending.evmChainId)) setEvmChainId(pending.evmChainId)
        if (pending.solanaCluster) setSolanaCluster(pending.solanaCluster)
        runId = ++generationRunRef.current
        setLoading(true)
        setError("")
        const recovered = await recoverPreparedGeneration(pending, 132, runId)
        if (active && generationRunRef.current === runId && !recovered) setError("Generation is still processing. Dappster will recover it when it is ready; you can safely keep this page open or return later.")
      } catch {
        if (active) localStorage.removeItem(PENDING_GENERATION_KEY)
      } finally {
        if (active && runId !== null && generationRunRef.current === runId) setLoading(false)
      }
    }
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void resumePendingGeneration() }
    document.addEventListener("visibilitychange", onVisibilityChange)
    void resumePendingGeneration()
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
    // Recovery only uses stable React setters plus the persisted payload; rerunning
    // it because helper function identities change would start duplicate polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSolanaCluster])

  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get("project")
    if (projectId) {
      void apiFetch<{
        id: string
        name: string
        description?: string
        chain: Chain
        contract_code?: string
        frontend_code?: string
        contract_address?: string
        contract_tx_hash?: string
        contract_chain_id?: number | null
        contract_network?: string | null
        ipfs_hash?: string
        ipfs_url?: string
      }>(`/api/dapps/${projectId}`).then(project => {
        if (!project.contract_code || !project.frontend_code) throw new Error("This generated project is incomplete or unavailable")
        setChain(project.chain)
        setPrompt(project.description || `Resume deployment of ${project.name}`)
        setGeneration({
          dappId: project.id,
          name: project.name,
          contract: project.contract_code,
          frontend: project.frontend_code,
          deployInstructions: "This saved Dappster project is ready to continue deployment with your linked wallet.",
          warnings: [],
          creditsRemaining: null,
          mode: "supabase",
        })
        if (project.chain === "evm") {
          if (project.contract_chain_id && getSupportedEvmChain(project.contract_chain_id)) setEvmChainId(project.contract_chain_id)
          if (project.contract_address) {
            if (!project.contract_chain_id || !getSupportedEvmChain(project.contract_chain_id)) throw new Error("The saved contract is missing its supported EVM network. Recover the deployment transaction before publishing the frontend.")
            setContractDeployment({
              kind: "evm",
              address: project.contract_address as `0x${string}`,
              txHash: /^0x[0-9a-fA-F]{64}$/.test(project.contract_tx_hash || "") ? project.contract_tx_hash as `0x${string}` : undefined,
              chainId: project.contract_chain_id,
              status: "confirmed",
            })
          }
        } else if (project.chain === "solana") {
          const cluster: SolanaDeploymentCluster = project.contract_network === "mainnet-beta" ? "mainnet-beta" : "devnet"
          setSolanaCluster(cluster)
          if (project.contract_address) setContractDeployment({ kind: "solana", address: project.contract_address, cluster, status: "confirmed" })
        } else if (project.chain === "sui" && project.contract_address && project.contract_tx_hash) {
          setContractDeployment({ kind: "sui", address: project.contract_address, txHash: project.contract_tx_hash, network: "testnet", status: "confirmed" })
        } else if (project.chain === "aptos" && project.contract_address && /^0x[0-9a-fA-F]{64}$/.test(project.contract_tx_hash || "")) {
          setContractDeployment({ kind: "aptos", address: project.contract_address, txHash: project.contract_tx_hash as `0x${string}`, network: "devnet", status: "confirmed" })
        }
        if (project.ipfs_hash || project.ipfs_url) setDeployment({ cid: project.ipfs_hash || "published", url: project.ipfs_url || resolveIpfsUrl(project.ipfs_hash) || "", creditsRemaining: 0, status: "live" })
        setTab("contract")
      }).catch(cause => setError(cause instanceof Error ? cause.message : "Saved project could not be loaded"))
      return
    }
    localStorage.removeItem("dappster-projects")
  }, [setSolanaCluster])

  function applyRecoveredGeneration(project: SavedGenerationProject, pending: PreparedGeneration) {
    if (!project.contract_code || !project.frontend_code) return false
    const output: Generation = {
      dappId: project.id,
      name: project.name,
      contract: project.contract_code,
      frontend: project.frontend_code,
      deployInstructions: "This recovered Dappster project is ready for review and deployment.",
      warnings: [],
      creditsRemaining: null,
      mode: "supabase",
    }
    setGeneration(output)
    void loadCreditBalance().then(credits => { if (credits !== null) setCreditBalance(credits) }).catch(() => {})
    setTab("contract")
    setError("")
    clearPendingCreditBurn(pending.creditBurn)
    localStorage.removeItem(PENDING_GENERATION_KEY)
    rememberProject(output, pending.prompt, pending.chain, undefined, undefined, pending.evmChainId, pending.solanaCluster)
    return true
  }

  async function recoverPreparedGeneration(pending: PreparedGeneration, attempts = 1, runId = generationRunRef.current) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (generationRunRef.current !== runId) return false
      try {
        const project = await apiFetch<SavedGenerationProject>(`/api/dapps/${pending.dappId}`)
        if (generationRunRef.current !== runId) return false
        if (applyRecoveredGeneration(project, pending)) return true
      } catch {
        // The authenticated project may still be committing after a suspended request.
      }
      // Retry the durable job once near the beginning (for a fast provider
      // failure) and once after the five-minute worker lease can expire. Avoid
      // repeated POSTs so recovery cannot consume the generation rate limit.
      if (attempt === 4 || attempt === 124) {
        try {
          const output = await apiFetch<Generation>("/api/generate", {
            method: "POST",
            body: JSON.stringify({
              prompt: pending.prompt,
              chain: pending.chain,
              evmChainId: pending.evmChainId,
              includeAudit: false,
              creditBurn: pending.creditBurn,
              dappId: pending.dappId,
            }),
          })
          if (generationRunRef.current !== runId) return false
          setGeneration(output)
          setCreditBalance(output.creditsRemaining)
          setTab("contract")
          setError("")
          clearPendingCreditBurn(pending.creditBurn)
          localStorage.removeItem(PENDING_GENERATION_KEY)
          rememberProject(output, pending.prompt, pending.chain, undefined, undefined, pending.evmChainId, pending.solanaCluster)
          return true
        } catch {
          // A live worker still owns the lease or the retry delay has not elapsed.
        }
      }
      if (attempt + 1 < attempts) await new Promise(resolve => window.setTimeout(resolve, 2500))
    }
    return false
  }

  async function generate() {
    if (!prompt.trim()) return
    generationAbortRef.current?.abort()
    const controller = new AbortController()
    generationAbortRef.current = controller
    const runId = ++generationRunRef.current
    const requestedPrompt = prompt.trim()
    const requestedChain = chain
    const requestedEvmChainId = chain === "evm" ? evmChainId : undefined
    const requestedSolanaCluster = chain === "solana" ? solanaCluster : undefined
    setLoading(true)
    setError("")
    setArtifact(null)
    setContractDeployment(null)
    setDeployment(null)
    let prepared: PreparedGeneration | null = null
    try {
      const creditBurn = await burnCreditsFromUserWallet(5, `${requestedChain} dApp generation`)
      if (controller.signal.aborted) throw new DOMException("Generation canceled", "AbortError")
      let savedPending = JSON.parse(localStorage.getItem(PENDING_GENERATION_KEY) || "null") as PreparedGeneration | null
      if (savedPending?.dappId) {
        const workspace = await apiFetch<{ dapps?: Array<{ id: string }> }>("/api/me")
        if (!workspace.dapps?.some(project => project.id === savedPending?.dappId)) {
          localStorage.removeItem(PENDING_GENERATION_KEY)
          savedPending = null
        }
      }
      if (savedPending?.dappId) {
        if (savedPending.prompt !== requestedPrompt || savedPending.chain !== requestedChain || savedPending.evmChainId !== requestedEvmChainId) {
          throw new Error("Another generation is still pending. Wait for Dappster to recover it before starting a different project.")
        }
        prepared = { ...savedPending, creditBurn }
      } else {
        const created = await apiFetch<Array<{ id: string }>>("/api/dapps", {
          method: "POST",
          body: JSON.stringify({ name: "Generating dApp", description: requestedPrompt, chain: requestedChain, tags: [] }),
          signal: controller.signal,
        })
        if (!created[0]?.id) throw new Error("Dappster could not prepare a recoverable generation")
        prepared = {
          dappId: created[0].id,
          prompt: requestedPrompt,
          chain: requestedChain,
          evmChainId: requestedEvmChainId,
          solanaCluster: requestedSolanaCluster,
          creditBurn,
          startedAt: Date.now(),
        }
      }
      localStorage.setItem(PENDING_GENERATION_KEY, JSON.stringify(prepared))
      const output = await apiFetch<Generation>("/api/generate", { method: "POST", signal: controller.signal, body: JSON.stringify({ prompt: requestedPrompt, chain: requestedChain, evmChainId: requestedEvmChainId, includeAudit: false, creditBurn, dappId: prepared.dappId }) })
      if (generationRunRef.current !== runId) return
      clearPendingCreditBurn(creditBurn)
      localStorage.removeItem(PENDING_GENERATION_KEY)
      setGeneration(output)
      setCreditBalance(output.creditsRemaining)
      setTab("contract")
      rememberProject(output, requestedPrompt, requestedChain, undefined, undefined, requestedEvmChainId, requestedSolanaCluster)
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return
      if (generationRunRef.current !== runId) return
      const message = cause instanceof Error ? cause.message : "Generation failed"
      const interrupted = /load failed|failed to fetch|network request failed|networkerror/i.test(message)
      if (prepared && interrupted && await recoverPreparedGeneration(prepared, 132, runId)) return
      setError(interrupted && prepared
        ? "The mobile browser paused the connection. Generation is still recoverable and Dappster will resume it when the saved result is ready."
        : message)
    } finally {
      if (generationRunRef.current === runId) {
        generationAbortRef.current = null
        setLoading(false)
      }
    }
  }

  function cancelGeneration() {
    generationRunRef.current += 1
    generationAbortRef.current?.abort()
    generationAbortRef.current = null
    localStorage.removeItem(PENDING_GENERATION_KEY)
    setLoading(false)
    setError("Generation canceled. A result already completed by the server may still be available in your Dashboard, but it will not replace the project currently shown here.")
  }

  async function publishFrontend(currentContract: ContractDeployment) {
    if (!generation) return
    const freeDeployment = await hasFreeFrontendDeployment(chain)
    let creditBurn: CreditBurnProof | null = null
    if (!freeDeployment) {
      setDeployStage("burning")
      creditBurn = await burnCreditsFromUserWallet(2, "IPFS frontend deployment")
    }
    setDeployStage("pinning")
    const output = await apiFetch<Deployment>("/api/deploy", {
      method: "POST",
      body: JSON.stringify({ dappId: generation.dappId, frontendCode: generation.frontend, chain, contractAddress: currentContract.address, contractTxHash: currentContract.kind === "evm" ? currentContract.txHash : undefined, contractChainId: currentContract.kind === "evm" ? currentContract.chainId : undefined, solanaCluster: currentContract.kind === "solana" ? currentContract.cluster : undefined, creditBurn }),
    })
    if (creditBurn) clearPendingCreditBurn(creditBurn)
    setDeployment(output)
    setCreditBalance(output.creditsRemaining)
    rememberProject(generation, prompt, chain, currentContract, output)
  }

  async function deploy() {
    if (!generation || deployStage) return
    setError("")
    try {
      const selectedAdapter = getChainAdapter(chain)
      if (!selectedAdapter.deploymentReady) throw new Error(`${selectedAdapter.name} source generation and preview are ready. Its isolated ${selectedAdapter.toolchain} compiler, wallet signing, testnet simulation, and receipt verification must be enabled before Dappster can safely deploy it.`)
      if (contractDeployment) {
        await publishFrontend(contractDeployment)
        return
      }
      if (chain === "solana") {
        const targetSolanaCluster = solanaCluster
        const phantom = solana.wallets.find(wallet => wallet.adapter.name === "Phantom")
        if (!phantom) throw new Error("Installa o abilita Phantom per autorizzare il deploy Solana")
        const adapter = phantom.adapter as typeof phantom.adapter & {
          signMessage?: (message: Uint8Array) => Promise<Uint8Array>
          signTransaction?: (transaction: Transaction) => Promise<Transaction>
        }
        solana.select(adapter.name)
        if (!adapter.connected) await adapter.connect()
        if (!adapter.publicKey || !adapter.signMessage || !adapter.signTransaction) throw new Error("Phantom cannot sign this Solana deployment")
        const connection = new Connection(solanaEndpoint, "confirmed")
        const genesisHash = await connection.getGenesisHash()
        if (genesisHash !== SOLANA_GENESIS_HASH[targetSolanaCluster]) {
          throw new Error(`The configured Solana RPC is not ${targetSolanaCluster}. No funding transaction was created.`)
        }
        setDeployStage("quoting")
        const quoteResult = await apiFetch<SolanaDeploymentQuote | CompilerRepairResult>("/api/contracts/solana/quote", {
          method: "POST",
          body: JSON.stringify({ dappId: generation.dappId, cluster: targetSolanaCluster, wallet: adapter.publicKey.toBase58() }),
        })
        if (quoteResult.status === "repaired") {
          const repairedGeneration = { ...generation, contract: quoteResult.repairedSource }
          setGeneration(repairedGeneration)
          rememberProject(repairedGeneration, prompt, "solana", undefined, undefined, undefined, targetSolanaCluster)
          setRepairNotice("Dappster repaired a Solana compiler error and saved the corrected source. Review the updated program, then press Deploy program + frontend again. No SOL was requested.")
          return
        }
        const quote = quoteResult
        if (quote.cluster !== targetSolanaCluster) throw new Error("The Solana deployment quote returned the wrong cluster. No funding transaction was created.")
        const fundingStorageKey = pendingSolanaFundingKey(quote.jobId)
        let fundingSignature = quote.fundingSignature
        let pendingFunding = readPendingSolanaFunding(quote.jobId)
        if (!fundingSignature && pendingFunding) {
          const status = (await connection.getSignatureStatuses([pendingFunding.signature], { searchTransactionHistory: true })).value[0]
          if (status?.err) {
            localStorage.removeItem(fundingStorageKey)
            pendingFunding = null
          } else if (status || await connection.getBlockHeight("confirmed") <= pendingFunding.lastValidBlockHeight) {
            fundingSignature = pendingFunding.signature
          } else {
            // A transaction cannot land once its recent blockhash has expired.
            localStorage.removeItem(fundingStorageKey)
            pendingFunding = null
          }
        }
        if (!fundingSignature) {
          fundingSignature = await recoverConfirmedSolanaFunding(connection, quote, adapter.publicKey)
        }
        if (!fundingSignature) {
          const latestBlockhash = await connection.getLatestBlockhash("confirmed")
          const fundingTransaction = new Transaction({
            feePayer: adapter.publicKey,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          }).add(
            SystemProgram.transfer({ fromPubkey: adapter.publicKey, toPubkey: new PublicKey(quote.payer), lamports: quote.requiredLamports }),
            new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from(quote.memo, "utf8") }),
          )
          setDeployStage("funding")
          const signedFunding = await adapter.signTransaction(fundingTransaction)
          if (!signedFunding.signature) throw new Error("Phantom did not sign the SOL funding transaction")
          fundingSignature = bs58.encode(signedFunding.signature)
          pendingFunding = { signature: fundingSignature, ...latestBlockhash }
          localStorage.setItem(fundingStorageKey, JSON.stringify(pendingFunding))
          const rawFunding = signedFunding.serialize()
          const rpcUrls = Array.from(new Set([connection.rpcEndpoint, clusterApiUrl(targetSolanaCluster)]))
          const broadcastConnections = rpcUrls.map(url => url === connection.rpcEndpoint ? connection : new Connection(url, "confirmed"))
          setDeployStage("confirming")
          let observed = false
          const broadcastDeadline = Date.now() + 150_000
          while (!observed && Date.now() < broadcastDeadline) {
            await Promise.allSettled(broadcastConnections.map(rpc => rpc.sendRawTransaction(rawFunding, {
              skipPreflight: false,
              preflightCommitment: "confirmed",
              maxRetries: 5,
            })))
            const statusResults = await Promise.allSettled(broadcastConnections.map(rpc =>
              rpc.getSignatureStatuses([fundingSignature!], { searchTransactionHistory: true })
            ))
            const statuses = statusResults.flatMap(result => result.status === "fulfilled" ? result.value.value : []).filter(Boolean)
            if (statuses.some(status => status?.err)) {
              localStorage.removeItem(fundingStorageKey)
              throw new Error("The SOL funding transaction failed. Check Phantom activity before trying again.")
            }
            observed = statuses.length > 0
            if (observed) break
            const heightResults = await Promise.allSettled(broadcastConnections.map(rpc => rpc.getBlockHeight("confirmed")))
            const heights = heightResults.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
            if (heights.some(height => height > latestBlockhash.lastValidBlockHeight)) {
              localStorage.removeItem(fundingStorageKey)
              throw new Error("The SOL funding transaction expired and was not charged. Dappster will create a fresh transaction on your next attempt.")
            }
            await new Promise(resolve => setTimeout(resolve, 1_500))
          }
          if (!observed) throw new Error("Solana RPC could not confirm the funding signature. Retry deployment without sending SOL manually.")
        }
        setDeployStage("wallet")
        const message = new TextEncoder().encode(solanaDeployAuthorizationMessage(generation.dappId, targetSolanaCluster, quote.jobId))
        const signature = bs58.encode(await adapter.signMessage(message))
        setDeployStage("compiling")
        let confirmed: SolanaProgramDeployment | null = null
        for (let attempt = 0; attempt < 720 && !confirmed; attempt += 1) {
          const result = await apiFetch<SolanaProgramDeployment | QueuedSolanaDeployment>("/api/contracts/solana/deploy", {
            method: "POST",
            body: JSON.stringify({ dappId: generation.dappId, jobId: quote.jobId, cluster: targetSolanaCluster, wallet: adapter.publicKey.toBase58(), signature, fundingSignature }),
          })
          if (result.kind === "solana") confirmed = result
          else {
            setDeployStage("queued")
            await new Promise(resolve => setTimeout(resolve, 5_000))
          }
        }
        if (!confirmed) throw new Error("Il deploy è ancora in coda. Puoi riprovare senza effettuare un nuovo pagamento.")
        localStorage.removeItem(fundingStorageKey)
        setContractDeployment(confirmed)
        rememberProject(generation, prompt, "solana", confirmed, undefined, undefined, targetSolanaCluster)
        await publishFrontend(confirmed)
        return
      }
      if (chain === "sui") {
        let publisher = suiAccount?.address
        if (!publisher) {
          const wallet = suiWallets.find(candidate => candidate.name === suiWalletName) || suiWallets[0]
          if (!wallet) throw new Error("Install a Sui Wallet Standard wallet such as Slush, then try again")
          setDeployStage("wallet")
          const connected = await suiDAppKit.connectWallet({ wallet })
          publisher = connected.accounts[0]?.address
        }
        if (!publisher) throw new Error("Connect a Sui wallet before deploying")

        setDeployStage("compiling")
        const compiled = await apiFetch<SuiMoveArtifact | CompilerRepairResult>("/api/contracts/move/compile", {
          method: "POST",
          body: JSON.stringify({ chain: "sui", dappId: generation.dappId, publisher }),
        })
        if ("repairedSource" in compiled) {
          const repairedGeneration = { ...generation, contract: compiled.repairedSource }
          setGeneration(repairedGeneration)
          rememberProject(repairedGeneration, prompt, "sui")
          setRepairNotice("Dappster repaired a Sui Move compiler error and saved the corrected source. Review the updated package, then press Deploy package + frontend again. No transaction was requested.")
          return
        }
        const transaction = new SuiTransaction()
        const [upgradeCap] = transaction.publish({ modules: compiled.modules, dependencies: compiled.dependencies })
        transaction.transferObjects([upgradeCap], publisher)

        setDeployStage("wallet")
        const result = await suiDAppKit.signAndExecuteTransaction({ transaction, network: "testnet" })
        if (result.$kind !== "Transaction" || result.Transaction.effects.status.success !== true) {
          const failure = result.FailedTransaction?.effects.status.error
          throw new Error(failure?.message || "The Sui package transaction failed")
        }
        const packageId = result.Transaction.effects.changedObjects.find(object =>
          object.outputState === "PackageWrite" && object.inputState === "DoesNotExist"
        )?.objectId
        if (!packageId) throw new Error("Sui confirmed the transaction but did not return a newly created package")

        const confirmed: SuiPackageDeployment = {
          kind: "sui",
          address: packageId,
          txHash: result.Transaction.effects.transactionDigest,
          network: "testnet",
          status: "confirmed",
        }
        setContractDeployment(confirmed)
        rememberProject(generation, prompt, "sui", confirmed)
        setDeployStage("recording")
        await apiFetch<ContractDeployment>("/api/contracts/record", {
          method: "POST",
          body: JSON.stringify({ chain: "sui", dappId: generation.dappId, packageId, txDigest: confirmed.txHash, publisher, network: "testnet" }),
        })
        await publishFrontend(confirmed)
        return
      }
      if (chain === "aptos") {
        if (!aptos.connected || !aptos.account) {
          const wallet = aptos.wallets.find(candidate => candidate.name === aptosWalletName) || aptos.wallets[0]
          if (!wallet) throw new Error("Install an Aptos Wallet Standard wallet such as Petra, then try again")
          setDeployStage("wallet")
          aptos.connect(wallet.name)
          throw new Error("Approve the Aptos wallet connection, then press Deploy package + frontend again")
        }
        await aptos.changeNetwork(Network.DEVNET)
        const publisher = aptos.account.address.toString()

        setDeployStage("compiling")
        const compiled = await apiFetch<AptosMoveArtifact | CompilerRepairResult>("/api/contracts/move/compile", {
          method: "POST",
          body: JSON.stringify({ chain: "aptos", dappId: generation.dappId, publisher }),
        })
        if ("repairedSource" in compiled) {
          const repairedGeneration = { ...generation, contract: compiled.repairedSource }
          setGeneration(repairedGeneration)
          rememberProject(repairedGeneration, prompt, "aptos")
          setRepairNotice("Dappster repaired an Aptos Move compiler error and saved the corrected source. Review the updated package, then press Deploy package + frontend again. No transaction was requested.")
          return
        }
        setDeployStage("wallet")
        const result = await aptos.signAndSubmitTransaction({
          sender: publisher,
          data: {
            function: "0x1::code::publish_package_txn",
            typeArguments: [],
            functionArguments: [compiled.metadataBytes, compiled.byteCode],
          },
        })
        if (!/^0x[0-9a-fA-F]{64}$/.test(result.hash)) throw new Error("The Aptos wallet did not return a valid transaction hash")

        const confirmed: AptosPackageDeployment = {
          kind: "aptos",
          address: publisher,
          txHash: result.hash as `0x${string}`,
          network: "devnet",
          status: "confirmed",
        }
        setDeployStage("confirming")
        setContractDeployment(confirmed)
        rememberProject(generation, prompt, "aptos", confirmed)
        setDeployStage("recording")
        await apiFetch<ContractDeployment>("/api/contracts/record", {
          method: "POST",
          body: JSON.stringify({ chain: "aptos", dappId: generation.dappId, publisher, txHash: confirmed.txHash, network: "devnet" }),
        })
        await publishFrontend(confirmed)
        return
      }
      const selectedChain = getSupportedEvmChain(evmChainId)
      if (!selectedChain) throw new Error("Select a supported EVM network")

      setDeployStage("compiling")
      const compiled = artifact || await apiFetch<CompiledArtifact>("/api/contracts/compile", {
        method: "POST",
        body: JSON.stringify({ dappId: generation.dappId, contractCode: generation.contract, contractName: generation.name, chainId: selectedChain.id }),
      })
      if (compiled.repairedSource) {
        const { repairedSource, ...repairedArtifact } = compiled
        setArtifact(repairedArtifact)
        const repairedGeneration = { ...generation, contract: repairedSource }
        setGeneration(repairedGeneration)
        rememberProject(repairedGeneration, prompt, chain, undefined, undefined, selectedChain.id)
        setRepairNotice("Dappster repaired a Solidity compilation error and saved the corrected source. Review the updated contract, then press Deploy contract + frontend again to continue.")
        return
      }
      setArtifact(compiled)
      setRepairNotice("")
      if (compiled.constructorInputs.length && constructorArgs.trim() === "[]") {
        setError(`Constructor values required: ${compiled.constructorInputs.map(input => `${input.name || "value"} (${input.type})`).join(", ")}. Enter them as a JSON array, then deploy again.`)
        return
      }
      const args = JSON.parse(constructorArgs) as unknown
      if (!Array.isArray(args)) throw new Error("Constructor values must be a JSON array")
      if (args.length !== compiled.constructorInputs.length) throw new Error(`Expected ${compiled.constructorInputs.length} constructor values, received ${args.length}`)

      setDeployStage("wallet")
      const workspace = await apiFetch<{ wallets?: Array<{ chain?: string; wallet_address?: string }> }>("/api/me")
      const linkedEvmAddresses = (workspace.wallets || [])
        .filter(wallet => wallet.chain === "evm" && typeof wallet.wallet_address === "string")
        .map(wallet => wallet.wallet_address!.replace(/^web3:ethereum:/i, ""))
      let connectedWallet: Awaited<ReturnType<typeof getConnectedEvmWallet>>
      try {
        connectedWallet = await getConnectedEvmWallet(selectedChain, linkedEvmAddresses)
      } catch (walletError) {
        if (linkedEvmAddresses.length && walletError instanceof LinkedEvmAccountMismatchError) {
          const linked = linkedEvmAddresses.map(address => `${address.slice(0, 6)}…${address.slice(-4)}`).join(", ")
          throw new Error(`Select your linked EVM account ${linked} in your wallet, then try again. Dappster will not deploy from an unlinked account.`)
        }
        throw walletError
      }
      const provider = connectedWallet.connector.id === "injected"
        ? selectDeploymentProvider(connectedWallet.provider, selectedChain.id)
        : connectedWallet.provider
      const transport = custom(provider as never)
      const walletClient = createWalletClient({ chain: selectedChain, transport })
      const account = connectedWallet.address
      const activeChainId = await walletClient.getChainId()
      if (activeChainId !== selectedChain.id) throw new Error(`Your wallet did not switch to ${selectedChain.name}`)
      const deploymentValue = parseEther(DAPPSTER_DEPLOYMENT_FEE)
      const rpcClient = createPublicClient({ chain: selectedChain, transport: getEvmTransport(selectedChain) })
      const deploymentData = encodeDeployData({
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args,
      })
      const useFactoryDeployment = connectedWallet.connector.id === "walletConnect" || isZerionProvider(provider)

      if (useFactoryDeployment) {
        const hasOwner = compiled.abi.some(item => item.type === "function" && item.name === "owner" && item.inputs.length === 0)
        const hasTransferOwnership = compiled.abi.some(item => item.type === "function" && item.name === "transferOwnership" && item.inputs.length === 1 && item.inputs[0]?.type === "address")
        if (!hasOwner || !hasTransferOwnership) {
          throw new Error("This generated contract must expose owner() and transferOwnership(address) for secure deployment through Zerion. Generate it again before deploying.")
        }

        let factoryCode = await rpcClient.getBytecode({ address: DAPPSTER_FACTORY_ADDRESS })
        if (!factoryCode) {
          try {
            const bootstrapData = getFactoryBootstrapData()
            const bootstrapEstimate = await rpcClient.estimateGas({ account, to: SAFE_SINGLETON_FACTORY, data: bootstrapData })
            const bootstrapHash = await walletClient.sendTransaction({
              account,
              to: SAFE_SINGLETON_FACTORY,
              data: bootstrapData,
              gas: bootstrapEstimate + bootstrapEstimate / BigInt(4),
              gasPrice: await rpcClient.getGasPrice(),
            })
            const bootstrapReceipt = await rpcClient.waitForTransactionReceipt({ hash: bootstrapHash, confirmations: 1 })
            if (bootstrapReceipt.status !== "success") throw new Error("The Dappster deployment factory setup failed")
          } catch (bootstrapError) {
            // Another user may have completed the deterministic setup between
            // our initial code check and this transaction. Accept only the
            // exact verified runtime; otherwise preserve the original error.
            const concurrentCode = await rpcClient.getBytecode({ address: DAPPSTER_FACTORY_ADDRESS })
            if (!concurrentCode || keccak256(concurrentCode) !== DAPPSTER_FACTORY_RUNTIME_CODE_HASH) throw bootstrapError
          }
          factoryCode = await rpcClient.getBytecode({ address: DAPPSTER_FACTORY_ADDRESS })
        }
        if (!factoryCode || keccak256(factoryCode) !== DAPPSTER_FACTORY_RUNTIME_CODE_HASH) {
          throw new Error("The verified Dappster deployment factory is not available on this network")
        }

        const factoryData = encodeFunctionData({
          abi: DAPPSTER_FACTORY_ABI,
          functionName: "deploy",
          args: [deploymentData],
        })
        let factoryGas: bigint
        try {
          factoryGas = await rpcClient.estimateGas({ account, to: DAPPSTER_FACTORY_ADDRESS, data: factoryData, value: deploymentValue })
        } catch (estimateError) {
          const reason = estimateError instanceof Error ? estimateError.message : "The RPC rejected the factory deployment simulation"
          throw new Error(`${selectedChain.name} could not simulate this secure deployment. Check that the wallet has enough ${selectedChain.nativeCurrency.symbol} for the 0.001 ${selectedChain.nativeCurrency.symbol} deployment fee plus gas. RPC details: ${reason}`)
        }
        const txHash = await walletClient.sendTransaction({
          account,
          to: DAPPSTER_FACTORY_ADDRESS,
          data: factoryData,
          value: deploymentValue,
          gas: factoryGas + factoryGas / BigInt(4),
          gasPrice: await rpcClient.getGasPrice(),
        })
        setDeployStage("confirming")
        const receipt = await rpcClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
        if (receipt.status !== "success") throw new Error("The contract deployment transaction failed")
        const deployedEvent = receipt.logs
          .filter(log => log.address.toLowerCase() === DAPPSTER_FACTORY_ADDRESS.toLowerCase())
          .map(log => {
            try {
              return decodeEventLog({ abi: DAPPSTER_FACTORY_ABI, eventName: "DappsterContractDeployed", data: log.data, topics: log.topics })
            } catch { return null }
          })
          .find(event => event?.args.deployer.toLowerCase() === account.toLowerCase() && event.args.creationCodeHash === keccak256(deploymentData))
        if (!deployedEvent) throw new Error("The deployment factory did not confirm the generated contract")
        const confirmed: EvmContractDeployment = { kind: "evm", address: deployedEvent.args.contractAddress, txHash, chainId: selectedChain.id, status: "confirmed" }
        setContractDeployment(confirmed)
        rememberProject(generation, prompt, chain, confirmed)
        setDeployStage("recording")
        await apiFetch<ContractDeployment>("/api/contracts/record", {
          method: "POST",
          body: JSON.stringify({ chain: "evm", dappId: generation.dappId, address: confirmed.address, txHash: confirmed.txHash, chainId: selectedChain.id }),
        })
        await publishFrontend(confirmed)
        return
      }
      let estimatedGas: bigint
      try {
        estimatedGas = await rpcClient.estimateGas({
          account,
          data: deploymentData,
          value: deploymentValue,
        })
      } catch (estimateError) {
        const reason = estimateError instanceof Error ? estimateError.message : "The RPC rejected the deployment simulation"
        throw new Error(`${selectedChain.name} could not simulate this contract deployment. Check that the wallet has enough ${selectedChain.nativeCurrency.symbol} for the 0.001 ${selectedChain.nativeCurrency.symbol} deployment fee plus gas. RPC details: ${reason}`)
      }
      // Some wallet providers reject large contract-creation requests when they
      // have to estimate gas themselves. Supplying the chain RPC estimate with
      // headroom keeps signing non-custodial while avoiding that wallet-RPC path.
      const gas = estimatedGas + estimatedGas / BigInt(4)
      const walletManagedDeploymentRequest = {
        account,
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args,
        value: deploymentValue,
      }
      const deploymentRequest = {
        ...walletManagedDeploymentRequest,
        gas,
      }
      // Robinhood Chain accepts legacy contract-creation transactions reliably,
      // while some injected wallets build an invalid automatic fee envelope for
      // this custom Arbitrum chain. An explicit gasPrice forces a type-0 request.
      let txHash: `0x${string}`
      if (selectedChain.id === robinhood.id) {
        txHash = await walletClient.deployContract({ ...deploymentRequest, gasPrice: await rpcClient.getGasPrice() })
      } else if (selectedChain.id === linea.id) {
        // WalletConnect's standard EVM contract-creation request omits `to` and
        // supplies gas as a QUANTITY. `gas: null` is only for the optional early
        // access Chain Abstraction flow and must not be used for a native-ETH
        // deployment. A legacy fee keeps the same request compatible with both
        // Zerion's injected provider and Zerion over WalletConnect.
        txHash = await walletClient.deployContract({
          ...deploymentRequest,
          gasPrice: await rpcClient.getGasPrice(),
        })
      } else if (([optimism.id, blast.id, mode.id, fraxtal.id] as number[]).includes(selectedChain.id)) {
        // Some mobile/WalletConnect providers (notably Zerion) calculate and
        // validate L2 gas parameters internally. Passing the public-RPC gas
        // estimate makes them reject otherwise valid contract creations as
        // `Invalid transaction`. The deployment was already simulated above,
        // so let the wallet populate the final Optimism fee envelope.
        txHash = await walletClient.deployContract(walletManagedDeploymentRequest)
      } else {
        txHash = await walletClient.deployContract(deploymentRequest)
      }

      setDeployStage("confirming")
      const receipt = await rpcClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("The contract deployment transaction failed")
      const confirmed: EvmContractDeployment = { kind: "evm", address: receipt.contractAddress, txHash, chainId: selectedChain.id, status: "confirmed" }
      setContractDeployment(confirmed)
      rememberProject(generation, prompt, chain, confirmed)

      setDeployStage("recording")
      await apiFetch<ContractDeployment>("/api/contracts/record", {
        method: "POST",
        body: JSON.stringify({ chain: "evm", dappId: generation.dappId, address: confirmed.address, txHash: confirmed.txHash, chainId: selectedChain.id }),
      })
      await publishFrontend(confirmed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deployment failed")
    } finally {
      setDeployStage(null)
    }
  }

  async function recoverDeployment() {
    if (!generation || deployStage) return
    setError("")
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryTxHash)) throw new Error("Paste the complete contract deployment transaction hash")
      const selectedChain = getSupportedEvmChain(evmChainId)
      if (!selectedChain) throw new Error("Select the network used for the contract deployment")
      setDeployStage("confirming")
      const txHash = recoveryTxHash as `0x${string}`
      const receipt = await createPublicClient({ chain: selectedChain, transport: getEvmTransport(selectedChain) }).getTransactionReceipt({ hash: txHash })
      let recoveredAddress = receipt.contractAddress
      if (!recoveredAddress) {
        const factoryEvent = receipt.logs
          .filter(log => log.address.toLowerCase() === DAPPSTER_FACTORY_ADDRESS.toLowerCase())
          .map(log => {
            try {
              return decodeEventLog({ abi: DAPPSTER_FACTORY_ABI, eventName: "DappsterContractDeployed", data: log.data, topics: log.topics })
            } catch { return null }
          })
          .find(Boolean)
        recoveredAddress = factoryEvent?.args.contractAddress || null
      }
      if (receipt.status !== "success" || !recoveredAddress) throw new Error("This transaction is not a successful Dappster contract deployment on the selected network")
      const confirmed: EvmContractDeployment = { kind: "evm", address: recoveredAddress, txHash, chainId: selectedChain.id, status: "confirmed" }
      setContractDeployment(confirmed)
      rememberProject(generation, prompt, chain, confirmed)
      setDeployStage("recording")
      await apiFetch<ContractDeployment>("/api/contracts/record", {
        method: "POST",
        body: JSON.stringify({ chain: "evm", dappId: generation.dappId, address: confirmed.address, txHash: confirmed.txHash, chainId: confirmed.chainId }),
      })
      await publishFrontend(confirmed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not recover the contract deployment")
    } finally {
      setDeployStage(null)
    }
  }

  async function copy() {
    if (!generation) return
    const value = tab === "contract" ? generation.contract : tab === "frontend" ? generation.frontend : generation.deployInstructions
    await navigator.clipboard?.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const output = generation ? tab === "contract" ? generation.contract : tab === "frontend" ? generation.frontend : generation.deployInstructions : ""
  const selectedAdapter = getChainAdapter(chain)
  const contractExplorer = contractDeployment ? explorerUrl(contractDeployment) : ""
  const previewHtml = useMemo(() => generation ? buildHTMLShell(
    generation.frontend,
    contractDeployment?.address || getChainAdapter(chain).previewAddress,
    chain,
    true,
    chain === "evm" ? artifact?.abi : undefined,
    chain === "evm" ? evmChainId : undefined,
  ) : "", [generation, contractDeployment, chain, artifact, evmChainId])
  const displayedCredits = creditBalance ?? generation?.creditsRemaining ?? null

  return (
    <div className="builder-grid">
      <section className="panel">
        <div className="panel-head"><span className="panel-title">Build configuration</span><span className="chain-badge">5 credits</span></div>
        <div className="panel-body form-stack">
          <div><label className="form-label" htmlFor="target-chain">Target ecosystem</label><select id="target-chain" className="select" value={chain} disabled={Boolean(deployStage || contractDeployment)} onChange={event => { setChain(event.target.value as Chain); setGeneration(null); setArtifact(null); setContractDeployment(null); setDeployment(null); setError("") }}>{CHAIN_IDS.map(id => { const item = CHAIN_ADAPTERS[id]; return <option value={id} key={id}>{item.name} · {item.language}</option> })}</select><div style={{color:"#707883",fontSize:10,lineHeight:1.5,marginTop:7}}>{selectedAdapter.toolchain} · {selectedAdapter.deploymentReady ? `Deployment enabled; start on ${selectedAdapter.testNetwork}.` : `Generation and preview enabled. Secure ${selectedAdapter.testNetwork} deployment adapter is being integrated.`}</div></div>
          {chain === "evm" && <div><label className="form-label" htmlFor="evm-network">EVM deployment network</label><select id="evm-network" className="select" value={evmChainId} disabled={Boolean(deployStage || contractDeployment)} onChange={event => { setEvmChainId(Number(event.target.value)); setArtifact(null); setError(""); setRepairNotice("") }}>{SUPPORTED_EVM_CHAINS.map(network => <option value={network.id} key={network.id}>{network.name} · {network.id}</option>)}</select><div style={{color:"#707883",fontSize:10,lineHeight:1.5,marginTop:7}}>The wallet switches to this network before deployment. The same transaction deploys the contract and sends {DAPPSTER_DEPLOYMENT_FEE} {getSupportedEvmChain(evmChainId)?.nativeCurrency.symbol || "native token"} to {DAPPSTER_FEE_RECIPIENT.slice(0, 8)}…{DAPPSTER_FEE_RECIPIENT.slice(-6)}.</div></div>}
          {chain === "solana" && <div><label className="form-label" htmlFor="solana-network">Solana deployment cluster</label><select id="solana-network" className="select" value={solanaCluster} disabled={Boolean(deployStage || contractDeployment)} onChange={event => setSolanaCluster(event.target.value as SolanaDeploymentCluster)}><option value="devnet">Devnet · recommended for testing</option><option value="mainnet-beta">Mainnet Beta</option></select><div style={{color:"#707883",fontSize:10,lineHeight:1.5,marginTop:7}}>Dappster verifies the selected cluster before Phantom signs anything. You fund the disclosed technical wallet on that cluster; Dappster does not use Mainnet SOL for a Devnet deployment.</div></div>}
          {chain === "sui" && <div><label className="form-label" htmlFor="sui-wallet">Sui testnet wallet</label><select id="sui-wallet" className="select" value={suiWalletName} disabled={Boolean(deployStage || contractDeployment)} onChange={event => setSuiWalletName(event.target.value)}><option value="">Select a Sui wallet</option>{suiWallets.map(wallet => <option value={wallet.name} key={wallet.name}>{wallet.name}</option>)}</select><div style={{color:"#707883",fontSize:10,lineHeight:1.5,marginTop:7}}>The selected wallet publishes the Move package directly on Sui testnet and pays its gas. Dappster never takes custody of the wallet.</div></div>}
          {chain === "aptos" && <div><label className="form-label" htmlFor="aptos-wallet">Aptos devnet wallet</label><select id="aptos-wallet" className="select" value={aptosWalletName} disabled={Boolean(deployStage || contractDeployment)} onChange={event => setAptosWalletName(event.target.value)}><option value="">Select an Aptos wallet</option>{aptos.wallets.map(wallet => <option value={wallet.name} key={wallet.name}>{wallet.name}</option>)}</select><div style={{color:"#707883",fontSize:10,lineHeight:1.5,marginTop:7}}>The selected wallet publishes the Move package directly on Aptos devnet and pays its gas. Dappster never takes custody of the wallet.</div></div>}
          <div><label className="form-label" htmlFor="prompt">What do you want to build?</label><textarea id="prompt" className="textarea" maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={`e.g. ${selectedAdapter.samplePrompts[0]}`} /><div style={{display:"flex",justifyContent:"space-between",marginTop:7,color:"#5f6670",fontSize:10}}><span>Be specific about roles and behavior.</span><span>{prompt.length}/4000</span></div></div>
          <div>
            <div className="example-library-heading">
              <label className="form-label" id="example-prompts-label">Try an example</label>
              <span>{CHAIN_IDS.reduce((total, id) => total + CHAIN_ADAPTERS[id].samplePrompts.length, 0)} ideas across {CHAIN_IDS.length} ecosystems</span>
            </div>
            <div className="example-library">
              <div className="example-library-meta"><strong>{selectedAdapter.name}</strong><span>Scroll to explore</span></div>
              <div className="examples" role="list" aria-labelledby="example-prompts-label">
                {selectedAdapter.samplePrompts.map((sample, index) => <button type="button" className="example" role="listitem" key={sample} onClick={() => setPrompt(sample)}><span>{String(index + 1).padStart(2, "0")}</span>{sample}</button>)}
              </div>
            </div>
          </div>
          {artifact && artifact.constructorInputs.length > 0 && <div><label className="form-label" htmlFor="constructor-args">Constructor values · JSON array</label><textarea id="constructor-args" className="textarea" style={{minHeight:78}} value={constructorArgs} onChange={event => setConstructorArgs(event.target.value)} placeholder='["value", 123]' /><div style={{color:"#707883",fontSize:10,marginTop:7}}>{artifact.constructorInputs.map(input => `${input.name || "value"}: ${input.type}`).join(" · ")}</div></div>}
          {error && <div className="error-box"><AlertCircle size={15} /><span style={{whiteSpace:"pre-wrap"}}>{error}</span></div>}
          {repairNotice && <div className="recovery-box"><Check size={15} /><small style={{display:"block",marginTop:6}}>{repairNotice}</small></div>}
          {generation && chain === "evm" && !contractDeployment && <details className="recovery-box"><summary>Contract already deployed? Recover it</summary><div className="form-stack" style={{marginTop:12}}><div><label className="form-label" htmlFor="deployment-tx">Deployment transaction hash</label><input id="deployment-tx" className="input mono" value={recoveryTxHash} onChange={event => setRecoveryTxHash(event.target.value.trim())} placeholder="0x…" /></div><small>Select the same EVM network used for the transaction. Recovery verifies the fee and continues with IPFS without deploying again.</small><button className="btn btn-outline btn-block" disabled={Boolean(deployStage)} onClick={recoverDeployment}>{deployStage ? <Loader2 className="animate-spin" size={14} /> : <Rocket size={14} />}Recover and publish frontend</button></div></details>}
          {generation && chain === "solana" && !contractDeployment && <div className="recovery-box"><div><strong>User-funded Solana deployment</strong><small style={{display:"block",marginTop:6,lineHeight:1.5}}>Press <span className="mono">Deploy program + frontend</span>. Dappster calculates the required SOL; Phantom first requests funding for the disclosed technical wallet, then asks for deployment authorization. Dappster publishes the frontend only after verifying the program onchain.</small></div></div>}
          {generation && !selectedAdapter.deploymentReady && <div className="recovery-box"><div><strong>{selectedAdapter.name} generation preview</strong><small style={{display:"block",marginTop:6,lineHeight:1.5}}>The generated source and frontend are saved in your Dashboard. Onchain deployment remains disabled until Dappster can compile with {selectedAdapter.toolchain}, simulate on {selectedAdapter.testNetwork}, obtain a user-wallet signature, and verify the resulting {selectedAdapter.contractNoun.toLowerCase()} onchain.</small></div></div>}
          {loading
            ? <button type="button" className="btn btn-outline btn-block" onClick={cancelGeneration}><X size={16} />Cancel generation</button>
            : <button type="button" className="btn btn-primary btn-block" disabled={!prompt.trim()} onClick={generate}><Sparkles size={16} />{generation ? "Generate again" : "Generate dApp"}</button>}
        </div>
      </section>
      <section className="panel code-window">
        <div className="panel-head">
          <div className="status-line"><span className="status-dot" /> {loading ? "Generating contract and interface" : generation ? deployment ? `${selectedAdapter.contractNoun} confirmed · frontend live on IPFS` : contractDeployment ? `${selectedAdapter.contractNoun} confirmed · ready for IPFS` : `Generation complete${displayedCredits === null ? "" : ` · ${displayedCredits} credits left`}` : "Generator ready"}</div>
          {generation && <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}><button className="btn btn-ghost" onClick={() => setPreviewOpen(true)}><Eye size={14} /> Preview</button><button className="btn btn-ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>{deployment ? <a className="btn btn-primary" href={deployment.url} target="_blank" rel="noreferrer">Open dApp <ExternalLink size={14} /></a> : <button className="btn btn-primary" disabled={Boolean(deployStage) || !selectedAdapter.deploymentReady} onClick={deploy}>{deployStage ? <Loader2 className="animate-spin" size={14} /> : <Rocket size={14} />}{stageLabel(deployStage, chain, solanaCluster)}</button>}</div>}
        </div>
        {generation ? <><div className="code-tabs"><button className={`code-tab ${tab === "contract" ? "active" : ""}`} onClick={() => setTab("contract")}>{chain === "evm" ? `${generation.name}.sol` : selectedAdapter.sourceFile}</button><button className={`code-tab ${tab === "frontend" ? "active" : ""}`} onClick={() => setTab("frontend")}>App.tsx</button><button className={`code-tab ${tab === "instructions" ? "active" : ""}`} onClick={() => setTab("instructions")}>Deploy.md</button></div><pre className="code-content">{output}</pre>{generation.warnings?.length > 0 && <div className="warning-list"><strong>Model warnings</strong>{generation.warnings.map(warning => <span key={warning}>• {warning}</span>)}</div>}{contractDeployment && <div className="deploy-result"><div><span className="status"><span className="status-dot" /> {selectedAdapter.contractNoun} confirmed on-chain</span><div className="mono">{contractDeployment.address}</div></div>{contractExplorer && <a href={contractExplorer} target="_blank" rel="noreferrer" className="btn btn-outline">Explorer <ExternalLink size={14} /></a>}</div>}{deployment && <div className="deploy-result"><div><span className="status"><span className="status-dot" /> Frontend live on IPFS</span><div className="mono">{deployment.cid}</div></div><a href={deployment.url} target="_blank" rel="noreferrer" className="btn btn-primary">Open <ExternalLink size={14} /></a></div>}</> : <div className="empty-state"><div><div className="empty-icon"><Sparkles size={24} /></div><strong style={{color:"#abb1b9",fontSize:14}}>Your generated dApp will appear here</strong><p style={{fontSize:12,maxWidth:300,lineHeight:1.6}}>Choose a chain, describe the product, and Dappster will call Grok to generate the contract and interface.</p></div></div>}
      </section>
      {previewOpen && <div className="modal-backdrop" onMouseDown={() => setPreviewOpen(false)}><div className="preview-modal" role="dialog" aria-modal="true" aria-label="Frontend preview" onMouseDown={event => event.stopPropagation()}><div className="preview-toolbar"><div><strong>Frontend preview</strong><small>Isolated preview · no contract deployment or wallet transaction</small></div><button className="btn btn-ghost" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><X size={16} /></button></div><iframe className="preview-frame" title={`${generation?.name || "dApp"} frontend preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={previewHtml} /></div></div>}
    </div>
  )
}
