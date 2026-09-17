# ShaderMesh: Software Requirements Specification and Phase Plan

Version: 1.3
Status: Implementation-aligned baseline; Sepolia deployed and live paths validated
Related documents: [Review 1 proposal](ShaderMesh-Review1-Proposal.md),
[demo and presentation guide](ShaderMesh-Demo-Presentation.md),
[Review 1 report](ShaderMesh-Review1-Report.docx), and the repository
[contributor guide](../AGENTS.md).

This document specifies what ShaderMesh must do, how the pieces fit together, how we
will test it, and the phased plan to build it. It is the single source of truth for
scope and acceptance. Where this document and the proposal disagree, this document wins.

---

## 1. Introduction

### 1.1 Purpose

Define the functional and non functional requirements, external interfaces, data model,
verification design, frontend design system, testing strategy, deployment plan, and a
phase by phase roadmap for ShaderMesh.

### 1.2 Product scope

ShaderMesh is a decentralized marketplace for renting compute, coordinated by Ethereum
smart contracts. Providers stake and rent out GPU and CPU capacity; requesters lease it
to run provider-approved containerized workloads. The headline use case is AI and LLM compute: rent a
GPU to run or fine-tune a model, or call a managed, provider-served, OpenAI-compatible
inference endpoint. The blockchain is the trust, coordination, and payment layer.

The marketplace has two modes over one staking, reputation, and slashing layer:

- Rental (primary). A time-based lease of a node or GPU. A rented result cannot be
  re-executed and checked, so trust is availability based. The current prototype uses
  stake, direct heartbeat transactions, trusted attestation records, reputation, and
  slashing for missed heartbeats, with escrow streamed per interval. Independent probes
  and real benchmark challenges remain planned.
- Verifiable task (retained). A job with a checkable output such as rendering or batch
  compute. The current optimistic game uses stake, voluntary eligible challengers,
  plaintext result-hash votes, and slashing. Random selection and reputation weighting
  remain planned.

In scope:
- On chain rental market (lease lifecycle, streamed escrow, heartbeats, SLA slashing).
- On chain verifiable-task market (escrow, tasks, spot-check verification, disputes).
- Provider capability attestation (benchmark or challenge) in the registry.
- A provider node agent that serves leases, serves LLM inference, and runs Docker jobs.
- An orchestrator that indexes the market, routes inference through an OpenAI-compatible
  gateway with metering, and splits and stitches verifiable jobs.
- A web dashboard for renting GPUs, using models, provider operations, and an on-chain
  explorer. Verifiable-job submission and live assembly remain planned.
- An economic simulator for evaluation.
- Local deployment via Docker Compose and a public testnet deployment on Sepolia.

Out of scope for this project:
- A custom base layer blockchain or consensus algorithm. We inherit Ethereum.
- Verifying LLM output correctness or training on chain. This is not practical; rented
  compute is secured by availability and attestation, not by result re-execution.
- Production grade custody, KYC, or fiat payment rails.
- A token sale or any real financial instrument. SMESH is a utility and test token.

### 1.3 Definitions and acronyms

| Term | Meaning |
|------|---------|
| Requester | User who rents compute or posts a job and pays for it. |
| Provider | Staked node that rents out capacity, serves inference, or executes tasks. |
| Lease | A time-based rental of a node or GPU with escrow that streams per interval. |
| Heartbeat | A provider-signed on-chain transaction recording service for exactly the current lease interval. |
| Inference credit | Prepaid escrow tied to one requester, provider, model offer, and snapshotted token price. |
| Attestation | A time-limited hardware record written by the configured attester. |
| SLA | Service level agreement; missed lease heartbeats are currently slashable. |
| Inference gateway | Orchestrator component that routes OpenAI-compatible requests to providers. |
| Challenger | Provider that re executes a submitted task to verify it. |
| Task | An independent unit of a verifiable job, for example one frame or image tile. |
| Escrow | Funds locked in a market contract until settlement or streamed over a lease. |
| Bond | Portion of a provider stake locked to a claimed task, at risk of slashing. |
| Slashing | Programmatic confiscation of stake for provable misbehavior. |
| Reputation | On chain score updated by an exponential moving average of outcomes. |
| Spot check | Randomized re execution of a fraction of results to deter cheating. |
| EMA | Exponential moving average. |
| CID | Content identifier used by IPFS. |
| SSIM | Structural similarity index, used for perceptual image comparison. |
| EVM | Ethereum Virtual Machine. |
| e2e | End to end testing across multiple components. |

### 1.4 Document conventions

Functional requirements use identifiers such as FR-JOB-01. Non functional requirements
use identifiers such as NFR-SEC-01. Requirement levels use "must", "should", and "may".
Writing style follows the root `AGENTS.md`: professional English, no em dashes, and no
marketing language.

---

## 2. Overall description

### 2.1 Product perspective

ShaderMesh is a set of cooperating components around a trust boundary. The blockchain is
the trusted settlement and validation layer. Everything off chain is untrusted and must
not be able to steal funds or force acceptance of an incorrect result.

```
Trusted (on chain):     SmeshToken, ProviderRegistry (+ attestation),
                        RentalMarket, InferenceMarket, JobMarket, Verification
Untrusted (off chain):  Orchestrator (inference gateway, index, split/stitch),
                        Provider agents, Web dashboard, IPFS, Postgres
```

### 2.2 Actors and user classes

| Actor | Description | Primary goals |
|-------|-------------|---------------|
| Requester (rental) | Needs a GPU or node to run or fine-tune a model. | Lease capacity at a fair price, get a live endpoint, pay only for uptime. |
| Requester (inference) | Needs model output without managing hardware. | Call a managed OpenAI-compatible endpoint, pay per usage. |
| Requester (task) | Has a deterministic job with a checkable output. | Submit a job, receive a verified result. |
| Provider | Owner of idle GPU or CPU capacity. | Stake, pass attestation, serve leases and inference, earn, build reputation. |
| Challenger | A provider acting in verification mode. | Detect incorrect task results, earn slashed bonds and reputation. |
| Operator | Person running the local or testnet deployment. | Bring up the stack, deploy contracts, monitor health. |
| Reviewer | Course evaluator or portfolio viewer. | Understand the design and see a working demo. |

