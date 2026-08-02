import type { Abi } from "viem"

const MAIN_ABI_DECLARATION = "\\b(?:const|let|var)\\s+(?:ABI|CONTRACT_?ABI|DAPP_?ABI)\\s*(?::[^=;\\n]+)?=\\s*\\["

function findArrayEnd(source: string, openingBracket: number) {
  let depth = 0
  let quote = ""
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = openingBracket; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = ""
      continue
    }
    if (character === "/" && next === "/") { lineComment = true; index += 1; continue }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue }
    if (character === '"' || character === "'" || character === "`") { quote = character; continue }
    if (character === "[") depth += 1
    if (character === "]" && --depth === 0) return index
  }
  return -1
}

/** Replaces the generated main-contract ABI with solc's authoritative ABI. */
export function injectCompiledAbiIntoFrontend(frontendCode: string, abi: Abi) {
  const replacements: Array<{ start: number; end: number }> = []
  const declaration = new RegExp(MAIN_ABI_DECLARATION, "gi")
  let match: RegExpExecArray | null
  while ((match = declaration.exec(frontendCode)) !== null) {
    const openingBracket = match.index + match[0].lastIndexOf("[")
    const end = findArrayEnd(frontendCode, openingBracket)
    if (end >= 0) replacements.push({ start: openingBracket, end: end + 1 })
  }
  const serializedAbi = JSON.stringify(abi, null, 2)
  const enriched = replacements.reverse().reduce(
    (source, replacement) => `${source.slice(0, replacement.start)}${serializedAbi}${source.slice(replacement.end)}`,
    frontendCode,
  )
  return enhanceFrontendErrorMessages(enriched)
}

/** Routes common generated catch messages through Dappster's ABI-aware decoder. */
export function enhanceFrontendErrorMessages(frontendCode: string) {
  return frontendCode
    .replace(/\b([A-Za-z_$][\w$]*)\?\.shortMessage\s*\|\|\s*\1\?\.message/g, "window.__DAPPSTER__.decodeError($1)")
    .replace(/\b([A-Za-z_$][\w$]*)\.shortMessage\s*\|\|\s*\1\.message/g, "window.__DAPPSTER__.decodeError($1)")
}
