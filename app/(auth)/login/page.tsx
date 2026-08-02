import Link from "next/link"
import { Logo } from "@/components/Logo"
import { ConnectButtonNoSSR } from "@/components/ConnectButtonNoSSR"

export default function LoginPage() { return <section className="cta-section" style={{minHeight:"75vh",display:"grid",placeItems:"center"}}><div className="panel" style={{width:"min(430px,100%)",textAlign:"left"}}><div className="panel-body"><Logo /><h1 style={{fontSize:28,margin:"32px 0 8px"}}>Sign in onchain.</h1><p style={{color:"#7e8690",fontSize:13,lineHeight:1.6}}>Connect a wallet and sign a gasless message to open your Dappster dashboard.</p><ConnectButtonNoSSR mode="panel" redirectTo="/dashboard" /><Link href="/" style={{display:"block",textAlign:"center",color:"#69717b",fontSize:11,marginTop:22}}>Return to homepage</Link></div></div></section> }
