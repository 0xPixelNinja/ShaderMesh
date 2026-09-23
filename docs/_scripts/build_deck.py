"""Build the ShaderMesh presentation.

Light theme only, matching web/DESIGN.md. Run the asset generator first:

    python docs/_scripts/deck_assets.py
    python docs/_scripts/build_deck.py
"""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
DECK = HERE.parent / "_deck"
ICONS = DECK / "icons"
FIGURES = DECK / "figures"
OUTPUT = HERE.parent / "ShaderMesh-Presentation.pptx"

INK = RGBColor(0x18, 0x18, 0x1B)
INK2 = RGBColor(0x3F, 0x3F, 0x46)
MUTED = RGBColor(0x52, 0x52, 0x5B)
FAINT = RGBColor(0x71, 0x71, 0x7A)
LINE = RGBColor(0xE4, 0xE4, 0xE7)
LINE_STRONG = RGBColor(0xD4, 0xD4, 0xD8)
SURFACE = RGBColor(0xFA, 0xFA, 0xFA)
PANEL = RGBColor(0xF4, 0xF4, 0xF5)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ACCENT = RGBColor(0xD9, 0x77, 0x06)
ACCENT_WEAK = RGBColor(0xFE, 0xF3, 0xC7)
SUCCESS = RGBColor(0x15, 0x80, 0x3D)
SUCCESS_WEAK = RGBColor(0xEC, 0xFD, 0xF5)

SANS = "Segoe UI"
MONO = "Consolas"

W = Inches(13.333)
H = Inches(7.5)
MARGIN = Inches(0.62)


