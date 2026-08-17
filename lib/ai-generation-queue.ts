import { send } from "@vercel/queue"
import { z } from "zod"
import type { AiGenerationPhase } from "./ai-generation-jobs"

export const AI_GENERATION_QUEUE_TOPICS = {
  generation: "ai-generation-generate",
  review: "ai-generation-review",
  repair: "ai-generation-repair",
  save: "ai-generation-save",
} as const

export type AiGenerationWorkerPhase = keyof typeof AI_GENERATION_QUEUE_TOPICS

export const aiGenerationQueueMessageSchema = z.object({
  jobId: z.string().uuid(),
  ownerId: z.string().uuid(),
  phase: z.enum(["generation", "review", "repair", "save"]),
})

export type AiGenerationQueueMessage = z.infer<typeof aiGenerationQueueMessageSchema>

export function isAiGenerationWorkerPhase(phase: AiGenerationPhase): phase is AiGenerationWorkerPhase {
  return phase in AI_GENERATION_QUEUE_TOPICS
}

export async function enqueueAiGenerationPhase(message: AiGenerationQueueMessage) {
  return send(AI_GENERATION_QUEUE_TOPICS[message.phase], message, {
    idempotencyKey: `${message.jobId}:${message.phase}`,
    retentionSeconds: 24 * 60 * 60,
  })
}
