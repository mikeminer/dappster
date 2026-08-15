import { createHash, timingSafeEqual } from "crypto"
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import bs58 from "bs58"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

const AUTH_HASH = "ee3e22d80e39557f41978c8b52a22098dd1124634af36fef1d424c8e0476d996"
const EXPECTED_SOURCE = new PublicKey("DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo")
const RECOVERY_DESTINATION = new PublicKey("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W")

function authorized(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const suppliedHash = createHash("sha256").update(supplied).digest()
  const expectedHash = Buffer.from(AUTH_HASH, "hex")
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash)
}

function technicalDeployer() {
  const encoded = process.env.SOLANA_DEPLOYER_KEYPAIR || process.env.SOLANA_CREDIT_CONSUMER_KEYPAIR
  if (!encoded) throw new Error("Solana technical deployer is not configured")
  const secret = encoded.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(encoded) as number[])
    : bs58.decode(encoded.trim())
  const keypair = Keypair.fromSecretKey(secret)
  if (!keypair.publicKey.equals(EXPECTED_SOURCE)) throw new Error("Unexpected Solana technical deployer")
  return keypair
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const payer = technicalDeployer()
    const endpoint = process.env.SOLANA_MAINNET_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
    const connection = new Connection(endpoint, { commitment: "confirmed", confirmTransactionInitialTimeout: 60_000 })
    const balance = await connection.getBalance(payer.publicKey, "confirmed")
    const feeProbe = new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: RECOVERY_DESTINATION,
      lamports: 1,
    }))
    feeProbe.feePayer = payer.publicKey
    feeProbe.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash
    const fee = (await connection.getFeeForMessage(feeProbe.compileMessage(), "confirmed")).value
    if (fee == null || balance <= fee) throw new Error("Technical deployer has no recoverable SOL")

    const recoveredLamports = balance - fee
    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: RECOVERY_DESTINATION,
        lamports: recoveredLamports,
      })),
      [payer],
      { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 10 },
    )
    return NextResponse.json({
      ok: true,
      signature,
      source: payer.publicKey.toBase58(),
      destination: RECOVERY_DESTINATION.toBase58(),
      recoveredLamports,
      feeLamports: fee,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Solana recovery failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
