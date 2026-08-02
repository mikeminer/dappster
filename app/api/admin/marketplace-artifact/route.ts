import fs from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { compileSolidity } from "@/lib/solidity"
import { getRequestUser } from "@/lib/runtime"
import { accountHasWallet } from "@/lib/accounts"

export const runtime = "nodejs"

const OWNER = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134"

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo || !await accountHasWallet(user.id, "evm", OWNER)) {
      return NextResponse.json({ error: "Owner authorization required" }, { status: 403 })
    }
    const source = fs.readFileSync(path.join(process.cwd(), "contracts", "evm", "DappsterMarketplace.sol"), "utf8")
    return NextResponse.json(compileSolidity(source, "DappsterMarketplace"))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compilation failed"
    return NextResponse.json({ error: message }, { status: /Authentication|session/i.test(message) ? 401 : 500 })
  }
}
