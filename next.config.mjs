/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "header", key: "host", value: "www\\.dappster\\.fun" }],
        destination: "https://dappster.fun/:path*",
        permanent: true,
      },
    ]
  },
  async headers() {
    const commonSecurityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      // CSP frame-ancestors remains the authoritative framing allowlist. CORP
      // must permit Chrome wallet extensions to display their safety handoff.
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      { key: "Origin-Agent-Cluster", value: "?1" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
    ]

    return [
      { source: "/:path*", headers: commonSecurityHeaders },
      {
        source: "/runtime/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      },
    ]
  },
  outputFileTracingIncludes: {
    "/api/contracts/compile": ["./node_modules/@openzeppelin/contracts/**/*.sol"],
    "/ipfs/[cid]": ["./node_modules/@openzeppelin/contracts/**/*.sol"],
    "/api/admin/membership-artifact": ["./contracts/evm/DappsterMembership.sol", "./node_modules/@openzeppelin/contracts/**/*.sol"],
  },
  serverExternalPackages: ["solc", "@vercel/sandbox"],
}

export default nextConfig