def blank(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = WHITE
    bg.line.fill.background()
    bg.shadow.inherit = False
    return slide


def textbox(slide, x, y, w, h, *, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    tf.paragraphs[0].alignment = align
    return tf


def write(tf, lines, *, first=True):
    """lines: list of (text, size, bold, colour, font, space_after_pt)."""
    for i, spec in enumerate(lines):
        value, size, bold, colour, fontname, space = spec
        p = tf.paragraphs[0] if (i == 0 and first) else tf.add_paragraph()
        p.alignment = tf.paragraphs[0].alignment
        run = p.add_run()
        run.text = value
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = colour
        run.font.name = fontname
        p.space_after = Pt(space)
        p.line_spacing = 1.15
    return tf


def card(slide, x, y, w, h, *, fill=SURFACE, outline=LINE, width=Pt(1), radius=0.035):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.color.rgb = outline
    shape.line.width = width
    shape.shadow.inherit = False
    shape.adjustments[0] = radius
    shape.text_frame.text = ""
    return shape


def rule(slide, x, y, w, colour=ACCENT, thickness=Pt(2.5)):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, thickness)
    shape.fill.solid()
    shape.fill.fore_color.rgb = colour
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def header(slide, title, subtitle):
    rule(slide, MARGIN, Inches(0.44), Inches(0.9))
    tf = textbox(slide, MARGIN, Inches(0.6), W - 2 * MARGIN, Inches(0.9))
    write(tf, [
        (title, 30, True, INK, SANS, 4),
        (subtitle, 13.5, False, MUTED, SANS, 0),
    ])


def footer(slide, number, label="ShaderMesh"):
    if label:
        tf = textbox(slide, MARGIN, H - Inches(0.52), W - 2 * MARGIN - Inches(1.1), Inches(0.3))
        write(tf, [(label, 10, False, FAINT, SANS, 0)])
    tf2 = textbox(slide, W - MARGIN - Inches(0.9), H - Inches(0.52), Inches(0.9), Inches(0.3),
                  align=PP_ALIGN.RIGHT)
    write(tf2, [(str(number), 10, True, FAINT, SANS, 0)])


def figure(slide, name, top, max_h):
    """Place a figure centred, fitted to the available height."""
    from PIL import Image

    path = FIGURES / name
    with Image.open(path) as im:
        aspect = im.width / im.height
    h = max_h
    w = Emu(int(h * aspect))
    if w > W - 2 * MARGIN:
        w = W - 2 * MARGIN
        h = Emu(int(w / aspect))
    slide.shapes.add_picture(str(path), Emu(int((W - w) / 2)), top, width=w, height=h)


def icon(slide, name, x, y, size):
    path = ICONS / f"{name}.png"
    if path.exists():
        slide.shapes.add_picture(str(path), x, y, width=size, height=size)


# ------------------------------------------------------------------- slides


def slide_title(prs):
    slide = blank(prs)

    # Logo mark: a three by three grid echoing the product mark.
    gx, gy, cell, gap = MARGIN, Inches(0.85), Inches(0.12), Inches(0.04)
    for r in range(3):
        for c in range(3):
            sq = slide.shapes.add_shape(
                MSO_SHAPE.RECTANGLE,
                gx + c * (cell + gap), gy + r * (cell + gap), cell, cell,
            )
            sq.fill.solid()
            sq.fill.fore_color.rgb = ACCENT if r == c else LINE_STRONG
            sq.line.fill.background()
            sq.shadow.inherit = False

    tf = textbox(slide, MARGIN, Inches(1.72), Inches(8.5), Inches(1.0))
    write(tf, [("ShaderMesh", 58, True, INK, SANS, 0)])

    tf = textbox(slide, MARGIN, Inches(2.74), Inches(8.5), Inches(0.5))
    write(tf, [("A decentralised marketplace for renting GPU compute on Ethereum",
                19, False, MUTED, SANS, 0)])

    rule(slide, MARGIN, Inches(3.42), Inches(1.6))

    tf = textbox(slide, MARGIN, Inches(3.72), Inches(8.5), Inches(1.0))
    write(tf, [
        ("Providers stake collateral, prove uptime each interval, and are slashed for downtime.",
         14.5, False, INK2, SANS, 5),
        ("Interactive GPU leases and provider-served model inference, settled on chain.",
         14.5, False, INK2, SANS, 0),
    ])

    facts = [
        ("GPU rental", "interactive leases with shell access"),
        ("Model inference", "metered per token and settled on chain"),
        ("Ethereum", "escrow, staking and slashing"),
    ]
    fx = MARGIN
    for value, label in facts:
        tf = textbox(slide, fx, Inches(4.82), Inches(2.6), Inches(0.75))
        write(tf, [
            (value, 15, True, ACCENT, SANS, 2),
            (label, 11, False, FAINT, SANS, 0),
        ])
        fx += Inches(2.78)

    # Team block, intended to be edited.
    tx, ty, tw = Inches(9.42), Inches(1.72), Inches(3.28)
    card(slide, tx, ty, tw, Inches(4.38), fill=SURFACE, outline=LINE)
    tf = textbox(slide, tx + Inches(0.3), ty + Inches(0.26), tw - Inches(0.6), Inches(0.3))
    write(tf, [("TEAM <number>", 10, True, ACCENT, SANS, 0)])
    tf = textbox(slide, tx + Inches(0.3), ty + Inches(0.58), tw - Inches(0.6), Inches(0.5))
    write(tf, [("<Team name>", 15, True, INK, SANS, 0)])

    rows = [
        ("<Member 1 name>", "<Roll number>"),
        ("<Member 2 name>", "<Roll number>"),
        ("<Member 3 name>", "<Roll number>"),
        ("<Member 4 name>", "<Roll number>"),
    ]
    y = ty + Inches(1.34)
    for name, roll in rows:
        tf = textbox(slide, tx + Inches(0.3), y, tw - Inches(0.6), Inches(0.5))
        write(tf, [
            (name, 12.5, False, INK2, SANS, 1),
            (roll, 10.5, False, FAINT, MONO, 0),
        ])
        y += Inches(0.6)

    rule(slide, tx + Inches(0.3), ty + Inches(3.82), tw - Inches(0.6), colour=LINE, thickness=Pt(1))
    tf = textbox(slide, tx + Inches(0.3), ty + Inches(3.95), tw - Inches(0.6), Inches(0.3))
    write(tf, [("Guide: <supervisor name>", 10.5, False, FAINT, SANS, 0)])

    # Technology strip.
    strip = ["solidity", "ethereum", "python", "nodejs", "typescript", "nextjs", "react", "docker", "nvidia"]
    sx = MARGIN
    for name in strip:
        icon(slide, name, sx, Inches(5.95), Inches(0.3))
        sx += Inches(0.52)

    tf = textbox(slide, MARGIN, Inches(6.46), Inches(8.6), Inches(0.4))
    write(tf, [("<Course code and name>   |   <Review number>   |   <Date>", 11, False, FAINT, SANS, 0)])
    footer(slide, 1, "")
    return slide


def slide_problem(prs):
    slide = blank(prs)
    header(slide, "Problem and approach", "Renting compute from an unknown provider requires trusting that provider.")

    left = [
        ("Supply is concentrated", "A small number of cloud providers set price and availability, while idle consumer GPUs remain unused."),
        ("Rented time cannot be re-executed", "A rented interval produces no output to recompute and compare, so re-execution based verification does not apply."),
        ("Payment is committed up front", "The requester pays for a window in advance and has no automatic remedy if the machine stops serving."),
    ]
    right = [
        ("Providers post collateral", "A provider stakes tokens to list capacity, and a further bond is locked for the duration of each lease."),
        ("Uptime is proven per interval", "The provider publishes a signed heartbeat for the current interval. A missed interval cannot be back-filled later."),
        ("Escrow settles per interval", "Escrow releases only for the contiguous proven prefix. Downtime refunds the remainder and slashes the bond."),
    ]

    cw = (W - 2 * MARGIN - Inches(0.4)) / 2
    for col, (items, title, tint, accent) in enumerate([
        (left, "Why this is hard", PANEL, INK),
        (right, "What ShaderMesh does", ACCENT_WEAK, ACCENT),
    ]):
        x = MARGIN + col * (cw + Inches(0.4))
        card(slide, x, Inches(1.68), cw, Inches(4.5), fill=tint,
             outline=ACCENT if col else LINE, width=Pt(1.5) if col else Pt(1))
        tf = textbox(slide, x + Inches(0.34), Inches(1.94), cw - Inches(0.68), Inches(0.4))
        write(tf, [(title, 17, True, accent, SANS, 0)])
        y = Inches(2.52)
        for headline, body in items:
            tf = textbox(slide, x + Inches(0.34), y, cw - Inches(0.68), Inches(1.1))
            write(tf, [
                (headline, 14.5, True, INK, SANS, 3),
                (body, 12, False, MUTED, SANS, 0),
            ])
            y += Inches(1.22)

    tf = textbox(slide, MARGIN, Inches(6.42), W - 2 * MARGIN, Inches(0.5))
    write(tf, [
        ("The chain provides trust, coordination and payment. Compute is never executed on chain.",
         13.5, True, INK, SANS, 0),
    ])
    footer(slide, 2)
    return slide


def slide_architecture(prs):
    slide = blank(prs)
    header(slide, "System architecture", "Four off-chain components, one on-chain authority.")
    figure(slide, "architecture.png", Inches(1.62), Inches(4.55))
    tf = textbox(slide, MARGIN, Inches(6.34), W - 2 * MARGIN, Inches(0.6))
    write(tf, [
        ("The agent and orchestrator are treated as untrusted. Neither holds user funds, and neither can "
         "force a payout. Settlement occurs only against the heartbeat history recorded on chain.",
         12, False, MUTED, SANS, 0),
    ])
    footer(slide, 3)
    return slide


def slide_trust(prs):
    slide = blank(prs)
    header(slide, "Trust model", "Availability is provable on chain. Output correctness is not.")
    figure(slide, "trust.png", Inches(1.62), Inches(4.55))
    tf = textbox(slide, MARGIN, Inches(6.34), W - 2 * MARGIN, Inches(0.6))
    write(tf, [
        ("A second market mode for verifiable tasks, using re-execution and challenge voting, is also "
         "implemented in the contracts for workloads whose output can be checked.",
         12, False, MUTED, SANS, 0),
    ])
    footer(slide, 4)
    return slide


def slide_lifecycle(prs):
    slide = blank(prs)
    header(slide, "Rental lifecycle", "Acceptance, settlement and termination proceed without operator intervention.")
    figure(slide, "lifecycle.png", Inches(1.62), Inches(4.4))
    tf = textbox(slide, MARGIN, Inches(6.22), W - 2 * MARGIN, Inches(0.7))
    write(tf, [
        ("Acceptance is automatic because a provider runs unattended. Requiring manual approval for each "
         "lease would conflict with the availability the market is selling.",
         12, False, MUTED, SANS, 0),
    ])
    footer(slide, 5)
    return slide


def slide_stack(prs):
    slide = blank(prs)
    header(slide, "Implementation and verification", "Each component is implemented, containerised and covered by an automated test suite.")

    components = [
        ("solidity", "Smart contracts", "Solidity 0.8.24", "Escrow, staking, slashing", "Hardhat, OpenZeppelin"),
        ("python", "Provider agent", "Python 3.11", "Lease serving, inference", "web3.py, Docker SDK"),
        ("nodejs", "Orchestrator", "Node 20, TypeScript", "Indexer, API, gateway", "ethers v6, Postgres"),
        ("nextjs", "Dashboard", "Next.js 16, React 19", "Marketplace and console", "viem, Tailwind"),
    ]
    cw = (W - 2 * MARGIN - Inches(0.34) * 3) / 4
    for i, (ic, name, stack, role, libs) in enumerate(components):
        x = MARGIN + i * (cw + Inches(0.34))
        card(slide, x, Inches(1.66), cw, Inches(2.15))
        icon(slide, ic, x + Inches(0.28), Inches(1.92), Inches(0.38))
        tf = textbox(slide, x + Inches(0.28), Inches(2.48), cw - Inches(0.56), Inches(1.7))
        write(tf, [
            (name, 15, True, INK, SANS, 3),
            (stack, 11, False, ACCENT, MONO, 6),
            (role, 12, False, INK2, SANS, 3),
            (libs, 11, False, FAINT, SANS, 0),
        ])

    # Infrastructure strip
    card(slide, MARGIN, Inches(4.01), W - 2 * MARGIN, Inches(0.92), fill=PANEL)
    tf = textbox(slide, MARGIN + Inches(0.28), Inches(4.23), Inches(1.5), Inches(0.5))
    write(tf, [("Runtime", 12, True, INK, SANS, 0)])
    infra = [("docker", "Docker"), ("postgresql", "Postgres"), ("ipfs", "IPFS"),
             ("nvidia", "CUDA GPU"), ("ollama", "Ollama"), ("ethereum", "Hardhat")]
    ix = MARGIN + Inches(1.6)
    for ic, label in infra:
        icon(slide, ic, ix, Inches(4.27), Inches(0.26))
        tf = textbox(slide, ix + Inches(0.32), Inches(4.26), Inches(1.28), Inches(0.35))
        write(tf, [(label, 11.5, False, INK2, SANS, 0)])
        ix += Inches(1.66)

    properties = [
        ("Sandboxed execution", "Lease containers run with CPU, memory and process limits, and are removed when the lease ends."),
        ("Recoverable index", "The event projection is durable and can be rebuilt from chain history after data loss."),
        ("Signed request routing", "The gateway verifies a wallet signature and routes only to the credited provider."),
        ("Reproducible stack", "The whole system starts from one compose file, including chain, storage and database."),
    ]
    pw = (W - 2 * MARGIN - Inches(0.34) * 3) / 4
    for i, (name, body) in enumerate(properties):
        x = MARGIN + i * (pw + Inches(0.34))
        card(slide, x, Inches(5.15), pw, Inches(1.4), fill=SUCCESS_WEAK, outline=SUCCESS, width=Pt(1))
        tf = textbox(slide, x + Inches(0.26), Inches(5.37), pw - Inches(0.52), Inches(1.05))
        write(tf, [
            (name, 12.5, True, SUCCESS, SANS, 3),
            (body, 10.5, False, MUTED, SANS, 0),
        ])
    footer(slide, 6)
    return slide


def slide_demo(prs):
    slide = blank(prs)
    header(slide, "Demonstration and status", "The demonstration runs locally on one machine against the GPU in it.")

    steps = [
        "Browse staked capacity and open a lease, escrow funded up front",
        "Provider agent accepts automatically and bonds 50 SMESH",
        "SSH into the leased container and run nvidia-smi on the provider GPU",
        "Watch heartbeats and escrow stream per interval, then settle on chain",
        "Call a model through a prepaid credit and settle metered usage",
        "Inspect the full event trail and the provider console",
    ]
    lw = Inches(7.15)
    card(slide, MARGIN, Inches(1.66), lw, Inches(4.05))
    tf = textbox(slide, MARGIN + Inches(0.32), Inches(1.9), lw - Inches(0.64), Inches(0.4))
    write(tf, [("Demonstration flow", 16, True, INK, SANS, 0)])
    y = Inches(2.42)
    for i, step in enumerate(steps, start=1):
        badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, MARGIN + Inches(0.32), y, Inches(0.3), Inches(0.3))
        badge.fill.solid()
        badge.fill.fore_color.rgb = ACCENT
        badge.line.fill.background()
        badge.shadow.inherit = False
        btf = badge.text_frame
        btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0
        btf.vertical_anchor = MSO_ANCHOR.MIDDLE
        bp = btf.paragraphs[0]
        bp.alignment = PP_ALIGN.CENTER
        brun = bp.add_run()
        brun.text = str(i)
        brun.font.size = Pt(11)
        brun.font.bold = True
        brun.font.color.rgb = WHITE
        brun.font.name = SANS

        tf = textbox(slide, MARGIN + Inches(0.78), y + Inches(0.02), lw - Inches(1.1), Inches(0.5))
        write(tf, [(step, 12.5, False, INK2, SANS, 0)])
        y += Inches(0.52)

    rx = MARGIN + lw + Inches(0.34)
    rw = W - MARGIN - rx
    card(slide, rx, Inches(1.66), rw, Inches(1.92), fill=SUCCESS_WEAK, outline=SUCCESS, width=Pt(1.5))
    tf = textbox(slide, rx + Inches(0.3), Inches(1.88), rw - Inches(0.6), Inches(1.6))
    write(tf, [
        ("Verified", 15, True, SUCCESS, SANS, 5),
        ("SSH session on an RTX 4070 obtained through a paid lease", 11.5, False, INK2, SANS, 3),
        ("gemma3:4b served from that GPU, 761 tokens metered and settled", 11.5, False, INK2, SANS, 3),
        ("Six contracts deployed and source-verified on Sepolia", 11.5, False, INK2, SANS, 0),
    ])

    card(slide, rx, Inches(3.78), rw, Inches(1.93), fill=SURFACE, outline=LINE)
    tf = textbox(slide, rx + Inches(0.3), Inches(4.0), rw - Inches(0.6), Inches(1.6))
    write(tf, [
        ("Next", 15, True, INK, SANS, 5),
        ("Signature-gated lease credentials", 11.5, False, MUTED, SANS, 3),
        ("Provider-signed usage receipts for inference", 11.5, False, MUTED, SANS, 3),
        ("On-chain benchmark challenge with slashing", 11.5, False, MUTED, SANS, 0),
    ])

    card(slide, MARGIN, Inches(5.92), W - 2 * MARGIN, Inches(0.86), fill=ACCENT_WEAK, outline=ACCENT, width=Pt(1.5))
    tf = textbox(slide, MARGIN + Inches(0.32), Inches(6.12), W - 2 * MARGIN - Inches(0.64), Inches(0.5))
    write(tf, [
        ("Missed heartbeats refund the requester and slash the provider bond, enforcing availability with collateral.",
         13, True, INK, SANS, 0),
    ])
    footer(slide, 7)
    return slide


def main() -> None:
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H

    slide_title(prs)
    slide_problem(prs)
    slide_architecture(prs)
    slide_trust(prs)
    slide_lifecycle(prs)
    slide_stack(prs)
    slide_demo(prs)

    prs.save(OUTPUT)
    print(f"wrote {OUTPUT} ({len(prs.slides.__iter__.__self__._sldIdLst)} slides)")


if __name__ == "__main__":
    main()