### 2.3 Operating environment

- Contracts run on any EVM chain. Local uses a Hardhat node. The public deployment runs on Sepolia.
- Off chain services run as Docker containers orchestrated by Docker Compose.
- The provider agent requires access to a Docker daemon to launch job containers.
- The web dashboard runs in modern browsers and connects a wallet such as MetaMask.

### 2.4 Constraints

- Solidity version 0.8.24 with the optimizer enabled.
- On chain storage holds compact protocol metadata, CIDs, hashes, and accounting. Workload
  payloads and task artifacts live off chain.
- Gas cost of core operations must remain modest so the demo is affordable on a testnet.
- The design must run on commodity hardware with two or three provider nodes.

### 2.5 Assumptions and dependencies

- Providers hold SMESH for stake, obtained from the token faucet on test networks.
- IPFS is reachable by the agent and orchestrator.
- At least one honest challenger participates during the vote window for a disputed task.
- Deterministic jobs produce identical bytes across machines. Rendering jobs may not;
  the planned perceptual verification policy in section 6 addresses that limitation.

---

## 3. Functional requirements

### 3.1 Token (SmeshToken)

| ID | Requirement | Level |
|----|-------------|-------|
| FR-TKN-01 | Provide a standard ERC-20 token named SMESH used for payment, staking, and rewards. | must |
| FR-TKN-02 | Provide an owner controlled mint for seeding reward pools on test networks. | must |
| FR-TKN-03 | Provide a rate limited faucet so demo users can obtain test tokens. | should |

### 3.2 Provider registry and staking

| ID | Requirement | Level |
|----|-------------|-------|
| FR-REG-01 | Allow a provider to register with a free form capability description. | must |
| FR-REG-02 | Allow a provider to deposit and withdraw stake, where withdrawal cannot exceed unbonded stake. | must |
| FR-REG-03 | Track total stake, bonded stake, and available stake per provider. | must |
| FR-REG-04 | Maintain a reputation score in the range 0 to 10000 updated by an EMA of outcomes. | must |
| FR-REG-05 | Restrict bond, unbond, slash, and reputation updates to authorized protocol contracts. | must |
| FR-REG-06 | Expose an eligibility check that requires registration, an active flag, and a minimum stake. | must |
| FR-REG-07 | Allow a provider to toggle availability without withdrawing stake. | should |
| FR-REG-08 | Record structured capabilities (GPU model, VRAM, CPU, region) alongside the free form description. | must |
| FR-REG-09 | Support a benchmark or attestation challenge that proves advertised hardware; a failed challenge is slashable and lowers reputation. | should |
| FR-REG-10 | Update reputation from lease outcomes (uptime and SLA) as well as task outcomes. | must |

### 3.3 Job market and escrow

| ID | Requirement | Level |
|----|-------------|-------|
| FR-JOB-01 | Allow a requester to post a job with an input CID, task count, reward per task, and a verification policy. | must |
| FR-JOB-02 | Lock reward per task multiplied by task count in escrow at posting time. | must |
| FR-JOB-03 | Allow an eligible provider to claim an open task, bonding stake for the duration. | must |
| FR-JOB-04 | Allow the assigned provider to submit a result commitment consisting of a hash and an output CID. | must |
| FR-JOB-05 | Settle a task optimistically after a challenge window when no dispute is upheld, paying the provider and raising reputation. | must |
| FR-JOB-06 | Allow anyone to reclaim a task whose provider missed the submission timeout, slashing the abandoning provider bond to the requester and reopening the task. | must |
| FR-JOB-07 | Allow only the Verification contract to mark a task disputed and to force a cheating or honest outcome. | must |
| FR-JOB-08 | Emit events for every state transition so off chain services can index progress. | must |
| FR-JOB-09 | Track completed task count per job and emit a completion event when all tasks settle. | must |

### 3.4 Verification game

| ID | Requirement | Level |
|----|-------------|-------|
| FR-VER-01 | Allow an eligible provider other than the task owner to challenge a submitted task by committing an independently computed result. | must |
| FR-VER-02 | Open a dispute on first challenge, freeze optimistic payout, and start a vote window. | must |
| FR-VER-03 | Tally votes as agreement or disagreement against the original commitment. | must |
| FR-VER-04 | Resolve by majority after the vote window, paying the honest party or slashing the cheater and rewarding the first correct challenger. | must |
| FR-VER-05 | Prevent double voting by a single challenger on a task. | must |
| FR-VER-06 | Support a commit and reveal scheme so challengers cannot copy the original commitment. | should |
| FR-VER-07 | Weight challenger selection and vote power by reputation and select spot checks at random. | should |
| FR-VER-08 | Support a perceptual verification policy that accepts results within an SSIM threshold for rendering jobs. | should |

### 3.5 Orchestrator

| ID | Requirement | Level |
|----|-------------|-------|
| FR-ORC-01 | Discover contract addresses from the deployment file and connect to the chain. | must |
| FR-ORC-02 | Index registry, rental, inference, job, and verification events into a durable Postgres projection for fast queries. | must |
| FR-ORC-03 | Split a job into tasks according to a split policy such as frames or tiles, and pin the manifest to IPFS. | must |
| FR-ORC-04 | Stitch verified task outputs into a final artifact and make it available to the requester. | must |
| FR-ORC-05 | Expose a read API over HTTP and a live update channel for the dashboard. | must |
| FR-ORC-06 | Never hold private keys or custody funds. | must |

### 3.6 Provider agent

| ID | Requirement | Level |
|----|-------------|-------|
| FR-AGT-01 | Register and stake automatically if not already eligible. | must |
| FR-AGT-02 | Discover open tasks and claim them, respecting available stake. | must |
| FR-AGT-03 | Fetch inputs from IPFS, execute the job in a constrained Docker container, and pin outputs to IPFS. | must |
| FR-AGT-04 | Commit the result hash and output CID on chain within the timeout. | must |
| FR-AGT-05 | Operate in challenger mode by sampling submitted tasks and re executing them. | must |
| FR-AGT-06 | Apply resource limits and treat all job inputs as untrusted. | must |
| FR-AGT-07 | Recover from transient RPC and IPFS failures with retries and backoff. | should |
| FR-AGT-08 | Serve an active lease: launch the requester's container or expose the leased GPU, and send signed heartbeats per interval. | must |
| FR-AGT-09 | Serve advertised models via an OpenAI-compatible inference endpoint. | must |
| FR-AGT-10 | Respond to benchmark and attestation challenges from the registry. | should |

