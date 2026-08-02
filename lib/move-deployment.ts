import { Aptos, AptosConfig, Network, isUserTransactionResponse } from "@aptos-labs/ts-sdk"
import { SuiGrpcClient } from "@mysten/sui/grpc"

const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: process.env.SUI_TESTNET_GRPC_URL || process.env.NEXT_PUBLIC_SUI_TESTNET_GRPC_URL || "https://fullnode.testnet.sui.io:443",
})
const aptosClient = new Aptos(new AptosConfig({ network: Network.DEVNET }))

function canonicalAptosAddress(value: string) {
  return `0x${value.toLowerCase().replace(/^0x/, "").replace(/^0+/, "") || "0"}`
}

export async function verifySuiPackageDeployment(input: { packageId: string; txDigest: string; publisher: string }) {
  const result = await suiClient.waitForTransaction({
    digest: input.txDigest,
    timeout: 60_000,
    include: { effects: true, transaction: true },
  })
  if (result.$kind !== "Transaction" || !result.Transaction.status.success) throw new Error("The Sui package publish transaction failed")
  if (result.Transaction.transaction.sender?.toLowerCase() !== input.publisher.toLowerCase()) throw new Error("The Sui package transaction was signed by a different account")
  const published = result.Transaction.effects.changedObjects.find(change =>
    change.objectId.toLowerCase() === input.packageId.toLowerCase()
      && change.outputState === "PackageWrite"
      && change.idOperation === "Created",
  )
  if (!published) throw new Error("The Sui transaction did not create the recorded package")
}

export async function verifyAptosPackageDeployment(input: { publisher: string; txHash: string }) {
  const result = await aptosClient.waitForTransaction({ transactionHash: input.txHash, options: { timeoutSecs: 60, checkSuccess: true } })
  if (!isUserTransactionResponse(result) || !result.success) throw new Error("The Aptos package publish transaction failed")
  if (canonicalAptosAddress(result.sender) !== canonicalAptosAddress(input.publisher)) throw new Error("The Aptos publish transaction was signed by a different account")
  if (!("function" in result.payload) || result.payload.function !== "0x1::code::publish_package_txn") throw new Error("The Aptos transaction is not a package publish")
}
