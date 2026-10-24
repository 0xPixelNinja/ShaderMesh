#!/usr/bin/env python3
"""Final-report figures for ShaderMesh, drawn as SVG and rendered to PNG.

Run from the repo root:

    python docs/_scripts/report_figures.py

Output: docs/_report/figures/<name>.svg and <name>.png (3x scale, white
background). Charts read docs/_report/data/simulator.txt and gas.txt.
Rendering uses Playwright Chromium. A built-in check reports text that
touches a line, a box edge, or another label.

Figures and suggested captions:

  system-context         System context: actors, ShaderMesh, and the external
                         systems it depends on.
  architecture           Container view: off-chain components (untrusted) and
                         the contracts that hold all value.
  rental-sequence        Rental lifecycle: listing, lease, heartbeats,
                         settlement, and the two ways a lease ends.
  challenge-sequence     Benchmark challenge: issue, answer, judge, and the
                         permissionless expiry paths.
  lease-state-machine    Lease states and what happens to escrow and bond at
                         each terminal state.
  challenge-state-machine  Benchmark challenge states and transition
                         conditions.
  token-flow             Token flows: deposits, per-interval payouts, refunds,
                         and slashes.
  trust-boundary         What each component can and cannot do.
  chart-detection        Expected cheater profit against spot-check
                         probability (verifiable task mode).
  chart-rental-economics Simulated rental outcomes by provider type: paid,
                         refunded, and slashed.
  chart-gas              Gas per core transaction, with benchmark challenge
                         calls highlighted.
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "_report" / "figures"
DATA = ROOT / "docs" / "_report" / "data"

INK = "#1A1814"
INK2 = "#3A362F"
MUTED = "#5E5950"
HAIR = "#D3CEC4"
FAINT = "#F3F1EC"
AMBER = "#D97706"
AMBERF = "#FDF3E1"
AMBERT = "#A34A06"
OK = "#137535"
BAD = "#B91C1C"
GRID = "#E7E3DA"

SANS = "Arial, Helvetica, sans-serif"
MONO = "Consolas, 'Courier New', monospace"


def esc(s: str) -> str:
    return html.escape(s, quote=False)


class Fig:
    def __init__(self, name: str, w: int, h: int):
        self.name, self.w, self.h = name, w, h
        self.els: list[str] = []
        self.segs: list[tuple[float, float, float, float]] = []

    # ---- primitives ----------------------------------------------------
    def rect(self, x, y, w, h, fill="none", stroke=HAIR, sw=1.5, rx=6, dash=None, seg=True):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        s = f'stroke="{stroke}" stroke-width="{sw}"' if stroke else 'stroke="none"'
        self.els.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {s}{d}/>'
        )
        if seg and stroke:
            self.segs += [(x, y, x + w, y), (x, y + h, x + w, y + h), (x, y, x, y + h), (x + w, y, x + w, y + h)]

    def text(self, x, y, t, size=14, fill=INK, anchor="start", weight="normal", mono=False, rotate=None, italic=False):
        fam = MONO if mono else SANS
        tr = f' transform="rotate({rotate} {x} {y})" data-skip="1"' if rotate else ""
        st = ' font-style="italic"' if italic else ""
        self.els.append(
            f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}"{st}{tr}>{esc(t)}</text>'
        )

    def lines(self, x, y, items, size=13, lh=17, anchor="start", fill=MUTED, mono=False, center_v=False):
        """Stack of lines. items: str or (str, color). y is the first baseline,
        or the vertical centre of the block when center_v is set."""
        if center_v:
            y = y - (len(items) - 1) * lh / 2 + size * 0.35
        for i, it in enumerate(items):
            t, c = (it, fill) if isinstance(it, str) else it
            self.text(x, round(y + i * lh, 1), t, size, c, anchor, mono=mono)

    def line(self, pts, color=INK, sw=1.75, dash=None, head=True, tail=False, seg=True):
        pts = [tuple(p) for p in pts]
        draw = list(pts)

        def shorten(a, b, d):
            dx, dy = b[0] - a[0], b[1] - a[1]
            n = (dx * dx + dy * dy) ** 0.5
            return (b[0] - dx / n * d, b[1] - dy / n * d)

        if head:
            draw[-1] = shorten(pts[-2], pts[-1], 7)
        if tail:
            draw[0] = shorten(pts[1], pts[0], 7)
        d = " ".join(("M" if i == 0 else "L") + f"{x:.1f},{y:.1f}" for i, (x, y) in enumerate(draw))
        da = f' stroke-dasharray="{dash}"' if dash else ""
        self.els.append(
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linejoin="round"{da}/>'
        )
        if head:
            self.head(pts[-2], pts[-1], color)
        if tail:
            self.head(pts[1], pts[0], color)
        if seg:
            for a, b in zip(pts, pts[1:]):
                self.segs.append((a[0], a[1], b[0], b[1]))

    def head(self, a, b, color):
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = (dx * dx + dy * dy) ** 0.5
        ux, uy = dx / n, dy / n
        px, py = -uy, ux
        L, Wd = 9, 4
        bx, by = b[0] - ux * L, b[1] - uy * L
        pts = f"{b[0]:.1f},{b[1]:.1f} {bx + px * Wd:.1f},{by + py * Wd:.1f} {bx - px * Wd:.1f},{by - py * Wd:.1f}"
        self.els.append(f'<polygon points="{pts}" fill="{color}"/>')

    # ---- composites ----------------------------------------------------
    def node(self, x, y, w, h, title, sub=(), kind="plain", tsize=15, ssize=13, mono_title=False):
        if kind == "chain":
            self.rect(x, y, w, h, AMBERF, AMBER)
            tc, sc = AMBERT, AMBERT
        elif kind == "faint":
            self.rect(x, y, w, h, FAINT, HAIR)
            tc, sc = INK, MUTED
        elif kind == "dash":
            self.rect(x, y, w, h, "#FFFFFF", MUTED, dash="5 4")
            tc, sc = INK, MUTED
        else:
            self.rect(x, y, w, h, "#FFFFFF", INK)
            tc, sc = INK, MUTED
        n = len(sub)
        block = tsize + n * 18
        top = y + (h - block) / 2 + tsize * 0.82
        self.text(x + w / 2, round(top, 1), title, tsize, tc, "middle", "bold", mono=mono_title)
        for i, s in enumerate(sub):
            self.text(x + w / 2, round(top + 20 + i * 18 - 2, 1), s, ssize, sc, "middle")

    def svg(self) -> str:
        body = "\n".join(self.els)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}">\n<rect width="{self.w}" height="{self.h}" fill="#FFFFFF"/>\n'
            f"{body}\n</svg>\n"
        )


# ---------------------------------------------------------------------------
# Sequence helpers
# ---------------------------------------------------------------------------


def lifeline_header(f: Fig, cx, title, sub=None, kind="plain", w=150, y=20, h=48):
    if kind == "chain":
        f.rect(cx - w / 2, y, w, h, AMBERF, AMBER)
        c = AMBERT
    else:
        f.rect(cx - w / 2, y, w, h, FAINT, HAIR)
        c = INK
    if sub:
        f.text(cx, y + 21, title, 15, c, "middle", "bold")
        f.text(cx, y + 38, sub, 13, MUTED if kind != "chain" else AMBERT, "middle")
    else:
        f.text(cx, y + 29, title, 15, c, "middle", "bold")


def lifeline(f: Fig, cx, y0, y1):
    f.line([(cx, y0), (cx, y1)], HAIR, 1.25, dash="4 4", head=False, seg=False)


def msg(f: Fig, x1, x2, y, label, mono=True, dash=False, color=INK, lx=None, anchor="middle"):
    f.line([(x1, y), (x2, y)], color, 1.75, dash="6 4" if dash else None)
    if lx is None:
        lx = (x1 + x2) / 2
    f.text(lx, y - 9, label, 13, color if color != MUTED else MUTED, anchor, mono=mono)


def frame(f: Fig, x, y, w, h, tag, cond=None):
    f.rect(x, y, w, h, "none", HAIR, 1.25, rx=4)
    tw = 14 + 8 * len(tag)
    f.rect(x, y, tw, 24, FAINT, HAIR, 1.25, rx=4, seg=False)
    f.text(x + tw / 2, y + 17, tag, 13, INK, "middle", "bold")
    if cond:
        f.rect(x + tw + 6, y + 4, len(cond) * 6.4 + 12, 18, "#FFFFFF", None, 0, rx=0, seg=False)
        f.text(x + tw + 12, y + 17, cond, 13, MUTED)


def divider(f: Fig, x, x2, y, cond):
    f.line([(x, y), (x2, y)], HAIR, 1.25, dash="6 4", head=False)
    f.rect(x + 6, y + 8, len(cond) * 6.4 + 12, 18, "#FFFFFF", None, 0, rx=0, seg=False)
    f.text(x + 12, y + 22, cond, 13, MUTED)


# ---------------------------------------------------------------------------
# 1. System context
# ---------------------------------------------------------------------------


def fig_system_context() -> Fig:
    f = Fig("system-context", 1100, 640)
    actors = [
        (140, "Requester", "Leases compute, funds escrow", "HTTPS, wallet signs"),
        (400, "Provider", "Stakes and rents out GPU, CPU", "runs the agent"),
        (700, "Attester / operator", "Judges benchmark challenges", "operator key signs"),
        (960, "Reviewer / observer", "Reads explorer, holds no keys", "HTTPS, read only"),
    ]
    for cx, t, s, lab in actors:
        f.node(cx - 120, 30, 240, 80, t, [s], "plain")
        f.line([(cx, 110), (cx, 240)], INK, 1.75)
        f.text(cx + 12, 182, lab, 13, MUTED)
    f.rect(20, 240, 1060, 150, "#FFFFFF", INK, 1.5)
    f.text(550, 296, "ShaderMesh", 20, INK, "middle", "bold")
    f.text(550, 326, "Web dashboard, orchestrator, provider agent, attester service,", 14, INK2, "middle")
    f.text(550, 348, "and the smart contracts that hold all value", 14, INK2, "middle")
    # externals
    f.node(20, 520, 240, 80, "Ethereum", ["Sepolia or Hardhat"], "chain")
    f.node(280, 520, 240, 80, "IPFS", ["Job inputs and outputs"], "plain")
    f.rect(570, 490, 510, 130, "none", MUTED, 1.25, dash="5 4")
    f.text(588, 512, "Provider host", 13, MUTED)
    f.node(590, 530, 220, 70, "Docker Engine", ["Runs lease containers"], "plain")
    f.node(840, 530, 220, 70, "Ollama", ["Optional LLM backend"], "plain")
    for cx, lab in [(140, "JSON-RPC, events"), (400, "HTTP API"), (700, "Docker API"), (950, "Ollama HTTP")]:
        top = 530 if cx >= 590 else 520
        f.line([(cx, 390), (cx, top)], INK, 1.75, tail=False)
        f.text(cx + 12, 446, lab, 13, MUTED)
    return f


# ---------------------------------------------------------------------------
# 2. Architecture
# ---------------------------------------------------------------------------


def fig_architecture() -> Fig:
    f = Fig("architecture", 1220, 840)
    f.rect(20, 30, 860, 770, "none", MUTED, 1.25, dash="6 5")
    f.text(40, 58, "Off-chain components (untrusted)", 14, INK2, weight="bold")
    f.rect(920, 30, 280, 770, AMBERF, AMBER, 1.5)
    f.text(940, 58, "Smart contracts", 14, AMBERT, weight="bold")
    f.text(940, 76, "The only value authority", 13, AMBERT)
    f.line([(900, 30), (900, 806)], INK2, 1.25, dash="2 5", head=False, seg=False)
    f.text(900, 828, "Trust boundary", 13, MUTED, "middle")

    # Web
    f.node(50, 130, 210, 80, "Web", ["Next.js dashboard", "wallet signs transactions"])
    # Orchestrator
    f.rect(340, 110, 280, 290, "#FFFFFF", INK)
    f.text(480, 138, "Orchestrator", 15, INK, "middle", "bold")
    f.text(480, 156, "Node 20, TypeScript", 13, MUTED, "middle")
    for i, c in enumerate(["REST API and SSE stream", "Event indexer", "Inference gateway", "IPFS client", "Job splitter and stitcher"]):
        y = 172 + i * 44
        f.rect(360, y, 240, 34, FAINT, HAIR, 1.25, rx=4)
        f.text(480, y + 22, c, 13.5, INK2, "middle")
    f.node(710, 125, 140, 60, "Postgres", ["event projection"], "plain", tsize=14)
    f.node(710, 335, 140, 60, "IPFS", ["Kubo node"], "plain", tsize=14)
    # Agent
    f.rect(340, 480, 280, 250, "#FFFFFF", INK)
    f.text(480, 508, "Provider agent", 15, INK, "middle", "bold")
    f.text(480, 526, "Python 3.11", 13, MUTED, "middle")
    for i, c in enumerate(["Lease runtime", "Inference server", "Benchmark responder", "Heartbeat sender"]):
        y = 542 + i * 44
        f.rect(360, y, 240, 34, FAINT, HAIR, 1.25, rx=4)
        f.text(480, y + 22, c, 13.5, INK2, "middle")
    f.node(710, 495, 140, 60, "Docker Engine", ["lease containers"], "plain", tsize=14)
    f.node(710, 665, 140, 60, "Ollama", ["optional LLM backend"], "plain", tsize=14)
    # Attester
    f.node(50, 520, 210, 100, "Attester service", ["Python, operator key", "judges benchmarks"])

    # Edges
    f.line([(260, 152), (340, 152)], INK)
    f.text(300, 143, "HTTPS", 13, MUTED, "middle")
    f.line([(340, 192), (260, 192)], INK)
    f.text(300, 208, "SSE", 13, MUTED, "middle")
    f.line([(620, 155), (710, 155)], INK)
    f.text(665, 146, "SQL", 13, MUTED, "middle")
    f.line([(620, 365), (710, 365)], INK)
    f.text(665, 356, "HTTP API", 13, MUTED, "middle")
    f.line([(480, 400), (480, 480)], INK)
    f.text(494, 444, "OpenAI HTTP", 13, MUTED)
    f.line([(620, 525), (710, 525)], INK)
    f.text(665, 516, "Docker API", 13, MUTED, "middle")
    f.line([(620, 695), (710, 695)], INK)
    f.text(665, 686, "HTTP", 13, MUTED, "middle")
    # chain edges
    f.line([(155, 130), (155, 94), (920, 94)], AMBER)
    f.text(400, 86, "JSON-RPC (wallet signs transactions)", 13, AMBERT)
    f.line([(620, 270), (920, 270)], AMBER)
    f.text(640, 261, "JSON-RPC (event reads)", 13, AMBERT)
    f.line([(620, 610), (920, 610)], AMBER)
    f.text(640, 601, "JSON-RPC (heartbeats, settlement)", 13, AMBERT)
    f.line([(155, 620), (155, 772), (920, 772)], AMBER)
    f.text(400, 764, "JSON-RPC (issue and resolve challenges)", 13, AMBERT)

    # contracts
    items = [
        ("SmeshToken", "ERC-20 payment token"),
        ("ProviderRegistry", "stake, bonds, attestation"),
        ("RentalMarket", "listings, leases, escrow"),
        ("InferenceMarket", "offers, prepaid credit"),
        ("JobMarket", "verifiable tasks"),
        ("Verification", "spot-check game"),
    ]
    for i, (t, s) in enumerate(items):
        y = 130 + i * 86
        f.rect(950, y, 220, 66, "#FFFFFF", AMBER)
        f.text(1060, y + 28, t, 15, AMBERT, "middle", "bold", mono=True)
        f.text(1060, y + 48, s, 13, MUTED, "middle")
    f.text(940, 672, "Escrow, stake, and bonds live", 13, AMBERT)
    f.text(940, 690, "here only. Off-chain parts hold", 13, AMBERT)
    f.text(940, 708, "no funds and cannot forge results.", 13, AMBERT)
    return f


# ---------------------------------------------------------------------------
# 3. Rental sequence
# ---------------------------------------------------------------------------


def fig_rental_sequence() -> Fig:
    f = Fig("rental-sequence", 1160, 1120)
    REQ, WEB, MKT, AGT, CTR = 100, 330, 610, 880, 1065
    heads = [
        (REQ, "Requester", None, "plain", 150),
        (WEB, "Web", None, "plain", 150),
        (MKT, "RentalMarket", None, "chain", 150),
        (AGT, "Provider agent", None, "plain", 150),
        (CTR, "Lease container", None, "plain", 140),
    ]
    for cx, t, s, k, w in heads:
        lifeline(f, cx, 68, 1100)
    for cx, t, s, k, w in heads:
        lifeline_header(f, cx, t, s, k, w)
    NL = 596  # note anchor, left of market
    NR = 624  # note anchor, right of market

    msg(f, AGT, MKT, 130, "createListing(...)")
    f.lines(NL, 130, ["Price per interval, duration", "bounds, and hardware spec"], anchor="end", center_v=True)

    msg(f, REQ, WEB, 215, "Select listing, set manifest", mono=False)
    msg(f, WEB, MKT, 300, "requestLease(id, n, manifest)")
    f.lines(NR, 300, ["Escrow locked from requester,", "manifest bound to the lease"], center_v=True)

    msg(f, MKT, AGT, 385, "LeaseRequested event", mono=False, dash=True, color=MUTED)

    msg(f, AGT, MKT, 470, "acceptLease(leaseId)")
    f.lines(NL, 470, ["Bond held from provider stake,", "listing marked unavailable"], anchor="end", center_v=True)

    msg(f, AGT, CTR, 555, "start container", mono=False)

    frame(f, 30, 600, 1110, 190, "loop", "[each interval]")
    msg(f, AGT, MKT, 665, "heartbeat(leaseId)")
    f.lines(NL, 665, ["Uptime evidence for", "the current interval"], anchor="end", center_v=True)
    msg(f, AGT, MKT, 745, "settle(leaseId)")
    f.lines(NL, 745, ["Pays provider for completed,", "heartbeated intervals", "(any account may call)"], anchor="end", center_v=True)

    frame(f, 30, 815, 1110, 275, "alt", "[requester ends, or all intervals served]")
    msg(f, REQ, MKT, 895, "endLease or finalizeExpired", lx=345, anchor="start")
    f.lines(NR, 895, ["Pays completed intervals,", "refunds remaining escrow,", "releases the bond"], center_v=True)
    divider(f, 30, 1140, 955, "[provider misses a heartbeat past the grace period]")
    msg(f, REQ, MKT, 1035, "terminate(leaseId)", lx=345, anchor="start")
    f.lines(
        NR, 1035,
        ["Pays heartbeated intervals,", "refunds remaining escrow,", ("bond slashed to requester", BAD)],
        center_v=True,
    )
    return f


# ---------------------------------------------------------------------------
# 4. Challenge sequence
# ---------------------------------------------------------------------------


def fig_challenge_sequence() -> Fig:
    f = Fig("challenge-sequence", 1170, 1120)
    ATT, REG, AGT, ANY = 120, 450, 790, 1050
    heads = [
        (ATT, "Attester", None, "plain"),
        (REG, "ProviderRegistry", None, "chain"),
        (AGT, "Provider agent", None, "plain"),
        (ANY, "Any account", None, "plain"),
    ]
    for cx, *_ in heads:
        lifeline(f, cx, 68, 1100)
    for cx, t, s, k in heads:
        lifeline_header(f, cx, t, s, k, 160 if cx == REG else 150)

    msg(f, ATT, REG, 130, "issueChallenge(provider)")
    f.lines(
        464, 130,
        ["Seed from chain randomness:", "keccak256(prevrandao, provider, id)", "deadline = now + challengeWindow"],
        center_v=True,
    )
    msg(f, REG, AGT, 220, "ChallengeIssued(id, seed, deadline)", dash=True, color=MUTED)

    f.rect(482, 262, 293, 82, FAINT, HAIR, 1.25)
    f.lines(497, 285, ["Hash chain from the seed:", "500,000 SHA-256 iterations", "score: Ollama tokens/s x 100,", "else hash rate in kH/s"], fill=INK2)

    msg(f, AGT, REG, 405, "respondChallenge(id, score, outputHash)")
    f.lines(436, 405, ["Before the deadline:", "status Open to Responded"], anchor="end", center_v=True)

    f.rect(150, 470, 285, 82, FAINT, HAIR, 1.25)
    f.lines(165, 493, ["Recomputes the hash chain,", "compares output hash and", "score to the attested value"], fill=INK2)

    msg(f, ATT, REG, 610, "resolveChallenge(id, passed)")
    f.lines(464, 610, ["Within one window", "after the deadline"], center_v=True)

    frame(f, 30, 650, 1110, 215, "alt", "[verdict: pass]")
    f.rect(470, 686, 305, 52, "#FFFFFF", INK, 1.25)
    f.text(485, 708, "Passed", 13, INK, weight="bold")
    f.text(485, 727, "Attestation refreshed, reputation up", 13, INK2)
    divider(f, 30, 1140, 760, "[verdict: fail]")
    f.rect(470, 795, 305, 66, "#FFFFFF", INK, 1.25)
    f.text(485, 815, "Failed", 13, INK, weight="bold")
    f.text(485, 832, "Free stake slashed to treasury", 13, BAD)
    f.text(485, 852, "Attestation revoked, reputation down", 13, INK2)

    frame(f, 30, 880, 1110, 210, "alt", "[provider misses the deadline]")
    msg(f, ANY, REG, 950, "expireChallenge(id)", lx=475, anchor="start")
    f.lines(436, 950, ["Same slash as a fail,", "no trusted input"], anchor="end", center_v=True)
    divider(f, 30, 1140, 985, "[answer never judged within a window]")
    msg(f, ANY, REG, 1060, "expireChallenge(id)", lx=475, anchor="start")
    f.lines(436, 1060, ["Status Lapsed,", "no penalty"], anchor="end", center_v=True)
    return f


# ---------------------------------------------------------------------------
# 5. Lease state machine
# ---------------------------------------------------------------------------


def state_box(f: Fig, x, y, w, h, title, lines, kind="plain"):
    f.rect(x, y, w, h, FAINT if kind == "faint" else "#FFFFFF", INK, 1.5)
    f.text(x + 16, y + 28, title, 16, INK, weight="bold")
    for i, l in enumerate(lines):
        t, c = (l, INK2) if isinstance(l, str) else l
        f.text(x + 16, y + 52 + i * 18, t, 13, c)


def fig_lease_state() -> Fig:
    f = Fig("lease-state-machine", 1220, 620)
    f.line([(30, 280), (180, 280)], INK)
    f.text(105, 266, "requestLease", 13, INK, "middle", mono=True)
    f.text(105, 306, "escrow locked", 13, MUTED, "middle")
    f.rect(180, 250, 140, 60, FAINT, INK)
    f.text(250, 286, "Pending", 16, INK, "middle", "bold")
    f.rect(500, 244, 220, 72, FAINT, INK)
    f.text(610, 276, "Active", 16, INK, "middle", "bold")
    f.text(610, 298, "heartbeat, settle, extendLease", 13, MUTED, "middle")
    state_box(f, 40, 40, 300, 100, "Rejected", ["Full escrow refunded to requester.", "No bond was taken."])
    state_box(f, 40, 440, 300, 100, "Cancelled", ["Full escrow refunded to requester.", "No bond was taken."])
    state_box(f, 920, 40, 280, 118, "Ended", ["Pays heartbeated intervals.", "Refunds remaining escrow.", "Releases the bond."])
    state_box(
        f, 920, 440, 280, 118, "Terminated",
        ["Pays heartbeated intervals.", "Refunds remaining escrow.", ("Bond slashed to requester.", BAD)],
    )
    f.line([(250, 250), (250, 140)], INK)
    f.text(264, 188, "rejectLease", 13, INK, mono=True)
    f.text(264, 206, "by provider", 13, MUTED)
    f.line([(250, 310), (250, 440)], INK)
    f.text(264, 372, "cancelLease", 13, INK, mono=True)
    f.text(264, 390, "by requester", 13, MUTED)
    f.line([(320, 280), (500, 280)], INK)
    f.text(410, 266, "acceptLease", 13, INK, "middle", mono=True)
    f.text(410, 306, "bond held from stake", 13, MUTED, "middle")
    f.line([(700, 244), (700, 99), (920, 99)], INK)
    f.text(716, 86, "endLease, finalizeExpired", 13, INK, mono=True)
    f.lines(716, 122, ["requester ends, or", "every interval is served"], 13, 18)
    f.line([(700, 316), (700, 499), (920, 499)], INK)
    f.text(716, 486, "terminate", 13, INK, mono=True)
    f.lines(716, 522, ["heartbeat missed past", "the grace period"], 13, 18)
    return f


# ---------------------------------------------------------------------------
# 6. Challenge state machine
# ---------------------------------------------------------------------------


def fig_challenge_state() -> Fig:
    f = Fig("challenge-state-machine", 1230, 600)
    f.rect(40, 250, 120, 60, FAINT, INK)
    f.text(100, 286, "None", 16, INK, "middle", "bold")
    f.rect(300, 250, 140, 60, FAINT, INK)
    f.text(370, 286, "Open", 16, INK, "middle", "bold")
    f.rect(560, 250, 160, 60, FAINT, INK)
    f.text(640, 286, "Responded", 16, INK, "middle", "bold")
    state_box(f, 940, 20, 270, 118, "Failed", [("Free stake slashed to treasury.", BAD), "Attestation revoked.", "Reputation down."])
    state_box(f, 940, 222, 270, 118, "Passed", ["Attestation refreshed.", "Reputation up.", "Challenge closed."])
    state_box(f, 940, 400, 270, 118, "Lapsed", ["No penalty.", "Attestation unchanged.", "Challenge closed."])

    f.line([(160, 280), (300, 280)], INK)
    f.text(230, 266, "issueChallenge", 13, INK, "middle", mono=True)
    f.text(230, 306, "attester only", 13, MUTED, "middle")
    f.line([(440, 280), (560, 280)], INK)
    f.text(500, 266, "respond", 13, INK, "middle", mono=True)
    f.text(500, 306, "before deadline", 13, MUTED, "middle")
    f.line([(370, 250), (370, 70), (940, 70)], INK)
    f.text(390, 58, "expireChallenge", 13, INK, mono=True)
    f.text(390, 92, "deadline passes with no response, anyone may call", 13, MUTED)
    f.line([(640, 250), (640, 130), (940, 130)], INK)
    f.text(660, 118, "resolveChallenge(false)", 13, INK, mono=True)
    f.text(660, 152, "attester judges the answer wrong", 13, MUTED)
    f.line([(720, 281), (940, 281)], INK)
    f.text(760, 267, "resolveChallenge(true)", 13, INK, mono=True)
    f.text(760, 307, "answer judged correct", 13, MUTED)
    f.line([(640, 310), (640, 459), (940, 459)], INK)
    f.text(660, 447, "expireChallenge", 13, INK, mono=True)
    f.text(660, 481, "no verdict within one window after the deadline", 13, MUTED)
    f.text(40, 572, "challengeWindow is 15 minutes: the time allowed to respond, and again the time allowed to judge.", 13, MUTED)
    return f


# ---------------------------------------------------------------------------
# 7. Token flow
# ---------------------------------------------------------------------------


def fig_token_flow() -> Fig:
    f = Fig("token-flow", 1150, 700)
    # actors
    f.rect(40, 90, 150, 530, FAINT, HAIR)
    f.text(115, 120, "Requester", 15, INK, "middle", "bold")
    f.text(115, 138, "wallet", 13, MUTED, "middle")
    f.rect(960, 90, 150, 410, FAINT, HAIR)
    f.text(1035, 120, "Provider", 15, INK, "middle", "bold")
    f.text(1035, 138, "wallet", 13, MUTED, "middle")
    f.rect(960, 540, 150, 80, FAINT, HAIR)
    f.text(1035, 574, "Treasury", 15, INK, "middle", "bold")
    f.text(1035, 592, "slash recipient", 13, MUTED, "middle")
    # contracts
    f.rect(420, 90, 310, 120, AMBERF, AMBER)
    f.text(575, 120, "RentalMarket", 15, AMBERT, "middle", "bold", mono=True)
    f.text(575, 144, "Escrow per lease", 13, AMBERT, "middle")
    f.rect(420, 260, 310, 120, AMBERF, AMBER)
    f.text(575, 290, "InferenceMarket", 15, AMBERT, "middle", "bold", mono=True)
    f.text(575, 314, "Prepaid credit per offer", 13, AMBERT, "middle")
    f.rect(420, 440, 310, 180, AMBERF, AMBER)
    f.text(575, 468, "ProviderRegistry", 15, AMBERT, "middle", "bold", mono=True)
    f.rect(440, 486, 270, 52, "#FFFFFF", AMBER, 1.25)
    f.text(575, 517, "Bond held by active leases", 13, INK2, "middle")
    f.rect(440, 552, 270, 52, "#FFFFFF", AMBER, 1.25)
    f.text(575, 583, "Free stake", 13, INK2, "middle")

    def arrow(x1, x2, y, color, top, bottom=None):
        f.line([(x1, y), (x2, y)], color)
        anchor = "middle"
        mid = (x1 + x2) / 2
        f.text(mid, y - 9, top, 13, color, anchor)
        if bottom:
            f.text(mid, y + 22, bottom, 13, MUTED, anchor)

    # left side
    arrow(190, 420, 125, INK2, "escrow deposit", None)
    arrow(420, 190, 185, MUTED, "refund of remainder")
    arrow(190, 420, 295, INK2, "prepaid credit")
    arrow(420, 190, 355, MUTED, "unspent credit refunded")
    arrow(440, 190, 512, BAD, "bond slashed", "missed heartbeat")
    # right side
    arrow(730, 960, 150, OK, "paid per settled interval")
    arrow(730, 960, 305, OK, "paid per settled usage")
    arrow(960, 730, 455, INK2, "stake deposit")
    arrow(710, 960, 578, BAD, "slashed on failed challenge")
    # legend
    lx = 40
    for lab, c in [("Deposit", INK2), ("Payout", OK), ("Refund", MUTED), ("Slash", BAD)]:
        f.line([(lx, 668), (lx + 40, 668)], c)
        f.text(lx + 52, 673, lab, 13, INK2)
        lx += 150
    return f


# ---------------------------------------------------------------------------
# 8. Trust boundary
# ---------------------------------------------------------------------------


def fig_trust_boundary() -> Fig:
    f = Fig("trust-boundary", 1200, 700)
    X0, X1, X2, X3 = 20, 200, 400, 790
    f.text(X1 + 10, 40, "Component", 13, MUTED, weight="bold")
    f.text(X2 + 10, 40, "Can", 13, MUTED, weight="bold")
    f.text(X3 + 10, 40, "Cannot", 13, MUTED, weight="bold")
    f.line([(20, 52), (1180, 52)], INK, 1.5, head=False, seg=False)
    rows = [
        ("Smart contracts", "Hold all value",
         ["Hold escrow, stake, and bonds", "Pay providers, refund requesters", "Slash bonds and free stake"],
         ["Run workloads or see their output", "Move funds outside the coded rules", "Act without a signed transaction"]),
        ("Attester service", "Operator key",
         ["Issue benchmark challenges", "Judge an answer as pass or fail"],
         ["Move or custody user funds", "Slash bonded stake, or beyond a fixed amount", "Penalise by silence: unjudged lapses"]),
        ("Orchestrator", "Untrusted",
         ["Index chain events into Postgres", "Route metered inference to providers", "Split, index, and stitch job output"],
         ["Custody funds or sign for users", "Change balances or payouts", "Forge a result the chain accepts"]),
        ("Provider agent", "Untrusted",
         ["Run containers and serve inference", "Send heartbeats, answer challenges", "Accept or reject lease requests"],
         ["Be paid without heartbeat evidence", "Pass a benchmark it did not compute", "Hide downtime past the grace period"]),
        ("Web", "Untrusted",
         ["Build transactions for wallet signing", "Display chain and orchestrator data"],
         ["Hold keys or sign for a user", "Change state shown by the contracts"]),
    ]
    H = 130
    y = 52
    zones = [(0, 1, AMBERF, AMBER, AMBERT, "On-chain", "value authority"),
             (1, 2, FAINT, HAIR, INK, "Operator", "trusted to judge"),
             (2, 5, "#FFFFFF", MUTED, INK, "Off-chain", "untrusted")]
    for a, b, fill, stroke, tc, t1, t2 in zones:
        top = 52 + a * H
        f.rect(X0, top + 6, X1 - X0 - 10, (b - a) * H - 12, fill, stroke, 1.5, dash="5 4" if t1 == "Off-chain" else None)
        f.text(X0 + 16, top + 6 + 32, t1, 15, tc, weight="bold")
        f.text(X0 + 16, top + 6 + 52, t2, 13, MUTED if tc == INK else tc)
    for i, (name, tag, can, cannot) in enumerate(rows):
        top = 52 + i * H
        if i:
            f.line([(X1, top), (1180, top)], HAIR, 1, head=False, seg=False)
        f.text(X1 + 10, top + 38, name, 15, INK, weight="bold")
        f.text(X1 + 10, top + 58, tag, 13, MUTED)
        for j, t in enumerate(can):
            f.text(X2 + 10, top + 38 + j * 24, t, 13.5, INK2)
        for j, t in enumerate(cannot):
            f.text(X3 + 10, top + 38 + j * 24, t, 13.5, INK2)
    return f


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------


def read_sim():
    txt = (DATA / "simulator.txt").read_text()
    first = txt.split("HETEROGENEOUS")[0]
    det = []
    for m in re.finditer(r"^\s*([\d.]+)\s*\|\s*([\d.]+)%\s*\|\s*([\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(\w+)", first, re.M):
        det.append((float(m[1]), float(m[2]), float(m[4]), float(m[5]), m[6]))
    sec = txt.split("RENTAL ECONOMICS")[1]
    ren = []
    for m in re.finditer(r"^(\w+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|\s*([\d.]+)%\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)", sec, re.M):
        ren.append((m[1], int(m[2]), float(m[3]), float(m[5]), float(m[6]), float(m[7])))
    be = float(re.search(r"s\*=R/\(R\+B\)=([\d.]+)", first)[1])
    return det, ren, be  # type: ignore[return-value]


def rbar(f: Fig, x, y, w, h, fill, r=4):
    r = min(r, w / 2)
    d = (f"M{x},{y} h{w - r:.1f} a{r},{r} 0 0 1 {r},{r} v{h - 2 * r} a{r},{r} 0 0 1 -{r},{r} h-{w - r:.1f} z")
    f.els.append(f'<path d="{d}" fill="{fill}"/>')


def minus(s: str) -> str:
    return s.replace("-", "−")


# ---------------------------------------------------------------------------
# 9. Detection chart
# ---------------------------------------------------------------------------


def fig_chart_detection() -> Fig:
    det, _, be = read_sim()
    f = Fig("chart-detection", 1000, 560)
    L, R, T, B = 100, 950, 40, 440
    ymax = 100

    def px(s):
        return L + s * (R - L)

    def py(v):
        return B - (v + ymax) / (2 * ymax) * (B - T)

    f.rect(px(be), T, R - px(be), B - T, FAINT, None, 0, rx=0, seg=False)
    for v in (-100, -50, 0, 50, 100):
        f.els.append(f'<line x1="{L}" y1="{py(v)}" x2="{R}" y2="{py(v)}" stroke="{GRID}" stroke-width="1"/>')
        f.text(L - 12, py(v) + 5, minus(f"{v}"), 13, MUTED, "end", mono=True)
    for s in (0, 0.25, 0.5, 0.75, 1.0):
        f.els.append(f'<line x1="{px(s)}" y1="{T}" x2="{px(s)}" y2="{B}" stroke="{GRID}" stroke-width="1"/>')
        f.text(px(s), B + 24, f"{s:.2f}", 13, MUTED, "middle", mono=True)
    f.els.append(f'<line x1="{L}" y1="{py(0)}" x2="{R}" y2="{py(0)}" stroke="{INK}" stroke-width="1.5"/>')
    pts = " ".join(f"{px(s):.1f},{py(v):.1f}" for s, _, v, _, _ in det)
    f.els.append(f'<polyline points="{pts}" fill="none" stroke="{INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>')
    for s, _, v, _, _ in det:
        f.els.append(f'<circle cx="{px(s):.1f}" cy="{py(v):.1f}" r="4" fill="{INK}" stroke="#FFFFFF" stroke-width="1.5"/>')
    f.text(px(be) + 16, T + 26, "Deterred: expected profit below zero", 14, INK2)
    f.text(L + 16, B - 16, "Profitable for the cheater", 14, MUTED)
    f.text(px(be) - 14, py(0) + 32, f"Break-even s* = {be:.3f}", 14, INK, "end", weight="bold")
    f.text(px(be) - 14, py(0) + 52, "s* = R / (R + B), expected profit = 0", 13, MUTED, "end")
    f.text((L + R) / 2, 508, "Spot-check probability s", 14, INK2, "middle")
    f.text(30, (T + B) / 2, "Expected cheater profit per task", 14, INK2, "middle", rotate=-90)
    return f


# ---------------------------------------------------------------------------
# 10. Rental economics chart
# ---------------------------------------------------------------------------


def fig_chart_rental() -> Fig:
    _, ren, _ = read_sim()
    f = Fig("chart-rental-economics", 1100, 580)
    X0, XM = 320, 1.5e6
    sc = 740 / XM
    cols = [("Paid", OK), ("Refunded", AMBER), ("Slashed", BAD)]
    lx = X0
    for lab, c in cols:
        f.rect(lx, 24, 12, 12, c, None, 0, rx=2, seg=False)
        f.text(lx + 20, 35, lab, 13, INK2)
        lx += 110
    f.text(30, 84, "Provider type", 13, MUTED, weight="bold")
    f.text(260, 84, "Uptime", 13, MUTED, "end", weight="bold")
    top, pitch, bh = 104, 82, 16
    bottom = top + 3 * pitch + 3 * bh + 4 + 10
    for t in range(0, 4):
        v = t * 0.5e6
        x = X0 + v * sc
        f.els.append(f'<line x1="{x}" y1="{top - 10}" x2="{x}" y2="{bottom}" stroke="{GRID}" stroke-width="1"/>')
        lab = "0" if t == 0 else f"{v / 1e6:.1f}M"
        f.text(x, bottom + 24, lab, 13, MUTED, "middle", mono=True)
    f.els.append(f'<line x1="{X0}" y1="{top - 10}" x2="{X0}" y2="{bottom}" stroke="{HAIR}" stroke-width="1.5"/>')
    for i, (name, leases, upt, paid, ref, sl) in enumerate(ren):
        gy = top + i * pitch
        f.text(30, gy + 31, name.capitalize(), 15, INK, weight="bold")
        f.text(260, gy + 31, f"{upt:.1f}%", 14, INK, "end", mono=True)
        for k, (v, (_, c)) in enumerate(zip((paid, ref, sl), cols)):
            y = gy + k * (bh + 2)
            w = v * sc
            rbar(f, X0, y, w, bh, c)
            f.text(X0 + w + 10, y + 13, f"{v:,.0f}", 13, INK, mono=True)
    f.text((X0 + X0 + XM * sc) / 2, bottom + 62, "Amount in token units, 24 intervals per lease", 14, INK2, "middle")
    f.text(30, 540, "escrow conservation: escrow - paid - refunded = 0", 14, INK2, mono=True)
    f.text(30, 562, "10,000 leases, price 10.00 per interval, bond 500.00, heartbeat detection 0.75", 13, MUTED)
    return f


# ---------------------------------------------------------------------------
# 11. Gas chart
# ---------------------------------------------------------------------------


def fig_chart_gas() -> Fig:
    rows = []
    total = None
    for line in (DATA / "gas.txt").read_text().splitlines():
        m = re.match(r"^(\S.*?)\s+(\d+)$", line)
        if not m:
            continue
        if m[1] == "total":
            total = int(m[2])
        else:
            rows.append((m[1], int(m[2])))
    rows.sort(key=lambda r: -r[1])
    hi = {"registry.issueChallenge", "registry.respondChallenge", "registry.resolveChallenge (pass)", "registry.expireChallenge (slash)"}
    n = len(rows)
    pitch, top = 25, 84
    H = top + n * pitch + 100
    f = Fig("chart-gas", 1000, H)
    X0, XM = 290, 300000
    sc = 560 / XM
    f.rect(X0, 22, 12, 12, MUTED, None, 0, rx=2, seg=False)
    f.text(X0 + 20, 33, "Other transactions", 13, INK2)
    f.rect(X0 + 190, 22, 12, 12, AMBER, None, 0, rx=2, seg=False)
    f.text(X0 + 210, 33, "Benchmark challenge", 13, INK2)
    bottom = top + n * pitch - 4
    for t in range(0, 7):
        v = t * 50000
        x = X0 + v * sc
        f.els.append(f'<line x1="{x}" y1="{top - 8}" x2="{x}" y2="{bottom}" stroke="{GRID}" stroke-width="1"/>')
        f.text(x, bottom + 22, "0" if t == 0 else f"{v // 1000}k", 13, MUTED, "middle", mono=True)
    f.els.append(f'<line x1="{X0}" y1="{top - 8}" x2="{X0}" y2="{bottom}" stroke="{HAIR}" stroke-width="1.5"/>')
    for i, (name, v) in enumerate(rows):
        y = top + i * pitch
        c = AMBER if name in hi else MUTED
        f.text(X0 - 14, y + 11, name, 13, INK2, "end", mono=True)
        w = v * sc
        rbar(f, X0, y, w, 13, c)
        f.text(X0 + w + 10, y + 11, f"{v:,}", 13, INK, mono=True)
    f.text((X0 + X0 + XM * sc) / 2, bottom + 56, "Gas used per transaction (receipt gasUsed)", 14, INK2, "middle")
    if total:
        f.text(30, bottom + 86, f"Total across the {n} transactions: {total:,} gas", 13, MUTED)
    return f


# ---------------------------------------------------------------------------
# Render and check
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Project report figures: modules, tech stack, methodology, problem
# ---------------------------------------------------------------------------


def card(f: Fig, x, y, w, h, title, lines, kind="plain"):
    fill, stroke, tc = {"chain": (AMBERF, AMBER, AMBERT), "dash": ("#FFFFFF", MUTED, INK)}.get(kind, ("#FFFFFF", INK, INK))
    f.rect(x, y, w, h, fill, stroke, dash="5 4" if kind == "dash" else None)
    f.text(x + 16, y + 30, title, 15, tc, weight="bold")
    f.lines(x + 16, y + 58, lines, 13, 19, fill=AMBERT if kind == "chain" else INK2)


def fig_modules() -> Fig:
    f = Fig("modules", 1100, 480)
    w, gap, x0 = 200, 15, 20
    f.text(x0, 28, "On chain: Solidity contracts on Ethereum (hold all value)", 14, MUTED, weight="bold")
    chain = [
        ("SmeshToken", ["ERC-20 utility token", "Testnet faucet", "Pays escrow, stake"]),
        ("ProviderRegistry", ["Registration, stake", "Attestation", "Reputation", "Challenges, slashing"]),
        ("RentalMarket", ["GPU listings", "Lease escrow", "Heartbeat per interval", "Settle, refund, end"]),
        ("InferenceMarket", ["Model offers", "Prepaid credit", "Usage settlement"]),
        ("JobMarket", ["with Verification", "Deterministic tasks", "Commitments", "Challenge votes"]),
    ]
    for i, (t, ls) in enumerate(chain):
        card(f, x0 + i * (w + gap), 42, w, 132, t, ls, "chain")
    f.line([(330, 244), (330, 178)], INK, 1.75)
    f.line([(770, 178), (770, 244)], INK, 1.75)
    f.text(345, 216, "signed transactions", 13, MUTED)
    f.text(755, 216, "events and state reads", 13, MUTED, "end")
    f.text(x0, 270, "Off chain: services that hold no requester funds", 14, MUTED, weight="bold")
    off = [
        ("Provider agent", ["Hardware discovery", "Docker GPU workloads", "Ollama inference", "Heartbeats, answers"], "plain"),
        ("Attester", ["Issues challenges", "Judges hash, score", "Expires missed ones"], "plain"),
        ("Orchestrator", ["Event indexer", "Postgres projection", "REST and SSE API", "Inference gateway"], "plain"),
        ("Web app", ["Rent workspace", "Provide workspace", "Explorer", "Wallet signing"], "plain"),
        ("Simulator", ["Offline model", "Spot-check economics", "Rental outcomes"], "dash"),
    ]
    for i, (t, ls, k) in enumerate(off):
        card(f, x0 + i * (w + gap), 284, w, 132, t, ls, k)
    f.text(550, 458, "Amber: contracts on chain. Solid: off-chain services. Dashed: offline analysis tool.", 13, MUTED, "middle")
    return f


def chip_w(t, size=13):
    return round(len(t) * size * 0.56 + 28)


def fig_tech_stack() -> Fig:
    f = Fig("tech-stack", 1100, 440)
    rows = [
        ("Interface", "what users touch", ["Next.js 16", "React 19", "Tailwind CSS", "viem", "MetaMask (EIP-1193)"], "plain"),
        ("Coordination", "untrusted, rebuildable", ["Node.js 20", "TypeScript", "ethers", "PostgreSQL 16", "IPFS (Kubo)"], "plain"),
        ("Execution", "provider hardware", ["Python 3.11", "web3.py", "Docker Engine", "NVIDIA Container Toolkit", "Ollama"], "plain"),
        ("Settlement", "trust and payment", ["Ethereum Sepolia", "Solidity 0.8.24", "OpenZeppelin", "Hardhat"], "chain"),
        ("Tooling", "build and test", ["Docker Compose", "Playwright", "pytest", "Mocha and Chai", "GitHub Actions"], "faint"),
    ]
    y = 20
    for name, sub, chips, k in rows:
        f.rect(20, y, 1060, 70, AMBERF if k == "chain" else (FAINT if k == "faint" else "#FFFFFF"), AMBER if k == "chain" else HAIR)
        f.text(40, y + 31, name, 15, AMBERT if k == "chain" else INK, weight="bold")
        f.text(40, y + 52, sub, 12, AMBERT if k == "chain" else MUTED)
        x = 240
        for c in chips:
            cw = chip_w(c)
            f.rect(x, y + 17, cw, 36, "#FFFFFF", AMBER if k == "chain" else INK, 1.25, rx=5)
            f.text(x + cw / 2, y + 40, c, 13, INK, "middle")
            x += cw + 12
        y += 82
    return f


def fig_methodology() -> Fig:
    f = Fig("methodology", 1100, 262)
    phases = [
        ("Requirements", ["SRS, trust model", "threat model"]),
        ("Contracts", ["6 contracts", "42 tests"]),
        ("Agent", ["Docker, Ollama", "58 tests"]),
        ("Orchestrator", ["indexer, API", "54 tests"]),
        ("Web app", ["role workspaces", "30 browser checks"]),
        ("Integration", ["Compose stack", "simulator"]),
        ("Testnet", ["Sepolia deploy", "live provider"]),
    ]
    w, gap, x0 = 134, 20, 21
    for i, (t, ls) in enumerate(phases):
        x = x0 + i * (w + gap)
        f.text(x + w / 2, 44, f"Phase {i + 1}", 12, MUTED, "middle")
        f.node(x, 56, w, 60, t, (), "chain" if t == "Testnet" else "plain", tsize=14)
        f.lines(x + w / 2, 148, ls, 13, 19, "middle", INK2)
        if i < len(phases) - 1:
            f.line([(x + w, 86), (x + w + gap, 86)], INK, 1.5)
    f.line([(x0 + 7 * w + 6 * gap, 100), (1088, 100), (1088, 200), (10, 200), (10, 100), (x0, 100)], MUTED, 1.4, dash="5 4")
    f.text(550, 236, "Every phase ends with automated tests and review; findings feed back into the requirements.", 13, MUTED, "middle")
    return f


def fig_problem() -> Fig:
    f = Fig("problem", 1100, 360)
    f.text(275, 30, "Today: a central operator", 15, INK, "middle", "bold")
    f.text(825, 30, "ShaderMesh: contracts as the trusted party", 15, AMBERT, "middle", "bold")
    f.line([(550, 14), (550, 346)], HAIR, 1.25, head=False, seg=False)
    # left
    f.node(40, 60, 170, 64, "Renter", ["pays up front"])
    f.node(340, 60, 170, 64, "GPU owner", ["paid later"])
    f.node(175, 190, 200, 72, "Marketplace", ["holds funds, rules", "on disputes"], "faint")
    f.line([(125, 124), (220, 190)], INK, 1.5)
    f.line([(330, 190), (425, 124)], INK, 1.5)
    f.lines(275, 300, [("Single point of trust and failure", BAD), ("Opaque reputation and fees", BAD), ("No proof the hours were served", BAD)], 13, 22, "middle")
    # right
    f.node(590, 60, 170, 64, "Requester", ["funds escrow"])
    f.node(890, 60, 170, 64, "Provider", ["stakes collateral"])
    f.node(705, 190, 240, 72, "Smart contracts", ["escrow, stake, slashing"], "chain")
    f.line([(675, 124), (760, 190)], INK, 1.5)
    f.line([(975, 124), (890, 190)], INK, 1.5, tail=True)
    f.lines(825, 300, [("Paid per interval with signed heartbeats", OK), ("Public stake, reputation, and history", OK), ("Missed service is refunded or slashed", OK)], 13, 22, "middle")
    return f

JS = """() => [...document.querySelectorAll('svg text')].filter(t => !t.dataset.skip).map(t => {
  const b = t.getBBox(); return {t: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height};})"""


def seg_hits_rect(seg, r, pad=2.0):
    x1, y1, x2, y2 = seg
    rx0, ry0, rx1, ry1 = r[0] - pad, r[1] - pad, r[0] + r[2] + pad, r[1] + r[3] + pad
    t0, t1 = 0.0, 1.0
    dx, dy = x2 - x1, y2 - y1
    for p, q in ((-dx, x1 - rx0), (dx, rx1 - x1), (-dy, y1 - ry0), (dy, ry1 - y1)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def check(f: Fig, texts) -> int:
    bad = 0
    # trim bbox vertically to the glyph area (bbox includes line gap)
    rects = [(d["x"], d["y"] + d["h"] * 0.18, d["w"], d["h"] * 0.68, d["t"]) for d in texts]
    for r in rects:
        for s in f.segs:
            if seg_hits_rect(s, r[:4]):
                print(f"  [{f.name}] text touches line: {r[4]!r} at ({r[0]:.0f},{r[1]:.0f})")
                bad += 1
                break
        if r[0] < 4 or r[0] + r[2] > f.w - 4 or r[1] < 2 or r[1] + r[3] > f.h - 2:
            print(f"  [{f.name}] text near canvas edge: {r[4]!r}")
            bad += 1
    for i, a in enumerate(rects):
        for b in rects[i + 1:]:
            if a[0] < b[0] + b[2] + 2 and b[0] < a[0] + a[2] + 2 and a[1] < b[1] + b[3] + 1 and b[1] < a[1] + a[3] + 1:
                print(f"  [{f.name}] text overlap: {a[4]!r} / {b[4]!r}")
                bad += 1
    return bad


def main() -> int:
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    figs = [
        fig_system_context(), fig_architecture(), fig_rental_sequence(), fig_challenge_sequence(),
        fig_lease_state(), fig_challenge_state(), fig_token_flow(), fig_trust_boundary(),
        fig_chart_detection(), fig_chart_rental(), fig_chart_gas(),
        fig_modules(), fig_tech_stack(), fig_methodology(), fig_problem(),
    ]
    only = set(sys.argv[1:])
    bad = 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        for f in figs:
            if only and f.name not in only:
                continue
            svg = f.svg()
            (OUT / f"{f.name}.svg").write_text(svg, encoding="utf-8")
            ctx = br.new_context(viewport={"width": f.w, "height": f.h}, device_scale_factor=3)
            page = ctx.new_page()
            page.set_content(f'<!doctype html><html><body style="margin:0;background:#fff">{svg}</body></html>')
            page.evaluate("document.fonts.ready")
            bad += check(f, page.evaluate(JS))
            page.locator("svg").screenshot(path=str(OUT / f"{f.name}.png"))
            ctx.close()
            print(f"ok {f.name} ({f.w}x{f.h})")
        br.close()
    print(f"{bad} layout warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
