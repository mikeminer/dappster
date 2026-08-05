import { sha256 } from "@noble/hashes/sha256"
import { utf8ToBytes } from "@noble/hashes/utils"

export type SolanaIdl = Record<string, unknown>

const SOLANA_RUNTIME_MARKER = "dappster-solana-runtime-v1"

function snakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
}

function pascalCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join("")
}

function discriminator(namespace: "global" | "account", name: string) {
  return Array.from(sha256(utf8ToBytes(`${namespace}:${name}`)).subarray(0, 8))
}

function matchingDelimiter(source: string, start: number, open: string, close: string) {
  let depth = 0
  let quote = ""
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = ""
      continue
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character
      continue
    }
    if (character === open) depth += 1
    else if (character === close && --depth === 0) return index
  }
  return -1
}

function splitArguments(value: string) {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ""
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = ""
      continue
    }
    if (character === "'" || character === '"' || character === "`") quote = character
    else if ("([{<".includes(character)) depth += 1
    else if (")]}>".includes(character)) depth -= 1
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = value.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

function inferredArgumentType(expression: string, source: string) {
  const value = expression.trim()
  if (/^(?:true|false)$/.test(value) || /(?:^is|^has|^can|^should|enabled|open|active|paused|status$)/i.test(value)) return "bool"
  if (/^['"`]/.test(value)) return "string"
  if (/new\s+(?:anchor\.)?BN\s*\(/.test(value)) return "u64"
  if (new RegExp(`(?:const|let|var)\\s+${value.replace(/[$]/g, "\\$")}\\s*=\\s*new\\s+(?:anchor\\.)?BN\\s*\\(`).test(source)) return "u64"
  if (/(?:publicKey|pubkey|authority|owner|recipient|treasury|mint)$/i.test(value)) return "pubkey"
  return "u64"
}

function inferredAccountFields(source: string, accountName: string) {
  const aliases = new Set<string>([accountName])
  const fetchPattern = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+[A-Za-z_$][\\w$]*\\.account\\.${accountName}\\.fetch`, "g")
  for (const match of Array.from(source.matchAll(fetchPattern))) aliases.add(match[1])
  const fields = new Map<string, string>()
  for (const alias of Array.from(aliases)) {
    const propertyPattern = new RegExp(`\\b${alias.replace(/[$]/g, "\\$")}\\.([A-Za-z_$][\\w$]*)`, "g")
    for (const match of Array.from(source.matchAll(propertyPattern))) {
      const field = match[1]
      if (field === "fetch") continue
      const nearby = source.slice(match.index, match.index + 100)
      const type = /\.equals\s*\(/.test(nearby) || /(?:authority|owner|mint|recipient|treasury|wallet|pubkey|publicKey)$/i.test(field)
        ? "pubkey"
        : /^(?:is|has|can|should|enabled|open|active|paused)/i.test(field)
          ? "bool"
          : "u64"
      fields.set(field, type)
    }
  }
  const priority = (field: string) => /^(?:authority|owner)$/.test(field) ? 0 : field === "mint" ? 1 : 2
  return Array.from(fields.entries())
    .sort(([a], [b]) => priority(a) - priority(b))
    .map(([name, type]) => ({ name: snakeCase(name), type }))
}

/**
 * Reconstructs the subset of an Anchor 0.30 IDL referenced by an old generated
 * frontend. New deployments embed the compiler-generated IDL instead; this is
 * only a compatibility bridge for immutable CIDs created before that fix.
 */
export function inferLegacySolanaIdl(frontendSource: string, programId: string): SolanaIdl | undefined {
  const instructions: Array<Record<string, unknown>> = []
  const methodPattern = /\.methods\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of Array.from(frontendSource.matchAll(methodPattern))) {
    const argsStart = (match.index || 0) + match[0].length - 1
    const argsEnd = matchingDelimiter(frontendSource, argsStart, "(", ")")
    if (argsEnd < 0) continue
    const accountsMatch = /\.accounts\s*\(\s*\{/.exec(frontendSource.slice(argsEnd + 1))
    if (!accountsMatch) continue
    const accountsStart = argsEnd + 1 + accountsMatch.index + accountsMatch[0].lastIndexOf("{")
    const accountsEnd = matchingDelimiter(frontendSource, accountsStart, "{", "}")
    if (accountsEnd < 0) continue

    const args = splitArguments(frontendSource.slice(argsStart + 1, argsEnd)).map((expression, index) => ({
      name: snakeCase(/^[A-Za-z_$][\w$]*$/.test(expression) ? expression : `arg${index + 1}`),
      type: inferredArgumentType(expression, frontendSource),
    }))
    const accountBlock = frontendSource.slice(accountsStart + 1, accountsEnd)
    const accounts = splitArguments(accountBlock).map(entry => {
      const parsed = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([\s\S]+))?$/.exec(entry.trim())
      if (!parsed) return undefined
      const clientName = parsed[1]
      const value = (parsed[2] || clientName).trim()
      const readonly = /(?:program|rent|clock|instructions|sysvar)$/i.test(clientName)
      const walletSigner = /^(?:authority|payer|signer|user|owner|admin)$/i.test(clientName) && /(?:wallet|publicKey|pubkey|authority|payer|signer|user|owner|admin)/i.test(value)
      const keypairSigner = new RegExp(`\\.partialSign\\s*\\(\\s*${value.replace(/\.publicKey$/, "").replace(/[$]/g, "\\$")}\\s*\\)`).test(frontendSource)
      return {
        name: snakeCase(clientName),
        ...(!readonly ? { writable: true } : {}),
        ...(walletSigner || keypairSigner ? { signer: true } : {}),
      }
    }).filter(Boolean)
    const rustName = snakeCase(match[1])
    instructions.push({ name: rustName, discriminator: discriminator("global", rustName), accounts, args })
  }
  if (!instructions.length) return undefined

  const accountNames = Array.from(new Set(Array.from(frontendSource.matchAll(/\.account\.([A-Za-z_$][\w$]*)\.fetch\s*\(/g)).map(match => match[1])))
  const accounts = accountNames.map(name => {
    const rustName = pascalCase(name)
    return { name: rustName, discriminator: discriminator("account", rustName) }
  })
  const types = accountNames.map(name => ({
    name: pascalCase(name),
    type: { kind: "struct", fields: inferredAccountFields(frontendSource, name) },
  }))
  return {
    address: programId,
    metadata: { name: "dappster_program", version: "0.1.0", spec: "0.1.0", description: "Dappster legacy compatibility IDL" },
    instructions,
    ...(accounts.length ? { accounts, types } : {}),
  }
}

export function injectCompiledSolanaIdl(frontendSource: string, idl: SolanaIdl, programId: string) {
  const encoded = JSON.stringify({ ...idl, address: programId }).replace(/</g, "\\u003c")
  let source = replaceSolanaProgramId(frontendSource, programId)
  source = source.replace(/new\s+Program\s*\(\s*(?:idl|IDL)\s*,/g, "new Program(window.__DAPPSTER__.solanaIdl,")
  const bootstrap = `/* ${SOLANA_RUNTIME_MARKER} */\nwindow.__DAPPSTER__ = Object.assign({}, window.__DAPPSTER__ || {}, { solanaIdl: ${encoded} });\n`
  return source.includes(SOLANA_RUNTIME_MARKER)
    ? source.replace(/\/\* dappster-solana-runtime-v1 \*\/\r?\nwindow\.__DAPPSTER__\s*=\s*[^\r\n]+\r?\n/, bootstrap)
    : `${bootstrap}${source}`
}

export function replaceSolanaProgramId(frontendSource: string, programId: string) {
  return frontendSource.replace(
    /((?:const|let|var)\s+PROGRAM_ID\s*=\s*new\s+PublicKey\s*\(\s*)["'][1-9A-HJ-NP-Za-km-z]{32,44}["'](\s*\))/,
    `$1'${programId}'$2`,
  )
}

export function buildSolanaRuntimeCompatibilityScript(solanaIdl?: SolanaIdl) {
  const idlAssignment = solanaIdl
    ? `runtime.solanaIdl = ${JSON.stringify(solanaIdl).replace(/</g, "\\u003c")};`
    : ""
  return `
    (function () {
      const runtime = window.__DAPPSTER__ || {};
      ${idlAssignment}
      if (runtime.chain !== "solana") {
        window.__DAPPSTER_SOLANA_READY__ = Promise.resolve();
        return;
      }
      window.__DAPPSTER_SOLANA_READY__ = Promise.resolve().then(function () {
        const modules = window.__DAPPSTER_SOLANA_RUNTIME__;
        if (!modules || !modules.anchor || !modules.splToken || !modules.Buffer) {
          throw new Error("The self-hosted Solana runtime did not load");
        }
        window.Buffer = modules.Buffer;
        Object.assign(window, modules.web3, modules.anchor, modules.splToken);
        window.anchor = modules.anchor;
        window.web3 = modules.web3;
        if (runtime.solanaIdl) window.idl = runtime.solanaIdl;
      });
    })();
  `
}

export function wrapSolanaBabelSource(source: string) {
  if (source.includes("dappster-solana-bootstrap-v1")) return source
  return `
    /* dappster-solana-bootstrap-v1 */
    Promise.resolve(window.__DAPPSTER_SOLANA_READY__).then(function () {
      ${source}
    }).catch(function (error) {
      console.error("[Dappster Solana runtime]", error);
      const root = document.getElementById("root");
      if (root) root.innerHTML = '<div class="boot" style="padding:24px;text-align:center">Unable to load the Solana runtime. Reload the dApp and try again.</div>';
    });
  `
}
