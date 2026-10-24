# ShaderMesh: How It Works (Plain Guide)

This is a simple explanation of ShaderMesh. It covers what the project does, the
tech stack, and how the main parts work: IPFS storage, the SMESH token, escrow,
staking, bonding, slashing, reputation, attestation, and benchmark challenges. It
is written for someone new to the project.

If you want the deep, authoritative version, read
[`ShaderMesh-SRS.md`](ShaderMesh-SRS.md) and
[`ShaderMesh-Review1-Proposal.md`](ShaderMesh-Review1-Proposal.md). This file is
the friendly summary.

---

## 1. What is ShaderMesh in one paragraph

ShaderMesh is a marketplace for renting computers (mostly GPUs) over the
internet, coordinated by the Ethereum blockchain. People who own hardware
(providers) put down a deposit and rent out their machines. People who need
compute (requesters) pay to run their work on those machines. The blockchain is
not where the compute runs. The blockchain only handles trust, coordination, and
payment: who staked, who owes whom, and who gets punished for cheating. The
actual work runs off-chain, inside Docker containers on the provider's machine.

There are two ways to use the market, but they share one trust layer (staking,
reputation, slashing):

1. Rental (primary): you lease a machine or GPU for a period of time and run
   anything on it, including LLMs. You cannot re-check a rented result, so trust
   is based on availability, proven by regular signed "I am still up" messages
   (heartbeats).
2. Verifiable task (retained): you submit a job with a checkable output (for
   example, rendering an image). Trust is based on re-running the work and
   comparing results (a verification game).

---

## 2. Tech stack (what we use and why)

| Layer | What we use | Why |
|-------|-------------|-----|
| Smart contracts | Solidity 0.8.24, Hardhat, OpenZeppelin | The trust and money layer. Only place value moves. |
| Blockchain | Ethereum (local Hardhat node for dev, Sepolia testnet) | Shared source of truth for stake, escrow, and results. |
| Token | SMESH, an ERC-20 utility token | Used for payments, staking, and rewards. |
| Provider agent | Python 3.11, web3.py, Docker SDK | The worker that runs jobs and serves models. Untrusted. |
| Orchestrator | Node 20 + TypeScript (ESM), ethers v6 | Thin coordinator: splits jobs, indexes events, stitches results. Untrusted. |
| Off-chain database | Postgres 16 | A cache or "projection" of chain events for fast reads. Not the source of truth. |
| Storage | IPFS (Kubo) | Content-addressed storage for job inputs, outputs, and manifests. |
| Web app | Next.js (web) | Landing page, requester and provider UI, and an explorer. Light and dark themes. |
| Local stack | Docker Compose | Runs the whole system on one machine for demos and tests. |
| Inference | OpenAI-compatible endpoint, Ollama backend | Managed LLM inference served by providers. |

Key idea: the chain is small and trusted; everything heavy (files, containers,
indexing) lives off-chain and is treated as untrusted.

---

## 3. The players

- Requester: pays to run work. Posts jobs or leases machines.
- Provider: owns hardware. Stakes SMESH, lists capacity, runs the work.
- Provider agent (`agent/`): the software the provider runs. It fetches inputs,
  runs jobs in constrained Docker containers, uploads outputs, sends heartbeats,
  answers benchmark challenges, and serves inference. It is untrusted by design.
- Attester (`agent/attester.py`): a trusted service that records hardware
  attestations and issues and judges benchmark challenges (see section 8). It is
  a trusted role, not a money holder.
- Orchestrator (`orchestrator/`): a thin helper that splits big jobs into tasks,
  indexes chain events into Postgres, and stitches finished tiles into a final
  image. It holds no money and cannot force a result.
- Contracts (`contracts/`): the rules of the market. This is the only place money
  moves or results are accepted.

Trust rule: if an off-chain component could steal funds or force a fake result,
that is a bug. Safety comes from the contracts, not from trusting the agent or
orchestrator.

---

## 4. IPFS: where and why

### What IPFS is (simple version)

