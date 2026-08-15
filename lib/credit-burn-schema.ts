import { z } from "zod"

export const creditBurnProofSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  usageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

// The client returns null when a server-authorized credit intent does not
// require an on-chain burn (for example Pro or a verified Tester tier).
// Normalize that wire value so authorization code has one "no proof" value.
export const optionalCreditBurnProofSchema = creditBurnProofSchema
  .nullish()
  .transform(proof => proof ?? undefined)

export type CreditBurnProofInput = z.infer<typeof creditBurnProofSchema>
