import { Buffer } from "buffer"
import * as anchor from "@coral-xyz/anchor"
import * as splToken from "@solana/spl-token"
import * as web3 from "@solana/web3.js"

const runtime = { Buffer, anchor, splToken, web3 }

Object.assign(window, web3, anchor, splToken)
Object.assign(window, {
  Buffer,
  anchor,
  web3,
  __DAPPSTER_SOLANA_RUNTIME__: runtime,
})
