import { createHash, randomBytes, randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { createOrGetSolanaDeployJob } from "@/lib/solana-deploy-jobs"
import { accountHasWallet } from "@/lib/accounts"
import { compileSolanaProgram, createSolanaProgramKeypair, quoteSolanaProgramDeployment, solanaDeployFundingMemo } from "@/lib/solana-program-deploy"
import { repairGeneratedContract } from "@/lib/ai"
import { enforceRateLimit } from "@/lib/rate-limit"
import { hydrateDappSources } from "@/lib/source-storage"
import { injectCompiledSolanaIdl } from "@/lib/solana-frontend"

export const runtime = "nodejs"
export const maxDuration = 300

const schema = z.object({
  dappId: z.string().uuid(),
  cluster: z.enum(["devnet", "mainnet-beta"]),
  wallet: z.string().min(32).max(44),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ chain: string; contract_code: string | null; frontend_code: string | null; contract_address: string | null; source_bundle_path: string | null; source_bundle_hash: string | null }[]>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "chain,contract_code,frontend_code,contract_address,source_bundle_path,source_bundle_hash", limit: "1" },
    })
    const dapp = localDapp || (rows[0] ? await hydrateDappSources(rows[0]) : undefined)
    if (!dapp || (localDapp && localDapp.owner_id !== user.id)) throw new Error("dApp non trovata")
    if (dapp.chain !== "solana" || !dapp.contract_code) throw new Error("Codice del programma Solana non trovato")
    if (dapp.contract_address) throw new Error("Il programma Solana è già stato distribuito")

    if (user.isDemo) {
      if (user.id !== `solana:${input.wallet}`) throw new Error("Collega lo stesso wallet Solana usato per accedere a Dappster")
    } else {
      if (!await accountHasWallet(user.id, "solana", input.wallet)) throw new Error("Link this Solana wallet to your Dappster account before deploying")
    }

    const sourceHash = createHash("sha256").update(dapp.contract_code).digest("hex")
    const program = createSolanaProgramKeypair(`${input.dappId}:${input.cluster}:${input.wallet}:${sourceHash}`)
    let built
    try {
      built = await compileSolanaProgram(dapp.contract_code, program.publicKey.toBase58())
    } catch (error) {
      const compilerError = error instanceof Error ? error.message : "Unknown Solana compilation error"
      const repairableSourceError = compilerError.includes("Compilazione del programma Solana non riuscita")
        || compilerError.includes("Generazione IDL Anchor non riuscita")
      if (!repairableSourceError) throw error
      await enforceRateLimit(`compile-repair:${user.id}:solana`, 3)
      const repairedSource = await repairGeneratedContract("solana", dapp.contract_code, compilerError)
      const repairedBuild = await compileSolanaProgram(repairedSource, program.publicKey.toBase58())
      const repairedFrontend = dapp.frontend_code
        ? injectCompiledSolanaIdl(dapp.frontend_code, repairedBuild.idl, program.publicKey.toBase58())
        : undefined
      if (user.isDemo) localUpdateDapp(input.dappId, { contract_code: repairedSource, ...(repairedFrontend ? { frontend_code: repairedFrontend } : {}) })
      else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { contract_code: repairedSource, ...(repairedFrontend ? { frontend_code: repairedFrontend } : {}), updated_at: new Date().toISOString() } })
      return NextResponse.json({ status: "repaired", repairedSource })
    }
    if (dapp.frontend_code) {
      const frontendCode = injectCompiledSolanaIdl(dapp.frontend_code, built.idl, program.publicKey.toBase58())
      if (user.isDemo) localUpdateDapp(input.dappId, { frontend_code: frontendCode })
      else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { frontend_code: frontendCode, updated_at: new Date().toISOString() } })
    }
    const quote = await quoteSolanaProgramDeployment(built.byteLength, input.cluster)
    const jobKey = createHash("sha256").update(`${input.dappId}:${input.cluster}:${input.wallet}:${sourceHash}`).digest("hex")
    const jobId = randomUUID()
    const memo = solanaDeployFundingMemo(jobId, randomBytes(12).toString("hex"))
    const job = await createOrGetSolanaDeployJob({
      id: jobId,
      job_key: jobKey,
      dapp_id: input.dappId,
      owner_id: user.id,
      cluster: input.cluster,
      wallet_address: input.wallet,
      payer_address: quote.payer,
      source_hash: sourceHash,
      program_id: program.publicKey.toBase58(),
      byte_length: built.byteLength,
      rent_lamports: quote.rentLamports,
      network_fee_lamports: quote.networkFeeLamports,
      required_lamports: quote.requiredLamports,
      funding_memo: memo,
    }, user.isDemo)
    return NextResponse.json({
      jobId: job.id,
      cluster: job.cluster,
      memo: job.funding_memo,
      payer: job.payer_address,
      programId: job.program_id,
      byteLength: job.byte_length,
      rentLamports: job.rent_lamports,
      networkFeeLamports: job.network_fee_lamports,
      requiredLamports: job.required_lamports,
      requiredSol: (job.required_lamports / 1_000_000_000).toFixed(9),
      fundingSignature: job.funding_signature,
      status: job.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preventivo deploy Solana non riuscito"
    console.error("[solana-quote]", message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
