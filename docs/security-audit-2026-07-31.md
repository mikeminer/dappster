# Dappster Security Audit and Non-Destructive Penetration Test

Date: 2026-07-31  
Target: `https://dappster.fun` and the local Dappster source tree  
Method: authenticated-code review plus unauthenticated, non-destructive production probes

Production release verified: `dpl_CqcsAihZLiPf6fiQsfRQL9C7CMnJ` (`READY`), built without the Vercel build cache and aliased to `dappster.fun`.

## Executive summary

The review found one high-impact application authorization defect and several dependency, isolation, and resource-exhaustion weaknesses. The authorization defect and all confirmed production-facing findings were remediated and deployed during the assessment.

No unauthenticated access to private API operations was obtained. Production rejected administrative artifact access without a session, rejected state-changing API calls without authentication, did not reflect an attacker-controlled CORS origin, rejected TRACE, and served generated IPFS applications under a CSP sandbox.

This assessment is not a guarantee of defect-free software. It did not include denial-of-service load generation, social engineering, wallet seed/private-key access, destructive database writes, mainnet payments, or third-party infrastructure compromise.

## Scope

- Next.js application and middleware
- Supabase authentication, service-role boundary, RLS definitions, and privileged RPC grants
- EVM/Solana wallet linking
- Credit purchase and burn verification
- Marketplace payment confirmation
- EVM and Solana deployment APIs
- Generated frontend preview and IPFS delivery
- EVM Solidity contracts and Solana Anchor program source
- Production HTTP security headers and unauthenticated API behavior
- Production dependency graph

## Findings

### DAP-001 — Deployment IDOR / unauthorized dApp update

Severity: High  
Status: Fixed and deployed

The IPFS deployment endpoint accepted caller-supplied fallback data when an authenticated user did not own the requested dApp. Subsequent database updates filtered only by dApp ID, not owner ID. A paying authenticated attacker who knew another dApp UUID could therefore attempt to overwrite its deployment state and frontend/IPFS fields.

Remediation:

- Production requests now fail when the owner-scoped dApp lookup returns no row.
- Caller-supplied fallback data is restricted to local demo mode.
- Every deployment-state `PATCH` now includes both `id` and `owner_id`.
- The Solidity compilation endpoint also requires an owner-scoped dApp row in production.

### DAP-002 — Vulnerable production dependency set

Severity: High  
Status: Fixed; one patched-version advisory remains visible to package scanners

The initial production audit reported 47 advisories: 15 high, 27 moderate, and 5 low. This included vulnerable Next.js, PostCSS, Axios, WebSocket, temporary-file, cookie, UUID, wallet, and image-processing versions.

Remediation:

- Next.js upgraded from 14.2.35 to 15.5.22.
- Wagmi, viem, Supabase SSR/client, Solana libraries, Solc, PostCSS, Sharp and affected transitive packages were upgraded or overridden to patched versions.
- The remaining `bigint-buffer@1.1.5` advisory has no upstream patched release. Dappster applies a maintained package patch that disables the vulnerable native converter and always uses the bounds-safe JavaScript conversion path. Native dependency build scripts are also disabled in the Vercel install.

Post-remediation package audit: 0 critical, 1 high scanner advisory, 0 moderate, 0 low. The remaining high is the patched `bigint-buffer` package-version advisory described above.

### DAP-003 — Same-origin execution of generated IPFS HTML

Severity: Medium  
Status: Fixed and deployed

Generated or third-party HTML was proxied through `/ipfs/[cid]` on the Dappster origin. Without an origin sandbox, a future CSP regression could allow generated code to access same-origin browser state.

Remediation:

- `/ipfs/*` now receives a dedicated CSP containing `sandbox` without `allow-same-origin`.
- Forms cannot submit, the base URL is disabled, object embedding is disabled, and permitted scripts/connections are explicitly scoped.
- The regular application retains nonce-based `strict-dynamic` script policy.

### DAP-004 — Unauthenticated administrative compilation

Severity: Medium  
Status: Fixed and deployed

Administrative artifact routes compiled large Solidity contracts for any unauthenticated requester, creating a CPU-exhaustion surface.

Remediation:

- Both artifact routes now require a valid Dappster session.
- The authenticated account must contain the configured owner EVM wallet.
- Production probes now return HTTP 401 without compiling.

### DAP-005 — Wallet SDK executed browser storage during SSR

