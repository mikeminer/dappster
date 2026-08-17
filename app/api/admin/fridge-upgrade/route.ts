import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { accountHasWallet } from "@/lib/accounts"
import { getRequestUser } from "@/lib/runtime"
import { compileSolanaProgram } from "@/lib/solana-program-deploy"
import {
  FRIDGE_PROGRAM,
  FRIDGE_UPGRADE_AUTHORITY,
  prepareFridgeProgramUpgrade,
  quoteFridgeProgramUpgrade,
} from "@/lib/solana-program-upgrade"

export const runtime = "nodejs"
export const maxDuration = 800

const OWNER_EVM = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134"
const inputSchema = z.object({
  action: z.enum(["quote", "prepare"]),
  wallet: z.string().min(32).max(64),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = inputSchema.parse(await request.json())
    if (user.isDemo
      || !await accountHasWallet(user.id, "evm", OWNER_EVM)
      || input.wallet !== FRIDGE_UPGRADE_AUTHORITY.toBase58()
      || !await accountHasWallet(user.id, "solana", input.wallet)) {
      return NextResponse.json({ error: "Owner authorization required" }, { status: 403 })
    }

    const source = fs.readFileSync(
      path.join(process.cwd(), "contracts", "fridge-token-interface-upgrade.rs"),
      "utf8",
    )
    const built = await compileSolanaProgram(source, FRIDGE_PROGRAM.toBase58())
    const artifactHash = createHash("sha256").update(built.artifact).digest("hex")
    const result = input.action === "prepare"
      ? await prepareFridgeProgramUpgrade(built.artifact)
      : await quoteFridgeProgramUpgrade(built.artifact)
    return NextResponse.json({ ...result, artifactHash })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fridge upgrade preparation failed"
    return NextResponse.json(
      { error: message },
      { status: /Authentication|session/i.test(message) ? 401 : 500 },
    )
  }
}
