import type { SolanaDeploymentCluster } from "./solana-deployment"

export function solanaDeployAuthorizationMessage(dappId: string, cluster: SolanaDeploymentCluster, jobId?: string) {
  return `Dappster Solana program deployment\ndApp: ${dappId}\nCluster: ${cluster}${jobId ? `\nDeployment job: ${jobId}` : ""}\nAction: compile, deploy and publish`
}
