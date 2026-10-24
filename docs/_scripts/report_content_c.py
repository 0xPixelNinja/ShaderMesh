"""Chapters 10 to 12 and appendices of the ShaderMesh final report."""
import re


def parse_gas(path):
    rows, total = [], None
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(\S.*?)\s{2,}(\d+)$", ln.strip())
        if not m:
            continue
        name, gas = m.group(1), int(m.group(2))
        if name == "total":
            total = gas
        else:
            rows.append((name, gas))
    return rows, total


def parse_sim(path):
    """Return dict of section -> list of cell lists, plus raw text per section."""
    text = path.read_text(encoding="utf-8")
    parts = re.split(r"={70,}\n(VERIFICATION GAME: CLOSED-FORM CHECK|VERIFICATION GAME: HETEROGENEOUS PROVIDERS|RENTAL ECONOMICS[^\n]*)\n={70,}\n", text)
    out = {}
    for i in range(1, len(parts), 2):
        title, body = parts[i], parts[i + 1]
        rows = []
        for ln in body.splitlines():
            if "|" in ln:
                cells = [c.strip() for c in ln.split("|")]
                rows.append(cells)
        key = "closed" if "CLOSED" in title else ("hetero" if "HETERO" in title else "rental")
        out[key] = (rows[1:], body)  # drop header row
    return out


def money(x):
    return f"{float(x):,.2f}"


