import { createWalletClient, custom, defineChain, encodeFunctionData } from "viem"
import { apeChain, arbitrum, avalanche, base, baseSepolia, berachain, blast, bsc, celo, fraxtal, gnosis, hyperEvm, linea, mainnet, mantle, metis, mode, monad, optimism, polygon, scroll, sepolia, sonic, zksync } from "viem/chains"

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
})

const ACCOUNT = "0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134"
const VALUE = 1_000_000_000_000_000n
const GAS = 1_000_000n
const GAS_PRICE = 20_000_000n
const DAPPSTER_FACTORY = "0xAbbEa740D7aA0540d3700a35328FCd619dDCf56c"
const factoryAbi = [{ type: "function", name: "deploy", stateMutability: "payable", inputs: [{ name: "creationCode", type: "bytes" }], outputs: [{ name: "deployed", type: "address" }] }]
const scenarios = [
  { chain: base, policy: "estimated" },
  { chain: apeChain, policy: "estimated" },
  { chain: monad, policy: "estimated" },
  { chain: robinhood, policy: "legacy" },
  { chain: mainnet, policy: "estimated" },
  { chain: arbitrum, policy: "estimated" },
  { chain: optimism, policy: "wallet-managed" },
  { chain: polygon, policy: "estimated" },
  { chain: avalanche, policy: "estimated" },
  { chain: bsc, policy: "estimated" },
  { chain: gnosis, policy: "estimated" },
  { chain: celo, policy: "estimated" },
  { chain: scroll, policy: "estimated" },
  { chain: linea, policy: "legacy" },
  { chain: zksync, policy: "estimated" },
  { chain: mantle, policy: "estimated" },
  { chain: blast, policy: "wallet-managed" },
  { chain: mode, policy: "wallet-managed" },
  { chain: berachain, policy: "estimated" },
  { chain: sonic, policy: "estimated" },
  { chain: fraxtal, policy: "wallet-managed" },
  { chain: metis, policy: "estimated" },
  { chain: hyperEvm, policy: "estimated" },
  { chain: sepolia, policy: "estimated" },
  { chain: baseSepolia, policy: "estimated" },
]

const results = []
for (const { chain, policy } of scenarios) {
  let submitted
  const provider = {
    async request({ method, params }) {
      if (method === "eth_chainId") return `0x${chain.id.toString(16)}`
      if (method === "eth_sendTransaction") {
        submitted = params[0]
        return `0x${"1".repeat(64)}`
      }
      throw new Error(`Unexpected wallet method: ${method}`)
    },
  }
  const wallet = createWalletClient({ chain, transport: custom(provider) })
  const request = { account: ACCOUNT, abi: [], bytecode: "0x60006000f3", args: [], value: VALUE }
  if (policy === "legacy") await wallet.deployContract({ ...request, gas: GAS, gasPrice: GAS_PRICE })
  else if (policy === "eip1559") await wallet.deployContract({ ...request, gas: GAS, maxFeePerGas: GAS_PRICE * 2n, maxPriorityFeePerGas: GAS_PRICE })
  else if (policy === "estimated") await wallet.deployContract({ ...request, gas: GAS })
  else await wallet.deployContract(request)

  const hasGas = Object.hasOwn(submitted, "gas")
  const hasGasPrice = Object.hasOwn(submitted, "gasPrice")
  const hasEip1559Fees = Object.hasOwn(submitted, "maxFeePerGas") || Object.hasOwn(submitted, "maxPriorityFeePerGas")
  const valid = policy === "legacy"
    ? hasGas && hasGasPrice && !hasEip1559Fees
    : policy === "eip1559"
      ? hasGas && !hasGasPrice && hasEip1559Fees
    : policy === "estimated"
      ? hasGas && !hasGasPrice && !hasEip1559Fees
      : !hasGas && !hasGasPrice && !hasEip1559Fees
  results.push({ chain: chain.name, chainId: chain.id, policy, submittedFields: Object.keys(submitted).sort(), status: valid ? "PASS" : "FAIL" })
}

for (const { chain } of scenarios) {
  let walletConnectSubmission
  const walletConnectProvider = {
    async request({ method, params }) {
      if (method === "eth_chainId") return `0x${chain.id.toString(16)}`
      if (method !== "eth_sendTransaction") throw new Error(`Unexpected wallet method: ${method}`)
      walletConnectSubmission = params[0]
      return `0x${"2".repeat(64)}`
    },
  }
  const walletConnectClient = createWalletClient({ chain, transport: custom(walletConnectProvider) })
  await walletConnectClient.sendTransaction({
    account: ACCOUNT,
    to: DAPPSTER_FACTORY,
    data: encodeFunctionData({ abi: factoryAbi, functionName: "deploy", args: ["0x60006000f3"] }),
    value: VALUE,
    gas: GAS,
    gasPrice: GAS_PRICE,
  })
  const walletConnectFieldsValid = Object.hasOwn(walletConnectSubmission, "gas")
    && Object.hasOwn(walletConnectSubmission, "gasPrice")
    && walletConnectSubmission.to?.toLowerCase() === DAPPSTER_FACTORY.toLowerCase()
    && !Object.hasOwn(walletConnectSubmission, "maxFeePerGas")
    && !Object.hasOwn(walletConnectSubmission, "maxPriorityFeePerGas")
  results.push({
    chain: `${chain.name} · Zerion / WalletConnect`,
    chainId: chain.id,
    policy: "verified-factory-call",
    submittedFields: Object.keys(walletConnectSubmission).sort(),
    status: walletConnectFieldsValid ? "PASS" : "FAIL",
  })
}

console.log(JSON.stringify(results, null, 2))
if (results.some(result => result.status === "FAIL")) process.exit(1)
