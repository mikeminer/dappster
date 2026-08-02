from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Dappster-Technical-Overview.pdf"
PUBLIC = ROOT / "public" / "docs" / "Dappster-Technical-Overview.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
PUBLIC.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = A4
ACID = colors.HexColor("#B9F227")
INK = colors.HexColor("#101315")
MUTED = colors.HexColor("#58616B")
LINE = colors.HexColor("#D9DEE2")
PANEL = colors.HexColor("#F3F5F6")
WHITE = colors.white


class NumberedCanvasMixin:
    pass


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 16 * mm, PAGE_W - 18 * mm, 16 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10.5 * mm, "DAPPSTER TECHNICAL OVERVIEW - VERSION 1.0")
    canvas.drawRightString(PAGE_W - 18 * mm, 10.5 * mm, f"{doc.page}")
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=22 * mm,
    title="Dappster Technical Overview",
    author="Dappster",
    subject="Architecture, transaction flows, security controls, and trust boundaries",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates(PageTemplate(id="standard", frames=frame, onPage=draw_page))

styles = getSampleStyleSheet()
title = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=30, leading=31, textColor=INK, alignment=TA_LEFT, spaceAfter=10)
subtitle = ParagraphStyle("Subtitle", parent=styles["BodyText"], fontName="Helvetica", fontSize=11.5, leading=18, textColor=MUTED, spaceAfter=14)
kicker = ParagraphStyle("Kicker", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=colors.HexColor("#6D8E13"), uppercase=True, spaceBefore=4, spaceAfter=6)
h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=INK, spaceBefore=16, spaceAfter=9)
h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceBefore=10, spaceAfter=5)
body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=14.2, textColor=colors.HexColor("#333A40"), spaceAfter=8)
small = ParagraphStyle("Small", parent=body, fontSize=7.6, leading=11.5, textColor=MUTED)
bullet = ParagraphStyle("Bullet", parent=body, leftIndent=12, firstLineIndent=-8, bulletIndent=2, spaceAfter=5)
code = ParagraphStyle("Code", parent=body, fontName="Courier", fontSize=7.2, leading=10, textColor=INK, wordWrap="CJK")
callout_title = ParagraphStyle("CalloutTitle", parent=body, fontName="Helvetica-Bold", fontSize=10, textColor=INK, spaceAfter=3)


def section(number, label, heading, paragraphs=None):
    story.append(Paragraph(f"{number:02d} / {label.upper()}", kicker))
    story.append(Paragraph(heading, h1))
    for text in paragraphs or []:
        story.append(Paragraph(text, body))


def bullets(items):
    for item in items:
        story.append(Paragraph(item, bullet, bulletText="-"))


def steps(items):
    data = []
    for index, item in enumerate(items, start=1):
        badge = Paragraph(f"<b>{index}</b>", ParagraphStyle(f"badge-{index}", parent=body, textColor=colors.HexColor("#6D8E13"), alignment=1))
        data.append([badge, Paragraph(item, small)])
    table = Table(data, colWidths=[10 * mm, doc.width - 10 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(table)
    story.append(Spacer(1, 8))


story = []
story.append(Spacer(1, 8 * mm))
story.append(Paragraph("// SECURITY AND ARCHITECTURE", kicker))
story.append(Paragraph("Dappster technical overview", title))
story.append(Paragraph("Architecture, transaction flows, security controls, and trust boundaries for dappster.fun", subtitle))
meta = Table([
    [Paragraph("VERSION", kicker), Paragraph("PUBLISHED", kicker), Paragraph("CANONICAL DOMAIN", kicker)],
    [Paragraph("1.0", body), Paragraph("July 31, 2026", body), Paragraph("https://dappster.fun", body)],
], colWidths=[35 * mm, 50 * mm, doc.width - 85 * mm])
meta.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PANEL),
    ("BOX", (0, 0), (-1, -1), 0.6, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(meta)
story.append(Spacer(1, 12))
callout = Table([[Paragraph("KEY CUSTODY STATEMENT", callout_title), Paragraph("Dappster does not request, collect, or store EVM or user Solana seed phrases and private keys. Users approve wallet connection, payments, credit burns, and deployment-related signatures in their own wallet.", body)]], colWidths=[46 * mm, doc.width - 46 * mm])
callout.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F9E7")),
    ("BOX", (0, 0), (-1, -1), 1, ACID),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(callout)

section(1, "Executive summary", "What Dappster does", [
    "Dappster is an AI-assisted application builder that generates smart-contract source, frontend source, deployment instructions, and optional automated audit reports. Users can review and preview generated artifacts before deployment.",
    "On EVM networks, deployments remain non-custodial: the connected wallet signs and broadcasts contract creation. On Solana, a disclosed, user-funded technical wallet performs program deployment only after wallet-signed funding and authorization, then transfers program upgrade authority to the user.",
])

section(2, "Architecture", "System components")
architecture = [
    [Paragraph("WEB APPLICATION", kicker), Paragraph("GENERATION AND AUDIT", kicker)],
    [Paragraph("Next.js and TypeScript on Vercel. wagmi/viem and WalletConnect-compatible EVM connectors; Solana wallet adapter.", small), Paragraph("Server-side structured AI output. Restricted Solidity compilation and isolated Solana builds.", small)],
    [Paragraph("DATA AND AUTHORIZATION", kicker), Paragraph("PUBLISHING", kicker)],
    [Paragraph("Supabase authentication, linked wallets, Postgres Row Level Security, owner-scoped records, and idempotent transaction synchronization.", small), Paragraph("Verified frontends are packaged with deployment metadata, pinned through Pinata, and served from IPFS gateways.", small)],
]
architecture_table = Table(architecture, colWidths=[doc.width / 2, doc.width / 2])
architecture_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PANEL),
    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(architecture_table)

section(3, "EVM deployment", "User-signed contract creation")
steps([
    "The authenticated user selects a supported EVM network and requests a generated contract and frontend.",
    "Dappster compiles Solidity with solc, permits bundled OpenZeppelin imports, and returns ABI and creation bytecode.",
    "The exact contract-creation payload is simulated against the selected chain RPC and gas is estimated before the wallet prompt.",
    "The connected wallet signs and submits deployment. Dappster never receives the wallet private key or seed phrase.",
    "The backend verifies receipt success, contract address, contract-creation form, exact 0.001 ETH value, fee recipient, and emitted fee event.",
    "Only after verification may the generated frontend be published to IPFS.",
])
fee_table = Table([
    [Paragraph("REQUIRED DEPLOYMENT VALUE", kicker), Paragraph("FEE RECIPIENT", kicker)],
    [Paragraph("<b>0.001 ETH</b>", body), Paragraph("0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134", code)],
], colWidths=[55 * mm, doc.width - 55 * mm])
fee_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F9E7")),
    ("BOX", (0, 0), (-1, -1), 0.8, ACID),
    ("INNERGRID", (0, 0), (-1, -1), 0.4, ACID),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(fee_table)
story.append(Spacer(1, 8))
story.append(Paragraph("The zero-argument payable constructor requires exactly 0.001 ETH, forwards it atomically to the disclosed recipient, and emits DappsterDeploymentFeePaid. If forwarding fails, deployment reverts. Network gas is separate.", body))

section(4, "Supported EVM networks", "Explicit allowlist")
network_rows = [[Paragraph("NETWORK", kicker), Paragraph("CHAIN ID", kicker), Paragraph("ENVIRONMENT", kicker)]]
for network, chain_id, environment in [
    ("Base", "8453", "Mainnet"), ("Ethereum", "1", "Mainnet"), ("Arbitrum One", "42161", "Mainnet"),
    ("OP Mainnet", "10", "Mainnet"), ("Linea", "59144", "Mainnet"), ("Robinhood Chain", "4663", "Mainnet"),
    ("Ethereum Sepolia", "11155111", "Testnet"), ("Base Sepolia", "84532", "Testnet"),
]:
    network_rows.append([Paragraph(f"<b>{network}</b>", small), Paragraph(chain_id, code), Paragraph(environment, small)])
network_table = Table(network_rows, colWidths=[doc.width * .5, doc.width * .22, doc.width * .28], repeatRows=1)
network_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), INK),
    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PANEL]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(network_table)

