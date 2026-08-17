import assert from "node:assert/strict"
import {
  createOrGetSolanaDeployJob,
  failSolanaDeployJob,
  fundAndClaimSolanaDeployJob,
  getSolanaDeployJob,
  recordSolanaDeployFunding,
  releaseSolanaDeployJob,
} from "../lib/solana-deploy-jobs"
import { getSolanaProgramWriteResumeOffset } from "../lib/solana-program-deploy"

const ownerId = "00000000-0000-0000-0000-000000000001"
const jobId = "00000000-0000-0000-0000-000000000301"
const workerToken = "00000000-0000-0000-0000-000000000401"

async function main() {
  const created = await createOrGetSolanaDeployJob({
    id: jobId,
    job_key: "async-worker-job",
    dapp_id: jobId,
    owner_id: ownerId,
    cluster: "devnet",
    wallet_address: "wallet-async",
    payer_address: "technical-wallet",
    source_hash: "source-async",
    program_id: "program-async",
    byte_length: 2_000,
    rent_lamports: 10_000,
    network_fee_lamports: 2_000,
    required_lamports: 12_000,
    funding_memo: "memo-async",
  }, true)

  const funded = await recordSolanaDeployFunding({
    jobId: created.id,
    ownerId,
    fundingSignature: "funding-async",
    fundedLamports: 12_000,
  }, true)
  assert.equal(funded.status, "funded")

  const claim = await fundAndClaimSolanaDeployJob({
    jobId: created.id,
    ownerId,
    fundingSignature: "funding-async",
    fundedLamports: 12_000,
    workerToken,
  }, true)
  assert.equal(claim.acquired, true)

  await releaseSolanaDeployJob(created.id, workerToken, "429 Too Many Requests", true)
  await failSolanaDeployJob(created.id, ownerId, "temporary failure", true)
  const resumed = await recordSolanaDeployFunding({
    jobId: created.id,
    ownerId,
    fundingSignature: "funding-async",
    fundedLamports: 12_000,
  }, true)
  assert.equal(resumed.status, "funded", "a verified payment must resume without another transfer")
  assert.equal(resumed.error, null)
  assert.equal((await getSolanaDeployJob(created.id, ownerId, true))?.funding_signature, "funding-async")

  const artifact = Uint8Array.from({ length: 2_050 }, (_, index) => index % 251)
  assert.equal(getSolanaProgramWriteResumeOffset(undefined, artifact), 0)
  assert.equal(getSolanaProgramWriteResumeOffset(artifact.slice(), artifact), artifact.length)
  const partial = artifact.slice()
  partial[1_337] ^= 1
  assert.equal(getSolanaProgramWriteResumeOffset(partial, artifact), 900, "resume must restart from the last complete loader chunk")

  process.stdout.write("Solana async worker recovery checks passed\n")
}

void main()
