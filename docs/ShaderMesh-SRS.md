# ShaderMesh: Software Requirements Specification and Phase Plan

Version: 1.0
Status: Draft for approval
Related documents: `docs/ShaderMesh-Review1-Proposal.md`, root `AGENTS.md`

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

ShaderMesh is a decentralized marketplace for verifiable off chain compute, coordinated
by Ethereum smart contracts. Requesters post containerized jobs and lock payment in
escrow. Staked providers claim tasks, execute them off chain in Docker, and commit
results on chain. Honesty is enforced by an optimistic verification game that combines
staking, on chain reputation, randomized re execution, and slashing. The flagship
workload is distributed rendering, starting with a deterministic job and then Blender
tile and frame rendering.

In scope:
- On chain marketplace, escrow, staking, reputation, and dispute resolution.
- A provider agent that executes real jobs in Docker and reports results on chain.
- A thin orchestrator that splits jobs, indexes events, and stitches outputs.
- A web dashboard for requesters, providers, and an on chain explorer.
- An economic simulator for evaluation.
- Local deployment via Docker Compose and a public testnet deployment on Sepolia.

Out of scope for this project:
- A custom base layer blockchain or consensus algorithm. We inherit Ethereum.
- Production grade custody, KYC, or fiat payment rails.
- A token sale or any real financial instrument. SMESH is a utility and test token.

### 1.3 Definitions and acronyms