IPFS is a file store where the address of a file is derived from its contents.
That address is called a CID (content identifier). If the bytes change, the CID
changes. So a CID is a tamper-proof pointer: give someone a CID and they can
fetch the exact bytes you meant, and verify they were not altered.

### Why ShaderMesh uses it

Blockchains are expensive and small. You cannot put a scene file, a rendered
image, or a model manifest on-chain. So ShaderMesh puts the files on IPFS and
puts only the short CID on-chain. The chain stores the pointer plus accounting;
IPFS stores the actual bytes.

From the proposal: "Storage (IPFS): content-addressed storage for inputs,
outputs, and manifests. The chain stores CIDs plus compact market metadata and
accounting."

### What we store on IPFS

- Job inputs: the scene or data plus a manifest describing the work.
- Job outputs: the produced artifact (for example, a rendered PNG tile).
- Manifests: the description of a job or a lease workload.
- Lease manifest: what a rented machine is allowed to run.

### What we store on-chain (not on IPFS)

- The CID string (the pointer to the IPFS content).
- Money and accounting (escrow, stake, bond, payments).
- Result commitments (a `keccak256` hash of the output).

You can see this in the contracts. In `contracts/contracts/JobMarket.sol`:

- `string inputCID;` is described as "IPFS CID of scene/inputs + manifest".
- `string outputCID;` is described as "IPFS CID of the produced artifact".
- `bytes32 resultHash;` is the hash commitment to the output.

### Where IPFS lives in the code

- Agent side: `agent/storage.py` has `IpfsStorage`, which calls the IPFS HTTP API
  `POST /api/v0/add` to upload (`put`) and `POST /api/v0/cat` to download (`get`).
  It returns identifiers like `ipfs://<hash>`. It also retries on transient IPFS
  failures.
- Orchestrator side: `orchestrator/src/storage.ts` has a matching `IpfsStorage`
  class that uses the same API. Both sides use the same scheme so a manifest
  written by one can be read by the other.
- Config: the agent reads `IPFS_API_URL` and `STORAGE_BACKEND` in
  `agent/config.py`; the orchestrator reads them in `orchestrator/src/config.ts`.
  Default backend is `ipfs`.
- Infra: `docker-compose.yml` runs an `ipfs` service using the `ipfs/kubo` image,
  exposing the API on port `5001` and the gateway on `8080`. The orchestrator and
  agent point at `http://ipfs:5001`.

### The orchestrator split and stitch flow (uses IPFS)

For render jobs, the orchestrator in `orchestrator/src/jobservice.ts`:

1. `prepare`: splits the image into tiles, builds a manifest, and pins it to
   storage. The returned `inputCID` is what the requester posts on-chain.
2. `stitchJob`: after all tasks settle, it fetches each tile's `outputCID` from
   storage, stitches them into the final image, and pins the result, returning a
   `resultCID`.

Note: pinning content is not custody of money, so it is safe for the untrusted
orchestrator to do.

### A local test option

For fast tests, both sides also support a `local` backend (`LocalDirStorage`)
that stores files on disk keyed by their SHA-256. It uses `local://<hash>`
identifiers. This keeps tests dependency-free. The real stack uses IPFS.

---

## 5. The SMESH token

SMESH is the project's ERC-20 utility token (`contracts/contracts/SmeshToken.sol`).
It is used for three things:

- Payments: requesters pay providers in SMESH.
- Staking and collateral: providers lock SMESH as a deposit that can be slashed.
- Rewards: honest challengers and providers earn SMESH.

On testnets it has a `faucet()` that mints 1,000 SMESH per call with a cooldown,
so people can get test tokens. It is a utility token for the platform, not an
investment instrument.

---

## 6. Staking, bonding, and eligibility

All of this lives in `contracts/contracts/ProviderRegistry.sol`.

### Staking (the deposit)

A provider must `register()` and then `stake(amount)` SMESH. Staking is a
security deposit. It shows the provider has skin in the game. To claim work or
list capacity, the provider must hold at least `minStake` (checked by
`isEligible`). Providers can `unstake` only the free part of their stake (the
part not locked to active work).

### Bonding (locking stake to a specific job or lease)

