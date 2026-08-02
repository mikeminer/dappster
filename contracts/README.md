# Dappster membership protocol

The production checkout is designed around two on-chain programs:

- `evm/DappsterMembership.sol` on Base mainnet.
- `solana/dappster_membership` on Solana mainnet-beta.

Both use Circle USDC, send USDC directly to the configured owner treasury, mint
non-transferable credit units, and allow only a separately configured consumer
authority to burn credits for Dappster API usage.

## Required deployment sequence

1. Audit both contracts and deploy/test on Base Sepolia and Solana devnet.
2. Deploy the Base contract with:
   - owner and treasury: `0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134`
   - Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - consumer: a dedicated relayer address, not the owner wallet.
3. Build the Solana program with Anchor. Replace `declare_id!` with the generated
   program ID before deploying.
4. Create Token-2022 credit and membership mints with `decimals = 0` and the
   `NonTransferable` extension. The credit mint also requires the config PDA as
   `PermanentDelegate`. Both mints use the config PDA as mint authority.
5. Initialize the Solana config while signing with owner
   `GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W`.
6. Configure the production public contract/program IDs and relayer credentials.

Never place owner or relayer private keys in `NEXT_PUBLIC_*` variables.
