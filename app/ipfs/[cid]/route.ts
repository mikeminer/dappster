import { NextResponse } from "next/server"
import type { Abi } from "viem"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import { buildEvmRuntimeCompatibilityScript, buildHTMLShell, rewritePreviewDependencies } from "@/lib/frontend-shell"
import { rawCidV1ForText } from "@/lib/ipfs-cid"
import { compileSolidity } from "@/lib/solidity"
import { supabaseRequest } from "@/lib/supabase"
import { hydrateDappSources } from "@/lib/source-storage"
import { buildSolanaRuntimeCompatibilityScript, extractCompiledSolanaIdl, inferLegacySolanaIdl, injectCompiledSolanaIdl, replaceSolanaProgramId, wrapSolanaBabelSource, type SolanaIdl } from "@/lib/solana-frontend"
import { fetchIpfsContent } from "@/lib/ipfs-gateway"

export const dynamic = "force-dynamic"

const CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/
type CompiledRuntime = { abi?: Abi; chainId?: number; solanaCluster?: "devnet" | "mainnet-beta"; solanaIdl?: SolanaIdl }
const runtimeCache = new Map<string, CompiledRuntime>()

type StoredFrontendDapp = {
  name: string
  frontend_code: string | null
  contract_code: string | null
  source_bundle_path: string | null
  source_bundle_hash: string | null
  chain: string
  contract_address: string | null
  contract_chain_id: number | null
  contract_network: string | null
}

async function compiledRuntimeForCid(cid: string) {
  const cached = runtimeCache.get(cid)
  if (cached) return cached
  const rows = await supabaseRequest<Array<{ name: string; contract_code: string | null; frontend_code: string | null; source_bundle_path: string | null; source_bundle_hash: string | null; chain: string; contract_address: string | null; contract_chain_id: number | null; contract_network: string | null }>>({
    path: "dapps",
    query: { ipfs_hash: `eq.${cid}`, select: "name,contract_code,frontend_code,source_bundle_path,source_bundle_hash,chain,contract_address,contract_chain_id,contract_network", limit: "1" },
  })
  const dapp = rows[0] ? await hydrateDappSources(rows[0]) : undefined
  if (!dapp) return {}
  if (dapp.chain === "solana") {
    const runtime: CompiledRuntime = {
      solanaCluster: dapp.contract_network === "mainnet-beta" ? "mainnet-beta" as const : "devnet" as const,
      solanaIdl: dapp.frontend_code && dapp.contract_address
        ? extractCompiledSolanaIdl(dapp.frontend_code, dapp.contract_address)
        : undefined,
    }
    if (runtimeCache.size >= 100) runtimeCache.delete(runtimeCache.keys().next().value as string)
    runtimeCache.set(cid, runtime)
    return runtime
  }
  if (dapp.chain !== "evm") return {}
  const chainId = dapp.contract_chain_id || undefined
  const abi = dapp.contract_code ? compileSolidity(dapp.contract_code, dapp.name, { chainId }).abi : undefined
  const runtime: CompiledRuntime = { abi, chainId }
  if (runtimeCache.size >= 100) runtimeCache.delete(runtimeCache.keys().next().value as string)
  runtimeCache.set(cid, runtime)
  return runtime
}

