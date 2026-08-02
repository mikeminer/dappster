"use client"

import { useEffect } from "react"

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, path: window.location.href }),
      keepalive: true,
    }).catch(() => undefined)
  }, [error])

  return <section className="app-section"><div className="container"><div className="panel" style={{maxWidth:620,margin:"40px auto"}}><div className="panel-body form-stack" style={{textAlign:"center"}}><div className="section-label">// Recovery</div><h1 style={{fontSize:34,margin:0}}>The builder hit a temporary error.</h1><p style={{color:"#929aa4",lineHeight:1.7}}>Your saved project and on-chain credits are preserved. Retry the current screen or reload the latest Dappster version.</p><button className="btn btn-primary btn-block" type="button" onClick={reset}>Try again</button><button className="btn btn-outline btn-block" type="button" onClick={() => window.location.reload()}>Reload Dappster</button></div></div></div></section>
}
