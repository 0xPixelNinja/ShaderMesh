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

TODO: written by the presenter.
