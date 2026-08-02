import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { verifyEvmContractDeployment } from "@/lib/contract-deployment"
import { verifySolanaProgramDeployment } from "@/lib/solana-deployment"
import { verifyAptosPackageDeployment, verifySuiPackageDeployment } from "@/lib/move-deployment"

const schema = z.discriminatedUnion("chain", [
  z.object({ chain: z.literal("evm"), dappId: z.string().uuid(), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), chainId: z.number().int().positive() }),
  z.object({ chain: z.literal("solana"), dappId: z.string().uuid(), programId: z.string().min(32).max(44), cluster: z.enum(["devnet", "mainnet-beta"]) }),
  z.object({ chain: z.literal("sui"), dappId: z.string().uuid(), packageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), txDigest: z.string().min(32).max(128), publisher: z.string().regex(/^0x[0-9a-fA-F]{64}$/), network: z.literal("testnet") }),
  z.object({ chain: z.literal("aptos"), dappId: z.string().uuid(), publisher: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), network: z.literal("devnet") }),
])

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    if (input.chain === "evm") await verifyEvmContractDeployment(input)
    else if (input.chain === "solana") await verifySolanaProgramDeployment(input)
    else if (input.chain === "sui") await verifySuiPackageDeployment(input)
    else await verifyAptosPackageDeployment(input)
    const deployedAt = new Date().toISOString()
    const address = input.chain === "evm" ? input.address : input.chain === "solana" ? input.programId : input.chain === "sui" ? input.packageId : input.publisher
    const txHash = input.chain === "evm" ? input.txHash : input.chain === "sui" ? input.txDigest : input.chain === "aptos" ? input.txHash : null
    const network = input.chain === "solana" ? input.cluster : input.chain === "sui" ? "sui-testnet" : input.chain === "aptos" ? "aptos-devnet" : null
    if (user.isDemo) {
      const dapp = localGetDapp(input.dappId)
      if (dapp && dapp.owner_id !== user.id) throw new Error("dApp not found")
      if (dapp) localUpdateDapp(input.dappId, { contract_address: address, contract_tx_hash: txHash, contract_chain_id: input.chain === "evm" ? input.chainId : null, contract_network: network, contract_deployed_at: deployedAt })
    } else {
      const existing = await supabaseRequest<{ id: string }[]>({ path: "dapps", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "id", limit: "1" } })
      if (!existing.length) throw new Error("dApp not found")
      const deploymentRecord = {
        contract_address: address,
        contract_tx_hash: txHash,
        contract_chain_id: input.chain === "evm" ? input.chainId : null,
        contract_deployed_at: deployedAt,
        updated_at: deployedAt,
        ...(network ? { contract_network: network } : {}),
      }
      await supabaseRequest({
        path: "dapps",
        method: "PATCH",
        query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` },
        body: deploymentRecord,
      })
      const persisted = await supabaseRequest<Array<{ contract_address: string | null }>>({
        path: "dapps",
        query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "contract_address", limit: "1" },
      })
      if (persisted[0]?.contract_address?.toLowerCase() !== address.toLowerCase()) {
        throw new Error("The verified deployment could not be persisted. Retry publishing the frontend; Dappster will safely recover it from the on-chain receipt.")
      }
    }
    if (input.chain === "evm") return NextResponse.json({ kind: "evm", address: input.address, txHash: input.txHash, chainId: input.chainId, status: "confirmed" })
    if (input.chain === "solana") return NextResponse.json({ kind: "solana", address: input.programId, cluster: input.cluster, status: "confirmed" })
    if (input.chain === "sui") return NextResponse.json({ kind: "sui", address: input.packageId, txHash: input.txDigest, network: "testnet", status: "confirmed" })
    return NextResponse.json({ kind: "aptos", address: input.publisher, txHash: input.txHash, network: "devnet", status: "confirmed" })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record deployment" }, { status: 400 })
  }
}
