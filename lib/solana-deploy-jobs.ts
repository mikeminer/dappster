import { randomUUID } from "crypto"
import type { SolanaDeploymentCluster } from "./solana-deployment"
import { supabaseRequest } from "./supabase"

export type SolanaDeployJobStatus = "quoted" | "funded" | "deploying" | "confirmed" | "failed"

export type SolanaDeployJob = {
  id: string
  job_key: string
  dapp_id: string
  owner_id: string
  cluster: SolanaDeploymentCluster
  wallet_address: string
  payer_address: string
  source_hash: string
  program_id: string
  byte_length: number
  rent_lamports: number
  network_fee_lamports: number
  required_lamports: number
  funding_memo: string
  funding_signature: string | null
  funded_lamports: number | null
  status: SolanaDeployJobStatus
  worker_token: string | null
  lease_expires_at: string | null
  error: string | null
  attempt_count: number
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

type QueueLock = { jobId: string; workerToken: string; expiresAt: number }
type LocalQueue = {
  jobs: Map<string, SolanaDeployJob>
  jobsByKey: Map<string, string>
  fundingSignatures: Map<string, string>
  locks: Map<SolanaDeploymentCluster, QueueLock>
}

const queueGlobal = globalThis as typeof globalThis & { __dappsterSolanaDeployQueue?: LocalQueue }

function localQueue() {
  if (!queueGlobal.__dappsterSolanaDeployQueue) {
    queueGlobal.__dappsterSolanaDeployQueue = {
      jobs: new Map(),
      jobsByKey: new Map(),
      fundingSignatures: new Map(),
      locks: new Map(),
    }
  }
  return queueGlobal.__dappsterSolanaDeployQueue
}

export type CreateSolanaDeployJobInput = Omit<SolanaDeployJob,
  "funding_signature" | "funded_lamports" | "status" | "worker_token" | "lease_expires_at" | "error" | "attempt_count" | "created_at" | "updated_at" | "confirmed_at"
>

export async function createOrGetSolanaDeployJob(input: CreateSolanaDeployJobInput, isDemo: boolean) {
  if (!isDemo) {
    return supabaseRequest<SolanaDeployJob>({
      path: "rpc/create_or_get_solana_deploy_job",
      method: "POST",
      body: {
        p_id: input.id,
        p_job_key: input.job_key,
        p_dapp_id: input.dapp_id,
        p_owner_id: input.owner_id,
        p_cluster: input.cluster,
        p_wallet_address: input.wallet_address,
        p_payer_address: input.payer_address,
        p_source_hash: input.source_hash,
        p_program_id: input.program_id,
        p_byte_length: input.byte_length,
        p_rent_lamports: input.rent_lamports,
        p_network_fee_lamports: input.network_fee_lamports,
        p_required_lamports: input.required_lamports,
        p_funding_memo: input.funding_memo,
      },
    })
  }

  const queue = localQueue()
  const existingId = queue.jobsByKey.get(input.job_key)
  if (existingId) {
    const existing = queue.jobs.get(existingId)
    if (existing) return existing
  }
  const now = new Date().toISOString()
  const job: SolanaDeployJob = {
    ...input,
    funding_signature: null,
    funded_lamports: null,
    status: "quoted",
    worker_token: null,
    lease_expires_at: null,
    error: null,
    attempt_count: 0,
    created_at: now,
    updated_at: now,
    confirmed_at: null,
  }
  queue.jobs.set(job.id, job)
  queue.jobsByKey.set(job.job_key, job.id)
  return job
}

export async function getSolanaDeployJob(jobId: string, ownerId: string, isDemo: boolean) {
  if (!isDemo) {
    const rows = await supabaseRequest<SolanaDeployJob[]>({
      path: "solana_deploy_jobs",
      query: { id: `eq.${jobId}`, owner_id: `eq.${ownerId}`, select: "*", limit: "1" },
    })
    return rows[0] || null
  }
  const job = localQueue().jobs.get(jobId)
  return job?.owner_id === ownerId ? job : null
}

export async function fundAndClaimSolanaDeployJob(input: {
  jobId: string
  ownerId: string
  fundingSignature: string
  fundedLamports: number
  workerToken?: string
  leaseSeconds?: number
}, isDemo: boolean) {
  const workerToken = input.workerToken || randomUUID()
  const leaseSeconds = input.leaseSeconds || 50 * 60
  if (!isDemo) {
    return supabaseRequest<{ acquired: boolean; job: SolanaDeployJob }>({
      path: "rpc/fund_and_claim_solana_deploy_job",
      method: "POST",
      body: {
        p_job_id: input.jobId,
        p_owner_id: input.ownerId,
        p_funding_signature: input.fundingSignature,
        p_funded_lamports: input.fundedLamports,
        p_worker_token: workerToken,
        p_lease_seconds: leaseSeconds,
      },
    })
  }

  const queue = localQueue()
  const job = queue.jobs.get(input.jobId)
  if (!job || job.owner_id !== input.ownerId) throw new Error("Job di deploy Solana non trovato")
  const signatureJobId = queue.fundingSignatures.get(input.fundingSignature)
  if (signatureJobId && signatureJobId !== job.id) throw new Error("Questa transazione di finanziamento è già associata a un altro deploy")
  if (job.funding_signature && job.funding_signature !== input.fundingSignature) throw new Error("Il job è già associato a un altro finanziamento")
  if (job.status === "confirmed") return { acquired: false, job }

  queue.fundingSignatures.set(input.fundingSignature, job.id)
  job.funding_signature = input.fundingSignature
  job.funded_lamports = input.fundedLamports
  if (job.status !== "deploying") job.status = "funded"
  job.updated_at = new Date().toISOString()

  const olderFundedJob = Array.from(queue.jobs.values()).find(candidate =>
    candidate.id !== job.id && candidate.cluster === job.cluster &&
    (candidate.status === "funded" || candidate.status === "deploying") &&
    candidate.created_at < job.created_at,
  )
  const currentLock = queue.locks.get(job.cluster)
  const locked = currentLock && currentLock.expiresAt > Date.now()
  if (olderFundedJob || locked) return { acquired: false, job }

  const expiresAt = Date.now() + leaseSeconds * 1000
  queue.locks.set(job.cluster, { jobId: job.id, workerToken, expiresAt })
  job.status = "deploying"
  job.attempt_count += 1
  job.worker_token = workerToken
  job.lease_expires_at = new Date(expiresAt).toISOString()
  return { acquired: true, job }
}

export async function claimNextSolanaDeployJob(cluster: SolanaDeploymentCluster, workerToken: string, isDemo: boolean, leaseSeconds = 50 * 60) {
  if (!isDemo) {
    return supabaseRequest<{ acquired: boolean; job: SolanaDeployJob | null }>({
      path: "rpc/claim_next_solana_deploy_job",
      method: "POST",
      body: { p_cluster: cluster, p_worker_token: workerToken, p_lease_seconds: leaseSeconds },
    })
  }
  const queue = localQueue()
  const lock = queue.locks.get(cluster)
  if (lock && lock.expiresAt > Date.now()) return { acquired: false, job: null }
  if (lock) queue.locks.delete(cluster)
  const job = Array.from(queue.jobs.values())
    .filter(candidate => candidate.cluster === cluster && candidate.status === "funded")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]
  if (!job) return { acquired: false, job: null }
  const expiresAt = Date.now() + leaseSeconds * 1000
  queue.locks.set(cluster, { jobId: job.id, workerToken, expiresAt })
  job.status = "deploying"
  job.worker_token = workerToken
  job.lease_expires_at = new Date(expiresAt).toISOString()
  job.attempt_count += 1
  job.updated_at = new Date().toISOString()
  return { acquired: true, job }
}

