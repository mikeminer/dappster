import { NextRequest, NextResponse } from "next/server"
import { enforceRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type SolanaCluster = "devnet" | "mainnet-beta"
type JsonRpcId = string | number | null
type JsonRpcCall = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: unknown }

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_BATCH_SIZE = 20
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlock",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getEpochSchedule",
  "getFeeForMessage",
  "getFirstAvailableBlock",
  "getGenesisHash",
  "getIdentity",
  "getInflationGovernor",
  "getInflationRate",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPerformanceSamples",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getSupply",
  "getTokenAccountBalance",
  "getTokenAccountsByDelegate",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getTransactionCount",
  "getVersion",
  "isBlockhashValid",
  "minimumLedgerSlot",
  "sendTransaction",
  "simulateTransaction",
])

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
} as const

function clusterFromRequest(request: NextRequest): SolanaCluster {
  return request.nextUrl.searchParams.get("cluster") === "devnet" ? "devnet" : "mainnet-beta"
}

function rpcEndpoints(cluster: SolanaCluster) {
  const configured = cluster === "devnet"
    ? [process.env.SOLANA_DEVNET_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL]
    : [process.env.SOLANA_MAINNET_RPC_URL, process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC_URL]
  const publicFallbacks = cluster === "devnet"
    ? ["https://api.devnet.solana.com"]
    : ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"]
  return Array.from(new Set([...configured, ...publicFallbacks].filter((value): value is string => Boolean(value))))
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

function responsePayload(calls: JsonRpcCall[], code: number, message: string, batch: boolean) {
  const errors = calls.map(call => rpcError(call.id, code, message))
  return batch ? errors : errors[0]
}

function retryableRpcFailure(status: number, body: string) {
  if ([401, 403, 408, 425, 429].includes(status) || status >= 500) return true
  try {
    const payload = JSON.parse(body) as { error?: { code?: number } } | Array<{ error?: { code?: number } }>
    const responses = Array.isArray(payload) ? payload : [payload]
    return responses.some(item => item?.error?.code === 403 || item?.error?.code === 429)
  } catch {
    return !body.trim().startsWith("{") && !body.trim().startsWith("[")
  }
}

function clientAddress(request: NextRequest) {
  return request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  const cluster = clusterFromRequest(request)
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0)
    if (declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(rpcError(null, -32600, "Solana RPC request is too large"), { status: 413, headers: CORS_HEADERS })
    }
    await enforceRateLimit(`public-solana-rpc:${cluster}:${clientAddress(request)}`, 600, 60_000)
    const body = await request.text()
    if (!body || Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json(rpcError(null, -32600, "Solana RPC request is empty or too large"), { status: 413, headers: CORS_HEADERS })
    }
    const parsed = JSON.parse(body) as JsonRpcCall | JsonRpcCall[]
    const batch = Array.isArray(parsed)
    const calls = batch ? parsed : [parsed]
    if (!calls.length || calls.length > MAX_BATCH_SIZE || calls.some(call => !call || call.jsonrpc !== "2.0" || typeof call.method !== "string")) {
      return NextResponse.json(responsePayload(calls.length ? calls : [{ id: null }], -32600, "Invalid JSON-RPC request", batch), { status: 400, headers: CORS_HEADERS })
    }
    const blocked = calls.find(call => !ALLOWED_METHODS.has(call.method!))
    if (blocked) {
      return NextResponse.json(responsePayload(calls, -32601, `Solana RPC method is not allowed: ${blocked.method}`, batch), { status: 403, headers: CORS_HEADERS })
    }

    for (const endpoint of rpcEndpoints(cluster)) {
      try {
        const upstream = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        })
        const upstreamBody = await upstream.text()
        if (retryableRpcFailure(upstream.status, upstreamBody)) continue
        return new NextResponse(upstreamBody, {
          status: upstream.ok ? 200 : upstream.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      } catch {
        // Try the next configured provider without exposing private endpoints.
      }
    }
    return NextResponse.json(
      responsePayload(calls, -32005, `Solana ${cluster === "devnet" ? "Devnet" : "Mainnet"} RPC is temporarily unavailable`, batch),
      { status: 503, headers: CORS_HEADERS },
    )
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "Invalid JSON-RPC body"
      : error instanceof Error && error.message.includes("Rate limit reached")
        ? error.message
        : "Solana RPC proxy request failed"
    const status = message.includes("Rate limit reached") ? 429 : 400
    return NextResponse.json(rpcError(null, status === 429 ? -32005 : -32700, message), { status, headers: CORS_HEADERS })
  }
}
