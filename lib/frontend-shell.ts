import type { Abi } from "viem"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { buildSolanaImportAliases, buildSolanaRuntimeCompatibilityScript, extractCompiledSolanaIdl, inferLegacySolanaIdl, replaceSolanaProgramId, solanaBrowserRpcUrl, wrapSolanaBabelSource } from "@/lib/solana-frontend"

const DAPPSTER_RUNTIME_ORIGIN = "https://dappster.fun/runtime"
const PREVIEW_RUNTIME_ASSETS = {
  react: `${DAPPSTER_RUNTIME_ORIGIN}/react.production.min.js`,
  reactDom: `${DAPPSTER_RUNTIME_ORIGIN}/react-dom.production.min.js`,
  babel: `${DAPPSTER_RUNTIME_ORIGIN}/babel.min.js`,
} as const

const LEGACY_PREVIEW_RUNTIME_PATTERNS = [
  [/https:\/\/unpkg\.com\/react@[^/]+\/umd\/react\.production\.min\.js/g, PREVIEW_RUNTIME_ASSETS.react],
  [/https:\/\/unpkg\.com\/react-dom@[^/]+\/umd\/react-dom\.production\.min\.js/g, PREVIEW_RUNTIME_ASSETS.reactDom],
  [/https:\/\/unpkg\.com\/@babel\/standalone@[^/]+\/babel\.min\.js/g, PREVIEW_RUNTIME_ASSETS.babel],
] as const

export function rewritePreviewDependencies(html: string) {
  return LEGACY_PREVIEW_RUNTIME_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    html,
  )
}

function browserReadySource(frontendCode: string) {
  const defaultFunction = frontendCode.match(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)/)
  const defaultIdentifier = frontendCode.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/)
  const componentName = defaultFunction?.[1] || defaultIdentifier?.[1] || "App"
  const solanaImportAliases = buildSolanaImportAliases(frontendCode)
  return {
    componentName,
    source: `${solanaImportAliases}\n${frontendCode
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/export\s+default\s+function\s+/, "function ")
      .replace(/^\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, "")
      .replace(/<\/script/gi, "<\\/script")}`,
  }
}

function evmRuntimeChain(chainId?: number) {
  const chain = chainId ? getSupportedEvmChain(chainId) : undefined
  if (!chain) return undefined
  return {
    chainId: chain.id,
    chainIdHex: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
  }
}

function buildPreviewDiagnosticsScript(chain: string) {
  const requiredGlobals = chain === "solana"
    ? [["React", "React"], ["ReactDOM", "React DOM"], ["Babel", "Babel"], ["__DAPPSTER_SOLANA_RUNTIME__", "Solana runtime"]]
    : [["React", "React"], ["ReactDOM", "React DOM"], ["Babel", "Babel"]]
  const encodedGlobals = JSON.stringify(requiredGlobals).replace(/</g, "\\u003c")
  return `
    (function () {
      const requiredGlobals = ${encodedGlobals};
      let settled = false;
      let timeoutId;
      const root = () => document.getElementById("root");
      const messageOf = value => {
        if (!value) return "Unknown preview error";
        if (typeof value === "string") return value;
        return value.message || value.reason || String(value);
      };
      const notifyParent = (type, message) => {
        try { window.parent.postMessage({ source: "dappster-preview", type, message }, "*"); } catch {}
      };
      const showError = value => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const message = messageOf(value);
        const container = root();
        if (container) {
          container.replaceChildren();
          const panel = document.createElement("section");
          panel.className = "preview-error";
          const eyebrow = document.createElement("div");
          eyebrow.className = "preview-error-eyebrow";
          eyebrow.textContent = "PREVIEW ERROR";
          const title = document.createElement("h1");
          title.textContent = "The dApp could not start";
          const detail = document.createElement("pre");
          detail.textContent = message;
          const hint = document.createElement("p");
          hint.textContent = "Retry the preview. If it still fails, regenerate the frontend using the error above.";
          const retry = document.createElement("button");
          retry.type = "button";
          retry.textContent = "Retry preview";
          retry.addEventListener("click", () => window.location.reload());
          const regenerate = document.createElement("button");
          regenerate.type = "button";
          regenerate.className = "preview-error-secondary";
          regenerate.textContent = "Regenerate frontend";
          regenerate.addEventListener("click", () => {
            regenerate.disabled = true;
            regenerate.textContent = "Regenerating frontend…";
            notifyParent("regenerate", message);
          });
          const actions = document.createElement("div");
          actions.className = "preview-error-actions";
          actions.append(retry, regenerate);
          panel.append(eyebrow, title, detail, hint, actions);
          container.append(panel);
        }
        notifyParent("error", message);
      };
      window.__DAPPSTER_PREVIEW__ = {
        fail: showError,
        ready: () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          notifyParent("ready", "Preview ready");
        },
      };
      window.addEventListener("error", event => showError(event.error || event.message));
      window.addEventListener("unhandledrejection", event => showError(event.reason));
      window.addEventListener("load", () => {
        const missing = requiredGlobals.filter(([globalName]) => !window[globalName]).map(([, label]) => label);
        if (missing.length) showError("Required preview dependency failed to load: " + missing.join(", "));
      });
      timeoutId = window.setTimeout(() => {
        const container = root();
        if (container && container.querySelector(".boot")) {
          showError("The generated frontend did not render within 20 seconds.");
        }
      }, 20000);
    })();
  `
}

