import { createPublicClient, decodeEventLog, decodeFunctionData, keccak256, parseEther, type Hex } from "viem"
import { DAPPSTER_DEPLOYMENT_FEE, DAPPSTER_FEE_EVENT_ABI, DAPPSTER_FEE_RECIPIENT } from "@/lib/deployment-fee"
import { DAPPSTER_FACTORY_ABI, DAPPSTER_FACTORY_ADDRESS, DAPPSTER_FACTORY_RUNTIME_CODE_HASH } from "@/lib/deployment-factory"
import { getEvmTransport, getSupportedEvmChain } from "@/lib/evm-chains"

export async function verifyEvmContractDeployment(input: { address: string; txHash: string; chainId: number }) {
  const chain = getSupportedEvmChain(input.chainId)
  if (!chain) throw new Error("Unsupported EVM deployment network")
  const client = createPublicClient({ chain, transport: getEvmTransport(chain) })
  const hash = input.txHash as `0x${string}`
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ])
  if (receipt.status !== "success") throw new Error("The contract deployment receipt could not be verified")
  if (transaction.value !== parseEther(DAPPSTER_DEPLOYMENT_FEE)) throw new Error(`Contract deployment must send exactly ${DAPPSTER_DEPLOYMENT_FEE} ${chain.nativeCurrency.symbol}`)

  if (transaction.to === null) {
    if (receipt.contractAddress?.toLowerCase() !== input.address.toLowerCase()) throw new Error("The deployed contract address does not match the transaction receipt")
  } else if (transaction.to.toLowerCase() === DAPPSTER_FACTORY_ADDRESS.toLowerCase()) {
    const factoryCode = await client.getBytecode({ address: DAPPSTER_FACTORY_ADDRESS })
    if (!factoryCode || keccak256(factoryCode) !== DAPPSTER_FACTORY_RUNTIME_CODE_HASH) throw new Error("The deployment factory code could not be verified")
    let creationCode: Hex
    try {
      const decoded = decodeFunctionData({ abi: DAPPSTER_FACTORY_ABI, data: transaction.input })
      if (decoded.functionName !== "deploy") throw new Error("Unexpected factory function")
      creationCode = decoded.args[0] as Hex
    } catch {
      throw new Error("The deployment factory transaction data is invalid")
    }
    const validFactoryEvent = receipt.logs
      .filter(log => log.address.toLowerCase() === DAPPSTER_FACTORY_ADDRESS.toLowerCase())
      .some(log => {
        try {
          const decoded = decodeEventLog({ abi: DAPPSTER_FACTORY_ABI, eventName: "DappsterContractDeployed", data: log.data, topics: log.topics })
          return decoded.args.deployer.toLowerCase() === transaction.from.toLowerCase()
            && decoded.args.contractAddress.toLowerCase() === input.address.toLowerCase()
            && decoded.args.creationCodeHash === keccak256(creationCode)
        } catch { return false }
      })
    if (!validFactoryEvent) throw new Error("The factory did not prove deployment of this contract")
    const owner = await client.readContract({
      address: input.address as `0x${string}`,
      abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
      functionName: "owner",
    })
    if (owner.toLowerCase() !== transaction.from.toLowerCase()) throw new Error("The factory deployment did not transfer ownership to the deploying wallet")
  } else {
    throw new Error("The verified transaction is not a supported Dappster deployment")
  }

  const deployedCode = await client.getBytecode({ address: input.address as `0x${string}` })
  if (!deployedCode) throw new Error("No deployed contract code was found at the recorded address")
  const validFeeEvent = receipt.logs
    .filter(log => log.address.toLowerCase() === input.address.toLowerCase())
    .some(log => {
      try {
        const decoded = decodeEventLog({ abi: DAPPSTER_FEE_EVENT_ABI, eventName: "DappsterDeploymentFeePaid", data: log.data, topics: log.topics })
        return decoded.args.recipient.toLowerCase() === DAPPSTER_FEE_RECIPIENT.toLowerCase()
          && decoded.args.amount === parseEther(DAPPSTER_DEPLOYMENT_FEE)
      } catch { return false }
    })
  if (!validFeeEvent) throw new Error("The deployment did not prove payment of the Dappster fee")
}
