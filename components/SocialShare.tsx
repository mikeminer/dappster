"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Linkedin, MessageCircle, Send, Share2 } from "lucide-react"

type SocialShareProps = {
  dappId: string
  dappName: string
}

export function SocialShare({ dappId, dappName }: SocialShareProps) {
  const [copied, setCopied] = useState(false)
  const shareUrl = `https://dappster.fun/dapp/${encodeURIComponent(dappId)}`
  const shareText = `Check out ${dappName} on the Dappster Marketplace.`
  const encodedUrl = encodeURIComponent(shareUrl)
  const encodedText = encodeURIComponent(shareText)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function shareNative() {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: dappName, text: shareText, url: shareUrl }).catch(() => undefined)
      return
    }
    await copyLink()
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
  }

  return (
    <details className="share-control">
      <summary className="btn btn-outline"><Share2 size={14} aria-hidden="true" /> Share</summary>
      <div className="share-popover" aria-label={`Share ${dappName}`}>
        <button type="button" onClick={shareNative}><Share2 size={15} aria-hidden="true" /> Share from this device</button>
        <a href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`} target="_blank" rel="noreferrer"><span className="share-x" aria-hidden="true">X</span> Share on X</a>
        <a href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`} target="_blank" rel="noreferrer"><Send size={15} aria-hidden="true" /> Share on Telegram</a>
        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`} target="_blank" rel="noreferrer"><Linkedin size={15} aria-hidden="true" /> Share on LinkedIn</a>
        <a href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" /> Share on WhatsApp</a>
        <button type="button" onClick={copyLink}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Link copied" : "Copy link"}</button>
      </div>
    </details>
  )
}
