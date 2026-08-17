import { createHash } from "crypto"

export type SolanaIdl = Record<string, unknown>

const SOLANA_RUNTIME_MARKER = "dappster-solana-runtime-v1"

const SOLANA_BROWSER_MODULES: Record<string, string> = {
  "@solana/web3.js": "window.solanaWeb3",
  "@coral-xyz/anchor": "window.anchor",
  "@solana/spl-token": "window.splToken",
  "@solana/wallet-adapter-phantom": "window.phantomWalletAdapter",
}

export function buildSolanaImportAliases(frontendSource: string) {
  const declarations: string[] = []
  const declared = new Set<string>()
  const add = (localName: string, expression: string) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(localName) || declared.has(localName)) return
    declarations.push(`const ${localName} = ${expression};`)
    declared.add(localName)
  }
  const importPattern = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?\s*$/gm
  for (const match of Array.from(frontendSource.matchAll(importPattern))) {
    const moduleGlobal = SOLANA_BROWSER_MODULES[match[2]]
    if (!moduleGlobal) continue
    const clause = match[1].trim()
    if (clause.startsWith("type ")) continue

    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)
    if (namespace) add(namespace[1], moduleGlobal)

    const named = /\{([\s\S]*?)\}/.exec(clause)
    if (named) {
      for (const entry of named[1].split(",")) {
        const parsed = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(entry.trim())
        if (parsed && !entry.trim().startsWith("type ")) add(parsed[2] || parsed[1], `${moduleGlobal}.${parsed[1]}`)
      }
    }

    const defaultImport = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause)
    if (defaultImport) add(defaultImport[1], `(${moduleGlobal}.default || ${moduleGlobal})`)
  }
  return declarations.join("\n")
}

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
  return Array.from(createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8))
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
  const escapedValue = value.replace(/[$]/g, "\\$")
  if (/^(?:true|false)$/.test(value) || /(?:^is|^has|^can|^should|enabled|open|active|paused|status$)/i.test(value)) return "bool"
  if (/^['"`]/.test(value)) return "string"
  if (/new\s+(?:anchor\.)?BN\s*\(/.test(value)) return "u64"
  if (/(?:\|\||\?\?)\s*['"`]/.test(value) || /^String\s*\(/.test(value)) return "string"
  if (new RegExp(`(?:const|let|var)\\s+${escapedValue}\\s*=\\s*new\\s+(?:anchor\\.)?BN\\s*\\(`).test(source)) return "u64"
  if (
    /^[A-Za-z_$][\w$]*$/.test(value)
    && (
      new RegExp(`(?:const|let|var)\\s+${escapedValue}\\s*=\\s*['"\`]`).test(source)
      || new RegExp(`(?:const|let|var)\\s*\\[\\s*${escapedValue}\\s*,[^\\]]+\\]\\s*=\\s*(?:React\\.)?useState(?:\\s*<[^>]+>)?\\s*\\(\\s*['"\`]`).test(source)
    )
  ) return "string"
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
      const keypairName = value.replace(/\.publicKey$/, "")
      const escapedKeypairName = keypairName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const partialSigner = new RegExp(`\\.partialSign\\s*\\(\\s*${escapedKeypairName}\\s*\\)`).test(frontendSource)
      const anchorSigner = Array.from(frontendSource.matchAll(/\.signers\s*\(\s*\[([\s\S]*?)\]\s*\)/g)).some(signerList =>
        splitArguments(signerList[1]).some(signer => signer.trim() === keypairName),
      )
      const keypairSigner = partialSigner || anchorSigner
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

/**
 * Reads the compiler-generated Anchor IDL embedded by the Solana build worker.
 * The compatibility IDL is intentionally only a last resort: replacing a full
 * IDL with it removes account layouts and makes `program.account.*` unusable.
 */
export function extractCompiledSolanaIdl(frontendSource: string, programId?: string): SolanaIdl | undefined {
  const markerIndex = frontendSource.indexOf(SOLANA_RUNTIME_MARKER)
  if (markerIndex < 0) return undefined
  const idlKeyIndex = frontendSource.indexOf("solanaIdl", markerIndex)
  if (idlKeyIndex < 0) return undefined
  const objectStart = frontendSource.indexOf("{", idlKeyIndex)
  if (objectStart < 0) return undefined
  const objectEnd = matchingDelimiter(frontendSource, objectStart, "{", "}")
  if (objectEnd < 0) return undefined
  try {
    const parsed = JSON.parse(frontendSource.slice(objectStart, objectEnd + 1)) as SolanaIdl
    if (!parsed || !Array.isArray(parsed.instructions)) return undefined
    return programId ? { ...parsed, address: programId } : parsed
  } catch {
    return undefined
  }
}

export function injectCompiledSolanaIdl(frontendSource: string, idl: SolanaIdl, programId: string) {
  const encoded = JSON.stringify({ ...idl, address: programId }).replace(/</g, "\\u003c")
  let source = replaceSolanaProgramId(frontendSource, programId)
  // Phantom exposes the connected key directly. `getAccountInfo` is not a
  // Phantom provider request method, and an Anchor wallet must also expose the
  // signing methods used by AnchorProvider.
  source = source.replace(
    /\{\s*publicKey\s*:\s*new\s+PublicKey\s*\(\s*await\s+([A-Za-z_$][\w$]*)\.request\s*\(\s*\{\s*method\s*:\s*["']getAccountInfo["']\s*\}\s*\)\s*\)\s*\}/g,
    (_, providerName: string) => `{
      publicKey: ${providerName}.publicKey,
      signTransaction: ${providerName}.signTransaction.bind(${providerName}),
      signAllTransactions: ${providerName}.signAllTransactions.bind(${providerName}),
    }`,
  )
  const anchorProviderName = source.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:(?:window\.__DAPPSTER__\.anchor|anchor)\s*\.\s*)?AnchorProvider\s*\(/,
  )?.[1]
  // Anchor 0.30 reads the program address from idl.address and accepts the
  // provider as its second argument. Generated frontends sometimes still use
  // the pre-0.30 (idl, programId, provider) constructor, which successfully
  // connects Phantom and then throws while creating Program. Normalize both
  // imported Program and namespace-qualified anchor.Program constructions.
  source = source.replace(
    /new\s+((?:anchor\s*\.\s*)?Program)\s*\(\s*(?:idl|IDL|window\.__DAPPSTER__\.solanaIdl)\s*,\s*(?:PROGRAM_ID|programId|new\s+PublicKey\s*\([^)]*\))\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
    "new $1(window.__DAPPSTER__.solanaIdl, $2)",
  )
  if (anchorProviderName) {
    source = source.replace(
      /new\s+((?:anchor\s*\.\s*)?Program)\s*\(\s*(?:idl|IDL|window\.__DAPPSTER__\.solanaIdl)\s*,\s*(?:PROGRAM_ID|programId|new\s+PublicKey\s*\([^)]*\))\s*,?\s*\)/g,
      `new $1(window.__DAPPSTER__.solanaIdl, ${anchorProviderName})`,
    )
  }
  source = source.replace(
    /new\s+((?:anchor\s*\.\s*)?Program)\s*\(\s*(?:idl|IDL)\s*,/g,
    "new $1(window.__DAPPSTER__.solanaIdl,",
  )
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

export function buildSolanaRuntimeCompatibilityScript(solanaIdl?: SolanaIdl, solanaCluster?: "devnet" | "mainnet-beta") {
  const idlAssignment = solanaIdl
    ? `runtime.solanaIdl = ${JSON.stringify(solanaIdl).replace(/</g, "\\u003c")};`
    : ""
  const clusterAssignment = solanaCluster
    ? `runtime.solanaCluster = ${JSON.stringify(solanaCluster)}; runtime.solanaRpcUrl = ${JSON.stringify(solanaCluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com")};`
    : ""
  return `
    (function () {
      const runtime = window.__DAPPSTER__ || {};
      ${idlAssignment}
      ${clusterAssignment}
      if (runtime.chain !== "solana") {
        window.__DAPPSTER_SOLANA_READY__ = Promise.resolve();
        return;
      }
      window.__DAPPSTER_SOLANA_READY__ = Promise.resolve().then(function () {
        const modules = window.__DAPPSTER_SOLANA_RUNTIME__;
        if (!modules || !modules.web3 || !modules.anchor || !modules.splToken || !modules.Buffer) {
          throw new Error("The self-hosted Solana runtime did not load");
        }
        const anchorRuntime = Object.assign({}, modules.anchor);
        const anchorDefault = modules.anchor.default && typeof modules.anchor.default === "object"
          ? Object.assign({}, modules.anchor.default)
          : anchorRuntime;
        const OriginalProgram = modules.anchor.Program || anchorDefault.Program;
        const AnchorBN = modules.anchor.BN || anchorDefault.BN;
        const web3Runtime = Object.assign({}, modules.web3);
        const OriginalConnection = modules.web3.Connection;
        if (OriginalConnection && runtime.solanaRpcUrl) {
          const ClusterBoundConnection = new Proxy(OriginalConnection, {
            construct(target, args) {
              const nextArgs = Array.from(args);
              nextArgs[0] = runtime.solanaRpcUrl;
              return Reflect.construct(target, nextArgs, target);
            },
          });
          web3Runtime.Connection = ClusterBoundConnection;
        }
        anchorRuntime.web3 = web3Runtime;
        anchorDefault.web3 = web3Runtime;
        const normalizeInstructionName = function (value) {
          return String(value || "").replace(/_/g, "").toLowerCase();
        };
        const normalizeAnchorInteger = function (value, type, label) {
          if (value === null || value === undefined) return value;
          if (typeof type === "string") {
            if (/^[ui](?:64|128|256)$/.test(type)) {
              if (value && typeof value.toArrayLike === "function") return value;
              if (!AnchorBN) throw new Error("Anchor BN is unavailable for " + label);
              if (typeof value === "number" && !Number.isSafeInteger(value)) {
                throw new Error(label + " exceeds JavaScript's safe integer range; enter it as digits");
              }
              const encoded = String(value).trim();
              if (!/^-?\\d+$/.test(encoded) || (type[0] === "u" && encoded[0] === "-")) {
                throw new Error(label + " must be a valid " + type + " integer");
              }
              return new AnchorBN(encoded, 10);
            }
            if (/^[ui](?:8|16|32)$/.test(type) && typeof value === "string" && /^-?\\d+$/.test(value.trim())) {
              return Number(value);
            }
            return value;
          }
          if (!type || typeof type !== "object") return value;
          if (Object.prototype.hasOwnProperty.call(type, "option")) {
            return normalizeAnchorInteger(value, type.option, label);
          }
          if (Object.prototype.hasOwnProperty.call(type, "vec") && Array.isArray(value)) {
            return value.map(function (entry, index) {
              return normalizeAnchorInteger(entry, type.vec, label + "[" + index + "]");
            });
          }
          if (Array.isArray(type.array) && Array.isArray(value)) {
            return value.map(function (entry, index) {
              return normalizeAnchorInteger(entry, type.array[0], label + "[" + index + "]");
            });
          }
          return value;
        };
        const wrapProgram = function (program, idl) {
          if (!program || !program.methods || !idl || !Array.isArray(idl.instructions)) return program;
          const instructionByName = new Map(idl.instructions.map(function (instruction) {
            return [normalizeInstructionName(instruction && instruction.name), instruction];
          }));
          const methods = new Proxy(program.methods, {
            get(target, property, receiver) {
              const method = Reflect.get(target, property, receiver);
              if (typeof property !== "string" || typeof method !== "function") return method;
              const instruction = instructionByName.get(normalizeInstructionName(property));
              if (!instruction || !Array.isArray(instruction.args)) return method.bind(target);
              return function () {
                const args = Array.from(arguments).map(function (argument, index) {
                  const specification = instruction.args[index];
                  return specification
                    ? normalizeAnchorInteger(argument, specification.type, instruction.name + "." + specification.name)
                    : argument;
                });
                return method.apply(target, args);
              };
            },
          });
          return new Proxy(program, {
            get(target, property, receiver) {
              if (property === "methods") return methods;
              return Reflect.get(target, property, receiver);
            },
          });
        };
        if (OriginalProgram && AnchorBN) {
          const CompatibleProgram = new Proxy(OriginalProgram, {
            construct(target, args) {
              return wrapProgram(Reflect.construct(target, args, target), args[0] || runtime.solanaIdl);
            },
          });
          anchorRuntime.Program = CompatibleProgram;
          anchorDefault.Program = CompatibleProgram;
        }
        anchorRuntime.default = anchorDefault;
        window.Buffer = modules.Buffer;
        runtime.web3 = web3Runtime;
        runtime.anchor = anchorRuntime;
        // Older generated Solana frontends use window.__DAPPSTER__.spl,
        // while newer ones use splToken or the global window.splToken.
        // Keep both aliases so immutable IPFS deployments remain executable.
        runtime.spl = modules.splToken;
        runtime.splToken = modules.splToken;
        runtime.Buffer = modules.Buffer;
        runtime.assertSolanaAccount = async function (connection, address, label) {
          const accountLabel = label || "Solana account";
          let publicKey;
          try {
            publicKey = address instanceof web3Runtime.PublicKey ? address : new web3Runtime.PublicKey(String(address || "").trim());
          } catch {
            throw new Error(accountLabel + " is not a valid Solana address. Addresses are case-sensitive; paste the original value without changing capitalization.");
          }
          const account = await connection.getAccountInfo(publicKey, "confirmed");
          if (!account) {
            const clusterLabel = runtime.solanaCluster === "mainnet-beta" ? "Mainnet" : "Devnet";
            throw new Error(accountLabel + " does not exist on Solana " + clusterLabel + ". Use an address created on the same cluster as this dApp.");
          }
          return account;
        };
        Object.assign(window, web3Runtime, anchorRuntime, modules.splToken, modules.phantomWalletAdapter || {});
        window.solanaWeb3 = web3Runtime;
        window.SolanaWeb3 = web3Runtime;
        window.anchor = anchorRuntime;
        window.splToken = modules.splToken;
        window.phantomWalletAdapter = modules.phantomWalletAdapter || {};
        window.web3 = web3Runtime;
        window.anchorWeb3 = web3Runtime;
        if (runtime.solanaIdl) window.idl = runtime.solanaIdl;
        if (runtime.preview && window.PublicKey) {
          const OriginalPublicKey = window.PublicKey;
          const PreviewPublicKey = new Proxy(OriginalPublicKey, {
            construct(target, args) {
              try {
                return Reflect.construct(target, args, target);
              } catch (error) {
                console.warn("[Dappster preview] Replaced an invalid Solana public key", args[0], error);
                return Reflect.construct(target, ["11111111111111111111111111111111"], target);
              }
            },
          });
          window.PublicKey = PreviewPublicKey;
          try { if (window.solanaWeb3) window.solanaWeb3.PublicKey = PreviewPublicKey; } catch {}
          try { if (window.anchor && window.anchor.web3) window.anchor.web3.PublicKey = PreviewPublicKey; } catch {}
          const previewPublicKey = new PreviewPublicKey("11111111111111111111111111111111");
          const unavailable = function () {
            return Promise.reject(new Error("Wallet signing is disabled in the isolated Dappster preview"));
          };
          const previewProvider = {
            isPhantom: true,
            isConnected: true,
            publicKey: previewPublicKey,
            connect: function () {
              this.isConnected = true;
              return Promise.resolve({ publicKey: previewPublicKey });
            },
            disconnect: function () {
              this.isConnected = false;
              return Promise.resolve();
            },
            on: function () { return this; },
            off: function () { return this; },
            removeListener: function () { return this; },
            signTransaction: unavailable,
            signAllTransactions: unavailable,
            signAndSendTransaction: unavailable,
            signMessage: unavailable,
            request: function (input) {
              if (input && input.method === "connect") return this.connect();
              if (input && input.method === "disconnect") return this.disconnect();
              return unavailable();
            },
          };
          if (!window.phantom) window.phantom = {};
          if (!window.phantom.solana) window.phantom.solana = previewProvider;
          if (!window.solana) window.solana = window.phantom.solana;
        }
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
      if (window.__DAPPSTER_PREVIEW__?.fail) {
        window.__DAPPSTER_PREVIEW__.fail(error);
      } else {
        const root = document.getElementById("root");
        if (root) root.innerHTML = '<div class="boot" style="padding:24px;text-align:center">Unable to load the Solana runtime. Reload the dApp and try again.</div>';
      }
    });
  `
}
