import { createDAppKit } from "@mysten/dapp-kit-react"
import { SuiGrpcClient } from "@mysten/sui/grpc"

const SUI_TESTNET_GRPC_URL = process.env.NEXT_PUBLIC_SUI_TESTNET_GRPC_URL || "https://fullnode.testnet.sui.io:443"

export const suiDAppKit = createDAppKit({
  networks: ["testnet"] as const,
  defaultNetwork: "testnet",
  createClient: network => new SuiGrpcClient({ network, baseUrl: SUI_TESTNET_GRPC_URL }),
  slushWalletConfig: null,
})

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof suiDAppKit
  }
}