| Term | Meaning |
|------|---------|
| Requester | User who posts a job and pays for compute. |
| Provider | Staked node that executes tasks and earns payment. |
| Challenger | Provider that re executes a submitted task to verify it. |
| Task | An independent unit of a job, for example one frame or one image tile. |
| Escrow | Funds locked in the JobMarket contract until settlement. |
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
Trusted (on chain):     SmeshToken, ProviderRegistry, JobMarket, Verification
Untrusted (off chain):  Orchestrator, Provider agents, Web dashboard, IPFS, Postgres
```

### 2.2 Actors and user classes

| Actor | Description | Primary goals |
|-------|-------------|---------------|
| Requester | Individual or studio needing compute. | Post jobs, fund escrow, receive verified outputs at a fair price. |
| Provider | Owner of idle GPU or CPU capacity. | Stake, claim work, execute honestly, earn payment, build reputation. |
| Challenger | A provider acting in verification mode. | Detect incorrect results, earn slashed bonds and reputation. |
| Operator | Person running the local or testnet deployment. | Bring up the stack, deploy contracts, monitor health. |
| Reviewer | Course evaluator or portfolio viewer. | Understand the design and see a working demo. |

### 2.3 Operating environment

- Contracts run on any EVM chain. Local uses a Hardhat node. Public uses Sepolia.
- Off chain services run as Docker containers orchestrated by Docker Compose.
- The provider agent requires access to a Docker daemon to launch job containers.
- The web dashboard runs in modern browsers and connects a wallet such as MetaMask.

### 2.4 Constraints

- Solidity version 0.8.24 with the optimizer enabled.
- On chain storage holds only hashes, identifiers, and accounting. Payloads live on IPFS.
- Gas cost of core operations must remain modest so the demo is affordable on a testnet.
- The design must run on commodity hardware with two or three provider nodes.

### 2.5 Assumptions and dependencies

- Providers hold SMESH for stake, obtained from the token faucet on test networks.
- IPFS is reachable by the agent and orchestrator.
- At least one honest challenger participates during the vote window for a disputed task.
- Deterministic jobs produce identical bytes across machines. Rendering jobs may not,
  which is handled by a perceptual verification policy described in section 6.

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
| FR-ORC-02 | Index JobPosted and task lifecycle events into Postgres for fast queries. | must |
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

### 3.7 Web dashboard

| ID | Requirement | Level |
|----|-------------|-------|
| FR-WEB-01 | Connect a wallet and display the connected account and SMESH balance. | must |
| FR-WEB-02 | Let a requester post a job, fund escrow, and track task progress in real time. | must |
| FR-WEB-03 | Show a live view of tiles or frames assembling as tasks are verified. | should |
| FR-WEB-04 | Let a provider register, stake, view earnings and reputation, and toggle availability. | must |
| FR-WEB-05 | Provide an explorer of jobs, tasks, disputes, and slashing events. | must |
| FR-WEB-06 | Display hashes, addresses, and amounts in monospace with copy actions and safe truncation. | should |
| FR-WEB-07 | Perform all writes through the user wallet and never store secrets. | must |

### 3.8 Simulator

| ID | Requirement | Level |
|----|-------------|-------|
| FR-SIM-01 | Model the verification game economics and validate the break even spot check rate. | must |
| FR-SIM-02 | Report the security and cost tradeoff across spot check rates and bond sizes. | must |
| FR-SIM-03 | Support heterogeneous provider populations including honest, lazy, and colluding behavior. | should |

---

## 4. External interface requirements

### 4.1 On chain interfaces

The contracts expose the functions and events already implemented in `contracts/`.
Off chain services depend on the following events at minimum:
- JobPosted, TaskClaimed, ResultSubmitted, TaskPaid, TaskSlashed, TaskReopened, JobCompleted.
- DisputeOpened, ChallengeVote, DisputeResolved.

The deployment file at `contracts/deployments/<network>.json` publishes the network name,
chain id, deployer, and the four contract addresses.

### 4.2 Off chain API

The orchestrator exposes a read only HTTP API. Planned resources:
- GET /health returns service status.
- GET /jobs and GET /jobs/:id return indexed job and task state.
- GET /providers returns provider stake and reputation.
- A live channel, either server sent events or websocket, streams task updates.

Writes are never sent to the orchestrator. Clients submit transactions through the wallet.

### 4.3 Storage

IPFS stores job inputs, task outputs, and job manifests. The chain stores only CIDs and
hashes. Postgres stores a derived index of on chain state for query performance and is
always rebuildable from chain events.

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

## 6. Verification game specification

This is the core intellectual contribution and deserves precise definition.

### 6.1 Economic model

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

---

## 9. Testing strategy

Testing follows the pyramid, with automated coverage at every layer.

| Layer | Tooling | Scope |
|-------|---------|-------|
| Contract unit | Hardhat, Chai | Every function and state transition, including revert paths. |
| Contract property | Hardhat, fuzzing | Invariants such as conservation of escrow and stake accounting. |
| Contract e2e | Hardhat | Full job lifecycle: post, claim, submit, challenge, resolve, settle. |
| Agent integration | Python, local chain | The real agent registers, claims, runs a deterministic Docker job, and submits. |
| Full stack e2e | Playwright | Browser drives the dashboard against a local devnet through the whole flow. |
| Economic | Simulator | Validates deterrence and reports the security and cost tradeoff. |

Targets: high statement coverage on contracts, a green e2e run in continuous integration,
and a reproducible one command test entry point per package.

Continuous integration runs on each change: compile, lint and type check, contract tests,
agent integration on a local chain, and the Playwright suite in headless mode.

---

## 10. Deployment plan

### 10.1 Local, primary

Docker Compose brings up the chain, deploys contracts, and starts IPFS, Postgres, the
orchestrator, and provider agents. The web dashboard is added as a service in its phase.
Boot order is enforced by healthchecks and dependency conditions. This is the primary
demo target because it is deterministic and free.

### 10.2 Sepolia and hosted frontend, bonus

Contracts deploy to Sepolia using an environment provided key and RPC endpoint. The
frontend deploys to a hosting provider such as Vercel. The faucet seeds test SMESH.
This target is a shareable showcase and a stretch goal.

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
  result commitment, challenger mode. Retries and backoff refined in later phases.
- Deliverables: a modular agent (`chain`, `storage`, `executor`, `provider`), the
  deterministic Mandelbrot job with a container image, and integration tests that run the
  agent against a local chain.
- Acceptance: met. An end to end run posts a job, the agent completes a task, and
  settlement pays the provider. A dishonest agent is slashed by an honest challenger.
  Both the local and Docker executors are verified.
- Follow ups: IPFS backed storage in the live stack (backend already implemented), and
  richer retry and backoff, tracked with Phase 4.

### Phase 4: Orchestrator. Status: done
- Goal: split, index, stitch, and serve.
- Tasks: job splitting by tiles with matching subregions, manifest pinning, event indexing
  into a projection, output stitching, a read API, and a live update channel.
- Deliverables: orchestrator service (`splitter`, `stitcher`, `store`, `indexer`,
  `jobservice`, `api`) with unit and component tests and a clean type check.
- Acceptance: met. A multi task job is split, tracked through the projection, and stitched
  into a final artifact, and the API returns correct job and task state. Verified by 13 tests.
- Follow ups: Postgres persistence of the projection (currently in-memory and rebuildable
  from chain history), and a live cross service test in Phase 6.

### Phase 5: Web dashboard. Status: planned
- Goal: the requester, provider, and explorer experiences on the design system in section 7.
- Tasks: design tokens and base components, wallet connection, post job flow, provider
  staking and reputation view, explorer, and a live tile assembly view.
- Deliverables: a Next.js application, a web service in Compose, and a component library.
- Acceptance: a user completes the full flow in the browser against the local devnet.

### Phase 6: Full stack end to end and continuous integration. Status: planned
- Goal: confidence that the whole system works together.
- Tasks: contract lifecycle e2e, agent integration tests, Playwright suite, and a CI pipeline.
- Deliverables: test suites and a green pipeline.
- Acceptance: the pipeline runs all layers and passes on a clean checkout.

### Phase 7: Blender rendering workload. Status: planned
- Goal: the visual flagship.
- Tasks: split a Blender scene into tiles or frames, execute headless Blender in the agent,
  apply the perceptual verification policy, and assemble the final image.
- Deliverables: a rendering job type, sample scenes, and the perceptual policy in Verification.
- Acceptance: a scene is rendered across the mesh and assembled correctly, with a cheating
  render detected by perceptual comparison.

### Phase 8: Testnet and hardening. Status: planned
- Goal: a public showcase and a security pass.
- Tasks: deploy to Sepolia, host the frontend, review access control and reentrancy, and
  produce a gas report.
- Deliverables: a live testnet deployment, a hosted dashboard, and a security and gas report.
- Acceptance: the public demo completes a job and the report documents costs and checks.

### Phase 9: Evaluation and delivery. Status: planned
- Goal: measure and present.
- Tasks: run the evaluation, record the demo, finalize the report and slides.
- Deliverables: evaluation results, a recorded demo, the final report, and the presentation.
- Acceptance: results reproduce the deterrence claim and the demo shows the full flow.

---

## 12. Requirements traceability

| Requirement group | Realized in phase |
|-------------------|-------------------|
| FR-TKN, FR-REG, FR-JOB | Phase 1 |
| FR-VER core | Phase 2 |
| FR-VER hardening | Phase 7 |
| FR-AGT | Phase 3, extended in Phase 7 |
| FR-ORC | Phase 4 |
| FR-WEB | Phase 5 |
| FR-SIM | done, extended in Phase 9 |
| NFR security and testing | Phase 6 and Phase 8 |

---

## 13. Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| GPU render nondeterminism breaks exact hashing. | Honest providers wrongly flagged. | High | Start with deterministic jobs. Use a perceptual policy with pinned settings for rendering. |
| Docker socket access on the agent widens attack surface. | Host compromise from malicious jobs. | Medium | Resource limits, no extra mounts, and untrusted input handling. Document the risk. |
| Collusion among providers. | Incorrect results accepted. | Medium | Reputation weighting, random selection, honest majority, and a higher challenger count. |
| Scope creep across many components. | Missed deadlines. | Medium | Phase gates with clear acceptance criteria and a deterministic first workload. |
| Testnet variability, faucets and RPC. | Flaky public demo. | Medium | Local devnet is the primary target. Testnet is a bonus. |
| Native toolchain issues in containers. | Broken builds. | Low | Pin base images and versions. Prefer Debian slim for Node images. |

---

## 14. Definition of done for the project

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
