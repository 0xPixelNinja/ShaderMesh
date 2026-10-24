# ShaderMesh Demo Runbook

Operating guide for demonstrating the local stack: GPU rental, interactive lease
access, and managed LLM inference. Everything runs on one machine against a local
Hardhat devnet (chain 31337). Sepolia is not used during the demo.

---

All commands below are Windows `cmd` commands.

## 1. Terminal 1: Ollama

Ollama must be running before the stack starts, and must stay running for the
whole demo. The provider reaches it over `host.docker.internal`.

Open a terminal and leave it open:

```cmd
ollama serve
```

Check in another terminal that it answers and has the model:

```cmd
curl -s http://localhost:11434/api/tags
ollama list
```

`gemma3:4b` must be listed. If `ollama serve` reports that the address is already
in use, Ollama is already running and you can close that terminal.

Verify the GPU is visible:

```cmd
nvidia-smi
```

---

## 2. Terminal 2: control, start the stack

```cmd
cd /d C:\Projects\SEP-2026\ShaderMesh
docker compose up -d --build
```

Wait about 50 seconds, then confirm six services report `healthy` and the
`attester` service is running:

```cmd
docker compose ps
```

Expected services: `chain`, `ipfs`, `orchestrator`, `postgres`, `provider`, `web`
(healthy) and `attester` (running, no health check). The `attester` issues and
judges benchmark challenges every 60 seconds in the local stack.

> **Never rebuild a single service.** Running `docker compose up -d --build web`
> restarts the chain and the one-shot `seed` does not re-run, so all demo state is
> lost while every container still reports healthy. Always use the full reset in
> section 7.

---

## 3. Pre-flight check

In the control terminal, run these checks. Each prints `[OK]` when it passes.

```cmd
curl -s http://localhost:11434/api/tags > nul && echo [OK] ollama
curl -s http://localhost:4000/listings | findstr /C:"RTX 4070" > nul && echo [OK] listing
curl -s http://localhost:4000/offers | findstr /C:"gemma3:4b" > nul && echo [OK] offers
curl -s -o nul http://localhost:3000 && echo [OK] web app
curl -s http://localhost:4000/challenges | findstr /C:"passed" > nul && echo [OK] challenges
```

The challenges check passes after the first challenge resolves, which takes about
one to two minutes after startup.

To read the full values instead:

```cmd
curl -s http://localhost:4000/listings
curl -s http://localhost:4000/offers
```

The listings response must contain `RTX 4070 Laptop GPU` with `"available":true`.
The offers response must contain `gemma3:4b` and `qwen3:0.6b`.

If the listing is missing, the provider agent has not published yet. Wait a few
seconds and retry. If it stays empty, do a full reset.

---

## 4. Terminals to keep open

| Terminal | Command | Purpose |
|---|---|---|
| 1, Ollama | `ollama serve` | Serves the models. Must stay running. |
| 2, control | none | Start, reset, and run checks |
| 3, provider log | `docker compose logs -f provider` | Live evidence of acceptance and heartbeats |
| 4, SSH | none, kept ready | Paste the lease SSH command here |
| 5, attester log (optional) | `docker compose logs -f attester` | Challenge issued, passed, or failed lines |

Terminal 3 is started with:

```cmd
cd /d C:\Projects\SEP-2026\ShaderMesh
docker compose logs -f provider
```

Keep terminal 3 visible during the demo. It is the clearest evidence that the
provider is responding on its own.

---

## 5. Browser and wallet

Open one browser window at `http://localhost:3000` and set zoom to 125 percent.
The page opens on the landing page. The app routes are `/dashboard`, `/rent`,
`/leases`, `/models`, `/provide` (with `/provide/capacity` and `/provide/stake`), and `/explorer`. The theme toggle switches
between the light default and the dark theme; pick one before presenting.
The layout is verified at 1536x864 and 1280x720 with no horizontal overflow.

MetaMask must be on the **ShaderMesh Dev** network (chain id 31337, RPC
`http://localhost:8545`).

| Account | Address | Role |
|---|---|---|
| Account 1 | `0x4fE9...a397` | Requester. Funded with 100 ETH and 5000 SMESH on every reset. |
| Imported Account 1 | `0x7099...79C8` | Provider. The running agent. |

Start on the requester account. Connect the wallet and confirm the header shows
`$5,000.00 SMESH` and `Local devnet`.

The requester address is funded automatically because `DEMO_FUND_ADDRESS` is set
in the gitignored root `.env`.

---

## 6. Demo sequence

### 6.0 Landing page

Start at `/`. It explains the product with protocol diagrams: the lease lifecycle,
token flow, escrow by interval, the heartbeat strip, and the challenge track. Use
it for a short framing, then open the app from its call to action.

### 6.1 Home

Open `/dashboard`. Show the **Renting** and **Providing** panels for the connected wallet, then the **Network now** figures, **Recent activity**, and **Available capacity**.

