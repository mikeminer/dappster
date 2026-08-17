import { NextResponse } from "next/server"
import { z } from "zod"
import { getCredits } from "@/lib/credits"
import { getGenerationJobByDapp } from "@/lib/ai-generation-jobs"
import { enqueueAiGenerationPhase, isAiGenerationWorkerPhase } from "@/lib/ai-generation-queue"
import { getRequestUser } from "@/lib/runtime"

const querySchema = z.object({ dappId: z.string().uuid() })

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo) return NextResponse.json({ status: "completed", phase: "completed", mode: "local" })
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const job = await getGenerationJobByDapp(input.dappId, user.id)
    if (!job) return NextResponse.json({ error: "Generation job not found" }, { status: 404 })

    if (job.status === "queued" && isAiGenerationWorkerPhase(job.phase)) {
      try {
        await enqueueAiGenerationPhase({ jobId: job.id, ownerId: job.owner_id, phase: job.phase })
      } catch (error) {
        console.error("AI generation status queue repair failed", error)
      }
    }

    const profile = await getCredits(user.id)
    return NextResponse.json({
      dappId: job.dapp_id,
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      attemptCount: job.attempt_count,
      phaseAttemptCount: job.phase_attempt_count,
      error: job.error,
      creditsRemaining: job.credits_remaining ?? profile.credits,
      updatedAt: job.updated_at,
      mode: "supabase",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation status is unavailable"
    const status = message.includes("Authentication") || message.includes("session") ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
