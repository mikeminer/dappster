import fs from "node:fs"
import solc from "solc"
import { getContractAddress, keccak256, stringToHex } from "viem"

const EXPECTED_ADDRESS = "0xAbbEa740D7aA0540d3700a35328FCd619dDCf56c"
const EXPECTED_RUNTIME_HASH = "0x30951e8fa2e4d2e15a4df8145132a7cae650d94fe2482ae5d57a24b1ad20658e"
const SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7"
const salt = keccak256(stringToHex("DappsterDeploymentFactory.v1"))
const source = fs.readFileSync("contracts/DappsterDeploymentFactory.sol", "utf8")
const input = {
  language: "Solidity",
  sources: { "F.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter(error => error.severity === "error")
if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n"))
const artifact = output.contracts["F.sol"].DappsterDeploymentFactory
const bytecode = `0x${artifact.evm.bytecode.object}`
const runtimeHash = keccak256(`0x${artifact.evm.deployedBytecode.object}`)
const address = getContractAddress({ opcode: "CREATE2", from: SINGLETON_FACTORY, salt, bytecode })
if (address !== EXPECTED_ADDRESS || runtimeHash !== EXPECTED_RUNTIME_HASH) {
  throw new Error(`Factory artifact mismatch: address=${address}, runtimeHash=${runtimeHash}`)
}
console.log(JSON.stringify({ address, runtimeHash, salt, status: "PASS" }, null, 2))
