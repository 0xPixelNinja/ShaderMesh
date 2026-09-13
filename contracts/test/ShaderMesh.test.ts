import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E = (n: string | number) => ethers.parseEther(String(n));

describe("ShaderMesh", () => {
  async function deploy() {
    const [owner, requester, p1, p2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SmeshToken");
    const token = await Token.deploy(E(1_000_000), owner.address);

    const Registry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Registry.deploy(await token.getAddress(), E(50), owner.address);

    const Market = await ethers.getContractFactory("JobMarket");
    const market = await Market.deploy(
      await token.getAddress(),
      await registry.getAddress(),
      owner.address
    );

    const Verification = await ethers.getContractFactory("Verification");
    const verification = await Verification.deploy(
      await market.getAddress(),
      await registry.getAddress(),
      owner.address
    );

    // Wire permissions.
    await registry.setAuthorized(await market.getAddress(), true);
    await registry.setAuthorized(await verification.getAddress(), true);
    await market.setVerification(await verification.getAddress());

    // Fund actors.
    await token.transfer(requester.address, E(1000));
    await token.transfer(p1.address, E(200));
    await token.transfer(p2.address, E(200));

    // Providers register + stake 100 each.
    for (const p of [p1, p2]) {
      await registry.connect(p).register("gpu:RTX4090,vram:24GB");
      await token.connect(p).approve(await registry.getAddress(), E(100));
      await registry.connect(p).stake(E(100));
    }

    // Requester posts a 1-task job at 100 SMESH/task.
    await token.connect(requester).approve(await market.getAddress(), E(1000));
    await market.connect(requester).postJob("ipfs://scene-cid", 1, E(100), 0);

    return { owner, requester, p1, p2, token, registry, market, verification };
  }

  it("happy path: claim -> submit -> finalize pays the provider and raises reputation", async () => {
    const { p1, token, registry, market } = await deploy();

    await market.connect(p1).claimTask(1, 0);
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("frame-0-output"));
    await market.connect(p1).submitResult(1, 0, resultHash, "ipfs://out-cid");

    await time.increase(3601); // past challengeWindow (1h)
    await market.finalizeTask(1, 0);

    // p1 had 200, staked 100 (balance 100), earned 100 reward -> 200.
    expect(await token.balanceOf(p1.address)).to.equal(E(200));

    const task = await market.getTask(1, 0);
    expect(Number(task.status)).to.equal(4); // Paid

    // EMA: (5000*4 + 10000)/5 = 6000
    expect(await registry.reputationOf(p1.address)).to.equal(6000n);
  });

  it("cheating path: a challenger slashes a dishonest provider and reopens the task", async () => {
    const { p1, p2, token, registry, market, verification } = await deploy();

    await market.connect(p1).claimTask(1, 0);
    const dishonest = ethers.keccak256(ethers.toUtf8Bytes("fabricated-output"));
    await market.connect(p1).submitResult(1, 0, dishonest, "ipfs://fake-cid");

    // p2 independently re-executes and disagrees.
    const honest = ethers.keccak256(ethers.toUtf8Bytes("correct-output"));
    await verification.connect(p2).challenge(1, 0, honest);

    await time.increase(1801); // past voteWindow (30m)
    await verification.resolve(1, 0);

    // p2 had 200, staked 100 (balance 100), received p1's 10 bond -> 110.
    expect(await token.balanceOf(p2.address)).to.equal(E(110));

    // p1 lost 10 stake: 100 -> 90 available.
    expect(await registry.availableStake(p1.address)).to.equal(E(90));

    // Task reopened.
    const task = await market.getTask(1, 0);
    expect(Number(task.status)).to.equal(0); // Open

    // Reputations moved: p1 down, p2 up.
    expect(await registry.reputationOf(p1.address)).to.equal(4000n);
    expect(await registry.reputationOf(p2.address)).to.equal(6000n);
  });

  it("rejects ineligible providers (below min stake) from claiming", async () => {
    const { owner, token, registry, market } = await deploy();
    const stranger = (await ethers.getSigners())[5];

    await token.transfer(stranger.address, E(40));
    await registry.connect(stranger).register("cpu-only");
    await token.connect(stranger).approve(await registry.getAddress(), E(40));
    await registry.connect(stranger).stake(E(40)); // below 50 minStake

    await expect(market.connect(stranger).claimTask(1, 0)).to.be.revertedWith(
      "market: not eligible"
    );
  });
});