### 3.7 Web dashboard

| ID | Requirement | Level |
|----|-------------|-------|
| FR-WEB-01 | Connect a wallet and display the connected account and SMESH balance. | must |
| FR-WEB-02 | Let a requester browse GPU listings, open a lease, and monitor uptime and streamed spend. | must |
| FR-WEB-03 | Provide a model catalog and a prompt playground for managed inference, with usage and cost. | must |
| FR-WEB-04 | Let a requester post a verifiable job and track task progress, including live tile assembly for rendering. | should |
| FR-WEB-05 | Let a provider register, stake, list capacity, view earnings, uptime, and reputation, and toggle availability. | must |
| FR-WEB-06 | Provide an explorer of leases, jobs, tasks, disputes, and slashing events. | must |
| FR-WEB-07 | Display hashes, addresses, and amounts in monospace with copy actions and safe truncation. | should |
| FR-WEB-08 | Perform all writes through the user wallet and never store secrets. | must |

### 3.8 Simulator

| ID | Requirement | Level |
|----|-------------|-------|
| FR-SIM-01 | Model the verification game economics and validate the break even spot check rate. | must |
| FR-SIM-02 | Report the security and cost tradeoff across spot check rates and bond sizes. | must |
| FR-SIM-03 | Support heterogeneous provider populations including honest, lazy, and colluding behavior. | should |
| FR-SIM-04 | Model rental economics: uptime, SLA slashing, and streamed payment over a lease. | should |

### 3.9 Rental market and leases (primary)

| ID | Requirement | Level |
|----|-------------|-------|
| FR-RENT-01 | Allow a provider to list capacity with price per interval, resource spec, and minimum and maximum duration. | must |
| FR-RENT-02 | Allow a requester to open a lease against a listing and fund escrow for the requested duration. | must |
| FR-RENT-03 | Bond a portion of the provider stake for the duration of an active lease. | must |
| FR-RENT-04 | Stream escrow to the provider per settled interval and refund the requester for unused intervals on early end. | must |
| FR-RENT-05 | Require a signed provider heartbeat per interval; a settled interval must be backed by a valid heartbeat. | must |
| FR-RENT-06 | Let the requester or anyone terminate a lease for missed heartbeats (downtime) and slash the provider for the SLA breach. | must |
| FR-RENT-07 | Allow the requester to extend an active lease by adding escrow. | should |
| FR-RENT-08 | Update provider reputation from lease outcomes (uptime percentage and disputes). | must |
| FR-RENT-09 | Emit events for listing, lease open, interval settled, heartbeat, extend, end, and slash. | must |
| FR-RENT-10 | Bind a content-addressed workload manifest to a pending lease and start the clock and provider bond only after provider acceptance. | must |

### 3.10 LLM inference and gateway

| ID | Requirement | Level |
|----|-------------|-------|
| FR-LLM-01 | Let a provider advertise served models (name, context length, price per token or request). | must |
| FR-LLM-02 | Run an OpenAI-compatible inference server in the provider agent for advertised models. | must |
| FR-LLM-03 | Route requester inference calls through the orchestrator gateway to a healthy provider and meter usage. | must |
| FR-LLM-04 | Let the requester submit monotonic cumulative usage against prepaid credit, debit escrow, and settle the delta to the selected provider. | must |
| FR-LLM-05 | Support a best-effort deterministic spot-check (temperature 0, fixed seed) that compares a sampled response and feeds reputation, not hard slashing. | should |
| FR-LLM-06 | Support raw GPU lease as an alternative to managed inference, where the requester deploys their own model or fine-tune container. | must |
| FR-LLM-07 | Require a short-lived requester signature over the credit, provider, model, message hash, request ID, and expiry before the gateway routes a request. | must |

---

## 4. External interface requirements

### 4.1 On chain interfaces

The contracts expose the functions and events implemented in `contracts/`. Off chain
services depend on the following events at minimum:
- Verifiable task: JobPosted, TaskClaimed, ResultSubmitted, TaskPaid, TaskSlashed,
  TaskReopened, JobCompleted, DisputeOpened, ChallengeVote, DisputeResolved.
- Rental: ListingCreated, ListingAvailabilityChanged, LeaseRequested, LeaseAccepted,
  LeaseRejected, LeaseCancelled, Heartbeat, IntervalSettled, LeaseExtended, LeaseEnded,
  LeaseTerminated.
- Inference: OfferCreated, OfferDeactivated, CreditOpened, UsageSettled, CreditClosed.

The deployment file at `contracts/deployments/<network>.json` publishes the network name,
chain id, deployer, and each contract address and ABI, so off chain services load
everything they need from one file.

### 4.2 Off chain API

The orchestrator exposes a read API, a job prepare helper, and an inference gateway:
- GET /health returns service status.
- GET /jobs and GET /jobs/:id return indexed job and task state.
- GET /listings and GET /leases and GET /leases/:id return rental state.
- GET /providers returns provider stake, reputation, capabilities, and uptime.
- GET /models returns served models across providers.
- GET /offers and GET /offers/:id return inference offers.
- GET /credits and GET /credits/:id return prepaid credits; the collection can be
  filtered by requester.
- GET /tasks, GET /disputes, and GET /events/history expose explorer data.
- POST /jobs/prepare splits an image and pins the manifest (no chain write).
- POST /v1/chat/completions is the OpenAI-compatible gateway. It validates a short-lived
  EIP-191 requester signature and active prepaid credit, pins routing to that credit's
  provider and model, rejects replayed request IDs, and returns provider usage metadata.
- A live channel (server sent events) streams market updates.

Value writes are never sent to the orchestrator. Requesters submit lease, job, credit, and
usage-settlement transactions through their wallet. The gateway routes an authorized request
but does not custody funds or settle usage. The current prototype trusts the requester to
submit the provider-reported cumulative token counters; it prevents overdraw and decreasing
counters but does not prevent requester under-reporting.

### 4.3 Storage