function buildBrowserModuleResolverScript(chain: string) {
  const solanaModules = chain === "solana"
    ? `
      "@solana/web3.js": () => window.solanaWeb3 || window.__DAPPSTER_SOLANA_RUNTIME__?.web3,
      "@coral-xyz/anchor": () => window.anchor || window.__DAPPSTER_SOLANA_RUNTIME__?.anchor,
      "@project-serum/anchor": () => window.anchor || window.__DAPPSTER_SOLANA_RUNTIME__?.anchor,
      "@solana/spl-token": () => window.splToken || window.__DAPPSTER_SOLANA_RUNTIME__?.splToken,
      "@solana/wallet-adapter-phantom": () => window.phantomWalletAdapter || window.__DAPPSTER_SOLANA_RUNTIME__?.phantomWalletAdapter,
      "buffer": () => ({ Buffer: window.Buffer || window.__DAPPSTER_SOLANA_RUNTIME__?.Buffer }),`
    : ""
  return `
    (function () {
      const modules = {
        "react": () => window.React,
        "react-dom": () => window.ReactDOM,
        "react-dom/client": () => window.ReactDOM,
        "ethers": () => window.ethers,
        ${solanaModules}
      };
      window.require = function require(moduleName) {
        const load = modules[moduleName];
        if (!load) throw new Error("Unsupported browser dependency: " + moduleName + ". Regenerate the frontend without this package.");
        const moduleValue = load();
        if (!moduleValue) throw new Error("Browser dependency failed to load: " + moduleName);
        return moduleValue;
      };
    })();
  `
}

