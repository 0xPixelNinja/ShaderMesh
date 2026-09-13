# ShaderMesh Simulator

A pure-stdlib (no dependencies) Monte-Carlo model of the **verification game**
economics. It quantifies how staking + randomized spot-checking deters cheating,
and produces numbers for the report's *Evaluation* section.

## Run

```powershell
python verification_game_sim.py
python verification_game_sim.py --reward 100 --bond 500 --rounds 200000
```

## What it shows

- Validates the closed form **break-even spot-check rate `s* = R / (R + B)`**
  (reward `R`, bond `B`) against Monte-Carlo results.
- The **security ↔ cost** tradeoff: detection rate vs. verification overhead
  (extra re-executions per task).
- Key insight: a **larger bond lets you spot-check less** for the same
  deterrence (e.g. bond = 5× reward ⇒ ~17% spot-check suffices vs ~50% at 1×).

## Roadmap

- Add heterogeneous provider populations (honest / lazy / colluding) and
  reputation-weighted challenger selection to stress-test collusion resistance.
