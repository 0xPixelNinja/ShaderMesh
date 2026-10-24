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

INK = RGBColor(0x1A, 0x18, 0x14)
INK2 = RGBColor(0x3A, 0x36, 0x2F)
MUTED = RGBColor(0x5E, 0x59, 0x50)
FAINT = RGBColor(0x6F, 0x6A, 0x60)
LINE = RGBColor(0xE6, 0xE2, 0xDA)
LINE_STRONG = RGBColor(0xD3, 0xCE, 0xC4)
SURFACE = RGBColor(0xFB, 0xFA, 0xF7)
PANEL = RGBColor(0xF3, 0xF1, 0xEC)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ACCENT = RGBColor(0xD9, 0x77, 0x06)
ACCENT_TEXT = RGBColor(0xA3, 0x4A, 0x06)
ACCENT_WEAK = RGBColor(0xFD, 0xF3, 0xE1)
SUCCESS = RGBColor(0x13, 0x75, 0x35)
SUCCESS_WEAK = RGBColor(0xE8, 0xF4, 0xEC)
DANGER = RGBColor(0xB9, 0x1C, 0x1C)

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


def icon(slide, name, x, y, size):
    path = ICONS / f"{name}.png"
    if path.exists():
        slide.shapes.add_picture(str(path), x, y, width=size, height=size)


# ------------------------------------------------------------------- slides

REPORT = HERE.parent / "_report"
RFIG = REPORT / "figures"
RSCR = REPORT / "screens"
CROPS = DECK / "figures"
TOP = Inches(1.45)
BOTTOM = H - Inches(0.6)
CT = Inches(1.8)  # top of card-only slides


def place(slide, path, x, y, w, h, *, border=False):
    """Fit an image inside the box (x, y, w, h), centred, keeping its aspect."""
    from PIL import Image

    with Image.open(path) as im:
        aspect = im.width / im.height
    pw, ph = w, Emu(int(w / aspect))
    if ph > h:
        ph, pw = h, Emu(int(h * aspect))
    px, py = x + Emu(int((w - pw) / 2)), y + Emu(int((h - ph) / 2))
    pic = slide.shapes.add_picture(str(path), px, py, width=pw, height=ph)
    if border:
        pic.line.color.rgb = LINE_STRONG
        pic.line.width = Pt(1)
    return px, py, pw, ph


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def side_panel(slide, x, y, w, h, items, *, title=None, tint=SURFACE, outline=LINE):
    """items: list of (headline, body) or plain strings."""
    card(slide, x, y, w, h, fill=tint, outline=outline)
    tf = textbox(slide, x + Inches(0.26), y + Inches(0.24), w - Inches(0.52), h - Inches(0.4))
    lines = []
    if title:
        lines.append((title, 11, True, ACCENT_TEXT, SANS, 8))
    for it in items:
        if isinstance(it, str):
            lines.append((it, 14, False, INK2, SANS, 8))
        else:
            lines.append((it[0], 17, True, INK, SANS, 3))
            lines.append((it[1], 15, False, MUTED, SANS, 14))
    write(tf, lines)


def fig_slide(prs, number, title, subtitle, image, items, *, panel_w=Inches(3.4),
              panel_title=None, note=""):
    slide = blank(prs)
    header(slide, title, subtitle)
    fw = W - 2 * MARGIN - panel_w - Inches(0.3)
    place(slide, image, MARGIN, TOP, fw, BOTTOM - TOP)
    side_panel(slide, W - MARGIN - panel_w, TOP, panel_w, BOTTOM - TOP, items, title=panel_title)
    footer(slide, number)
    notes(slide, note)
    return slide