export function buildEvmRuntimeCompatibilityScript(contractAbi?: Abi, chainId?: number) {
  const abiAssignment = contractAbi
    ? { abi: contractAbi, evmChain: evmRuntimeChain(chainId) }
    : { evmChain: evmRuntimeChain(chainId) }
  const runtimeAssignment = JSON.stringify(abiAssignment).replace(/</g, "\\u003c")
  return `
    window.__DAPPSTER__ = Object.assign({}, window.__DAPPSTER__ || {}, ${runtimeAssignment});
    if (window.ethers) {
      const runtime = window.__DAPPSTER__;
      const targetChain = runtime.evmChain;
      const guardedProviders = runtime.__guardedEvmProviders || new WeakMap();
      const rawRequests = runtime.__rawEvmRequests || new WeakMap();
      runtime.__guardedEvmProviders = guardedProviders;
      runtime.__rawEvmRequests = rawRequests;
      runtime.ensureEvmChain = async function ensureEvmChain(provider, requestOverride) {
        if (!targetChain || !provider || typeof provider.request !== "function") return provider;
        const request = requestOverride || rawRequests.get(provider) || provider.request.bind(provider);
        const currentChainId = String(await request({ method: "eth_chainId" })).toLowerCase();
        if (currentChainId === targetChain.chainIdHex.toLowerCase()) return provider;
        if (!runtime.__chainSwitchPromise) {
          runtime.__chainSwitchPromise = (async () => {
            try {
              await request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: targetChain.chainIdHex }],
              });
            } catch (error) {
              const code = Number(error && (error.code ?? error?.data?.originalError?.code));
              if (code !== 4902) throw error;
              await request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: targetChain.chainIdHex,
                  chainName: targetChain.chainName,
                  nativeCurrency: targetChain.nativeCurrency,
                  rpcUrls: targetChain.rpcUrls,
                  blockExplorerUrls: targetChain.blockExplorerUrls,
                }],
              });
              await request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: targetChain.chainIdHex }],
              });
            }
            const confirmedChainId = String(await request({ method: "eth_chainId" })).toLowerCase();
            if (confirmedChainId !== targetChain.chainIdHex.toLowerCase()) {
              throw new Error("Switch your wallet to " + targetChain.chainName + " before continuing. No transaction was sent.");
            }
          })();
        }
        try {
          await runtime.__chainSwitchPromise;
        } finally {
          runtime.__chainSwitchPromise = null;
        }
        return provider;
      };
      runtime.guardEvmProvider = function guardEvmProvider(provider) {
        if (!targetChain || !provider || typeof provider.request !== "function") return provider;
        const existing = guardedProviders.get(provider);
        if (existing) return existing;
        const rawRequest = provider.request.bind(provider);
        rawRequests.set(provider, rawRequest);
        const protectedMethods = new Set([
          "eth_sendTransaction",
          "eth_signTransaction",
          "eth_sendRawTransaction",
          "eth_sign",
          "personal_sign",
          "eth_signTypedData",
          "eth_signTypedData_v1",
          "eth_signTypedData_v3",
          "eth_signTypedData_v4",
          "wallet_sendCalls",
        ]);
        const guardedRequest = async args => {
          const method = args && args.method;
          if (method === "eth_accounts") {
            const accounts = await rawRequest(args);
            if (Array.isArray(accounts) && accounts.length > 0) {
              await runtime.ensureEvmChain(provider, rawRequest);
            }
            return accounts;
          }
          if (method === "eth_requestAccounts") {
            const accounts = await rawRequest(args);
            await runtime.ensureEvmChain(provider, rawRequest);
            return accounts;
          }
          if (protectedMethods.has(method)) {
            await runtime.ensureEvmChain(provider, rawRequest);
          }
          return rawRequest(args);
        };
        let guarded = provider;
        try {
          provider.request = guardedRequest;
          if (provider.request !== guardedRequest) throw new Error("Provider request is read-only");
        } catch {
          guarded = new Proxy(provider, {
            get(target, property, receiver) {
              if (property === "request") return guardedRequest;
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        guardedProviders.set(provider, guarded);
        guardedProviders.set(guarded, guarded);
        return guarded;
      };
      if (targetChain && window.ethereum) {
        const guardedEthereum = runtime.guardEvmProvider(window.ethereum);
        if (guardedEthereum !== window.ethereum) {
          try { Object.defineProperty(window, "ethereum", { configurable: true, enumerable: true, writable: true, value: guardedEthereum }); } catch {}
        }
      }
      runtime.decodeError = function decodeError(error) {
        if (error && error.revert && error.revert.name) {
          const revertArgs = Array.from(error.revert.args || []).map(value => String(value));
          return "Transaction reverted: " + error.revert.name + "(" + revertArgs.join(", ") + ")";
        }
        const candidates = [];
        const queue = [error];
        const visited = new Set();
        while (queue.length && visited.size < 32) {
          const current = queue.shift();
          if (!current || (typeof current !== "object" && typeof current !== "string") || visited.has(current)) continue;
          if (typeof current === "string") {
            const matches = current.match(/0x[0-9a-fA-F]{8,}/g) || [];
            candidates.push(...matches);
            continue;
          }
          visited.add(current);
          for (const key of ["data", "result", "error", "info", "cause", "revert"]) {
            const value = current[key];
            if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) candidates.push(value);
            else if (value && typeof value === "object") queue.push(value);
          }
          if (typeof current.message === "string") queue.push(current.message);
        }
        if (Array.isArray(runtime.abi)) {
          const contractInterface = new window.ethers.Interface(runtime.abi);
          for (const data of candidates) {
            try {
              const parsed = contractInterface.parseError(data);
              if (parsed) {
                const args = Array.from(parsed.args || []).map(value => String(value));
                return "Transaction reverted: " + parsed.name + "(" + args.join(", ") + ")";
              }
            } catch {}
          }
        }
        return (error && (error.reason || error.shortMessage || error.message)) || "Transaction reverted";
      };
      const OriginalContract = window.ethers.Contract;
      const OriginalBrowserProvider = window.ethers.BrowserProvider;
      if (Array.isArray(runtime.abi) && OriginalContract) {
        const CompiledAbiContract = new Proxy(OriginalContract, {
          construct(target, args) {
            const nextArgs = Array.from(args);
            nextArgs[1] = runtime.abi;
            return Reflect.construct(target, nextArgs, target);
          }
        });
        window.ethers = Object.assign({}, window.ethers, { Contract: CompiledAbiContract });
      }
      if (targetChain && OriginalBrowserProvider) {
        const ChainSafeBrowserProvider = new Proxy(OriginalBrowserProvider, {
          construct(target, args) {
            const nextArgs = Array.from(args);
            nextArgs[0] = runtime.guardEvmProvider(nextArgs[0]);
            return Reflect.construct(target, nextArgs, target);
          },
        });
        window.ethers = Object.assign({}, window.ethers, { BrowserProvider: ChainSafeBrowserProvider });
      }
      Object.assign(window, window.ethers);
    }
  `
}

