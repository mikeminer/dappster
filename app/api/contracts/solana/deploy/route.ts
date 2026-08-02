import { createHash, randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import {
  verifySolanaDeployFunding,
  verifySolanaDeployAuthorization,
} from "@/lib/solana-program-deploy"
import { claimNextSolanaDeployJob, fundAndClaimSolanaDeployJob, getSolanaDeployJob } from "@/lib/solana-deploy-jobs"
import { processClaimedSolanaDeployJob } from "@/lib/solana-deploy-worker"
import { accountHasWallet } from "@/lib/accounts"

export const runtime = "nodejs"
export const maxDuration = 300

const schema = z.object({
  dappId: z.string().uuid(),
  jobId: z.string().uuid(),
  cluster: z.enum(["devnet", "mainnet-beta"]),
  wallet: z.string().min(32).max(44),
  signature: z.string().min(64).max(128),
  fundingSignature: z.string().min(64).max(128),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const authorizedWallet = verifySolanaDeployAuthorization(input)
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ name: string; chain: string; contract_code: string; contract_address: string | null }[]>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "name,chain,contract_code,contract_address", limit: "1" },
    })
    const dapp = localDapp || rows[0]
    if (!dapp || (localDapp && localDapp.owner_id !== user.id)) throw new Error("dApp non trovata")
    if (dapp.chain !== "solana") throw new Error("Questa dApp non contiene un programma Solana")
    if (!dapp.contract_code) throw new Error("Codice del programma Solana non trovato")

    if (user.isDemo) {
      if (user.id !== `solana:${authorizedWallet.toBase58()}`) throw new Error("Collega lo stesso wallet Solana usato per accedere a Dappster")
    } else {
      if (!await accountHasWallet(user.id, "solana", authorizedWallet.toBase58())) throw new Error("Link this Solana wallet to your Dappster account before deploying")
    }

    const sourceHash = createHash("sha256").update(dapp.contract_code).digest("hex")
    const job = await getSolanaDeployJob(input.jobId, user.id, user.isDemo)
    if (!job || job.dapp_id !== input.dappId || job.cluster !== input.cluster || job.wallet_address !== input.wallet || job.source_hash !== sourceHash) {
      throw new Error("Il preventivo non corrisponde a questo deploy Solana")
    }
    if (dapp.contract_address) {
      if (dapp.contract_address !== job.program_id) throw new Error("Il programma Solana è già stato distribuito con un altro Program ID")
      return NextResponse.json({ kind: "solana", address: job.program_id, cluster: job.cluster, status: "confirmed", jobId: job.id })
    }
    if (job.status === "confirmed") {
      return NextResponse.json({ kind: "solana", address: job.program_id, cluster: job.cluster, status: "confirmed", jobId: job.id })
    }
    const funding = await verifySolanaDeployFunding({
      cluster: input.cluster,
      wallet: input.wallet,
      signature: input.fundingSignature,
      requiredLamports: job.required_lamports,
      expectedMemo: job.funding_memo,
    })
    const workerToken = randomUUID()
    const claim = await fundAndClaimSolanaDeployJob({
      jobId: job.id,
      ownerId: user.id,
      fundingSignature: input.fundingSignature,
      fundedLamports: funding.transferredLamports,
      workerToken,
      leaseSeconds: 50 * 60,
    }, user.isDemo)
    if (claim.job.status === "confirmed") {
      return NextResponse.json({ kind: "solana", address: claim.job.program_id, cluster: claim.job.cluster, status: "confirmed", jobId: claim.job.id })
    }
    if (!claim.acquired) {
      const recoveryToken = randomUUID()
      const next = await claimNextSolanaDeployJob(input.cluster, recoveryToken, user.isDemo)
      if (next.acquired && next.job) await processClaimedSolanaDeployJob(next.job, recoveryToken, user.isDemo).catch(() => undefined)
      return NextResponse.json({ kind: "solana-job", jobId: job.id, programId: job.program_id, cluster: job.cluster, status: "queued" }, { status: 202 })
    }

    const deployed = await processClaimedSolanaDeployJob(claim.job, workerToken, user.isDemo)
    return NextResponse.json({
      kind: "solana",
      address: deployed.programId,
      cluster: input.cluster,
      status: "confirmed",
      jobId: job.id,
      byteLength: deployed.byteLength,
      fundedBy: authorizedWallet.toBase58(),
      relayedBy: deployed.payer,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Deploy Solana non riuscito" }, { status: 400 })
  }
}
