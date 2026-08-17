import { send } from "@vercel/queue"
import { z } from "zod"

export const SOLANA_DEPLOY_QUEUE_TOPIC = "solana-deploy-jobs"

export const solanaDeployQueueMessageSchema = z.object({
  jobId: z.string().uuid(),
  ownerId: z.string().uuid(),
})

export type SolanaDeployQueueMessage = z.infer<typeof solanaDeployQueueMessageSchema>

export async function enqueueSolanaDeployJob(message: SolanaDeployQueueMessage) {
  return send(SOLANA_DEPLOY_QUEUE_TOPIC, message, {
    retentionSeconds: 24 * 60 * 60,
  })
}
