import { compileSolidity } from "../lib/solidity.ts"

const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Bytes} from "@openzeppelin/contracts/utils/Bytes.sol";

contract CancunProbe {
    bytes32 public digest;

    constructor() {
        bytes memory value = hex"010203";
        digest = keccak256(Bytes.slice(value, 0, 2));
    }
}
`

let parisRejectedMcopy = false
try {
  compileSolidity(source, "CancunProbe", { chainId: 8453 })
} catch (error) {
  parisRejectedMcopy = error instanceof Error && error.message.includes('The "mcopy" instruction is only available')
}

if (!parisRejectedMcopy) throw new Error("Expected the Paris compiler target to reject MCOPY")

const berachainArtifact = compileSolidity(source, "CancunProbe", { chainId: 80094 })
if (berachainArtifact.evmVersion !== "cancun") throw new Error("Berachain must compile for the Cancun EVM")
if (!berachainArtifact.bytecode.startsWith("0x") || berachainArtifact.bytecode.length <= 2) {
  throw new Error("Berachain compilation did not produce deployable bytecode")
}

console.log(JSON.stringify({
  parisRejectedMcopy,
  berachainEvmVersion: berachainArtifact.evmVersion,
  bytecodeBytes: (berachainArtifact.bytecode.length - 2) / 2,
}))