def two_columns(slide, cols, *, height=Inches(4.3), item_size=18, gap_pt=16):
    cw = (W - 2 * MARGIN - Inches(0.4)) / 2
    for col, (title, tint, outline, tcol, items) in enumerate(cols):
        x = MARGIN + col * (cw + Inches(0.4))
        card(slide, x, CT, cw, height, fill=tint, outline=outline,
             width=Pt(1.5) if col else Pt(1))
        tf = textbox(slide, x + Inches(0.36), CT + Inches(0.3), cw - Inches(0.72), height - Inches(0.5))
        lines = [(title, 20, True, tcol, SANS, 16)]
        for it in items:
            if isinstance(it, str):
                lines.append((it, item_size, False, INK2, SANS, gap_pt))
            else:
                lines.append((it[0], 18, True, INK, SANS, 3))
                lines.append((it[1], 16, False, MUTED, SANS, 16))
        write(tf, lines)


def slide_title(prs):
    slide = blank(prs)
    gx, gy, cell, gap = MARGIN, Inches(0.85), Inches(0.12), Inches(0.04)
    for r in range(3):
        for c in range(3):
            sq = slide.shapes.add_shape(
                MSO_SHAPE.RECTANGLE, gx + c * (cell + gap), gy + r * (cell + gap), cell, cell)
            sq.fill.solid()
            sq.fill.fore_color.rgb = ACCENT if r == c else LINE_STRONG
            sq.line.fill.background()
            sq.shadow.inherit = False

    tf = textbox(slide, MARGIN, Inches(1.72), Inches(9), Inches(1.0))
    write(tf, [("ShaderMesh", 60, True, INK, SANS, 0)])
    tf = textbox(slide, MARGIN, Inches(2.8), Inches(10.5), Inches(0.5))
    write(tf, [("A decentralized marketplace for renting GPU compute on Ethereum",
                20, False, MUTED, SANS, 0)])
    rule(slide, MARGIN, Inches(3.55), Inches(1.6))

    tf = textbox(slide, MARGIN, Inches(3.9), Inches(9), Inches(1.2))
    write(tf, [
        ("[TEAM MEMBERS]", 18, True, INK, SANS, 6),
        ("Guide: [GUIDE NAME]", 16, False, INK2, SANS, 0),
    ])
    tf = textbox(slide, MARGIN, Inches(5.1), Inches(9), Inches(0.9))
    write(tf, [
        ("VIT-AP University", 15, False, INK2, SANS, 4),
        ("Final review  |  October 2026", 15, False, MUTED, SANS, 0),
    ])

    strip = ["solidity", "ethereum", "python", "nodejs", "typescript", "nextjs", "react", "docker", "nvidia"]
    sx = MARGIN
    for name in strip:
        icon(slide, name, sx, Inches(6.35), Inches(0.3))
        sx += Inches(0.52)
    footer(slide, 1, "")
    notes(slide, "Introduce the project and the team. Eight to ten minutes in total.")
    return slide


def slide_problem(prs):
    slide = blank(prs)
    header(slide, "Problem and why blockchain",
           "Renting compute from a stranger requires trusting the stranger.")
    two_columns(slide, [
        ("The problem", PANEL, LINE, INK, [
            ("Concentrated supply", "A few clouds set price while consumer GPUs sit idle."),
            ("Nothing to re-run", "A rented interval has no output to recompute and check."),
            ("Pay first, hope later", "No automatic remedy for downtime."),
        ]),
        ("Why a blockchain", ACCENT_WEAK, ACCENT, ACCENT_TEXT, [
            ("Neutral escrow", "Funds sit in a contract neither party controls."),
            ("Enforceable collateral", "Stake and slashing make downtime costly."),
            ("Public record", "Heartbeats and settlement are auditable."),
        ]),
    ])
    footer(slide, 2)
    notes(slide, "Rental has no checkable output, so trust must come from collateral and provable "
                 "availability. The chain is the trust, coordination and payment layer, not the compute layer.")
    return slide


