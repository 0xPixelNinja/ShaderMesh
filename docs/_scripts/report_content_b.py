"""Chapters 6 to 9 of the ShaderMesh final report."""


def chapter6(R, F):
    R.chapter_h1("SYSTEM DESIGN")
    R.h2("Architecture Overview")
    R.p("ShaderMesh is a set of cooperating components arranged around a trust boundary. {f:arch} shows the container view. The right-hand block holds the six contracts, which are the only place where value moves. The left-hand block holds the off-chain components: the web application, the orchestrator with its Postgres projection and IPFS client, the provider agent with its Docker and Ollama dependencies, and the attester service. Every arrow that crosses the boundary is a JSON-RPC call signed by a key that belongs to a user, a provider, or the attester.")
    R.figure("arch", F / "architecture.png", "Container view: off-chain components (untrusted) and the contracts that hold all value", max_h=11.5)
    R.p("The components divide the work as follows.")
    R.bullets([
        "**Contracts** hold funds, stake, bonds, lifecycle state, commitments, and reputation. They enforce every rule that involves value.",
        "**Provider agent** advertises capacity, accepts or rejects lease requests, runs accepted workloads in sandboxed containers, serves inference, sends heartbeats, executes deterministic tasks, and answers benchmark challenges.",
        "**Attester service** records hardware attestations and issues, judges, and expires benchmark challenges with the registry attester key.",
        "**Orchestrator** indexes chain events into Postgres, serves a read API and a live event stream, routes authorized inference requests, and splits and stitches deterministic jobs through IPFS.",
        "**Web application** reads indexed state from the orchestrator and builds every transaction for the user wallet to sign.",
        "**IPFS** stores manifests, inputs, and outputs by content identifier. **Postgres** stores a derived cache and replay keys.",
    ])
    R.h2("Trust Boundary")
    R.p("The rule that shapes the design is that no off-chain component can steal funds or force the acceptance of a result. {f:trust} summarizes what each component can and cannot do. It also marks the attester as a separate, operator-trusted role: it can judge benchmark answers, but only within bounds that the registry enforces.")
    R.figure("trust", F / "trust-boundary.png", "What each component can and cannot do", max_h=10.5)
    R.p("The worst case for a misbehaving off-chain component is degraded service. A faulty orchestrator can return stale data or refuse to route a request, but it cannot change a balance. A malicious provider agent can fail to serve, but it cannot be paid without heartbeat evidence or pass a benchmark it did not compute. A compromised web page can ask the user to sign a bad transaction, which is a wallet-level risk common to all decentralized applications, but it cannot sign for the user.")
    R.h2("On-Chain and Off-Chain Boundary")
    R.p("Placing each piece of state on the correct side of the boundary keeps gas costs low and keeps trust assumptions explicit. {t:boundary} lists what the chain stores and what stays off chain.")
    R.table("boundary", "Placement of data and logic across the trust boundary",
            ["Item", "Location", "Reason"],
            [
                ["Escrow, stake, bonds, payouts, refunds", "On chain", "Value must be controlled by contract rules."],
                ["Lease, task, credit, and challenge state", "On chain", "State machines are the enforcement mechanism."],
                ["Result commitment (keccak256 hash)", "On chain", "Compact, comparable, and tamper evident."],
                ["Reputation score and outcome counts", "On chain", "Public record that no database controls."],
                ["Workload manifest, job input, job output", "IPFS, CID on chain", "Large payloads do not belong in contract storage."],
                ["Container execution, model inference", "Provider machine", "Heavy compute cannot run on chain."],
                ["Event index and API views", "Postgres, rebuildable", "Fast queries. Not a source of truth."],
                ["Inference request replay keys", "Postgres, durable", "Operational security state, not chain state."],
                ["Hardware attestation record", "On chain, written by attester", "Gate for listings and offers."],
                ["Benchmark answer judgment", "Attester, outcome on chain", "Needs off-chain recomputation. Trusted role."],
            ],
            [5.6, 3.4, 5.5])
    R.h2("Data Model")
    R.p("The data model is the set of structures that the contracts hold and the orchestrator projects. {t:data} lists the main entities and their key fields.")
    R.table("data", "Main entities and key fields",
            ["Entity", "Key fields"],
            [
                ["Provider", "registered, active, stake, bonded, reputation (0 to 10,000), completed, failed, capabilities (free-form JSON)."],
                ["Attestation", "attestedAt, GPU model, VRAM in GB, benchmark score. Fresh for a time-to-live (7 days by default). Cleared by a failed challenge."],
                ["Benchmark challenge", "id, provider, seed, issuedAt, deadline, respondedAt, status (open, responded, passed, failed, lapsed), score, outputHash."],
                ["Listing", "provider, price per interval, interval seconds, minimum and maximum intervals, availability, active lease, resource specification."],
                ["Lease", "listing, requester, provider, manifest, price, funded, heartbeated and settled intervals, escrow, bond, start, status."],
                ["Inference offer", "provider, model identifier, price per token, active."],
                ["Inference credit", "offer, requester, provider, snapshotted price per token, escrow, paid, cumulative prompt and completion tokens, active."],
                ["Job and task", "Job: requester, input CID, task count, completed tasks, reward per task, verification policy. Task: provider, result hash, output CID, status, bond, claimed and submitted times."],
                ["Dispute", "opened, resolved, provider hash, deadline, agree and disagree counts, first disagreeing challenger."],
            ],
            [3.4, 11.1])
    R.h2("Token Economics")
    R.p("SMESH is an ERC-20 utility token [@eip20] used for three purposes: payment from requesters to providers, collateral that providers stake, and rewards to honest challengers. On test networks a rate-limited faucet mints 1,000 SMESH per address per day. It has no value outside the test environment.")
    R.h3("Stake, bond, and slash")
    R.p("A provider must register and stake before it is eligible. Stake is a security deposit. When a provider takes on work, part of the stake is **bonded** to that work and cannot be withdrawn. Available stake is the total stake minus the bonded amount. A **slash** confiscates stake and sends it to a beneficiary: the requester for a missed heartbeat or an abandoned task, the first correct challenger for upheld cheating, and the treasury for a failed benchmark. {f:flow} shows the flows between requester, provider, markets, and treasury.")
    R.figure("flow", F / "token-flow.png", "Token flows: deposits, per-interval payouts, refunds, and slashes", max_h=10.0)
    R.h3("Reputation")
    R.p("Reputation is an integer from 0 to 10,000, starting at 5,000. After each outcome it moves toward 10,000 on success or toward 0 on failure by an exponential moving average with smoothing constant K = 5:")
    R.eq("reputation' = (4 x reputation + target) / 5,    target = 10,000 on success or 0 on failure")
    R.h3("Protocol parameters")
    R.p("{t:params} lists the default parameters. Each is set by the contract owner and can be changed without redeploying the contract.")
    R.table("params", "Default protocol parameters",
            ["Parameter", "Default", "Contract"],
            [
                ["Minimum stake for eligibility", "50 SMESH (deployment setting)", "ProviderRegistry"],
                ["Attestation time-to-live", "7 days", "ProviderRegistry"],
                ["Challenge window", "15 minutes (120 seconds in the local stack)", "ProviderRegistry"],
                ["Challenge slash", "One fifth of minimum stake, 10 SMESH", "ProviderRegistry"],
                ["Bond per lease", "50 SMESH", "RentalMarket"],
                ["Heartbeat grace period", "5 minutes", "RentalMarket"],
                ["Bond per task", "10 SMESH", "JobMarket"],
                ["Task challenge window", "1 hour", "JobMarket"],
                ["Task claim timeout", "1 hour", "JobMarket"],
                ["Vote window", "30 minutes", "Verification"],
                ["Quorum", "1", "Verification"],
                ["Faucet amount and cooldown", "1,000 SMESH per 1 day", "SmeshToken"],
            ],
            [6.0, 5.5, 3.0])
    R.h3("Deterrence for verifiable tasks")
    R.p("Let R be the reward per task, B the bond, and s the probability that a task is spot checked by at least one honest challenger. A provider that skips the computation keeps R if it is not checked and loses B if it is. The expected value of cheating per task is:")
    R.eq("EV(cheat) = (1 - s) R - s B")
    R.p("Cheating is deterred when this value is not positive, which gives the break-even spot-check rate:")
    R.eq("s* = R / (R + B)")
    R.p("A larger bond lowers the rate needed for deterrence and therefore lowers verification cost. With R = B = 100, the break-even rate is 0.5. The simulator in Chapter 10 reproduces this value.")
    R.h3("Deterrence for rentals")
    R.p("A rented result cannot be re-executed, so the corresponding quantity concerns availability. Let V be the value a provider captures per interval by claiming service it did not deliver, D the bond at risk, and h the probability that a false claim is detected. Deterrence needs h D to exceed (1 - h) V, which gives:")
    R.eq("EV(false heartbeat) = (1 - h) V - h D,    h* = V / (V + D)")
    R.p("With V equal to one interval price of 10 and D equal to a bond of 500, h* is about 0.020. Even weak detection deters false claims when the bond is large relative to a single interval of income.")
    R.h2("State Machines")
    R.p("The rental lease has six states. {f:lease} shows the transitions and the effect on escrow and bond in each terminal state. A request escrows the full price while the lease is pending. Acceptance starts the clock and bonds the provider. A lease ends normally when the requester ends it or when every funded interval has heartbeat evidence. It is terminated when a heartbeat is missed beyond the grace period, which slashes the bond to the requester.")
    R.figure("lease", F / "lease-state-machine.png", "Lease states and the treatment of escrow and bond at each terminal state", max_h=9.0)
    R.p("A verifiable task moves through the states in {t:taskstates}. The contract reserves a sixth state, Failed, which is not used in the current implementation.")
    R.table("taskstates", "Verifiable task states and transitions",
            ["State", "Entered by", "Next states"],
            [
                ["Open", "Job posted, or task reopened after a slash", "Claimed"],
                ["Claimed", "claimTask by an eligible provider, bond locked", "Submitted, or Open (timeout reclaim with bond slashed to requester)"],
                ["Submitted", "submitResult with a hash and output CID", "Paid (finalizeTask after the window), Disputed (first challenge)"],
                ["Disputed", "First challenge in Verification", "Paid (provider vindicated), or Open (cheating upheld, bond slashed to challenger)"],
                ["Paid", "Settlement", "Terminal. Reward paid, bond released, reputation raised."],
            ],
            [2.4, 6.0, 6.1])
    R.p("The benchmark challenge has its own state machine, which is described with the registry in Chapter 7.")


