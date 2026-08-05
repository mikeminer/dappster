import type { Metadata } from "next"
import "./globals.css"
import { Header } from "@/components/Header"
import { Footer } from "@/components/Footer"
import { CreditsRequiredModal } from "@/components/CreditsRequiredModal"
import { LauncherIntroModal } from "@/components/LauncherIntroModal"

export const metadata: Metadata = {
  title: "Dappster — Build Web3 apps with AI",
  description: "Generate, audit and publish multi-chain dApps with AI.",
  metadataBase: new URL("https://dappster.fun"),
  openGraph: { title: "Dappster", description: "From prompt to protocol.", type: "website", url: "https://dappster.fun", siteName: "Dappster" },
  twitter: { card: "summary_large_image", title: "Dappster", description: "From prompt to protocol." },
  other: {
    "talentapp:project_verification": "699259fa4d69cbc8ff16c1e5119fb1936a20f0f6790f19026a3fd5637d4da10eda342c447252227f8f7ea51dea726e1fa2f0940732bf005d2427eccbba620297",
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="base:app_id" content="6a6f47882c28265d676170a5" />
      </head>
      <body>
        <div className="site-shell">
          <LauncherIntroModal />
          <CreditsRequiredModal />
          <Header />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  )
}