def chapter10(R, F, S, DATA):
    gas, total = parse_gas(DATA / "gas.txt")
    assert sum(g for _, g in gas) == total, "gas total mismatch"
    g = dict(gas)
    sim = parse_sim(DATA / "simulator.txt")

    R.chapter_h1("RESULTS AND EVALUATION")
    R.h2("Evaluation Setup")
    R.p("The evaluation has three parts. The gas report measures the cost of each core transaction on the Hardhat test chain. The simulator evaluates the economic mechanisms with a deterministic Monte Carlo model using seed 42. The live deployment on Sepolia shows the system working with real hardware. All numbers in this chapter come from the recorded outputs `docs/_report/data/gas.txt` and `docs/_report/data/simulator.txt`, or from the live deployment records, and can be reproduced with the commands in Appendix C.")
    R.h2("Gas Costs")
    R.p("{t:gas} lists the gas used by each core transaction, taken from the transaction receipts of the test suite. The measurement covers 27 transactions with a combined cost of {total:,} gas. {f:gaschart} charts the same data with the benchmark challenge calls highlighted.".replace("{total:,}", f"{total:,}"))
    names = {"token": "SmeshToken", "registry": "ProviderRegistry", "job": "JobMarket", "verification": "Verification", "rental": "RentalMarket", "inference": "InferenceMarket"}
    rows = []
    for name, val in gas:
        c, fn = name.split(".", 1)
        rows.append([names[c], fn, f"{val:,}"])
    rows.append(["**Total**", "27 transactions", f"**{total:,}**"])
    R.table("gas", "Gas used by core transactions", ["Contract", "Function", "Gas used"], rows, [4.0, 6.5, 3.0], size=10, align_right=(2,))
    R.figure("gaschart", F / "chart-gas.png", "Gas per core transaction, with benchmark challenge calls highlighted", max_h=11.0)
    lease = g["rental.requestLease"] + g["rental.acceptLease"] + g["rental.heartbeat"] + g["rental.settle"] + g["rental.finalizeExpired"]
    bench = g["registry.issueChallenge"] + g["registry.respondChallenge"] + g["registry.resolveChallenge (pass)"]
    credit = g["inference.openCredit"] + g["inference.settleUsage"] + g["inference.closeCredit"]
    task = g["job.postJob"] + g["job.claimTask"] + g["job.submitResult"] + g["job.finalizeTask"]
    R.p(f"Four observations follow from the data.")
    R.numbered([
        f"**Opening a position costs more than operating it.** The most expensive transactions are `requestLease` ({g['rental.requestLease']:,} gas), `openCredit` ({g['inference.openCredit']:,}), `verification.challenge` ({g['verification.challenge']:,}), and `postJob` ({g['job.postJob']:,}). Each creates a record that holds a manifest or escrow. Recurring calls are cheaper: `heartbeat` costs {g['rental.heartbeat']:,}, `settleUsage` {g['inference.settleUsage']:,}, and `closeCredit` {g['inference.closeCredit']:,}.",
        f"**Whole-flow costs are modest.** A one-interval lease that is requested, accepted, heartbeated, settled, and finalized costs {lease:,} gas across the requester and the provider. A prepaid inference session with one settlement and a close costs {credit:,} gas after the offer exists. A single-task job from post to finalization costs {task:,} gas.",
        f"**The heartbeat is the recurring provider cost.** At {g['rental.heartbeat']:,} gas per interval, a provider that heartbeats every 60 seconds, as in the live deployment, pays this cost 60 times an hour. That is acceptable on a test network and would be significant on mainnet. Relayed or batched signed heartbeats are planned for this reason.",
        f"**A benchmark challenge is cheap for what it checks.** A passed challenge (issue, respond, resolve) costs {bench:,} gas in total, and the permissionless expiry that slashes a silent provider costs {g['registry.expireChallenge (slash)']:,}. The attester pays for issue and resolve. The provider pays for the response ({g['registry.respondChallenge']:,}).",
    ])
    R.p("Gas is a quantity of work. The currency cost depends on the gas price. As an illustration only, at an assumed price of 1 gwei, `requestLease` would cost 0.00025154 ETH. No fee measurement on Sepolia is claimed here.")

    R.h2("Verifiable-Task Simulation")
    R.p("The simulator models the optimistic verification game in two settings. The first checks the closed-form break-even rate of Chapter 6 with a single type of cheater. The second uses a mixed population of providers. The parameters were reward 100, bond 100, three challengers, and 100,000 rounds.")
    R.h3("Break-even spot-check rate")
    R.p("{t:closed} compares the simulated expected value of cheating with the closed form for eight spot-check rates. The break-even rate is s* = R / (R + B) = 0.500. The simulated values track the closed form within 0.4 units in every row. At s = 0.5 the simulated value is -0.05 against a theoretical 0, so cheating stops being profitable at the predicted point. {f:detect} plots the result.")
    rows = [[r[0], r[1], r[2], r[3], r[4], r[5]] for r in sim["closed"][0]]
    R.table("closed", "Expected value of cheating by spot-check rate (reward 100, bond 100)",
            ["s", "Detection", "Overhead", "EV simulated", "EV theory", "Verdict"], rows, [1.6, 2.2, 2.2, 2.8, 2.6, 2.6], size=10, align_right=(0, 1, 2, 3, 4))
    R.figure("detect", F / "chart-detection.png", "Expected cheater profit against spot-check probability (verifiable task mode)", max_h=9.0)
    R.p("The overhead column is the number of extra executions per task, which equals the spot-check rate times the number of challengers. At the break-even rate, deterrence costs 1.5 extra executions per task with three challengers. A larger bond lowers s* and therefore the overhead, which is the design lever that the analysis predicts.")
    R.h3("Mixed provider population")
    R.p("The second experiment uses 60 percent honest, 20 percent lazy, 10 percent malicious, and 10 percent colluding providers, a spot-check rate of 0.5, and three challengers. {t:hetero} shows the outcome by provider type.")
    rows = [[r[0], f"{int(r[1]):,}", f"{int(r[2]):,}", f"{int(r[3]):,}", r[4], money(r[5])] for r in sim["hetero"][0] if r[0] in ("honest", "lazy", "malicious", "colluding")]
    R.table("hetero", "Task verification outcomes in a mixed population",
            ["Type", "Tasks", "Cheats", "Caught", "Detection", "Cheat profit or loss"], rows, [2.4, 2.2, 2.2, 2.2, 2.4, 3.1], size=10, align_right=(1, 2, 3, 4, 5))
    R.p("Overall, 30,259 cheats occurred and 36.4 percent were detected, at an overhead of 1.501 extra executions per task. This result differs from the closed-form case in an important way. With a spot-check rate of 0.5, a perfect check would detect half of all cheats. The observed rates are 32 to 39 percent, because detection needs a strict majority of correct challenger votes. With three challengers drawn from a population in which only 60 percent are honest, a majority is correct less often than not. The last column is positive for every cheating type, which means cheating remained profitable in aggregate for this mix and these parameters.")
    R.p("The result supports two items in the planned hardening. The break-even formula assumes that a spot check detects a cheat whenever it happens. When challengers are drawn from a mixed pool, the effective detection rate is lower, so the system needs random and reputation-weighted challenger selection, more challengers, or a higher bond. The current implementation volunteers challengers and applies a quorum of one, so this simulation should be read as a warning about the unhardened design and not as a measurement of it.")

    R.h2("Rental Simulation")
    R.p("The rental simulation runs 10,000 leases of 24 intervals each, with an interval price of 10, a bond of 500, and a probability of 0.75 that a false heartbeat is detected. Honest providers are up 99 percent of intervals, lazy providers 80 percent, malicious providers 50 percent, and colluding providers 70 percent. A provider that is down either omits the heartbeat, which is direct evidence, or sends a false heartbeat, which is caught with the detection probability. The first detected failure terminates the lease, refunds unpaid intervals, and slashes the bond. The false-heartbeat break-even detection rate is h* = V / (V + D) = 0.020. {t:rentsim} and {f:rentecon} give the results.")
    rows = [[r[0], f"{int(r[1]):,}", r[2], r[3], money(r[4]), money(r[5]), money(r[6]), r[7]] for r in sim["rental"][0] if r[0] in ("honest", "lazy", "malicious", "colluding")]
    R.table("rentsim", "Simulated rental outcomes by provider type",
            ["Type", "Leases", "Uptime", "Detect", "Paid", "Refunded", "Slashed", "Terminated"], rows, [2.0, 1.5, 1.5, 1.5, 2.4, 2.3, 2.4, 1.9], size=9, align_right=(1, 2, 3, 4, 5, 6, 7))
    R.figure("rentecon", F / "chart-rental-economics.png", "Simulated rental outcomes by provider type: paid, refunded, and slashed", max_h=8.5)
    body = sim["rental"][1]
    m = re.search(r"escrow=([\d.]+)\s+paid=([\d.]+)\s+refunded=([\d.]+)\s+slashed=([\d.]+)", body)
    esc, paid, refd, sl = (float(x) for x in m.groups())
    assert abs(esc - paid - refd) < 1e-6
    R.p(f"**Escrow conservation holds.** Funded escrow was {esc:,.0f}, provider payment was {paid:,.0f}, and requester refunds were {refd:,.0f}. Payment plus refund equals escrow exactly, so no funds were created or lost. Slashed collateral of {sl:,.0f} is accounted separately, because it comes from provider stake and not from requester escrow.")
    R.p("Three results stand out.")
    R.bullets([
        "**Providers that fail are paid little and lose their bond.** Lazy, malicious, and colluding providers received between 17,540 and 76,410 in payment across their leases, and almost every one of their leases ended in termination (99.5 to 100 percent).",
        "**Detection is complete for omitted heartbeats and partial for false ones.** Honest and lazy providers show 100 percent detection because their down intervals are direct evidence. Malicious and colluding providers send false heartbeats and show 75.7 and 73.4 percent, consistent with the 0.75 setting.",
        "**Strict termination also hits honest providers.** Even with 99 percent uptime, 21.7 percent of honest leases ended in termination and 656,000 in bond was slashed from honest providers. With 24 intervals, the chance of at least one missed interval is 1 - 0.99^24, about 21 percent. The model terminates a lease at the first miss, with no tolerance. The contract adds a grace period of five minutes after the interval end, but it also terminates on the first miss that passes the grace period. The result is a design signal: the grace period and any tolerance for brief outages are first-order parameters, and a production design would likely need a small outage budget or a proportional penalty.",
    ])

    R.h2("Live Sepolia Results")
    R.h3("Deployment")
    R.p("The system was redeployed to Sepolia (chain identifier 11155111) on 2026-10-24 with the benchmark challenge feature and the attester service. All six contracts are source-verified on Etherscan with a repeatable script. Their addresses are in Appendix A.")
    R.h3("Provider and challenge")
    R.p("The live provider `0xfd4e4A034601991A3070bD2B9B0F6a473a5bfc76` runs on a laptop with an NVIDIA GeForce RTX 4070 Laptop GPU with 8 GB of memory. It registered, staked 100 SMESH, was attested, created rental listing #1 with 60-second intervals, and created inference offer #1 for `qwen3:0.6b`. It then passed live benchmark challenge #1. The measured score was 28,919, which is about 289 tokens per second on `qwen3:0.6b` (the score is tokens per second times 100). The provider answered 108 seconds after issuance, well inside the 15-minute challenge window used on Sepolia. A pass raised the provider reputation from 5,000 to 6,000. The provider console and the explorer show this record in {f:s-prov} and {f:s-chal}.")
    R.figure("s-prov", S["providers"], "Provider console on Sepolia: the RTX 4070 Laptop GPU provider with 100 SMESH of stake, attested, one challenge passed", max_h=9.5)
    R.figure("s-chal", S["explorer-challenges"], "Explorer Challenges tab on Sepolia: benchmark challenge #1 passed with score 28919, answered in 108 s", max_h=9.5)
    R.p("The attested benchmark score of this provider is 1,000, so the 28,919 measurement far exceeds the required 50 percent. The attested score was set low on purpose so that both the echo backend and a real model pass reliably. A tighter attested score is a deployment choice and does not change the mechanism.")
    R.h3("Flows validated on the Review 1 deployment")
    R.p("Before the redeployment, the earlier Sepolia deployment validated the main user flows on the same provider. These records are kept in a deployment file that is not committed, and they are reported here as the earlier validation, not as a result of the current addresses.")
    R.bullets([
        "**Prepaid inference.** A real `qwen3:0.6b` request served 36 tokens through a prepaid credit and settled 72,000,000,000,000 SMESH base units to the provider. The price was 0.002 SMESH per 1,000 tokens, so 36 tokens cost 0.000072 SMESH.",
        "**GPU lease.** A manifest-bound lease launched an immutable CUDA container on the GPU, recorded two heartbeats, settled one interval, and ended normally.",
        "**Deterministic jobs.** Two jobs executed in isolated sibling containers, submitted matching commitments, settled after the challenge window, and were stitched to a single IPFS result.",
        "**Operations.** All operator and provider containers reported healthy, and the indexer ran with 10-block log queries on the RPC provider tier used.",
    ])
    R.h3("Application screens")
    R.p("The following figures show the web application running against the live Sepolia deployment. {f:s-dash} shows the Home page, which separates what a wallet rents from what it provides, {f:s-rent} the Marketplace with its stepped lease composer, {f:s-node} the provider Node page, {f:s-models} the Inference page, {f:s-lease} the explorer lease inspector, {f:s-events} the event timeline, and {f:s-dark} the Challenges tab in the dark theme. The screenshots were taken without a connected wallet.")
    R.figure("s-dash", S["dashboard"], "Home page with the Renting and Providing panels and live network figures", max_h=9.5)
    R.figure("s-rent", S["rent"], "Marketplace with an available GPU and the lease composer", max_h=9.5)
    R.figure("s-node", S["providers"], "Provider Node page with the provider registry", max_h=9.5)
    R.figure("s-models", S["models"], "Inference page with the offer from the live provider", max_h=9.5)
    R.figure("s-lease", S["explorer-leases"], "Explorer Leases tab with the lease inspector", max_h=9.5)
    R.figure("s-events", S["explorer-events"], "Explorer events and slashes timeline", max_h=9.5)
    R.figure("s-dark", S["explorer-challenges-dark"], "Explorer Challenges tab in the dark theme", max_h=9.5)
    R.h2("Summary Against Objectives")
    R.p("The results support the five objectives of Chapter 2. The contracts implement streamed escrow, bonded stake, and slashing, with 42 passing tests and modest gas costs. The rental model is secured by heartbeats and benchmark challenges instead of result checking, and the simulator shows that failing providers are paid little and lose their bond while escrow is conserved. LLM and GPU compute were served on a real provider. The verifiable-task market works with exact hashes, and the simulation shows that its deterrence depends on the quality of the challenger pool. The prototype is live on a public testnet with one physical provider.")


