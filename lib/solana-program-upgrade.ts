import { createHash } from "node:crypto"
import bs58 from "bs58"
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js"

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
const BUFFER_METADATA_BYTES = 37
const PROGRAMDATA_METADATA_BYTES = 45
const WRITE_CHUNK_BYTES = 900
const WRITE_BATCH_SIZE = 8
const FEE_RESERVE_LAMPORTS = 2_000_000
const RATE_LIMIT_RETRIES = 7
const WRITE_CONFIRM_TIMEOUT_MS = 75_000

export const FRIDGE_PROGRAM = new PublicKey("BQJxEcwnCLqeg4VDGHUeiCJAaAPHVuSMgP4F32bnQUXN")
export const FRIDGE_UPGRADE_AUTHORITY = new PublicKey("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W")

function technicalSigner() {
  const encoded = process.env.SOLANA_DEPLOYER_KEYPAIR
  if (!encoded) throw new Error("The Solana technical deployer is not configured")
  const secret = encoded.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(encoded) as number[])
    : bs58.decode(encoded.trim())
  return Keypair.fromSecretKey(secret)
}

function mainnetRpcUrl() {
  return process.env.SOLANA_MAINNET_RPC_URL
    || process.env.SOLANA_RPC_URL
    || "https://api.mainnet-beta.solana.com"
}

function instructionData(discriminator: number, size = 4) {
  const data = Buffer.alloc(size)
  data.writeUInt32LE(discriminator, 0)
  return data
}

function initializeBufferInstruction(buffer: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    data: instructionData(0),
  })
}

function writeBufferInstruction(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Uint8Array) {
  const data = instructionData(1, 16 + bytes.length)
  data.writeUInt32LE(offset, 4)
  data.writeBigUInt64LE(BigInt(bytes.length), 8)
  Buffer.from(bytes).copy(data, 16)
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  })
}

function setBufferAuthorityInstruction(buffer: PublicKey, currentAuthority: PublicKey, newAuthority: PublicKey) {
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
      { pubkey: newAuthority, isSigner: false, isWritable: false },
    ],
    data: instructionData(4),
  })
}

function upgradeInstruction(programData: PublicKey, buffer: PublicKey, spill: PublicKey) {
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: FRIDGE_PROGRAM, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: spill, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: FRIDGE_UPGRADE_AUTHORITY, isSigner: true, isWritable: false },
    ],
    data: instructionData(3),
  })
}

function extendProgramInstruction(programData: PublicKey, additionalBytes: number, payer: PublicKey) {
  const data = instructionData(6, 8)
  data.writeUInt32LE(additionalBytes, 4)
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: FRIDGE_PROGRAM, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
    ],
    data,
  })
}

function bufferAuthority(data: Buffer) {
  if (data.length < BUFFER_METADATA_BYTES || data.readUInt32LE(0) !== 1 || data[4] !== 1) return null
  return new PublicKey(data.subarray(5, 37))
}

function programDataAuthority(data: Buffer) {
  if (data.length < PROGRAMDATA_METADATA_BYTES || data.readUInt32LE(0) !== 3 || data[12] !== 1) return null
  return new PublicKey(data.subarray(13, 45))
}

function deterministicBuffer(artifact: Uint8Array) {
  const seed = createHash("sha256")
    .update("dappster-fridge-token-interface-upgrade-v1")
    .update(FRIDGE_PROGRAM.toBuffer())
    .update(artifact)
    .digest()
    .subarray(0, 32)
  return Keypair.fromSeed(seed)
}

async function retryRateLimit<T>(operation: () => Promise<T>, label: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/(?:\b429\b|too many requests|rate[ -]?limit)/i.test(message) || attempt >= RATE_LIMIT_RETRIES) {
        throw new Error(`${label} failed: ${message}`)
      }
      const delayMs = Math.min(15_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 250)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

