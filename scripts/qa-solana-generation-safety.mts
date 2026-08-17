import assert from "node:assert/strict"
import { assertSolanaGenerationSafety, solanaGenerationSafetyIssues } from "../lib/solana-generation-safety.ts"

const frontend = `
  const anchorProvider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(window.__DAPPSTER__.solanaIdl, anchorProvider);
`

const safeProgram = `
use anchor_lang::prelude::*;

#[program]
pub mod fridge {
    use super::*;

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let seeds = &[b"config".as_ref(), &[ctx.bumps.config]];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
        token::transfer(cpi_ctx, 1)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(init, payer = depositor, space = 8 + 32 + 32 + 8 + 8 + 8 + 1, seeds = [b"deposit", depositor.key().as_ref()], bump)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config { pub owner: Pubkey }

#[account]
pub struct DepositAccount {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub deposited_at: i64,
    pub unlock_at: i64,
    pub bump: u8,
}
`

assert.doesNotThrow(() => assertSolanaGenerationSafety(safeProgram, frontend))
assert.doesNotThrow(() => assertSolanaGenerationSafety(safeProgram, `
  const idl = window.__DAPPSTER__.solanaIdl;
  const anchorProvider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(idl, anchorProvider);
`))
assert.doesNotThrow(() => assertSolanaGenerationSafety(safeProgram, `
  const { solanaIdl: compilerIdl } = window.__DAPPSTER__;
  const anchorProvider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(compilerIdl, anchorProvider);
`))

const wrongSigner = safeProgram.replace('b"config".as_ref()', 'b"deposit".as_ref()')
assert.match(solanaGenerationSafetyIssues(wrongSigner, frontend).join("\n"), /signer seeds do not include b"config"/)

const underAllocated = safeProgram.replace("8 + 32 + 32 + 8 + 8 + 8 + 1", "8 + 32 + 8 + 8 + 8 + 1")
assert.match(solanaGenerationSafetyIssues(underAllocated, frontend).join("\n"), /needs at least 97/)

assert.match(
  solanaGenerationSafetyIssues(safeProgram, "new anchor.Program(IDL, PROGRAM_ID, provider)").join("\n"),
  /exactly the injected IDL and AnchorProvider/,
)
assert.match(
  solanaGenerationSafetyIssues(safeProgram, "const IDL = { address: 'hardcoded' }; new anchor.Program(IDL, provider)").join("\n"),
  /must read the compiler IDL/,
)
assert.match(
  solanaGenerationSafetyIssues(safeProgram, "new anchor.Provider(connection, wallet, {})").join("\n"),
  /Use AnchorProvider/,
)

console.log("Solana generation safety checks passed")
