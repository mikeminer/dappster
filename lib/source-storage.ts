import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { getSupabaseAdminConfig } from "./supabase"

const SOURCE_BUCKET = "dapp-sources"

export type DappSourceBundle = {
  version: 1
  contract: string
  frontend: string
  deployInstructions: string
  warnings: string[]
}

type SourceBackedDapp = {
  contract_code?: string | null
  frontend_code?: string | null
  source_bundle_path?: string | null
  source_bundle_hash?: string | null
}

function objectUrl(path: string) {
  const { url } = getSupabaseAdminConfig()
  return `${url}/storage/v1/object/${SOURCE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`
}

export async function storeDappSourceBundle(ownerId: string, dappId: string, input: Omit<DappSourceBundle, "version">) {
  const bundle: DappSourceBundle = { version: 1, ...input }
  const bytes = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 })
  const hash = createHash("sha256").update(bytes).digest("hex")
  const path = `${ownerId}/${dappId}/${hash}.json.gz`
  const { secret } = getSupabaseAdminConfig()
  const response = await fetch(objectUrl(path), {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/gzip",
      "x-upsert": "true",
    },
    body: bytes,
    cache: "no-store",
  })
  if (!response.ok) throw new Error((await response.text()) || "Source storage upload failed")
  return { path, hash, bytes: bytes.byteLength }
}

export async function getDappSourceBundle(path: string, expectedHash?: string | null) {
  const { secret } = getSupabaseAdminConfig()
  const response = await fetch(objectUrl(path), {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  })
  if (!response.ok) throw new Error((await response.text()) || "Source bundle is unavailable")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (expectedHash && createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
    throw new Error("Source bundle integrity check failed")
  }
  const parsed = JSON.parse(gunzipSync(bytes).toString("utf8")) as DappSourceBundle
  if (parsed.version !== 1 || typeof parsed.contract !== "string" || typeof parsed.frontend !== "string") {
    throw new Error("Source bundle is invalid")
  }
  return parsed
}

export async function deleteDappSourceBundle(path: string) {
  const { secret } = getSupabaseAdminConfig()
  const response = await fetch(objectUrl(path), {
    method: "DELETE",
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  })
  if (!response.ok && response.status !== 404) throw new Error((await response.text()) || "Source bundle could not be deleted")
}

export async function hydrateDappSources<T extends SourceBackedDapp>(dapp: T): Promise<T> {
  if ((dapp.contract_code && dapp.frontend_code) || !dapp.source_bundle_path) return dapp
  const bundle = await getDappSourceBundle(dapp.source_bundle_path, dapp.source_bundle_hash)
  return {
    ...dapp,
    contract_code: dapp.contract_code || bundle.contract,
    frontend_code: dapp.frontend_code || bundle.frontend,
  }
}
