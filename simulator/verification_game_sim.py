#!/usr/bin/env python3
"""
ShaderMesh — Verification Game Simulator
========================================

Models the economic security of ShaderMesh's optimistic verification game:
providers may cheat (submit a fabricated result to skip real compute); the
protocol spot-checks a random fraction `s` of results via independent
re-execution. Detected cheaters are slashed by their bond `B`; undetected
cheaters keep the reward `R`.

This is a pure-stdlib Monte-Carlo model (no external deps) used to:
  1. Validate the closed-form break-even spot-check rate  s* = R / (R + B).
  2. Show the security-vs-cost tradeoff (detection rate vs verification overhead).
  3. Produce numbers for the "Expected Outcomes / Evaluation" section.

Run:
    python verification_game_sim.py
    python verification_game_sim.py --reward 100 --bond 500 --rounds 200000
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass


@dataclass
class Params:
    reward: float          # R: payment per completed task
    bond: float            # B: stake bonded per task, slashed if caught cheating
    rounds: int            # Monte-Carlo trials per spot-check rate
    challengers: int       # K: independent re-executors per spot-check
    seed: int


def cheater_ev_closed_form(reward: float, bond: float, s: float) -> float:
    """Expected value to a rational cheater per task, ignoring saved compute cost.

    If not spot-checked (prob 1-s): keeps reward R.
    If spot-checked (prob s): slashed, loses bond B.
    """
    return (1.0 - s) * reward - s * bond


def break_even_rate(reward: float, bond: float) -> float:
    """Spot-check rate at which cheating EV = 0:  (1-s)R - sB = 0  =>  s = R/(R+B)."""
    return reward / (reward + bond)


def simulate(p: Params, s: float, cheat_prob: float = 1.0) -> dict:
    """Monte-Carlo one policy point.

    A cheating provider submits a wrong result. Honest challengers always
    re-produce the correct result, so a spot-check with >=1 challenger detects
    any wrong result (v0 assumption: deterministic tasks / perfect challengers).
    """
    rng = random.Random(p.seed)
    caught = 0
    undetected_cheats = 0
    cheats = 0
    total_extra_execs = 0
    cheater_pnl = 0.0

    for _ in range(p.rounds):
        spot_checked = rng.random() < s
        if spot_checked:
            total_extra_execs += p.challengers

        will_cheat = rng.random() < cheat_prob
        if not will_cheat:
            # Honest: earns reward (challengers, if any, agree).
            continue

        cheats += 1
        if spot_checked and p.challengers >= 1:
            caught += 1
            cheater_pnl -= p.bond
        else:
            undetected_cheats += 1
            cheater_pnl += p.reward

    detection_rate = (caught / cheats) if cheats else 0.0
    overhead = total_extra_execs / p.rounds  # extra executions per task
    return {
        "s": s,
        "detection_rate": detection_rate,
        "verification_overhead": overhead,
        "cheater_ev_sim": (cheater_pnl / cheats) if cheats else 0.0,
        "cheater_ev_theory": cheater_ev_closed_form(p.reward, p.bond, s),
        "undetected_cheats": undetected_cheats,
        "cheats": cheats,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="ShaderMesh verification-game simulator")
    ap.add_argument("--reward", type=float, default=100.0, help="reward per task R")
    ap.add_argument("--bond", type=float, default=100.0, help="bond per task B (slashed if caught)")
    ap.add_argument("--rounds", type=int, default=100_000, help="Monte-Carlo trials per point")
    ap.add_argument("--challengers", type=int, default=1, help="K re-executors per spot-check")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    p = Params(
        reward=args.reward,
        bond=args.bond,
        rounds=args.rounds,
        challengers=args.challengers,
        seed=args.seed,
    )

    s_star = break_even_rate(p.reward, p.bond)

    print("=" * 74)
    print("ShaderMesh Verification-Game Simulation")
    print("=" * 74)
    print(f"  reward R = {p.reward}    bond B = {p.bond}    "
          f"bond/reward = {p.bond / p.reward:.2f}    challengers K = {p.challengers}")
    print(f"  Break-even spot-check rate  s* = R/(R+B) = {s_star:.3f}")
    print(f"  => At s > {s_star:.3f}, cheating has NEGATIVE expected value (deterred).")
    print("-" * 74)
    header = f"{'s':>6} | {'detect%':>8} | {'overhead':>9} | {'EV(sim)':>9} | {'EV(theory)':>11} | verdict"
    print(header)
    print("-" * 74)

    for s in [0.0, 0.1, 0.17, 0.2, s_star, 0.3, 0.5, 0.75, 1.0]:
        r = simulate(p, s)
        verdict = "DETERRED" if r["cheater_ev_theory"] <= 0 else "profitable"
        print(f"{s:6.3f} | {r['detection_rate']*100:7.1f}% | "
              f"{r['verification_overhead']:9.3f} | {r['cheater_ev_sim']:9.2f} | "
              f"{r['cheater_ev_theory']:11.2f} | {verdict}")

    print("-" * 74)
    print("Reading: 'overhead' = extra re-executions per task (lower is cheaper).")
    print("Security comes from bond size AND spot-check rate: a larger bond lets you")
    print("use a smaller spot-check rate (less overhead) for the same deterrence.")
    print("=" * 74)


if __name__ == "__main__":
    main()