IPFS stores job inputs, task outputs, and job manifests. The chain stores their CIDs plus
listing, lease, offer, credit, provider, and accounting state. Postgres stores a complete
versioned projection snapshot and exact block and log
cursor for each chain and contract deployment. Startup restores the snapshot, replays only
later events in chain order, subscribes, and performs a bounded catch-up to close the replay
race. The projection remains rebuildable from chain events. Expiring inference request replay
keys are durable operational state and are not reconstructed from the chain. Historical log
queries use a configurable block range. The live Alchemy-backed Sepolia indexer uses 10-block
chunks to stay within RPC provider limits.

### 4.4 User interface

The dashboard is described by the design system in section 7.

---

## 5. Non functional requirements

| ID | Requirement |
|----|-------------|
| NFR-SEC-01 | Off chain components must not custody funds or be able to force result acceptance. |
| NFR-SEC-02 | Contracts must follow checks effects interactions and guard token movements against reentrancy. |
| NFR-SEC-03 | No secrets in the repository. Only example env files with test values are committed. |
| NFR-SEC-04 | Provider job execution must be sandboxed with CPU, memory, and network limits. |
| NFR-PERF-01 | Core on chain operations should stay within a modest gas budget suitable for a testnet demo. |
| NFR-PERF-02 | The dashboard should reflect a new on chain event within a few seconds. |
| NFR-REL-01 | The local stack must start reliably with a single command and correct boot ordering. |
| NFR-REL-02 | The orchestrator index must be reconstructable from chain history after data loss. |
| NFR-USE-01 | The dashboard must meet WCAG AA contrast and provide visible focus states. |
| NFR-PORT-01 | The system must run on Windows, macOS, and Linux through Docker. |
| NFR-MAINT-01 | Code must pass linting and type checks, and contract logic must be covered by tests. |
| NFR-COST-01 | The demo must be runnable at zero cost on a local devnet and low cost on a testnet. |

---

## 6. Trust model specification

The two market modes are secured differently, and this is the core of the design.
Verifiable tasks use result re-execution (6.1 to 6.4). Rentals cannot be checked by
re-execution, so they use availability and attestation (6.5 to 6.6).

### 6.1 Verifiable-task economic model

Let R be the reward per task and B be the bonded stake per task. A provider that cheats
skips real computation. If the task is spot checked with probability s and at least one
honest challenger participates, the cheat is detected and the provider loses B. If it is
not spot checked, the provider keeps R. The expected value of cheating per task is:

    EV(cheat) = (1 - s) * R - s * B

Cheating is deterred when EV is not positive, which gives the break even spot check rate:

    s* = R / (R + B)

A larger bond reduces the spot check rate required for deterrence, which lowers
verification overhead. The simulator validates this relationship.

### 6.2 Protocol flow

1. Optimistic submission. A provider submits a commitment and a challenge window opens.
2. Challenge. Any eligible provider other than the owner re executes the task and commits
   a result during the window. The first challenge opens a dispute and freezes payout.
3. Voting. Additional challengers add agreement or disagreement votes before the deadline.
4. Resolution. After the deadline, majority decides. On a cheating outcome the provider is
   slashed and the first correct challenger receives the bond and a reputation increase.
   On an honest outcome the provider is paid and the dishonest challenger loses reputation.

### 6.3 Planned hardening

- Commit and reveal so a challenger cannot simply copy the original commitment.
- Reputation weighted selection and vote power, with random spot check selection.
- A perceptual policy for rendering. Deterministic jobs use exact hash equality. Rendering
  jobs compare with SSIM above a configured threshold to tolerate floating point
  differences across GPUs, while pinning the container image, seed, and render settings.

### 6.4 Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Lazy provider returns garbage. | Spot check plus slashing makes the expected value negative. |
| False result that looks plausible. | Independent re execution detects the mismatch. |
| Two providers collude on the same wrong answer. | Reputation weighting, random challenger selection, and honest majority reduce success probability. Future work can raise the number of required challengers. |
| Challenger copies the original commitment. | Commit and reveal in the hardened design. |
| Provider abandons a claimed task. | Timeout reclaim slashes the bond and reopens the task. |

### 6.5 Rental trust model (availability based)

A rented result cannot be re-executed, so trust comes from proving the service was
delivered, not the result. A lease is divided into intervals. For each interval:

1. The provider sends a direct, signed transaction for the current interval. The contract
   accepts one heartbeat per interval and rejects later attempts to cover a missed interval.
2. Escrow settles only completed intervals in the contiguous heartbeated prefix.
3. If the next heartbeat is missed for an interval plus the grace period, anyone can
   terminate the lease. Unused escrow
   is refunded to the requester and the provider is slashed for the SLA breach.

A lease request escrows the requested duration and binds an IPFS manifest while the lease is
pending. The provider may accept or reject it, and the requester may cancel it. The lease
clock, listing reservation, and provider bond begin only on acceptance. The current agent
accepts only an exact provider-configured manifest and launches only provider-configured
image, command, environment, and device settings. It does not execute arbitrary manifest
content supplied by the requester.

The current capability gate is a fresh record written by a trusted attester. The record
contains GPU model, VRAM, and benchmark score and is required to publish a listing or
inference offer. A real benchmark challenge and its failure-slashing path remain planned.
Reputation is an EMA over lease and task outcomes.

Economic intuition: let V be the value a provider captures per interval by claiming uptime
it did not deliver, D the deposit or stake at risk, and h the probability a missed interval
is detected (heartbeat gap plus challenge). Cheating is deterred when h * D exceeds V, so a
sufficient stake and frequent heartbeats make advertised but undelivered service
unprofitable. The simulator extends to this case.

For managed LLM inference, a planned deterministic spot-check (temperature 0 and a fixed
seed) would let a challenger re-run a sampled prompt and compare outputs within a tolerance.
Because cross-hardware determinism is not guaranteed, this would feed reputation rather
than hard slashing.

