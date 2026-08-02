use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_spl::{
    token::{self, Mint as LegacyMint, Token, TokenAccount as LegacyTokenAccount, TransferChecked},
    token_2022::{self, Burn, MintTo},
    token_interface::{Mint, Token2022, TokenAccount},
};

declare_id!("6V49oFA2fMspFukL2dCCDyhyRoHVMjzWtPDfmFjCLvZZ");

pub const DAPPSTER_OWNER: Pubkey = pubkey!("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W");
pub const MAINNET_USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const MONTH_SECONDS: i64 = 30 * 24 * 60 * 60;

#[program]
pub mod dappster_membership {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        consumer: Pubkey,
        membership_price: u64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), DAPPSTER_OWNER, DappsterError::InvalidOwner);
        require_keys_eq!(ctx.accounts.usdc_mint.key(), MAINNET_USDC, DappsterError::InvalidUsdcMint);
        require!(membership_price > 0, DappsterError::InvalidAmount);

        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();
        config.consumer = consumer;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.treasury_usdc = ctx.accounts.treasury_usdc.key();
        config.credit_mint = ctx.accounts.credit_mint.key();
        config.membership_mint = ctx.accounts.membership_mint.key();
        config.membership_price = membership_price;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_package(
        ctx: Context<OwnerAction>,
        package_id: u8,
        price: u64,
        credits: u64,
        enabled: bool,
    ) -> Result<()> {
        require!((1..=3).contains(&package_id), DappsterError::InvalidPackage);
        require!(price > 0 && credits > 0, DappsterError::InvalidAmount);
        let package = &mut ctx.accounts.package;
        package.package_id = package_id;
        package.price = price;
        package.credits = credits;
        package.enabled = enabled;
        package.bump = ctx.bumps.package;
        Ok(())
    }

    pub fn purchase_credits(ctx: Context<PurchaseCredits>, _package_id: u8) -> Result<()> {
        let package = &ctx.accounts.package;
        require!(package.enabled, DappsterError::PackageDisabled);

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            package.price,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.credit_token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.credit_mint.to_account_info(),
                    to: ctx.accounts.buyer_credits.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            package.credits,
        )?;
        emit!(CreditsPurchased {
            buyer: ctx.accounts.buyer.key(),
            package_id: package.package_id,
            credits: package.credits,
            usdc_paid: package.price,
        });
        Ok(())
    }

    pub fn purchase_membership(ctx: Context<PurchaseMembership>) -> Result<()> {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            ctx.accounts.config.membership_price,
            ctx.accounts.usdc_mint.decimals,
        )?;

        if ctx.accounts.buyer_membership.amount == 0 {
            let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
            token_2022::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.membership_token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.membership_mint.to_account_info(),
                        to: ctx.accounts.buyer_membership.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                1,
            )?;
        }

        let clock = Clock::get()?;
        let membership = &mut ctx.accounts.membership;
        membership.owner = ctx.accounts.buyer.key();
        membership.expires_at = membership.expires_at.max(clock.unix_timestamp) + MONTH_SECONDS;
        membership.bump = ctx.bumps.membership;
        emit!(MembershipPurchased {
            buyer: ctx.accounts.buyer.key(),
            expires_at: membership.expires_at,
            usdc_paid: ctx.accounts.config.membership_price,
        });
        Ok(())
    }

    /// Burns Token-2022 credits. The credit mint must use the config PDA as
    /// PermanentDelegate so the restricted consumer can burn without user custody.
    pub fn consume_credits(
        ctx: Context<ConsumeCredits>,
        amount: u64,
        usage_id: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.consumer.key(), ctx.accounts.config.consumer, DappsterError::NotConsumer);
        require!(amount > 0, DappsterError::InvalidAmount);
        let usage = &mut ctx.accounts.usage;
        usage.usage_id = usage_id;
        usage.bump = ctx.bumps.usage;

        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        token_2022::burn(
            CpiContext::new_with_signer(
                ctx.accounts.credit_token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.credit_mint.to_account_info(),
                    from: ctx.accounts.user_credits.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        emit!(CreditsConsumed {
            owner: ctx.accounts.credit_owner.key(),
            credits: amount,
            usage_id,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, LegacyMint>,
    #[account(token::mint = usdc_mint, token::authority = owner)]
    pub treasury_usdc: Account<'info, LegacyTokenAccount>,
    #[account(mint::decimals = 0, mint::authority = config, mint::token_program = credit_token_program)]
    pub credit_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::decimals = 0, mint::authority = config, mint::token_program = membership_token_program)]
    pub membership_mint: InterfaceAccount<'info, Mint>,
    pub credit_token_program: Program<'info, Token2022>,
    pub membership_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(package_id: u8)]
pub struct OwnerAction<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = owner)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + CreditPackage::INIT_SPACE, seeds = [b"package", package_id.to_le_bytes().as_ref()], bump)]
    pub package: Account<'info, CreditPackage>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(package_id: u8)]
