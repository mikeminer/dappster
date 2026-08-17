use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("BQJxEcwnCLqeg4VDGHUeiCJAaAPHVuSMgP4F32bnQUXN");

#[program]
pub mod fridge {
    use super::*;

    pub fn create_lock(
        ctx: Context<CreateLock>,
        lock_id: u64,
        amount: u64,
        unlock_at: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require_gt!(amount, 0, FridgeError::ZeroAmount);
        require_gt!(unlock_at, clock.unix_timestamp, FridgeError::InvalidUnlockTime);

        let lock = &mut ctx.accounts.lock;
        lock.depositor = ctx.accounts.depositor.key();
        lock.mint = ctx.accounts.mint.key();
        lock.amount = amount;
        lock.created_at = clock.unix_timestamp;
        lock.unlock_at = unlock_at;
        lock.bump = ctx.bumps.lock;
        lock.id = lock_id;

        let transfer = TransferChecked {
            from: ctx.accounts.depositor_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let clock = Clock::get()?;
        let lock_depositor = ctx.accounts.lock.depositor;
        let lock_mint = ctx.accounts.lock.mint;
        let lock_id = ctx.accounts.lock.id;
        let lock_bump = ctx.accounts.lock.bump;
        let unlock_at = ctx.accounts.lock.unlock_at;
        let locked_amount = ctx.accounts.lock.amount;

        require_keys_eq!(lock_depositor, ctx.accounts.depositor.key(), FridgeError::NotDepositor);
        require_gte!(clock.unix_timestamp, unlock_at, FridgeError::NotUnlocked);
        require_gt!(locked_amount, 0, FridgeError::ZeroAmount);
        require_eq!(ctx.accounts.vault.amount, locked_amount, FridgeError::VaultAmountMismatch);

        let id_bytes = lock_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"lock",
            lock_depositor.as_ref(),
            lock_mint.as_ref(),
            id_bytes.as_ref(),
            &[lock_bump],
        ]];

        let transfer = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.depositor_ata.to_account_info(),
            authority: ctx.accounts.lock.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer,
                signer_seeds,
            ),
            locked_amount,
            ctx.accounts.mint.decimals,
        )?;

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.depositor.to_account_info(),
                authority: ctx.accounts.lock.to_account_info(),
            },
            signer_seeds,
        ))?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(lock_id: u64)]
pub struct CreateLock<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = depositor_ata.mint == mint.key() @ FridgeError::InvalidTokenAccount,
        constraint = depositor_ata.owner == depositor.key() @ FridgeError::InvalidTokenAccount,
    )]
    pub depositor_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = depositor,
        space = 8 + Lock::INIT_SPACE,
        seeds = [b"lock", depositor.key().as_ref(), mint.key().as_ref(), &lock_id.to_le_bytes()],
        bump,
    )]
    pub lock: Account<'info, Lock>,
    #[account(
        init,
        payer = depositor,
        seeds = [b"vault", depositor.key().as_ref(), mint.key().as_ref(), &lock_id.to_le_bytes()],
        bump,
        token::mint = mint,
        token::authority = lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(
        mut,
        close = depositor,
        seeds = [b"lock", depositor.key().as_ref(), mint.key().as_ref(), &lock.id.to_le_bytes()],
        bump = lock.bump,
        has_one = depositor @ FridgeError::NotDepositor,
        has_one = mint @ FridgeError::InvalidMint,
    )]
    pub lock: Account<'info, Lock>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = depositor_ata.mint == mint.key() @ FridgeError::InvalidTokenAccount,
        constraint = depositor_ata.owner == depositor.key() @ FridgeError::InvalidTokenAccount,
    )]
    pub depositor_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", depositor.key().as_ref(), mint.key().as_ref(), &lock.id.to_le_bytes()],
        bump,
        token::mint = mint,
        token::authority = lock,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Lock {
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub unlock_at: i64,
    pub bump: u8,
    pub id: u64,
}

#[error_code]
pub enum FridgeError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Unlock time must be in the future")]
    InvalidUnlockTime,
    #[msg("Only the original depositor can claim this lock")]
    NotDepositor,
    #[msg("This lock has not reached its unlock time")]
    NotUnlocked,
    #[msg("The vault balance does not match the recorded lock amount")]
    VaultAmountMismatch,
    #[msg("The supplied mint does not match the lock")]
    InvalidMint,
    #[msg("The supplied token account is invalid")]
    InvalidTokenAccount,
}