def chapter7(R, F):
    R.chapter_h1("SMART CONTRACT DESIGN")
    R.p("The contracts are written in Solidity 0.8.24 and build on OpenZeppelin [@oz]: ERC20, Ownable, SafeERC20, and ReentrancyGuard. Every function that moves tokens either follows the checks-effects-interactions order or is guarded against reentrancy, or both. The sections below describe each contract by state, key functions, events, access control, and invariants. Function lists give the main entry points, not every view.")
    R.h2("SmeshToken")
    R.p("SmeshToken is an ERC-20 token named ShaderMesh Token with symbol SMESH. It adds an owner-controlled `mint` and a `faucet` that mints 1,000 SMESH to the caller. A per-address cooldown (1 day by default, owner adjustable) limits the faucet. The faucet exists only for test networks. The `Faucet` event records each claim.")
    R.h2("ProviderRegistry")
    R.p("ProviderRegistry is the shared staking, reputation, and attestation layer. All market contracts read from it and the authorized ones write to it.")
    R.h3("State")
    R.p("Each provider has a record of registration and active flags, total stake, bonded amount, reputation, completed and failed counters, and a capability string. A separate attestation record holds the attestation time, VRAM, benchmark score, and GPU model. The registry also holds the attester address, the attestation time-to-live, the challenge table, an open-challenge index per provider, the challenge window, the challenge slash amount, and the treasury address.")
    R.h3("Key functions")
    R.p("{t:regfn} lists the registry entry points with the caller allowed to use each.")
    R.table("regfn", "ProviderRegistry functions",
            ["Function", "Caller", "Effect"],
            [
                ["register, updateCapabilities, setActive", "Provider", "Create the record with reputation 5,000, change capabilities, toggle availability."],
                ["stake, unstake", "Provider", "Deposit SMESH. Withdraw only free stake, and only with no open challenge."],
                ["isEligible, availableStake, reputationOf", "Anyone (view)", "Eligibility needs registered, active, and stake at or above the minimum."],
                ["bond, unbond, slash, recordOutcome", "Authorized contracts", "Lock and release stake, confiscate stake to a beneficiary, update reputation."],
                ["attest, isAttested", "Attester, anyone (view)", "Record GPU, VRAM, and score. Fresh within the time-to-live."],
                ["issueChallenge", "Attester", "Open a seeded challenge for an attested provider with no open challenge."],
                ["respondChallenge", "Challenged provider", "Submit output hash and score before the deadline."],
                ["resolveChallenge", "Attester", "Pass or fail an answered challenge within one further window."],
                ["expireChallenge", "Anyone", "Fail a missed deadline, or lapse an answer that was never judged."],
                ["setAuthorized, setMinStake, setAttester, setAttestationTtl, setTreasury, setChallengeParams", "Owner", "Configuration."],
            ],
            [4.6, 3.0, 6.9], size=9.5)
    R.h3("Events and access control")
    R.p("The registry emits events for registration, capability updates, stake, unstake, bond, unbond, slash, reputation changes, availability, authorization, attester and treasury changes, attestation and revocation, and the three challenge phases (`ChallengeIssued`, `ChallengeResponded`, `ChallengeResolved`). Three roles exist. The **owner** configures parameters and authorizes contracts. **Authorized contracts** (the markets and Verification) alone can bond, unbond, slash, and record outcomes. The **attester** alone can attest, issue challenges, and judge answers.")
    R.h3("Invariants")
    R.bullets([
        "Bonded stake never exceeds total stake. A slash reduces the bonded amount first. A challenge slash takes free stake only.",
        "Only free stake can be withdrawn, and not while a challenge is open.",
        "A provider has at most one open challenge.",
        "Only authorized contracts change stake, bond, and reputation on behalf of a market.",
    ])
    R.h2("RentalMarket")
    R.p("RentalMarket implements listings, manifest-bound lease requests, strict per-interval heartbeats, streamed settlement, and termination. It is the primary market.")
    R.h3("State")
    R.p("A listing holds the provider, the price per interval, the interval length in seconds, the minimum and maximum number of intervals, an availability flag, the active lease identifier, and a resource specification string. A lease holds the listing, requester, provider, price, funded, heartbeated, and settled interval counts, escrow, bond, start time, status, and the manifest. A nested mapping records the heartbeat time of every interval of every lease.")
    R.h3("Key functions")
    R.p("{t:rentfn} lists the entry points of the market.")
    R.table("rentfn", "RentalMarket functions",
            ["Function", "Caller", "Effect"],
            [
                ["createListing", "Eligible, attested provider", "Publish capacity with price, interval, and duration bounds."],
                ["setListingAvailable", "Provider", "Toggle a listing that has no active lease."],
                ["requestLease", "Requester", "Escrow price times intervals and bind a manifest. State Pending."],
                ["acceptLease", "Provider", "Start the clock, bond the provider, reserve the listing. State Active."],
                ["rejectLease, cancelLease", "Provider, requester", "Refund the full escrow from a pending request."],
                ["heartbeat", "Provider", "Record evidence for the current interval only, in order."],
                ["settle", "Anyone", "Pay all completed intervals in the heartbeated prefix."],
                ["extendLease", "Requester", "Add intervals and escrow, up to the maximum duration."],
                ["endLease", "Requester", "Pay served intervals, refund the rest, release the bond."],
                ["finalizeExpired", "Anyone", "Close a lease whose funded intervals all have heartbeat evidence."],
                ["terminate", "Anyone", "After the missed-heartbeat deadline, pay the served prefix, refund the rest, slash the bond to the requester."],
            ],
            [3.4, 3.4, 7.7], size=9.5)
    R.p("{f:rental} shows the lifecycle as a sequence of calls between requester, provider, and contract, including the two ways a lease can end.")
    R.figure("rental", F / "rental-sequence.png", "Rental lifecycle: listing, lease, heartbeats, settlement, and the two ways a lease ends", max_h=12.0)
    R.h3("Heartbeat rule")
    R.p("The heartbeat function computes the current interval as the elapsed time since the start divided by the interval length. It accepts a heartbeat only from the lease provider, only for the current interval, only once, and only if the interval equals the number of intervals already heartbeated. A provider therefore cannot cover a missed interval with a later heartbeat. The payable count is the minimum of completed intervals, funded intervals, and heartbeated intervals. The lease is down when the first unheartbeated interval has ended and the grace period has also passed.")
    R.h3("Invariants")
    R.bullets([
        "Settled intervals never exceed heartbeated intervals, and heartbeated intervals never exceed funded intervals.",
        "Escrow decreases only by the amount paid for newly settled intervals, so funded escrow equals provider payment plus requester refund at every terminal state.",
        "The clock, bond, and listing reservation begin only on provider acceptance.",
        "A slash on termination takes the lease bond, which was set aside at acceptance.",
    ])
    R.h2("InferenceMarket")
    R.p("InferenceMarket handles managed inference with prepaid credit. A provider creates an offer with a model identifier and a price per token. It must be eligible and attested. A requester opens a credit against an offer, which escrows funds and snapshots the offer price. After each response the requester calls `settleUsage` with the cumulative prompt and completion token counts. The contract pays the provider for the difference since the last settlement and rejects a payment above the remaining escrow or a counter that decreases. Replaying the same counters pays zero. The requester can close the credit and recover the remaining escrow.")
    R.p("{t:inffn} lists the entry points of the inference market.")
    R.table("inffn", "InferenceMarket functions",
            ["Function", "Caller", "Effect"],
            [
                ["createOffer, deactivateOffer", "Eligible, attested provider", "Publish or withdraw a model offer at a price per token."],
                ["openCredit", "Requester", "Escrow funds and snapshot the price. Offer provider must be eligible and attested."],
                ["settleUsage", "Requester", "Record cumulative usage and pay the delta to the provider from escrow."],
                ["closeCredit", "Requester", "Refund remaining escrow and deactivate the credit."],
            ],
            [3.6, 3.8, 7.1], size=9.5)
    R.p("The invariants are that payment never exceeds escrow, counters never decrease, and only the requester can settle or close. The requester-metered design has a known limit: the contract prevents overdraw and decreasing counters but cannot prevent a requester from under-reporting usage. Chapter 11 discusses it.")
    R.h2("JobMarket")
    R.p("JobMarket is the escrow and state machine for verifiable tasks. A requester posts a job with an input CID, a task count, a reward per task, and a verification policy of 0 (exact keccak256) or 1 (perceptual, off-chain assisted). The contract escrows reward times task count. Providers claim tasks, which bonds 10 SMESH each, submit a result hash and an output CID, and are paid by `finalizeTask` after the challenge window if no dispute is upheld. Anyone can call `reclaimTimedOut` on a task that was claimed but not submitted within the claim timeout, which slashes the bond to the requester and reopens the task. Three functions are restricted to the Verification contract: `markDisputed`, `resolveCheating`, and `resolveHonest`.")
    R.p("{t:jobfn} lists the entry points of the job market.")
    R.table("jobfn", "JobMarket functions",
            ["Function", "Caller", "Effect"],
            [
                ["postJob", "Requester", "Escrow reward times task count. Emit JobPosted."],
                ["claimTask", "Eligible provider", "Bond stake and move the task to Claimed."],
                ["submitResult", "Task provider", "Commit result hash and output CID. State Submitted."],
                ["finalizeTask", "Anyone", "After the challenge window, pay the reward and release the bond."],
                ["reclaimTimedOut", "Anyone", "Slash an abandoning provider and reopen the task."],
                ["markDisputed, resolveCheating, resolveHonest", "Verification only", "Freeze, slash and reopen, or pay a disputed task."],
            ],
            [3.6, 3.4, 7.5], size=9.5)
    R.h2("Verification")
    R.p("Verification is the dispute game for task results. An eligible provider other than the task owner calls `challenge` with an independently computed hash during the task challenge window. The first call opens a dispute, copies the owner commitment, starts a vote window of 30 minutes, and freezes payout through `markDisputed`. Each later challenger adds one vote. A vote agrees when its hash equals the owner hash and disagrees otherwise. The contract prevents a second vote by the same address and prevents self-challenge. After the vote window, anyone can call `resolve`. Cheating is upheld when disagreeing votes exceed agreeing votes and reach the quorum. In that case the first disagreeing challenger receives the slashed bond and a reputation success. Otherwise the owner is paid and the first disagreeing challenger takes a reputation failure.")
    R.p("The current design has known simplifications. Votes are plaintext, so a challenger can copy the owner commitment. Challengers volunteer instead of being selected at random, and votes are not weighted by reputation. The default quorum of one makes a single honest challenger decisive. These are listed as planned hardening in Chapter 12.")
    R.h2("Contract Function Summary")
    R.p("{t:fnsum} summarizes the surface of the six contracts and the access control that applies to state-changing functions.")
    R.table("fnsum", "Summary of contract surface and access control",
            ["Contract", "State-changing functions", "Restricted by", "Reentrancy guard"],
            [
                ["SmeshToken", "mint, faucet, setFaucetCooldown", "Owner (mint, cooldown)", "Not needed"],
                ["ProviderRegistry", "register, stake, unstake, bond, unbond, slash, recordOutcome, attest, issueChallenge, respondChallenge, resolveChallenge, expireChallenge", "Owner, authorized contracts, attester, and the challenged provider", "Uses SafeERC20 transfers"],
                ["RentalMarket", "createListing, requestLease, acceptLease, rejectLease, cancelLease, heartbeat, extendLease, settle, endLease, finalizeExpired, terminate", "Provider or requester per function. Settle, finalize, and terminate are open", "Yes, on token movements"],
                ["InferenceMarket", "createOffer, deactivateOffer, openCredit, settleUsage, closeCredit", "Provider or requester per function", "Yes, on token movements"],
                ["JobMarket", "postJob, claimTask, submitResult, finalizeTask, reclaimTimedOut, markDisputed, resolveCheating, resolveHonest", "Verification contract for dispute outcomes. Owner for parameters", "Yes, on token movements"],
                ["Verification", "challenge, resolve", "Eligible non-owner provider. Resolve is open after the window", "Calls guarded markets"],
            ],
            [2.8, 6.0, 3.8, 1.9], size=9.0)
    R.h2("Benchmark Challenge Mechanism")
    R.p("Attestation is a record written once. A provider could pass it with real hardware and then stop delivering that performance. Benchmark challenges close this gap by testing attested providers repeatedly, with work that cannot be prepared in advance.")
    R.h3("Protocol")
    R.numbered([
        "The attester calls `issueChallenge` for an attested provider that has no open challenge. The seed is keccak256 of `block.prevrandao`, the provider address, and the challenge identifier, so the provider cannot precompute the answer before issuance. The deadline is the issue time plus the challenge window.",
        "The provider runs a chain of 500,000 SHA-256 [@sha2] iterations starting from the seed, measures a score, and calls `respondChallenge` with the output hash and the score. The score is tokens per second multiplied by 100 on a fixed prompt when an Ollama model is configured, and otherwise the hash rate in kilohashes per second.",
        "The attester recomputes the hash chain. The challenge passes when the hash matches and the score is at least the attested score multiplied by the minimum score ratio (50 percent by default). A pass refreshes the attestation and records a reputation success.",
        "A wrong answer judged by the attester fails the challenge. A missed deadline is closed by `expireChallenge`, which any account may call.",
        "A failed challenge slashes up to the challenge slash amount from **free stake only**, sends it to the treasury, revokes the attestation, and records a reputation failure. Active leases continue under their existing bonds.",
        "An answered challenge that the attester never judges within one further window lapses with no penalty.",
    ])
    R.p("{f:chseq} shows the message flow and {f:chstate} shows the challenge states and the conditions for each transition.")
    R.figure("chseq", F / "challenge-sequence.png", "Benchmark challenge: issue, answer, judge, and the permissionless expiry paths", max_h=12.0)
    R.figure("chstate", F / "challenge-state-machine.png", "Benchmark challenge states and transition conditions", max_h=8.0)
    R.h3("Security reasoning")
    R.p("Each rule in the mechanism closes a specific attack or abuse path.")
    R.bullets([
        "**Free stake only.** Bonded stake backs the compensation owed to requesters of active leases and tasks. If a challenge could slash it, a failed benchmark would reduce the funds that protect a requester who is not part of the dispute, and the attester would gain a path to drain lease bonds. Restricting the slash to free stake keeps the invariant that bonded stake is whole. The slash is also capped by the free stake that exists, so it cannot underflow.",
        "**Unstake lock.** Without the lock, a provider that has just been issued a challenge could withdraw all free stake, then fail or ignore the challenge with nothing left to slash. The registry therefore rejects `unstake` while the provider has an open challenge.",
        "**Permissionless expiry.** A provider that stays silent cannot avoid a penalty, and the attester cannot shield a friendly provider by not acting. After the deadline anyone can call `expireChallenge`, and the outcome depends only on the clock and on the absence of a response, so it needs no trusted input.",
        "**Lapse path.** If the provider answered but the attester never judges, the challenge would stay open and would block unstaking indefinitely. After one further window, anyone can lapse it with no penalty. A silent or offline attester cannot hold a provider locked, and it cannot slash late.",
        "**Seeded work.** A seed that depends on `block.prevrandao`, the provider, and the identifier prevents precomputation and replay across providers. The value is not a source of strong randomness against block proposers. Its purpose here is to prevent a provider from preparing an answer before the challenge exists.",
        "**One open challenge.** Limiting each provider to one open challenge bounds the load on the provider and the number of penalties that can be pending.",
    ])
    R.p("The mechanism leaves the attester as a trusted judge of answers. The registry bounds that trust. The attester can fail a correct answer, which costs the provider up to the slash amount and its attestation, but it cannot touch bonded stake, move funds to itself (the slash goes to the treasury), or exceed the configured amount per challenge. A failed provider must be attested again before another challenge can be issued, and re-attestation is also an attester action. The attester should therefore be run by a party that the participants accept, and its decentralization is future work.")