### 6.6 Rental threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Provider advertises a GPU it does not have. | A trusted attester currently gates listings and offers. A real benchmark and failure-slashing path remain planned. |
| Provider takes a lease then goes offline. | Missed heartbeats terminate the lease, refund the requester, and slash the provider. |
| Provider serves a smaller or throttled model than advertised. | Requesters can close credit or end a lease. Sampled inference reputation checks remain planned. |
| Requester claims downtime that did not happen. | Signed heartbeats are on chain evidence; settlement follows the heartbeat record. |
| Gateway tries to skim or misroute. | The gateway custodies no funds and must match the signed request to the credited provider and model. Settlement is a requester transaction. |
| Requester under-reports inference usage. | Not prevented in the current requester-metered prototype. Provider-signed receipts or a dispute mechanism are future work. |

---

## 7. Frontend design system

The dashboard must look clean, modern, sharp, and professional. It must not look
generic or machine generated. The following rules are binding.

### 7.1 Principles

- Clarity first. The interface presents dense on chain data calmly and legibly.
- Restraint. One accent color, used sparingly. Neutral surfaces carry most of the layout.
- Sharpness without harshness. Small radii and hairline borders, not heavy brutalist blocks.
- Honesty. No hype copy, no emoji in the interface, and no em dashes in text.

### 7.2 Color

Amber is the single accent. It appears on primary actions, active navigation, focus rings,
and a small number of key metrics. It does not fill large areas.

Light theme:
- Background 0xFFFFFF, surface 0xFAFAFA, subtle 0xF4F4F5.
- Border 0xE4E4E7.
- Text primary 0x18181B, secondary 0x52525B, muted 0xA1A1AA.
- Accent 0xD97706 for text and actions on light, hover 0xB45309.

Dark theme:
- Background 0x0B0C0E, surface 0x131518, subtle 0x1A1D21.
- Border 0x26282D.
- Text primary 0xF4F4F5, secondary 0xA1A1AA, muted 0x71717A.
- Accent 0xF59E0B on dark, hover 0xFBBF24.

Functional status colors are muted, not neon:
- Success 0x15803D, warning 0xB45309, danger and slashing 0xB91C1C, neutral uses zinc.

Prohibited: neon colors, violet or purple gradients, glassmorphism, large glows, and
multi color gradients used as decoration.

### 7.3 Typography

- Interface font: Inter or Geist Sans.
- Monospace: JetBrains Mono or Geist Mono for hashes, addresses, and token amounts.
- Type scale in pixels: 12, 14, 16, 20, 24, 30, 36 with matched line heights.
- Weights: 400 for body, 500 for labels, 600 for headings. Avoid heavier weights.

### 7.4 Layout and spacing

- A 4 pixel spacing grid. Generous spacing that still respects data density.
- Left sidebar navigation with a top bar for wallet and network status.
- Content constrained to a comfortable maximum width with responsive breakpoints.

### 7.5 Shape, border, and elevation

- Radius 6 pixels for controls, 8 pixels for cards. No pill shapes except small status chips.
- Hairline 1 pixel borders as the primary separation device.
- Minimal shadows. A single small elevation token for overlays only.

### 7.6 Motion

- 150 milliseconds ease out for hover and press. 200 milliseconds for panels and modals.
- Purposeful transitions only. Respect the reduce motion preference.

### 7.7 Component inventory

Button, Input, Select, Card, Table, StatusPill, AddressChip with copy, MetricStat,
Progress for tile assembly, Modal, Toast, Tabs, Badge, Tooltip, EmptyState, and Skeleton.

### 7.8 Copy tone

Professional and concise. State what the control does. Avoid exclamation marks, avoid
superlatives, and avoid em dashes.

---

## 8. Data model

| Entity | Key fields |
|--------|-----------|
| Job | id, requester, inputCID, taskCount, completedTasks, rewardPerTask, verificationPolicy. |
| Task | jobId, index, provider, resultHash, outputCID, status, bond, claimedAt, submittedAt. |
| Provider | address, registered, active, stake, bonded, reputation, completed, failed, capabilities. |
| Dispute | jobId, index, opened, resolved, providerHash, deadline, agree, disagree, firstDisagree. |
| Listing | id, provider, interval price and duration, bounds, availability, active lease, resource spec. |
| Lease | id, listing, requester, provider, manifest, escrow, bond, interval counters, start, status. |
| Inference offer | id, provider, model identifier, price per token, active. |
| Inference credit | id, offer, requester, provider, snapshotted price, escrow, paid, cumulative token counters, active. |

---

## 9. Testing strategy

The current automated suites cover contracts, off-chain services, simulation, and a
read-only browser pass against the full local stack.

| Layer | Tooling | Scope |
|-------|---------|-------|
| Contracts | Hardhat, Chai | 35 tests for token, registry, jobs, disputes, pending rental acceptance, strict heartbeats, escrow conservation, and prepaid inference credits. |
| Agent | pytest, local chain, fakes | 44 tests for task and rental lifecycles, sandbox controls, Docker-native task I/O, restart recovery, offer reconciliation, hardware parsing, retries, and challenger behavior. |
| Orchestrator | Vitest, Postgres | 48 tests in CI, including bounded log-range replay, durable projection, ordered replay, inference replay protection, gateway controls, APIs, split, and stitch. Without `TEST_DATABASE_URL`, 47 pass and the Postgres integration test is skipped. |
| Web | Playwright | 16 read-only route, navigation, explorer, responsive, overflow, and browser-error checks across desktop and 390-pixel mobile viewports. |
| Economic | unittest | 15 tests for closed-form thresholds, heterogeneous task behavior, rental uptime, false heartbeats, escrow conservation, and deterministic seeds. |

GitHub Actions runs five component jobs and a dependent full-stack job on pushes and pull
requests. It compiles and tests contracts and records gas, runs the agent and simulator
suites, runs all orchestrator tests against Postgres plus type checking, and runs web lint,
type checking, and production build. The full-stack job starts a fresh Compose deployment,
runs the signed prepaid-inference smoke flow, and runs the 16 Playwright checks. Browser
wallet write flows and property-based contract fuzzing remain testing gaps.

---

## 10. Deployment plan

### 10.1 Local, primary

