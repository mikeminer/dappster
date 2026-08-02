import { ImageResponse } from "next/og"

export const alt = "Dappster — Build Web3 apps from one prompt"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const runtime = "edge"

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", color: "#f6f7f9", background: "radial-gradient(circle at 15% 15%, rgba(199,255,50,.16), transparent 32%), linear-gradient(145deg, #060708 0%, #0b0d10 58%, #11151a 100%)", padding: "62px 70px" }}>
      <div style={{ position: "absolute", inset: 24, display: "flex", border: "1px solid rgba(199,255,50,.18)", borderRadius: 28 }} />
      <div style={{ position: "absolute", width: 440, height: 440, border: "1px solid rgba(199,255,50,.08)", borderRadius: 220, right: -120, top: -170, display: "flex" }} />
      <div style={{ position: "absolute", width: 280, height: 280, border: "1px solid rgba(199,255,50,.08)", borderRadius: 140, right: -20, top: -90, display: "flex" }} />

      <div style={{ width: "65%", display: "flex", flexDirection: "column", justifyContent: "space-between", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 62, height: 62, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(199,255,50,.35)", borderRadius: 15, background: "rgba(199,255,50,.06)", boxShadow: "0 0 36px rgba(199,255,50,.15)" }}>
            <svg viewBox="0 0 32 32" width="43" height="43" fill="none">
              <path d="M7 5h10.4C23.8 5 27 8.9 27 15.8 27 23 23.2 27 16.7 27H7V5Z" stroke="#c7ff32" strokeWidth="3" />
              <path d="M13 11h4.1c2.6 0 4 1.8 4 4.8 0 3.3-1.6 5.2-4.2 5.2H13V11Z" fill="#c7ff32" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, letterSpacing: "-1.5px" }}>dappster<span style={{ color: "#c7ff32" }}>.</span></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#c7ff32", fontSize: 16, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 20 }}>From prompt to protocol</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 66, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-3px" }}>
            <span>Build Web3 apps</span>
            <span style={{ color: "#c7ff32" }}>from one prompt.</span>
          </div>
          <div style={{ display: "flex", color: "#9aa2ad", fontSize: 21, lineHeight: 1.45, marginTop: 24, maxWidth: 680 }}>Generate, audit, deploy and publish production-ready dApps for EVM and Solana.</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {['AI Builder', 'EVM', 'Solana', 'IPFS Marketplace'].map(label => <div key={label} style={{ display: "flex", padding: "10px 15px", color: "#c9ced5", border: "1px solid #2b3138", borderRadius: 999, background: "rgba(17,20,25,.9)", fontSize: 14 }}>{label}</div>)}
        </div>
      </div>

      <div style={{ width: "35%", display: "flex", alignItems: "center", justifyContent: "flex-end", zIndex: 2 }}>
        <div style={{ width: 330, height: 390, display: "flex", flexDirection: "column", border: "1px solid #313840", borderRadius: 22, background: "linear-gradient(160deg, rgba(18,22,27,.97), rgba(8,10,12,.97))", boxShadow: "0 28px 80px rgba(0,0,0,.45)", padding: 25, transform: "rotate(2deg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 20, borderBottom: "1px solid #252b31" }}>
            <div style={{ display: "flex", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: "#ff6b6b" }} /><span style={{ width: 10, height: 10, borderRadius: 5, background: "#ffd43b" }} /><span style={{ width: 10, height: 10, borderRadius: 5, background: "#69db7c" }} /></div>
            <span style={{ display: "flex", color: "#6f7883", fontSize: 12 }}>App.tsx</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13, paddingTop: 25 }}>
            {[78, 52, 86, 64, 42, 72].map((width, index) => <div key={width} style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: index === 2 || index === 3 ? 22 : 0 }}><span style={{ display: "flex", width: 22, color: "#4f5863", fontSize: 12 }}>{index + 1}</span><span style={{ display: "flex", width: `${width}%`, height: 8, borderRadius: 4, background: index === 0 || index === 4 ? "#c7ff32" : index === 2 ? "#9b7cff" : "#34404a", opacity: index === 0 || index === 4 ? .9 : .75 }} /></div>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", padding: "16px 18px", border: "1px solid rgba(199,255,50,.24)", borderRadius: 12, background: "rgba(199,255,50,.06)" }}>
            <span style={{ display: "flex", color: "#aab2bc", fontSize: 13 }}>Ready to deploy</span>
            <span style={{ display: "flex", width: 9, height: 9, borderRadius: 5, background: "#c7ff32", boxShadow: "0 0 14px #c7ff32" }} />
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", right: 72, bottom: 38, display: "flex", color: "#69727d", fontSize: 14, letterSpacing: "1px" }}>DAPPSTER.FUN</div>
    </div>,
    size,
  )
}
