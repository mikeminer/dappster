import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { supabaseRequest } from "@/lib/supabase"
import type { AssetVisibility } from "@/lib/marketplace"

const schema = z.object({ dappId: z.string().uuid() })

type DeployableDapp = {
  id: string
  owner_id: string
  name: string
  description: string | null
  chain: "evm" | "solana"
  contract_code: string | null
  frontend_code: string | null
  tags: string[] | null
  deploy_visibility: AssetVisibility
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo) throw new Error("Sign in to Dappster before using Fast Deploy")
    const input = schema.parse(await request.json())
    const dapp = (await supabaseRequest<DeployableDapp[]>({
      path: "dapps",
      query: {
        id: `eq.${input.dappId}`,
        is_listed: "eq.true",
        select: "id,owner_id,name,description,chain,contract_code,frontend_code,tags,deploy_visibility",
        limit: "1",
      },
    }))[0]
    if (!dapp?.contract_code || !dapp.frontend_code) throw new Error("This dApp does not contain a complete deployable project")

    if (dapp.owner_id !== user.id) {
      if (dapp.deploy_visibility === "private") throw new Error("Fast Deploy is private for this dApp")
      if (dapp.deploy_visibility === "paid") {
        const purchase = await supabaseRequest<{ id: string }[]>({
          path: "marketplace_purchases",
          query: { buyer_id: `eq.${user.id}`, dapp_id: `eq.${dapp.id}`, asset_type: "eq.deploy", select: "id", limit: "1" },
        })
        if (!purchase[0]) throw new Error("Purchase Fast Deploy access before creating a deployment copy")
      }
    }

    const cloneName = `${dapp.name} Copy`.slice(0, 80)
    const clone = (await supabaseRequest<{ id: string }[]>({
      path: "dapps",
      method: "POST",
      body: {
        owner_id: user.id,
        source_dapp_id: dapp.id,
        name: cloneName,
        description: dapp.description || `Fast Deploy copy of ${dapp.name}`,
        chain: dapp.chain,
        contract_code: dapp.contract_code,
        frontend_code: dapp.frontend_code,
        tags: dapp.tags || [],
        audit_status: "none",
        deploy_status: "draft",
        is_listed: false,
        is_featured: false,
      },
    }))[0]
    if (!clone?.id) throw new Error("Could not create the deployment copy")
    return NextResponse.json({ ok: true, cloneId: clone.id, chain: dapp.chain, redirect: `/build?project=${clone.id}&fastDeploy=1` })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare Fast Deploy" }, { status: 400 })
  }
}
