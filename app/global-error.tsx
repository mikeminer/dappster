"use client"

import { useEffect } from "react"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, path: window.location.href }),
      keepalive: true,
    }).catch(() => undefined)
  }, [error])

  return <html lang="en"><body style={{margin:0,background:"#08090b",color:"#f4f6f8",fontFamily:"Arial,sans-serif"}}><main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24}}><section style={{width:"min(560px,100%)",border:"1px solid #282d34",borderRadius:14,padding:32,textAlign:"center",background:"#0e1115"}}><div style={{color:"#c7ff32",fontSize:12,letterSpacing:2,textTransform:"uppercase"}}>Dappster recovery</div><h1 style={{fontSize:34,margin:"18px 0 12px"}}>A temporary client error occurred.</h1><p style={{color:"#929aa4",lineHeight:1.7}}>Your projects and credits are preserved. Load the latest application version to continue.</p><button type="button" onClick={reset} style={{width:"100%",marginTop:18,padding:"14px 18px",border:0,borderRadius:8,background:"#c7ff32",color:"#070807",fontWeight:800,cursor:"pointer"}}>Try again</button><button type="button" onClick={() => window.location.reload()} style={{width:"100%",marginTop:10,padding:"14px 18px",border:"1px solid #343a43",borderRadius:8,background:"transparent",color:"#f4f6f8",fontWeight:700,cursor:"pointer"}}>Reload Dappster</button></section></main></body></html>
}
