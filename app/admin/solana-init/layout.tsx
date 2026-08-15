import { EvmSolanaProviders } from "@/components/WalletProvider"

export default function SolanaAdminLayout({ children }: { children: React.ReactNode }) {
  return <EvmSolanaProviders>{children}</EvmSolanaProviders>
}
