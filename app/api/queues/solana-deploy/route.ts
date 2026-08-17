import { randomUUID } from "crypto"
import { handleCallback } from "@vercel/queue"
import { failSolanaDeployJob, fundAndClaimSolanaDeployJob, getSolanaDeployJob, recordSolanaDeployFunding } from "@/lib/solana-deploy-jobs"
import { processClaimedSolanaDeployJob } from "@/lib/solana-deploy-worker"
import { solanaDeployQueueMessageSchema } from "@/lib/solana-deploy-queue"

export const runtime = "nodejs"
export const maxDuration = 300

const MAX_AUTOMATIC_ATTEMPTS = 10
const WORKER_LEASE_SECONDS = maxDuration + 60

function retryableDeployError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:429|too many requests|timed? out|timeout|temporar|network|fetch failed|socket|ECONN|blockhash|not confirmed|gateway|sandbox unavailable|worker lease expired|queue is busy|active cluster job)/i.test(message)
}

const queueCallback = handleCallback(
  async payload => {
    const message = solanaDeployQueueMessageSchema.parse(payload)
    let job = await getSolanaDeployJob(message.jobId, message.ownerId, false)
    if (!job || job.status === "confirmed") return
    if (!job.funding_signature || !job.funded_lamports) {
      await failSolanaDeployJob(job.id, job.owner_id, "The queued Solana deployment has no verified funding", false)
      return
    }
    const fundingSignature = job.funding_signature
    const fundedLamports = job.funded_lamports
    if (job.attempt_count >= MAX_AUTOMATIC_ATTEMPTS) {
      await failSolanaDeployJob(job.id, job.owner_id, job.error || "Solana deployment exceeded the automatic retry limit", false)
      return
    }

    if (job.status === "failed") {
      job = await recordSolanaDeployFunding({
        jobId: job.id,
        ownerId: job.owner_id,
        fundingSignature,
        fundedLamports,
      }, false)
    }

    const workerToken = randomUUID()
    let claim: Awaited<ReturnType<typeof fundAndClaimSolanaDeployJob>>
    try {
      claim = await fundAndClaimSolanaDeployJob({
        jobId: job.id,
        ownerId: job.owner_id,
        fundingSignature,
        fundedLamports,
        workerToken,
        leaseSeconds: WORKER_LEASE_SECONDS,
      }, false)
    } catch (error) {
      if (retryableDeployError(error)) throw error
      await failSolanaDeployJob(job.id, job.owner_id, error instanceof Error ? error.message : "Solana deployment claim failed", false)
      return
    }
    if (!claim.acquired) throw new Error("Solana deployment queue is busy; retry after the active cluster job")

    try {
      await processClaimedSolanaDeployJob(claim.job, workerToken, false)
    } catch (error) {
      if (retryableDeployError(error)) {
        // processClaimedSolanaDeployJob releases its database lease before
        // returning. Keep the status funded while the queue backs off so the
        // browser does not mistake an automatic retry for a terminal failure.
        await recordSolanaDeployFunding({
          jobId: job.id,
          ownerId: job.owner_id,
          fundingSignature,
          fundedLamports,
        }, false)
        throw error
      }
      // The worker already persisted the permanent failure. Acknowledging here
      // prevents expensive retries for invalid source or insufficient funding.
      await failSolanaDeployJob(job.id, job.owner_id, error instanceof Error ? error.message : "Solana deployment failed", false)
    }
  },
  {
    visibilityTimeoutSeconds: WORKER_LEASE_SECONDS,
    retry: (error, metadata) => {
      if (metadata.deliveryCount >= MAX_AUTOMATIC_ATTEMPTS || !retryableDeployError(error)) return { acknowledge: true }
      return { afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount - 1, 5)) }
    },
  },
)

export async function POST(request: Request) {
  return queueCallback(request)
}
