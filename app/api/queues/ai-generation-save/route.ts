import { createAiGenerationQueueHandler } from "@/lib/ai-generation-worker"

export const runtime = "nodejs"
export const maxDuration = 300
const queueCallback = createAiGenerationQueueHandler("save")

export async function POST(request: Request) {
  return queueCallback(request)
}