async function rebuiltFrontendForCid(cid: string) {
  const rows = await supabaseRequest<StoredFrontendDapp[]>({
    path: "dapps",
    query: {
      ipfs_hash: `eq.${cid}`,
      select: "name,frontend_code,contract_code,source_bundle_path,source_bundle_hash,chain,contract_address,contract_chain_id,contract_network",
      limit: "1",
    },
  })
  const stored = rows[0] ? await hydrateDappSources(rows[0]) : undefined
  if (!stored?.frontend_code || !stored.contract_address) return null

  const chainId = stored.chain === "evm" ? stored.contract_chain_id || undefined : undefined
  const abi = stored.chain === "evm" && stored.contract_code
    ? compileSolidity(stored.contract_code, stored.name, { chainId }).abi
    : undefined
  const frontendCode = abi ? injectCompiledAbiIntoFrontend(stored.frontend_code, abi) : stored.frontend_code
  const solanaCluster = stored.chain === "solana"
    ? stored.contract_network === "mainnet-beta" ? "mainnet-beta" as const : "devnet" as const
    : undefined
  const clusterAwareHtml = buildHTMLShell(frontendCode, stored.contract_address, stored.chain, false, abi, chainId, solanaCluster)
  const legacyHtml = solanaCluster
    ? buildHTMLShell(frontendCode, stored.contract_address, stored.chain, false, abi, chainId)
    : clusterAwareHtml
  const html = rawCidV1ForText(clusterAwareHtml) === cid ? clusterAwareHtml : legacyHtml

  if (rawCidV1ForText(html) !== cid) {
    console.error("[ipfs] stored frontend CID mismatch", { cid })
    return null
  }
  return html
}

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid: rawCid } = await params
  const cid = rawCid.trim()
  if (!CID_PATTERN.test(cid)) return NextResponse.json({ error: "Invalid IPFS CID" }, { status: 400 })

  try {
    let upstream: Response
    try {
      upstream = await fetchIpfsContent(cid)
    } catch {
      const rebuiltHtml = await rebuiltFrontendForCid(cid)
      if (!rebuiltHtml) throw new Error("The IPFS artifact and its verified source fallback are unavailable")
      console.warn("[ipfs] serving verified source fallback", { cid })
      upstream = new Response(rebuiltHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } })
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
      let recoveredSolanaIdl: Record<string, unknown> | undefined
      let solanaCompatibility = buildSolanaRuntimeCompatibilityScript()
      const babelPattern = /(<script type="text\/babel"[^>]*>)([\s\S]*?)(<\/script>)/
      let solanaBabelSource: string | undefined
      const embedded = html.match(/window\.__DAPPSTER__=({[\s\S]*?});<\/script>/)?.[1]
      let embeddedRuntime: { abi?: Abi; chain?: string; contractAddress?: string; solanaCluster?: "devnet" | "mainnet-beta" } | undefined
      try {
        embeddedRuntime = embedded ? JSON.parse(embedded) as { abi?: Abi; chain?: string; contractAddress?: string; solanaCluster?: "devnet" | "mainnet-beta" } : undefined
        if (embeddedRuntime?.chain === "solana" && embeddedRuntime.contractAddress) {
          const babel = babelPattern.exec(html)
          if (babel) {
            solanaBabelSource = replaceSolanaProgramId(babel[2], embeddedRuntime.contractAddress)
            recoveredSolanaIdl = extractCompiledSolanaIdl(solanaBabelSource, embeddedRuntime.contractAddress)
              || inferLegacySolanaIdl(solanaBabelSource, embeddedRuntime.contractAddress)
          }
        }
      } catch {
        // A malformed legacy runtime must not prevent the immutable artifact from loading.
      }
      try {
        const compiledRuntime = await compiledRuntimeForCid(cid)
        contractAbi = Array.isArray(embeddedRuntime?.abi) ? embeddedRuntime.abi : compiledRuntime.abi
        evmChainId = compiledRuntime.chainId
        if (embeddedRuntime?.chain === "solana") {
          recoveredSolanaIdl = compiledRuntime.solanaIdl || recoveredSolanaIdl
          solanaCompatibility = buildSolanaRuntimeCompatibilityScript(recoveredSolanaIdl, embeddedRuntime.solanaCluster || compiledRuntime.solanaCluster)
        }
        if (contractAbi) html = injectCompiledAbiIntoFrontend(html, contractAbi)
      } catch {
        // Keep the immutable IPFS artifact available even if legacy ABI recovery fails.
      }
      if (embeddedRuntime?.chain === "solana" && embeddedRuntime.contractAddress && solanaBabelSource) {
        const repairedSource = recoveredSolanaIdl
          ? injectCompiledSolanaIdl(solanaBabelSource, recoveredSolanaIdl, embeddedRuntime.contractAddress)
          : solanaBabelSource
        html = html.replace(babelPattern, `$1${wrapSolanaBabelSource(repairedSource)}$3`)
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