pub struct PurchaseCredits<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"package", package_id.to_le_bytes().as_ref()], bump = package.bump)]
    pub package: Account<'info, CreditPackage>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, LegacyMint>,
    #[account(address = config.credit_mint)]
    pub credit_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Account<'info, LegacyTokenAccount>,
    #[account(mut, address = config.treasury_usdc)]
    pub treasury_usdc: Account<'info, LegacyTokenAccount>,
    #[account(mut, token::mint = credit_mint, token::authority = buyer, token::token_program = credit_token_program)]
    pub buyer_credits: InterfaceAccount<'info, TokenAccount>,
    pub usdc_token_program: Program<'info, Token>,
    pub credit_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct PurchaseMembership<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, LegacyMint>,
    #[account(address = config.membership_mint)]
    pub membership_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Account<'info, LegacyTokenAccount>,
    #[account(mut, address = config.treasury_usdc)]
    pub treasury_usdc: Account<'info, LegacyTokenAccount>,
    #[account(mut, token::mint = membership_mint, token::authority = buyer, token::token_program = membership_token_program)]
    pub buyer_membership: InterfaceAccount<'info, TokenAccount>,
    #[account(init_if_needed, payer = buyer, space = 8 + Membership::INIT_SPACE, seeds = [b"membership", buyer.key().as_ref()], bump)]
    pub membership: Account<'info, Membership>,
    pub usdc_token_program: Program<'info, Token>,
    pub membership_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, usage_id: [u8; 32])]
pub struct ConsumeCredits<'info> {
    #[account(mut)]
    pub consumer: Signer<'info>,
    /// CHECK: Used only to derive and validate the user's token account.
    pub credit_owner: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.credit_mint)]
    pub credit_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = credit_mint, token::authority = credit_owner, token::token_program = credit_token_program)]
    pub user_credits: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = consumer, space = 8 + Usage::INIT_SPACE, seeds = [b"usage", usage_id.as_ref()], bump)]
    pub usage: Account<'info, Usage>,
    pub credit_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    pub consumer: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury_usdc: Pubkey,
    pub credit_mint: Pubkey,
    pub membership_mint: Pubkey,
    pub membership_price: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CreditPackage {
    pub package_id: u8,
    pub price: u64,
    pub credits: u64,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Membership {
    pub owner: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Usage {
    pub usage_id: [u8; 32],
    pub bump: u8,
}

#[event]
pub struct CreditsPurchased {
    pub buyer: Pubkey,
    pub package_id: u8,
    pub credits: u64,
    pub usdc_paid: u64,
}

#[event]
pub struct MembershipPurchased {
    pub buyer: Pubkey,
    pub expires_at: i64,
    pub usdc_paid: u64,
}

#[event]
pub struct CreditsConsumed {
    pub owner: Pubkey,
    pub credits: u64,
    pub usage_id: [u8; 32],
}

#[error_code]
pub enum DappsterError {
    #[msg("Only the configured Dappster owner can initialize this program")]
    InvalidOwner,
    #[msg("The configured mint is not Circle USDC mainnet")]
    InvalidUsdcMint,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid package")]
    InvalidPackage,
    #[msg("This credit package is disabled")]
    PackageDisabled,
    #[msg("Only the configured Dappster consumer may burn credits")]
    NotConsumer,
}
