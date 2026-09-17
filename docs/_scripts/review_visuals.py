"""Generate the technical figures used by the Review 1 report and slides."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
IMAGE_DIR = HERE.parent / "_image"
SYSTEM_CONTEXT_OUTPUT = IMAGE_DIR / "ShaderMesh-Review1-System-Context.png"
ARCHITECTURE_OUTPUT = IMAGE_DIR / "ShaderMesh-Review1-Architecture.png"
RENTAL_SEQUENCE_OUTPUT = IMAGE_DIR / "ShaderMesh-Review1-Rental-Sequence.png"
TRUST_BOUNDARY_OUTPUT = IMAGE_DIR / "ShaderMesh-Review1-Trust-Boundary.png"

FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
MONO = r"C:\Windows\Fonts\consola.ttf"

INK = "#18181B"
SECONDARY = "#52525B"
LINE = "#3F3F46"
MUTED_LINE = "#A1A1AA"
PAPER = "#FCFCFB"
EXTERNAL = "#F4F4F5"
AMBER = "#B45309"
AMBER_FILL = "#FFFBEB"
BLUE_GRAY = "#E8EEF2"


def _font(size: int, bold: bool = False, mono: bool = False):
    return ImageFont.truetype(MONO if mono else (FONT_BOLD if bold else FONT), size)


def _text(draw, xy, value, size, *, bold=False, mono=False, fill=INK, anchor=None):
    draw.text(xy, value, font=_font(size, bold, mono), fill=fill, anchor=anchor)


def _multiline(draw, box, lines, size, *, bold=False, fill=INK, spacing=8, align="left"):
    x1, y1, x2, _ = box
    y = y1
    for line in lines:
        width = draw.textbbox((0, 0), line, font=_font(size, bold))[2]
        x = x1 + (x2 - x1 - width) / 2 if align == "center" else x1
        draw.text((x, y), line, font=_font(size, bold), fill=fill)
        y += size + spacing


def _dashed_line(draw, start, end, *, fill=MUTED_LINE, width=2, dash=14, gap=10):
    x1, y1 = start
    x2, y2 = end
    length = max(abs(x2 - x1), abs(y2 - y1))
    if length == 0:
        return
    count = int(length / (dash + gap)) + 1
    for index in range(count):
        begin = index * (dash + gap) / length
        finish = min((index * (dash + gap) + dash) / length, 1)
        if begin >= 1:
            break
        draw.line(
            (
                x1 + (x2 - x1) * begin,
                y1 + (y2 - y1) * begin,
                x1 + (x2 - x1) * finish,
                y1 + (y2 - y1) * finish,
            ),
            fill=fill,
            width=width,
        )


def _dashed_rect(draw, coords, *, fill=MUTED_LINE, width=3, dash=16, gap=10):
    x1, y1, x2, y2 = coords
    _dashed_line(draw, (x1, y1), (x2, y1), fill=fill, width=width, dash=dash, gap=gap)
    _dashed_line(draw, (x2, y1), (x2, y2), fill=fill, width=width, dash=dash, gap=gap)
    _dashed_line(draw, (x2, y2), (x1, y2), fill=fill, width=width, dash=dash, gap=gap)
    _dashed_line(draw, (x1, y2), (x1, y1), fill=fill, width=width, dash=dash, gap=gap)


def _arrow(draw, start, end, *, color=LINE, width=4, dashed=False, open_head=False):
    if dashed:
        _dashed_line(draw, start, end, fill=color, width=width)
    else:
        draw.line((start, end), fill=color, width=width)
    x1, y1 = start
    x2, y2 = end
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        points = [(x2, y2), (x2 - direction * 15, y2 - 9), (x2 - direction * 15, y2 + 9)]
    else:
        direction = 1 if y2 > y1 else -1
        points = [(x2, y2), (x2 - 9, y2 - direction * 15), (x2 + 9, y2 - direction * 15)]
    if open_head:
        draw.line((points[1], points[0], points[2]), fill=color, width=width)
    else:
        draw.polygon(points, fill=color)


def _relationship_label(draw, center, title, protocol, width=310):
    cx, cy = center
    draw.rounded_rectangle((cx - width / 2, cy - 34, cx + width / 2, cy + 34), radius=5, fill=PAPER)
    _text(draw, (cx, cy - 11), title, 18, bold=True, anchor="mm")
    _text(draw, (cx, cy + 14), protocol, 15, mono=True, fill=SECONDARY, anchor="mm")


def _system_box(draw, coords, stereotype, name, description, technology="", *, primary=False):
    x1, y1, x2, y2 = coords
    fill = AMBER_FILL if primary else EXTERNAL
    outline = AMBER if primary else LINE
    draw.rectangle(coords, fill=fill, outline=outline, width=4)
    _text(draw, (x1 + 24, y1 + 22), f"[{stereotype}]", 17, bold=True, fill=AMBER if primary else SECONDARY)
    _text(draw, (x1 + 24, y1 + 56), name, 29, bold=True)
    _multiline(draw, (x1 + 24, y1 + 108, x2 - 24, y2), description, 18, fill=SECONDARY, spacing=8)
    if technology:
        _text(draw, (x1 + 24, y2 - 34), technology, 15, mono=True, fill=SECONDARY)


def _person(draw, center, role, description):
    cx, cy = center
    draw.ellipse((cx - 30, cy - 90, cx + 30, cy - 30), fill=BLUE_GRAY, outline=LINE, width=3)
    draw.rectangle((cx - 58, cy - 22, cx + 58, cy + 100), fill=BLUE_GRAY, outline=LINE, width=3)
    _text(draw, (cx, cy + 130), f"[Person] {role}", 21, bold=True, anchor="mm")
    for index, line in enumerate(description):
        _text(draw, (cx, cy + 164 + index * 24), line, 16, fill=SECONDARY, anchor="mm")


def build_system_context() -> None:
    image = Image.new("RGB", (1800, 1120), PAPER)
    draw = ImageDraw.Draw(image)
    _text(draw, (80, 54), "System Context: ShaderMesh", 38, bold=True)
    _text(draw, (80, 105), "C4 level 1 | scope: actors, external systems, and trust relationships", 20, fill=SECONDARY)
    draw.line((80, 145, 1720, 145), fill=MUTED_LINE, width=2)

    _person(draw, (185, 400), "Requester", ["Rents compute or submits", "a deterministic job"])
    _person(draw, (1615, 400), "Provider", ["Supplies compute and", "operates the worker"])
    _system_box(
        draw,
        (585, 245, 1215, 615),
        "Software System",
        "ShaderMesh",
        [
            "Matches compute supply with demand.",
            "Coordinates leases and verifiable tasks.",
            "Keeps escrow and outcomes on chain.",
            "Routes workloads and model requests off chain.",
        ],
        "Web | Orchestrator | Provider agent | Contracts",
        primary=True,
    )
    _system_box(
        draw,
        (275, 805, 775, 1000),
        "External System",
        "Ethereum Network",
        ["Executes contracts and provides", "public consensus for settlement."],
        "EVM | JSON-RPC",
    )
    _system_box(
        draw,
        (1025, 805, 1525, 1000),
        "External System",
        "IPFS Network",
        ["Stores content-addressed manifests,", "inputs, and deterministic outputs."],
        "CID | HTTP API",
    )

    _arrow(draw, (300, 390), (585, 390))
    _relationship_label(draw, (442, 350), "Discovers and rents compute", "HTTPS + wallet transaction", 330)
    _arrow(draw, (1500, 500), (1215, 500))
    _relationship_label(draw, (1358, 458), "Publishes and serves capacity", "agent + HTTPS", 310)
    _arrow(draw, (760, 615), (585, 805), color=AMBER)
    _relationship_label(draw, (625, 700), "Escrow, stake, outcomes", "signed JSON-RPC transactions", 330)
    _arrow(draw, (1040, 615), (1275, 805))
    _relationship_label(draw, (1193, 700), "Stores and retrieves content", "CID + HTTP API", 330)

    draw.rectangle((80, 1045, 104, 1069), fill=AMBER_FILL, outline=AMBER, width=3)
    _text(draw, (120, 1057), "System under study", 16, anchor="lm")
    draw.rectangle((330, 1045, 354, 1069), fill=EXTERNAL, outline=LINE, width=3)
    _text(draw, (370, 1057), "External system", 16, anchor="lm")
    draw.rectangle((548, 1045, 572, 1069), fill=BLUE_GRAY, outline=LINE, width=3)
    _text(draw, (588, 1057), "Human actor", 16, anchor="lm")
    _arrow(draw, (770, 1057), (830, 1057), width=3)
    _text(draw, (850, 1057), "Directed, labelled relationship", 16, anchor="lm")
    image.save(SYSTEM_CONTEXT_OUTPUT, quality=95)


def _container(draw, coords, name, technology, lines, *, chain=False):
    x1, y1, x2, y2 = coords
    fill = AMBER_FILL if chain else "#FFFFFF"
    outline = AMBER if chain else LINE
    draw.rectangle(coords, fill=fill, outline=outline, width=3)
    _text(draw, (x1 + 20, y1 + 18), "[Container]", 14, bold=True, fill=AMBER if chain else SECONDARY)
    _text(draw, (x1 + 20, y1 + 48), name, 23, bold=True)
    _text(draw, (x1 + 20, y1 + 83), technology, 14, mono=True, fill=SECONDARY)
    _multiline(draw, (x1 + 20, y1 + 118, x2 - 20, y2), lines, 16, fill=SECONDARY, spacing=6)


def build_architecture() -> None:
    image = Image.new("RGB", (1800, 1120), PAPER)
    draw = ImageDraw.Draw(image)
    _text(draw, (80, 54), "Container Diagram: ShaderMesh", 38, bold=True)
    _text(draw, (80, 105), "C4 level 2 | deployable applications, data stores, and protocols", 20, fill=SECONDARY)
    draw.line((80, 145, 1720, 145), fill=MUTED_LINE, width=2)

    _person(draw, (155, 405), "Requester", ["Uses the marketplace", "and signs transactions"])
    _dashed_rect(draw, (300, 185, 1715, 1005), fill=AMBER, width=3)
    draw.rectangle((330, 170, 650, 210), fill=PAPER)
    _text(draw, (345, 190), "[Software System] ShaderMesh", 18, bold=True, fill=AMBER, anchor="lm")

    _container(draw, (370, 255, 700, 445), "Web Dashboard", "Next.js | React | viem", ["Marketplace, wallet actions,", "leases, models, playground"])
    _container(draw, (820, 255, 1150, 445), "Orchestrator", "Node.js | TypeScript | ethers", ["Indexes events, serves APIs,", "routes inference requests"])
    _container(draw, (1270, 255, 1600, 445), "Provider Agent", "Python | web3.py", ["Publishes capacity, observes", "leases, sends transactions"])
    _container(draw, (620, 700, 1030, 885), "Smart Contracts", "Solidity 0.8.24 | EVM", ["Escrow, stake, leases, jobs,", "reputation, dispute outcomes"], chain=True)
    _container(draw, (1270, 700, 1600, 885), "Lease Runtime", "Docker | CPU / optional GPU", ["Runs accepted workloads with", "resource and isolation limits"])

    _arrow(draw, (270, 385), (370, 385))
    _relationship_label(draw, (320, 340), "Uses", "HTTPS", 130)
    _arrow(draw, (700, 325), (820, 325))
    _relationship_label(draw, (760, 220), "Queries and inference", "HTTPS / JSON", 230)
    _arrow(draw, (700, 410), (700, 700), color=AMBER)
    _relationship_label(draw, (700, 565), "Submits lease actions", "wallet-signed JSON-RPC", 285)
    _arrow(draw, (985, 445), (985, 700), color=AMBER)
    _relationship_label(draw, (985, 565), "Reads event logs", "JSON-RPC", 190)
    _arrow(draw, (1150, 325), (1270, 325))
    _relationship_label(draw, (1210, 220), "Routes model request", "OpenAI HTTP", 225)
    draw.line((1435, 445, 1435, 600, 1030, 700), fill=AMBER, width=4)
    draw.polygon([(1030, 700), (1038, 682), (1047, 697)], fill=AMBER)
    _relationship_label(draw, (1260, 605), "Listing, heartbeat, result", "signed JSON-RPC", 285)
    _arrow(draw, (1510, 445), (1510, 700))
    _relationship_label(draw, (1510, 565), "Launches and monitors", "Docker Engine API", 230)

    _text(draw, (350, 955), "Legend:", 15, bold=True)
    draw.rectangle((430, 943, 454, 967), fill=AMBER_FILL, outline=AMBER, width=3)
    _text(draw, (470, 955), "on-chain value authority", 15, anchor="lm")
    draw.rectangle((690, 943, 714, 967), fill="#FFFFFF", outline=LINE, width=3)
    _text(draw, (730, 955), "off-chain container", 15, anchor="lm")
    _dashed_line(draw, (930, 955), (995, 955), fill=AMBER, width=3)
    _text(draw, (1010, 955), "ShaderMesh system boundary", 15, anchor="lm")
    image.save(ARCHITECTURE_OUTPUT, quality=95)


def _participant(draw, x, title, subtitle, *, chain=False):
    fill = AMBER_FILL if chain else EXTERNAL
    outline = AMBER if chain else LINE
    draw.rectangle((x - 145, 145, x + 145, 235), fill=fill, outline=outline, width=3)
    _text(draw, (x, 175), title, 21, bold=True, anchor="mm")
    _text(draw, (x, 208), subtitle, 15, mono=True, fill=SECONDARY, anchor="mm")
    _dashed_line(draw, (x, 235), (x, 1040), fill=MUTED_LINE, width=2, dash=14, gap=12)


def _message(draw, number, y, x1, x2, title, protocol="", *, dashed=False, amber=False):
    color = AMBER if amber else LINE
    _arrow(draw, (x1, y), (x2, y), color=color, width=3, dashed=dashed, open_head=dashed)
    label_x = (x1 + x2) / 2
    _text(draw, (label_x, y - 31), f"{number}. {title}", 17, bold=True, fill=color, anchor="mm")
    if protocol:
        _text(draw, (label_x, y - 9), protocol, 14, mono=True, fill=SECONDARY, anchor="mm")


def build_rental_sequence() -> None:
    image = Image.new("RGB", (1800, 1120), PAPER)
    draw = ImageDraw.Draw(image)
    _text(draw, (80, 48), "Dynamic View: Rental Lifecycle", 38, bold=True)
    _text(draw, (80, 98), "UML-style sequence | primary path with normal and timeout outcomes", 20, fill=SECONDARY)
    draw.line((80, 130, 1720, 130), fill=MUTED_LINE, width=2)

    xs = [220, 680, 1120, 1580]
    _participant(draw, xs[0], "Requester", "wallet + dashboard")
    _participant(draw, xs[1], "RentalMarket", "Solidity / EVM", chain=True)
    _participant(draw, xs[2], "Provider Agent", "Python / web3.py")
    _participant(draw, xs[3], "Lease Container", "Docker / optional GPU")

    _message(draw, 1, 285, xs[0], xs[1], "approve() and requestLease()", "manifest-bound transaction", amber=True)
    _message(draw, 2, 345, xs[1], xs[2], "LeaseRequested event", "event log", dashed=True, amber=True)
    _message(draw, 3, 405, xs[2], xs[1], "acceptLease()", "provider-signed transaction", amber=True)
    _message(draw, 4, 465, xs[1], xs[0], "LeaseAccepted event", "clock and bond start", dashed=True, amber=True)
    _message(draw, 5, 525, xs[2], xs[3], "start allowlisted workload", "Docker Engine API")
    _message(draw, 6, 580, xs[3], xs[2], "health status", "container inspection", dashed=True)

    draw.rectangle((570, 620, 1690, 765), outline=MUTED_LINE, width=2)
    draw.rectangle((570, 620, 760, 658), fill=BLUE_GRAY, outline=MUTED_LINE, width=2)
    _text(draw, (588, 639), "loop: each interval", 16, bold=True, anchor="lm")
    _message(draw, 7, 700, xs[2], xs[1], "heartbeat(leaseId)", "current interval only", amber=True)
    _message(draw, 8, 755, xs[0], xs[1], "settle(leaseId)", "completed heartbeated prefix", amber=True)

    draw.rectangle((110, 780, 1690, 1010), outline=MUTED_LINE, width=2)
    draw.rectangle((110, 780, 315, 818), fill=BLUE_GRAY, outline=MUTED_LINE, width=2)
    _text(draw, (128, 799), "alt: lease outcome", 16, bold=True, anchor="lm")
    draw.line((110, 895, 1690, 895), fill=MUTED_LINE, width=2)
    _text(draw, (950, 830), "[requester ends normally]", 15, mono=True, fill=SECONDARY, anchor="mm")
    _message(draw, 9, 880, xs[0], xs[1], "endLease() -> pay served intervals + refund remainder", "signed transaction", amber=True)
    _text(draw, (950, 920), "[heartbeat deadline + grace period exceeded]", 15, mono=True, fill=SECONDARY, anchor="mm")
    _message(draw, 10, 985, xs[0], xs[1], "terminate() -> refund unused escrow + slash bond", "permissionless transaction", amber=True)

    _text(draw, (80, 1073), "Notation:", 15, bold=True)
    _text(draw, (170, 1073), "solid = call/transaction", 15)
    _text(draw, (390, 1073), "dashed = event/response", 15)
    _text(draw, (640, 1073), "amber = on-chain trust transition", 15, fill=AMBER)
    _text(draw, (1015, 1073), "missed intervals cannot be covered retroactively", 15, bold=True, fill=SECONDARY)
    image.save(RENTAL_SEQUENCE_OUTPUT, quality=95)


def _zone(draw, coords, title, owner, *, chain=False):
    x1, y1, x2, y2 = coords
    color = AMBER if chain else MUTED_LINE
    _dashed_rect(draw, coords, fill=color, width=3)
    draw.rectangle((x1 + 18, y1 - 17, x1 + 320, y1 + 23), fill=PAPER)
    _text(draw, (x1 + 28, y1 + 3), title, 17, bold=True, fill=AMBER if chain else INK, anchor="lm")
    _text(draw, (x2 - 18, y1 + 3), owner, 14, mono=True, fill=SECONDARY, anchor="rm")


def _process(draw, coords, title, detail, *, chain=False):
    x1, y1, x2, y2 = coords
    fill = AMBER_FILL if chain else "#FFFFFF"
    outline = AMBER if chain else LINE
    draw.rectangle(coords, fill=fill, outline=outline, width=3)
    _text(draw, ((x1 + x2) / 2, y1 + 34), title, 21, bold=True, anchor="mm")
    _text(draw, ((x1 + x2) / 2, y1 + 72), detail, 14, mono=True, fill=SECONDARY, anchor="mm")


def build_trust_boundary() -> None:
    image = Image.new("RGB", (1800, 1220), PAPER)
    draw = ImageDraw.Draw(image)
    _text(draw, (80, 48), "Trust Boundary: Value and Workload Control", 38, bold=True)
    _text(draw, (80, 98), "Data-flow view | every boundary crossing is explicit", 20, fill=SECONDARY)
    draw.line((80, 130, 1720, 130), fill=MUTED_LINE, width=2)

    _zone(draw, (70, 190, 420, 1035), "Requester-controlled", "local device")
    _zone(draw, (500, 190, 855, 1035), "Public-chain trust", "Ethereum", chain=True)
    _zone(draw, (935, 190, 1275, 1035), "Routing service", "untrusted")
    _zone(draw, (1355, 190, 1730, 1035), "Provider-controlled", "worker host")

    _process(draw, (115, 290, 375, 410), "Wallet", "keys remain local")
    _process(draw, (115, 580, 375, 700), "Dashboard", "Next.js / viem")
    _process(draw, (545, 290, 810, 470), "Smart Contracts", "escrow / stake / outcomes", chain=True)
    _process(draw, (980, 290, 1230, 410), "Event Indexer", "read-only chain view")
    _process(draw, (980, 580, 1230, 700), "Gateway / API", "query / route only")
    _process(draw, (1400, 580, 1685, 700), "Provider Agent", "signed tx / health")
    _process(draw, (1400, 760, 1685, 850), "Docker Runtime", "policy gate / limits")
    _process(draw, (1400, 930, 1685, 1025), "Lease Container", "CPU / optional GPU")

    _arrow(draw, (375, 350), (545, 350), color=AMBER)
    _relationship_label(draw, (460, 245), "signed lease action", "JSON-RPC", 205)
    _arrow(draw, (810, 350), (980, 350), color=AMBER)
    _relationship_label(draw, (895, 245), "reads event logs", "JSON-RPC", 195)
    _arrow(draw, (375, 640), (980, 640))
    _relationship_label(draw, (680, 525), "market query / inference", "HTTPS / JSON", 250)
    _arrow(draw, (1230, 640), (1400, 640))
    _relationship_label(draw, (1315, 525), "routes request", "OpenAI HTTP", 190)
    draw.line((1542, 580, 1542, 510, 860, 510, 810, 420), fill=AMBER, width=4)
    draw.polygon([(810, 420), (829, 425), (815, 440)], fill=AMBER)
    _relationship_label(draw, (1190, 465), "provider-signed transaction", "JSON-RPC", 275)
    _arrow(draw, (1542, 700), (1542, 760))
    _relationship_label(draw, (1542, 730), "launch / inspect", "Docker API", 190)
    _arrow(draw, (1542, 850), (1542, 930))
    _text(draw, (1518, 878), "isolated process", 17, bold=True, anchor="rm")
    _text(draw, (1518, 904), "no host mounts", 14, mono=True, fill=SECONDARY, anchor="rm")

    draw.rectangle((500, 1080, 855, 1150), fill=AMBER_FILL, outline=AMBER, width=3)
    _text(draw, (677, 1102), "VALUE AUTHORITY", 15, bold=True, fill=AMBER, anchor="mm")
    _text(draw, (677, 1128), "Only contracts move escrow or slash stake", 15, anchor="mm")
    draw.rectangle((935, 1080, 1275, 1150), fill=EXTERNAL, outline=LINE, width=3)
    _text(draw, (1105, 1102), "NO CUSTODY", 15, bold=True, anchor="mm")
    _text(draw, (1105, 1128), "Routing services cannot settle", 15, anchor="mm")
    draw.rectangle((1355, 1080, 1730, 1150), fill=EXTERNAL, outline=LINE, width=3)
    _text(draw, (1542, 1102), "UNTRUSTED EXECUTION", 15, bold=True, anchor="mm")
    _text(draw, (1542, 1128), "Workload remains sandboxed off chain", 15, anchor="mm")
    image.save(TRUST_BOUNDARY_OUTPUT, quality=95)


def build_all() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    build_system_context()
    build_architecture()
    build_rental_sequence()
    build_trust_boundary()


if __name__ == "__main__":
    build_all()