def slide_what(prs, n):
    slide = blank(prs)
    header(slide, "What ShaderMesh is", "Two market modes share one staking, reputation and slashing layer.")
    pw = Inches(4.1)
    place(slide, RFIG / "system-context.png", MARGIN, TOP, W - 2 * MARGIN - pw - Inches(0.3), BOTTOM - TOP)
    x = W - MARGIN - pw
    h = (BOTTOM - TOP - Inches(0.25)) / 2
    card(slide, x, TOP, pw, h, fill=ACCENT_WEAK, outline=ACCENT, width=Pt(1.5))
    tf = textbox(slide, x + Inches(0.26), TOP + Inches(0.24), pw - Inches(0.52), h - Inches(0.4))
    write(tf, [("Rental (primary)", 18, True, ACCENT_TEXT, SANS, 4),
               ("GPU leases and model inference. Trust from stake, heartbeats and slashing.",
                16, False, INK2, SANS, 0)])
    y2 = TOP + h + Inches(0.25)
    card(slide, x, y2, pw, h)
    tf = textbox(slide, x + Inches(0.26), y2 + Inches(0.24), pw - Inches(0.52), h - Inches(0.4))
    write(tf, [("Verifiable task", 18, True, INK, SANS, 4),
               ("Jobs with checkable output. Trust from randomized re-execution.",
                16, False, INK2, SANS, 0)])
    footer(slide, n)
    notes(slide, "Rental is the headline use case. The verifiable task mode is retained and shares the same stake and slashing layer.")
    return slide


def slide_testing(prs, n):
    slide = blank(prs)
    header(slide, "Testing and gas cost", "Every layer has an automated suite, and CI runs all of them.")
    rows = [
        ("Contracts (Hardhat)", "42", "unit and scenario"),
        ("Provider agent", "58", "leases, challenges"),
        ("Orchestrator", "54 + 1 skipped", "skipped needs live stack"),
        ("Simulator", "15", "game economics"),
        ("Web (Playwright)", "30", "incl. 4 wallet-write"),
    ]
    tw = Inches(6.7)
    rh = Inches(0.64)
    card(slide, MARGIN, CT, tw, rh * (len(rows) + 1), fill=WHITE)
    for label, x_off in [("Suite", 0.25), ("Tests", 2.75), ("Covers", 4.45)]:
        tf = textbox(slide, MARGIN + Inches(x_off), CT + Inches(0.24), Inches(2.0), Inches(0.3))
        write(tf, [(label.upper(), 10.5, True, FAINT, SANS, 0)])
    y = CT + rh
    for name, count, covers in rows:
        rule(slide, MARGIN + Inches(0.25), y, tw - Inches(0.5), colour=LINE, thickness=Pt(1))
        tf = textbox(slide, MARGIN + Inches(0.25), y + Inches(0.18), Inches(2.5), Inches(0.4))
        write(tf, [(name, 14.5, True, INK, SANS, 0)])
        tf = textbox(slide, MARGIN + Inches(2.75), y + Inches(0.17), Inches(1.7), Inches(0.4))
        write(tf, [(count, 14.5, True, ACCENT_TEXT, MONO, 0)])
        tf = textbox(slide, MARGIN + Inches(4.45), y + Inches(0.06), Inches(2.1), Inches(0.52),
                     anchor=MSO_ANCHOR.MIDDLE)
        write(tf, [(covers, 12.5, False, MUTED, SANS, 0)])
        y += rh

    gx = MARGIN + tw + Inches(0.3)
    gw = W - MARGIN - gx
    gas = [
        ("rental.requestLease", "251,540"),
        ("rental.acceptLease", "154,207"),
        ("rental.heartbeat", "56,487"),
        ("rental.settle", "59,987"),
        ("registry.issueChallenge", "129,754"),
        ("registry.respondChallenge", "76,217"),
    ]
    grh = Inches(0.62)
    card(slide, gx, CT, gw, rh * (len(rows) + 1), fill=WHITE)
    tf = textbox(slide, gx + Inches(0.25), CT + Inches(0.24), Inches(2.0), Inches(0.3))
    write(tf, [("TRANSACTION", 10.5, True, FAINT, SANS, 0)])
    tf = textbox(slide, gx + gw - Inches(1.6), CT + Inches(0.24), Inches(1.35), Inches(0.3),
                 align=PP_ALIGN.RIGHT)
    write(tf, [("GAS USED", 10.5, True, FAINT, SANS, 0)])
    y = CT + Inches(0.62)
    for name, value in gas:
        rule(slide, gx + Inches(0.25), y, gw - Inches(0.5), colour=LINE, thickness=Pt(1))
        tf = textbox(slide, gx + Inches(0.25), y + Inches(0.13), gw - Inches(1.9), Inches(0.3))
        write(tf, [(name, 13, False, INK, MONO, 0)])
        tf = textbox(slide, gx + gw - Inches(1.6), y + Inches(0.12), Inches(1.35), Inches(0.3),
                     align=PP_ALIGN.RIGHT)
        write(tf, [(value, 14, True, ACCENT_TEXT, MONO, 0)])
        y += Inches(0.54)

    y = CT + rh * (len(rows) + 1) + Inches(0.25)
    card(slide, MARGIN, y, W - 2 * MARGIN, Inches(0.7), fill=SUCCESS_WEAK, outline=SUCCESS)
    tf = textbox(slide, MARGIN + Inches(0.3), y + Inches(0.2), W - 2 * MARGIN - Inches(0.6), Inches(0.35))
    write(tf, [("CI compiles and tests every component on each push. Playwright signs real transactions.",
                14.5, True, INK, SANS, 0)])
    footer(slide, n)
    notes(slide, "Counts are from the latest local run. The skipped orchestrator test is an integration test that needs a running stack. Gas figures come from the measured run in the report.")
    return slide


