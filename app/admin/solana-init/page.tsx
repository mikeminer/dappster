"use client"

import { useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token"
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js"
import { Buffer } from "buffer"

const PROGRAM = new PublicKey("6V49oFA2fMspFukL2dCCDyhyRoHVMjzWtPDfmFjCLvZZ")
const OWNER = new PublicKey("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W")
const CONSUMER = new PublicKey("DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo")
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
const TREASURY_USDC = new PublicKey("A8hnWYB1xPFKH9NUTaJTJ56876LhC88Nq67rGRSxBVX6")
const CREDIT_MINT = new PublicKey("DBZrQ2U5DT4KiMCTPBYfbLNqU9xEfjjdHrWtXAVP1Zfn")
const MEMBERSHIP_MINT = new PublicKey("2qtpXEaoUxFuh9SLuaUmJUaXiLkcw5w22pd3afMQjL8k")

async function discriminator(name: string) {
  return Buffer.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`))).slice(0, 8))
}

function u64(value: number) {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes
}

export default function SolanaInitializePage() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [status, setStatus] = useState("Ready")
  const [signature, setSignature] = useState("")

  async function initialize() {
    try {
      setStatus("Connecting Phantom…")
      const phantom = wallet.wallets.find(candidate => candidate.adapter.name === "Phantom")
      if (!phantom) throw new Error("Phantom is not available in this browser")
      if (!phantom.adapter.connected) await phantom.adapter.connect()
      const owner = phantom.adapter.publicKey
      if (!owner || !owner.equals(OWNER)) throw new Error(`Connect the owner wallet ${OWNER.toBase58()}`)

      const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM)
      const alreadyInitialized = Boolean(await connection.getAccountInfo(config))

      const transaction = new Transaction()
      if (!alreadyInitialized) transaction.add(new TransactionInstruction({
        programId: PROGRAM,
        data: Buffer.concat([await discriminator("initialize"), CONSUMER.toBuffer(), u64(39_000_000)]),
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: true },
          { pubkey: USDC, isSigner: false, isWritable: false },
          { pubkey: TREASURY_USDC, isSigner: false, isWritable: false },
          { pubkey: CREDIT_MINT, isSigner: false, isWritable: false },
          { pubkey: MEMBERSHIP_MINT, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
      }))

      for (const [id, price, credits] of [[1, 5_000_000, 50], [2, 25_000_000, 300], [3, 55_000_000, 800]] as const) {
        const [packageAccount] = PublicKey.findProgramAddressSync([Buffer.from("package"), Buffer.from([id])], PROGRAM)
        transaction.add(new TransactionInstruction({
          programId: PROGRAM,
          data: Buffer.concat([await discriminator("set_package"), Buffer.from([id]), u64(price), u64(credits), Buffer.from([1])]),
          keys: [
            { pubkey: config, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: packageAccount, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
        }))
      }

      setStatus("Confirm the single initialization transaction in Phantom…")
      const txSignature = await phantom.adapter.sendTransaction(transaction, connection)
      setSignature(txSignature)
      setStatus("Confirming on Solana…")
      const confirmation = await connection.confirmTransaction(txSignature, "confirmed")
      if (confirmation.value.err) throw new Error("The transaction was rejected on-chain")
      setStatus(alreadyInitialized ? "Packages updated on-chain. Just Check is now 5 USDC for 50 credits." : "Dappster membership is initialized and packages are configured.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Initialization failed")
    }
  }

  return <section className="section"><div className="container" style={{maxWidth:760}}><div className="section-heading"><span className="eyebrow">Owner setup</span><h1>Initialize Solana membership</h1><p>One owner-signed transaction creates the production configuration and all three credit packages.</p></div><div className="panel form-stack"><div className="mono" style={{fontSize:12,lineHeight:1.8}}>Program: {PROGRAM.toBase58()}<br/>Owner: {OWNER.toBase58()}<br/>Credit mint: {CREDIT_MINT.toBase58()}<br/>Membership mint: {MEMBERSHIP_MINT.toBase58()}</div><button className="btn btn-primary btn-block" onClick={initialize}>Connect Phantom & initialize</button><p className="muted">{status}</p>{signature && <a href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noreferrer" className="mono">View transaction</a>}</div></div></section>
}
