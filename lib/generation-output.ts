const WARNING_TEXT_KEYS = ["message", "warning", "text", "description", "detail"] as const

export function normalizeGenerationWarnings(value: unknown): string[] {
  const warnings: string[] = []

  const append = (candidate: unknown) => {
    if (typeof candidate === "string") {
      const warning = candidate.trim().slice(0, 2_000)
      if (warning) warnings.push(warning)
      return
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(append)
      return
    }

    if (!candidate || typeof candidate !== "object") return

    const record = candidate as Record<string, unknown>
    const preferredValues = WARNING_TEXT_KEYS
      .map(key => record[key])
      .filter(item => item !== undefined)

    if (preferredValues.length) {
      preferredValues.forEach(append)
      return
    }

    Object.values(record).forEach(item => {
      if (typeof item === "string" || Array.isArray(item)) append(item)
    })
  }

  append(value)
  return Array.from(new Set(warnings)).slice(0, 50)
}
