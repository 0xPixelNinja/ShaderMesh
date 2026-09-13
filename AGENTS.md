# AGENTS.md — ShaderMesh (root)

Authoritative guide for any agent or contributor working in this repo. Nested
`AGENTS.md` files add component-specific rules. **The closest `AGENTS.md` to the
file you are editing wins** on conflicts.

> Memory hierarchy:
> `AGENTS.md` (this file, global)
> → `contracts/AGENTS.md`, `agent/AGENTS.md`, `orchestrator/AGENTS.md`, `web/AGENTS.md` (local).
> Always read the local one before editing files in that folder.

---

## 1. What this project is

**ShaderMesh** — a decentralized, verifiable marketplace for GPU/CPU compute on
Ethereum. Requesters post containerized jobs (flagship: GPU rendering split into
tiles/frames); staked provider nodes execute them off-chain and commit results
on-chain; honesty is enforced by an **optimistic verification game** (staking +
reputation + randomized re-execution + slashing). The blockchain is the trust,
coordination, and payment layer — **never** the compute layer.

Full design: [`docs/ShaderMesh-Review1-Proposal.md`](docs/ShaderMesh-Review1-Proposal.md).

## 2. Repository map

| Path | What | Stack |
|------|------|-------|
| `contracts/` | Smart contracts, tests, deploy | Solidity 0.8.24, Hardhat, OpenZeppelin |
| `agent/` | Provider compute agent (untrusted worker) | Python 3.11, web3.py, Docker |
| `orchestrator/` | Job split / index / stitch (thin, untrusted) | Node 20 + TS (ESM), ethers |
| `web/` | Requester/provider dashboard + explorer | Next.js (planned) |
| `simulator/` | Verification-game economics model | Python (stdlib only) |
| `docs/` | Proposal, design, review materials | Markdown |
| `docker-compose.yml` | Local full stack | Docker Compose v2 |

## 3. Golden rules

1. **Never break the trust model.** Off-chain components (`agent`, `orchestrator`)
   are untrusted: they must not custody funds or be able to forge results. All
   value movement and result validation live in `contracts/`.
2. **Never commit secrets.** No private keys, RPC keys, or `.env` files. Only
   `*.env.example` templates with test/placeholder values are committed.
3. **Tests must pass before committing code.** For contracts run
   `npx hardhat compile && npx hardhat test`.
4. **Keep the docs in sync.** If you change contract interfaces, module scope, or
   the workflow, update the proposal doc and the relevant README.
5. **Prefer editing existing files** over adding new ones; don't create stray docs.

## 4. Commit conventions (Conventional Commits — REQUIRED)

Format:

```
<type>(<scope>): <subject>

[optional body: what & why, wrapped ~72 cols]

[optional footer: BREAKING CHANGE: ... / Refs: ...]
```

- **Subject:** imperative mood, lowercase, no trailing period, ≤ 72 chars
  ("add", not "added"/"adds").
- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`,
  `chore`, `style`.
- **Scopes:** `contracts`, `agent`, `orchestrator`, `web`, `simulator`, `docs`,
  `infra`, `deps` (omit scope only for repo-wide changes).
- **Breaking changes:** add `!` after type/scope **and** a `BREAKING CHANGE:`
  footer, e.g. `feat(contracts)!: change JobMarket task id encoding`.
- **One logical change per commit.** Don't mix a feature with unrelated refactors.

Examples:

```
feat(contracts): add optimistic challenge window to JobMarket
fix(agent): retry RPC connection on startup race
docs(contracts): document slashing invariants
build(infra): add ipfs and postgres services to compose
test(contracts): cover collusion path in verification game
chore(deps): bump hardhat to 2.22.13
```

## 5. Common commands

```powershell
# Contracts
cd contracts; npm install; npx hardhat compile; npx hardhat test

# Full local stack (chain + deploy + ipfs + postgres + orchestrator + agents)
docker compose up --build
docker compose up --build --scale agent=3   # multiple providers

# Simulator
cd simulator; python verification_game_sim.py
```

## 6. Security & secrets

- Secrets come from `.env` (gitignored). Commit only `*.env.example`.
- Test keys (e.g. hardhat's default accounts) are fine in `*.env.example`; real
  keys are never committed anywhere.
- The provider agent mounts the Docker socket — treat job inputs as untrusted and
  run them in constrained containers.

## 7. Definition of Done

- Code compiles; relevant tests pass (add tests for new contract logic).
- No secrets or generated artifacts staged (`node_modules/`, `artifacts/`,
  `cache/`, `deployments/`, `.env` are gitignored).
- Docs/README updated if behavior or interfaces changed.
- Commit(s) follow the convention in §4.
