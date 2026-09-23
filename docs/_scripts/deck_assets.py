"""Generate the icons and figures used by the ShaderMesh presentation.

Icons come from Simple Icons (CC0 / MIT brand marks) and are recoloured to the
project palette. Figures are drawn here rather than reused from the Review 1 set,
so they describe the system as it now behaves: a rental market with interactive
GPU leases and provider-served inference.

    python docs/_scripts/deck_assets.py
"""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
import requests
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
DECK_DIR = HERE.parent / "_deck"
ICON_DIR = DECK_DIR / "icons"
FIG_DIR = DECK_DIR / "figures"

# Light design system, matching web/DESIGN.md.
PAPER = "#FFFFFF"
SURFACE = "#FAFAFA"
PANEL = "#F4F4F5"
LINE = "#E4E4E7"
LINE_STRONG = "#D4D4D8"
INK = "#18181B"
INK2 = "#3F3F46"
MUTED = "#52525B"
FAINT = "#71717A"
ACCENT = "#D97706"
ACCENT_WEAK = "#FEF3C7"
SUCCESS = "#15803D"
SUCCESS_WEAK = "#ECFDF5"
DANGER = "#B91C1C"
DANGER_WEAK = "#FEF2F2"

FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"
FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"

ICONS = {
    "solidity": "solidity",
    "python": "python",
    "nodejs": "nodedotjs",
    "nextjs": "nextdotjs",
    "docker": "docker",
    "ethereum": "ethereum",
    "typescript": "typescript",
    "react": "react",
    "postgresql": "postgresql",
    "ipfs": "ipfs",
    "nvidia": "nvidia",
    "ollama": "ollama",
    "openssl": "openssh",
    "git": "git",
}


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_MONO if mono else (FONT_BOLD if bold else FONT_REG), size)


def fetch_icons(colour: str = "3F3F46") -> None:
    """Download brand marks and rasterise them at presentation resolution."""
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for name, slug in ICONS.items():
        out = ICON_DIR / f"{name}.png"
        if out.exists():
            continue
        url = f"https://cdn.simpleicons.org/{slug}/{colour}"
        try:
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            cairosvg.svg2png(
                bytestring=response.content,
                write_to=str(out),
                output_width=256,
                output_height=256,
            )
            print(f"[icon] {name}")
        except Exception as exc:  # noqa: BLE001 - a missing mark must not stop the build
            print(f"[icon] skipped {name}: {exc}")


def text(draw, xy, value, size, *, bold=False, mono=False, fill=INK, anchor="la"):
    draw.text(xy, value, font=font(size, bold, mono), fill=fill, anchor=anchor)


def box(draw, rect, *, fill=PAPER, outline=LINE_STRONG, width=3, radius=14):
    draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=width)


