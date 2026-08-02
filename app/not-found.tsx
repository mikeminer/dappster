import Link from "next/link"

export default function NotFound() { return <section className="cta-section" style={{minHeight:"70vh",display:"grid",placeItems:"center"}}><div className="container"><div className="section-label">{"// 404"}</div><h2>Nothing deployed here.</h2><p>This route has not made it onchain yet.</p><Link href="/" className="btn btn-primary">Return home</Link></div></section> }
