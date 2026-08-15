import { ipfsGatewayUrl } from "@/lib/ipfs"
import { buildHTMLShell } from "@/lib/frontend-shell"
import type { Abi } from "viem"

export async function deployFrontendToIPFS(dappId: string, frontendCode: string, contractAddress: string, chain: string, contractAbi?: Abi, evmChainId?: number) {
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT is not configured")
  const html = buildHTMLShell(frontendCode, contractAddress, chain, false, contractAbi, evmChainId)
  const form = new FormData()
  form.append("file", new Blob([html], { type: "text/html" }), "index.html")
  form.append("network", "public")
  form.append("pinataMetadata", JSON.stringify({ name: `dappster-${dappId}` }))
  const response = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form })
  if (!response.ok) throw new Error(`IPFS upload failed (${response.status})`)
  const json = await response.json() as { data?: { cid?: string }; IpfsHash?: string }
  const cid = json.data?.cid || json.IpfsHash
  if (!cid) throw new Error("Pinata did not return a CID")
  return { cid, url: ipfsGatewayUrl(cid) }
}

export async function deployJsonToIPFS(name: string, json: string) {
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT is not configured")
  const form = new FormData()
  form.append("file", new Blob([json], { type: "application/json" }), `${name}.json`)
  form.append("network", "public")
  form.append("pinataMetadata", JSON.stringify({ name }))
  const response = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    body: form,
  })
  if (!response.ok) throw new Error(`IPFS manifest upload failed (${response.status})`)
  const payload = await response.json() as { data?: { cid?: string }; IpfsHash?: string }
  const cid = payload.data?.cid || payload.IpfsHash
  if (!cid) throw new Error("Pinata did not return a manifest CID")
  return { cid, url: ipfsGatewayUrl(cid) }
}