def slide_eval(prs, n):
    slide = blank(prs)
    header(slide, "Evaluation", "Detection odds and rental economics were measured.")
    gap = Inches(0.35)
    cw = (W - 2 * MARGIN - gap) / 2
    items = [
        ("chart-detection.png", "Spot-check break-even is at s* = 0.5."),
        ("chart-rental-economics.png", "Escrow conservation holds exactly."),
    ]
    for i, (img, take) in enumerate(items):
        x = MARGIN + i * (cw + gap)
        place(slide, RFIG / img, x, CT, cw, Inches(3.4))
        card(slide, x, CT + Inches(3.65), cw, Inches(0.85), fill=ACCENT_WEAK, outline=ACCENT, width=Pt(1.5))
        tf = textbox(slide, x + Inches(0.25), CT + Inches(3.65), cw - Inches(0.5), Inches(0.85),
                     anchor=MSO_ANCHOR.MIDDLE)
        write(tf, [(take, 16, True, INK, SANS, 0)])
    footer(slide, n)
    notes(slide, "Detection chart: cheating pays below the break-even spot-check rate and loses above it. "
                 "Rental economics: provider payout plus requester refund plus slash always equals escrow plus bond.")
    return slide


def slide_figure_cards(prs, n, title, subtitle, image, cards, note):
    """Wide figure on top, one row of short cards below."""
    slide = blank(prs)
    header(slide, title, subtitle)
    ch = Inches(1.25)
    place(slide, image, MARGIN, TOP, W - 2 * MARGIN, BOTTOM - TOP - ch - Inches(0.2))
    gap = Inches(0.25)
    cw = (W - 2 * MARGIN - gap * (len(cards) - 1)) / len(cards)
    y = BOTTOM - ch
    for i, (head, body) in enumerate(cards):
        x = MARGIN + i * (cw + gap)
        card(slide, x, y, cw, ch)
        tf = textbox(slide, x + Inches(0.2), y + Inches(0.18), cw - Inches(0.4), ch - Inches(0.3))
        write(tf, [(head, 15, True, INK, SANS, 3), (body, 13.5, False, MUTED, SANS, 0)])
    footer(slide, n)
    notes(slide, note)
    return slide


