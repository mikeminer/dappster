const IPFS_GATEWAYS = [
  { name: "Pinata", url: (cid: string) => `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(cid)}` },
  { name: "IPFS.io", url: (cid: string) => `https://ipfs.io/ipfs/${encodeURIComponent(cid)}` },
  { name: "Dweb", url: (cid: string) => `https://dweb.link/ipfs/${encodeURIComponent(cid)}` },
] as const

const IPFS_GATEWAY_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch

export async function fetchIpfsContent(cid: string, fetcher: FetchLike = fetch) {
  const failures: string[] = []
  try {
    return await Promise.any(IPFS_GATEWAYS.map(async gateway => {
      try {
        const response = await fetcher(gateway.url(cid), {
          cache: "no-store",
          redirect: "follow",
          signal: AbortSignal.timeout(IPFS_GATEWAY_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response
      } catch (error) {
        failures.push(`${gateway.name}: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
    }))
  } catch {
    console.error("[ipfs] all gateways failed", { cid, failures })
    throw new Error("All IPFS gateways are temporarily unavailable")
  }
}