### 6.2 Marketplace

Open **Marketplace** (`/rent`) in the Rent group. The lease composer has three steps: configure intervals and the workload manifest, **Review lease**, then **Request lease**.

Select the RTX 4070 Laptop GPU card (25.20 SMESH per hour, 1 minute intervals),
set the intervals, and select **Review lease**. Point out **Escrow to deposit**
before committing funds, then select **Request lease** and confirm the escrow
approval and the request in MetaMask.

State clearly that there is no approval step. The provider runs as a daemon and
accepts automatically, because a provider cannot depend on a human being present.

Watch terminal 3. Within about ten seconds:

```
[rental] requests accepted=1 rejected=0
[rental] heartbeat sent for 1 active lease(s)
```

### 6.3 My leases

Open **My leases** (`/leases`). The lease status becomes **Active**. The heartbeat strip advances every interval and
escrow streams down. Select **Settle** to settle completed intervals on chain.

### 6.4 Connect to the leased GPU

Open **Connect to your GPU** and select **Get connection details**. Copy the SSH
command into terminal 4 and paste the displayed password when prompted:

```cmd
ssh root@localhost -p 2201
```

The port is 2200 plus the lease id, so lease 1 is 2201. Accept the host key
prompt on first connection.

Inside the container:

```
nvidia-smi
hostname
```

This reports the provider's RTX 4070. The container is a real shell on the
provider's hardware, metered on chain for every interval the provider proves it
served.

The address adapts to how the dashboard was reached. Browsing on a LAN address
returns that address instead of `localhost`, so another machine on the same
network can connect and confirm the hardware is real.

### 6.5 Inference

Open **Inference** (`/models`).

On Sepolia the provider offers `qwen3:0.6b`. It is a small reasoning model, so keep
the prompt short and direct.

Open a prepaid credit, send a prompt, and settle usage on chain. The response
comes from the GPU through the provider's OpenAI-compatible endpoint.

### 6.6 Explorer

Open `/explorer`. The page has a network token-flow figure and three tabs:
**Leases** (select a lease to open the lease inspector with its evidence),
**Challenges**, and **Events and slashes** (a colour-coded timeline with plain
English descriptions). Show the chronological on-chain trail: `LeaseRequested`,
`LeaseAccepted`, `Heartbeat`, `IntervalSettled`. On the **Challenges** tab, show
that the provider has passed challenges automatically.

### 6.7 Node

Switch MetaMask to the provider account and open **Node** (`/provide`). It shows provider health,
stake, served work, and benchmark challenge history, with the **Provider registry** table below.
Listings and offers are published on **Capacity** (`/provide/capacity`), and the faucet, register,
stake, and unstake actions are on **Stake** (`/provide/stake`).

Do not select **Set inactive** or unstake. Either stops the agent serving and ends
the demo.

### 6.8 Benchmark challenge and slashing

This segment shows a provider failing a challenge. It ends with a revoked
attestation, so run it last and finish with a full reset (section 7).

First show the normal state. In the explorer **Challenges** tab, the provider has
challenges with status `passed`. Each pass refreshed the attestation and raised
reputation. Explain the mechanism: the attester issues a seeded challenge, the
provider answers with the output of a 500,000-iteration SHA-256 hash chain and a
score before the deadline, and the attester recomputes the hash.

Restart only the provider with a fault switch. In the control terminal:

```cmd
cd /d C:\Projects\SEP-2026\ShaderMesh
set BENCHMARK_FAULT=wrong_hash
docker compose up -d --no-deps provider
```

`wrong_hash` makes the provider submit a bad hash. `silent` makes it never
respond. Use `--no-deps` and do not pass `--build`, so the chain and its state are
untouched.

Watch terminal 5 (`docker compose logs -f attester`) and the explorer. Within about
one to two minutes the next challenge is issued, answered, and judged:

- **Challenges** tab: the new challenge is `failed, slashed`, with a slashed amount
  of 10 SMESH. With `silent`, the challenge stays `open` until the 120 second
  deadline and then fails with the same slash. Anyone can close it with
  `expireChallenge`, so this path needs no trusted input.
- **Events and slashes** timeline: `ChallengeIssued`, `ChallengeResponded` (not for
  `silent`), `ChallengeResolved`, `AttestationRevoked`, and `Slashed` in the danger
  colour.
- **Treasury**: the slash goes to the treasury, which defaults to the deployer
  (Hardhat account 0, `0xf39F...2266`). Its SMESH balance rises by 10 SMESH. The
  slash comes from free stake only. Bonded stake backing the active lease is not
  touched, and the lease continues under its bond.
- **Node page**: attestation is revoked and reputation falls. A revoked
  provider cannot publish new listings or offers.

The slash is the configured challenge slash, one fifth of the 50 SMESH minimum
stake. It is smaller only if the provider's free stake is below 10 SMESH.

