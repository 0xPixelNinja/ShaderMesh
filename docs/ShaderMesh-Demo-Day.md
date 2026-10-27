# ShaderMesh Demo Day

How to run the Sepolia stack and the local Hardhat stack together on one host
laptop, and reach both from other devices on the same network. For the single
machine walkthrough of each screen, see `ShaderMesh-Demo-Runbook.md`.

## 1. Roles

| Device | Role |
|--------|------|
| Host laptop (RTX 4070) | Operator and GPU provider for both stacks. Runs Docker and Ollama. Drives the projector. |
| Client laptop | Requester. Rents a GPU lease, opens the SSH session, chats with the model. |
| Phone | Requester through MetaMask mobile. Chats with the model. |

Both stacks run at the same time on different ports. A client picks one by URL and
by the MetaMask network it selects.

| What | Sepolia stack | Local stack |
|------|---------------|-------------|
| Web app | `http://<host-ip>:3000` | `http://<host-ip>:3001` |
| Orchestrator API | `:4000` | `:4001` |
| Chain RPC | public Sepolia RPC | `http://<host-ip>:8545` (chain 31337) |
| IPFS API / gateway | `127.0.0.1:5001` / `:8080` | `127.0.0.1:5002` / `:8081` |
| Postgres | internal only | `127.0.0.1:5433` |
| Provider | `:8100` | `:8101` |
| Lease SSH | `2200 + lease id` | `2400 + lease id` |

Browser URLs for the API and RPC that point at `localhost` are rewritten to the
host the page was loaded from, so a phone opening `http://<host-ip>:3001` talks to
`<host-ip>:4001` and `<host-ip>:8545`.

The Sepolia stack needs internet on the host and on every client. The local stack
needs no internet. If the router has none, demo with the local stack only.

## 2. One-time setup

### Host

1. Install and start Ollama, and pull the model: `ollama pull qwen3:0.6b`.
   Keep `ollama serve` running (Ollama is usually already running as a tray app).
2. Set the LAN connection to the Private network profile (Windows Settings,
   Network, Properties). The firewall rules apply to Private only.
3. Open the ports once. Run this in PowerShell from the repo root (it asks for
   administrator rights):

   ```powershell
   .\scripts\demo.ps1 firewall
   ```

   It allows inbound TCP 3000, 3001, 4000, 4001, 8545 and the lease SSH ranges
   2200-2299 and 2400-2499 on the Private profile.
4. Make sure the untracked `.env` (root) and `agent/.env` exist for the Sepolia
   stack. The root `.env` must set `ORCHESTRATOR_PUBLIC_URL` and the provider
   endpoint must be reachable from the orchestrator container. See `.env.example`.

### MetaMask on the client laptop and the phone

Run `.\scripts\demo.ps1 status` on the host to print the exact values.

- Local network: add manually. Network name `ShaderMesh Local`, RPC URL
  `http://<host-ip>:8545`, chain ID `31337`, currency symbol `ETH`.
  On a phone use the same fields under Settings, Networks, Add network.
- Sepolia: select the built-in Sepolia network.

### Accounts

Local chain. Import this Hardhat account (public test key, local chain only):

| Field | Value |
|-------|-------|
| Address | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` (Hardhat account #5) |
| Private key | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |

`up local` funds it with 100 ETH and 5000 SMESH on every fresh chain. Any address
listed in `DEMO_FUND_ADDRESS` in the root `.env` is funded too (comma separated
allowed by the seed, the local override appends the demo account). Never send real
funds to these addresses on any other network.

Sepolia. Use the requester `0x7e6a268D9aa458f0deCE6280A7Eb9B86888565d8`, which is
already funded. Import its key from your own secret store. It is not in this repo.

## 3. Commands

Run from the repo root in PowerShell, or double-click the wrappers.

| Command | Wrapper | What it does |
|---------|---------|--------------|
| `.\scripts\demo.ps1 up` | `Demo-Start.cmd` | Starts the Sepolia provider, the Sepolia stack, then the local stack. Prints status. |
| `.\scripts\demo.ps1 up local` | | Local stack only. |
| `.\scripts\demo.ps1 up sepolia` | | Sepolia provider and stack only. |
| `.\scripts\demo.ps1 status` | `Demo-Status.cmd` | LAN IP, URLs, health, latest challenge per stack, MetaMask settings. |
| `.\scripts\demo.ps1 down` | `Demo-Stop.cmd` | Stops both. Local volumes are removed (the chain is in memory). Sepolia volumes are kept. |
| `.\scripts\demo.ps1 down local` / `down sepolia` | | One stack only. |
| `.\scripts\demo.ps1 cheat on` / `cheat off` | | Recreates only the local provider with `BENCHMARK_FAULT=wrong_hash` (or unset). Its next challenge fails and it is slashed. |
| `.\scripts\demo.ps1 offline` / `online` | | Stops or starts only the local provider container. |
| `.\scripts\demo.ps1 enforce` | | Terminates local leases whose provider missed a heartbeat. |
| `.\scripts\demo.ps1 firewall` | | One time. Adds the Private profile firewall rules. |

The first `up local` builds images and takes several minutes. Later runs take
about one minute.

### Missed heartbeat

`RentalMarket.terminate(leaseId)` slashes the provider bond and refunds the
escrow, and anyone may call it once the provider is past its deadline. Nothing in
the stack calls it automatically: the attester only issues and judges benchmark
challenges, and the web app has no terminate button. So the sequence on stage is:

1. A lease is active and the provider is heartbeating.
2. `demo.ps1 offline`.
3. Wait for the deadline: one 60 s interval after the last heartbeat plus the
   grace period. The local deploy sets the grace to 60 s (default contract value
   is 5 minutes), so about 2 to 3 minutes.
4. `demo.ps1 enforce`. It prints `terminated lease N` and the lease moves to
   terminated with a slashed bond.

### Cheating provider

`demo.ps1 cheat on` makes the local provider answer its next benchmark challenge
with a wrong hash. The local attester issues a challenge about every 75 s, so the
failure and a 10 SMESH slash appear within a couple of minutes on the Explorer.
`cheat off` clears the fault, but the slash and the revoked attestation remain.
To restore a healthy provider, run `down local` then `up local`.

## 4. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `status` shows an orchestrator as degraded or DOWN after an unclean shutdown | Restart it: `docker restart shadermesh-sepolia-orchestrator-1` (Sepolia) or `docker restart shadermesh-orchestrator-1` (local). |
| Chat or inference fails | Ollama is not running or `qwen3:0.6b` is missing. Start it with `ollama serve`, check `ollama list`. |
| The router has no internet | Use the local stack only (`:3001`). Sepolia needs the public RPC. |
| A client cannot open the app | Check the firewall rules, that the host network is Private, and that the client is on the same network. Run `status` for the current IP; it changes if the router reassigns it. |
| MetaMask shows the wrong chain | Switch network. The header of the app shows `Sepolia` or `Local devnet`. |
| Local dashboard empty after the Docker engine restarted | The Hardhat chain is in memory and restarted empty. Run `down local` then `up local`. |
| Wrong host IP detected | Set `$env:DEMO_LAN_IP = '192.168.x.y'` before running the script. |
| `up local` warns Ollama is not running | The local provider needs Ollama at `host.docker.internal:11434`. Start it, then `docker restart shadermesh-provider-1`. |

## 5. Demo script

About 12 minutes. Steps 3 to 6 use the local stack (`:3001`, MetaMask network
`ShaderMesh Local`) and work without internet. Step 2 needs internet; skip it if
the room has none.

### Before the guide arrives (10 minutes)

1. Host: connect to the router, start Docker Desktop and Ollama, double-click
   `Demo-Start.cmd`. Wait for the status output.
2. Host: run `Demo-Status.cmd`. Both stacks show `health: ok` and a recent
   challenge `passed`, and `local provider fault: off`. If a previous rehearsal
   left a slash on the local chain, run `.\scripts\demo.ps1 down local` then
   `up local`.
3. Host browser on the projector, three tabs: `http://localhost:3001/` (landing),
   `http://localhost:3001/explorer`, `http://localhost:3000/explorer`.
