export type PublisherProfile = {
  username?: string | null
  wallet_address?: string | null
}

export function formatPublisher(profile: PublisherProfile | undefined, ownerId?: string) {
  const username = profile?.username?.trim()
  if (username) return `@${username}`

  const wallet = profile?.wallet_address?.replace(/^web3:(?:ethereum|solana):/i, "")
  if (wallet && wallet.length > 12) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
  if (wallet) return wallet
  if (ownerId && ownerId.length > 12) return `${ownerId.slice(0, 6)}…${ownerId.slice(-4)}`
  return "Dappster builder"
}
