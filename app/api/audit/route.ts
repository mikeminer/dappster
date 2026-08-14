import { NextResponse } from "next/server"
import { z } from "zod"
import { callAI } from "@/lib/ai"
import { CREDIT_COSTS, getCredits, hasActivePro } from "@/lib/credits"
import { creditBurnProofSchema, verifyAndSpendCreditBurn } from "@/lib/credit-burn"
import { getRequestUser } from "@/lib/runtime"
import { localCredits, localSaveAudit, localSpend, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { CHAIN_IDS } from "@/lib/chain-adapters"
import { getSolanaTesterEntitlement } from "@/lib/pasta-developer-tier"
import { getEvmTesterEntitlement } from "@/lib/pappardelle-tester-tier"

const requestSchema = z.object({ dappId: z.string().uuid().optional(), contractCode: z.string().min(30).max(120000), chain: z.enum(CHAIN_IDS), tier: z.enum(["basic", "premium"]).default("premium"), creditBurn: creditBurnProofSchema.optional() })

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = requestSchema.parse(await request.json())
    if (input.dappId && !user.isDemo) {
      const rows = await supabaseRequest<{ contract_code: string; chain: typeof input.chain }[]>({ path: "dapps", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "contract_code,chain", limit: "1" } })
      if (!rows[0]?.contract_code) throw new Error("The deployed dApp source was not found")
      input.contractCode = rows[0].contract_code
      input.chain = rows[0].chain
    }
    const cost = input.tier === "basic" ? CREDIT_COSTS.audit_basic : CREDIT_COSTS.audit_premium
    const profile = user.isDemo ? { credits: localCredits(user.id), plan: "free" } : await getCredits(user.id)
    const activePro = hasActivePro(profile)
    const solanaTester = !user.isDemo && input.chain === "solana" ? await getSolanaTesterEntitlement(user.id) : null
    const evmTester = !user.isDemo && input.chain === "evm" ? await getEvmTesterEntitlement(user.id) : null
    const testerAccessMode = solanaTester?.eligible ? "solana-tester" : evmTester?.eligible ? "evm-tester" : null
    const unlimitedAudits = activePro || Boolean(testerAccessMode)
    if (!unlimitedAudits && profile.credits < cost && !input.creditBurn) throw new Error(`You need ${cost} credits for this action`)
    const creditsRemaining = unlimitedAudits ? profile.credits
      : user.isDemo ? localSpend(user.id, cost)
        : await verifyAndSpendCreditBurn(user.id, cost, `${input.tier} security audit`, input.creditBurn)
    const report = await callAI("audit", input.contractCode, input.chain)
    const auditId = user.isDemo
      ? localSaveAudit(user.id, input.dappId, report)
      : (await supabaseRequest<{ id: string }[]>({ path: "audits", method: "POST", body: { dapp_id: input.dappId || null, owner_id: user.id, contract_code: input.contractCode, chain: input.chain, report, severity_counts: report.severity_counts, status: "completed", credits_used: unlimitedAudits ? 0 : cost } }))[0]?.id
    if (input.dappId) {
      if (user.isDemo) localUpdateDapp(input.dappId, { audit_status: "completed" })
      else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { audit_status: "completed" } })
    }
    return NextResponse.json({ auditId, report, creditsRemaining, accessMode: testerAccessMode || (activePro ? "pro" : "credits"), mode: user.isDemo ? "local" : "supabase", disclaimer: "This AI audit is not a replacement for a professional human security audit. Always review code manually before deploying to mainnet." })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the audit"
    const status = message.includes("Authentication") || message.includes("session") ? 401 : message.includes("credits") ? 402 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
