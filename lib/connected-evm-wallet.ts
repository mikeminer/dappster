"use client"

import { getAccount, getConnections, reconnect, switchAccount, switchChain } from "@wagmi/core"
import { createWalletClient, custom, type Chain } from "viem"
import { wagmiConfig } from "@/lib/wagmi-config"
import { reownAppKit } from "@/lib/reown"

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

function isExpectedAddress(address: string | undefined, expectedAddresses: readonly string[]) {
  if (!address || !expectedAddresses.length) return Boolean(address)
  return expectedAddresses.some(expected => expected.toLowerCase() === address.toLowerCase())
}

async function activeAccount(expectedAddresses: readonly string[] = []) {
  const accountFromConnections = async () => {
    const connections = getConnections(wagmiConfig)
    for (const connection of connections) {
      const accounts = await connection.connector.getAccounts().catch(() => connection.accounts)
      const address = accounts.find(candidate => isExpectedAddress(candidate, expectedAddresses))
      if (!address) continue
      try {
        await switchAccount(wagmiConfig, { connector: connection.connector })
      } catch {
        // AppKit can restore its provider before Wagmi finishes hydrating the
        // active-account snapshot. The connector account remains authoritative.
      }
      const switched = getAccount(wagmiConfig)
      if (switched.isConnected && switched.address && switched.connector && isExpectedAddress(switched.address, expectedAddresses)) {
        return { address: switched.address, chainId: switched.chainId, connector: switched.connector }
      }
      return { address, chainId: connection.chainId, connector: connection.connector }
    }
    return null
  }

  let account = getAccount(wagmiConfig)
  if (!isExpectedAddress(account.address, expectedAddresses)) {
    const matchingConnection = getConnections(wagmiConfig).find(connection => isExpectedAddress(connection.accounts[0], expectedAddresses))
    if (matchingConnection) {
      await switchAccount(wagmiConfig, { connector: matchingConnection.connector })
      account = getAccount(wagmiConfig)
    }
  }
  if (account.isConnected && account.address && account.connector && isExpectedAddress(account.address, expectedAddresses)) {
    return { address: account.address, chainId: account.chainId, connector: account.connector }
  }

  const restored = await accountFromConnections()
  if (restored) return restored

  await reconnect(wagmiConfig).catch(() => undefined)
  // WalletConnect/AppKit restoration is asynchronous on mobile and after a
  // page refresh. Give Wagmi a short hydration window before declaring that
  // the already-authorized wallet is disconnected.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    account = getAccount(wagmiConfig)
    if (account.isConnected && account.address && account.connector && isExpectedAddress(account.address, expectedAddresses)) {
      return { address: account.address, chainId: account.chainId, connector: account.connector }
    }
    const connectionAccount = await accountFromConnections()
    if (connectionAccount) return connectionAccount
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("Connect your linked EVM wallet to continue")
}

export async function getConnectedEvmWallet(chain: Chain, expectedAddresses: readonly string[] = []) {
  try {
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
  } catch (wagmiError) {
    const candidates: Array<{ id: "walletConnect" | "injected"; provider: Eip1193Provider | undefined }> = [
      {
        id: "walletConnect",
        provider: reownAppKit?.getAccount("eip155")?.isConnected
          ? reownAppKit.getWalletProvider() as Eip1193Provider | undefined
          : undefined,
      },
      {
        id: "injected",
        provider: (window as Window & { ethereum?: Eip1193Provider }).ethereum,
      },
    ]
    for (const candidate of candidates) {
      if (!candidate.provider?.request) continue
      const accountsValue = await candidate.provider.request({ method: "eth_accounts" }).catch(() => [])
      const accounts = Array.isArray(accountsValue)
        ? accountsValue.filter((value): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))
        : []
      const address = accounts.find(value => isExpectedAddress(value, expectedAddresses))
      if (!address) continue
      const chainIdValue = await candidate.provider.request({ method: "eth_chainId" }).catch(() => undefined)
      const activeChainId = typeof chainIdValue === "string" ? Number.parseInt(chainIdValue, 16) : undefined
      if (activeChainId !== chain.id) {
        await candidate.provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${chain.id.toString(16)}` }],
        })
      }
      return {
        address,
        connector: { id: candidate.id },
        provider: candidate.provider,
        wallet: createWalletClient({ chain, transport: custom(candidate.provider) }),
      }
    }
    throw wagmiError
  }
}
