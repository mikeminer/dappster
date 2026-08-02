import fs from "node:fs"
import path from "node:path"
import solc from "solc"
import type { Abi } from "viem"

type CompilerMessage = { severity: "error" | "warning"; formattedMessage: string }
type CompilerContract = {
  abi: Abi
  evm: { bytecode: { object: string } }
}
type CompilerOutput = {
  contracts?: Record<string, Record<string, CompilerContract>>
  errors?: CompilerMessage[]
}

export type SolidityEvmVersion = "paris" | "cancun"

type CompileSolidityOptions = {
  chainId?: number
}

// Berachain mainnet has supported Cancun since genesis. Keep the conservative
// Paris target everywhere else until that network is explicitly qualified for
// Cancun bytecode; this prevents a generated artifact from silently becoming
// incompatible with an older allowlisted EVM.
const CANCUN_EVM_CHAIN_IDS = new Set([80094])

export function solidityEvmVersionForChain(chainId?: number): SolidityEvmVersion {
  return chainId && CANCUN_EVM_CHAIN_IDS.has(chainId) ? "cancun" : "paris"
}

function resolveImport(importPath: string) {
  if (!importPath.startsWith("@openzeppelin/contracts/")) return { error: `Unsupported import: ${importPath}` }
  const modulesRoot = path.resolve(process.cwd(), "node_modules")
  const resolved = path.resolve(modulesRoot, importPath)
  if (!resolved.startsWith(path.join(modulesRoot, "@openzeppelin", "contracts"))) return { error: `Invalid import: ${importPath}` }
  try { return { contents: fs.readFileSync(resolved, "utf8") } }
  catch { return { error: `OpenZeppelin source missing from compiler bundle: ${importPath}` } }
}

export function compileSolidity(source: string, preferredName?: string, options: CompileSolidityOptions = {}) {
  const sourceName = "DappsterContract.sol"
  const evmVersion = solidityEvmVersionForChain(options.chainId)
  const input = {
    language: "Solidity",
    sources: { [sourceName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Compile for the selected deployment network. OpenZeppelin 5.6 uses
      // MCOPY in Bytes.sol, which requires Cancun-compatible bytecode.
      evmVersion,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport })) as CompilerOutput
  const errors = (output.errors || []).filter(message => message.severity === "error")
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n").slice(0, 12000))
  const contracts = output.contracts?.[sourceName] || {}
  const deployable = Object.entries(contracts).filter(([, contract]) => contract.evm.bytecode.object)
  const selected = (preferredName && contracts[preferredName]?.evm.bytecode.object
    ? [preferredName, contracts[preferredName]]
    : deployable.at(-1)) as [string, CompilerContract] | undefined
  if (!selected) throw new Error("No deployable contract was found in the generated source")
  const [contractName, contract] = selected
  const constructor = contract.abi.find(item => item.type === "constructor") as { inputs?: Array<{ name: string; type: string }> } | undefined
  return {
    contractName,
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}` as `0x${string}`,
    constructorInputs: constructor?.inputs || [],
    evmVersion,
    warnings: (output.errors || []).filter(message => message.severity === "warning").map(message => message.formattedMessage).slice(0, 10),
  }
}
