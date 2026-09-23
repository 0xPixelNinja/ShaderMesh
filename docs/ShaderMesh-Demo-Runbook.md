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

Wait about 50 seconds, then confirm all six services report `healthy`:

```cmd
docker compose ps
```

Expected services: `chain`, `ipfs`, `orchestrator`, `postgres`, `provider`, `web`.

> **Never rebuild a single service.** Running `docker compose up -d --build web`
> restarts the chain and the one-shot `seed` does not re-run, so all demo state is
> lost while every container still reports healthy. Always use the full reset in
> section 7.

---

## 3. Pre-flight check

In the control terminal, run these four checks. Each prints `[OK]` when it passes.

```cmd
curl -s http://localhost:11434/api/tags > nul && echo [OK] ollama
curl -s http://localhost:4000/listings | findstr /C:"RTX 4070" > nul && echo [OK] listing
curl -s http://localhost:4000/offers | findstr /C:"gemma3:4b" > nul && echo [OK] offers
curl -s -o nul http://localhost:3000 && echo [OK] dashboard
```

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

### 6.1 Overview

Show network state: available capacity, attested providers, and streaming spend.

### 6.2 Rent GPUs

The RTX 4070 Laptop GPU at 1.20 USD per hour with 60 second intervals is
preselected. Point out **Escrow to deposit** before committing funds, then select
**Request lease** and confirm in MetaMask.

State clearly that there is no approval step. The provider runs as a daemon and
accepts automatically, because a provider cannot depend on a human being present.

Watch terminal 3. Within about ten seconds:

```
[rental] requests accepted=1 rejected=0
[rental] heartbeat sent for 1 active lease(s)
```

### 6.3 My leases

The lease status becomes **Active**. Heartbeat bars advance every interval and
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

### 6.5 Models

`gemma3:4b` is preselected. Use it rather than `qwen3:0.6b`, which is a reasoning
model and returns terse output.

Open a prepaid credit, send a prompt, and settle usage on chain. The response
comes from the GPU through the provider's OpenAI-compatible endpoint.

### 6.6 Explorer

Show the chronological on-chain trail: `LeaseRequested`, `LeaseAccepted`,
`Heartbeat`, `IntervalSettled`.

### 6.7 Provider console

Switch MetaMask to the provider account and reload. **Lease activity** shows the
lease, its heartbeat state, and the bond at risk. The header shows attestation,
stake, reputation, and earnings.

Do not select **Set inactive** or unstake. Either stops the agent serving and ends
the demo.

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
| Model returns nothing, or Models page errors | Ollama not running | Start `ollama serve` in terminal 1 |
| SSH connection refused | Lease not active yet | Wait for the heartbeat in terminal 3 |
| Lease stays Pending | Listing has no running agent | Use the RTX 4070 listing |

Check Ollama first when inference misbehaves:

```cmd
curl -s http://localhost:11434/api/tags
```

An empty or failed response means Ollama stopped. Restart it with `ollama serve`.
The rental and lease flows keep working without it; only the Models page depends
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
- **Attestation is trusted.** A designated attester records hardware. There is no
  on-chain benchmark challenge with slashing for a failed attestation yet.

---

## 9. Sepolia

The demo runs locally, but the same contracts are deployed and source-verified on
Sepolia (chain 11155111). Use this when asked whether the system works publicly.

| Contract | Address |
|---|---|
| SmeshToken | `0x917d2f8699b96F64BA701d380CC396992e9Ff215` |
| ProviderRegistry | `0x4626B2218a7663c6c8C9D9ff7552455FAa29068C` |
| JobMarket | `0x22c301cb18345687d94bD9A6Bb30344667f5d77e` |
| Verification | `0xfd32f4814929aaE10f29E29C14A92B4767C4c660` |
| RentalMarket | `0x345F848bdAd8FE8E84DB3B13248Bb217a5BFb244` |
| InferenceMarket | `0xebdB79a6566e64747a245a7B98E02E0eA28808a0` |

Local devnet is used for the live demo because block times are about one second,
which makes interval settlement and heartbeats observable during a short session.
