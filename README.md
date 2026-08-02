# Dappster

AI-powered multi-chain dApp builder and public marketplace. Browser deployment is production-enabled for EVM and Solana. Sui testnet and Aptos devnet use non-custodial wallet deployment behind explicit compiler-snapshot capability gates; the remaining ecosystems currently support generation and preview.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and add service credentials.
3. Run `supabase/schema.sql` in a Supabase SQL editor.
4. Start the app: `npm run dev`

The marketing site and interactive product previews work without credentials. Authenticated API routes require Supabase; generation requires xAI; audits can use Anthropic or xAI; deployments require Pinata; Dappster credit and membership payments settle directly in USDC on Base.

## Architecture

- Next.js 15 App Router and TypeScript
- Supabase Web3 authentication, Postgres, RLS, and transactional credit RPCs
- xAI for multi-chain generation through `lib/ai.ts`
- Anthropic for premium security audits through the same routing layer
- Pinata IPFS deployment
- direct USDC payments on Base with transaction verification and idempotent plan activation

## Credit safety

AI routes check the balance before provider calls and only deduct after a successful provider response. The database performs the deduction and transaction insert atomically. Provider failures do not consume credits.

## Production notes

- Replace the in-memory rate limiter with a shared store such as Redis for multi-instance deployment.
- Frontend source returned by the model must be built in a sandboxed worker before production IPFS deployment. The included deploy adapter publishes an HTML shell and is intentionally kept isolated from server execution.
- Rotate secrets if they have ever been exposed, and configure Supabase Web3 auth domains before launch.
- Sui/Aptos deployment must remain disabled until immutable Vercel Sandbox snapshots containing pinned official CLIs have passed testnet QA. Configure the snapshot IDs and corresponding public capability flags from `.env.example` only after that validation.
