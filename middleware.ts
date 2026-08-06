import { NextRequest, NextResponse } from "next/server"

function applicationPolicy(nonce?: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    nonce
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ")
}

function isolatedBuilderPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dappster.fun https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ")
}

function isolatedIpfsPolicy(allowWalletInjection: boolean) {
  return [
    "default-src 'none'",
    `sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads${allowWalletInjection ? " allow-same-origin" : ""}`,
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dappster.fun https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'unsafe-inline' https:",
    "img-src data: blob: https:",
    "font-src data: https:",
    "connect-src https: wss:",
    "frame-src https: data: blob:",
    "worker-src blob:",
    "upgrade-insecure-requests",
  ].join("; ")
}

export function middleware(request: NextRequest) {
  const isBuilder = request.nextUrl.pathname === "/build"
  const isIpfs = request.nextUrl.pathname.startsWith("/ipfs/")
  const isNonceProtectedPage = ["/build", "/audit", "/dashboard", "/login"].includes(request.nextUrl.pathname)
    || request.nextUrl.pathname.startsWith("/admin/")
    || request.nextUrl.pathname.startsWith("/dapp/")
  const hostname = (request.headers.get("host") || request.nextUrl.hostname).split(":")[0].toLowerCase()
  const isDappRuntimeHost = hostname === "dappster-fun.vercel.app" || hostname === "apps.dappster.fun"
  const nonce = isNonceProtectedPage ? btoa(crypto.randomUUID()) : undefined
  const policy = isBuilder ? isolatedBuilderPolicy() : isIpfs ? isolatedIpfsPolicy(isDappRuntimeHost) : applicationPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("Content-Security-Policy", policy)
  if (!isBuilder && !isIpfs && nonce) requestHeaders.set("x-nonce", nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", policy)
  if (isIpfs && isDappRuntimeHost) response.headers.set("Clear-Site-Data", '"cookies", "storage"')
  return response
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