When a provider takes on work, a portion of their stake is "bonded" (locked) to
that specific work. This is the amount at risk if they fail. See `bond` and
`unbond` in the registry, which are `onlyAuthorized` (only the market contracts
can call them).

- In `JobMarket.sol`, claiming a task bonds `bondPerTask` (default 10 SMESH).
- In `RentalMarket.sol`, accepting a lease bonds `bondPerLease` (default 50
  SMESH).

`availableStake = stake - bonded`. Only available stake can be withdrawn or
bonded to new work. When work finishes honestly, the bond is released (`unbond`).

### Reputation

Each provider has a reputation score from 0 to 10000 (0% to 100%), starting
neutral at 5000. After each job, `recordOutcome(provider, success)` nudges the
score up (toward 100%) on success or down (toward 0%) on failure, using a simple
moving average. It also counts `completed` and `failed` jobs.

### Attestation (proving the hardware is real)

A provider claims to have, say, an RTX 4070 with 8 GB VRAM. The `attester` (a
trusted role) records the GPU model, VRAM, and a benchmark score on-chain via
`attest(...)`. The record has a freshness window (`attestationTtl`, default 7
days). To create a rental listing or an inference offer, and for a lease request
or acceptance to go through, the provider must have a fresh attestation
(`isAttested`). Section 8 explains how the attester keeps testing providers after
that first record.

---

## 7. Escrow (holding the money safely)

Escrow means the requester's payment is locked in a contract up front, then
released to the provider only as the work is proven. The requester cannot vanish
without paying; the provider cannot get paid without doing the work. Each market
has its own escrow.

### Verifiable task escrow (`JobMarket.sol`)

- `postJob(...)`: the requester locks `rewardPerTask * taskCount` SMESH in escrow.
- A provider claims a task (bonding stake), runs it off-chain, then
  `submitResult(resultHash, outputCID)`.
- After a challenge window with no successful dispute, anyone can call
  `finalizeTask`, which pays the provider from escrow and releases the bond.

### Rental escrow, streamed per interval (`RentalMarket.sol`)

Rental escrow is special: it streams. The requester pays for a set number of time
intervals up front, and the provider earns them one interval at a time, but only
for intervals they proved they were online.

- `requestLease(listingId, intervals, manifest)`: requester locks
  `pricePerInterval * intervals` in escrow.
- `acceptLease`: provider accepts and bonds stake. The lease goes Active.
- `heartbeat`: each interval, the provider sends a heartbeat to prove uptime. A
  missed interval cannot be back-filled later.
- `settle`: pays the provider for the contiguous run of heartbeated intervals.
- `extendLease`: requester adds more intervals and more escrow.
- `endLease`: requester ends early. Proven intervals are paid; the rest is
  refunded.
- `finalizeExpired`: closes a lease once every funded interval has a heartbeat.

Only intervals that were both completed in time and heartbeated are payable. This
is the availability-based trust model: you get paid for being provably online.

### Inference escrow, metered by tokens (`InferenceMarket.sol`)

For managed LLM inference:

- `createOffer(model, pricePerToken)`: a provider advertises a model.
- `openCredit(offerId, escrow)`: a requester prepays into escrow.
- `settleUsage(...)`: usage is billed by cumulative prompt and completion tokens;
  the matching payment streams from escrow to the provider.
- `closeCredit`: the requester closes and gets any unused escrow refunded.

---

## 8. Benchmark challenges and the treasury

An attestation is only a record, so the attester also checks providers on a
schedule. These checks are called benchmark challenges. They live in
`ProviderRegistry.sol` (the "Benchmark challenges" section), with the provider
side in `agent/benchmark.py` and the attester in `agent/attester.py`.

How a challenge works:

1. The attester calls `issueChallenge(provider)` for an attested provider. The
   contract creates a random seed from chain randomness, so the answer cannot be
   prepared in advance. A provider has one open challenge at a time.
2. The provider runs a fixed workload: a chain of 500,000 SHA-256 hashes starting
   from the seed. It calls `respondChallenge` with the final hash and a score
   before the deadline. The score is tokens per second (times 100) from Ollama if
   a model is configured, otherwise the hash rate in kilohashes per second. The
   deadline is the challenge window: 15 minutes by default, 120 seconds in the
   local demo stack.
