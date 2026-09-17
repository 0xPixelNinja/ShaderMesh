import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E = (n: string | number) => ethers.parseEther(String(n));

describe("ShaderMesh", () => {
  async function deploy() {
    const [owner, requester, p1, p2, p3, stranger] = await ethers.getSigners();

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

    return { owner, requester, p1, p2, p3, stranger, token, registry, market, verification };
  }

  async function addProvider(ctx: Awaited<ReturnType<typeof deploy>>, provider = ctx.p3) {
    await ctx.token.transfer(provider.address, E(200));
    await ctx.registry.connect(provider).register("gpu:RTX4080,vram:16GB");
    await ctx.token.connect(provider).approve(await ctx.registry.getAddress(), E(100));
    await ctx.registry.connect(provider).stake(E(100));
  }

  it("enforces the faucet cooldown per recipient", async () => {
    const { stranger, token } = await deploy();

    await expect(token.connect(stranger).faucet())
      .to.emit(token, "Faucet")
      .withArgs(stranger.address, E(1000));
    await expect(token.connect(stranger).faucet()).to.be.revertedWith("faucet: cooldown active");

    await time.increase(24 * 60 * 60);
    await token.connect(stranger).faucet();
    expect(await token.balanceOf(stranger.address)).to.equal(E(2000));
  });

  it("restricts registry economics and protects bonded stake from withdrawal", async () => {
    const { requester, p1, token, registry } = await deploy();

    await expect(registry.connect(requester).bond(p1.address, E(10))).to.be.revertedWith(
      "registry: not authorized",
    );
    await expect(registry.connect(requester).unbond(p1.address, E(1))).to.be.revertedWith(
      "registry: not authorized",
    );
    await expect(registry.connect(requester).slash(p1.address, E(1), requester.address)).to.be.revertedWith(
      "registry: not authorized",
    );
    await expect(registry.connect(requester).recordOutcome(p1.address, true)).to.be.revertedWith(
      "registry: not authorized",
    );

    await registry.setAuthorized(requester.address, true);
    await registry.connect(requester).bond(p1.address, E(10));
    await expect(registry.connect(p1).unstake(E(91))).to.be.revertedWith("registry: exceeds free stake");
    await expect(registry.connect(p1).unstake(E(90)))
      .to.emit(registry, "Unstaked")
      .withArgs(p1.address, E(90), E(10));
    expect(await token.balanceOf(p1.address)).to.equal(E(190));

    await registry.connect(requester).unbond(p1.address, E(10));
    await registry.connect(p1).unstake(E(10));
    expect(await token.balanceOf(p1.address)).to.equal(E(200));
  });

  it("toggles provider activity and emits capability updates", async () => {
    const { p1, stranger, registry } = await deploy();
    const capabilities = '{"gpu":"RTX4090","vramGB":24}';

    await expect(registry.connect(stranger).updateCapabilities(capabilities)).to.be.revertedWith(
      "registry: not registered",
    );
    await expect(registry.connect(p1).updateCapabilities(capabilities))
      .to.emit(registry, "CapabilitiesUpdated")
      .withArgs(p1.address, capabilities);
    expect((await registry.providers(p1.address)).capabilities).to.equal(capabilities);

    await expect(registry.connect(p1).setActive(false))
      .to.emit(registry, "ActiveSet")
      .withArgs(p1.address, false);
    expect(await registry.isEligible(p1.address)).to.equal(false);
    await expect(registry.connect(p1).setActive(true))
      .to.emit(registry, "ActiveSet")
      .withArgs(p1.address, true);
    expect(await registry.isEligible(p1.address)).to.equal(true);
  });

  it("enforces attester authorization and expires stale attestations", async () => {
    const { owner, requester, p1, registry } = await deploy();

    await expect(registry.connect(requester).attest(p1.address, "RTX4090", 24, 1000)).to.be.revertedWith(
      "registry: not attester",
    );
    await registry.setAttester(owner.address);
    await expect(registry.attest(p1.address, "RTX4090", 24, 1000))
      .to.emit(registry, "Attested")
      .withArgs(p1.address, "RTX4090", 24, 1000);
    expect(await registry.isAttested(p1.address)).to.equal(true);

    await registry.setAttestationTtl(60);
    await time.increase(61);
    expect(await registry.isAttested(p1.address)).to.equal(false);
  });

  it("rejects unsupported verification policies without taking escrow", async () => {
    const { requester, token, market } = await deploy();
    const balance = await token.balanceOf(requester.address);

    await expect(market.connect(requester).postJob("ipfs://other", 1, E(100), 2)).to.be.revertedWith(
      "market: bad verification policy",
    );
    expect(await token.balanceOf(requester.address)).to.equal(balance);
    expect(await market.nextJobId()).to.equal(2);
  });

  it("slashes and reopens a claim after its submission timeout", async () => {
    const { requester, p1, token, registry, market } = await deploy();
    await market.connect(p1).claimTask(1, 0);

    await expect(market.reclaimTimedOut(1, 0)).to.be.revertedWith("market: not timed out");
    await time.increase(3601);
    await expect(market.reclaimTimedOut(1, 0))
      .to.emit(market, "TaskSlashed")
      .withArgs(1, 0, p1.address, requester.address)
      .and.to.emit(market, "TaskReopened")
      .withArgs(1, 0);

    expect((await market.getTask(1, 0)).status).to.equal(0);
    expect(await registry.availableStake(p1.address)).to.equal(E(90));
    expect(await registry.reputationOf(p1.address)).to.equal(4000);
    expect(await token.balanceOf(requester.address)).to.equal(E(910));
  });

  it("rejects a first challenge after the job challenge deadline", async () => {
    const { p1, p2, market, verification } = await deploy();
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result"));
    await market.connect(p1).claimTask(1, 0);
    await market.connect(p1).submitResult(1, 0, resultHash, "ipfs://result");

    await time.increase(3601);
    await expect(verification.connect(p2).challenge(1, 0, resultHash)).to.be.revertedWith(
      "verify: challenge window closed",
    );
    expect((await market.getTask(1, 0)).status).to.equal(2);
  });

  it("rejects self, duplicate, and post-deadline dispute votes", async () => {
    const ctx = await deploy();
    await addProvider(ctx);
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("provider-result"));
    const otherHash = ethers.keccak256(ethers.toUtf8Bytes("challenger-result"));
    await ctx.market.connect(ctx.p1).claimTask(1, 0);
    await ctx.market.connect(ctx.p1).submitResult(1, 0, resultHash, "ipfs://result");

    await expect(ctx.verification.connect(ctx.p1).challenge(1, 0, otherHash)).to.be.revertedWith(
      "verify: cannot self-challenge",
    );
    await ctx.verification.connect(ctx.p2).challenge(1, 0, otherHash);
    await expect(ctx.verification.connect(ctx.p2).challenge(1, 0, otherHash)).to.be.revertedWith(
      "verify: already voted",
    );

    await time.increase(1801);
    await expect(ctx.verification.connect(ctx.p3).challenge(1, 0, otherHash)).to.be.revertedWith(
      "verify: vote window closed",
    );
  });

  it("resolves an agreeing challenge as honest and pays the provider", async () => {
    const { p1, p2, token, market, verification } = await deploy();
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("honest-result"));
    await market.connect(p1).claimTask(1, 0);
    await market.connect(p1).submitResult(1, 0, resultHash, "ipfs://result");
    await verification.connect(p2).challenge(1, 0, resultHash);

    await expect(verification.resolve(1, 0)).to.be.revertedWith("verify: vote window open");
    await time.increase(1801);
    await expect(verification.resolve(1, 0))
      .to.emit(verification, "DisputeResolved")
      .withArgs(1, 0, false);
    expect((await market.getTask(1, 0)).status).to.equal(4);
    expect(await token.balanceOf(p1.address)).to.equal(E(200));
  });

  it("requires the configured disagreement quorum before slashing", async () => {
    const { p1, p2, registry, market, verification } = await deploy();
    await verification.setQuorum(2);
    const providerHash = ethers.keccak256(ethers.toUtf8Bytes("provider-result"));
    const challengerHash = ethers.keccak256(ethers.toUtf8Bytes("different-result"));
    await market.connect(p1).claimTask(1, 0);
    await market.connect(p1).submitResult(1, 0, providerHash, "ipfs://result");
    await verification.connect(p2).challenge(1, 0, challengerHash);

    await time.increase(1801);
    await verification.resolve(1, 0);
    expect((await market.getTask(1, 0)).status).to.equal(4);
    expect(await registry.availableStake(p1.address)).to.equal(E(100));
    expect(await registry.reputationOf(p1.address)).to.equal(6000);
    expect(await registry.reputationOf(p2.address)).to.equal(4000);
  });

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