def chapter11(R, F):
    R.chapter_h1("LIMITATIONS, RISKS, AND ETHICAL CONSIDERATIONS")
    R.h2("Limitations")
    R.p("The following limits apply to the delivered system. Several are inherent to the problem, and the report states them so the results are not over-read.")
    R.h3("The attester is a trusted judge")
    R.p("The attester writes attestations and judges benchmark answers. The registry bounds what it can do: it can slash only free stake, only up to a fixed amount per challenge, and only to the treasury. It cannot be used to drain lease bonds. It can still fail a correct answer, and it controls re-attestation. The system therefore relies on the attester being operated by a party that the participants accept. Decentralizing the attester, for example with several independent attesters and a threshold, is future work.")
    R.h3("LLM output is not verified on chain")
    R.p("The chain cannot judge whether a model answer is correct. The inference market checks usage counters and payment, not the content of responses. A provider could serve a smaller model than advertised, and the current system would detect this only through requester action. Sampled, deterministic spot checks that feed reputation are planned, and they could not be used for hard slashing because outputs differ across hardware.")
    R.h3("A heartbeat proves liveness of a key, not quality of service")
    R.p("A heartbeat is a transaction signed by the provider key. It shows that the key was live and that the agent considered the workload healthy. It does not show that the workload was fast, that the GPU was the advertised model, or that the requester could reach the service. Independent probes that measure availability from outside the provider are planned.")
    R.h3("A benchmark does not prove the GPU model")
    R.p("A benchmark proves responsiveness, key control, and throughput near an attested value. A different, adequate GPU would pass. The system does not claim stronger hardware identity than that.")
    R.h3("Requester-metered inference")
    R.p("The requester submits the cumulative token counts. The contract prevents overdraw and decreasing counters, but it cannot prevent under-reporting, which would underpay the provider. The requester has an economic reason to under-report. The current design is suitable for a cooperative setting. Provider-signed usage receipts, or a bounded dispute process, are needed before production use.")
    R.h3("Single live provider and testnet only")
    R.p("The public deployment has one physical provider. The results show that the mechanisms work with real hardware, but they do not show market behavior with many competing providers. The system runs only on a test network. SMESH has no value, and the economic parameters were not tuned against real incentives.")
    R.h3("Task verification is not fully hardened")
    R.p("Challengers volunteer and are not selected at random. Votes are plaintext. The quorum is one. The simulation in Chapter 10 shows that detection falls below the nominal spot-check rate when the challenger pool is mixed. Commit-reveal, reputation-weighted random selection, and perceptual comparison for rendering remain planned.")
    R.h3("Other limits")
    R.bullets([
        "Lease workloads are provider-configured. A requester cannot run an arbitrary container, which limits flexibility and is a deliberate safety choice.",
        "The gateway routes to the provider fixed by the credit. It does not probe health or fail over.",
        "Reputation is an exponential moving average of outcomes. It is not proportional to uptime and has no lease dispute process.",
        "The strict heartbeat termination rule penalizes brief outages heavily, as the rental simulation shows.",
        "The contracts have not been externally audited and are not fuzz tested.",
    ])
    R.h2("Risks")
    R.p("{t:risk} lists the main risks, their impact, and the mitigation in the current system.")
    R.table("risk", "Risk register",
            ["Risk", "Impact", "Mitigation and residual risk"],
            [
                ["Docker socket access on the provider agent", "Host compromise from a malicious workload", "Workloads are provider-configured. Containers have no network, read-only root, dropped capabilities, and resource limits. The socket is a host-level authority. Run the agent on a dedicated host."],
                ["Provider spoofs advertised hardware", "Requester pays for less than promised", "Attestation gate and recurring seeded benchmarks. Residual risk: trusted judge, and a benchmark does not prove the GPU model."],
                ["Collusion among providers in task verification", "Incorrect result accepted", "Majority voting assumes honest participants. Selection and weighting are planned."],
                ["Requester under-reports inference usage", "Provider underpaid", "Explicit in the design. Receipts or disputes are future work."],
                ["Testnet and RPC variability", "Unreliable public demonstration", "Local devnet fallback. Small log-query chunks on the RPC tier used."],
                ["Escrow accounting errors", "Funds locked or mispaid", "Lifecycle and conservation tests. Property-based fuzzing remains a gap."],
                ["GPU and runtime setup on varied hosts", "Operational friction", "Hardware discovery command and a CPU-served small model fallback."],
                ["Operator key compromise (attester or owner)", "Unfair slashing or parameter changes", "Test network only. Production needs multi-signature control and key separation."],
            ],
            [4.0, 3.5, 7.0], size=9.5)
    R.h2("Ethical Considerations")
    R.bullets([
        "**No financial instrument.** SMESH is a utility and test token. The project does not sell tokens, offer returns, or custody user funds. The README and the interface do not present SMESH as an investment.",
        "**Confidentiality of renter data.** Ordinary Docker isolation is not suitable for highly confidential data. A provider can observe what runs on its machine. The system does not claim confidentiality for requester data, and renters should not place sensitive data on a public provider.",
        "**Public ledger.** Addresses, manifests, and payment records on a public chain are visible to everyone and cannot be erased. Users should treat wallet addresses as pseudonymous but linkable.",
        "**Misuse of compute.** Renting capacity to strangers could allow harmful workloads. The current design reduces this risk by running only provider-approved images, with no network. A system that accepts arbitrary requester containers would need stronger isolation and abuse handling.",
        "**Provider safety.** Providers bear security risk on their own machines. The documentation tells providers to use dedicated wallets, test funds, and a dedicated host.",
        "**Secrets and responsible testing.** No private keys or RPC credentials are committed. Only test wallets and test ETH were used. Wallet-write tests are never run against a public network.",
        "**Concentration of control.** The owner and attester roles are privileged. Decentralized marketplaces can still concentrate power in their operators, and this limit is stated rather than concealed.",
        "**Energy and resources.** Sepolia uses proof of stake and the compute load of the project is small. The environmental impact is limited to the laptop and the test servers used.",
    ])