async function writeBatch(
  connection: Connection,
  payer: Keypair,
  buffer: PublicKey,
  writes: Array<{ offset: number; bytes: Uint8Array }>,
) {
  const latest = await retryRateLimit(() => connection.getLatestBlockhash("confirmed"), "Upgrade write blockhash")
  const submitted: Array<{ offset: number; signature: string }> = []
  const publicRpc = mainnetRpcUrl().includes("solana.com")

  for (const write of writes) {
    const transaction = new Transaction({
      feePayer: payer.publicKey,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(writeBufferInstruction(buffer, payer.publicKey, write.offset, write.bytes))
    transaction.sign(payer)
    const signature = await retryRateLimit(
      () => connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 20 }),
      `Upgrade write at byte ${write.offset}`,
    )
    submitted.push({ offset: write.offset, signature })
    await new Promise(resolve => setTimeout(resolve, publicRpc ? 325 : 50))
  }

  const deadline = Date.now() + WRITE_CONFIRM_TIMEOUT_MS
  while (Date.now() < deadline) {
    const statuses = await retryRateLimit(
      () => connection.getSignatureStatuses(submitted.map(item => item.signature), { searchTransactionHistory: true }),
      `Upgrade write confirmation at byte ${writes[0]?.offset ?? 0}`,
    )
    let confirmed = 0
    for (let index = 0; index < submitted.length; index += 1) {
      const status = statuses.value[index]
      if (status?.err) throw new Error(`Upgrade write at byte ${submitted[index].offset} failed: ${JSON.stringify(status.err)}`)
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") confirmed += 1
    }
    if (confirmed === submitted.length) return
    if (await connection.getBlockHeight("confirmed") > latest.lastValidBlockHeight) {
      throw new Error(`Upgrade write batch at byte ${writes[0]?.offset ?? 0} expired`)
    }
    await new Promise(resolve => setTimeout(resolve, 750))
  }
  throw new Error(`Upgrade write batch at byte ${writes[0]?.offset ?? 0} was not confirmed in time`)
}

async function inspectUpgrade(artifact: Uint8Array) {
  const connection = new Connection(mainnetRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  })
  const payer = technicalSigner()
  const [programData] = PublicKey.findProgramAddressSync([FRIDGE_PROGRAM.toBuffer()], UPGRADEABLE_LOADER)
  const buffer = deterministicBuffer(artifact)
  const bufferSpace = BUFFER_METADATA_BYTES + artifact.length
  const [program, programDataAccount, existingBuffer, bufferRentLamports, technicalBalanceLamports] = await Promise.all([
    connection.getAccountInfo(FRIDGE_PROGRAM, "confirmed"),
    connection.getAccountInfo(programData, "confirmed"),
    connection.getAccountInfo(buffer.publicKey, "confirmed"),
    connection.getMinimumBalanceForRentExemption(bufferSpace, "confirmed"),
    connection.getBalance(payer.publicKey, "confirmed"),
  ])
  if (!program?.executable || !program.owner.equals(UPGRADEABLE_LOADER)) throw new Error("The Fridge program is not upgradeable")
  if (!programDataAccount) throw new Error("The Fridge ProgramData account was not found")
  const authority = programDataAuthority(Buffer.from(programDataAccount.data))
  if (!authority?.equals(FRIDGE_UPGRADE_AUTHORITY)) throw new Error("The connected owner is not the current Fridge upgrade authority")
  const maxProgramBytes = programDataAccount.data.length - PROGRAMDATA_METADATA_BYTES
  const extensionBytes = artifact.length > maxProgramBytes
    ? Math.max(10_240, artifact.length - maxProgramBytes)
    : 0
  const extendedProgramDataRent = extensionBytes > 0
    ? await connection.getMinimumBalanceForRentExemption(programDataAccount.data.length + extensionBytes, "confirmed")
    : programDataAccount.lamports
  const extensionRentLamports = Math.max(0, extendedProgramDataRent - programDataAccount.lamports)
  if (existingBuffer && (!existingBuffer.owner.equals(UPGRADEABLE_LOADER) || existingBuffer.data.length !== bufferSpace)) {
    throw new Error("The deterministic Fridge upgrade buffer has an unexpected owner or size")
  }
  const currentBufferAuthority = existingBuffer ? bufferAuthority(Buffer.from(existingBuffer.data)) : null
  if (existingBuffer && !currentBufferAuthority) throw new Error("The Fridge upgrade buffer has no authority")
  if (currentBufferAuthority
    && !currentBufferAuthority.equals(payer.publicKey)
    && !currentBufferAuthority.equals(FRIDGE_UPGRADE_AUTHORITY)) {
    throw new Error("The Fridge upgrade buffer belongs to an unexpected authority")
  }
  const bufferAlreadyOwnedByUser = Boolean(currentBufferAuthority?.equals(FRIDGE_UPGRADE_AUTHORITY))
  const requiredLamports = bufferAlreadyOwnedByUser
    ? 0
    : (existingBuffer ? 0 : bufferRentLamports) + FEE_RESERVE_LAMPORTS
  return {
    connection,
    payer,
    programData,
    programDataAccount,
    buffer,
    existingBuffer,
    currentBufferAuthority,
    bufferRentLamports,
    technicalBalanceLamports,
    requiredLamports,
    fundingRequiredLamports: Math.max(0, requiredLamports - technicalBalanceLamports),
    maxProgramBytes,
    extensionBytes,
    extensionRentLamports,
  }
}