section(5, "Solana deployment", "Authorized, user-funded relayer")
steps([
    "Dappster compiles the generated Anchor program and calculates rent and deployment costs.",
    "The linked user wallet signs funding to the disclosed technical wallet with a unique deployment-job memo.",
    "The backend verifies cluster, sender, recipient, minimum amount, memo, signature status, and a separate deployment authorization.",
    "A job queue and cluster lock serialize deployment wallet usage.",
    "The technical wallet deploys with Solana's Upgradeable Loader, verifies the executable account, and transfers upgrade authority to the user.",
    "The frontend is published only after Program ID verification.",
])
story.append(Paragraph("The technical wallet is not used for EVM deployment. Mainnet SOL required for rent and deployment comes from the requesting user. Funding references cannot be reused across jobs.", body))

section(6, "Payments and credits", "On-chain settlement on Base")
bullets([
    "Credit packages and membership settle in native Circle USDC on Base.",
    "Production membership contract: 0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae.",
    "The backend credits an account only after verifying the successful receipt and exact USDC Transfer event.",
    "Credits are non-transferable ERC-1155 units. The normal flow asks the linked wallet to sign burnOwnCredits.",
    "Unique usage IDs and payment references make purchases and credit consumption idempotent.",
])

section(7, "Security controls", "Validation and access boundaries")
bullets([
    "Schema-validated and size-limited API inputs; explicit chain allowlist; restricted Solidity imports.",
    "Wallet-to-account linkage for payment, credit, and deployment actions.",
    "Backend verification of chain, sender where applicable, destination, amount, success, events, and deployed address.",
    "Postgres Row Level Security for profiles, private projects, audits, transactions, and deployment jobs.",
    "Replay resistance using usage IDs, memos, job IDs, transaction references, and unique database constraints.",
    "Same-origin, bounded client-error telemetry that excludes wallet secrets.",
])

section(8, "Trust boundaries", "What users must still verify", [
    "AI-generated code can contain defects. Compilation, transaction simulation, and automated audit output do not replace an independent professional security audit. Users can inspect source before deployment and should test high-value applications on a test network first. Wallet simulation and independent security providers remain additional protection layers.",
])

section(9, "Independent verification", "Public references")
refs = [
    ("Production", "https://dappster.fun"),
    ("Technical overview", "https://dappster.fun/technical-overview"),
    ("Marketplace", "https://dappster.fun/explore"),
    ("Base membership contract", "https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae"),
    ("Deployment fee recipient", "https://basescan.org/address/0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134"),
    ("Security contact", "mikforlani@gmail.com"),
]
ref_rows = [[Paragraph(f"<b>{label}</b>", small), Paragraph(value, code)] for label, value in refs]
ref_table = Table(ref_rows, colWidths=[46 * mm, doc.width - 46 * mm])
ref_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, -1), PANEL),
    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(KeepTogether(ref_table))

doc.build(story)
PUBLIC.write_bytes(OUTPUT.read_bytes())
print(OUTPUT)
print(PUBLIC)