def chapter12(R, F):
    R.chapter_h1("CONCLUSION AND FUTURE WORK")
    R.h2("Conclusion")
    R.p("ShaderMesh shows that a compute-rental marketplace can keep value and enforcement on Ethereum while leaving compute off chain. The key design decision was to use two explicit trust models. Rentals, which cannot be re-executed, are secured by streamed escrow, bonded stake, strict per-interval heartbeats, attestation, and seeded benchmark challenges. Deterministic jobs, which can be re-executed, use an optimistic verification game. Both share one registry for stake, reputation, and slashing.")
    R.p("The delivered system includes six contracts with 42 tests, a provider agent with 58 tests, an orchestrator with 54 tests, a simulator with 15 tests, and a web application with 30 browser checks that include wallet writes. The system runs locally with one Compose command and is deployed and source-verified on Sepolia. A real provider with an RTX 4070 Laptop GPU registered, staked, was attested, listed capacity, served a real model, and passed a live benchmark challenge. The gas report shows modest costs for the core flows. The simulator reproduces the break-even spot-check rate of 0.5 for equal reward and bond and confirms escrow conservation in rentals.")
    R.p("The evaluation also exposed design signals. Detection in a mixed challenger population falls below the nominal spot-check rate. Strict heartbeat termination penalizes honest providers with brief outages. The heartbeat transaction dominates the recurring provider cost. These findings guide the future work below and are part of the contribution, because they come from running the mechanism rather than describing it.")
    R.h2("Future Work")
    R.h3("Protocol")
    R.bullets([
        "Commit-reveal voting, random and reputation-weighted challenger selection, and a higher quorum for the task market.",
        "Relayed or batched signed heartbeats to reduce provider gas, and independent availability probes.",
        "A tolerance or outage budget for heartbeats, and a reputation score proportional to uptime with a lease dispute process.",
        "Multiple independent attesters with a threshold, to remove the single trusted judge.",
        "Provider-signed usage receipts or a bounded dispute process for inference metering.",
        "Typed CPU and region fields and a structured context length in offers.",
    ])
    R.h3("Verification of workloads")
    R.bullets([
        "Sampled deterministic inference spot checks that feed reputation.",
        "Blender rendering with perceptual (SSIM) comparison and distributed tile assembly. This was descoped in the final phase plan.",
    ])
    R.h3("Platform")
    R.bullets([
        "Gateway health probing and failover across providers.",
        "Requester-defined containers with stronger isolation, such as user-space kernels or micro virtual machines.",
        "Verifiable-job submission and live tile assembly in the web application.",
        "More provider hosts and a longer public run to study market behavior.",
    ])
    R.h3("Assurance")
    R.bullets([
        "Property-based fuzzing of escrow and bond accounting, and an external audit before any use beyond a test network.",
        "Formal accessibility testing and measurement of event latency in the dashboard.",
        "Deployment on an EVM layer 2 network to lower costs.",
    ])