export async function quoteFridgeProgramUpgrade(artifact: Uint8Array) {
  const state = await inspectUpgrade(artifact)
  return {
    cluster: "mainnet" as const,
    programId: FRIDGE_PROGRAM.toBase58(),
    programData: state.programData.toBase58(),
    upgradeAuthority: FRIDGE_UPGRADE_AUTHORITY.toBase58(),
    technicalWallet: state.payer.publicKey.toBase58(),
    buffer: state.buffer.publicKey.toBase58(),
    artifactBytes: artifact.length,
    maxProgramBytes: state.maxProgramBytes,
    extensionBytes: state.extensionBytes,
    extensionRentLamports: state.extensionRentLamports,
    bufferRentLamports: state.bufferRentLamports,
    technicalBalanceLamports: state.technicalBalanceLamports,
    fundingRequiredLamports: state.fundingRequiredLamports,
    bufferReady: Boolean(state.currentBufferAuthority?.equals(FRIDGE_UPGRADE_AUTHORITY)),
  }
}

export async function prepareFridgeProgramUpgrade(artifact: Uint8Array) {
  const state = await inspectUpgrade(artifact)
  if (state.fundingRequiredLamports > 0) {
    return { ...(await quoteFridgeProgramUpgrade(artifact)), transaction: null }
  }

  if (!state.existingBuffer) {
    await sendAndConfirmTransaction(
      state.connection,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: state.payer.publicKey,
          newAccountPubkey: state.buffer.publicKey,
          lamports: state.bufferRentLamports,
          space: BUFFER_METADATA_BYTES + artifact.length,
          programId: UPGRADEABLE_LOADER,
        }),
        initializeBufferInstruction(state.buffer.publicKey, state.payer.publicKey),
      ),
      [state.payer, state.buffer],
      { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 20 },
    )
  }

  if (!state.currentBufferAuthority?.equals(FRIDGE_UPGRADE_AUTHORITY)) {
    const account = state.existingBuffer || await state.connection.getAccountInfo(state.buffer.publicKey, "confirmed")
    const storedArtifact = account?.data.subarray(BUFFER_METADATA_BYTES)
    let resumeOffset = 0
    while (storedArtifact
      && resumeOffset < artifact.length
      && storedArtifact[resumeOffset] === artifact[resumeOffset]) resumeOffset += 1
    resumeOffset = Math.floor(resumeOffset / WRITE_CHUNK_BYTES) * WRITE_CHUNK_BYTES

    for (let batchOffset = resumeOffset; batchOffset < artifact.length; batchOffset += WRITE_CHUNK_BYTES * WRITE_BATCH_SIZE) {
      const writes: Array<{ offset: number; bytes: Uint8Array }> = []
      for (let index = 0; index < WRITE_BATCH_SIZE; index += 1) {
        const offset = batchOffset + index * WRITE_CHUNK_BYTES
        if (offset >= artifact.length) break
        writes.push({ offset, bytes: artifact.slice(offset, Math.min(offset + WRITE_CHUNK_BYTES, artifact.length)) })
      }
      await writeBatch(state.connection, state.payer, state.buffer.publicKey, writes)
    }

    await sendAndConfirmTransaction(
      state.connection,
      new Transaction().add(setBufferAuthorityInstruction(
        state.buffer.publicKey,
        state.payer.publicKey,
        FRIDGE_UPGRADE_AUTHORITY,
      )),
      [state.payer],
      { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 20 },
    )
  }

  const latest = await state.connection.getLatestBlockhash("confirmed")
  const transaction = new Transaction({
    feePayer: FRIDGE_UPGRADE_AUTHORITY,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  })
  if (state.extensionBytes > 0) {
    transaction.add(extendProgramInstruction(
      state.programData,
      state.extensionBytes,
      FRIDGE_UPGRADE_AUTHORITY,
    ))
  }
  transaction.add(upgradeInstruction(state.programData, state.buffer.publicKey, state.payer.publicKey))
  return {
    ...(await quoteFridgeProgramUpgrade(artifact)),
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }
}