Docker Compose brings up the chain, deploys contracts, and starts IPFS, Postgres, the
orchestrator, one provider, seed service, and web dashboard. Boot order is enforced by
healthchecks and dependency conditions. This is the primary demo target because it is
deterministic and free.

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps --all
```

### 10.2 Windows provider-only node

The provider-only Compose file runs the agent against an operator deployment. Hardware
discovery runs on the host before configuration.

```powershell
python .\agent\discover_hardware.py
Copy-Item .\agent\.env.example .\agent\.env
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml config --quiet
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml up --build -d
docker compose -f .\docker-compose.provider.yml logs -f provider
```

### 10.3 Sepolia operator

Contracts deploy to Sepolia using an environment provided key and RPC endpoint. The
operator Compose file runs Postgres, IPFS, the orchestrator, and the web app. The deployment,
bootstrap, provider-only Compose, public-safe browser configuration, and hostname allowlist
are implemented and have been exercised against the live deployment.

```powershell
Copy-Item .\contracts\.env.example .\contracts\.env
cd .\contracts
npm ci
npm run compile
npm run deploy:sepolia
cd ..
Copy-Item .\.env.example .\.env
docker compose -f .\docker-compose.sepolia.yml config --quiet
docker compose -f .\docker-compose.sepolia.yml up --build -d
```

Providers self-register before the operator runs the idempotent bootstrap. The operator
sets `BOOTSTRAP_PROVIDERS_JSON` and optional `BOOTSTRAP_REQUESTER_JSON` in the untracked
`contracts/.env`, then runs:

```powershell
cd .\contracts
npm run bootstrap:sepolia
```

The script validates registered providers, funds wallets to target balances, and skips
matching fresh attestations.

#### 10.3.1 Live deployment record

The live deployment uses Sepolia chain ID `11155111`.

| Contract | Address |
|----------|---------|
| `SmeshToken` | `0x917d2f8699b96F64BA701d380CC396992e9Ff215` |
| `ProviderRegistry` | `0x4626B2218a7663c6c8C9D9ff7552455FAa29068C` |
| `JobMarket` | `0x22c301cb18345687d94bD9A6Bb30344667f5d77e` |
| `Verification` | `0xfd32f4814929aaE10f29E29C14A92B4767C4c660` |
| `RentalMarket` | `0x345F848bdAd8FE8E84DB3B13248Bb217a5BFb244` |
| `InferenceMarket` | `0xebdB79a6566e64747a245a7B98E02E0eA28808a0` |

Provider `0xfd4e4A034601991A3070bD2B9B0F6a473a5bfc76` is registered,
staked, and attested for an RTX 4070 Laptop GPU with 8 GB VRAM. It created rental
listing `#2` with 60-second intervals and inference offer `#1` for `qwen3:0.6b`.
Requester `0x7e6a268D9aa458f0deCE6280A7Eb9B86888565d8` received 1,000 test
SMESH.

During validation on 17 September 2026, prepaid inference served 36 tokens and settled `72000000000000` SMESH base
units to the provider. Rental lease `#1` launched a GPU-enabled container, recorded
two heartbeats, settled one interval, and ended normally. All Sepolia operator and
provider containers reported healthy. The Alchemy-backed indexer used 10-block log
query chunks.

The deterministic-task path also completed two Sepolia jobs. The provider executed
the tasks in isolated sibling containers, submitted matching output commitments,
received settlement after the challenge windows, and the orchestrator stitched both
jobs to `ipfs://QmbnP5U3DCUap7RPWGueix32GmBCA62xnP9YYhJRUtPqAz`.

All six deployed contracts are source-verified on Sepolia Etherscan. Deployment,
source verification, and live transaction validation are complete.

---

## 11. Phase roadmap

Status legend: done, in progress, planned.

### Phase 0: Proposal and design. Status: done
- Goal: agree the problem, design, and plan.
- Deliverables: Review 1 proposal, this SRS, architecture diagrams.
- Exit criteria: SRS approved.

### Phase 1: Core contracts. Status: done for the first version
- Goal: token, registry, and market with escrow and the task state machine.
- Deliverables: SmeshToken, ProviderRegistry, JobMarket, unit tests.
- Exit criteria: contracts compile and the initial test suite passes. Met.

### Phase 2: Verification game. Status: first version done, hardening planned
- Goal: dispute, spot check, slashing, and reward.
- Deliverables: Verification contract and tests for happy, cheating, and eligibility paths.
- Planned hardening: commit and reveal, reputation weighting, perceptual policy.
- Exit criteria: cheating is detected and slashed in tests. Met for the first version.

### Phase 3: Provider agent end to end. Status: done
- Goal: a real agent that executes a deterministic job and settles on chain.
- Tasks: auto register and stake, claim, storage fetch and put, execution with limits,
  result commitment, challenger mode, and bounded retries with backoff.
- Deliverables: a modular agent (`chain`, `storage`, `executor`, `provider`), the
  deterministic Mandelbrot job with a container image, and integration tests that run the
  agent against a local chain.
- Acceptance: met. An end to end run posts a job, the agent completes a task, and
  settlement pays the provider. A dishonest agent is slashed by an honest challenger.
  Both the local and Docker executors are verified.
- Current hardening: constrained task containers, bounded RPC and IPFS retry with
  exponential backoff, contract-revert classification, and stable challenger sampling
  that excludes self-owned, ineligible, and previously voted tasks.

### Phase 4: Orchestrator. Status: done
- Goal: split, index, stitch, and serve.
- Tasks: job splitting by tiles with matching subregions, manifest pinning, event indexing
  into a projection, output stitching, a read API, and a live update channel.
- Deliverables: orchestrator service (`splitter`, `stitcher`, `store`, `indexer`,
  `jobservice`, `api`) with unit and component tests and a clean type check.
- Acceptance: met. A multi task job is split, tracked through the projection, and stitched
  into a final artifact, and the API returns correct job and task state. The complete
  projection and exact event cursor persist in Postgres and restore with ordered replay.

The pivot to compute rental inserts the rental and LLM phases next. The verifiable-task
path (phases 1 to 4) is complete and is retained as the second market mode.

### Phase 5: Rental market contracts. Status: done
- Goal: on chain leasing with streamed escrow, heartbeats, and SLA slashing.
- Deliverables: `RentalMarket` with listings; pending manifest-bound requests; provider
  accept and reject; requester cancellation; acceptance-time clock, reservation, and bond;
  extend, settle, end, finalize, and terminate; and attestation gating in `ProviderRegistry`.