Severity: Medium  
Status: Fixed and deployed

Reown/WalletConnect initialization attempted to access `indexedDB` during server rendering. This generated production errors and expanded browser-only wallet code into the server execution path.

Remediation:

- Wallet connectors are constructed only when `window` exists.
- Reown AppKit is initialized only in the browser.
- The wallet connection control is loaded through a no-SSR boundary.
- The replacement production deployment completed static generation without the prior `indexedDB` exception.

### DAP-006 — Service-configuration disclosure through health endpoint

Severity: Low  
Status: Fixed and deployed

The public health endpoint disclosed which generation, audit, IPFS, database and payment integrations were configured.

Remediation: it now returns only `{ "ok": true }`.

### DAP-007 — Public error-log flooding

Severity: Low  
Status: Mitigated

The browser error reporting endpoint accepted same-origin/no-Origin requests without throttling, allowing avoidable log ingestion.

Remediation: bounded fields, origin validation, and a per-client rate limit are enforced. The current rate-limit store is per serverless instance; a distributed limiter is recommended before high-volume operation.

### DAP-008 — PostgREST filter input hardening

Severity: Low  
Status: Fixed and deployed

Marketplace tag filters were passed into PostgREST array syntax without a strict character allowlist.

Remediation: tag count, length, and characters are normalized before filter construction. Search input was already normalized and remains bounded.

### DAP-009 — Exposed API credential outside the repository

Severity: High operational risk  
Status: User action required

An xAI credential was previously pasted into the conversation. Repository scanning found no committed API secret, and `.env.local`/`.vercel` are ignored, but any disclosed credential must be considered compromised.

Required action: revoke the exposed xAI key, create a replacement, update the Vercel secret, and redeploy. Do not reuse the old key.

## Smart-contract review

### EVM membership

- Uses `SafeERC20`, `ReentrancyGuard`, two-step ownership, immutable USDC/treasury, exact package pricing, replay-protected usage IDs, and soulbound ERC-1155 transfers.
- User-initiated credit consumption uses `burnOwnCredits`; receipt verification checks contract, payer, exact amount, usage ID and event.
- Owner/consumer privileges remain a central trust assumption and should be protected by a hardware wallet or multisig.

### EVM marketplace

- Uses safe token transfers, reentrancy protection, replay-protected purchase IDs and a capped platform fee.
- The deployed web flow currently verifies direct creator/platform USDC transfers rather than relying exclusively on this atomic marketplace contract. Moving marketplace settlement into one contract transaction would eliminate partial-payment UX risk.

### Solana membership

- `cargo check --locked` completed successfully with Anchor 0.30.1 dependencies.
- PDA seeds, owner signer, Circle USDC mint, token-account mint/authority constraints and one-time usage PDAs are enforced.
- The configured consumer/permanent-delegate model can burn user credits. This is an explicit central trust boundary; a user-signed burn design would reduce custody/trust risk.

## Production penetration-test results

| Test | Result |
| --- | --- |
| Homepage and CSP | 200; nonce plus `strict-dynamic`; framing denied |
| Malicious cross-origin request | No `Access-Control-Allow-Origin` reflection |
| HTTP TRACE | 405 |
| Admin membership artifact without login | 401 |
| Admin marketplace artifact without login | 401 |
| Create dApp without login | Rejected |
| Deploy arbitrary dApp without login | Rejected |
| Bootstrap arbitrary wallet without login | Rejected |
| PostgREST-like search-filter payload | No private rows or filter escape obtained |
| Public health endpoint | Only `{ "ok": true }` |
| Public IPFS application | 200 with opaque-origin CSP sandbox |
| TypeScript | Passed |
| ESLint | Passed with zero warnings/errors |
| Next.js Linux production build | Passed |
| Solidity compilation | Passed for both EVM contracts |
| Solana `cargo check --locked` | Passed |
| Vercel runtime errors after release | None observed in the verification window |

## Residual recommendations

1. Rotate the disclosed xAI key immediately.
2. Replace in-memory API throttling with a distributed Supabase/Redis/Vercel Firewall limiter.
3. Put owner and consumer privileges behind separate hardware-backed multisigs.
4. Add automated authorization regression tests for every owner-scoped mutation.
5. Add contract unit/fuzz/invariant tests and commission an independent audit before holding material user funds.
6. Monitor Vercel runtime errors and Supabase security advisories continuously.