def chapter8(R, F, S):
    R.chapter_h1("IMPLEMENTATION")
    R.h2("Technology Stack")
    R.p("{t:stack} lists the technologies used for each layer and the reason for each choice.")
    R.table("stack", "Technology stack",
            ["Layer", "Technology", "Reason"],
            [
                ["Blockchain", "Ethereum, Hardhat local node, Sepolia testnet [@hardhat, @sepolia]", "EVM settlement with a reproducible local target and a public testnet."],
                ["Contracts", "Solidity 0.8.24, OpenZeppelin [@oz]", "Standard token, access-control, and reentrancy primitives."],
                ["Contract tooling", "Hardhat, TypeScript, Chai", "Compile, deploy, test, and report gas."],
                ["Provider agent", "Python 3.11, web3.py, Docker SDK [@web3py, @docker]", "Chain transactions, lease and task workers, hardware discovery."],
                ["LLM runtime", "Deterministic echo backend and Ollama [@ollama]", "Reproducible tests and real model serving."],
                ["Orchestrator", "Node 20, TypeScript, ethers v6", "Indexing, API, gateway, split and stitch."],
                ["Datastore", "PostgreSQL 16 [@postgres]", "Durable projection snapshots, event cursors, replay keys."],
                ["Storage", "IPFS Kubo [@ipfs]", "Content-addressed manifests, inputs, outputs."],
                ["Web", "Next.js 16, React 19, viem, Tailwind [@next, @viem]", "Wallet writes through EIP-1193 [@eip1193] and indexed reads."],
                ["Compute runtime", "Docker with optional NVIDIA Container Toolkit", "Constrained task and lease execution with GPU access."],
                ["Dev infrastructure", "Docker Compose, GitHub Actions", "Local stack, provider-only node, Sepolia operator stack, CI."],
                ["End-to-end tests", "Playwright [@playwright]", "Browser checks and wallet-write automation."],
            ],
            [3.0, 5.8, 5.7], size=9.5)
    R.h2("Provider Agent")
    R.p("The provider agent is a Python daemon that serves leases, serves inference, executes verifiable tasks, and answers benchmark challenges. It is untrusted by design: it signs transactions with the provider key, and the contracts decide what those transactions achieve. {t:agentmods} lists its modules.")
    R.table("agentmods", "Provider agent modules",
            ["Module", "Responsibility"],
            [
                ["config.py", "Environment-driven configuration."],
                ["chain.py", "web3 client. Loads addresses and ABIs from the deployment file, signs and sends transactions."],
                ["storage.py", "Content-addressed storage with a local directory backend for tests and an IPFS backend for the stack."],
                ["executor.py", "One-shot task execution and recoverable, sandboxed lease containers with optional NVIDIA access."],
                ["retry.py", "Shared bounded exponential retry policy."],
                ["discover_hardware.py", "Standard-library hardware and service discovery for Windows and Linux."],
                ["provider.py", "Agent for verifiable tasks: register, stake, claim, execute, submit, challenge."],
                ["rental.py", "RentalProvider (discover, accept or reject, serve, heartbeat) and RentalRenter (request, settle, end, terminate)."],
                ["inference.py", "OpenAI-compatible endpoint with echo and Ollama backends and token metering."],
                ["serve_provider.py", "Provider node entrypoint: register, stake, list, serve inference, heartbeat, answer challenges."],
                ["benchmark.py", "Deterministic challenge workload, scoring, responder, and a score command."],
                ["attester.py", "Operator-run service that issues, judges, and expires challenges."],
            ],
            [3.8, 10.7], size=9.5)
    R.h3("Lease serving")
    R.p("The agent accepts a pending lease only when its manifest matches an exact content-addressed manifest that the provider configured, and rejects every other request. Acceptance starts the lease and bonds stake on chain. The runtime then launches only the provider-configured image, command, environment, and device settings. It never executes arbitrary requester input. The requester cannot select the image, command, mounts, or devices. Each loop the agent checks that the workload container is healthy and sends one heartbeat for the current interval. Polling the same interval does not submit a second transaction. After a restart, the agent reconciles active leases to labelled containers.")
    R.h3("Sandboxing")
    R.p("Lease and task containers run with no network, a read-only root file system, a non-root user, all Linux capabilities dropped, `no-new-privileges`, a small temporary file system, and limits on CPU, memory, swap, and processes. GPU access is off by default. It is enabled only when two settings agree, and it is restricted to configured devices. A task gets a size-bounded Docker volume that is mounted only at `/io`. A short-lived trusted helper writes the manifest before the untrusted task starts. No host path is mounted. The agent mounts the Docker socket to launch sibling containers, which is a host-level risk that Chapter 11 discusses.")
    R.h3("Inference serving")
    R.p("`inference.py` serves `/v1/chat/completions` and `/v1/models`. The echo backend is deterministic and used in tests and in continuous integration. The Ollama backend forwards to a local model server and returns the provider token counts. On start, `serve_provider.py` scans the existing offers for the provider address and keeps one active offer per configured model at the configured price. It deactivates duplicates and stale prices, and creates an offer only when needed, so a restart does not create duplicates. Offers are created only when the provider is eligible and attested. The price is configured in SMESH per 1,000 tokens and converted exactly to 18-decimal base units per token. A value that would need rounding is rejected.")
    R.h3("Benchmark responder")
    R.p("Each poll, the agent reads its open challenge from the registry, computes the 500,000-iteration hash chain from the seed, measures a score, and calls `respondChallenge`. Two demonstration switches, `BENCHMARK_FAULT=wrong_hash` and `silent`, force the two failure paths for demonstrations.")
    R.h2("Attester Service")
    R.p("`attester.py` runs with the registry attester key. For every attested provider it issues a challenge each interval (300 seconds by default), recomputes the hash chain when an answer arrives, passes the response only if the hash matches and the score reaches the required share of the attested score, and calls `expireChallenge` for missed deadlines. Its state is rebuilt from `Attested` and `ChallengeIssued` events, so a restart loses nothing. It logs one line per action in the form `challenge=<id> provider=<address> outcome=<issued|passed|failed|lapsed>`. The service never holds user funds.")
    R.h2("Orchestrator")
    R.p("The orchestrator is a thin, untrusted coordinator written in TypeScript. It holds no keys and cannot move funds.")
    R.h3("Event index and persistence")
    R.p("The indexer reads events from all six contracts and applies them in exact block and log order to an in-memory projection. Postgres stores one complete versioned snapshot and an exact (block number, log index) cursor for each deployment identity, which is the chain identifier plus the normalized contract address map. At startup the orchestrator restores the snapshot, replays only later events, starts one poll loop, and runs a second catch-up to close the replay and poll race. Every event updates and saves a candidate snapshot and cursor before it becomes visible to API and stream consumers. The database is only a derived cache. Dropping its two tables is safe, because the next start rebuilds the projection from chain events. Historical log queries use a configurable block range. The live Sepolia indexer uses 10-block chunks to stay within the limits of the RPC provider. Transient network and rate-limit failures retry with bounded exponential backoff and degrade the health endpoint only after retries are exhausted.")
    R.h3("Inference gateway")
    R.p("`POST /v1/chat/completions` accepts the normal OpenAI-style fields plus an authorization object. The requester signs a canonical string with EIP-191 `personal_sign` [@eip191]. The string covers the credit identifier, expiry, the keccak256 hash of the canonical message JSON, the model, the provider, the request identifier, and the requester. The gateway verifies the signature, checks that the credit is active with nonzero escrow and matches the signer, provider, and offer model, and consumes the request identifier atomically in Postgres so that it cannot be replayed, even across restarts. It then routes only to the provider fixed by the credit. Provider endpoints must use HTTP or HTTPS, carry no credentials, match an exact hostname allowlist, and may not redirect. Request size and provider time-out are bounded. The gateway returns the provider usage and a projected credit balance. It does not settle usage.")
    R.h3("Split and stitch")
    R.p("For deterministic jobs, `prepare` splits an image into tiles with matching sub-regions of the complex plane, builds a manifest, and pins it to storage. The returned CID is what the requester posts on chain. After every task settles, `stitchJob` fetches each output CID, composes the final image, and pins the result. Pinning is not custody of money, so it is safe for the untrusted orchestrator to do.")
    R.h2("Web Application")
    R.p("The web application is built with Next.js, React, TypeScript, viem, and Tailwind. It reads indexed state from the orchestrator and sends every write through the connected wallet. It never stores secrets.")
    R.h3("Pages")
    R.p("{t:webpages} lists the routes.")
    R.table("webpages", "Web application routes",
            ["Route", "Purpose"],
            [
                ["/", "Landing page with protocol diagrams: lease lifecycle, token flow, escrow by interval, heartbeats, challenge track."],
                ["/dashboard", "Network overview: available capacity, attested providers, streaming spend."],
                ["/rent", "Browse GPU listings and request a manifest-bound lease."],
                ["/leases", "Own leases with heartbeat progress, streamed spend, and lease evidence. Cancel, settle, end."],
                ["/models", "Model catalog and a prompt playground using prepaid credit and signed requests."],
                ["/providers", "Provider console: faucet, registration, capabilities, stake, availability, listings, offers, earnings, reputation, challenge history."],
                ["/explorer", "Network token-flow figure, lease inspector, Challenges tab, and a color-coded event timeline with plain descriptions."],
            ],
            [3.0, 11.5], size=10)
    R.p("The page list above is also the order of the navigation sidebar. The sidebar collapses to a scrolling tab row below 768 pixels.")
    R.h3("Design system")
    R.p("The interface follows a written design system in `web/DESIGN.md`. The design is light first, with a warm paper palette and an equal dark theme selected by a toggle and remembered per browser. Amber is the single accent and appears on primary actions, active navigation, and focus rings. Neutral surfaces carry the layout. Controls use 6-pixel radii and cards 8 pixels, with hairline borders and minimal shadows. Geist is the interface typeface and Geist Mono is used for every hash, address, and amount. Status colors are muted and differ by theme. All text pairs meet WCAG AA contrast on the background, chrome, and surface colors in both themes [@wcag]. Motion is limited to state changes of 150 to 250 milliseconds and is disabled by the reduced-motion preference. The system prohibits neon colors, purple gradients, glassmorphism, large glows, and pill-shaped buttons. {f:landing} and {f:landingdark} show the landing page in both themes.")
    R.figure("landing", S["landing"], "Landing page in the light theme", max_h=9.0, prepared=S["landing_crop"])
    R.figure("landingdark", S["landing-dark"], "Landing page in the dark theme", max_h=9.0, prepared=S["landing_dark_crop"])
    R.h3("Wallet writes")
    R.p("All state changes use the connected EIP-1193 wallet. Lease requests need an ERC-20 approval followed by `requestLease`. Inference credit follows the same approve-then-open pattern. For each chat request, the page signs the canonical authorization, sends it to the gateway, and after the response submits cumulative usage to `settleUsage`. The page blocks further requests until settlement confirms or the indexed chain state shows it completed. This prevents a requester from running ahead of its own payments.")
    R.h2("Deployment")
    R.h3("Local stack with Docker Compose")
    R.p("The root Compose file brings up the whole system on one machine with healthchecks and dependency conditions that enforce boot order. Its services are the Hardhat chain, the contract deployer, IPFS, Postgres, the orchestrator, a lease workload image, the provider, a seed service, the attester, and the web application. The deployer writes a descriptor with the network name, chain identifier, and each contract address and ABI to a shared volume, and off-chain services load everything from that one file. The seed service creates listings and an accepted lease so the interface has data on first load.")
    R.code(["Copy-Item .env.example .env", "docker compose up --build -d --wait", "docker compose ps"])
    R.h3("Provider-only node")
    R.p("A second Compose file runs only the provider agent against an operator deployment. On Windows, a hardware discovery command first reports the operating system, CPU, memory, NVIDIA GPU and driver, Docker, and Ollama availability without printing keys. Ollama stays on the Windows host and is reached from the container through `host.docker.internal`. GPU passthrough is off unless two settings are enabled.")
    R.h3("Sepolia operator and provider topology")
    R.p("The public deployment separates the operator from the providers. {t:topology} lists who runs what.")
    R.table("topology", "Sepolia deployment topology",
            ["Party", "Runs", "Holds"],
            [
                ["Operator", "Contract deployment and bootstrap scripts. Operator Compose stack: Postgres, IPFS, orchestrator, web. Attester service.", "Deployer key and attester key in untracked environment files. No user funds."],
                ["Provider laptop", "Provider Compose stack: agent, Docker sibling workloads, Ollama on the host.", "The provider wallet key. Stake is held by the registry, not by the machine."],
                ["Requester", "Browser and wallet.", "Own keys and funds."],
                ["Public services", "Sepolia network, Etherscan for source verification, an RPC endpoint.", "Public chain state."],
            ],
            [2.8, 7.0, 4.7], size=9.5)
    R.p("The operator deploys with an environment-provided key and RPC endpoint, publishes the public deployment descriptor, and bootstraps providers and a test requester by an idempotent script that funds wallets to target balances and skips matching fresh attestations. Providers register themselves first. The web build carries only public-safe configuration, and the orchestrator accepts provider endpoints only from an exact hostname allowlist. All six deployed contracts were source-verified on Etherscan with a repeatable script.")


