#!/usr/bin/env python3
"""Operator-run attester service: issues, judges, and expires benchmark challenges.

Runs with the registry attester key. Each tick it:
  1. issues a challenge to every attested provider that has none open and was last
     challenged at least CHALLENGE_INTERVAL_SECONDS ago,
  2. judges answered challenges by recomputing the seeded hash chain and checking
     the score against the attested benchmark, then calls resolveChallenge,
  3. calls expireChallenge on challenges whose deadline or judging window passed.

All state is derived from the chain (Attested and ChallengeIssued events from the
deployment block, then openChallenge and challenges views), so a restart loses
nothing. Providers are never trusted: the attester recomputes the output itself.

Config via environment:
  RPC_URL, DEPLOYMENTS_FILE, ATTESTER_PRIVATE_KEY,
  CHALLENGE_INTERVAL_SECONDS (default 300), CHALLENGE_MIN_SCORE_BPS (default 5000),
  ATTESTER_POLL_SECS (default 15), ATTESTER_LOG_RANGE (blocks per log query, default 2000)
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

from benchmark import CHALLENGE_ITERATIONS, CHALLENGE_OPEN, CHALLENGE_RESPONDED, hash_chain

BPS = 10_000
CHALLENGE_FAILED = 4


def judge(
    seed: bytes,
    score: int,
    output_hash: bytes,
    attested_score: int,
    min_score_bps: int,
    iterations: int = CHALLENGE_ITERATIONS,
) -> tuple[bool, str]:
    """Return (passed, reason). Pass needs the right hash and an acceptable score."""
    if hash_chain(seed, iterations) != bytes(output_hash):
        return False, "output hash mismatch"
    if attested_score > 0:
        required = attested_score * min_score_bps // BPS
        if score < required:
            return False, f"score {score} below required {required}"
    return True, "ok"


@dataclass
class AttesterConfig:
    interval_secs: int = 300
    min_score_bps: int = 5000
    log_range: int = 2000

    def __post_init__(self) -> None:
        if self.interval_secs <= 0:
            raise ValueError("CHALLENGE_INTERVAL_SECONDS must be positive")
        if not 0 <= self.min_score_bps <= BPS:
            raise ValueError("CHALLENGE_MIN_SCORE_BPS must be between 0 and 10000")
        if self.log_range <= 0:
            raise ValueError("ATTESTER_LOG_RANGE must be positive")


class Attester:
    def __init__(self, chain, cfg: AttesterConfig, start_block: int = 0):
        self.chain = chain
        self.cfg = cfg
        self.next_block = start_block
        self.providers: set[str] = set()
        self.last_issued: dict[str, int] = {}  # provider -> latest challenge id

    # --- discovery (derived from chain events) --------------------------------

    def refresh_providers(self) -> None:
        head = int(self.chain.rpc(lambda: self.chain.w3.eth.block_number))
        events = self.chain.registry.events
        while self.next_block <= head:
            lo = self.next_block
            hi = min(lo + self.cfg.log_range - 1, head)
            for log in self.chain.rpc(lambda: events.Attested.get_logs(from_block=lo, to_block=hi)):
                self.providers.add(log["args"]["provider"])
            for log in self.chain.rpc(
                lambda: events.ChallengeIssued.get_logs(from_block=lo, to_block=hi)
            ):
                args = log["args"]
                self.providers.add(args["provider"])
                self.last_issued[args["provider"]] = max(
                    self.last_issued.get(args["provider"], 0), int(args["id"])
                )
            self.next_block = hi + 1

    # --- actions ----------------------------------------------------------------

    def now(self) -> int:
        return int(self.chain.rpc(lambda: self.chain.w3.eth.get_block("latest"))["timestamp"])

    def tick(self) -> list[str]:
        """Run one pass. Returns one log line per action taken."""
        registry = self.chain.registry
        self.refresh_providers()
        now = self.now()
        window = int(self.chain.call(registry.functions.challengeWindow()))
        lines: list[str] = []
        for provider in sorted(self.providers):
            try:
                lines.extend(self._service_provider(provider, now, window))
            except Exception as exc:
                lines.append(f"[attester] provider={provider} error: {exc}")
        return lines

    def _service_provider(self, provider: str, now: int, window: int) -> list[str]:
        registry = self.chain.registry
        out: list[str] = []
        open_id = int(self.chain.call(registry.functions.openChallenge(provider)))
        if open_id:
            c = self.chain.call(registry.functions.challenges(open_id))
            seed, deadline = bytes(c[1]), int(c[3])
            status, score, output_hash = int(c[5]), int(c[6]), bytes(c[7])
            if status == CHALLENGE_RESPONDED and now <= deadline + window:
                attested = int(self.chain.call(registry.functions.attestations(provider))[2])
                passed, reason = judge(
                    seed, score, output_hash, attested, self.cfg.min_score_bps
                )
                self.chain.tx(registry.functions.resolveChallenge(open_id, passed))
                out.append(
                    f"[attester] challenge={open_id} provider={provider} "
                    f"outcome={'passed' if passed else 'failed'} reason={reason}"
                )
            elif (status == CHALLENGE_OPEN and now > deadline) or (
                status == CHALLENGE_RESPONDED and now > deadline + window
            ):
                self.chain.tx(registry.functions.expireChallenge(open_id))
                end = self.chain.call(registry.functions.challenges(open_id))
                outcome = "failed" if int(end[5]) == CHALLENGE_FAILED else "lapsed"
                out.append(
                    f"[attester] challenge={open_id} provider={provider} "
                    f"outcome={outcome} reason=expired"
                )
            return out

        attested_at = int(self.chain.call(registry.functions.attestations(provider))[0])
        if attested_at == 0:
            return out
        last = self.last_issued.get(provider, 0)
        if last:
            issued_at = int(self.chain.call(registry.functions.challenges(last))[2])
            if now - issued_at < self.cfg.interval_secs:
                return out
        new_id = int(self.chain.call(registry.functions.nextChallengeId()))
        self.chain.tx(registry.functions.issueChallenge(provider))
        self.last_issued[provider] = new_id
        out.append(f"[attester] challenge={new_id} provider={provider} outcome=issued")
        return out


def main() -> None:
    from chain import ChainClient, load_deployment
    from retry import RetryPolicy

    key = os.environ.get("ATTESTER_PRIVATE_KEY", "")
    if not key:
        print("[attester] no ATTESTER_PRIVATE_KEY set; nothing to do.")
        return
    deployment = load_deployment(
        os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/docker.json")
    )
    chain = ChainClient(
        os.environ.get("RPC_URL", "http://127.0.0.1:8545"),
        deployment,
        key,
        retry_policy=RetryPolicy.from_env(),
    )
    cfg = AttesterConfig(
        interval_secs=int(os.environ.get("CHALLENGE_INTERVAL_SECONDS", "300")),
        min_score_bps=int(os.environ.get("CHALLENGE_MIN_SCORE_BPS", "5000")),
        log_range=int(os.environ.get("ATTESTER_LOG_RANGE", "2000")),
    )
    attester = Attester(chain, cfg, start_block=int(deployment.get("deploymentBlock", 0)))
    poll = float(os.environ.get("ATTESTER_POLL_SECS", "15"))
    print(
        f"[attester] started {chain.address} interval={cfg.interval_secs}s "
        f"min_score_bps={cfg.min_score_bps}"
    )
    while True:
        try:
            for line in attester.tick():
                print(line)
        except Exception as exc:  # keep running through transient errors
            print(f"[attester] tick error: {exc}")
        time.sleep(poll)


if __name__ == "__main__":
    main()
