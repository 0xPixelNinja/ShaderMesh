# ShaderMesh Web Dashboard

The requester and provider dashboard uses Next.js, TypeScript, viem, and Tailwind. It reads
indexed marketplace state from the orchestrator and sends every contract write
through the connected browser wallet.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

All client configuration must use public-safe `NEXT_PUBLIC_*` values. The
inference playground supports these optional settings:

- `NEXT_PUBLIC_INFERENCE_AUTH_TTL_SECONDS`: lifetime of each EIP-191 request
  authorization. Defaults to 120 seconds.
- `NEXT_PUBLIC_DEFAULT_INFERENCE_CREDIT_SMESH`: initial value in the new-credit
  amount field. Defaults to 10 SMESH.

## Prepaid inference

The Inference page (`/models`) lists active `InferenceMarket` offers and requester-owned
credits. Opening a credit requires an ERC-20 approval followed by `openCredit`.
Each chat request is signed with the orchestrator's canonical EIP-191 payload.
After a response, the dashboard submits cumulative prompt and completion usage
to `settleUsage` and blocks further requests until settlement confirms or the
indexed chain state proves that it completed. Closing a credit refunds its
remaining escrow through `InferenceMarket`.

## Provider and explorer surfaces

The Providers page exposes wallet-signed faucet, registration, capability,
staking, availability, rental-listing, and inference-offer actions. It also
shows indexed collateral, attestation, reputation, outcomes, inventory, and
earnings. The Explorer page provides read-only lease, job, task, dispute, event,
and slashing history from the orchestrator projection.

## End-to-end tests

The Playwright suite expects the full Docker Compose stack to be running. It
does not start or stop any service. `dashboard.spec.ts` uses only read-only
dashboard actions. `wallet.spec.ts` performs real wallet writes (see below).

```powershell
npm run test:e2e
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"; npm run test:e2e
```

The default base URL is `http://127.0.0.1:3000`. Install the Chromium browser
binary with `npx playwright install chromium` if it is not already available.
The read-only suite has 13 specs on desktop and a 390px mobile viewport (26 checks), plus 4 desktop wallet-write specs (30 checks in total).

### Wallet write tests

`tests/e2e/wallet.spec.ts` runs on the desktop project only. It injects an
EIP-1193 wallet (`tests/e2e/wallet.ts`) that forwards JSON-RPC to the local
Hardhat node, which signs for its unlocked accounts. The specs cover connecting
a wallet, renting a GPU through to heartbeats and a refund on end, prepaid
inference credit with a signed chat request and settlement, and registering and
staking a fresh provider.

Requirements: the Compose stack with the Hardhat node on `127.0.0.1:8545`, the
orchestrator on `127.0.0.1:4000`, a provider agent that accepts the default
manifest, and `INFERENCE_BACKEND=echo` for the chat flow when no Ollama server is
available. Override the endpoints with `E2E_RPC_URL` and `E2E_ORCHESTRATOR_URL`.
The tests use Hardhat accounts 5, 6 and 7 and a new random address for the
provider spec. If every listing is reserved by another lease, the fixture ends
or cancels that lease first. Do not run it against a public network.

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"; npm run test:e2e:wallet
```