4. Client laptop: open `http://<host-ip>:3001/rent`, MetaMask on
   `ShaderMesh Local` with the demo account, connect the wallet.
5. Phone: in the MetaMask app browser open `http://<host-ip>:3001/models`, network
   `ShaderMesh Local`, connect the wallet.
6. Host: open a PowerShell window in the repo root for the stage commands.

### 1. The problem (1 minute, host)

Landing page. Say: renting a GPU from a stranger fails on three things: who holds
the money, how do we know the hours were served, and what happens when the
provider breaks the promise. Scroll to the lease lifecycle and token flow figures.

### 2. It is live on a public network (2 minutes, host, needs internet)

Tab `:3000/explorer`, Challenges. Point out hundreds of benchmark challenges
passed by the real RTX 4070 on Sepolia, each one an on-chain transaction. On a
phone, open one contract on sepolia.etherscan.io and show the verified source.

### 3. Rent a GPU (3 minutes, client laptop)

1. Marketplace: select the RTX 4070 card, set **Intervals** to `15`, select
   **Review lease**, then **Request lease**. Approve the escrow and confirm the
   request in MetaMask.
2. Within about ten seconds the provider accepts. Open **My leases**: the lease is
   **Active** and the heartbeat strip fills every minute.
3. Select **Connect to your GPU**, then **Get connection details**. Run the SSH
   command in a terminal (port `2400 + lease id`), paste the password, then run
   `nvidia-smi`. It shows the host's RTX 4070.
4. On the projector, `:3001/explorer` shows the lease, the heartbeats, and escrow
   paid out one interval at a time.

Say: the provider is paid only for minutes it proves with a signed heartbeat.

### 4. Paid AI from a phone (2 minutes, phone)

Inference page: select the `qwen3:0.6b` offer, **Open credit** with `2` SMESH,
confirm in MetaMask, then send a short prompt such as "Explain escrow in one
sentence." The answer comes from the host's GPU. Show the settled usage.

### 5. The provider disappears (2 to 3 minutes, host)

1. Host PowerShell: `.\scripts\demo.ps1 offline`. The heartbeat strip on the
   client laptop stops filling.
2. While waiting about two minutes for the deadline, explain: one interval plus a
   60 second grace period, and anyone may enforce it.
3. `.\scripts\demo.ps1 enforce`. It prints `terminated lease N`. On the client
   laptop the lease shows ended, the unused escrow is refunded, and on the
   Explorer the provider bond is slashed.
4. `.\scripts\demo.ps1 online`.

### 6. Catch a cheating provider (2 minutes, host)

1. `.\scripts\demo.ps1 cheat on`. The provider now answers benchmark challenges
   with a wrong hash.
2. Explorer, Challenges tab: within about two minutes the next challenge shows
   failed, then Events and slashes shows the 10 SMESH slash, the revoked
   attestation, and the lower reputation.
3. `.\scripts\demo.ps1 cheat off`.

Say: the slash comes only from free stake, never from stake that backs a running
lease, so a cheater cannot hurt the requesters it is serving.

### 7. Close (30 seconds)

The chain never runs the compute. It holds the money, pays for proven intervals,
and takes stake from providers that break their promise.

### After the demo

`.\scripts\demo.ps1 down local` then `up local` resets the local chain to a
healthy provider. `Demo-Stop.cmd` stops everything.
