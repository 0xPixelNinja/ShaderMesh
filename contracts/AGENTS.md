# AGENTS.md — contracts

Solidity smart contracts (the **trust layer**). Read the root `AGENTS.md` first.

## Scope & responsibility

This is the **only** place value moves or results are validated. If a change lets
an off-chain component custody funds or force an outcome without on-chain checks,
it is wrong.

Contracts:
- `SmeshToken` — ERC-20 utility token (payments, staking, rewards, testnet faucet).
- `ProviderRegistry` — stake/bond/slash + reputation; economic mutations are
  `onlyAuthorized` (JobMarket, Verification).
- `JobMarket` — escrow, task state machine, optimistic settlement; dispute
  outcomes are `onlyVerification`.
- `Verification` — spot-check challenge game; resolves disputes.

## Rules

1. **Always** `npx hardhat compile && npx hardhat test` before committing. All
   tests must pass. Add tests for every new state transition or economic path.
2. Use **OpenZeppelin** primitives (ERC20, Ownable, ReentrancyGuard, SafeERC20).
   Don't hand-roll token/access logic.
3. Follow **checks-effects-interactions**; keep `nonReentrant` on functions that
   move tokens; update state before external calls.
4. Preserve access-control invariants: registry mutations `onlyAuthorized`;
   market dispute outcomes `onlyVerification`. Never widen these casually.
5. Solidity `^0.8.24`, optimizer on (runs=200). Prefer explicit `uint256`,
   named events, and revert strings prefixed by contract (`"market: ..."`).
6. Never commit `artifacts/`, `cache/`, `typechain-types/`, `deployments/`, or
   `.env` (all gitignored). Testnet secrets live in `.env` from `.env.example`.

## Commits

Scope is `contracts` (or `deps` for dependency bumps). Examples:
`feat(contracts): add reputation-weighted challenger selection`,
`test(contracts): cover claim-timeout reclaim path`.
