// Generated dApps run on a dedicated, stable origin so injected wallet providers
// can work without exposing the authenticated dappster.fun origin to generated code.
export const PUBLIC_IPFS_GATEWAY = "https://apps.dappster.fun/ipfs"

export function ipfsGatewayUrl(cid: string) {
  return `${PUBLIC_IPFS_GATEWAY}/${encodeURIComponent(cid)}`
}

export function resolveIpfsUrl(cid?: string | null, storedUrl?: string | null) {
  return cid ? ipfsGatewayUrl(cid) : storedUrl || undefined
}
