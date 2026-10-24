import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ContractTransactionResponse } from "ethers";
import { ethers } from "hardhat";

const E = (value: string | number) => ethers.parseEther(String(value));

async function main() {
  const [owner, requester, provider, challenger, faucetUser] = await ethers.getSigners();
  const rows: Array<{ label: string; gas: bigint }> = [];

  async function record(label: string, pending: Promise<ContractTransactionResponse>) {
    const receipt = await (await pending).wait();
    if (!receipt) throw new Error(`missing receipt for ${label}`);
    rows.push({ label, gas: receipt.gasUsed });
  }

  async function wait(pending: Promise<ContractTransactionResponse>) {
    await (await pending).wait();
  }

  const Token = await ethers.getContractFactory("SmeshToken");
  const token = await Token.deploy(E(1_000_000), owner.address);
  const Registry = await ethers.getContractFactory("ProviderRegistry");
  const registry = await Registry.deploy(await token.getAddress(), E(50), owner.address);
  const Market = await ethers.getContractFactory("JobMarket");
  const market = await Market.deploy(await token.getAddress(), await registry.getAddress(), owner.address);
  const Verification = await ethers.getContractFactory("Verification");
  const verification = await Verification.deploy(await market.getAddress(), await registry.getAddress(), owner.address);
  const Rental = await ethers.getContractFactory("RentalMarket");
  const rental = await Rental.deploy(await token.getAddress(), await registry.getAddress(), owner.address);
  const Inference = await ethers.getContractFactory("InferenceMarket");
  const inference = await Inference.deploy(await token.getAddress(), await registry.getAddress());

  await Promise.all([
    token.waitForDeployment(),
    registry.waitForDeployment(),
    market.waitForDeployment(),
    verification.waitForDeployment(),
    rental.waitForDeployment(),
    inference.waitForDeployment(),
  ]);

  await wait(registry.setAuthorized(await market.getAddress(), true));
  await wait(registry.setAuthorized(await verification.getAddress(), true));
  await wait(registry.setAuthorized(await rental.getAddress(), true));
  await wait(registry.setAttester(owner.address));
  await wait(market.setVerification(await verification.getAddress()));
  await wait(token.transfer(requester.address, E(1_000)));
  await wait(token.transfer(provider.address, E(250)));
  await wait(token.transfer(challenger.address, E(200)));

  await record("token.faucet", token.connect(faucetUser).faucet());
  await record("registry.register", registry.connect(provider).register('{"gpu":"RTX4090"}'));
  await wait(token.connect(provider).approve(await registry.getAddress(), E(200)));
  await record("registry.stake", registry.connect(provider).stake(E(200)));
  await record(
    "registry.updateCapabilities",
    registry.connect(provider).updateCapabilities('{"gpu":"RTX4090","vramGB":24}'),
  );
  await record("registry.attest", registry.attest(provider.address, "RTX4090", 24, 1_000));

  await wait(registry.connect(challenger).register('{"gpu":"RTX4080"}'));
  await wait(token.connect(challenger).approve(await registry.getAddress(), E(100)));
  await wait(registry.connect(challenger).stake(E(100)));
  await wait(registry.attest(challenger.address, "RTX4080", 16, 800));

  await wait(token.connect(requester).approve(await market.getAddress(), E(200)));
  await record("job.postJob", market.connect(requester).postJob("ipfs://input", 2, E(100), 0));
  await record("job.claimTask", market.connect(provider).claimTask(1, 0));
  const firstHash = ethers.keccak256(ethers.toUtf8Bytes("result-0"));
  await record("job.submitResult", market.connect(provider).submitResult(1, 0, firstHash, "ipfs://output-0"));
  await time.increase(3_601);
  await record("job.finalizeTask", market.finalizeTask(1, 0));

  await record("job.claimTask (disputed)", market.connect(provider).claimTask(1, 1));
  const secondHash = ethers.keccak256(ethers.toUtf8Bytes("result-1"));
  await record("job.submitResult (disputed)", market.connect(provider).submitResult(1, 1, secondHash, "ipfs://output-1"));
  const challengeHash = ethers.keccak256(ethers.toUtf8Bytes("different-result"));
  await record("verification.challenge", verification.connect(challenger).challenge(1, 1, challengeHash));
  await time.increase(1_801);
  await record("verification.resolve", verification.resolve(1, 1));

  await record("rental.createListing", rental.connect(provider).createListing(E(1), 3_600, 1, 4, '{"gpu":"RTX4090"}'));
  await wait(token.connect(requester).approve(await rental.getAddress(), E(2)));
  await record("rental.requestLease", rental.connect(requester).requestLease(1, 2, "ipfs://manifest"));
  await record("rental.acceptLease", rental.connect(provider).acceptLease(1));
  await record("rental.heartbeat", rental.connect(provider).heartbeat(1));
  await time.increase(3_601);
  await wait(rental.connect(provider).heartbeat(1));
  await record("rental.settle", rental.settle(1));
  await time.increase(3_600);
  await record("rental.finalizeExpired", rental.finalizeExpired(1));

  const answer = ethers.keccak256(ethers.toUtf8Bytes("benchmark-output"));
  await record("registry.issueChallenge", registry.issueChallenge(provider.address));
  await record("registry.respondChallenge", registry.connect(provider).respondChallenge(1, 900, answer));
  await record("registry.resolveChallenge (pass)", registry.resolveChallenge(1, true));
  await wait(registry.issueChallenge(provider.address));
  await time.increase(15 * 60 + 1);
  await record("registry.expireChallenge (slash)", registry.expireChallenge(2));
  await wait(registry.attest(provider.address, "RTX4090", 24, 1_000));

  await record("inference.createOffer", inference.connect(provider).createOffer("llama-3.1-8b", E("0.01")));
  await wait(token.connect(requester).approve(await inference.getAddress(), E(5)));
  await record("inference.openCredit", inference.connect(requester).openCredit(1, E(5)));
  await record("inference.settleUsage", inference.connect(requester).settleUsage(1, 10, 20));
  await record("inference.closeCredit", inference.connect(requester).closeCredit(1));

  const width = Math.max(...rows.map(({ label }) => label.length));
  console.log("Core transaction gas (receipt gasUsed)");
  for (const { label, gas } of rows) console.log(`${label.padEnd(width)}  ${gas}`);
  console.log(`${"total".padEnd(width)}  ${rows.reduce((sum, row) => sum + row.gas, 0n)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
