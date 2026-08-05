import { EvmSolanaProviders } from "@/components/WalletProvider"

export const dynamic = "force-dynamic"

export default function SolanaAdminLayout({ children }: { children: React.ReactNode }) {
  return <EvmSolanaProviders>{children}</EvmSolanaProviders>
}
