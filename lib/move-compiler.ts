import { createHash } from "crypto"
import { Sandbox } from "@vercel/sandbox"
import { parseMoveSourceBundle, type MoveChain } from "@/lib/move-source-bundle"

const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000

export type SuiMoveArtifact = {
  chain: "sui"
  network: "testnet"
  modules: string[]
  dependencies: string[]
  digest: string
}

export type AptosMoveArtifact = {
  chain: "aptos"
  network: "devnet"
  metadataBytes: string
  byteCode: string[]
}

export type MoveArtifact = SuiMoveArtifact | AptosMoveArtifact

function commandError(label: string, stdout: string, stderr: string) {
  const details = [stderr, stdout].filter(Boolean).join("\n").slice(-12_000)
  return new Error(`${label} failed${details ? `:\n${details}` : ""}`)
}

function parseLastJson<T>(value: string): T {
  const starts = Array.from(value.matchAll(/[\[{]/g)).map(match => match.index || 0).reverse()
  for (const start of starts) {
    try { return JSON.parse(value.slice(start)) as T } catch { /* try an earlier JSON boundary */ }
  }
  throw new Error("The Move compiler did not return a valid JSON artifact")
}

async function createCompilerSandbox(chain: MoveChain) {
  const snapshotId = chain === "sui" ? process.env.SUI_COMPILER_SNAPSHOT_ID : process.env.APTOS_COMPILER_SNAPSHOT_ID
  if (!snapshotId) {
    throw new Error(`${chain === "sui" ? "SUI_COMPILER_SNAPSHOT_ID" : "APTOS_COMPILER_SNAPSHOT_ID"} is not configured. Deployment stays disabled until the pinned compiler snapshot is available.`)
  }
  return Sandbox.create({ source: { type: "snapshot", snapshotId }, timeout: SANDBOX_TIMEOUT_MS, resources: { vcpus: 4 } })
}

function normalizeAptosHex(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-fA-F]+$/.test(value)) throw new Error(`Aptos compiler returned invalid ${label}`)
  return value.startsWith("0x") ? value : `0x${value}`
}

export async function compileMovePackage(input: { chain: MoveChain; source: string; publisher: string }) {
  const files = parseMoveSourceBundle(input.source, input.chain)
  const jobId = createHash("sha256").update(`${input.chain}:${input.publisher}:${input.source}`).digest("hex").slice(0, 24)
  const workspace = `/vercel/sandbox/jobs/${jobId}`
  const sandbox = await createCompilerSandbox(input.chain)
  try {
    const prepare = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", `${workspace}/sources`, `${workspace}/tests`] })
    if (prepare.exitCode !== 0) throw commandError("Move workspace preparation", await prepare.stdout(), await prepare.stderr())
    await sandbox.writeFiles(files.map(file => ({ path: `${workspace}/${file.path}`, content: file.content })))

    if (input.chain === "sui") {
      const build = await sandbox.runCommand({
        cmd: "sui",
        args: ["move", "build", "--dump-bytecode-as-base64", "--path", workspace],
        cwd: workspace,
        env: { HOME: "/vercel/sandbox", NO_COLOR: "1" },
      })
      const stdout = await build.stdout()
      const stderr = await build.stderr()
      if (build.exitCode !== 0) throw commandError("Sui Move compilation", stdout, stderr)
      const output = parseLastJson<{ modules?: unknown; dependencies?: unknown; digest?: unknown }>(stdout)
      if (!Array.isArray(output.modules) || !output.modules.length || !output.modules.every(value => typeof value === "string")) throw new Error("Sui compiler returned no publishable modules")
      if (!Array.isArray(output.dependencies) || !output.dependencies.every(value => typeof value === "string")) throw new Error("Sui compiler returned invalid dependencies")
      return {
        chain: "sui",
        network: "testnet",
        modules: output.modules as string[],
        dependencies: output.dependencies as string[],
        digest: Array.isArray(output.digest) ? Buffer.from(output.digest as number[]).toString("base64") : String(output.digest || ""),
      } satisfies SuiMoveArtifact
    }

    const outputPath = `${workspace}/publish-payload.json`
    const build = await sandbox.runCommand({
      cmd: "aptos",
      args: ["move", "build-publish-payload", "--json-output-file", outputPath, "--package-dir", workspace, "--named-addresses", `dappster_package=${input.publisher}`, "--assume-yes"],
      cwd: workspace,
      env: { HOME: "/vercel/sandbox", NO_COLOR: "1" },
    })
    const stdout = await build.stdout()
    const stderr = await build.stderr()
    if (build.exitCode !== 0) throw commandError("Aptos Move compilation", stdout, stderr)
    const payloadBuffer = await sandbox.readFileToBuffer({ path: outputPath })
    if (!payloadBuffer) throw new Error("Aptos compiler did not create the publish payload")
    const payload = JSON.parse(payloadBuffer.toString("utf8")) as { args?: Array<{ value?: unknown }> }
    const metadataBytes = normalizeAptosHex(payload.args?.[0]?.value, "package metadata")
    const byteCodeRaw = payload.args?.[1]?.value
    if (!Array.isArray(byteCodeRaw) || !byteCodeRaw.length) throw new Error("Aptos compiler returned no publishable modules")
    const byteCode = byteCodeRaw.map((value, index) => normalizeAptosHex(value, `module ${index + 1}`))
    return { chain: "aptos", network: "devnet", metadataBytes, byteCode } satisfies AptosMoveArtifact
  } finally {
    await sandbox.stop().catch(() => undefined)
  }
}
