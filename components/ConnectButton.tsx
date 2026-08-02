"use client"

import { useEffect, useRef, useState } from "react"
import { useConnect, useDisconnect } from "wagmi"
import { useWallet } from "@solana/wallet-adapter-react"
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react"
import type { Provider as ReownSolanaProvider } from "@reown/appkit-adapter-solana/react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { clearLocalWalletSession, getLocalWalletSession, setLocalWalletSession, type LocalWalletSession } from "@/lib/client-api"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { reownAppKit, reownEnabled } from "@/lib/reown"

type LinkedWallet = { chain: "evm" | "solana"; wallet_address: string }
type SolanaLoginWallet = {
  publicKey?: { toBase58(): string } | null
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}
type EvmLoginProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

type ReownAccountState = { isConnected: boolean; address?: string }
type ReownConnectionState = {
  open(options: { view: "ConnectingWalletConnectBasic"; namespace: "eip155" | "solana" }): Promise<unknown>
  evmAccount: ReownAccountState
  evmProvider?: EvmLoginProvider
  solanaAccount: ReownAccountState
  solanaProvider?: ReownSolanaProvider
}

const disconnectedReownAccount: ReownAccountState = { isConnected: false }

const EVM_QR_LOGIN_PENDING_KEY = "dappster:evm-qr-login-pending"

function reportWalletLoginError(flow: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `[wallet-login:${flow}] ${message}`, stack, path: window.location.pathname }),
    keepalive: true,
  }).catch(() => undefined)
}

function isAlreadyConnectedError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === "ConnectorAlreadyConnectedError" || error.message.toLowerCase().includes("already connected")
}

function isStaleWalletConnectError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return /session|expired|disconnected|no matching key|proposal|pairing/.test(message)
}

async function waitForSolanaAdapter(adapter: { connected: boolean; publicKey: { toBase58(): string } | null }, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (adapter.connected && adapter.publicKey) return
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
}

function ReownConnectButton(props: { mode?: "button" | "panel"; redirectTo?: string }) {
  const { open } = useAppKit()
  const evmAccount = useAppKitAccount({ namespace: "eip155" })
  const { walletProvider: evmProvider } = useAppKitProvider<EvmLoginProvider>("eip155")
  const solanaAccount = useAppKitAccount({ namespace: "solana" })
  const { walletProvider: solanaProvider } = useAppKitProvider<ReownSolanaProvider>("solana")
  return <ConnectButtonCore {...props} reown={{ open, evmAccount, evmProvider, solanaAccount, solanaProvider }} />
}

export function ConnectButton(props: { mode?: "button" | "panel"; redirectTo?: string }) {
  return reownEnabled ? <ReownConnectButton {...props} /> : <ConnectButtonCore {...props} reown={null} />
}

