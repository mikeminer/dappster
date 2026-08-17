import { createHash, randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { hydrateDappSources } from "@/lib/source-storage"
import {
  verifySolanaDeployFunding,
  verifySolanaDeployAuthorization,
} from "@/lib/solana-program-deploy"
import { fundAndClaimSolanaDeployJob, getSolanaDeployJob, recordSolanaDeployFunding, releaseSolanaDeployJob } from "@/lib/solana-deploy-jobs"
import { processClaimedSolanaDeployJob } from "@/lib/solana-deploy-worker"
import { accountHasWallet } from "@/lib/accounts"
import { enqueueSolanaDeployJob } from "@/lib/solana-deploy-queue"

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

const statusSchema = z.object({ jobId: z.string().uuid() })

function jobResponse(job: Awaited<ReturnType<typeof getSolanaDeployJob>>) {
  if (!job) throw new Error("Solana deployment job not found")
  if (job.status === "confirmed") {
    return { kind: "solana" as const, address: job.program_id, cluster: job.cluster, status: "confirmed" as const, jobId: job.id }
  }
  return {
    kind: "solana-job" as const,
    jobId: job.id,
    programId: job.program_id,
    cluster: job.cluster,
    status: job.status,
    attemptCount: job.attempt_count,
    error: job.error,
    updatedAt: job.updated_at,
  }
}

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = statusSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const job = await getSolanaDeployJob(input.jobId, user.id, user.isDemo)
    return NextResponse.json(jobResponse(job))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Solana deployment status unavailable" }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const authorizedWallet = verifySolanaDeployAuthorization(input)
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ name: string; chain: string; contract_code: string | null; contract_address: string | null; source_bundle_path: string | null; source_bundle_hash: string | null }[]>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "name,chain,contract_code,contract_address,source_bundle_path,source_bundle_hash", limit: "1" },
    })
    const dapp = localDapp || (rows[0] ? await hydrateDappSources(rows[0]) : undefined)
    if (!dapp || (localDapp && localDapp.owner_id !== user.id)) throw new Error("dApp non trovata")
    if (dapp.chain !== "solana") throw new Error("Questa dApp non contiene un programma Solana")
    if (!dapp.contract_code) throw new Error("Codice del programma Solana non trovato")

    if (user.isDemo) {
      if (user.id !== `solana:${authorizedWallet.toBase58()}`) throw new Error("Collega lo stesso wallet Solana usato per accedere a Dappster")
    } else {
      if (!await accountHasWallet(user.id, "solana", authorizedWallet.toBase58())) throw new Error("Link this Solana wallet to your Dappster account before deploying")
    }

    const sourceHash = createHash("sha256").update(dapp.contract_code).digest("hex")
    let job = await getSolanaDeployJob(input.jobId, user.id, user.isDemo)
    if (!job || job.dapp_id !== input.dappId || job.cluster !== input.cluster || job.wallet_address !== input.wallet || job.source_hash !== sourceHash) {
      throw new Error("Il preventivo non corrisponde a questo deploy Solana")
    }
    const staleRequestMs = (maxDuration + 15) * 1_000
    const jobUpdatedAt = Date.parse(job.updated_at)
    if (job.status === "deploying" && job.worker_token && Number.isFinite(jobUpdatedAt) && Date.now() - jobUpdatedAt > staleRequestMs) {
      await releaseSolanaDeployJob(
        job.id,
        job.worker_token,
        "Previous deployment request exceeded the Vercel execution limit; funding remains recorded",
        user.isDemo,
      )
      job = await getSolanaDeployJob(input.jobId, user.id, user.isDemo)
      if (!job) throw new Error("Job di deploy Solana non trovato dopo il recupero")
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
    if (user.isDemo) {
      const workerToken = randomUUID()
      const claim = await fundAndClaimSolanaDeployJob({
        jobId: job.id,
        ownerId: user.id,
        fundingSignature: input.fundingSignature,
        fundedLamports: funding.transferredLamports,
        workerToken,
        leaseSeconds: maxDuration + 60,
      }, true)
      if (!claim.acquired) return NextResponse.json(jobResponse(claim.job), { status: claim.job.status === "confirmed" ? 200 : 202 })
      const deployed = await processClaimedSolanaDeployJob(claim.job, workerToken, true)
      return NextResponse.json({ kind: "solana", address: deployed.programId, cluster: input.cluster, status: "confirmed", jobId: job.id })
    }

    job = await recordSolanaDeployFunding({
      jobId: job.id,
      ownerId: user.id,
      fundingSignature: input.fundingSignature,
      fundedLamports: funding.transferredLamports,
    }, false)
    if (job.status === "confirmed") return NextResponse.json(jobResponse(job))
    await enqueueSolanaDeployJob({ jobId: job.id, ownerId: user.id })
    return NextResponse.json(jobResponse(job), { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Deploy Solana non riuscito" }, { status: 400 })
  }
}
