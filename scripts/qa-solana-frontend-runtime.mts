import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  buildSolanaImportAliases,
  buildSolanaRuntimeCompatibilityScript,
  inferLegacySolanaIdl,
  injectCompiledSolanaIdl,
} from "../lib/solana-frontend.ts"

const runtime = buildSolanaRuntimeCompatibilityScript()

assert.doesNotThrow(() => new Function(runtime))
assert.match(runtime, /window\.__DAPPSTER_SOLANA_RUNTIME__/)
assert.match(runtime, /modules\.phantomWalletAdapter \|\| \{\}/)
assert.match(runtime, /Object\.assign\(window, modules\.web3, modules\.anchor, modules\.splToken/)
assert.match(runtime, /runtime\.preview && window\.PublicKey/)
assert.match(runtime, /Replaced an invalid Solana public key/)
assert.match(runtime, /11111111111111111111111111111111/)
assert.match(runtime, /window\.SolanaWeb3 = modules\.web3/)
assert.match(runtime, /window\.anchorWeb3 = modules\.web3/)
assert.match(runtime, /runtime\.web3 = modules\.web3/)
assert.match(runtime, /runtime\.anchor = modules\.anchor/)
assert.match(runtime, /runtime\.spl = modules\.splToken/)
assert.match(runtime, /runtime\.splToken = modules\.splToken/)
assert.match(runtime, /const previewProvider = \{/)
assert.match(runtime, /if \(!window\.phantom\.solana\) window\.phantom\.solana = previewProvider/)
assert.match(runtime, /if \(!window\.solana\) window\.solana = window\.phantom\.solana/)
assert.match(runtime, /Wallet signing is disabled in the isolated Dappster preview/)
assert.ok(
  runtime.indexOf("window.Buffer = modules.Buffer") < runtime.indexOf("Object.assign(window, modules.web3"),
  "Buffer must be available before the Phantom adapter module loads",
)

class MockPublicKey {
  value: string
  constructor(value: string) { this.value = value }
  toBase58() { return this.value }
}
const previewWindow: Record<string, any> = {
  __DAPPSTER__: { chain: "solana", preview: true },
  __DAPPSTER_SOLANA_RUNTIME__: {
    web3: { PublicKey: MockPublicKey },
    anchor: { web3: { PublicKey: MockPublicKey } },
    splToken: {},
    Buffer: Uint8Array,
    phantomWalletAdapter: {},
  },
}
new Function("window", runtime)(previewWindow)
await previewWindow.__DAPPSTER_SOLANA_READY__
assert.equal(previewWindow.phantom.solana.isPhantom, true)
assert.equal(previewWindow.__DAPPSTER__.web3, previewWindow.__DAPPSTER_SOLANA_RUNTIME__.web3)
assert.equal(previewWindow.__DAPPSTER__.anchor, previewWindow.__DAPPSTER_SOLANA_RUNTIME__.anchor)
assert.equal(previewWindow.__DAPPSTER__.spl, previewWindow.__DAPPSTER_SOLANA_RUNTIME__.splToken)
assert.equal(previewWindow.__DAPPSTER__.splToken, previewWindow.__DAPPSTER_SOLANA_RUNTIME__.splToken)
assert.equal(previewWindow.solana, previewWindow.phantom.solana)
assert.equal((await previewWindow.solana.connect()).publicKey.toBase58(), "11111111111111111111111111111111")
await assert.rejects(() => previewWindow.solana.signTransaction({}), /Wallet signing is disabled/)

const aliases = buildSolanaImportAliases(`
  import * as SolanaWeb3 from "@solana/web3.js"
  import { Connection as RpcConnection, PublicKey } from "@solana/web3.js"
  import Anchor, { web3 as anchorWeb3 } from "@coral-xyz/anchor"
  import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
`)
assert.match(aliases, /const SolanaWeb3 = window\.solanaWeb3;/)
assert.match(aliases, /const RpcConnection = window\.solanaWeb3\.Connection;/)
assert.match(aliases, /const PublicKey = window\.solanaWeb3\.PublicKey;/)
assert.match(aliases, /const Anchor = \(window\.anchor\.default \|\| window\.anchor\);/)
assert.match(aliases, /const anchorWeb3 = window\.anchor\.web3;/)
assert.match(aliases, /const PhantomWalletAdapter = window\.phantomWalletAdapter\.PhantomWalletAdapter;/)

const compiledIdl = {
  address: "11111111111111111111111111111111",
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0" },
  instructions: [],
}
const deployedProgramId = "BPFLoaderUpgradeab1e11111111111111111111111"
const normalizedLegacyProgram = injectCompiledSolanaIdl(`
  const prog = new anchor.Program(IDL, PROGRAM_ID, anchorProvider);
  const imported = new Program(idl, new PublicKey("11111111111111111111111111111111"), provider);
`, compiledIdl, deployedProgramId)
assert.match(
  normalizedLegacyProgram,
  /new anchor\.Program\(window\.__DAPPSTER__\.solanaIdl, anchorProvider\)/,
)
assert.match(
  normalizedLegacyProgram,
  /new Program\(window\.__DAPPSTER__\.solanaIdl, provider\)/,
)
assert.doesNotMatch(normalizedLegacyProgram, /new (?:anchor\.)?Program\([^;]+PROGRAM_ID/)

const normalizedModernProgram = injectCompiledSolanaIdl(
  "const prog = new anchor.Program(IDL, anchorProvider);",
  compiledIdl,
  deployedProgramId,
)
assert.match(
  normalizedModernProgram,
  /new anchor\.Program\(window\.__DAPPSTER__\.solanaIdl, anchorProvider\)/,
)

const normalizedPublishedProgram = injectCompiledSolanaIdl(`
  const provider = window.phantom.solana;
  await provider.connect();
  const anchorProvider = new AnchorProvider(
    connection,
    { publicKey: new PublicKey(await provider.request({ method: 'getAccountInfo' })) },
    { commitment: 'confirmed' },
  );
  const programInstance = new Program(
    window.__DAPPSTER__.solanaIdl,
    new PublicKey(CONTRACT_ADDRESS),
  );
`, compiledIdl, deployedProgramId)
assert.doesNotMatch(normalizedPublishedProgram, /getAccountInfo/)
assert.match(normalizedPublishedProgram, /publicKey: provider\.publicKey/)
assert.match(normalizedPublishedProgram, /signTransaction: provider\.signTransaction\.bind\(provider\)/)
assert.match(normalizedPublishedProgram, /signAllTransactions: provider\.signAllTransactions\.bind\(provider\)/)
assert.match(
  normalizedPublishedProgram,
  /new Program\(window\.__DAPPSTER__\.solanaIdl, anchorProvider\)/,
)

const inferredMinterIdl = inferLegacySolanaIdl(`
  const [name, setName] = useState('');
  const [symbol, setSymbol] = React.useState("");
  const [uri, setUri] = useState('https://example.com/metadata.json');
  const [initialSupply, setInitialSupply] = useState('1000000000');
  const mintKeypair = Keypair.generate();
  const tx = await program.methods
    .initialize(
      name || 'Demo Token',
      symbol || 'DEMO',
      uri || 'https://example.com/metadata.json',
      new BN(initialSupply),
    )
    .accounts({ mint: mintKeypair.publicKey, authority: provider.publicKey, systemProgram: SystemProgram.programId })
    .signers([mintKeypair])
    .rpc();
`, deployedProgramId) as any
assert.deepEqual(
  inferredMinterIdl.instructions[0].args.map((argument: { type: string }) => argument.type),
  ["string", "string", "string", "u64"],
)
const inferredMintAccount = inferredMinterIdl.instructions[0].accounts.find(
  (account: { name: string }) => account.name === "mint",
)
assert.equal(inferredMintAccount?.writable, true)
assert.equal(inferredMintAccount?.signer, true)

const inferredPartialSignerIdl = inferLegacySolanaIdl(`
  const mintKeypair = Keypair.generate();
  const tx = await program.methods
    .initialize()
    .accounts({ mint: mintKeypair.publicKey, authority: provider.publicKey })
    .transaction();
  tx.partialSign(mintKeypair);
`, deployedProgramId) as any
const inferredPartialSignerAccount = inferredPartialSignerIdl.instructions[0].accounts.find(
  (account: { name: string }) => account.name === "mint",
)
assert.equal(inferredPartialSignerAccount?.signer, true)

const ipfsRoute = readFileSync(new URL("../app/ipfs/[cid]/route.ts", import.meta.url), "utf8")
assert.match(ipfsRoute, /injectCompiledSolanaIdl\(programIdSource, solanaIdl, embeddedRuntime\.contractAddress\)/)

console.log("Solana frontend runtime compatibility checks passed")