State the limit: the attester is a trusted judge. The benchmark proves the
provider is responsive, controls its key, and delivers throughput close to what it
was attested at. It does not prove the exact GPU model.

After this segment, do a full reset (section 7). Clearing the variable alone does
not restore the revoked attestation.

---

## 7. Reset

Any failure is resolved by a full reset. It also re-funds the requester wallet.

```cmd
cd /d C:\Projects\SEP-2026\ShaderMesh
docker compose down -v
docker compose up -d --build
```

| Symptom | Cause | Action |
|---|---|---|
| Transaction fails with a chain mismatch | MetaMask on another network | Switch to ShaderMesh Dev |
| Dashboard empty but all services healthy | Chain restarted, seed did not re-run | Full reset |
| Model returns nothing, or Inference page errors | Ollama not running | Start `ollama serve` in terminal 1 |
| SSH connection refused | Lease not active yet | Wait for the heartbeat in terminal 3 |
| Lease stays Pending | Listing has no running agent | Use the RTX 4070 listing |
| Challenges tab empty | Attester not running, or under two minutes since start | Check `docker compose logs attester`, wait, or full reset |
| Provider attestation revoked unexpectedly | `BENCHMARK_FAULT` is still set in the shell | Run `set BENCHMARK_FAULT=` then full reset |

Check Ollama first when inference misbehaves:

```cmd
curl -s http://localhost:11434/api/tags
```

An empty or failed response means Ollama stopped. Restart it with `ollama serve`.
The rental and lease flows keep working without it; only the Inference page depends
on it.

---

## 8. Limitations to state honestly

These are real and documented. Raising them first is stronger than being asked.

- **Interactive leases relax the execution sandbox.** Shell access requires a
  network, a published port, a writable root filesystem, and a privileged
  entrypoint for sshd. CPU, memory, and PID limits still apply, and the container
  is removed when the lease ends. It is opt-in per provider through
  `LEASE_WORKLOAD_INTERACTIVE` and disabled in CI.
- **Lease credentials are not yet authenticated.** On this devnet the provider
  returns the credential to any caller that can reach it. A public deployment must
  require a signature from the lease holder, as the inference gateway already does
  for metered requests. The dashboard states this in the access panel.
- **Inference metering is requester-submitted.** Provider under-reporting is not
  independently prevented.
- **The attester is a trusted judge.** A designated attester records hardware and
  judges benchmark challenges. A benchmark proves responsiveness, key control, and
  throughput, not the exact GPU model. A missed deadline needs no trusted input,
  but a wrong answer is judged by the attester.

---

## 9. Sepolia

The demo runs locally, but the same contracts are deployed and source-verified on
Sepolia (chain 11155111). Use this when asked whether the system works publicly.

| Contract | Address |
|---|---|
| SmeshToken | `0x4d08515811A8b14A69aE3049278EDB04e83645F1` |
| ProviderRegistry | `0xd723DFd9E63632e9533ea1946b57AdB6d00cfC3f` |
| JobMarket | `0x9F3B0526A9c665F1Df423145eaACCe5b2479Ee57` |
| Verification | `0x994927B22613bCB8c5A25fA6386E386F250D365F` |
| RentalMarket | `0x0CcaB81947Ee0Dc270908FE0cd99f280596f3Ac3` |
| InferenceMarket | `0x108fF3eaeB81592A04212F52bEe50F46a0abf9D1` |

Local devnet is used for the live demo because block times are about one second,
which makes interval settlement and heartbeats observable during a short session.

These addresses include benchmark challenges (redeployed 2026-10-24). The attester
challenges the provider every 300 seconds with a 15-minute answer window, so a
challenge result appears within minutes. The fault demo is still quicker on the
local stack, where the window is 120 seconds.

### 9.1 Pre-demo checklist for a live Sepolia run

Complete this before presenting on Sepolia.

- Operator and attester wallets hold enough Sepolia ETH. The attester sends a
  transaction for every challenge issue and resolution.
- The provider wallet holds Sepolia ETH and at least the minimum stake in SMESH.
- The RPC endpoint answers (`eth_blockNumber`) and its log range limit matches
  `ATTESTER_LOG_RANGE` and the orchestrator indexer chunk size (10 blocks on small
  tiers).
- The provider shows as attested and `GET /challenges?provider=<address>` lists
  challenges with status `passed`. The Sepolia attester interval is 300 seconds
  and the challenge window defaults to 15 minutes, so a first pass can take several
  minutes.
- The orchestrator indexer has caught up: its latest block is within a few blocks
  of the chain head and `/health` is ok.
- `BENCHMARK_FAULT` is unset on the provider, unless a failure is intended.
- The local Hardhat stack is built and ready as a fallback (section 2). Do the
  fault demo there, because a Sepolia slash is slow and spends test funds.