def slide_product(prs, n):
    from PIL import Image

    CROPS.mkdir(exist_ok=True)
    crop = CROPS / "landing-top.png"
    with Image.open(RSCR / "landing.png") as im:
        im.crop((0, 0, im.width, int(im.width * 0.625))).save(crop)
    slide = blank(prs)
    header(slide, "The product", "A web console and a public explorer, both reading the chain.")
    gap = Inches(0.35)
    cw = (W - 2 * MARGIN - gap) / 2
    shots = [(crop, "Landing page"), (RSCR / "explorer-challenges.png", "Explorer: benchmark challenges")]
    for i, (path, cap) in enumerate(shots):
        x = MARGIN + i * (cw + gap)
        px, py, pw, ph = place(slide, path, x, TOP + Inches(0.1), cw, Inches(3.9), border=True)
        tf = textbox(slide, x, py + ph + Inches(0.15), cw, Inches(0.35))
        write(tf, [(cap, 15, True, INK2, SANS, 0)])
    tf = textbox(slide, MARGIN, Inches(6.3), W - 2 * MARGIN, Inches(0.4))
    write(tf, [("Also built: dashboard, providers, model offers, rent flow, lease and event explorer.",
                15, False, MUTED, SANS, 0)])
    footer(slide, n)
    notes(slide, "Screenshots are from the running local stack.")
    return slide


def slide_live(prs, n):
    slide = blank(prs)
    header(slide, "Live on Sepolia", "The full path ran on a public testnet with a real GPU.")
    facts = [
        ("6", "contracts source-verified"),
        ("RTX 4070 Laptop", "provider GPU, attested"),
        ("#1", "listing"),
        ("qwen3:0.6b", "model offer #1"),
        ("28,919", "challenge #1 passed, about 289 tokens per second"),
        ("108 s", "time to answer"),
    ]
    gap = Inches(0.3)
    cw = (W - 2 * MARGIN - 2 * gap) / 3
    ch = Inches(2.15)
    for i, (value, label) in enumerate(facts):
        r, c = divmod(i, 3)
        x = MARGIN + c * (cw + gap)
        y = CT + Inches(0.1) + r * (ch + gap)
        passed = i in (4, 5)
        card(slide, x, y, cw, ch, fill=SUCCESS_WEAK if passed else SURFACE,
             outline=SUCCESS if passed else LINE, width=Pt(1.5) if passed else Pt(1))
        tf = textbox(slide, x + Inches(0.3), y + Inches(0.4), cw - Inches(0.6), ch - Inches(0.6))
        write(tf, [(value, 26, True, SUCCESS if passed else INK, MONO, 8),
                   (label, 14, False, MUTED, SANS, 0)])
    footer(slide, n)
    notes(slide, "Contract addresses and transaction hashes are in the final report.")
    return slide


def slide_limits(prs, n):
    slide = blank(prs)
    header(slide, "Limitations and future work", "The remaining trust assumptions are stated, not hidden.")
    two_columns(slide, [
        ("Limitations", PANEL, LINE, INK, [
            "The attester is still trusted to judge challenges.",
            "Providers submit their own heartbeats and pay the gas.",
            "One provider tested on a public network.",
            "No automatic check of rendering output.",
        ]),
        ("Future work", ACCENT_WEAK, ACCENT, ACCENT_TEXT, [
            "Decentralized judging.",
            "Relayed heartbeats.",
            "More providers and an L2 deployment.",
            "Perceptual verification for rendering.",
        ]),
    ], item_size=19)
    footer(slide, n)
    notes(slide, "Be direct about the attester: it is the main remaining trust assumption in the challenge design.")
    return slide


