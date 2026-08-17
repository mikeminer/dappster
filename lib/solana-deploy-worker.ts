import { createHash } from "crypto"
import { PublicKey } from "@solana/web3.js"
import { localGetDapp, localUpdateDapp } from "./local-store"
import { completeSolanaDeployJob, releaseSolanaDeployJob, replaceSolanaDeployJobProgramId, type SolanaDeployJob } from "./solana-deploy-jobs"
import { verifySolanaProgramDeployment } from "./solana-deployment"
import { compileSolanaProgram, createSolanaProgramKeypair, deployCompiledSolanaProgram, selectSolanaProgramForDeployment } from "./solana-program-deploy"
import { hydrateDappSources } from "./source-storage"
import { supabaseRequest } from "./supabase"
import { injectCompiledSolanaIdl } from "./solana-frontend"

export async function processClaimedSolanaDeployJob(job: SolanaDeployJob, workerToken: string, isDemo: boolean) {
  try {
    const localDapp = isDemo ? localGetDapp(job.dapp_id) : undefined
    const rows = isDemo ? [] : await supabaseRequest<{ contract_code: string | null; frontend_code: string | null; contract_address: string | null; source_bundle_path: string | null; source_bundle_hash: string | null }[]>({
      path: "dapps",
      query: { id: `eq.${job.dapp_id}`, owner_id: `eq.${job.owner_id}`, select: "contract_code,frontend_code,contract_address,source_bundle_path,source_bundle_hash", limit: "1" },
    })
    const storedDapp = rows[0] ? await hydrateDappSources(rows[0]) : undefined
    const dapp = localDapp || storedDapp
    if (!dapp?.contract_code) throw new Error("Codice del programma Solana non trovato per il job")
    const sourceHash = createHash("sha256").update(dapp.contract_code).digest("hex")
    if (sourceHash !== job.source_hash) throw new Error("Il sorgente è cambiato dopo il finanziamento del deploy")

    if (dapp.contract_address) {
      if (dapp.contract_address !== job.program_id) throw new Error("La dApp è già associata a un altro Program ID")
      await verifySolanaProgramDeployment({ programId: job.program_id, cluster: job.cluster })
      await completeSolanaDeployJob(job.id, workerToken, job.program_id, isDemo)
      return { programId: job.program_id, payer: job.payer_address, byteLength: job.byte_length }
    }

    if (localDapp) localUpdateDapp(job.dapp_id, { deploy_status: "deploying" })
    else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${job.dapp_id}`, owner_id: `eq.${job.owner_id}` }, body: { deploy_status: "deploying", updated_at: new Date().toISOString() } })

    const seedMaterial = `${job.dapp_id}:${job.cluster}:${job.wallet_address}:${sourceHash}`
    const primaryProgram = createSolanaProgramKeypair(seedMaterial)
    const recoveryProgram = createSolanaProgramKeypair(`${seedMaterial}:upgradeable-loader-v3`)
    if (job.program_id !== primaryProgram.publicKey.toBase58() && job.program_id !== recoveryProgram.publicKey.toBase58()) {
      throw new Error("The deployment job Program ID does not match its source")
    }
    const program = job.program_id === recoveryProgram.publicKey.toBase58()
      ? recoveryProgram
      : await selectSolanaProgramForDeployment(primaryProgram, recoveryProgram, job.cluster)
    const built = await compileSolanaProgram(dapp.contract_code, program.publicKey.toBase58())
    if (built.byteLength !== job.byte_length) throw new Error("L'artifact compilato non corrisponde al preventivo finanziato")
    // Funding was already verified against the quote stored on the job. Do not
    // invalidate an existing payment when the deploy implementation changes.
    if (!job.funded_lamports) throw new Error("Solana deployment funding was not verified")

    const deployed = await deployCompiledSolanaProgram(built.artifact, program, job.cluster, new PublicKey(job.wallet_address))
    if (deployed.programId !== job.program_id) {
      await replaceSolanaDeployJobProgramId({
        jobId: job.id,
        workerToken,
        previousProgramId: job.program_id,
        nextProgramId: deployed.programId,
      }, isDemo)
      job.program_id = deployed.programId
    }
    await verifySolanaProgramDeployment({ programId: deployed.programId, cluster: job.cluster })
    const deployedAt = new Date().toISOString()
    const frontendCode = dapp.frontend_code
      ? injectCompiledSolanaIdl(dapp.frontend_code, built.idl, deployed.programId)
      : undefined
    if (localDapp) localUpdateDapp(job.dapp_id, { contract_address: deployed.programId, contract_deployed_at: deployedAt, deploy_status: "draft", ...(frontendCode ? { frontend_code: frontendCode } : {}) })
    else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${job.dapp_id}`, owner_id: `eq.${job.owner_id}` }, body: { contract_address: deployed.programId, contract_deployed_at: deployedAt, deploy_status: "draft", ...(frontendCode ? { frontend_code: frontendCode } : {}), updated_at: deployedAt } })
    // Publish the completed job only after the compiler IDL and final Program
    // ID are durable. Otherwise the client can pin a frontend in the small
    // window between job confirmation and this database update.
    await completeSolanaDeployJob(job.id, workerToken, deployed.programId, isDemo)
    return { programId: deployed.programId, payer: deployed.payer, byteLength: built.byteLength }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deploy Solana non riuscito"
    await releaseSolanaDeployJob(job.id, workerToken, message, isDemo).catch(() => undefined)
    const localDapp = isDemo ? localGetDapp(job.dapp_id) : undefined
    if (localDapp) localUpdateDapp(job.dapp_id, { deploy_status: "failed" })
    else if (!isDemo) await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${job.dapp_id}`, owner_id: `eq.${job.owner_id}` }, body: { deploy_status: "failed", updated_at: new Date().toISOString() } }).catch(() => undefined)
    throw error
  }
}
