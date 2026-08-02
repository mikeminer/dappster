"use client"

import { getAccount, getConnections, reconnect, switchAccount, switchChain } from "@wagmi/core"
import { createWalletClient, custom, type Chain } from "viem"
import { wagmiConfig } from "@/lib/wagmi-config"

function isExpectedAddress(address: string | undefined, expectedAddresses: readonly string[]) {
  if (!address || !expectedAddresses.length) return Boolean(address)
  return expectedAddresses.some(expected => expected.toLowerCase() === address.toLowerCase())
}

async function activeAccount(expectedAddresses: readonly string[] = []) {
  let account = getAccount(wagmiConfig)
  if (!isExpectedAddress(account.address, expectedAddresses)) {
    const matchingConnection = getConnections(wagmiConfig).find(connection => isExpectedAddress(connection.accounts[0], expectedAddresses))
    if (matchingConnection) {
      await switchAccount(wagmiConfig, { connector: matchingConnection.connector })
      account = getAccount(wagmiConfig)
    }
  }
  if (!account.isConnected || !account.address || !account.connector) {
    await reconnect(wagmiConfig)
    account = getAccount(wagmiConfig)
  }
  if (!account.isConnected || !account.address || !account.connector) {
    throw new Error("Connect your linked EVM wallet to continue")
  }
  return { address: account.address, chainId: account.chainId, connector: account.connector }
}

export async function getConnectedEvmWallet(chain: Chain, expectedAddresses: readonly string[] = []) {
  const account = await activeAccount(expectedAddresses)
  if (account.chainId !== chain.id) await switchChain(wagmiConfig, { chainId: chain.id as never })
  const provider = await account.connector.getProvider()
  const wallet = createWalletClient({ chain, transport: custom(provider as never) })
  return {
    address: account.address,
    connector: account.connector,
    provider,
    wallet,
  }
}
