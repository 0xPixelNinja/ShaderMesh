# ShaderMesh Simulator

A deterministic, standard-library-only Monte Carlo model for ShaderMesh's two
economic trust mechanisms:

- Verifiable tasks: provider bonds, randomized spot checks, challenger voting,
  collusion, cheating deterrence, and verification overhead.
- Rentals: provider uptime, signed heartbeats, false-heartbeat detection,
  interval-by-interval payment, unused-escrow refunds, and SLA slashing.

## Run

From `simulator/`:

```powershell
python verification_game_sim.py
python verification_game_sim.py --mode verification --reward 100 --bond 500
python verification_game_sim.py --mode rental --leases 20000 --heartbeat-detection 0.9
python -m unittest discover -v
```

The default command runs both evaluations with seed `42`. Supply `--seed` to
produce a different deterministic run. Use `python verification_game_sim.py
--help` for all economic and population parameters.

## Provider Population

The default population is 60% honest, 20% lazy, 10% malicious, and 10%
colluding. The shares are configurable and must sum to one.

| Type | Verifiable-task behavior | Rental behavior |
|---|---|---|
| Honest | Computes correctly and challenges wrong results | 99% uptime; reports only real service |
| Lazy | Cheats on 50% of tasks and copies challenged results | 80% uptime; missing heartbeat when down |
| Malicious | Always submits a wrong result and supports wrong results | 50% uptime; sends false heartbeats when down |
| Colluding | Submits a shared wrong result and supports colluding owners | 70% uptime; sends false heartbeats when down |

For task disputes, a strict majority of challengers must return the correct
result. Honest challengers always re-execute correctly. Lazy challengers copy
the owner's result. Malicious challengers support a wrong result. Colluding
challengers support another colluder but correctly challenge providers outside
their group.

## Formulas and Measures

For task reward `R`, task bond `B`, and spot-check rate `s`, the simulator checks:

```text
EV(cheat) = (1 - s)R - sB
s* = R / (R + B)
```

For captured rental value `V`, rental bond `D`, and false-heartbeat detection
probability `h`, it reports:

```text
EV(false heartbeat) = (1 - h)V - hD
h* = V / (V + D)
```

An up interval has a valid heartbeat and releases one interval payment. A down
provider either omits the heartbeat, which is detected directly, or submits a
false heartbeat. A false heartbeat is caught with probability `h`. Detection
terminates the lease, refunds every unpaid interval, and slashes the provider's
bond. An undetected false heartbeat releases that interval payment.

Rental output reports observed uptime, downtime detection, provider payment,
requester refund, slashing, and termination rates by provider type. It also
prints the escrow invariant:

```text
funded escrow = streamed provider payment + requester refund
```

Slashed provider collateral is accounted for separately from requester-funded
escrow.

## Tests

The `unittest` suite covers closed-form break-even values, rental false-heartbeat
economics, escrow conservation, deterministic reproduction by seed, mixed
population accounting, full uptime, immediate downtime detection, undetected
false heartbeats, no-challenger behavior, and invalid inputs. The current suite
has 15 passing tests.
