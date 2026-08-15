import assert from "node:assert/strict"
import { callXAI } from "../lib/xai-provider.ts"

const originalFetch = globalThis.fetch
const originalWarn = console.warn
const originalEnvironment = {
  apiKey: process.env.XAI_API_KEY,
  model: process.env.XAI_GENERATION_MODEL,
  fallback: process.env.XAI_GENERATION_FALLBACK_MODEL,
  delay: process.env.XAI_RETRY_BASE_DELAY_MS,
}

process.env.XAI_API_KEY = "qa-key"
process.env.XAI_GENERATION_MODEL = "primary-model"
process.env.XAI_GENERATION_FALLBACK_MODEL = "fallback-model"
process.env.XAI_RETRY_BASE_DELAY_MS = "0"
console.warn = () => undefined

function completion(content = '{"ok":true}') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

try {
  {
    const requestedModels: string[] = []
    let calls = 0
    globalThis.fetch = async (_input, init) => {
      requestedModels.push(JSON.parse(String(init?.body)).model)
      calls += 1
      return calls === 1 ? new Response("", { status: 500 }) : completion()
    }
    assert.equal(await callXAI("system", "prompt"), '{"ok":true}')
    assert.deepEqual(requestedModels, ["primary-model", "primary-model"])
  }

  {
    const requestedModels: string[] = []
    globalThis.fetch = async (_input, init) => {
      requestedModels.push(JSON.parse(String(init?.body)).model)
      return requestedModels.length < 3 ? new Response("", { status: 503 }) : completion()
    }
    assert.equal(await callXAI("system", "prompt"), '{"ok":true}')
    assert.deepEqual(requestedModels, ["primary-model", "primary-model", "fallback-model"])
  }

  {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ error: { code: "invalid_request" } }), { status: 400 })
    }
    await assert.rejects(() => callXAI("system", "prompt"), /Generation provider failed \(400\)/)
    assert.equal(calls, 1)
  }

  console.log("xAI provider retry and fallback QA passed")
} finally {
  globalThis.fetch = originalFetch
  console.warn = originalWarn
  if (originalEnvironment.apiKey === undefined) delete process.env.XAI_API_KEY
  else process.env.XAI_API_KEY = originalEnvironment.apiKey
  if (originalEnvironment.model === undefined) delete process.env.XAI_GENERATION_MODEL
  else process.env.XAI_GENERATION_MODEL = originalEnvironment.model
  if (originalEnvironment.fallback === undefined) delete process.env.XAI_GENERATION_FALLBACK_MODEL
  else process.env.XAI_GENERATION_FALLBACK_MODEL = originalEnvironment.fallback
  if (originalEnvironment.delay === undefined) delete process.env.XAI_RETRY_BASE_DELAY_MS
  else process.env.XAI_RETRY_BASE_DELAY_MS = originalEnvironment.delay
}
