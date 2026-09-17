#!/usr/bin/env python3
"""ShaderMesh economic simulator for verification tasks and compute rentals.

The model uses only the Python standard library. Every Monte Carlo path uses an
explicit seed so evaluation runs are reproducible.
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from typing import Dict, Iterable, Mapping


@dataclass(frozen=True)
class Params:
    """Parameters for the original single-provider verification model."""

    reward: float
    bond: float
    rounds: int
    challengers: int
    seed: int


@dataclass(frozen=True)
class ProviderBehavior:
    """Economic behavior used in task and rental simulations."""

    task_cheat_probability: float
    uptime_probability: float
    false_heartbeat_probability: float
    colluding: bool = False


@dataclass(frozen=True)
class Population:
    """Provider-type shares. Shares must be non-negative and sum to one."""

    honest: float = 0.60
    lazy: float = 0.20
    malicious: float = 0.10
    colluding: float = 0.10

    def shares(self) -> Dict[str, float]:
        return {
            "honest": self.honest,
            "lazy": self.lazy,
            "malicious": self.malicious,
            "colluding": self.colluding,
        }


@dataclass(frozen=True)
class PopulationTaskParams:
    reward: float
    bond: float
    rounds: int
    challengers: int
    spot_check_rate: float
    seed: int


@dataclass(frozen=True)
class RentalParams:
    leases: int
    intervals: int
    price_per_interval: float
    bond: float
    heartbeat_detection_probability: float
    seed: int


DEFAULT_BEHAVIORS: Dict[str, ProviderBehavior] = {
    "honest": ProviderBehavior(0.0, 0.99, 0.0),
    "lazy": ProviderBehavior(0.50, 0.80, 0.0),
    "malicious": ProviderBehavior(1.0, 0.50, 1.0),
    "colluding": ProviderBehavior(1.0, 0.70, 1.0, colluding=True),
}


def _validate_non_negative(name: str, value: float) -> None:
    if value < 0:
        raise ValueError(f"{name} must be non-negative")


def _validate_probability(name: str, value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be between 0 and 1")


def _validate_population(
    population: Population, behaviors: Mapping[str, ProviderBehavior]
) -> None:
    shares = population.shares()
    for name, share in shares.items():
        _validate_probability(f"{name} share", share)
        if name not in behaviors:
            raise ValueError(f"missing behavior for provider type {name}")
    if abs(sum(shares.values()) - 1.0) > 1e-9:
        raise ValueError("provider shares must sum to 1")
    for name, behavior in behaviors.items():
        _validate_probability(
            f"{name} task cheat probability", behavior.task_cheat_probability
        )
        _validate_probability(f"{name} uptime probability", behavior.uptime_probability)
        _validate_probability(
            f"{name} false heartbeat probability",
            behavior.false_heartbeat_probability,
        )


def _choose_provider(rng: random.Random, population: Population) -> str:
    point = rng.random()
    cumulative = 0.0
    for name, share in population.shares().items():
        cumulative += share
        if point < cumulative:
            return name
    return "colluding"  # Protect against the final floating-point boundary.


def cheater_ev_closed_form(reward: float, bond: float, s: float) -> float:
    """Return (1-s)R - sB for a checked cheat with an honest challenger."""
    _validate_non_negative("reward", reward)
    _validate_non_negative("bond", bond)
    _validate_probability("spot-check rate", s)
    return (1.0 - s) * reward - s * bond


def break_even_rate(reward: float, bond: float) -> float:
    """Return the spot-check rate R/(R+B) where cheating EV is zero."""
    _validate_non_negative("reward", reward)
    _validate_non_negative("bond", bond)
    if reward + bond == 0:
        raise ValueError("reward and bond cannot both be zero")
    return reward / (reward + bond)


def false_heartbeat_ev(
    captured_value: float, bond: float, detection_probability: float
) -> float:
    """Expected value of one false heartbeat: (1-h)V - hD."""
    _validate_non_negative("captured value", captured_value)
    _validate_non_negative("bond", bond)
    _validate_probability("heartbeat detection probability", detection_probability)
    return (
        (1.0 - detection_probability) * captured_value
        - detection_probability * bond
    )


def heartbeat_break_even_rate(captured_value: float, bond: float) -> float:
    """Return V/(V+D), the false-heartbeat detection break-even rate."""
    return break_even_rate(captured_value, bond)


def _validate_task_params(p: Params) -> None:
    _validate_non_negative("reward", p.reward)
    _validate_non_negative("bond", p.bond)
    if p.rounds <= 0:
        raise ValueError("rounds must be positive")
    if p.challengers < 0:
        raise ValueError("challengers must be non-negative")


def simulate(p: Params, s: float, cheat_prob: float = 1.0) -> dict:
    """Simulate the original perfect-honest-challenger verification model."""
    _validate_task_params(p)
    _validate_probability("spot-check rate", s)
    _validate_probability("cheat probability", cheat_prob)
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

        if rng.random() >= cheat_prob:
            continue

        cheats += 1
        if spot_checked and p.challengers >= 1:
            caught += 1
            cheater_pnl -= p.bond
        else:
            undetected_cheats += 1
            cheater_pnl += p.reward

    return {
        "s": s,
        "detection_rate": caught / cheats if cheats else 0.0,
        "verification_overhead": total_extra_execs / p.rounds,
        "cheater_ev_sim": cheater_pnl / cheats if cheats else 0.0,
        "cheater_ev_theory": cheater_ev_closed_form(
            p.reward, p.bond, s if p.challengers else 0.0
        ),
        "undetected_cheats": undetected_cheats,
        "cheats": cheats,
    }


def _new_task_totals() -> dict:
    return {"tasks": 0, "cheats": 0, "caught": 0, "pnl": 0.0}


def simulate_population_tasks(
    p: PopulationTaskParams,
    population: Population,
    behaviors: Mapping[str, ProviderBehavior] = DEFAULT_BEHAVIORS,
) -> dict:
    """Simulate task owners and challenger votes from a mixed population.

    Honest challengers re-execute correctly. Lazy challengers copy the owner's
    result, malicious challengers support a wrong result, and colluders support
    another colluder's wrong result. A strict challenger majority is required to
    detect a cheat.
    """
    _validate_task_params(
        Params(p.reward, p.bond, p.rounds, p.challengers, p.seed)
    )
    _validate_probability("spot-check rate", p.spot_check_rate)
    _validate_population(population, behaviors)
    rng = random.Random(p.seed)
    by_type = {name: _new_task_totals() for name in population.shares()}
    checked = 0
    extra_executions = 0

    for _ in range(p.rounds):
        owner = _choose_provider(rng, population)
        owner_behavior = behaviors[owner]
        totals = by_type[owner]
        totals["tasks"] += 1
        cheated = rng.random() < owner_behavior.task_cheat_probability
        is_checked = rng.random() < p.spot_check_rate
        caught = False

        if is_checked:
            checked += 1
            extra_executions += p.challengers
            correct_votes = 0
            for _ in range(p.challengers):
                challenger = _choose_provider(rng, population)
                if challenger == "honest":
                    correct_votes += 1
                elif behaviors[challenger].colluding and not owner_behavior.colluding:
                    correct_votes += 1
            caught = cheated and correct_votes > p.challengers / 2

        if cheated:
            totals["cheats"] += 1
            if caught:
                totals["caught"] += 1
                totals["pnl"] -= p.bond
            else:
                totals["pnl"] += p.reward

    cheats = sum(values["cheats"] for values in by_type.values())
    caught = sum(values["caught"] for values in by_type.values())
    pnl = sum(values["pnl"] for values in by_type.values())
    return {
        "rounds": p.rounds,
        "checked": checked,
        "cheats": cheats,
        "caught": caught,
        "detection_rate": caught / cheats if cheats else 0.0,
        "verification_overhead": extra_executions / p.rounds,
        "cheater_pnl": pnl,
        "by_type": by_type,
    }


def _new_rental_totals() -> dict:
    return {
        "leases": 0,
        "planned_intervals": 0,
        "observed_intervals": 0,
        "up_intervals": 0,
        "down_intervals": 0,
        "downtime_detected": 0,
        "false_heartbeats": 0,
        "false_heartbeats_caught": 0,
        "paid_intervals": 0,
        "terminations": 0,
        "escrow": 0.0,
        "paid": 0.0,
        "refunded": 0.0,
        "slashed": 0.0,
    }


def _add_totals(target: dict, source: dict) -> None:
    for key, value in source.items():
        target[key] += value


def simulate_rentals(
    p: RentalParams,
    population: Population,
    behaviors: Mapping[str, ProviderBehavior] = DEFAULT_BEHAVIORS,
) -> dict:
    """Simulate interval settlement, missed service, refunds, and SLA slashing."""
    if p.leases <= 0:
        raise ValueError("leases must be positive")
    if p.intervals <= 0:
        raise ValueError("intervals must be positive")
    _validate_non_negative("price per interval", p.price_per_interval)
    _validate_non_negative("bond", p.bond)
    _validate_probability(
        "heartbeat detection probability", p.heartbeat_detection_probability
    )
    _validate_population(population, behaviors)
    rng = random.Random(p.seed)
    by_type = {name: _new_rental_totals() for name in population.shares()}

    for _ in range(p.leases):
        provider = _choose_provider(rng, population)
        behavior = behaviors[provider]
        lease = _new_rental_totals()
        lease["leases"] = 1
        lease["planned_intervals"] = p.intervals
        lease["escrow"] = p.intervals * p.price_per_interval

        for _ in range(p.intervals):
            lease["observed_intervals"] += 1
            service_is_up = rng.random() < behavior.uptime_probability
            if service_is_up:
                lease["up_intervals"] += 1
                lease["paid_intervals"] += 1
                lease["paid"] += p.price_per_interval
                continue

            lease["down_intervals"] += 1
            sends_false_heartbeat = (
                rng.random() < behavior.false_heartbeat_probability
            )
            if sends_false_heartbeat:
                lease["false_heartbeats"] += 1
                detected = rng.random() < p.heartbeat_detection_probability
                if not detected:
                    lease["paid_intervals"] += 1
                    lease["paid"] += p.price_per_interval
                    continue
                lease["false_heartbeats_caught"] += 1

            # A missing heartbeat is direct evidence; a false one requires detection.
            lease["downtime_detected"] += 1
            lease["terminations"] = 1
            lease["slashed"] = p.bond
            break

        lease["refunded"] = lease["escrow"] - lease["paid"]
        _add_totals(by_type[provider], lease)

    totals = _new_rental_totals()
    for values in by_type.values():
        _add_totals(totals, values)
    totals["conservation_delta"] = totals["escrow"] - (
        totals["paid"] + totals["refunded"]
    )
    totals["by_type"] = by_type
    return totals


def _format_population(population: Population) -> str:
    return "  ".join(
        f"{name}={share * 100:.0f}%" for name, share in population.shares().items()
    )


def _print_verification_table(p: Params) -> None:
    s_star = break_even_rate(p.reward, p.bond)
    print("=" * 78)
    print("VERIFICATION GAME: CLOSED-FORM CHECK")
    print("=" * 78)
    ratio = p.bond / p.reward if p.reward else float("inf")
    print(
        f"reward={p.reward:.2f}  bond={p.bond:.2f}  bond/reward={ratio:.2f}  "
        f"challengers={p.challengers}  rounds={p.rounds}  seed={p.seed}"
    )
    print(f"break-even spot-check rate s*=R/(R+B)={s_star:.3f}")
    print("-" * 78)
    print(
        f"{'s':>6} | {'detect%':>8} | {'overhead':>9} | "
        f"{'EV(sim)':>10} | {'EV(theory)':>10} | verdict"
    )
    print("-" * 78)
    rates = sorted({0.0, 0.1, 0.17, 0.2, s_star, 0.3, 0.5, 0.75, 1.0})
    for s in rates:
        result = simulate(p, s)
        verdict = "deterred" if result["cheater_ev_theory"] <= 0 else "profitable"
        print(
            f"{s:6.3f} | {result['detection_rate'] * 100:7.1f}% | "
            f"{result['verification_overhead']:9.3f} | "
            f"{result['cheater_ev_sim']:10.2f} | "
            f"{result['cheater_ev_theory']:10.2f} | {verdict}"
        )


def _print_population_tasks(
    p: PopulationTaskParams, population: Population
) -> None:
    result = simulate_population_tasks(p, population)
    print()
    print("=" * 78)
    print("VERIFICATION GAME: HETEROGENEOUS PROVIDERS")
    print("=" * 78)
    print(_format_population(population))
    print(
        f"spot-check={p.spot_check_rate:.3f}  challengers={p.challengers}  "
        f"rounds={p.rounds}  seed={p.seed}"
    )
    print("-" * 78)
    print(
        f"{'type':<11} | {'tasks':>8} | {'cheats':>8} | {'caught':>8} | "
        f"{'detect%':>8} | {'cheat P/L':>11}"
    )
    print("-" * 78)
    for name, values in result["by_type"].items():
        rate = values["caught"] / values["cheats"] if values["cheats"] else 0.0
        print(
            f"{name:<11} | {values['tasks']:8d} | {values['cheats']:8d} | "
            f"{values['caught']:8d} | {rate * 100:7.1f}% | "
            f"{values['pnl']:11.2f}"
        )
    print("-" * 78)
    print(
        f"total cheats={result['cheats']}  detected={result['detection_rate'] * 100:.1f}%  "
        f"overhead={result['verification_overhead']:.3f} extra executions/task"
    )


def _print_rentals(p: RentalParams, population: Population) -> None:
    result = simulate_rentals(p, population)
    h_star = heartbeat_break_even_rate(p.price_per_interval, p.bond)
    print()
    print("=" * 78)
    print("RENTAL ECONOMICS: STREAMING, HEARTBEATS, REFUNDS, AND SLA SLASHING")
    print("=" * 78)
    print(_format_population(population))
    print(
        f"leases={p.leases}  intervals={p.intervals}  price={p.price_per_interval:.2f}  "
        f"bond={p.bond:.2f}  heartbeat-detection={p.heartbeat_detection_probability:.2f}  "
        f"seed={p.seed}"
    )
    print(f"false-heartbeat break-even detection h*=V/(V+D)={h_star:.3f}")
    print("-" * 78)
    print(
        f"{'type':<11} | {'leases':>7} | {'uptime%':>8} | {'detect%':>8} | "
        f"{'paid':>10} | {'refund':>10} | {'slashed':>10} | {'term%':>7}"
    )
    print("-" * 78)
    for name, values in result["by_type"].items():
        uptime = (
            values["up_intervals"] / values["observed_intervals"]
            if values["observed_intervals"]
            else 0.0
        )
        detection = (
            values["downtime_detected"] / values["down_intervals"]
            if values["down_intervals"]
            else 0.0
        )
        termination = (
            values["terminations"] / values["leases"] if values["leases"] else 0.0
        )
        print(
            f"{name:<11} | {values['leases']:7d} | {uptime * 100:7.1f}% | "
            f"{detection * 100:7.1f}% | {values['paid']:10.2f} | "
            f"{values['refunded']:10.2f} | {values['slashed']:10.2f} | "
            f"{termination * 100:6.1f}%"
        )
    print("-" * 78)
    print(
        f"escrow={result['escrow']:.2f}  paid={result['paid']:.2f}  "
        f"refunded={result['refunded']:.2f}  slashed={result['slashed']:.2f}"
    )
    print(
        "escrow conservation: escrow - paid - refunded = "
        f"{result['conservation_delta']:.10f}"
    )


def _add_population_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--honest-share", type=float, default=0.60)
    parser.add_argument("--lazy-share", type=float, default=0.20)
    parser.add_argument("--malicious-share", type=float, default=0.10)
    parser.add_argument("--colluding-share", type=float, default=0.10)


def _population_from_args(args: argparse.Namespace) -> Population:
    return Population(
        honest=args.honest_share,
        lazy=args.lazy_share,
        malicious=args.malicious_share,
        colluding=args.colluding_share,
    )


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ShaderMesh verification-game and rental-economics simulator"
    )
    parser.add_argument(
        "--mode", choices=("all", "verification", "rental"), default="all"
    )
    parser.add_argument("--reward", type=float, default=100.0)
    parser.add_argument("--bond", type=float, default=100.0)
    parser.add_argument("--rounds", type=int, default=100_000)
    parser.add_argument("--challengers", type=int, default=3)
    parser.add_argument("--spot-rate", type=float, default=0.50)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--leases", type=int, default=10_000)
    parser.add_argument("--intervals", type=int, default=24)
    parser.add_argument("--price", type=float, default=10.0)
    parser.add_argument("--rental-bond", type=float, default=500.0)
    parser.add_argument("--heartbeat-detection", type=float, default=0.75)
    _add_population_arguments(parser)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> None:
    args = _parse_args(argv)
    population = _population_from_args(args)
    try:
        _validate_population(population, DEFAULT_BEHAVIORS)
        if args.mode in ("all", "verification"):
            task_params = Params(
                args.reward, args.bond, args.rounds, args.challengers, args.seed
            )
            _print_verification_table(task_params)
            _print_population_tasks(
                PopulationTaskParams(
                    args.reward,
                    args.bond,
                    args.rounds,
                    args.challengers,
                    args.spot_rate,
                    args.seed,
                ),
                population,
            )
        if args.mode in ("all", "rental"):
            _print_rentals(
                RentalParams(
                    args.leases,
                    args.intervals,
                    args.price,
                    args.rental_bond,
                    args.heartbeat_detection,
                    args.seed,
                ),
                population,
            )
    except ValueError as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    main()