def arrow(draw, start, end, *, fill=INK2, width=4, head=16):
    draw.line([start, end], fill=fill, width=width)
    x1, y1 = start
    x2, y2 = end
    if x1 == x2:  # vertical
        direction = 1 if y2 > y1 else -1
        draw.polygon(
            [(x2, y2), (x2 - head // 2, y2 - direction * head), (x2 + head // 2, y2 - direction * head)],
            fill=fill,
        )
    else:  # horizontal
        direction = 1 if x2 > x1 else -1
        draw.polygon(
            [(x2, y2), (x2 - direction * head, y2 - head // 2), (x2 - direction * head, y2 + head // 2)],
            fill=fill,
        )


def header(draw, title, subtitle, width):
    text(draw, (70, 54), title, 52, bold=True)
    text(draw, (72, 124), subtitle, 26, fill=MUTED)
    draw.line([(70, 172), (width - 70, 172)], fill=LINE_STRONG, width=2)


# --------------------------------------------------------------------- figures


def figure_architecture() -> None:
    W, H = 2400, 840
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    top = 50
    gap = 62
    col_w = (W - 220 - 3 * gap) // 4
    xs = [110 + i * (col_w + gap) for i in range(4)]

    tiers = [
        ("Web Dashboard", "Next.js 16 / React 19 / viem", ["Marketplace and leases", "Model playground", "Wallet signs every write"]),
        ("Orchestrator", "Node 20 / TypeScript / ethers", ["Indexes events to Postgres", "Read API and SSE", "Signed inference gateway"]),
        ("Provider Agent", "Python 3.11 / web3.py", ["Publishes capacity", "Accepts leases, heartbeats", "Serves OpenAI-compatible API"]),
        ("Lease Runtime", "Docker / CUDA / sshd", ["Requester gets a shell", "Host GPU attached", "Removed when lease ends"]),
    ]

    for x, (title, stack, points) in zip(xs, tiers):
        box(d, [x, top, x + col_w, top + 330], fill=SURFACE)
        text(d, (x + 28, top + 30), title, 34, bold=True)
        text(d, (x + 28, top + 78), stack, 21, mono=True, fill=ACCENT)
        for i, point in enumerate(points):
            text(d, (x + 28, top + 130 + i * 44), f"-  {point}", 23, fill=MUTED)

    for i in range(3):
        arrow(d, (xs[i] + col_w + 6, top + 165), (xs[i + 1] - 10, top + 165))

    # Chain tier
    chain_y = top + 430
    box(d, [110, chain_y, W - 110, chain_y + 250], fill=ACCENT_WEAK, outline=ACCENT, width=4)
    text(d, (150, chain_y + 30), "Smart Contracts", 36, bold=True)
    text(d, (152, chain_y + 80), "Solidity 0.8.24  |  Ethereum  |  the only value authority", 22, mono=True, fill=ACCENT)

    contracts = [
        ("RentalMarket", "listings, leases, streamed escrow, SLA slashing"),
        ("ProviderRegistry", "stake, bond, reputation, attestation"),
        ("InferenceMarket", "prepaid credits, metered settlement"),
        ("SmeshToken", "ERC-20 payment and staking asset"),
    ]
    cw = (W - 260) // 4
    for i, (name, role) in enumerate(contracts):
        cx = 150 + i * cw
        text(d, (cx, chain_y + 140), name, 26, bold=True, fill=INK)
        text(d, (cx, chain_y + 178), role, 19, fill=MUTED)

    for x in xs:
        arrow(d, (x + col_w // 2, top + 336), (x + col_w // 2, chain_y - 8), fill=ACCENT)

    text(d, (110, H - 56), "Wallet-signed transactions  |  read-only indexing  |  no service custodies funds",
         22, fill=FAINT)
    img.save(FIG_DIR / "architecture.png")
    print("[figure] architecture")


def figure_lifecycle() -> None:
    W, H = 2400, 800
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    steps = [
        ("1", "Request", "Requester funds escrow\nand binds a manifest", ACCENT),
        ("2", "Accept", "Agent accepts automatically\nand bonds its stake", ACCENT),
        ("3", "Serve", "GPU container starts\nwith SSH access", SUCCESS),
        ("4", "Prove", "One signed heartbeat\nper interval", SUCCESS),
        ("5", "Settle", "Escrow streams for the\nheartbeated prefix", SUCCESS),
    ]
    top = 50
    gap = 50
    bw = (W - 220 - 4 * gap) // 5
    for i, (num, title, body, colour) in enumerate(steps):
        x = 110 + i * (bw + gap)
        box(d, [x, top, x + bw, top + 300], fill=SURFACE)
        d.ellipse([x + 28, top + 28, x + 84, top + 84], fill=colour)
        text(d, (x + 56, top + 56), num, 30, bold=True, fill=PAPER, anchor="mm")
        text(d, (x + 104, top + 42), title, 34, bold=True)
        for j, line in enumerate(body.split("\n")):
            text(d, (x + 30, top + 128 + j * 40), line, 23, fill=MUTED)
        if i < len(steps) - 1:
            arrow(d, (x + bw + 6, top + 150), (x + bw + gap - 8, top + 150))

    # Outcomes
    oy = top + 400
    ow = (W - 260) // 2
    box(d, [110, oy, 110 + ow - 30, oy + 230], fill=SUCCESS_WEAK, outline=SUCCESS, width=4)
    text(d, (150, oy + 34), "Normal end", 34, bold=True, fill=SUCCESS)
    text(d, (150, oy + 92), "Requester ends the lease. The provider is paid for every", 23, fill=INK2)
    text(d, (150, oy + 130), "served interval, unused escrow is refunded, and the", 23, fill=INK2)
    text(d, (150, oy + 168), "bond is released. Reputation increases.", 23, fill=INK2)

    box(d, [110 + ow + 30, oy, W - 110, oy + 230], fill=DANGER_WEAK, outline=DANGER, width=4)
    text(d, (150 + ow + 30, oy + 34), "Missed heartbeats", 34, bold=True, fill=DANGER)
    text(d, (150 + ow + 30, oy + 92), "Anyone can terminate the lease. The provider keeps only", 23, fill=INK2)
    text(d, (150 + ow + 30, oy + 130), "the proven prefix, the remaining escrow is refunded, and", 23, fill=INK2)
    text(d, (150 + ow + 30, oy + 168), "the bond is slashed. Reputation falls.", 23, fill=INK2)

    text(d, (110, H - 52), "Missed intervals cannot be back-filled: a heartbeat is only valid for the current interval.",
         22, fill=FAINT)
    img.save(FIG_DIR / "lifecycle.png")
    print("[figure] lifecycle")


def figure_trust() -> None:
    W, H = 2400, 840
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    cols = [
        ("Requester", "controls keys", PANEL, INK, [
            "Signs every transaction",
            "Funds escrow up front",
            "Can end the lease at any time",
            "Never hands custody to a service",
        ]),
        ("Contracts", "the value authority", ACCENT_WEAK, ACCENT, [
            "Hold escrow and provider bond",
            "Release only the proven prefix",
            "Slash the bond on downtime",
            "Record reputation outcomes",
        ]),
        ("Provider", "untrusted worker", PANEL, INK, [
            "Stakes collateral to list",
            "Passes hardware attestation",
            "Proves uptime every interval",
            "Loses stake if it stops serving",
        ]),
    ]
    top = 50
    gap = 60
    cw = (W - 220 - 2 * gap) // 3
    for i, (title, tag, fill, accent_colour, points) in enumerate(cols):
        x = 110 + i * (cw + gap)
        box(d, [x, top, x + cw, top + 470], fill=fill,
            outline=ACCENT if i == 1 else LINE_STRONG, width=4 if i == 1 else 3)
        text(d, (x + 36, top + 34), title, 40, bold=True)
        text(d, (x + 38, top + 90), tag, 22, mono=True, fill=accent_colour)
        for j, point in enumerate(points):
            d.ellipse([x + 38, top + 152 + j * 74, x + 54, top + 168 + j * 74], fill=accent_colour)
            text(d, (x + 76, top + 143 + j * 74), point, 25, fill=INK2)

    band_y = top + 540
    box(d, [110, band_y, W - 110, band_y + 190], fill=SURFACE)
    text(d, (150, band_y + 32), "Design consequence", 30, bold=True)
    text(d, (150, band_y + 84),
         "Rented compute produces no output that can be recomputed and compared, so the protocol does not verify output.",
         25, fill=MUTED)
    text(d, (150, band_y + 126),
         "It verifies availability instead, using staking, signed per-interval heartbeats, attestation and slashing.",
         25, fill=MUTED)
    img.save(FIG_DIR / "trust.png")
    print("[figure] trust")


def main() -> None:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    fetch_icons()
    figure_architecture()
    figure_lifecycle()
    figure_trust()
    print(f"assets written to {DECK_DIR}")


if __name__ == "__main__":
    main()