3. The attester recomputes the hash. The challenge passes if the hash matches and
   the score is at least half of the attested benchmark score (50% by default).
4. A pass refreshes the attestation and raises reputation.

What happens on failure:

- A wrong answer (judged by the attester), or a missed deadline, fails the
  challenge. For a missed deadline, anyone can call `expireChallenge`, so no
  trusted party is needed.
- The provider is slashed up to `challengeSlash` (by default one fifth of the
  minimum stake, which is 10 SMESH when the minimum is 50). The slash comes from
  free stake only. Stake that is bonded to an active lease or task is never
  touched, so active leases continue under their bonds.
- The slashed SMESH goes to the treasury, an address set by the owner (it
  defaults to the owner).
- The attestation is revoked. The provider cannot list new capacity or offers,
  and new lease requests are blocked until it is attested again.
- Reputation drops, and the provider cannot unstake while a challenge is open.

If a provider answers but the attester never judges the answer within another
window, the challenge lapses with no penalty.

Honest limits: the attester is still a trusted role for judging answers. A
benchmark shows the provider is responsive, controls its key, and delivers
roughly the throughput it was attested at. It does not prove the exact GPU model.

For demos, the provider has a switch: `BENCHMARK_FAULT=wrong_hash` (submit a bad
hash) or `BENCHMARK_FAULT=silent` (never respond) forces a failed challenge. See
the demo runbook.

---

## 9. Slashing (punishing bad behavior)

Slashing means taking some of a provider's staked SMESH and giving it to the
harmed party. It is the stick that makes the deposit meaningful. The core call is
`slash(who, amount, beneficiary)` in `ProviderRegistry.sol`, which is
`onlyAuthorized` (only the market contracts can trigger it). Slashing reduces the
bonded amount first, then the stake, and transfers the tokens to the beneficiary.

When slashing happens:

- Task abandoned (`JobMarket.reclaimTimedOut`): a provider claimed a task but
  never submitted a result before the timeout. Anyone can reopen the task; the
  abandoning provider's bond is slashed to the requester, and reputation drops.
- Cheating upheld (`JobMarket.resolveCheating`): the verification game found the
  result was wrong. The provider's bond is slashed to the challenger, the task is
  reopened, and reputation drops. Only the `Verification` contract can trigger
  this.
- Rental downtime (`RentalMarket.terminate`): the provider missed a heartbeat
  past the grace period, so the machine is considered down. The lease is
  terminated, the provider's bond is slashed to the requester, unpaid escrow is
  refunded to the requester, and reputation drops.
- Failed or missed benchmark challenge (`ProviderRegistry`): free stake is
  slashed to the treasury, the attestation is revoked, and reputation drops (see
  section 8).

Honest work has the opposite outcome: the bond is returned and reputation rises.

---

## 10. The verification game (how a task is checked)

This lives in `contracts/contracts/Verification.sol` and is the trust mechanism
for the verifiable-task mode.

1. A provider submits a result hash. Payment does not happen immediately; there
   is a challenge window.
2. During that window, any other eligible provider can act as a challenger:
   re-run the same task and `challenge(jobId, index, theirHash)`.
3. The first challenge opens a dispute and freezes payout. Challengers vote
   agree or disagree by comparing hashes.
4. After the vote window, `resolve` tallies votes by simple majority. If the
   "disagree" side wins and meets quorum, cheating is upheld: the original
   provider is slashed and the honest challenger is paid and gains reputation.
   Otherwise the provider is vindicated and paid.

This is called optimistic verification: assume honesty, pay after a delay, and
only run the expensive check if someone disputes. Planned upgrades include
commit-reveal voting (to stop copying answers), reputation-weighted votes,
randomized challenger selection, and perceptual tolerance for GPU renders.

---

## 11. Putting it together: two end-to-end walkthroughs

### A. Rent a GPU (rental mode)

1. Provider registers, stakes SMESH, passes hardware attestation, and creates a
   listing with a price per interval. The attester keeps challenging the provider
   in the background.
