import { NextRequest, NextResponse } from "next/server"
import { enforceRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 })
  }

  const clientAddress = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
  try {
    await enforceRateLimit(`client-error:${clientAddress}`, 20, 60_000)
  } catch {
    return NextResponse.json({ error: "Rate limit reached" }, { status: 429 })
  }

  const input = await request.json().catch(() => ({})) as Record<string, unknown>
  const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : ""
  console.error("[client-error]", {
    message: text(input.message, 600),
    stack: text(input.stack, 4_000),
    digest: text(input.digest, 200),
    path: text(input.path, 500),
    userAgent: text(request.headers.get("user-agent"), 500),
  })
  return new NextResponse(null, { status: 204 })
}
