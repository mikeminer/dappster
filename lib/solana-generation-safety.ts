function matchingDelimiter(source: string, start: number, open: string, close: string) {
  let depth = 0
  let quote = ""
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = ""
      continue
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function splitTopLevelArguments(source: string) {
  const values: string[] = []
  let start = 0
  let round = 0
  let square = 0
  let curly = 0
  let quote = ""
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = ""
      continue
    }
    if (char === "\"" || char === "'" || char === "`") quote = char
    else if (char === "(") round += 1
    else if (char === ")") round -= 1
    else if (char === "[") square += 1
    else if (char === "]") square -= 1
    else if (char === "{") curly += 1
    else if (char === "}") curly -= 1
    else if (char === "," && round === 0 && square === 0 && curly === 0) {
      values.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail) values.push(tail)
  return values
}

function fixedRustTypeSize(typeSource: string): number | undefined {
  const type = typeSource.trim()
  const primitives: Record<string, number> = {
    bool: 1,
    u8: 1,
    i8: 1,
    u16: 2,
    i16: 2,
    u32: 4,
    i32: 4,
    f32: 4,
    u64: 8,
    i64: 8,
    f64: 8,
    u128: 16,
    i128: 16,
    Pubkey: 32,
  }
  if (primitives[type] !== undefined) return primitives[type]
  const option = /^Option\s*<\s*([^>]+)\s*>$/.exec(type)
  if (option) {
    const inner = fixedRustTypeSize(option[1])
    return inner === undefined ? undefined : inner + 1
  }
  const array = /^\[\s*([^;]+)\s*;\s*(\d+)\s*\]$/.exec(type)
  if (array) {
    const inner = fixedRustTypeSize(array[1])
    return inner === undefined ? undefined : inner * Number(array[2])
  }
  return undefined
}

function fixedAccountSizes(contract: string) {
  const sizes = new Map<string, number>()
  const pattern = /#\s*\[\s*account\s*\]\s*(?:#\s*\[[^\]]+\]\s*)*pub\s+struct\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\}/g
  for (const match of Array.from(contract.matchAll(pattern))) {
    let size = 8
    let complete = true
    const fields = Array.from(match[2].matchAll(/^\s*pub\s+[A-Za-z_$][\w$]*\s*:\s*([^,\n]+),?/gm))
    for (const field of fields) {
      const fieldSize = fixedRustTypeSize(field[1])
      if (fieldSize === undefined) {
        complete = false
        break
      }
      size += fieldSize
    }
    if (complete) sizes.set(match[1], size)
  }
  return sizes
}

function numericSpace(expression: string) {
  if (!/^\s*\d+(?:\s*\+\s*\d+)*\s*$/.test(expression)) return undefined
  return expression.split("+").reduce((sum, value) => sum + Number(value.trim()), 0)
}

function accountAttributes(contract: string) {
  const accounts: Array<{ name: string; type: string; attributes: string }> = []
  const fieldPattern = /pub\s+([A-Za-z_$][\w$]*)\s*:\s*(?:Box\s*<\s*)?Account\s*<'info\s*,\s*([A-Za-z_$][\w$]*)\s*>/g
  for (const match of Array.from(contract.matchAll(fieldPattern))) {
    const prefix = contract.slice(Math.max(0, (match.index || 0) - 1600), match.index)
    const start = prefix.lastIndexOf("#[account(")
    accounts.push({ name: match[1], type: match[2], attributes: start >= 0 ? prefix.slice(start) : "" })
  }
  return accounts
}

function validateAccountAllocation(contract: string) {
  const issues: string[] = []
  const sizes = fixedAccountSizes(contract)
  for (const account of accountAttributes(contract)) {
    if (!/\binit(?:_if_needed)?\b/.test(account.attributes)) continue
    const expression = /\bspace\s*=\s*([^,\n\]]+)/.exec(account.attributes)?.[1]
    const provided = expression ? numericSpace(expression) : undefined
    const required = sizes.get(account.type)
    if (provided !== undefined && required !== undefined && provided < required) {
      issues.push(`${account.name} allocates ${provided} bytes, but ${account.type} needs at least ${required}`)
    }
  }
  return issues
}

function pdaSeedByAccount(contract: string) {
  const seeds = new Map<string, string>()
  for (const account of accountAttributes(contract)) {
    const seed = /\bseeds\s*=\s*\[\s*b"([^"]+)"/.exec(account.attributes)?.[1]
    if (seed) seeds.set(account.name, seed)
  }
  return seeds
}