2. Requester picks the listing, chooses a duration and a lease manifest (an IPFS
   pointer to what should run), and calls `requestLease`. Escrow is locked.
3. Provider calls `acceptLease`, bonds stake, and the agent starts the workload
   in a constrained Docker container.
4. Each interval, the agent sends a `heartbeat`. `settle` streams payment for
   proven intervals.
5. If the provider goes down, `terminate` slashes the bond to the requester and
   refunds unused escrow. If all goes well, `endLease` or `finalizeExpired` pays
   the provider and returns the bond.

### B. Render an image (verifiable-task mode)

1. Orchestrator `prepare` splits the image into tiles, pins the manifest to
   IPFS, and returns an `inputCID`.
2. Requester `postJob(inputCID, taskCount, rewardPerTask, ...)`. Escrow is
   locked.
3. Providers `claimTask` (bonding stake), fetch inputs from IPFS, render in a
   sandboxed container, upload the tile to IPFS, and `submitResult(hash, outputCID)`.
4. Challenge window opens. If nobody disputes, `finalizeTask` pays each provider.
   If someone disputes, the verification game decides who is paid and who is
   slashed.
5. Orchestrator `stitchJob` fetches all tiles from IPFS, stitches the final
   image, and pins the `resultCID`.

---

## 12. The web app

The web app (`web/`) has a light theme by default and a dark theme with a toggle.
Its pages:

- `/` (landing page): explains the product with diagrams of the lease lifecycle,
  token flow, escrow by interval, heartbeats, and the challenge track.
- `/dashboard`: network overview with available capacity, attested providers, and
  streaming spend.
- `/rent`: browse GPU listings and request a lease.
- `/leases` (My leases): your leases, heartbeat progress, streamed spend, and
  lease evidence.
- `/models`: model catalog and a prompt playground using prepaid credits.
- `/providers` (Provider console): registration, stake, listings, offers,
  earnings, reputation, and challenge history.
- `/explorer`: a network token-flow figure, a lease inspector, a Challenges tab,
  and a colour-coded timeline of on-chain events and slashes with plain-English
  descriptions.

All writes are signed in the user's wallet. The web app never holds keys.

---

## 13. The trust model in one picture

```
Requester money  --->  [ Contracts: escrow + stake ]  <---  Provider deposit
                              |            |
                   pays on proof      slashes on failure
                              |            |
        off-chain (untrusted): agent runs work, orchestrator coordinates
                              |            |
                 IPFS stores the bytes; chain stores only the CID + accounting
```

- The chain is the referee. It holds the money and the deposit and enforces the
  rules.
- IPFS is the filing cabinet. It holds the big files; the chain holds their
  addresses (CIDs).
- The agent and orchestrator are untrusted helpers. If they misbehave, the worst
  case is degraded service, not stolen funds or forged results.

---

## 14. Quick reference: which file does what

| Concern | File |
|---------|------|
| Token (payments, stake, faucet) | `contracts/contracts/SmeshToken.sol` |
| Stake, bond, slash, reputation, attestation, benchmark challenges, treasury | `contracts/contracts/ProviderRegistry.sol` |
| Verifiable-task escrow and state machine | `contracts/contracts/JobMarket.sol` |
| Verification game (disputes) | `contracts/contracts/Verification.sol` |
| Rental leases, heartbeats, streamed escrow | `contracts/contracts/RentalMarket.sol` |
| Metered inference credits | `contracts/contracts/InferenceMarket.sol` |
| IPFS + local storage (agent) | `agent/storage.py` |
| IPFS + local storage (orchestrator) | `orchestrator/src/storage.ts` |
| Split, pin, stitch | `orchestrator/src/jobservice.ts` |
| Sandboxed job execution | `agent/executor.py` |
| Benchmark workload and scoring (provider) | `agent/benchmark.py` |
| Issue, judge, and expire challenges (attester) | `agent/attester.py` |
| Design system for the web app | `web/DESIGN.md` |
| Local full stack (chain, ipfs, postgres, provider, attester, web) | `docker-compose.yml` |
