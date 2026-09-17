import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function main(): Promise<void> {
  const deploymentPath = resolve(
    process.env.DEPLOYMENTS_FILE
      ?? join(__dirname, "..", "deployments", `${network.name}.json`),
  );
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (Number(deployment.chainId) !== chainId) {
    throw new Error(`deployment chain ${deployment.chainId} does not match RPC chain ${chainId}`);
  }

  const rental = await ethers.getContractAt("RentalMarket", deployment.contracts.RentalMarket);
  const market = await ethers.getContractAt("JobMarket", deployment.contracts.JobMarket);
  const verification = await ethers.getContractAt("Verification", deployment.contracts.Verification);

  const graceSecs = positiveInt("DEMO_RENTAL_GRACE_SECS", 30);
  const challengeWindow = positiveInt("DEMO_CHALLENGE_WINDOW_SECS", 120);
  const claimTimeout = positiveInt("DEMO_CLAIM_TIMEOUT_SECS", 300);
  const voteWindow = positiveInt("DEMO_VOTE_WINDOW_SECS", 120);

  await (await rental.setGraceSecs(graceSecs)).wait();
  await (await market.setChallengeWindow(challengeWindow)).wait();
  await (await market.setClaimTimeout(claimTimeout)).wait();
  await (await verification.setVoteWindow(voteWindow)).wait();

  console.log(JSON.stringify({ graceSecs, challengeWindow, claimTimeout, voteWindow }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
