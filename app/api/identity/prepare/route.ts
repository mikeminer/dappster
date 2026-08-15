import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient, decodeFunctionData, isAddress, keccak256, toBytes, type Hex } from "viem"
import { accountHasWallet } from "@/lib/accounts"
import { canonicalJson } from "@/lib/canonical-json"
import { compileSolidity } from "@/lib/solidity"
import { DAPPSTER_FACTORY_ABI, DAPPSTER_FACTORY_ADDRESS } from "@/lib/deployment-factory"
import { base, getEvmTransport } from "@/lib/evm-chains"
import { getIdentityRegistryAddress } from "@/lib/identity-registry"
import { deployJsonToIPFS } from "@/lib/pinata"
import { getRequestUser } from "@/lib/runtime"
import { supabaseRequest } from "@/lib/supabase"
import { hydrateDappSources } from "@/lib/source-storage"

const requestSchema = z.object({
  dappId: z.string().uuid(),
  publisher: z.string().refine(isAddress, "Invalid EVM publisher address"),
})

type StoredDapp = {
  id: string
  owner_id: string
  name: string
  chain: string
  contract_code: string | null
  source_bundle_path: string | null
  source_bundle_hash: string | null
  contract_address: string | null
  contract_tx_hash: string | null
  contract_chain_id: number | string | null
  ipfs_hash: string | null
  deploy_status: string
  audit_status: string
}

type StoredAudit = { id: string; contract_code: string; report: unknown; created_at: string }

