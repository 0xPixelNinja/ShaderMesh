import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { parse as parseEnv } from "dotenv";

const smokeEnv = process.env.SMOKE_ENV_FILE
  ? parseEnv(readFileSync(process.env.SMOKE_ENV_FILE))
  : {};
const rpcUrl = process.env.RPC_URL ?? smokeEnv.SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545";
const gatewayUrl = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";
const deploymentsFile = process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/localhost.json";
const accountIndex = Number(process.env.SMOKE_ACCOUNT_INDEX ?? 4);
const privateKey = process.env.SMOKE_PRIVATE_KEY ?? smokeEnv.PRIVATE_KEY;
const manifest = process.env.SMOKE_LEASE_MANIFEST
  ?? "ipfs://QmSVD528SpLDjcD5eEUpHuYx3BSmNJkC3MTs7hAMBMFiVd";

async function waitForJson<T>(path: string, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${gatewayUrl}${path}`);
    if (response.ok) {
      const value = await response.json() as T;
      if (accept(value)) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  if (Number(deployment.chainId) !== 31337 && !privateKey) {
    throw new Error("a private key is required outside the local Hardhat network");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const signer = privateKey
    ? new Wallet(privateKey, provider)
    : await provider.getSigner(accountIndex);
  const requester = await signer.getAddress();
  const token = new Contract(deployment.contracts.SmeshToken, deployment.abis.SmeshToken, signer);
  const rental = new Contract(deployment.contracts.RentalMarket, deployment.abis.RentalMarket, signer);

  const listings = await waitForJson<Array<{
    id: number;
    pricePerInterval: string;
    intervalSecs: number;
    minIntervals: number;
    available: boolean;
  }>>("/listings", (value) => value.some((listing) => listing.available));
  const listing = listings.find((candidate) => candidate.available)!;
  const intervals = Math.max(2, listing.minIntervals);
  const escrow = BigInt(listing.pricePerInterval) * BigInt(intervals);

  await (await token.approve(deployment.contracts.RentalMarket, escrow)).wait();
  const leaseId = Number(await rental.nextLeaseId());
  await (await rental.requestLease(listing.id, intervals, manifest)).wait();
  await waitForJson<any>(`/leases/${leaseId}`, (value) => value.status === "Active");

  await new Promise((resolve) => setTimeout(resolve, (listing.intervalSecs + 8) * 1_000));
  await (await rental.settle(leaseId)).wait();
  const settled = await waitForJson<any>(
    `/leases/${leaseId}`,
    (value) => Number(value.settledIntervals) >= 1,
  );
  await (await rental.endLease(leaseId)).wait();
  await waitForJson<any>(`/leases/${leaseId}`, (value) => value.status === "Ended");

  console.log(JSON.stringify({
    leaseId,
    listingId: listing.id,
    requester,
    intervalSecs: listing.intervalSecs,
    settledIntervals: settled.settledIntervals,
    manifest,
    status: "passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