- Acceptance: met. Settlement pays only completed intervals in the contiguous heartbeat
  prefix. A heartbeat is accepted only once for the current interval, so missed intervals
  cannot be covered later. Downtime pays the served prefix, refunds remaining escrow, and
  slashes the provider bond. Verified by 13 rental contract tests.
- Planned should-level work: relayed signed heartbeats to reduce provider gas and a real
  benchmark verifier with failure slashing behind the attester role.

### Phase 6: Provider rental serving and LLM inference. Status: done and live validated
- Goal: providers actually serve leases and models.
- Deliverables: `rental.py` (`RentalProvider` lists capacity, accepts or rejects requests,
  and heartbeats active leases; `RentalRenter` requests/settles/ends/terminates),
  `inference.py` (OpenAI-compatible endpoint
  with echo and Ollama backends and token metering), and `serve_provider.py` (provider node
  entrypoint), with integration tests against a local chain.
- Acceptance: met. The provider accepts only its exact configured content-addressed manifest,
  rejects other requests, launches only provider-configured workload settings, and heartbeats
  only a healthy accepted lease. The task worker and challenger run alongside rental serving;
  RPC, receipt, and IPFS operations use bounded exponential retry. A host-side discovery
  command reports OS, CPU, RAM, NVIDIA GPU and driver, Docker, and Ollama availability.
- Isolation: lease containers have no network or renter-controlled mounts, use a read-only root
  filesystem and non-root user, drop all capabilities, and enforce CPU, memory, swap, and PID
  limits. NVIDIA access is optional, disabled by default, and restricted to configured devices.
- Live validation: the Sepolia provider completed a prepaid request through offer `#1` for
  `qwen3:0.6b` and launched a GPU-enabled lease container on an RTX 4070 Laptop GPU.
- Follow ups: broaden runtime and GPU-host coverage. Arbitrary requester-defined image and
  command execution is intentionally not implemented.

### Phase 7: Orchestrator rental index and inference gateway. Status: done
- Goal: discovery and routing.
- Deliverables: `InferenceMarket` provider offers and prepaid credits; indexing for registry,
  rental, inference, job, and verification events; durable Postgres snapshots and cursors;
  API routes for offers and credits; and an OpenAI-compatible gateway with request limits,
  provider timeout, exact hostname allowlisting, redirect refusal, and durable replay keys.
- Acceptance: met. The gateway verifies an EIP-191 signature over credit, provider, model,
  canonical message hash, request ID, and expiry, then routes only to the credited provider.
  The requester submits cumulative usage on chain and can close the credit for a refund.
  Verified by 48 orchestrator tests with Postgres and a clean type check.
- Limitation: metering is requester submitted. Provider-reported usage is returned by the
  gateway, but under-reporting is not independently prevented.

### Phase 8: Web dashboard. Status: done for rental, inference, provider, and explorer surfaces
- Goal: rent GPUs, use models, and manage leases on the Design 1 dark system.
- Deliverables: a Next.js, TypeScript, viem, and Tailwind app with Overview, Rent GPUs,
  My leases, Models, Provider console, and Explorer. Wallet writes cover manifest-bound
  lease requests, cancellation, settlement and end; inference credit open, signed request,
  usage settlement and close; and provider faucet, registration, capabilities, stake,
  availability, listing, and offer actions.
- Acceptance: met. Built and verified live end to end: the app renders real listings, a live
  lease with streamed spend, and the model catalog from real on chain data via the orchestrator.
  The provider console shows collateral, attestation, inventory, earnings, uptime, and
  reputation. The explorer shows leases, jobs, tasks, disputes, chronological events, and
  slashes. The seeded dashboard is built and served by the one-command Compose stack.
- Follow ups: verifiable-job submission and live tile assembly, additional model-backend
  validation, and light mode.

### Phase 9: Full stack end to end and continuous integration. Status: done for the current prototype
- Goal: confidence that the whole system works together.
- Deliverables: GitHub Actions component jobs, Postgres-backed orchestrator integration,
  a fresh Compose job, signed prepaid-inference smoke test, and 16 read-only Playwright checks
  across desktop and mobile.
- Acceptance: implemented in `.github/workflows/ci.yml`. The public Sepolia inference and
  rental paths were also validated manually. Browser wallet-write automation remains open.

### Phase 10: Rendering workload and perceptual verification. Status: planned
- Goal: the visual verifiable-task showcase.
- Tasks: split a Blender scene into tiles or frames, execute headless Blender in the agent,
  apply the perceptual verification policy, and assemble the final image.
- Deliverables: a rendering job type, sample scenes, and the perceptual policy in Verification.
- Acceptance: a scene is rendered across the mesh and assembled correctly, with a cheating
  render detected by perceptual comparison.

### Phase 11: Testnet and hardening. Status: deployment and source verification complete
- Goal: a public showcase and a security pass.
- Completed: Sepolia deployment on chain `11155111`; provider and requester bootstrap;
  healthy operator and provider containers; RTX 4070 Laptop GPU registration, staking, and
  attestation; `qwen3:0.6b` prepaid inference; and a normally completed GPU-container lease
  with heartbeats and interval settlement. Two deterministic jobs also executed, settled,
  and stitched on Sepolia. Deployment descriptor flow, Compose files, gateway controls,
  worker sandboxing, retry hardening, gas reporting, and Etherscan source verification for
  all six contracts are also complete.
- Pending: additional provider laptops, browser wallet-write automation, independent
  benchmark verification, and should-level protocol hardening.

### Phase 12: Evaluation and delivery. Status: in progress
- Goal: measure and present.
- Completed: the simulator models heterogeneous honest, lazy, malicious, and colluding
  populations for task verification and models uptime, false heartbeats, detection, streamed
  payment, refunds, slashing, termination, and escrow conservation for rentals.
- Pending: final evaluation runs, recorded demo, report, and presentation delivery.

---

## 12. Requirements traceability

Status is based on behavior in the repository, not roadmap intent.

