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

The Models page lists active `InferenceMarket` offers and requester-owned
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
does not start or stop any service and uses only read-only dashboard actions.

```powershell
npm run test:e2e
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"; npm run test:e2e
```

The default base URL is `http://127.0.0.1:3000`. Install the Chromium browser
binary with `npx playwright install chromium` if it is not already available.
The current suite has 16 passing checks across desktop and mobile viewports.