export async function completeSolanaDeployJob(jobId: string, workerToken: string, programId: string, isDemo: boolean) {
  if (!isDemo) {
    return supabaseRequest<SolanaDeployJob>({
      path: "rpc/complete_solana_deploy_job",
      method: "POST",
      body: { p_job_id: jobId, p_worker_token: workerToken, p_program_id: programId },
    })
  }
  const queue = localQueue()
  const job = queue.jobs.get(jobId)
  if (!job || job.worker_token !== workerToken) throw new Error("Lease del deploy Solana non valida")
  job.status = "confirmed"
  job.program_id = programId
  job.worker_token = null
  job.lease_expires_at = null
  job.error = null
  job.confirmed_at = new Date().toISOString()
  job.updated_at = job.confirmed_at
  const lock = queue.locks.get(job.cluster)
  if (lock?.jobId === job.id && lock.workerToken === workerToken) queue.locks.delete(job.cluster)
  return job
}

export async function replaceSolanaDeployJobProgramId(input: {
  jobId: string
  workerToken: string
  previousProgramId: string
  nextProgramId: string
}, isDemo: boolean) {
  if (!isDemo) {
    await supabaseRequest({
      path: "solana_deploy_jobs",
      method: "PATCH",
      query: {
        id: `eq.${input.jobId}`,
        worker_token: `eq.${input.workerToken}`,
        program_id: `eq.${input.previousProgramId}`,
        status: "eq.deploying",
      },
      body: { program_id: input.nextProgramId, updated_at: new Date().toISOString() },
    })
    const rows = await supabaseRequest<Array<{ program_id: string }>>({
      path: "solana_deploy_jobs",
      query: { id: `eq.${input.jobId}`, worker_token: `eq.${input.workerToken}`, select: "program_id", limit: "1" },
    })
    if (rows[0]?.program_id !== input.nextProgramId) throw new Error("The recovery Program ID could not be attached to the deployment job")
    return
  }

  const job = localQueue().jobs.get(input.jobId)
  if (!job || job.worker_token !== input.workerToken || job.program_id !== input.previousProgramId || job.status !== "deploying") {
    throw new Error("Cannot replace the Program ID without an active deployment lease")
  }
  job.program_id = input.nextProgramId
  job.updated_at = new Date().toISOString()
}

export async function releaseSolanaDeployJob(jobId: string, workerToken: string, error: string, isDemo: boolean) {
  if (!isDemo) {
    return supabaseRequest<SolanaDeployJob>({
      path: "rpc/release_solana_deploy_job",
      method: "POST",
      body: { p_job_id: jobId, p_worker_token: workerToken, p_error: error.slice(0, 4000) },
    })
  }
  const queue = localQueue()
  const job = queue.jobs.get(jobId)
  if (!job) throw new Error("Job di deploy Solana non trovato")
  if (job.worker_token === workerToken) {
    job.status = job.attempt_count >= 3 ? "failed" : "funded"
    job.worker_token = null
    job.lease_expires_at = null
    job.error = error.slice(0, 4000)
    job.updated_at = new Date().toISOString()
    const lock = queue.locks.get(job.cluster)
    if (lock?.jobId === job.id && lock.workerToken === workerToken) queue.locks.delete(job.cluster)
  }
  return job
}
