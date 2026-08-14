const IPFS_GATEWAYS = [
  { name: "Pinata", url: (cid: string) => `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(cid)}` },
  { name: "IPFS.io", url: (cid: string) => `https://ipfs.io/ipfs/${encodeURIComponent(cid)}` },
  { name: "Dweb", url: (cid: string) => `https://dweb.link/ipfs/${encodeURIComponent(cid)}` },
] as const

const IPFS_GATEWAY_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch

function configuredPinataGateway(cid: string) {
  const configured = process.env.PINATA_GATEWAY?.trim()
  if (!configured) return null

  try {
    const url = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
    const basePath = url.pathname.replace(/\/+$/, "").replace(/\/ipfs$/i, "")
    url.pathname = `${basePath}/ipfs/${encodeURIComponent(cid)}`
    url.search = ""
    url.hash = ""
    return { name: "Configured Pinata", url: url.toString() }
  } catch {
    console.error("[ipfs] PINATA_GATEWAY is not a valid gateway URL")
    return null
  }
}

export async function fetchIpfsContent(cid: string, fetcher: FetchLike = fetch) {
  const failures: string[] = []
  const configured = configuredPinataGateway(cid)
  const gateways = [
    ...(configured ? [{ name: configured.name, url: () => configured.url }] : []),
    ...IPFS_GATEWAYS,
  ]
  try {
    return await Promise.any(gateways.map(async gateway => {
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
