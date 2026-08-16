const IPFS_GATEWAYS = [
  { name: "Pinata", url: (cid: string) => `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(cid)}` },
  { name: "IPFS.io", url: (cid: string) => `https://ipfs.io/ipfs/${encodeURIComponent(cid)}` },
  { name: "Dweb", url: (cid: string) => `https://dweb.link/ipfs/${encodeURIComponent(cid)}` },
  { name: "NFT.Storage", url: (cid: string) => `https://nftstorage.link/ipfs/${encodeURIComponent(cid)}` },
] as const

const IPFS_GATEWAY_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type IpfsGateway = { name: string; url: (cid: string) => string }

function configuredPinataGateway(cid: string) {
  const configured = process.env.PINATA_GATEWAY?.trim()
  if (!configured) return []

  try {
    const url = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
    const basePath = url.pathname.replace(/\/+$/, "").replace(/\/ipfs$/i, "")
    return ["files", "ipfs"].map(path => {
      const candidate = new URL(url)
      candidate.pathname = `${basePath}/${path}/${encodeURIComponent(cid)}`
      candidate.search = ""
      candidate.hash = ""
      return { name: `Configured Pinata (${path})`, url: () => candidate.toString() }
    })
  } catch {
    console.error("[ipfs] PINATA_GATEWAY is not a valid gateway URL")
    return []
  }
}

async function firstGatewayResponse(gateways: IpfsGateway[], cid: string, fetcher: FetchLike, failures: string[]) {
  return Promise.any(gateways.map(async gateway => {
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
}

async function discoverPinataGateways(fetcher: FetchLike, failures: string[]): Promise<IpfsGateway[]> {
  const jwt = process.env.PINATA_JWT?.trim()
  if (!jwt) return []

  try {
    const response = await fetcher("https://api.pinata.cloud/v3/gateways", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(IPFS_GATEWAY_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json() as { data?: { rows?: Array<{ domain?: string }> } }
    return Array.from(new Set((payload.data?.rows || []).flatMap(row => {
      const domain = row.domain?.trim()
      if (!domain) return []
      return [domain.includes(".") ? domain : `${domain}.mypinata.cloud`]
    }))).flatMap(domain => ([
      {
        name: `Pinata dedicated files (${domain})`,
        url: (cid: string) => `https://${domain}/files/${encodeURIComponent(cid)}`,
      },
      {
        name: `Pinata dedicated IPFS (${domain})`,
        url: (cid: string) => `https://${domain}/ipfs/${encodeURIComponent(cid)}`,
      },
    ]))
  } catch (error) {
    failures.push(`Pinata gateway discovery: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

export async function fetchIpfsContent(cid: string, fetcher: FetchLike = fetch) {
  const failures: string[] = []
  const configured = configuredPinataGateway(cid)
  const gateways = [
    ...configured,
    ...IPFS_GATEWAYS,
  ]
  try {
    return await firstGatewayResponse(gateways, cid, fetcher, failures)
  } catch {
    const dedicatedGateways = await discoverPinataGateways(fetcher, failures)
    if (dedicatedGateways.length > 0) {
      try {
        return await firstGatewayResponse(dedicatedGateways, cid, fetcher, failures)
      } catch {
        // Continue to the structured error below.
      }
    }
  }
  console.error("[ipfs] all gateways failed", { cid, failures })
  throw new Error("All IPFS gateways are temporarily unavailable")
}
