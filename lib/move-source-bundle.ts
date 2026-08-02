import type { Chain } from "@/types"

export type MoveChain = Extract<Chain, "sui" | "aptos">

const FILE_HEADER = /^\s*=+\s*FILE:\s*([^=]+?)\s*=+\s*$/gm
const SAFE_PATH = /^(?:Move\.toml|sources\/[A-Za-z0-9_.-]+\.move|tests\/[A-Za-z0-9_.-]+\.move)$/

function normalizePath(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
}

function inferredPackageName(source: string) {
  const moduleName = source.match(/\bmodule\s+(?:[A-Za-z0-9_]+::)?([A-Za-z][A-Za-z0-9_]*)\s*\{/)?.[1]
  return (moduleName || "dappster_package").replace(/[^A-Za-z0-9_]/g, "_")
}

function defaultManifest(chain: MoveChain, packageName: string) {
  if (chain === "sui") return `[package]
name = "${packageName}"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }

[addresses]
${packageName} = "0x0"
`
  return `[package]
name = "${packageName}"
version = "1.0.0"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-framework.git", subdir = "aptos-framework", rev = "mainnet" }

[addresses]
${packageName} = "_"
`
}

export function parseMoveSourceBundle(source: string, chain: MoveChain) {
  if (!source.trim()) throw new Error("Generated Move source is empty")
  const matches = Array.from(source.matchAll(FILE_HEADER))
  const files = new Map<string, string>()

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const path = normalizePath(current[1])
    if (!SAFE_PATH.test(path)) throw new Error(`Generated Move bundle contains an unsupported path: ${path}`)
    if (files.has(path)) throw new Error(`Generated Move bundle contains the file twice: ${path}`)
    const start = (current.index || 0) + current[0].length
    const end = matches[index + 1]?.index ?? source.length
    const content = source.slice(start, end).replace(/^\s*```(?:move|toml)?\s*/i, "").replace(/\s*```\s*$/i, "").trim()
    if (!content) throw new Error(`Generated Move bundle contains an empty file: ${path}`)
    files.set(path, `${content}\n`)
  }

  if (!files.size) {
    const packageName = inferredPackageName(source)
    files.set("Move.toml", defaultManifest(chain, packageName))
    files.set("sources/main.move", `${source.trim()}\n`)
  }

  const moveFiles = Array.from(files.keys()).filter(path => path.startsWith("sources/") && path.endsWith(".move"))
  if (!moveFiles.length) throw new Error("Generated Move bundle does not contain a sources/*.move module")
  if (!files.has("Move.toml")) {
    const packageName = inferredPackageName(files.get(moveFiles[0]) || "")
    files.set("Move.toml", defaultManifest(chain, packageName))
  }
  if (files.size > 32) throw new Error("Generated Move bundle exceeds the 32-file limit")
  for (const [path, content] of Array.from(files.entries())) {
    if (Buffer.byteLength(content, "utf8") > 200_000) throw new Error(`Generated Move file exceeds 200 KB: ${path}`)
  }
  return Array.from(files.entries()).map(([path, content]) => ({ path, content }))
}
