import { createHash } from "node:crypto"

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"

function base32Encode(bytes: Uint8Array) {
  let output = ""
  let buffer = 0
  let bits = 0

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(buffer >>> bits) & 31]
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}

/** CIDv1 using the raw codec and sha2-256, which is what Pinata returns for a single uploaded file. */
export function rawCidV1ForText(content: string) {
  const digest = createHash("sha256").update(content, "utf8").digest()
  const cidBytes = Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest])
  return `b${base32Encode(cidBytes)}`
}