function validatePdaCpiAuthorities(contract: string) {
  const issues: string[] = []
  const pdaSeeds = pdaSeedByAccount(contract)
  const functionPattern = /pub\s+fn\s+([A-Za-z_$][\w$]*)[^\{]*\{/g
  for (const match of Array.from(contract.matchAll(functionPattern))) {
    const bodyStart = (match.index || 0) + match[0].length - 1
    const bodyEnd = matchingDelimiter(contract, bodyStart, "{", "}")
    if (bodyEnd < 0) continue
    const body = contract.slice(bodyStart + 1, bodyEnd)
    if (!/(?:new_with_signer|\.with_signer)\s*\(/.test(body)) continue
    const signerSeeds = new Set(Array.from(body.matchAll(/b"([^"]+)"/g), seed => seed[1]))
    const authorities = Array.from(body.matchAll(/authority\s*:\s*ctx\.accounts\.([A-Za-z_$][\w$]*)\.to_account_info\s*\(\s*\)/g), value => value[1])
    for (const authority of authorities) {
      const expectedSeed = pdaSeeds.get(authority)
      if (expectedSeed && signerSeeds.size && !signerSeeds.has(expectedSeed)) {
        issues.push(`${match[1]} signs a CPI as ${authority}, but its signer seeds do not include b"${expectedSeed}"`)
      }
    }
  }
  return issues
}

function validateProgramConstruction(frontend: string) {
  const issues: string[] = []
  const runtimeIdlAliases = new Set<string>()
  const directAliasPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*window\s*\.\s*__DAPPSTER__\s*(?:\?\s*)?\.\s*solanaIdl\b/g
  for (const match of Array.from(frontend.matchAll(directAliasPattern))) runtimeIdlAliases.add(match[1])
  const destructuredAliasPattern = /\b(?:const|let|var)\s*\{\s*solanaIdl(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*\}\s*=\s*window\s*\.\s*__DAPPSTER__\b/g
  for (const match of Array.from(frontend.matchAll(destructuredAliasPattern))) runtimeIdlAliases.add(match[1] || "solanaIdl")
  const pattern = /new\s+(?:anchor\s*\.\s*)?Program\s*\(/g
  for (const match of Array.from(frontend.matchAll(pattern))) {
    const argsStart = (match.index || 0) + match[0].length - 1
    const argsEnd = matchingDelimiter(frontend, argsStart, "(", ")")
    if (argsEnd < 0) continue
    const args = splitTopLevelArguments(frontend.slice(argsStart + 1, argsEnd))
    if (args.length !== 2) issues.push("Anchor 0.30 Program must receive exactly the injected IDL and AnchorProvider")
    const idlArgument = args[0]?.trim()
    const usesRuntimeIdl = Boolean(idlArgument && (
      /window\s*\.\s*__DAPPSTER__\s*(?:\?\s*)?\.\s*solanaIdl/.test(idlArgument)
      || (/^[A-Za-z_$][\w$]*$/.test(idlArgument) && runtimeIdlAliases.has(idlArgument))
    ))
    if (idlArgument && !usesRuntimeIdl) {
      issues.push("Anchor Program must read the compiler IDL from window.__DAPPSTER__.solanaIdl")
    }
  }
  return issues
}

export function solanaGenerationSafetyIssues(contract: string, frontend: string) {
  const issues = [
    ...validateAccountAllocation(contract),
    ...validatePdaCpiAuthorities(contract),
    ...validateProgramConstruction(frontend),
  ]
  if (/new\s+(?:anchor\s*\.\s*)?Provider\s*\(/.test(frontend)) issues.push("Use AnchorProvider, not the removed legacy Provider")
  if (/\brequire\s*\(/.test(frontend)) issues.push("The frontend uses CommonJS require(), which cannot run in the browser preview")
  if (/(?:PhantomWalletAdapter|WalletMultiButton|WalletProvider)/.test(frontend)) issues.push("The frontend depends on a wallet-adapter component that requires a bundler")
  if (/\binit_if_needed\b/.test(contract) && /Pubkey\s*::\s*default\s*\(\s*\)/.test(contract)) {
    issues.push("A custom PDA uses init_if_needed plus a default-Pubkey reinitialization guard; use init for one active record or explicit state transitions")
  }
  return Array.from(new Set(issues))
}

export function assertSolanaGenerationSafety(contract: string, frontend: string) {
  const issues = solanaGenerationSafetyIssues(contract, frontend)
  if (issues.length) throw new Error(`Generated Solana source failed safety preflight:\n- ${issues.join("\n- ")}`)
}
