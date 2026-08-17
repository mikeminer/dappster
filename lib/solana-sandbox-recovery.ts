const CLOSED_SANDBOX_SESSION_PATTERN = /(?:sandbox stream was closed|stream was closed and is not accepting commands|sandbox session (?:is )?(?:closed|stopped|aborted|failed)|session stream (?:is )?closed)/i

export function isRecoverableSolanaSandboxSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return CLOSED_SANDBOX_SESSION_PATTERN.test(message)
}

export async function withSolanaSandboxSessionRecovery<T>(
  operation: () => Promise<T>,
  recycleSession: () => Promise<void>,
) {
  try {
    return await operation()
  } catch (error) {
    if (!isRecoverableSolanaSandboxSessionError(error)) throw error
    console.warn("[solana-sandbox] closed session detected; recycling before one retry")
    try {
      await recycleSession()
    } catch (recycleError) {
      console.warn("[solana-sandbox] session recycle failed; retrying with a fresh handle", {
        error: recycleError instanceof Error ? recycleError.message : String(recycleError),
      })
    }
    return operation()
  }
}