function ConnectButtonCore({ mode = "button", redirectTo, reown }: { mode?: "button" | "panel"; redirectTo?: string; reown: ReownConnectionState | null }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState<"evm" | "solana" | null>(null)
  const [localSession, setLocalSessionState] = useState<LocalWalletSession | null>(null)
  const [authenticatedWallet, setAuthenticatedWallet] = useState<LocalWalletSession | null>(null)
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>([])
  const loginAttempt = useRef(false)
  const evmQrLoginPending = useRef(false)
  const solanaQrLoginPending = useRef(false)
  const { connectors, connectAsync } = useConnect()
  const { disconnect } = useDisconnect()
  const solana = useWallet()
  const openAppKit = reown?.open
  const reownEvmAccount = reown?.evmAccount || disconnectedReownAccount
  const reownEvmProvider = reown?.evmProvider
  const reownSolanaAccount = reown?.solanaAccount || disconnectedReownAccount
  const reownSolanaProvider = reown?.solanaProvider
  const router = useRouter()

  useEffect(() => {
    let active = true
    const sync = async () => {
      setLocalSessionState(getLocalWalletSession())
      const supabase = getBrowserSupabase()
      if (!supabase) return
      const { data } = await supabase.auth.getSession()
      if (!active) return
      if (!data.session) {
        setAuthenticatedWallet(null)
        setLinkedWallets([])
        return
      }
      const profile = await supabase.from("profiles").select("wallet_address,chain").eq("id", data.session.user.id).maybeSingle()
      if (!active) return
      const chain = profile.data?.chain
      const walletAddress = profile.data?.wallet_address
      setAuthenticatedWallet(walletAddress && (chain === "evm" || chain === "solana") ? { chain, address: walletAddress } : null)
      const response = await fetch("/api/account/wallets", { headers: { Authorization: `Bearer ${data.session.access_token}` } })
      if (response.ok) {
        const payload = await response.json() as { wallets?: LinkedWallet[] }
        if (active) setLinkedWallets(payload.wallets || [])
      }
    }
    void sync()
    const supabase = getBrowserSupabase()
    const authListener = supabase?.auth.onAuthStateChange(() => { void sync() })
    window.addEventListener("dappster-auth-change", sync)
    return () => {
      active = false
      authListener?.data.subscription.unsubscribe()
      window.removeEventListener("dappster-auth-change", sync)
    }
  }, [])

  const connectedAddress = authenticatedWallet?.address || localSession?.address || ""
  const connectedLabel = connectedAddress ? `${connectedAddress.slice(0, 5)}…${connectedAddress.slice(-4)}` : ""

  function completeLocalLogin(session: LocalWalletSession) {
    setLocalWalletSession(session)
    setLocalSessionState(session)
  }

  function finish() {
    setOpen(false)
    if (redirectTo) router.push(redirectTo)
  }

  async function bootstrapWeb3Identity(accessToken: string | undefined, chain: "evm" | "solana", address: string) {
    if (!accessToken) throw new Error("Supabase did not return an authenticated wallet session")
    const response = await fetch("/api/account/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ chain, address }),
    })
    const payload = await response.json() as { error?: string }
    if (!response.ok) throw new Error(payload.error || "Could not verify the wallet identity")
  }

  async function linkPreviousAccount(primaryAccessToken: string | undefined, currentAccessToken: string | undefined, isDifferentUser: boolean) {
    if (!primaryAccessToken || !currentAccessToken || !isDifferentUser) return
    const response = await fetch("/api/account/link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentAccessToken}` },
      body: JSON.stringify({ primaryAccessToken }),
    })
    const payload = await response.json() as { error?: string; wallets?: LinkedWallet[] }
    if (!response.ok) throw new Error(payload.error || "Could not link this wallet")
    setLinkedWallets(payload.wallets || [])
  }

  async function authenticateSolanaWallet(wallet: SolanaLoginWallet, walletAddress: string) {
    if (!wallet.signMessage) throw new Error("This Solana wallet cannot sign login messages")
    const supabase = getBrowserSupabase()
    if (supabase) {
      const previous = (await supabase.auth.getSession()).data.session
      const auth = await supabase.auth.signInWithWeb3({ chain: "solana", statement: "Sign in to Dappster. Build and list your dApps.", wallet } as never)
      if (auth.error) throw auth.error
      await bootstrapWeb3Identity(auth.data.session?.access_token, "solana", walletAddress)
      try {
        await linkPreviousAccount(previous?.access_token, auth.data.session?.access_token, Boolean(previous && previous.user.id !== auth.data.user.id))
      } catch (linkError) {
        if (previous) await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token })
        throw linkError
      }
      setAuthenticatedWallet({ chain: "solana", address: walletAddress })
    } else {
      const statement = new TextEncoder().encode(`Sign in to Dappster\nWallet: ${walletAddress}\nIssued at: ${new Date().toISOString()}`)
      await wallet.signMessage(statement)
      completeLocalLogin({ chain: "solana", address: walletAddress })
    }
    finish()
  }

  async function authenticateEvmWallet(provider: EvmLoginProvider, walletAddress: string) {
    const supabase = getBrowserSupabase()
    if (supabase) {
      const previous = (await supabase.auth.getSession()).data.session
      const auth = await supabase.auth.signInWithWeb3({ chain: "ethereum", statement: "Sign in to Dappster. Build and list your dApps.", wallet: provider } as never)
      if (auth.error) throw auth.error
      await bootstrapWeb3Identity(auth.data.session?.access_token, "evm", walletAddress)
      try {
        await linkPreviousAccount(previous?.access_token, auth.data.session?.access_token, Boolean(previous && previous.user.id !== auth.data.user.id))
      } catch (linkError) {
        if (previous) await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token })
        throw linkError
      }
      setAuthenticatedWallet({ chain: "evm", address: walletAddress })
    } else completeLocalLogin({ chain: "evm", address: walletAddress })
    finish()
  }

  useEffect(() => {
    const pending = evmQrLoginPending.current || window.sessionStorage.getItem(EVM_QR_LOGIN_PENDING_KEY) === "1"
    if (!pending || !reownEvmAccount.isConnected || !reownEvmAccount.address || !reownEvmProvider) return
    evmQrLoginPending.current = false
    window.sessionStorage.removeItem(EVM_QR_LOGIN_PENDING_KEY)
    loginAttempt.current = true
    setLoading("evm")
    void authenticateEvmWallet(reownEvmProvider, reownEvmAccount.address)
      .catch(async error => {
        reportWalletLoginError("walletconnect-evm", error)
        if (isStaleWalletConnectError(error)) {
          await reownAppKit?.disconnect("eip155").catch(() => undefined)
          setMessage("The previous WalletConnect session was reset. Tap WalletConnect again.")
        } else setMessage(error instanceof Error ? error.message : "Could not connect wallet")
      })
      .finally(() => {
        loginAttempt.current = false
        setLoading(null)
      })
    // authenticateEvmWallet deliberately runs only after AppKit restores the EVM provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reownEvmAccount.address, reownEvmAccount.isConnected, reownEvmProvider])

  useEffect(() => {
    if (!solanaQrLoginPending.current || !reownSolanaAccount.isConnected || !reownSolanaAccount.address || !reownSolanaProvider) return
    solanaQrLoginPending.current = false
    loginAttempt.current = true
    setLoading("solana")
    void authenticateSolanaWallet(reownSolanaProvider, reownSolanaAccount.address)
      .catch(error => setMessage(error instanceof Error ? error.message : "Could not connect wallet"))
      .finally(() => {
        loginAttempt.current = false
        setLoading(null)
      })
    // authenticateSolanaWallet deliberately runs only after the Reown account becomes connected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reownSolanaAccount.address, reownSolanaAccount.isConnected, reownSolanaProvider])

  async function connectEvm(connectionType: "injected" | "walletConnect" = "injected") {
    if (loginAttempt.current) return
    const errorFlow = connectionType === "walletConnect" ? "walletconnect-open" : "injected-evm"
    loginAttempt.current = true
    try {
      setLoading("evm")
      setMessage("")
      if (connectionType === "walletConnect") {
        if (!reownEnabled) throw new Error("QR login is not configured yet")
        // This button explicitly starts a new WalletConnect flow. Do not reuse an
        // injected or restored AppKit provider here: doing so skips the modal and
        // immediately asks the wallet to sign, which looks like a broken button.
        if (reownEvmAccount.isConnected) {
          await reownAppKit?.disconnect("eip155").catch(() => undefined)
        }
        evmQrLoginPending.current = true
        window.sessionStorage.setItem(EVM_QR_LOGIN_PENDING_KEY, "1")
        if (!openAppKit) throw new Error("QR login is not configured yet")
        await openAppKit({ view: "ConnectingWalletConnectBasic", namespace: "eip155" })
        return
      }
      const connector = connectors.find(item => item.id === connectionType)
        || (connectionType === "injected" ? connectors.find(item => item.id === "injected") : undefined)
      if (!connector) throw new Error("Install an EVM wallet extension first")
      let accounts = await connector.getAccounts().catch(() => [])
      if (!accounts[0]) {
        try {
          accounts = (await connectAsync({ connector })).accounts
        } catch (error) {
          if (!isAlreadyConnectedError(error)) throw error
          accounts = await connector.getAccounts()
        }
      }
      const walletAddress = accounts[0]
      if (!walletAddress) throw new Error("The EVM wallet did not return an account")
      const supabase = getBrowserSupabase()
      const provider = await connector.getProvider().catch(() => undefined)
      if (supabase) {
        if (!provider) throw new Error("The EVM wallet provider is not available")
        await authenticateEvmWallet(provider as EvmLoginProvider, walletAddress)
      } else {
        completeLocalLogin({ chain: "evm", address: walletAddress })
        finish()
      }
    } catch (error) {
      reportWalletLoginError(errorFlow, error)
      if (connectionType === "walletConnect" && isStaleWalletConnectError(error)) {
        await reownAppKit?.disconnect("eip155").catch(() => undefined)
        window.sessionStorage.removeItem(EVM_QR_LOGIN_PENDING_KEY)
        setMessage("The previous WalletConnect session was reset. Tap WalletConnect again.")
      } else setMessage(error instanceof Error ? error.message : "Could not connect wallet")
    }
    finally { loginAttempt.current = false; setLoading(null) }
  }

  async function connectSolana() {
    if (loginAttempt.current) return
    loginAttempt.current = true
    try {
      setLoading("solana")
      setMessage("")
      const selectedWallet = solana.wallets.find(wallet => wallet.adapter.name === "Phantom")
      if (!selectedWallet) throw new Error("Phantom wallet is not available")
      const adapter = selectedWallet.adapter as typeof selectedWallet.adapter & { signMessage?: (message: Uint8Array) => Promise<Uint8Array> }
      solana.select(adapter.name)
      if (!adapter.connected || !adapter.publicKey) {
        try {
          await adapter.connect()
        } catch (error) {
          if (!isAlreadyConnectedError(error)) throw error
          await waitForSolanaAdapter(adapter)
        }
      }
      const publicKey = adapter.publicKey
      if (!publicKey) throw new Error("Phantom did not return a public key")
      const walletAddress = publicKey.toBase58()
      await authenticateSolanaWallet(adapter, walletAddress)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect wallet") }
    finally { loginAttempt.current = false; setLoading(null) }
  }

  async function connectSolanaQr() {
    if (loginAttempt.current) return
    setMessage("")
    solanaQrLoginPending.current = true
    try {
      if (!openAppKit) throw new Error("QR login is not configured yet")
      await openAppKit({ view: "ConnectingWalletConnectBasic", namespace: "solana" })
    } catch (error) {
      solanaQrLoginPending.current = false
      setMessage(error instanceof Error ? error.message : "Could not open Solana QR login")
    }
  }

  async function signOut() {
    setOpen(false)
    disconnect()
    await solana.disconnect().catch(() => undefined)
    const supabase = getBrowserSupabase()
    if (supabase) await supabase.auth.signOut()
    clearLocalWalletSession()
    setLocalSessionState(null)
    setAuthenticatedWallet(null)
    setLinkedWallets([])
  }

  const connected = Boolean(authenticatedWallet || localSession)
  if (connected) return <div className={mode === "panel" ? "form-stack" : undefined}><button className="btn btn-outline" onClick={() => { setMessage(""); setOpen(true) }}><span className="status-dot" /> {connectedLabel}</button>{mode === "panel" && <button className="btn btn-primary btn-block" onClick={() => router.push(redirectTo || "/dashboard")}>Continue to dashboard</button>}{open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><div className="modal" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Dappster account"><div className="panel-head"><div><div className="panel-title">Your Dappster account</div><div style={{color:"#737b85",fontSize:12,marginTop:5}}>Linked wallets share credits, projects and subscriptions.</div></div><button className="btn btn-ghost" onClick={() => setOpen(false)}>×</button></div><div className="panel-body form-stack"><button className="btn btn-primary btn-block" onClick={() => { setOpen(false); router.push("/dashboard") }}>Open dashboard</button><div className="form-stack">{linkedWallets.map(wallet => <div className="deploy-result" key={`${wallet.chain}:${wallet.wallet_address}`}><div><span className="chain-badge">{wallet.chain === "evm" ? "EVM" : "Solana"}</span><div className="mono" style={{marginTop:7,fontSize:11}}>{wallet.wallet_address}</div></div><span className="status"><span className="status-dot" /> Linked</span></div>)}</div>{reownEnabled && linkedWallets.some(wallet => wallet.chain === "evm") && <button className="wallet-option" disabled={Boolean(loading)} onClick={() => connectEvm("walletConnect")}><span className="wallet-logo">{loading === "evm" ? <Loader2 className="animate-spin" size={17} /> : <img src="/chain-logos/ethereum.svg" alt="Ethereum" width={21} height={21} />}</span><span><strong>WalletConnect Ethereum</strong><small style={{display:"block",color:"#707883",marginTop:4}}>Reconnect the same EVM address with Zerion or another compatible wallet</small></span></button>}{!linkedWallets.some(wallet => wallet.chain === "evm") && <button className="wallet-option" disabled={Boolean(loading)} onClick={() => connectEvm()}><span className="wallet-logo">{loading === "evm" ? <Loader2 className="animate-spin" size={17} /> : <img src="/chain-logos/ethereum.svg" alt="Ethereum" width={21} height={21} />}</span><span><strong>Link EVM wallet</strong><small style={{display:"block",color:"#707883",marginTop:4}}>Share this account on Base and other EVM chains</small></span></button>}{!linkedWallets.some(wallet => wallet.chain === "solana") && <button className="wallet-option" disabled={Boolean(loading)} onClick={() => connectSolana()}><span className="wallet-logo">{loading === "solana" ? <Loader2 className="animate-spin" size={17} /> : <img src="/chain-logos/solana.svg" alt="Solana" width={21} height={21} />}</span><span><strong>Link Solana wallet</strong><small style={{display:"block",color:"#707883",marginTop:4}}>Use the same credits with Phantom</small></span></button>}{message && <p className="error-box" style={{fontSize:11,lineHeight:1.5}}>{message}</p>}<button className="btn btn-ghost btn-block" onClick={signOut}>Sign out of Dappster</button></div></div></div>}</div>

  const options = <><button className="wallet-option" disabled={Boolean(loading)} onClick={() => connectEvm()}><span className="wallet-logo">{loading === "evm" ? <Loader2 className="animate-spin" size={17} /> : <img src="/chain-logos/ethereum.svg" alt="Ethereum" width={21} height={21} />}</span><span><strong>Browser Ethereum</strong><small style={{display:"block",color:"#707883",marginTop:4}}>MetaMask, Rabby, Zerion and compatible extensions</small></span></button><button className="wallet-option" disabled={Boolean(loading)} onClick={() => connectSolana()}><span className="wallet-logo">{loading === "solana" ? <Loader2 className="animate-spin" size={17} /> : <img src="/chain-logos/solana.svg" alt="Solana" width={21} height={21} />}</span><span><strong>Phantom / Solana</strong><small style={{display:"block",color:"#707883",marginTop:4}}>Connect and sign a gasless message</small></span></button>{reownEnabled && <><div className="wallet-divider"><span>or connect with WalletConnect</span></div><div className="qr-login-grid"><button className="btn btn-outline" disabled={Boolean(loading)} onClick={() => connectEvm("walletConnect")}><img src="/chain-logos/ethereum.svg" alt="" width={16} height={16} /> WalletConnect Ethereum</button><button className="btn btn-outline" disabled={Boolean(loading)} onClick={connectSolanaQr}><img src="/chain-logos/solana.svg" alt="" width={16} height={16} /> WalletConnect Solana</button></div></>}{message && <p className="error-box" style={{fontSize:11,lineHeight:1.5,marginTop:12}}>{message}</p>}<p style={{color:"#5f6670",fontSize:11,lineHeight:1.5,margin:"18px 0 0"}}>Connection uses a secure, gasless authentication message. Dappster never takes custody of your assets.</p></>

  if (mode === "panel") return <div>{options}</div>
  return <><button className="btn btn-outline" onClick={() => { setMessage(""); setOpen(true) }}><span aria-hidden="true">◇</span> Connect wallet</button>{open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><div className="modal" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect wallet"><div className="panel-head"><div><div className="panel-title">Connect your wallet</div><div style={{color:"#737b85",fontSize:12,marginTop:5}}>Choose a network to sign in to Dappster.</div></div><button className="btn btn-ghost" onClick={() => setOpen(false)}>×</button></div><div className="panel-body">{options}</div></div></div>}</>
}