| Requirement | Status | Evidence or gap |
|-------------|--------|-----------------|
| FR-TKN-01..03 | done | `SmeshToken` implements ERC-20 payment, owner mint, and rate-limited faucet. |
| FR-REG-01..07, FR-REG-10 | done | `ProviderRegistry` and contract tests cover registration, mutable capabilities, stake, bond, eligibility, availability, EMA outcomes, and restricted protocol mutations. |
| FR-REG-08 | partial | Free-form capability JSON plus attested GPU model and VRAM exist; CPU and region are not separate typed registry fields. |
| FR-REG-09 | partial, should | A trusted attester records expiring GPU, VRAM, and benchmark values. A real challenge and failed-challenge slashing remain planned. |
| FR-JOB-01..09 | done | `JobMarket`, agent integration tests, and orchestrator projection implement the task lifecycle. |
| FR-VER-01..05 | done | `Verification` implements eligible non-self voting, disputes, quorum, majority resolution, and duplicate-vote prevention. |
| FR-VER-06..08 | planned, should | Commit-reveal, reputation-weighted random selection, and SSIM/perceptual verification are not implemented. |
| FR-ORC-01..06 | done | Deployment discovery, Postgres projection and replay, split, pin, stitch, HTTP API, server-sent events, and no-custody design are implemented. |
| FR-AGT-01..07, FR-AGT-09 | done | Worker, challenger, IPFS, sandbox, retries, and inference endpoint are implemented. |
| FR-AGT-08 | partial | The agent serves accepted leases and sends strict health-backed heartbeats, but executes provider-configured workloads rather than requester-defined containers. |
| FR-AGT-10 | planned, should | Hardware discovery exists, but the agent does not answer a protocol benchmark challenge. |
| FR-WEB-01..03, FR-WEB-05..08 | done | Wallet, rental, prepaid inference, provider console, explorer, copy-safe protocol values, and wallet-only writes are implemented. |
| FR-WEB-04 | planned, should | Explorer views jobs and tasks, but requester job posting and live tile assembly are not implemented. |
| FR-SIM-01..04 | done | The standard-library simulator covers both heterogeneous verification and rental economics with 15 tests. |
| FR-RENT-01..07, FR-RENT-09..10 | done | `RentalMarket` and its agent and web clients implement listings, pending manifest-bound requests, acceptance, strict heartbeats, settlement, refunds, extension, termination, slashing, and events. |
| FR-RENT-08 | partial | Lease success or failure updates the provider EMA, but no proportional uptime score or lease dispute mechanism exists. |
| FR-LLM-01 | partial | Offers include model and price per token; context length is not a structured offer field. |
| FR-LLM-02, FR-LLM-04, FR-LLM-07 | done | Provider endpoint, signed credited-provider routing authorization, requester cumulative settlement, and refunds are implemented. |
| FR-LLM-03 | partial | The gateway routes to the provider fixed by active credit and enforces timeout and endpoint controls, but does not probe health or fail over. |
| FR-LLM-05 | planned, should | Temperature-zero echo is deterministic, but no sampled inference reputation mechanism exists. |
| FR-LLM-06 | partial | Accepted leases can receive explicit NVIDIA devices, but workloads are provider-configured rather than arbitrary requester deployments. |
| NFR-SEC-01..04 | done for prototype | Contract custody boundaries, OpenZeppelin guards, secret templates, gateway controls, and constrained workers are implemented. Docker socket authority remains a host risk. |
| NFR-REL-01..02 | done | Compose health ordering and Postgres snapshot plus ordered chain replay are implemented. |
| NFR-MAINT-01 | done for current checks | CI runs compile, tests, lint, type checks, build, gas, Compose smoke, and browser checks. Property fuzzing is not present. |
| NFR-PERF-01..02, NFR-USE-01, NFR-PORT-01, NFR-COST-01 | partial | Gas reporting and responsive browser checks exist. Formal accessibility, event-latency, cross-platform, and public-testnet cost acceptance have not been completed. |

---

## 13. Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| GPU render nondeterminism breaks exact hashing. | Honest providers wrongly flagged. | High | Start with deterministic jobs. Use a perceptual policy with pinned settings for rendering. |
| Docker socket access on the agent widens attack surface. | Host compromise from malicious jobs. | Medium | Resource limits, no extra mounts, and untrusted input handling. Document the risk. |
| Collusion among providers. | Incorrect results accepted. | Medium | Current majority voting assumes honest participation. Reputation weighting, random selection, and higher challenger counts remain planned. |
| Scope creep across many components. | Missed deadlines. | Medium | Phase gates with clear acceptance criteria and a deterministic first workload. |
| Testnet variability, faucets and RPC. | Flaky public demo. | Medium | Keep the local devnet fallback. The live Alchemy indexer uses 10-block log-query chunks. |
| Native toolchain issues in containers. | Broken builds. | Low | Pin base images and versions. Prefer Debian slim for Node images. |
| LLM output cannot be verified on chain. | Overpromising verifiable AI. | High | Rentals use availability evidence rather than result checks. Inference spot-checks remain planned and would affect reputation only. |
| Provider spoofs advertised hardware. | Requester pays for less than promised. | Medium | A trusted attester currently gates market entry. Real benchmark verification and failure slashing remain planned. |
| Streamed escrow accounting errors. | Funds locked or mispaid. | Medium | Lifecycle and escrow-conservation tests cover current paths; property fuzzing remains planned. |
| GPU passthrough and inference runtime setup on varied hosts. | Demo friction. | Medium | Provide a CPU-served small model fallback for the inference demo; document GPU setup. |
| Requester under-reports inference token usage. | Provider is underpaid. | High | The current requester-metered design is explicit. Add provider-signed receipts or a bounded dispute mechanism before production use. |

---

## 14. Definition of done for the project

This project-level definition is not yet fully met because the partial must-level items and
planned delivery work in sections 11 and 12 remain open.

- All must level requirements are implemented and covered by tests.
- The full flow runs locally with one command and passes the e2e suite.
- The dashboard meets the design system and accessibility requirements.
- The evaluation reproduces the deterrence result and a gas report exists.
- Documentation is current and commits follow the conventions in the root guide.

---

## 15. Open decisions

| Item | Options | Default if not decided |
|------|---------|------------------------|
| Interface font | Inter or Geist Sans. | Inter. |
| Live channel | Server sent events or websocket. | Server sent events for simplicity. |
| Index tool | Custom indexer or a subgraph. | Custom indexer to reduce moving parts. |
| Testnet | Sepolia only, or add a low cost L2. | Sepolia only. |
