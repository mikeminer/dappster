# Dappster technical overview

Version 1.0 - July 31, 2026  
Canonical domain: https://dappster.fun  
Security contact: dev@dappster.fun

## Executive summary

Dappster is an AI-assisted application builder that generates smart-contract source, frontend source, deployment instructions, and optional automated audit reports. Users can review and preview artifacts before deployment.

EVM, Sui, and Aptos deployments are non-custodial: the user's connected wallet signs and broadcasts the deployment transaction. Dappster never receives the wallet private key or seed phrase. Solana program deployment uses a disclosed, user-funded technical wallet only after a linked user wallet signs the funding transaction and a deployment-specific authorization; program upgrade authority is transferred to the user after deployment.

## Architecture

- Web application: Next.js and TypeScript hosted on Vercel; wagmi/viem and WalletConnect-compatible EVM connectors; Solana, Sui Wallet Standard, and Aptos Wallet Standard adapters.
- Generation and audit: server-side AI calls produce structured artifacts. Solidity is compiled with solc and a restricted OpenZeppelin-only import resolver. Solana and Move packages are built in isolated environments.
- Data and authorization: Supabase authentication, linked-wallet records, Postgres Row Level Security, owner-scoped records, and idempotent transaction synchronization.
- Publishing: verified frontends are packaged with chain and contract metadata, pinned through Pinata, and served from IPFS gateways.

## EVM deployment flow

1. The authenticated user selects a supported EVM network and requests a dApp.
2. Dappster generates and compiles the Solidity source and returns creation bytecode and ABI.
3. The exact contract-creation payload is simulated against the selected chain RPC and gas is estimated.
4. The user's connected wallet signs and submits the deployment transaction.
5. The backend verifies receipt success, deployed address, contract-creation form, exact 0.001 native-token value, fee recipient, and fee event.
6. Only after verification may the frontend be published to IPFS.

The required deployment value is exactly 0.001 of the selected chain's native gas token. The generated payable constructor forwards this amount atomically to `0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134` and emits `DappsterDeploymentFeePaid`. If forwarding fails, deployment reverts. Network gas is separate.

Supported EVM networks are Ethereum (1), Base (8453), ApeChain (33139), Monad (143), Arbitrum One (42161), OP Mainnet (10), Polygon PoS (137), Avalanche C-Chain (43114), BNB Smart Chain (56), Gnosis (100), Celo (42220), Scroll (534352), Linea (59144), ZKsync Era (324), Mantle (5000), Blast (81457), Mode (34443), Berachain (80094), Sonic (146), Fraxtal (252), Metis (1088), Robinhood Chain (4663), HyperEVM (999), Ethereum Sepolia (11155111), and Base Sepolia (84532).

## Solana deployment flow

1. Dappster compiles the generated Anchor program and calculates rent and deployment costs.
2. The linked user wallet signs funding to the disclosed technical wallet with a unique deployment-job memo.
3. The backend verifies cluster, sender, recipient, amount, memo, signature status, and a separate deployment authorization.
4. A job queue and cluster lock serialize deployment wallet usage.
5. The technical wallet deploys with Solana's Upgradeable Loader, verifies the executable account, and transfers upgrade authority to the user.
6. The frontend is published only after Program ID verification.

The technical wallet is not an EVM deployer and does not replace the user's wallet. Mainnet SOL required for rent and deployment comes from the requesting user. Funding references cannot be reused across jobs.

## Sui and Aptos Move deployment flow

1. Dappster parses an allowlisted Move source bundle and compiles it inside an immutable Vercel Sandbox snapshot containing a pinned official CLI.
2. Sui packages target testnet and Aptos packages target devnet. Production feature flags stay disabled until each compiler snapshot passes testnet QA.
3. The user's selected Wallet Standard wallet signs and pays gas directly; no technical wallet or custodial key participates.
4. The backend independently verifies transaction success, network, publisher account, package-publish operation, and resulting package identifier before storing deployment metadata.
5. The frontend is published only after that receipt verification succeeds.

## Payments and credits

Credit packages and memberships settle in Circle USDC on Base. The production membership contract is `0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae`. The backend synchronizes a purchase only after verifying the successful receipt and exact USDC Transfer event.

Credits are non-transferable ERC-1155 units. The normal product flow requires the linked wallet to sign `burnOwnCredits`. Unique usage IDs and database payment references prevent replay and duplicate synchronization.

## Security controls

- API payload schema validation, length limits, and allowlisted chains.
- Wallet-to-account linkage for payment, credit, and deployment actions.
- Receipt verification for chain, sender where applicable, recipient, amount, success, events, and deployed address.
- Postgres Row Level Security for profiles, private projects, audits, transaction history, and deployment jobs.
- Replay resistance using usage IDs, funding memos, job IDs, transaction references, and unique database constraints.
- Same-origin, bounded client-error telemetry that excludes wallet secrets.
- No request for or storage of end-user wallet seed phrases or private keys.

## Trust boundaries

AI-generated code can contain defects. Compilation, transaction simulation, and automated audit output do not replace an independent professional audit. Users can inspect source before deployment and should test high-value applications on a test network first. Wallet simulation and independent security providers remain additional protection layers.

## Public references

- Production: https://dappster.fun
- Technical overview: https://dappster.fun/technical-overview
- Marketplace: https://dappster.fun/explore
- Base membership contract: https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae
- Deployment fee recipient: https://basescan.org/address/0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134
- Security contact: dev@dappster.fun
