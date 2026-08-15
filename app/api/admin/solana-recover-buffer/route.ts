import bs58 from "bs58"
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import { accountHasWallet } from "@/lib/accounts"
import { getRequestUser } from "@/lib/runtime"

export const runtime = "nodejs"
export const maxDuration = 60

const OWNER = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134"
const BUFFER = new PublicKey("7NdJokUv8cNckn1Kokza3ZrXjXpZsuprX9DPjCgNZ3f6")
const DESTINATION = new PublicKey("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W")
const EXPECTED_AUTHORITY = "DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo"
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")

function technicalSigner() {
  const encoded = process.env.SOLANA_DEPLOYER_KEYPAIR
  if (!encoded) throw new Error("The Solana technical deployer is not configured")
  const secret = encoded.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(encoded) as number[])
    : bs58.decode(encoded.trim())
  const signer = Keypair.fromSecretKey(secret)
  if (signer.publicKey.toBase58() !== EXPECTED_AUTHORITY) {
    throw new Error("The configured signer is not the expected technical deployer")
  }
  return signer
}

function hasOneTimeRecoveryAuthorization(request: Request) {
  const expected = process.env.SOLANA_RECOVERY_TOKEN
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!expected || !provided) return false
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

export async function POST(request: Request) {
  try {
    if (!hasOneTimeRecoveryAuthorization(request)) {
      const user = await getRequestUser(request)
      if (user.isDemo || !await accountHasWallet(user.id, "evm", OWNER)) {
        return NextResponse.json({ error: "Owner authorization required" }, { status: 403 })
      }
    }

    const signer = technicalSigner()
    const rpc =
      process.env.SOLANA_MAINNET_RPC_URL ||
      process.env.SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com"
    const connection = new Connection(rpc, "confirmed")
    const account = await connection.getAccountInfo(BUFFER, "confirmed")
    if (!account) {
      return NextResponse.json({
        alreadyClosed: true,
        buffer: BUFFER.toBase58(),
        destination: DESTINATION.toBase58(),
      })
    }
    if (!account.owner.equals(UPGRADEABLE_LOADER)) throw new Error("Target is not loader-owned")
    if (account.data.readUInt32LE(0) !== 1 || account.data[4] !== 1) {
      throw new Error("Target is not an initialized deployment buffer")
    }
    const authority = new PublicKey(account.data.subarray(5, 37))
    if (!authority.equals(signer.publicKey)) throw new Error("Technical deployer is not the buffer authority")

    const closeInstruction = new TransactionInstruction({
      programId: UPGRADEABLE_LOADER,
      keys: [
        { pubkey: BUFFER, isSigner: false, isWritable: true },
        { pubkey: DESTINATION, isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([5, 0, 0, 0]),
    })
    const simulationTransaction = new Transaction().add(closeInstruction)
    simulationTransaction.feePayer = signer.publicKey
    simulationTransaction.recentBlockhash = (
      await connection.getLatestBlockhash("confirmed")
    ).blockhash
    simulationTransaction.sign(signer)
    const simulation = await connection.simulateTransaction(simulationTransaction)
    if (simulation.value.err) {
      throw new Error(`Close simulation failed: ${JSON.stringify(simulation.value.err)}`)
    }

    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(closeInstruction),
      [signer],
      { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 8 },
    )
    const closed = await connection.getAccountInfo(BUFFER, "confirmed")
    return NextResponse.json({
      signature,
      closed: closed === null,
      recoveredLamports: account.lamports,
      recoveredSOL: account.lamports / 1_000_000_000,
      buffer: BUFFER.toBase58(),
      destination: DESTINATION.toBase58(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buffer recovery failed"
    return NextResponse.json(
      { error: message },
      { status: /Authentication|session/i.test(message) ? 401 : 500 },
    )
  }
}
