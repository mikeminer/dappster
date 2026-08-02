# Dappster security controls

## Authentication

- Production API routes fail closed when Supabase credentials are absent.
- EVM and Solana login uses Supabase Sign in with Web3. Supabase validates the
  signed message before issuing a session.
- Wallet ownership is derived from the session's Supabase identity records.
  User-editable `user_metadata` is never used for authorization or wallet
  linking.
- Email/password signup and anonymous signup are disabled in the committed
  Supabase configuration. Web3 login is rate limited.

## Profile and credit integrity

- `authenticated` has read-only access to `profiles`.
- Credits, plans, expiry timestamps, wallet addresses, and chains are mutated
  only by server routes using the service role.
- Username changes pass through `/api/me`, which validates format and length.
- New Auth users receive an inert UUID placeholder. The verified Web3 bootstrap
  replaces it atomically with the signed wallet identity.

## Browser isolation

- Normal application pages use a per-request CSP nonce and do not allow
  `unsafe-eval` or general inline scripts.
- Generated frontend previews run in a sandboxed iframe without same-origin,
  forms, modal, or popup privileges.
- The builder's relaxed runtime policy is route-scoped because Babel compiles
  generated preview code in the isolated iframe.

## Production configuration checklist

1. Apply all migrations in `supabase/migrations`.
2. Keep Email and Anonymous providers disabled in Supabase Auth unless a
   separately reviewed account-linking flow is introduced.
3. Restrict Web3 redirect URLs to `https://dappster.fun/**` and approved Vercel
   preview URLs only.
4. Enable Supabase CAPTCHA/Turnstile only together with a client token flow;
   enabling the server toggle alone will block every Web3 login.
5. Re-run Supabase Security Advisor after every migration.
