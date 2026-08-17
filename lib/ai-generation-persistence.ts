import { compileSolidity } from "./solidity"
import { injectCompiledAbiIntoFrontend } from "./frontend-abi"
import { storeDappSourceBundle } from "./source-storage"
import { supabaseRequest } from "./supabase"
import type { AiGenerationJob, AiGenerationPayload } from "./ai-generation-jobs"

export async function persistAiGenerationResult(job: AiGenerationJob, generation: AiGenerationPayload) {
  const name = generation.contractName || generation.programName || "Untitled dApp"
  let frontend = generation.frontend

  if (job.chain === "evm") {
    try {
      const artifact = compileSolidity(generation.contract, name, { chainId: job.evm_chain_id || undefined })
      frontend = injectCompiledAbiIntoFrontend(frontend, artifact.abi)
    } catch {
      // Deployment repeats compilation and can repair Solidity. Preserve the
      // generated project even if compiler metadata is temporarily unavailable.
    }
  }

  let sourceMetadata: Record<string, unknown> = {
    contract_code: generation.contract,
    frontend_code: frontend,
  }
  try {
    const stored = await storeDappSourceBundle(job.owner_id, job.dapp_id, {
      contract: generation.contract,
      frontend,
      deployInstructions: generation.deployInstructions,
      warnings: generation.warnings,
    })
    sourceMetadata = {
      contract_code: null,
      frontend_code: null,
      source_bundle_path: stored.path,
      source_bundle_hash: stored.hash,
      source_bundle_bytes: stored.bytes,
      source_storage_version: 1,
    }
  } catch {
    // The database columns are the durable fallback when object storage is
    // unavailable; a later migration can move the sources into the private bucket.
  }

  await supabaseRequest({
    path: "dapps",
    method: "PATCH",
    query: { id: `eq.${job.dapp_id}`, owner_id: `eq.${job.owner_id}` },
    body: {
      name,
      description: job.prompt,
      ...sourceMetadata,
      deploy_status: "draft",
      updated_at: new Date().toISOString(),
    },
  })

  return { ...generation, name, frontend }
}