export function buildHTMLShell(frontendCode: string, contractAddress: string, chain: string, preview = false, contractAbi?: Abi, evmChainId?: number, solanaCluster?: "devnet" | "mainnet-beta") {
  const prepared = browserReadySource(frontendCode)
  const solanaIdl = chain === "solana"
    ? extractCompiledSolanaIdl(prepared.source, contractAddress) || inferLegacySolanaIdl(prepared.source, contractAddress)
    : undefined
  const preparedSource = chain === "solana" ? replaceSolanaProgramId(prepared.source, contractAddress) : prepared.source
  const runtime = JSON.stringify({
    contractAddress,
    chain,
    preview,
    abi: contractAbi || null,
    evmChain: chain === "evm" ? evmRuntimeChain(evmChainId) : undefined,
    solanaCluster: chain === "solana" ? solanaCluster : undefined,
    solanaRpcUrl: chain === "solana" && solanaCluster
      ? solanaBrowserRpcUrl(solanaCluster)
      : undefined,
  }).replace(/</g, "\\u003c")
  const evmCompatibility = buildEvmRuntimeCompatibilityScript(contractAbi, chain === "evm" ? evmChainId : undefined)
  const solanaCompatibility = buildSolanaRuntimeCompatibilityScript(solanaIdl, solanaCluster)
  const previewDiagnostics = preview ? buildPreviewDiagnosticsScript(chain) : ""
  const browserModuleResolver = buildBrowserModuleResolverScript(chain)
  const previewReady = preview
    ? `requestAnimationFrame(() => requestAnimationFrame(() => window.__DAPPSTER_PREVIEW__?.ready()));`
    : ""
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Dappster dApp</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="${PREVIEW_RUNTIME_ASSETS.react}"></script>
  <script crossorigin src="${PREVIEW_RUNTIME_ASSETS.reactDom}"></script>
  <script src="https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js"></script>
  ${chain === "solana" ? '<script src="https://dappster.fun/runtime/solana-runtime.js"></script>' : ""}
  <script src="${PREVIEW_RUNTIME_ASSETS.babel}"></script>
  <style>
    html,body,#root{min-height:100%;margin:0}
    body{background:#09090b;color:#fafafa;font-family:Arial,sans-serif}
    .boot{display:grid;min-height:100vh;place-items:center;color:#a1a1aa}
    .preview-error{box-sizing:border-box;display:flex;min-height:100vh;max-width:760px;margin:auto;padding:clamp(28px,7vw,72px);flex-direction:column;justify-content:center;gap:14px}
    .preview-error-eyebrow{color:#c7ff32;font:700 12px/1.2 monospace;letter-spacing:.12em}
    .preview-error h1{margin:0;font-size:clamp(28px,6vw,52px);line-height:1.02}
    .preview-error pre{overflow:auto;margin:0;padding:16px;border:1px solid #3f3f46;border-radius:12px;background:#111216;color:#fda4af;white-space:pre-wrap;word-break:break-word;font:13px/1.5 monospace}
    .preview-error p{margin:0;color:#a1a1aa;line-height:1.55}
    .preview-error-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .preview-error button{padding:11px 16px;border:1px solid #c7ff32;border-radius:9px;background:#c7ff32;color:#080a08;font-weight:800;cursor:pointer}
    .preview-error button.preview-error-secondary{background:transparent;color:#c7ff32}
    .preview-error button:disabled{cursor:wait;opacity:.65}
    #dappster-built-with{
      position:fixed!important;
      right:16px!important;
      bottom:16px!important;
      z-index:2147483647!important;
      display:inline-flex!important;
      align-items:center!important;
      gap:8px!important;
      min-height:38px!important;
      padding:6px 11px 6px 7px!important;
      border:1px solid rgba(199,255,50,.38)!important;
      border-radius:999px!important;
      background:rgba(7,8,10,.92)!important;
      color:#f2f3f5!important;
      font:700 12px/1 Arial,sans-serif!important;
      letter-spacing:0!important;
      text-decoration:none!important;
      box-shadow:0 10px 32px rgba(0,0,0,.4),0 0 22px rgba(199,255,50,.08)!important;
      backdrop-filter:blur(12px)!important;
      -webkit-backdrop-filter:blur(12px)!important;
      transition:transform .18s ease,border-color .18s ease!important;
    }
    #dappster-built-with:hover{transform:translateY(-2px)!important;border-color:#c7ff32!important}
    #dappster-built-with:focus-visible{outline:2px solid #c7ff32!important;outline-offset:3px!important}
    #dappster-built-with .dappster-mark{display:grid!important;width:26px!important;height:26px!important;place-items:center!important;color:#c7ff32!important}
    #dappster-built-with svg{display:block!important;width:26px!important;height:26px!important}
    #dappster-built-with .dappster-dot{color:#c7ff32!important}
    @media(max-width:520px){
      #dappster-built-with{right:10px!important;bottom:10px!important;min-height:34px!important;padding:4px 9px 4px 5px!important;font-size:11px!important}
      #dappster-built-with .dappster-mark,#dappster-built-with svg{width:24px!important;height:24px!important}
    }
  </style>
</head>
<body>
  <div id="root"><div class="boot">Loading dApp…</div></div>
  <a id="dappster-built-with" href="https://dappster.fun" target="_blank" rel="noopener noreferrer" aria-label="Built with Dappster — visit dappster.fun">
    <span class="dappster-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none"><path d="M7 5h10.4C23.8 5 27 8.9 27 15.8 27 23 23.2 27 16.7 27H7V5Z" stroke="currentColor" stroke-width="3"/><path d="M13 11h4.1c2.6 0 4 1.8 4 4.8 0 3.3-1.6 5.2-4.2 5.2H13V11Z" fill="currentColor"/></svg>
    </span>
    <span>Built with dappster<span class="dappster-dot">.</span>fun</span>
  </a>
  ${preview ? `<script>${previewDiagnostics}</script>` : ""}
  <script>window.__DAPPSTER__=${runtime};</script>
  <script>
    ${evmCompatibility}
    ${solanaCompatibility}
    if (window.solanaWeb3) Object.assign(window, window.solanaWeb3);
    ${browserModuleResolver}
  </script>
  <script type="text/babel" data-presets="env,react,typescript" data-filename="App.tsx">
    ${chain === "solana" ? wrapSolanaBabelSource(`
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    ${preparedSource}
    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(${prepared.componentName}));
    ${previewReady}
    `) : `
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    ${preparedSource}
    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(${prepared.componentName}));
    ${previewReady}
    `}
  </script>
</body>
</html>`
}