function getCreationCode(transaction: { to: `0x${string}` | null; input: Hex }) {
  if (transaction.to === null) return transaction.input
  if (transaction.to.toLowerCase() !== DAPPSTER_FACTORY_ADDRESS.toLowerCase()) {
    throw new Error("The deployment transaction is not a supported Dappster deployment")
  }
  const decoded = decodeFunctionData({ abi: DAPPSTER_FACTORY_ABI, data: transaction.input })
  if (decoded.functionName !== "deploy") throw new Error("The factory deployment calldata is invalid")
  return decoded.args[0] as Hex
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo) throw new Error("Onchain identity requires a signed-in Dappster account")
    const input = requestSchema.parse(await request.json())
    const registryAddress = getIdentityRegistryAddress()
    if (!registryAddress) throw new Error("The Dappster identity registry is not configured")
    if (!(await accountHasWallet(user.id, "evm", input.publisher))) {
      throw new Error("Connect a linked EVM wallet before anchoring this release")
    }

    const storedDapp = (await supabaseRequest<StoredDapp[]>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "id,owner_id,name,chain,contract_code,source_bundle_path,source_bundle_hash,contract_address,contract_tx_hash,contract_chain_id,ipfs_hash,deploy_status,audit_status", limit: "1" },
    }))[0]
    const dapp = storedDapp ? await hydrateDappSources(storedDapp) : undefined
    if (!dapp) throw new Error("dApp not found")
    if (dapp.chain !== "evm" || Number(dapp.contract_chain_id) !== base.id) {
      throw new Error("Trustless identity anchoring is currently available for Base deployments")
    }
    if (!dapp.contract_code || !dapp.contract_address || !isAddress(dapp.contract_address) || !dapp.contract_tx_hash || !dapp.ipfs_hash) {
      throw new Error("Deploy the Base contract and frontend before anchoring this release")
    }
    if (dapp.deploy_status !== "live" || dapp.audit_status !== "completed") {
      throw new Error("A live IPFS frontend and completed security audit are required")
    }

    const audit = (await supabaseRequest<StoredAudit[]>({
      path: "audits",
      query: { dapp_id: `eq.${dapp.id}`, owner_id: `eq.${user.id}`, status: "eq.completed", select: "id,contract_code,report,created_at", order: "created_at.desc", limit: "1" },
    }))[0]
    if (!audit?.report || audit.contract_code !== dapp.contract_code) {
      throw new Error("Run a new audit against the exact deployed source before anchoring")
    }

    const client = createPublicClient({ chain: base, transport: getEvmTransport(base) })
    const deploymentHash = dapp.contract_tx_hash as Hex
    const contractAddress = dapp.contract_address as `0x${string}`
    const [receipt, transaction, runtimeCode] = await Promise.all([
      client.getTransactionReceipt({ hash: deploymentHash }),
      client.getTransaction({ hash: deploymentHash }),
      client.getBytecode({ address: contractAddress }),
    ])
    if (receipt.status !== "success" || !runtimeCode) throw new Error("The Base deployment could not be verified")
    if (transaction.from.toLowerCase() !== input.publisher.toLowerCase()) {
      throw new Error("Use the linked wallet that deployed this Base contract")
    }
    const creationCode = getCreationCode(transaction)
    const compiled = compileSolidity(dapp.contract_code, dapp.name, { chainId: base.id })
    const auditReportJson = canonicalJson(audit.report)
    const auditScore = Math.max(0, Math.min(100, Math.round(Number((audit.report as { overall_score?: unknown }).overall_score || 0))))
    const hashes = {
      creationCodeHash: keccak256(creationCode),
      runtimeCodeHash: keccak256(runtimeCode),
      sourceHash: keccak256(toBytes(dapp.contract_code.replace(/\r\n/g, "\n"))),
      frontendCidHash: keccak256(toBytes(dapp.ipfs_hash)),
      auditReportHash: keccak256(toBytes(auditReportJson)),
    }
    const manifest = {
      schema: "https://dappster.fun/schemas/release-manifest/v1",
      projectId: dapp.id,
      publisher: input.publisher.toLowerCase(),
      network: { name: "Base", chainId: base.id },
      contract: {
        address: contractAddress.toLowerCase(),
        deploymentTransaction: deploymentHash,
        deploymentBlock: receipt.blockNumber.toString(),
        creationCodeHash: hashes.creationCodeHash,
        runtimeCodeHash: hashes.runtimeCodeHash,
        sourceHash: hashes.sourceHash,
        compiler: { language: "Solidity", optimizer: { enabled: true, runs: 200 }, evmVersion: compiled.evmVersion },
      },
      frontend: { cid: dapp.ipfs_hash, cidHash: hashes.frontendCidHash },
      audit: { id: audit.id, createdAt: audit.created_at, reportHash: hashes.auditReportHash, score: auditScore },
      createdAt: new Date().toISOString(),
    }
    const manifestJson = canonicalJson(manifest)
    const manifestHash = keccak256(toBytes(manifestJson))
    const pinned = await deployJsonToIPFS(`dappster-release-${dapp.id}-${manifestHash.slice(2, 10)}`, manifestJson)
    const prepared = (await supabaseRequest<Array<{ id: string }>>({
      path: "dapp_releases",
      method: "POST",
      body: {
        dapp_id: dapp.id,
        owner_id: user.id,
        publisher_address: input.publisher.toLowerCase(),
        contract_address: contractAddress.toLowerCase(),
        contract_chain_id: base.id,
        deployment_tx_hash: deploymentHash,
        deployment_block: receipt.blockNumber.toString(),
        creation_code_hash: hashes.creationCodeHash,
        runtime_code_hash: hashes.runtimeCodeHash,
        source_hash: hashes.sourceHash,
        frontend_cid_hash: hashes.frontendCidHash,
        audit_report_hash: hashes.auditReportHash,
        manifest_hash: manifestHash,
        manifest_cid: pinned.cid,
        manifest_url: pinned.url,
        audit_score: auditScore,
        registry_address: registryAddress.toLowerCase(),
        status: "prepared",
      },
    }))[0]
    if (!prepared?.id) throw new Error("The release proof could not be prepared")

    return NextResponse.json({
      preparedId: prepared.id,
      registryAddress,
      manifestUrl: pinned.url,
      input: { contractAddress, ...hashes, manifestHash, auditScore, deploymentBlock: receipt.blockNumber.toString(), manifestCid: pinned.cid },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare release identity" }, { status: 400 })
  }
}
