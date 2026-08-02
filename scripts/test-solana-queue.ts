import assert from "node:assert/strict"
import {
  completeSolanaDeployJob,
  createOrGetSolanaDeployJob,
  fundAndClaimSolanaDeployJob,
} from "../lib/solana-deploy-jobs"

function job(id: string, key: string, cluster: "devnet" | "mainnet-beta" = "devnet") {
  return {
    id,
    job_key: key,
    dapp_id: id,
    owner_id: "00000000-0000-0000-0000-000000000001",
    cluster,
    wallet_address: `wallet-${id}`,
    payer_address: "technical-wallet",
    source_hash: `source-${id}`,
    program_id: `program-${id}`,
    byte_length: 1_000,
    rent_lamports: 10_000,
    network_fee_lamports: 2_000,
    required_lamports: 12_000,
    funding_memo: `memo-${id}`,
  }
}

async function main() {
  const first = await createOrGetSolanaDeployJob(job("00000000-0000-0000-0000-000000000101", "job-1"), true)
  const second = await createOrGetSolanaDeployJob(job("00000000-0000-0000-0000-000000000102", "job-2"), true)
  const otherCluster = await createOrGetSolanaDeployJob(job("00000000-0000-0000-0000-000000000103", "job-3", "mainnet-beta"), true)

  const firstClaim = await fundAndClaimSolanaDeployJob({
    jobId: first.id, ownerId: first.owner_id, fundingSignature: "funding-1", fundedLamports: 12_000, workerToken: "00000000-0000-0000-0000-000000000201",
  }, true)
  const secondClaim = await fundAndClaimSolanaDeployJob({
    jobId: second.id, ownerId: second.owner_id, fundingSignature: "funding-2", fundedLamports: 12_000, workerToken: "00000000-0000-0000-0000-000000000202",
  }, true)
  const parallelClusterClaim = await fundAndClaimSolanaDeployJob({
    jobId: otherCluster.id, ownerId: otherCluster.owner_id, fundingSignature: "funding-3", fundedLamports: 12_000, workerToken: "00000000-0000-0000-0000-000000000203",
  }, true)

  assert.equal(firstClaim.acquired, true, "the first devnet job must acquire the relayer")
  assert.equal(secondClaim.acquired, false, "the second devnet job must queue")
  assert.equal(parallelClusterClaim.acquired, true, "mainnet and devnet must use independent locks")

  await completeSolanaDeployJob(first.id, "00000000-0000-0000-0000-000000000201", first.program_id, true)
  const secondRetry = await fundAndClaimSolanaDeployJob({
    jobId: second.id, ownerId: second.owner_id, fundingSignature: "funding-2", fundedLamports: 12_000, workerToken: "00000000-0000-0000-0000-000000000204",
  }, true)
  assert.equal(secondRetry.acquired, true, "the queued job must acquire the released relayer")

  const replay = await createOrGetSolanaDeployJob(job("00000000-0000-0000-0000-000000000104", "job-4"), true)
  await assert.rejects(
    fundAndClaimSolanaDeployJob({
      jobId: replay.id, ownerId: replay.owner_id, fundingSignature: "funding-2", fundedLamports: 12_000,
    }, true),
    /già associata/,
    "a funding signature must not be reusable across jobs",
  )
  process.stdout.write("Solana queue concurrency checks passed\n")
}

void main()
