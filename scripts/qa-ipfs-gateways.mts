import assert from "node:assert/strict"
import { fetchIpfsContent } from "../lib/ipfs-gateway.ts"

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

await assert.rejects(
  fetchIpfsContent("bafytest", (async () => new Response("unavailable", { status: 504 })) as typeof fetch),
  /All IPFS gateways are temporarily unavailable/,
)

console.log("IPFS gateway QA passed: a failed gateway falls back to the first successful response.")
