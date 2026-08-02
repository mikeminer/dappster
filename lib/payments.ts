import type { Address } from "viem"

export const BASE_CHAIN_ID = 8453
export const USDC_DECIMALS = 6
export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address
export const BASE_PAYMENT_RECIPIENT = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134" as Address
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
export const SOLANA_PAYMENT_RECIPIENT = "GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W"
export const BASE_MEMBERSHIP_CONTRACT = process.env.NEXT_PUBLIC_BASE_MEMBERSHIP_CONTRACT as Address | undefined
export const SOLANA_MEMBERSHIP_PROGRAM = process.env.NEXT_PUBLIC_SOLANA_MEMBERSHIP_PROGRAM
export const SOLANA_CREDIT_MINT = process.env.NEXT_PUBLIC_SOLANA_CREDIT_MINT
export const SOLANA_MEMBERSHIP_MINT = process.env.NEXT_PUBLIC_SOLANA_MEMBERSHIP_MINT
export const SOLANA_TREASURY_USDC = process.env.NEXT_PUBLIC_SOLANA_TREASURY_USDC

export const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const

export const MEMBERSHIP_ABI = [
  {
    type: "function",
    name: "membershipPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "creditPackages",
    stateMutability: "view",
    inputs: [{ name: "packageId", type: "uint256" }],
    outputs: [
      { name: "price", type: "uint128" },
      { name: "credits", type: "uint128" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "setCreditPackage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "packageId", type: "uint256" },
      { name: "price", type: "uint128" },
      { name: "credits", type: "uint128" },
      { name: "enabled", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "buyCredits",
    stateMutability: "nonpayable",
    inputs: [{ name: "packageId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyMembership",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "burnOwnCredits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "usageId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "CreditsPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "packageId", type: "uint256", indexed: true },
      { name: "credits", type: "uint256", indexed: false },
      { name: "usdcPaid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MembershipPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "usdcPaid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CreditsConsumed",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "credits", type: "uint256", indexed: false },
      { name: "usageId", type: "bytes32", indexed: true },
    ],
  },
] as const

export const packages = {
  starter: { credits: 50, amount: 5, plan: null, label: "Just Check plan" },
  builder: { credits: 300, amount: 25, plan: null, label: "Builder credits" },
  pro: { credits: 800, amount: 55, plan: null, label: "Pro credits" },
  unlimited: { credits: 0, amount: 39, plan: "pro", label: "Pro · 30 days" },
} as const

export type PackageId = keyof typeof packages

export function packageContractId(packageId: PackageId) {
  if (packageId === "starter") return BigInt(1)
  if (packageId === "builder") return BigInt(2)
  if (packageId === "pro") return BigInt(3)
  return null
}
