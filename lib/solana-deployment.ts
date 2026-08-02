import { clusterApiUrl, Connection, PublicKey, type Cluster } from "@solana/web3.js"

export type SolanaDeploymentCluster = Extract<Cluster, "devnet" | "mainnet-beta">

export function isSolanaDeploymentCluster(value: string): value is SolanaDeploymentCluster {
  return value === "devnet" || value === "mainnet-beta"
}

export async function verifySolanaProgramDeployment(input: { programId: string; cluster: SolanaDeploymentCluster }) {
  let publicKey: PublicKey
  try {
    publicKey = new PublicKey(input.programId)
  } catch {
    throw new Error("Program ID Solana non valido")
  }

  const configuredRpc = input.cluster === "devnet" ? process.env.SOLANA_DEVNET_RPC_URL : process.env.SOLANA_MAINNET_RPC_URL
  const connection = new Connection(configuredRpc || clusterApiUrl(input.cluster), "confirmed")
  let account
  try {
    account = await connection.getAccountInfo(publicKey, "confirmed")
  } catch {
    throw new Error(`RPC Solana ${input.cluster} non raggiungibile. Configura ${input.cluster === "devnet" ? "SOLANA_DEVNET_RPC_URL" : "SOLANA_MAINNET_RPC_URL"} con un endpoint RPC valido.`)
  }
  if (!account) throw new Error(`Programma non trovato su Solana ${input.cluster}`)
  if (!account.executable) throw new Error("L'account indicato esiste, ma non è un programma Solana eseguibile")
  return { programId: publicKey.toBase58(), cluster: input.cluster, status: "confirmed" as const }
}
