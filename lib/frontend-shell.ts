import type { Abi } from "viem"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { buildSolanaImportAliases, buildSolanaRuntimeCompatibilityScript, inferLegacySolanaIdl, replaceSolanaProgramId, wrapSolanaBabelSource } from "@/lib/solana-frontend"

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

export function buildHTMLShell(frontendCode: string, contractAddress: string, chain: string, preview = false, contractAbi?: Abi, evmChainId?: number) {
  const prepared = browserReadySource(frontendCode)
  const solanaIdl = chain === "solana" ? inferLegacySolanaIdl(prepared.source, contractAddress) : undefined
  const preparedSource = chain === "solana" ? replaceSolanaProgramId(prepared.source, contractAddress) : prepared.source
  const runtime = JSON.stringify({ contractAddress, chain, preview, abi: contractAbi || null, evmChain: chain === "evm" ? evmRuntimeChain(evmChainId) : undefined }).replace(/</g, "\\u003c")
  const evmCompatibility = buildEvmRuntimeCompatibilityScript(contractAbi, chain === "evm" ? evmChainId : undefined)
  const solanaCompatibility = buildSolanaRuntimeCompatibilityScript(solanaIdl)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Dappster dApp</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js"></script>
  <script src="https://unpkg.com/@solana/web3.js@1.98.4/lib/index.iife.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.26.2/babel.min.js"></script>
  <style>
    html,body,#root{min-height:100%;margin:0}
    body{background:#09090b;color:#fafafa;font-family:Arial,sans-serif}
    .boot{display:grid;min-height:100vh;place-items:center;color:#a1a1aa}
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
  <script>window.__DAPPSTER__=${runtime};</script>
  <script>
    ${evmCompatibility}
    ${solanaCompatibility}
    if (window.solanaWeb3) Object.assign(window, window.solanaWeb3);
  </script>
  <script type="text/babel" data-presets="env,react,typescript" data-filename="App.tsx">
    ${chain === "solana" ? wrapSolanaBabelSource(`
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    ${preparedSource}
    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(${prepared.componentName}));
    `) : `
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    ${preparedSource}
    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(${prepared.componentName}));
    `}
  </script>
</body>
</html>`
}
