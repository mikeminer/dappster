import assert from "node:assert/strict"
import { fetchIpfsContent } from "../lib/ipfs-gateway.ts"

const originalGateway = process.env.PINATA_GATEWAY
delete process.env.PINATA_GATEWAY

const calls: string[] = []
const fallbackResponse = await fetchIpfsContent("bafytest", (async input => {
  const url = String(input)
  calls.push(url)
  if (url.includes("gateway.pinata.cloud")) return new Response("timeout", { status: 504 })
  if (url.includes("ipfs.io")) return new Response("dApp HTML", { status: 200, headers: { "content-type": "text/html" } })
  return new Response("unavailable", { status: 502 })
}) as typeof fetch)

assert.equal(fallbackResponse.status, 200)
assert.equal(await fallbackResponse.text(), "dApp HTML")
assert.equal(calls.length, 3)

process.env.PINATA_GATEWAY = "dedicated-example.mypinata.cloud"
const dedicatedCalls: string[] = []
const dedicatedResponse = await fetchIpfsContent("bafytest", (async input => {
  const url = String(input)
  dedicatedCalls.push(url)
  if (url === "https://dedicated-example.mypinata.cloud/ipfs/bafytest") {
    return new Response("Pinned dApp HTML", { status: 200, headers: { "content-type": "text/html" } })
  }
  return new Response("unavailable", { status: 504 })
}) as typeof fetch)

assert.equal(dedicatedResponse.status, 200)
assert.equal(await dedicatedResponse.text(), "Pinned dApp HTML")
assert.equal(dedicatedCalls.length, 4)

await assert.rejects(
  fetchIpfsContent("bafytest", (async () => new Response("unavailable", { status: 504 })) as typeof fetch),
  /All IPFS gateways are temporarily unavailable/,
)

if (originalGateway === undefined) delete process.env.PINATA_GATEWAY
else process.env.PINATA_GATEWAY = originalGateway

console.log("IPFS gateway QA passed: the configured Pinata origin and public fallbacks are resilient.")
