import { NextResponse } from "next/server"
import type { Abi } from "viem"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import { buildEvmRuntimeCompatibilityScript, rewritePreviewDependencies } from "@/lib/frontend-shell"
import { compileSolidity } from "@/lib/solidity"
import { supabaseRequest } from "@/lib/supabase"
import { buildSolanaRuntimeCompatibilityScript, inferLegacySolanaIdl, replaceSolanaProgramId, wrapSolanaBabelSource } from "@/lib/solana-frontend"

export const dynamic = "force-dynamic"

const CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/
const runtimeCache = new Map<string, { abi?: Abi; chainId?: number }>()

async function compiledRuntimeForCid(cid: string) {
  const cached = runtimeCache.get(cid)
  if (cached) return cached
  const rows = await supabaseRequest<Array<{ name: string; contract_code: string | null; chain: string; contract_chain_id: number | null }>>({
    path: "dapps",
    query: { ipfs_hash: `eq.${cid}`, select: "name,contract_code,chain,contract_chain_id", limit: "1" },
  })
  const dapp = rows[0]
  if (!dapp || dapp.chain !== "evm") return {}
  const chainId = dapp.contract_chain_id || undefined
  const abi = dapp.contract_code ? compileSolidity(dapp.contract_code, dapp.name, { chainId }).abi : undefined
  const runtime = { abi, chainId }
  if (runtimeCache.size >= 100) runtimeCache.delete(runtimeCache.keys().next().value as string)
  runtimeCache.set(cid, runtime)
  return runtime
}

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid: rawCid } = await params
  const cid = rawCid.trim()
  if (!CID_PATTERN.test(cid)) return NextResponse.json({ error: "Invalid IPFS CID" }, { status: 400 })

  try {
    const upstream = await fetch(`https://dweb.link/ipfs/${encodeURIComponent(cid)}`, {
      cache: "no-store",
      redirect: "follow",
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: `IPFS content unavailable (${upstream.status})` }, { status: 502 })
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream"
    const headers = new Headers()
    headers.set("Content-Type", contentType)
    headers.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400")
    headers.set("X-Content-Type-Options", "nosniff")
    if (contentType.includes("text/html")) {
      headers.set("Cache-Control", "no-store")
      let html = rewritePreviewDependencies(await upstream.text())
      let contractAbi: Abi | undefined
      let evmChainId: number | undefined
      let solanaCompatibility = buildSolanaRuntimeCompatibilityScript()
      const embedded = html.match(/window\.__DAPPSTER__=({[\s\S]*?});<\/script>/)?.[1]
      let embeddedRuntime: { abi?: Abi; chain?: string; contractAddress?: string } | undefined
      try {
        embeddedRuntime = embedded ? JSON.parse(embedded) as { abi?: Abi; chain?: string; contractAddress?: string } : undefined
        if (embeddedRuntime?.chain === "solana" && embeddedRuntime.contractAddress) {
          const babelPattern = /(<script type="text\/babel"[^>]*>)([\s\S]*?)(<\/script>)/
          const babel = babelPattern.exec(html)
          if (babel) {
            const repairedSource = replaceSolanaProgramId(babel[2], embeddedRuntime.contractAddress)
            const solanaIdl = inferLegacySolanaIdl(repairedSource, embeddedRuntime.contractAddress)
            solanaCompatibility = buildSolanaRuntimeCompatibilityScript(solanaIdl)
            html = html.replace(babelPattern, `$1${wrapSolanaBabelSource(repairedSource)}$3`)
          }
        }
      } catch {
        // A malformed legacy runtime must not prevent the immutable artifact from loading.
      }
      try {
        const compiledRuntime = await compiledRuntimeForCid(cid)
        contractAbi = Array.isArray(embeddedRuntime?.abi) ? embeddedRuntime.abi : compiledRuntime.abi
        evmChainId = compiledRuntime.chainId
        if (contractAbi) html = injectCompiledAbiIntoFrontend(html, contractAbi)
      } catch {
        // Keep the immutable IPFS artifact available even if legacy ABI recovery fails.
      }
      const solanaAsset = embeddedRuntime?.chain === "solana" && !html.includes("/runtime/solana-runtime.js")
        ? '<script src="/runtime/solana-runtime.js"></script>'
        : ""
      const compatibility = `${solanaAsset}<script>${buildEvmRuntimeCompatibilityScript(contractAbi, evmChainId)}${solanaCompatibility}if(window.solanaWeb3)Object.assign(window,window.solanaWeb3);</script>`
      html = html.replace('<script type="text/babel"', `${compatibility}<script type="text/babel"`)
      return new Response(html, { status: 200, headers })
    }
    return new Response(upstream.body, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: "IPFS gateway is temporarily unavailable" }, { status: 502 })
  }
}
