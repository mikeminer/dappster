"use client"

import { getAccount, getConnections, reconnect, switchAccount, switchChain } from "@wagmi/core"
import { createWalletClient, custom, type Chain } from "viem"
import { wagmiConfig } from "@/lib/wagmi-config"
import { reownAppKit } from "@/lib/reown"

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  providers?: Eip1193Provider[]
}

type Eip6963ProviderDetail = {
  info: {
    uuid: string
    name: string
    icon: string
    rdns: string
  }
  provider: Eip1193Provider
}

export class LinkedEvmAccountMismatchError extends Error {
  constructor() {
    super("Connect your linked EVM wallet to continue")
    this.name = "LinkedEvmAccountMismatchError"
  }
}

function normalizeEvmAddress(address: string | undefined) {
  return address?.trim().replace(/^web3:ethereum:/i, "").toLowerCase() || ""
}

function isExpectedAddress(address: string | undefined, expectedAddresses: readonly string[]) {
  if (!address || !expectedAddresses.length) return Boolean(address)
  const normalizedAddress = normalizeEvmAddress(address)
  return expectedAddresses.some(expected => normalizeEvmAddress(expected) === normalizedAddress)
}

function providerErrorCode(error: unknown) {
  const value = error as { code?: unknown; data?: { originalError?: { code?: unknown } } } | undefined
  return Number(value?.code ?? value?.data?.originalError?.code)
}

async function ensureProviderChain(provider: Eip1193Provider, chain: Chain) {
  const chainIdHex = `0x${chain.id.toString(16)}`
  const currentChainId = await provider.request({ method: "eth_chainId" }).catch(() => undefined)
  if (typeof currentChainId === "string" && currentChainId.toLowerCase() === chainIdHex.toLowerCase()) return
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] })
  } catch (error) {
    if (providerErrorCode(error) !== 4902) throw error
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainIdHex,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [...chain.rpcUrls.default.http],
        blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
      }],
    })
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] })
  }
  const confirmedChainId = await provider.request({ method: "eth_chainId" })
  if (typeof confirmedChainId !== "string" || confirmedChainId.toLowerCase() !== chainIdHex.toLowerCase()) {
    throw new Error(`Your wallet did not switch to ${chain.name}`)
  }
}

function addProviderCandidate(
  candidates: Array<{ id: "walletConnect" | "injected"; provider: Eip1193Provider }>,
  seen: Set<Eip1193Provider>,
  id: "walletConnect" | "injected",
  provider: Eip1193Provider | undefined,
) {
  if (!provider?.request || seen.has(provider)) return
  seen.add(provider)
  candidates.push({ id, provider })
}

async function discoverEip6963Providers(timeoutMs = 350) {
  if (typeof window === "undefined") return []

  const providers: Eip1193Provider[] = []
  const seen = new Set<Eip1193Provider>()
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail
    if (!detail?.provider?.request || seen.has(detail.provider)) return
    seen.add(detail.provider)
    providers.push(detail.provider)
  }

  window.addEventListener("eip6963:announceProvider", onAnnounce)
  try {
    // EIP-6963 lets every installed wallet announce its own provider without
    // competing to overwrite window.ethereum. This is essential when Zerion,
    // Rabby, Coinbase Wallet, Phantom and similar extensions coexist.
    window.dispatchEvent(new Event("eip6963:requestProvider"))
    await new Promise(resolve => setTimeout(resolve, timeoutMs))
  } finally {
    window.removeEventListener("eip6963:announceProvider", onAnnounce)
  }
  return providers
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
  if (expectedAddresses.length) throw new LinkedEvmAccountMismatchError()
  throw new Error("Connect your EVM wallet to continue")
}

export async function getConnectedEvmWallet(chain: Chain, expectedAddresses: readonly string[] = []) {
  try {
    const account = await activeAccount(expectedAddresses)
    const provider = await account.connector.getProvider() as Eip1193Provider
    if (account.chainId !== chain.id) {
      try {
        await switchChain(wagmiConfig, { chainId: chain.id as never })
      } catch {
        // AppKit and WalletConnect can expose the authorized provider before
        // Wagmi restores its active chain. Switch through EIP-1193 in that case.
        await ensureProviderChain(provider, chain)
      }
    }
    await ensureProviderChain(provider, chain)
    const wallet = createWalletClient({ chain, transport: custom(provider as never) })
    return {
      address: account.address,
      connector: account.connector,
      provider,
      wallet,
    }
  } catch (wagmiError) {
    const candidates: Array<{ id: "walletConnect" | "injected"; provider: Eip1193Provider }> = []
    const seen = new Set<Eip1193Provider>()
    const reownProvider = reownAppKit?.getWalletProvider() as Eip1193Provider | undefined
    addProviderCandidate(candidates, seen, "walletConnect", reownProvider)
    for (const provider of await discoverEip6963Providers()) {
      addProviderCandidate(candidates, seen, "injected", provider)
    }
    const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum
    for (const provider of injected?.providers || []) addProviderCandidate(candidates, seen, "injected", provider)
    addProviderCandidate(candidates, seen, "injected", injected)

    for (const candidate of candidates) {
      const accountsValue = await candidate.provider.request({ method: "eth_accounts" }).catch(() => [])
      const accounts = Array.isArray(accountsValue)
        ? accountsValue.filter((value): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))
        : []
      const address = accounts.find(value => isExpectedAddress(value, expectedAddresses))
      if (!address) continue
      await ensureProviderChain(candidate.provider, chain)
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
