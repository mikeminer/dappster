import solc from "solc"
import fs from "node:fs"
import { encodeFunctionData, formatEther, keccak256, parseEther, toHex } from "viem"

const FEE_RECIPIENT = "0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134"
const DEPLOYMENT_FEE = parseEther("0.001")
const FROM = process.env.DAPPSTER_QA_FROM || FEE_RECIPIENT
const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7"
const DAPPSTER_FACTORY = "0xAbbEa740D7aA0540d3700a35328FCd619dDCf56c"
const factoryAbi = [{ type: "function", name: "deploy", stateMutability: "payable", inputs: [{ name: "creationCode", type: "bytes" }], outputs: [{ name: "deployed", type: "address" }] }]

const chains = [
  { id: 1, name: "Ethereum", rpc: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"] },
  { id: 8453, name: "Base", rpc: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] },
  { id: 33139, name: "ApeChain", rpc: ["https://rpc.apechain.com/http", "https://apechain.drpc.org"] },
  { id: 143, name: "Monad", rpc: ["https://rpc.monad.xyz", "https://rpc1.monad.xyz"] },
  { id: 42161, name: "Arbitrum One", rpc: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"] },
  { id: 10, name: "OP Mainnet", rpc: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"] },
  { id: 137, name: "Polygon PoS", rpc: ["https://polygon.drpc.org", "https://1rpc.io/matic"] },
  { id: 43114, name: "Avalanche C-Chain", rpc: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"] },
  { id: 56, name: "BNB Smart Chain", rpc: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"] },
  { id: 100, name: "Gnosis", rpc: ["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"] },
  { id: 42220, name: "Celo", rpc: ["https://forno.celo.org", "https://celo-rpc.publicnode.com"] },
  { id: 534352, name: "Scroll", rpc: ["https://rpc.scroll.io", "https://scroll-rpc.publicnode.com"] },
  { id: 59144, name: "Linea Mainnet", rpc: ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"] },
  { id: 324, name: "ZKsync Era", rpc: ["https://mainnet.era.zksync.io", "https://zksync.drpc.org"] },
  { id: 5000, name: "Mantle", rpc: ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com"] },
  { id: 81457, name: "Blast", rpc: ["https://rpc.blast.io", "https://blast-rpc.publicnode.com"] },
  { id: 34443, name: "Mode", rpc: ["https://mainnet.mode.network", "https://1rpc.io/mode"] },
  { id: 80094, name: "Berachain", rpc: ["https://rpc.berachain.com", "https://berachain-rpc.publicnode.com"] },
  { id: 146, name: "Sonic", rpc: ["https://rpc.soniclabs.com", "https://sonic-rpc.publicnode.com"] },
  { id: 252, name: "Fraxtal", rpc: ["https://rpc.frax.com", "https://fraxtal.gateway.tenderly.co"] },
  { id: 1088, name: "Metis", rpc: ["https://andromeda.metis.io/?owner=1088", "https://metis.drpc.org"] },
  { id: 4663, name: "Robinhood Chain", rpc: ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"] },
  { id: 999, name: "HyperEVM", rpc: ["https://rpc.hyperliquid.xyz/evm", "https://hyperliquid.drpc.org"] },
  { id: 11155111, name: "Sepolia", rpc: ["https://sepolia.gateway.tenderly.co", "https://ethereum-sepolia-rpc.publicnode.com"] },
  { id: 84532, name: "Base Sepolia", rpc: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"] },
]

function compileQaContract() {
  // Keep the deployed runtime close to the 12 KB contract that exposed the
  // Robinhood wallet issue, so QA covers realistic contract-creation payloads.
  const payload = "ab".repeat(12_000)
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract DappsterEvmQa {
  address payable private constant DAPPSTER_FEE_RECIPIENT = payable(${FEE_RECIPIENT});
  uint256 private constant DAPPSTER_DEPLOY_FEE = 0.001 ether;
  bytes private constant QA_PAYLOAD = hex"${payload}";
  event DappsterDeploymentFeePaid(address indexed recipient, uint256 amount);
  error InvalidDappsterDeploymentFee();
  error DappsterDeploymentFeeTransferFailed();
  address private _owner;
  constructor() payable {
    if (msg.value != DAPPSTER_DEPLOY_FEE) revert InvalidDappsterDeploymentFee();
    (bool feePaid, ) = DAPPSTER_FEE_RECIPIENT.call{value: DAPPSTER_DEPLOY_FEE}("");
    if (!feePaid) revert DappsterDeploymentFeeTransferFailed();
    emit DappsterDeploymentFeePaid(DAPPSTER_FEE_RECIPIENT, DAPPSTER_DEPLOY_FEE);
    _owner = msg.sender;
  }
  function owner() external view returns (address) { return _owner; }
  function transferOwnership(address nextOwner) external { require(msg.sender == _owner && nextOwner != address(0)); _owner = nextOwner; }
  function payloadHash() external pure returns (bytes32) { return keccak256(QA_PAYLOAD); }
}`
  const input = {
    language: "Solidity",
    sources: { "DappsterEvmQa.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter(error => error.severity === "error")
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n"))
  const contract = output.contracts["DappsterEvmQa.sol"].DappsterEvmQa
  return {
    bytecode: `0x${contract.evm.bytecode.object}`,
    initcodeBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
  }
}

function compileFactoryRuntime() {
  const source = fs.readFileSync("contracts/DappsterDeploymentFactory.sol", "utf8")
  const input = {
    language: "Solidity",
    sources: { "DappsterDeploymentFactory.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter(error => error.severity === "error")
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n"))
  return `0x${output.contracts["DappsterDeploymentFactory.sol"].DappsterDeploymentFactory.evm.deployedBytecode.object}`
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return payload.result
}

async function withFallback(chain, method, params) {
  const failures = []
  for (const url of chain.rpc) {
    try { return { result: await rpc(url, method, params), url } }
    catch (error) { failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  throw new Error(failures.join(" | "))
}

const artifact = compileQaContract()
const factoryRuntime = compileFactoryRuntime()
const factoryData = encodeFunctionData({ abi: factoryAbi, functionName: "deploy", args: [artifact.bytecode] })
const initcodeWithinProtocolLimit = artifact.initcodeBytes <= 49_152
const runtimeWithinProtocolLimit = artifact.runtimeBytes <= 24_576
if (!initcodeWithinProtocolLimit || !runtimeWithinProtocolLimit) {
  throw new Error("QA artifact exceeds the EVM contract-size limits")
}
const results = []
for (const chain of chains) {
  try {
    const chainId = Number(BigInt((await withFallback(chain, "eth_chainId", [])).result))
    if (chainId !== chain.id) throw new Error(`chain ID ${chainId}, expected ${chain.id}`)
    const balance = BigInt((await withFallback(chain, "eth_getBalance", [FROM, "latest"])).result)
    const gasPrice = BigInt((await withFallback(chain, "eth_gasPrice", [])).result)
    const singletonCode = (await withFallback(chain, "eth_getCode", [SAFE_SINGLETON_FACTORY, "latest"])).result
    if (!singletonCode || singletonCode === "0x") throw new Error("Safe deterministic factory is unavailable")
    const directRequest = { from: FROM, data: artifact.bytecode, value: toHex(DEPLOYMENT_FEE) }
    let estimate
    let simulatedWithBalanceOverride = false
    try {
      estimate = await withFallback(chain, "eth_estimateGas", [directRequest])
    } catch (error) {
      if (!String(error).toLowerCase().includes("insufficient funds")) throw error
      estimate = await withFallback(chain, "eth_estimateGas", [directRequest, "latest", {
        [FROM]: { balance: toHex(parseEther("1000")) },
      }])
      simulatedWithBalanceOverride = true
    }
    const estimatedGas = BigInt(estimate.result)
    let factoryEstimatedGas = null
    let factoryStateOverrideSupported = true
    try {
      const factoryEstimate = await withFallback(chain, "eth_estimateGas", [{
        from: FROM,
        to: DAPPSTER_FACTORY,
        data: factoryData,
        value: toHex(DEPLOYMENT_FEE),
      }, "latest", {
        [FROM]: { balance: toHex(parseEther("1000")) },
        [DAPPSTER_FACTORY]: { code: factoryRuntime },
      }])
      factoryEstimatedGas = Number(BigInt(factoryEstimate.result))
    } catch (error) {
      if (!String(error).toLowerCase().includes("too many arguments")) throw error
      factoryStateOverrideSupported = false
    }
    const estimatedTotal = DEPLOYMENT_FEE + estimatedGas * gasPrice
    const balanceEnough = balance >= estimatedTotal
    let invalidFeeRejected = false
    try {
      await withFallback(chain, "eth_estimateGas", [{ from: FROM, data: artifact.bytecode, value: "0x0" }])
    } catch {
      invalidFeeRejected = true
    }
    if (!invalidFeeRejected) throw new Error("constructor accepted a deployment without the mandatory fee")
    results.push({
      chain: chain.name,
      chainId,
      rpc: estimate.url,
      balanceEth: formatEther(balance),
      estimatedGas: Number(estimatedGas),
      factoryEstimatedGas,
      factoryStateOverrideSupported,
      simulatedWithBalanceOverride,
      gasPriceGwei: Number(gasPrice) / 1e9,
      restrictiveWalletFactoryEnvelopeAccepted: factoryStateOverrideSupported,
      factoryRuntimeCodeHash: keccak256(factoryRuntime),
      estimatedTotalEth: formatEther(estimatedTotal),
      balanceEnough,
      invalidFeeRejected,
      status: "PASS",
    })
  } catch (error) {
    results.push({ chain: chain.name, chainId: chain.id, status: "FAIL", error: error instanceof Error ? error.message : String(error) })
  }
}

console.log(JSON.stringify({
  artifact: { initcodeBytes: artifact.initcodeBytes, runtimeBytes: artifact.runtimeBytes, initcodeWithinProtocolLimit, runtimeWithinProtocolLimit },
  from: FROM,
  results,
}, null, 2))
if (results.some(result => result.status === "FAIL")) process.exitCode = 1