def appendices(R, F, ADDR):
    R.appendix_h1("A", "DEPLOYMENT ADDRESSES AND REPRODUCTION")
    R.p("{t:addr} lists the Sepolia deployment (chain identifier 11155111, redeployed 2026-10-24). All six contracts are source-verified on Etherscan.", line=1.15)
    R.table("addr", "Sepolia contract addresses", ["Contract", "Address"], [[a, "`" + b + "`"] for a, b in ADDR], [3.6, 10.9], size=9.5)
    R.p("The live provider is `0xfd4e4A034601991A3070bD2B9B0F6a473a5bfc76`. To reproduce the local system, use the commands below on a machine with Docker Compose v2, Node.js 20, and Python 3.11.", line=1.15)
    R.code([
        "Copy-Item .env.example .env",
        "docker compose up --build -d --wait",
        "Invoke-RestMethod http://localhost:4000/health",
        "docker compose exec -T orchestrator npm run smoke:inference",
        "",
        "# Sepolia operator (requires a funded test key and an RPC URL)",
        "cd contracts; npm ci; npm run compile; npm run deploy:sepolia",
        "npm run verify:sepolia",
        "cd ..; docker compose -f docker-compose.sepolia.yml up --build -d",
        "",
        "# Additional provider laptop",
        "python .\\agent\\discover_hardware.py",
        "docker compose --env-file .\\agent\\.env -f docker-compose.provider.yml up --build -d",
    ], size=9)

    R.appendix_h1("B", "API ENDPOINT SUMMARY")
    R.p("The orchestrator exposes the read API and the inference gateway listed in {t:api}. It never receives value writes.", line=1.15)
    R.table("api", "Orchestrator API endpoints", ["Route", "Purpose"], [
        ["GET /health", "Service status. Returns 503 when persistence or indexing fails."],
        ["GET /listings, /leases, /leases/:id", "Rental listings and leases."],
        ["GET /providers", "Providers with stake, reputation, attestation, models, challenge summary."],
        ["GET /challenges, /challenges/:id", "Benchmark challenges. Filter by provider."],
        ["GET /models, /offers, /offers/:id", "Model catalog and inference offers."],
        ["GET /credits, /credits/:id", "Prepaid credits. Filter by requester."],
        ["GET /jobs, /jobs/:id, /tasks, /disputes", "Verifiable jobs, tasks, and disputes."],
        ["GET /jobs/:id/result", "Final stitched artifact CID."],
        ["GET /events, /events/history", "Server-sent event stream and recent indexed events."],
        ["POST /jobs/prepare", "Split an image and pin the manifest. No chain write."],
        ["POST /v1/chat/completions", "OpenAI-compatible gateway with an EIP-191 authorization."],
    ], [5.4, 9.1], size=9.5)

    R.appendix_h1("C", "TEST COMMANDS")
    R.p("{t:cmds} lists the commands for each suite.", line=1.15)
    R.table("cmds", "Commands to run each test suite", ["Suite", "Command"], [
        ["Contracts", "`cd contracts; npm ci; npx hardhat compile; npx hardhat test; npm run gas`"],
        ["Provider agent", "`cd agent; pip install -r requirements-dev.txt; python -m pytest`"],
        ["Orchestrator", "`cd orchestrator; npm ci; npm test; npm run typecheck`"],
        ["Orchestrator with Postgres", "Set `TEST_DATABASE_URL`, then `npm test`"],
        ["Simulator", "`cd simulator; python -m unittest discover -v; python verification_game_sim.py`"],
        ["Web checks", "`cd web; npm ci; npm run lint; npm run typecheck; npm run build`"],
        ["Browser tests", "`cd web; npm run test:e2e` (read-only), `npm run test:e2e:wallet` (wallet writes)"],
        ["Regenerate this report", "`python docs/_scripts/report_figures.py; python docs/_scripts/build_report.py`"],
    ], [3.6, 10.9], size=9.5)
