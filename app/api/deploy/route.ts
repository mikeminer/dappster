import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { z } from "zod"
import { CREDIT_COSTS, getCredits, hasActivePro } from "@/lib/credits"
import { optionalCreditBurnProofSchema, verifyAndSpendCreditBurn } from "@/lib/credit-burn"
import { deployFrontendToIPFS } from "@/lib/pinata"
import { getRequestUser } from "@/lib/runtime"
import { localCredits, localGetDapp, localSpend, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { verifyEvmContractDeployment } from "@/lib/contract-deployment"
import { verifySolanaProgramDeployment } from "@/lib/solana-deployment"
import { compileSolidity } from "@/lib/solidity"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import type { Abi } from "viem"
import { hydrateDappSources } from "@/lib/source-storage"
import { getSolanaTesterEntitlement } from "@/lib/pasta-developer-tier"
import { getEvmTesterEntitlement } from "@/lib/pappardelle-tester-tier"

const schema = z.object({
  dappId: z.string().uuid(),
  frontendCode: z.string().max(300000).optional(),
  chain: z.enum(["evm", "solana", "sui", "aptos"]).optional(),
  contractAddress: z.string().min(3).max(128).optional(),
  contractTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  contractChainId: z.number().int().positive().optional(),
  solanaCluster: z.enum(["devnet", "mainnet-beta"]).optional(),
  creditBurn: optionalCreditBurnProofSchema,
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const profile = user.isDemo ? { credits: localCredits(user.id), plan: "free" } : await getCredits(user.id)
    const activePro = hasActivePro(profile)
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ name: string; frontend_code: string | null; contract_code: string | null; source_bundle_path: string | null; source_bundle_hash: string | null; chain: string; contract_address: string | null; contract_chain_id: number | null }[]>({ path: "dapps", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "name,frontend_code,contract_code,source_bundle_path,source_bundle_hash,chain,contract_address,contract_chain_id", limit: "1" } })
    if (!user.isDemo && !rows[0]) throw new Error("dApp not found")
    const storedDapp = rows[0] ? await hydrateDappSources(rows[0]) : undefined
    let frontendCode = user.isDemo ? localDapp?.frontend_code || input.frontendCode : storedDapp?.frontend_code
    const chain = user.isDemo ? localDapp?.chain || input.chain : storedDapp?.chain
    let contractAddress = user.isDemo ? localDapp?.contract_address || input.contractAddress : storedDapp?.contract_address
    const [solanaTester, evmTester] = user.isDemo ? [null, null] : await Promise.all([
      chain === "solana" ? getSolanaTesterEntitlement(user.id) : null,
      chain === "evm" ? getEvmTesterEntitlement(user.id) : null,
    ])
    const testerAccessMode = solanaTester?.eligible ? "solana-tester" : evmTester?.eligible ? "evm-tester" : null
    const freeDeployment = activePro || Boolean(testerAccessMode)
    if (!freeDeployment && profile.credits < CREDIT_COSTS.deploy && !input.creditBurn) throw new Error(`You need ${CREDIT_COSTS.deploy} credits for this action`)
    const evmChainId = chain === "evm"
      ? input.contractChainId || localDapp?.contract_chain_id || storedDapp?.contract_chain_id || undefined
      : undefined
    if (!frontendCode || !chain) throw new Error("Generated frontend not found")
    if (chain === "evm" && !contractAddress && input.contractAddress) {
      if (!input.contractTxHash || !input.contractChainId) throw new Error("The confirmed deployment receipt is required before publishing the frontend")
      await verifyEvmContractDeployment({ address: input.contractAddress, txHash: input.contractTxHash, chainId: input.contractChainId })
      contractAddress = input.contractAddress
      const deployedAt = new Date().toISOString()
      if (user.isDemo && localDapp) {
        localUpdateDapp(input.dappId, {
          contract_address: contractAddress,
          contract_tx_hash: input.contractTxHash,
          contract_chain_id: input.contractChainId,
          contract_deployed_at: deployedAt,
        })
      } else if (!user.isDemo) {
        await supabaseRequest({
          path: "dapps",
          method: "PATCH",
          query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` },
          body: {
            contract_address: contractAddress,
            contract_tx_hash: input.contractTxHash,
            contract_chain_id: input.contractChainId,
            contract_deployed_at: deployedAt,
            updated_at: deployedAt,
          },
        })
      }
    }
    if (chain === "evm" && contractAddress && input.contractAddress && contractAddress.toLowerCase() !== input.contractAddress.toLowerCase()) {
      throw new Error("The confirmed contract does not match the contract saved for this dApp")
    }
    if (!contractAddress) throw new Error(`Deploy and confirm the ${chain === "solana" ? "Solana program" : chain === "sui" ? "Sui package" : chain === "aptos" ? "Aptos package" : "smart contract"} before publishing the frontend`)
    let contractAbi: Abi | undefined
    if (chain === "evm") {
      const contractCode = localDapp?.contract_code || storedDapp?.contract_code
      if (!contractCode) throw new Error("Generated smart contract source not found")
      if (!evmChainId) throw new Error("The EVM deployment network is missing")
      contractAbi = compileSolidity(contractCode, localDapp?.name || storedDapp?.name, { chainId: evmChainId }).abi
      frontendCode = injectCompiledAbiIntoFrontend(frontendCode, contractAbi)
    }
    if (chain === "solana") {
      if (!input.solanaCluster) throw new Error("Seleziona il cluster Solana usato per il deploy")
      await verifySolanaProgramDeployment({ programId: contractAddress, cluster: input.solanaCluster })
    }
    const creditsRemaining = freeDeployment ? profile.credits
      : user.isDemo ? localSpend(user.id, CREDIT_COSTS.deploy)
        : await verifyAndSpendCreditBurn(user.id, CREDIT_COSTS.deploy, "IPFS deployment", input.creditBurn)
    if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { deploy_status: "deploying", frontend_code: frontendCode })
    else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { deploy_status: "deploying", frontend_code: frontendCode } })
    try {
      const deployed = await deployFrontendToIPFS(input.dappId, frontendCode, contractAddress, chain, contractAbi, evmChainId)
      if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { ipfs_hash: deployed.cid, ipfs_url: deployed.url, deploy_status: "live" })
      else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { ipfs_hash: deployed.cid, ipfs_url: deployed.url, deploy_status: "live", updated_at: new Date().toISOString() } })
      revalidateTag("public-dapps")
      return NextResponse.json({ dappId: input.dappId, status: "live", ...deployed, creditsRemaining, mode: user.isDemo ? "local" : "supabase" })
    } catch (error) {
      if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { deploy_status: "failed" })
      else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { deploy_status: "failed" } })
      throw error
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Deployment failed" }, { status: 400 }) }
}
