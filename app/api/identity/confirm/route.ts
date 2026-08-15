import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient, decodeEventLog, isAddress, type Hex } from "viem"
import { base, getEvmTransport } from "@/lib/evm-chains"
import { DAPPSTER_IDENTITY_REGISTRY_ABI, getIdentityRegistryAddress } from "@/lib/identity-registry"
import { getRequestUser } from "@/lib/runtime"
import { supabaseRequest } from "@/lib/supabase"

const requestSchema = z.object({
  preparedId: z.string().uuid(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
})

type PreparedRow = {
  id: string
  owner_id: string
  publisher_address: string
  contract_address: string
  deployment_block: number | string
  creation_code_hash: string
  runtime_code_hash: string
  source_hash: string
  frontend_cid_hash: string
  audit_report_hash: string
  manifest_hash: string
  manifest_cid: string
  audit_score: number
  status: string
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = requestSchema.parse(await request.json())
    const registryAddress = getIdentityRegistryAddress()
    if (!registryAddress || !isAddress(registryAddress)) throw new Error("The Dappster identity registry is not configured")
    const prepared = (await supabaseRequest<PreparedRow[]>({
      path: "dapp_releases",
      query: { id: `eq.${input.preparedId}`, owner_id: `eq.${user.id}`, select: "id,owner_id,publisher_address,contract_address,deployment_block,creation_code_hash,runtime_code_hash,source_hash,frontend_cid_hash,audit_report_hash,manifest_hash,manifest_cid,audit_score,status", limit: "1" },
    }))[0]
    if (!prepared) throw new Error("Prepared release not found")
    if (prepared.status === "confirmed") return NextResponse.json({ ok: true, status: "confirmed" })

    const client = createPublicClient({ chain: base, transport: getEvmTransport(base) })
    const receipt = await client.getTransactionReceipt({ hash: input.txHash as Hex })
    if (receipt.status !== "success" || !receipt.to || !same(receipt.to, registryAddress) || !same(receipt.from, prepared.publisher_address)) {
      throw new Error("The Base registry transaction could not be verified")
    }
    const event = receipt.logs
      .filter(log => same(log.address, registryAddress))
      .map(log => {
        try { return decodeEventLog({ abi: DAPPSTER_IDENTITY_REGISTRY_ABI, eventName: "ReleaseRegistered", data: log.data, topics: log.topics }) }
        catch { return null }
      })
      .find(decoded => decoded
        && same(decoded.args.publisher, prepared.publisher_address)
        && same(decoded.args.contractAddress, prepared.contract_address)
        && same(decoded.args.manifestHash, prepared.manifest_hash)
        && same(decoded.args.runtimeCodeHash, prepared.runtime_code_hash)
        && same(decoded.args.frontendCidHash, prepared.frontend_cid_hash)
        && same(decoded.args.auditReportHash, prepared.audit_report_hash)
        && decoded.args.manifestCid === prepared.manifest_cid)
    if (!event) throw new Error("The registry event does not match the prepared Dappster manifest")

    const stored = await client.readContract({
      address: registryAddress,
      abi: DAPPSTER_IDENTITY_REGISTRY_ABI,
      functionName: "getRelease",
      args: [event.args.dappId, event.args.version],
      blockNumber: receipt.blockNumber,
    })
    if (
      !same(stored.publisher, prepared.publisher_address)
      || !same(stored.contractAddress, prepared.contract_address)
      || !same(stored.creationCodeHash, prepared.creation_code_hash)
      || !same(stored.runtimeCodeHash, prepared.runtime_code_hash)
      || !same(stored.sourceHash, prepared.source_hash)
      || !same(stored.frontendCidHash, prepared.frontend_cid_hash)
      || !same(stored.auditReportHash, prepared.audit_report_hash)
      || !same(stored.manifestHash, prepared.manifest_hash)
      || stored.deploymentBlock !== BigInt(prepared.deployment_block)
      || stored.auditScore !== prepared.audit_score
      || stored.manifestCid !== prepared.manifest_cid
    ) throw new Error("The stored Base release does not match the prepared Dappster proof")

    const confirmedAt = new Date().toISOString()
    await supabaseRequest({
      path: "dapp_releases",
      method: "PATCH",
      query: { id: `eq.${prepared.id}`, owner_id: `eq.${user.id}` },
      body: {
        registry_tx_hash: input.txHash,
        release_id: event.args.releaseId,
        registry_dapp_id: event.args.dappId,
        release_version: event.args.version.toString(),
        registered_block: receipt.blockNumber.toString(),
        status: "confirmed",
        confirmed_at: confirmedAt,
      },
    })
    return NextResponse.json({ ok: true, status: "confirmed", releaseId: event.args.releaseId, version: event.args.version.toString(), txHash: input.txHash })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm release identity" }, { status: 400 })
  }
}
