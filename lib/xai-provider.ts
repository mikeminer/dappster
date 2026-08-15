export type XAIWorkload = "generation" | "repair" | "audit"

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }> }

const TRANSIENT_STATUSES = new Set([408, 409, 425, 429])

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function xaiModelFor(workload: XAIWorkload) {
  if (workload === "generation") return process.env.XAI_GENERATION_MODEL || "grok-4.20-0309-non-reasoning"
  if (workload === "repair") return process.env.XAI_REPAIR_MODEL || process.env.XAI_MODEL || "grok-4.5"
  return process.env.XAI_AUDIT_MODEL || process.env.XAI_MODEL || "grok-4.5"
}

function fallbackModelFor(workload: XAIWorkload, primaryModel: string) {
  const workloadFallback = workload === "generation"
    ? process.env.XAI_GENERATION_FALLBACK_MODEL
    : workload === "repair"
      ? process.env.XAI_REPAIR_FALLBACK_MODEL
      : process.env.XAI_AUDIT_FALLBACK_MODEL
  const fallback = workloadFallback || process.env.XAI_FALLBACK_MODEL || (workload === "generation" ? process.env.XAI_MODEL : undefined) || "grok-4.3"
  return fallback === primaryModel ? undefined : fallback
}

function isTransientStatus(status: number) {
  return TRANSIENT_STATUSES.has(status) || status >= 500
}

function retryDelay(response: Response | undefined, attempt: number) {
  const configuredBase = positiveInteger(process.env.XAI_RETRY_BASE_DELAY_MS, 750)
  const retryAfter = Number.parseFloat(response?.headers.get("retry-after") || "")
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 5_000)
  return Math.min(configuredBase * 2 ** attempt, 5_000)
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  if (milliseconds <= 0) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort)
    const finish = () => {
      cleanup()
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error("AI generation was cancelled"))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener("abort", abort, { once: true })
  })
}

async function fetchWithTimeout(url: string, init: RequestInit, parentSignal?: AbortSignal) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error("xAI request timed out")), positiveInteger(process.env.XAI_REQUEST_TIMEOUT_MS, 240_000))
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener("abort", abortFromParent)
  }
}

async function providerErrorMetadata(response: Response) {
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || undefined
  let providerCode: string | undefined
  try {
    const body = await response.json() as { error?: { code?: unknown; type?: unknown } }
    const rawCode = body.error?.code || body.error?.type
    if (typeof rawCode === "string" || typeof rawCode === "number") providerCode = String(rawCode).slice(0, 80)
  } catch {
    // The provider may return an HTML or empty 5xx response. Never log its body.
  }
  return { requestId, providerCode }
}

export async function callXAI(system: string, prompt: string, workload: XAIWorkload = "generation", signal?: AbortSignal) {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not configured")

  const primaryModel = xaiModelFor(workload)
  const fallbackModel = fallbackModelFor(workload, primaryModel)
  const attemptModels = fallbackModel ? [primaryModel, primaryModel, fallbackModel] : [primaryModel, primaryModel]
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("AI generation was cancelled")
    const model = attemptModels[attempt]
    let response: Response | undefined
    try {
      response = await fetchWithTimeout("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: workload === "generation" ? 0.2 : 0,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        }),
      }, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn("[xai] request failed before response", {
        workload,
        model,
        attempt: attempt + 1,
        error: error instanceof Error ? error.name : "UnknownError",
      })
      if (attempt + 1 >= attemptModels.length) throw new Error("Generation provider is temporarily unavailable. Please try again.")
      await waitForRetry(retryDelay(undefined, attempt), signal)
      continue
    }

    if (response.ok) {
      const completion = await response.json() as ChatCompletion
      const content = completion.choices?.[0]?.message?.content
      if (typeof content === "string" && content.trim()) return content
      console.warn("[xai] provider returned an empty completion", { workload, model, attempt: attempt + 1 })
      if (attempt + 1 >= attemptModels.length) throw new Error("AI provider returned an empty response")
      await waitForRetry(retryDelay(response, attempt), signal)
      continue
    }

    lastStatus = response.status
    const metadata = await providerErrorMetadata(response)
    console.warn("[xai] provider rejected request", {
      workload,
      model,
      attempt: attempt + 1,
      status: response.status,
      ...metadata,
    })
    if (!isTransientStatus(response.status) || attempt + 1 >= attemptModels.length) break
    await waitForRetry(retryDelay(response, attempt), signal)
  }

  throw new Error(`Generation provider failed${lastStatus ? ` (${lastStatus})` : ""}. Please try again.`)
}