def chapter9(R, F):
    R.chapter_h1("TESTING")
    R.h2("Strategy")
    R.p("Testing follows the trust model. The contracts carry the value, so they get the most detailed tests, including lifecycle and conservation tests. The off-chain components are tested for the behavior that protects users, such as sandbox controls, replay protection, and ordered replay. The simulator is tested against closed-form results. The full stack is tested end to end in a browser against a fresh local deployment. {t:tests} summarizes the suites and their counts.")
    R.table("tests", "Test suite summary",
            ["Component", "Tooling", "Tests", "Scope"],
            [
                ["Contracts", "Hardhat, Chai", "42", "Token, registry, jobs, disputes, pending rental acceptance, strict heartbeats, escrow conservation, prepaid inference, benchmark challenges."],
                ["Provider agent", "pytest, local chain, fakes", "58", "Task and rental lifecycles, sandbox controls, task I/O, restart recovery, offer reconciliation, hardware parsing, retries, challenger behavior, benchmark answering and judging."],
                ["Orchestrator", "Vitest, Postgres", "54 (plus 1 skipped without a database)", "Bounded log-range replay, durable projection, ordered replay, challenge indexing, replay protection, gateway controls, API, split, stitch."],
                ["Simulator", "unittest", "15", "Closed-form thresholds, mixed populations, rental uptime, false heartbeats, escrow conservation, determinism."],
                ["Web", "Playwright", "24", "20 read-only checks over 10 specs on desktop and 390-pixel mobile, plus 4 desktop wallet-write specs."],
            ],
            [2.4, 3.0, 2.4, 6.7], size=9.5)
    R.h2("Contract Tests")
    R.p("The 42 contract tests are split over four files. `ShaderMesh.test.ts` has 13 tests for the token faucet cooldown, registry economics and the protection of bonded stake, provider activity, attester authorization and attestation expiry, the job claim timeout slash, the claim-submit-finalize happy path, the cheating path with slash and reopen, dispute vote rules (self, duplicate, and late votes), and the disagreement quorum. `RentalMarket.test.ts` has 13 tests for pending requests bound to a manifest, acceptance-time start, bond, and reservation, rejection and cancellation refunds, one heartbeat per interval with no retroactive coverage, settlement of the contiguous heartbeated prefix, finalization, escrow conservation across payment and early-end refund, termination with prefix payment, refund, and slash, the maximum-duration limit, lifecycle authorization, and the attestation gate on listings. `InferenceMarket.test.ts` has 9 tests for offer validity, credits with snapshotted price, cumulative settlement with replay as a no-op, rejection of decreasing counters and overdraw, authorization of settlement and close, deactivation, repeated eligibility checks, refunds, and conservation of requester funds across concurrent credits. `BenchmarkChallenge.test.ts` has 7 tests for default treasury and slash, admin and attester restrictions, a passed challenge that refreshes attestation, a failed answer that slashes free stake and revokes attestation, a missed deadline that anyone can fail, the lapse path, and the rule that bonded stake is never slashed.")
    R.h2("Provider Agent Tests")
    R.p("The agent suite of 58 tests runs against a real local Hardhat chain through shared session fixtures, with fakes for Docker and IPFS where a unit test needs them. Integration tests drive the verifiable-task lifecycle including slashing, the rental lifecycle including acceptance, rejection, streamed settlement, refund, and downtime slashing, and the challenge lifecycle against the real registry, including restart safety. Unit tests cover the lease executor (sandbox flags, GPU gating, recovery labels, cleanup, health-backed heartbeats), worker safety (task sandboxing, retry classification and backoff, IPFS retries, challenger sampling), inference (metering, exact offer pricing, idempotent offer creation), benchmark determinism and judging, and hardware parsing.")
    R.h2("Orchestrator Tests")
    R.p("The orchestrator suite has 54 tests that run in continuous integration against Postgres, and one Postgres integration test that is skipped when `TEST_DATABASE_URL` is not set. Tests cover API routes, the authorization canonicalization and signature checks, the gateway controls (body limit, time-out, hostname allowlist, redirect refusal, replay), challenge indexing, the indexer (ordered replay and bounded range), persistence of the projection, rental and inference projections, splitting, stitching, and the store.")
    R.h2("Simulator Tests")
    R.p("The 15 simulator tests check the closed-form break-even values, the rental false-heartbeat economics, escrow conservation, determinism by seed, mixed population accounting, full uptime, immediate downtime detection, undetected false heartbeats, behavior with no challengers, and rejection of invalid inputs.")
    R.h2("End-to-End Browser Tests")
    R.p("Playwright runs 24 checks against the running Compose stack. It does not start or stop services. There are two projects: a desktop Chromium viewport of 1440 by 900 pixels and a mobile viewport 390 pixels wide. Ten read-only specs run on both and check that each route renders cleanly with no browser errors or horizontal overflow, that navigation reaches every route, that the explorer tabs expose indexed sections, that the landing page opens the app, and that the theme toggle switches to dark and persists. This gives 20 read-only checks.")
    R.h3("Wallet-write automation")
    R.p("Four further specs perform real wallet writes and run on desktop only, because they share one chain and one listing. A real browser wallet cannot be driven reliably in continuous integration, so the specs inject a minimal EIP-1193 provider [@eip1193] into the page. The provider forwards JSON-RPC calls to the local Hardhat node, which signs for its unlocked accounts. This exercises the real application code, real contract calls, and the real orchestrator, and replaces only the wallet user interface. The four specs are:")
    R.numbered([
        "Connect a wallet and show the address and the SMESH balance.",
        "Request a lease, observe it become Active, show heartbeat evidence, end it, and check the refund.",
        "Open a prepaid inference credit, send a chat request with a signed authorization, settle usage, and close the credit.",
        "Register and stake a fresh provider and show it as unattested.",
    ])
    R.p("The specs use Hardhat accounts 5, 6, and 7 and a new random address for the provider spec. If every listing is reserved by another lease, the fixture ends or cancels that lease first. The specs must not be run against a public network.")
    R.h2("Continuous Integration")
    R.p("GitHub Actions runs five component jobs and a dependent full-stack job on every push and pull request. The contracts job compiles, tests, and records gas. The agent job runs the Python suite. The orchestrator job runs all tests against a Postgres service and type checks. The web job runs lint, type check, and a production build. The simulator job runs its tests and the simulation. The full-stack job starts a fresh Compose deployment with the echo inference backend, runs the signed prepaid-inference smoke flow, and runs the 24 Playwright checks.")
    R.h2("Gaps")
    R.p("Property-based fuzzing of the contracts is not present. Escrow conservation is covered by lifecycle tests for the current paths, but not by randomized sequences. A formal accessibility audit, a measurement of event latency, and cross-platform runs beyond Windows development and Linux continuous integration are also not complete. The contracts have not been externally audited.")