def slide_demo(prs, n):
    slide = blank(prs)
    header(slide, "Demo plan", "Shown live, in this order.")
    steps = [
        "Open the explorer and a lease",
        "Rent a model offer and ask a question",
        "Run a benchmark challenge and watch it settle",
        "Show the slash path on the local stack",
    ]
    lw = Inches(7.6)
    card(slide, MARGIN, CT, lw, Inches(4.0), fill=WHITE)
    y = CT + Inches(0.45)
    for i, step in enumerate(steps, start=1):
        badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, MARGIN + Inches(0.4), y, Inches(0.4), Inches(0.4))
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
        brun.font.size = Pt(14)
        brun.font.bold = True
        brun.font.color.rgb = INK
        brun.font.name = SANS
        tf = textbox(slide, MARGIN + Inches(1.05), y + Inches(0.04), lw - Inches(1.4), Inches(0.5))
        write(tf, [(step, 18, False, INK2, SANS, 0)])
        y += Inches(0.85)
    px = MARGIN + lw + Inches(0.3)
    side_panel(slide, px, CT, W - MARGIN - px, Inches(4.0), [
        ("Fallback", "If the network or GPU is unavailable, the same flow runs on the local stack."),
    ], tint=ACCENT_WEAK, outline=ACCENT)
    footer(slide, n)
    notes(slide, "Have the local stack running in the background before the talk starts.")
    return slide


def slide_end(prs, n):
    slide = blank(prs)
    rule(slide, MARGIN, Inches(2.6), Inches(0.9))
    tf = textbox(slide, MARGIN, Inches(2.85), Inches(10), Inches(1.2))
    write(tf, [("Thank you", 54, True, INK, SANS, 0)])
    tf = textbox(slide, MARGIN, Inches(4.1), Inches(10), Inches(0.6))
    write(tf, [("Questions", 22, False, MUTED, SANS, 0)])
    footer(slide, n, "")
    return slide


def main() -> None:
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H

    slide_title(prs)
    slide_problem(prs)
    slide_what(prs, 3)
    fig_slide(prs, 4, "Architecture", "Four off-chain components, one on-chain authority.",
              RFIG / "architecture.png",
              [("Contracts", "Escrow, stake, slashing."),
               ("Agent and orchestrator", "Serve and index. Untrusted."),
               ("Web", "Console and explorer.")],
              note="The chain holds value and decides outcomes. Everything else can be replaced or can lie without moving funds.")
    slide = blank(prs)
    header(slide, "Trust boundary", "Contracts move funds. Off-chain parts cannot hold funds or forge settlement.")
    place(slide, RFIG / "trust-boundary.png", MARGIN, TOP, W - 2 * MARGIN, BOTTOM - TOP + Inches(0.1))
    footer(slide, 5)
    notes(slide, "Contracts hold value and decide outcomes. The agent, orchestrator and web app are untrusted and cannot custody funds or forge results. The attester judges challenges and is the one trusted operator role.")
    fig_slide(prs, 6, "Rental lifecycle", "Escrow streams to the provider one interval at a time.",
              RFIG / "lease-state-machine.png",
              [("Proven prefix", "Escrow releases only for contiguous proven intervals."),
               ("Downtime", "The remainder is refunded and the bond is slashed.")],
              note="A missed interval cannot be back-filled, so payment follows proven availability.")
    slide_figure_cards(prs, 7, "Benchmark challenges", "Output speed is checked against a seeded hash chain.",
              RFIG / "challenge-state-machine.png",
              [("Seeded hash chain", "Work cannot be precomputed."),
               ("Failure", "Free stake is slashed to the treasury."),
               ("Expiry", "Anyone can expire a stale challenge."),
               ("Attester", "Still trusted to judge.")],
              "This closes the gap where a provider claims hardware it does not have. The attester remains the trusted party.")
    fig_slide(prs, 8, "Token flow", "Every movement of value is on chain.",
              RFIG / "token-flow.png",
              [("In", "Requester escrow and provider stake."),
               ("Out", "Provider payout, refund, slash to treasury.")],
              note="Value only moves through contract calls.")
    slide_product(prs, 9)
    slide_testing(prs, 10)
    slide_eval(prs, 11)
    slide_live(prs, 12)
    slide_limits(prs, 13)
    slide_demo(prs, 14)
    slide_end(prs, 15)

    prs.save(OUTPUT)
    print(f"wrote {OUTPUT} ({len(prs.slides._sldIdLst)} slides)")


if __name__ == "__main__":
    main()
