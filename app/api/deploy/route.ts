import { NextResponse } from "next/server"
import { z } from "zod"
import { CREDIT_COSTS, assertCredits, hasActivePro } from "@/lib/credits"
import { creditBurnProofSchema, verifyAndSpendCreditBurn } from "@/lib/credit-burn"
import { deployFrontendToIPFS } from "@/lib/pinata"
import { getRequestUser } from "@/lib/runtime"
import { localCredits, localGetDapp, localSpend, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { verifyEvmContractDeployment } from "@/lib/contract-deployment"
import { verifySolanaProgramDeployment } from "@/lib/solana-deployment"
import { compileSolidity } from "@/lib/solidity"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import type { Abi } from "viem"

const schema = z.object({
  dappId: z.string().uuid(),
  frontendCode: z.string().max(300000).optional(),
  chain: z.enum(["evm", "solana", "sui", "aptos"]).optional(),
  contractAddress: z.string().min(3).max(128).optional(),
  contractTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  contractChainId: z.number().int().positive().optional(),
  solanaCluster: z.enum(["devnet", "mainnet-beta"]).optional(),
  creditBurn: creditBurnProofSchema.optional(),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const profile = user.isDemo ? { credits: localCredits(user.id), plan: "free" } : await assertCredits(user.id, CREDIT_COSTS.deploy)
    const activePro = hasActivePro(profile)
    if (!activePro && profile.credits < CREDIT_COSTS.deploy) throw new Error(`You need ${CREDIT_COSTS.deploy} credits for this action`)
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ name: string; frontend_code: string; contract_code: string; chain: string; contract_address: string | null; contract_chain_id: number | null }[]>({ path: "dapps", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "name,frontend_code,contract_code,chain,contract_address,contract_chain_id", limit: "1" } })
    if (!user.isDemo && !rows[0]) throw new Error("dApp not found")
    let frontendCode = user.isDemo ? localDapp?.frontend_code || input.frontendCode : rows[0].frontend_code
    const chain = user.isDemo ? localDapp?.chain || input.chain : rows[0].chain
    let contractAddress = user.isDemo ? localDapp?.contract_address || input.contractAddress : rows[0].contract_address
    const evmChainId = chain === "evm"
      ? input.contractChainId || localDapp?.contract_chain_id || rows[0]?.contract_chain_id || undefined
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
      const contractCode = localDapp?.contract_code || rows[0]?.contract_code
      if (!contractCode) throw new Error("Generated smart contract source not found")
      if (!evmChainId) throw new Error("The EVM deployment network is missing")
      contractAbi = compileSolidity(contractCode, localDapp?.name || rows[0]?.name, { chainId: evmChainId }).abi
      frontendCode = injectCompiledAbiIntoFrontend(frontendCode, contractAbi)
    }
    if (chain === "solana") {
      if (!input.solanaCluster) throw new Error("Seleziona il cluster Solana usato per il deploy")
      await verifySolanaProgramDeployment({ programId: contractAddress, cluster: input.solanaCluster })
    }
    const creditsRemaining = activePro ? profile.credits
      : user.isDemo ? localSpend(user.id, CREDIT_COSTS.deploy)
        : await verifyAndSpendCreditBurn(user.id, CREDIT_COSTS.deploy, "IPFS deployment", input.creditBurn)
    if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { deploy_status: "deploying", frontend_code: frontendCode })
    else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { deploy_status: "deploying", frontend_code: frontendCode } })
    try {
      const deployed = await deployFrontendToIPFS(input.dappId, frontendCode, contractAddress, chain, contractAbi, evmChainId)
      if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { ipfs_hash: deployed.cid, ipfs_url: deployed.url, deploy_status: "live" })
      else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { ipfs_hash: deployed.cid, ipfs_url: deployed.url, deploy_status: "live", updated_at: new Date().toISOString() } })
      return NextResponse.json({ dappId: input.dappId, status: "live", ...deployed, creditsRemaining, mode: user.isDemo ? "local" : "supabase" })
    } catch (error) {
      if (user.isDemo && localDapp) localUpdateDapp(input.dappId, { deploy_status: "failed" })
      else if (!user.isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { deploy_status: "failed" } })
      throw error
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Deployment failed" }, { status: 400 }) }
}
