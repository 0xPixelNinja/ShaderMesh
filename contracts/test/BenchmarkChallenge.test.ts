import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const E = (n: string | number) => ethers.parseEther(String(n));
const HOUR = 3600;
const WINDOW = 15 * 60;
const HASH = ethers.keccak256(ethers.toUtf8Bytes("output"));

enum Challenge {
  None,
  Open,
  Responded,
  Passed,
  Failed,
  Lapsed,
}

describe("ProviderRegistry benchmark challenges", () => {
  async function deploy() {
    const [owner, provider, treasury, stranger, requester] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SmeshToken");
    const token = await Token.deploy(E(1_000_000), owner.address);

    const Registry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Registry.deploy(await token.getAddress(), E(50), owner.address);

    const Rental = await ethers.getContractFactory("RentalMarket");
    const rental = await Rental.deploy(await token.getAddress(), await registry.getAddress(), owner.address);

    await registry.setAuthorized(await rental.getAddress(), true);
    await registry.setAttester(owner.address);
    await registry.setTreasury(treasury.address);

    await token.transfer(provider.address, E(200));
    await token.transfer(requester.address, E(1000));
    await registry.connect(provider).register('{"gpu":"RTX4070"}');
    await token.connect(provider).approve(await registry.getAddress(), E(100));
    await registry.connect(provider).stake(E(100));
    await registry.attest(provider.address, "RTX4070", 8, 1000);

    return { owner, provider, treasury, stranger, requester, token, registry, rental };
  }

  async function issue(ctx: Awaited<ReturnType<typeof deploy>>) {
    const id = await ctx.registry.nextChallengeId();
    await expect(ctx.registry.issueChallenge(ctx.provider.address))
      .to.emit(ctx.registry, "ChallengeIssued")
      .withArgs(id, ctx.provider.address, anyValue, anyValue);
    return id;
  }

  it("defaults the treasury to the owner and the slash to a fifth of min stake", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SmeshToken");
    const token = await Token.deploy(E(1000), owner.address);
    const Registry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Registry.deploy(await token.getAddress(), E(50), owner.address);
    expect(await registry.treasury()).to.equal(owner.address);
    expect(await registry.challengeSlash()).to.equal(E(10));
    expect(await registry.challengeWindow()).to.equal(WINDOW);
  });

  it("restricts admin and attester actions", async () => {
    const ctx = await deploy();
    await expect(ctx.registry.connect(ctx.stranger).setTreasury(ctx.stranger.address)).to.be.reverted;
    await expect(ctx.registry.setTreasury(ethers.ZeroAddress)).to.be.revertedWith("registry: zero treasury");
    await expect(ctx.registry.connect(ctx.stranger).setChallengeParams(60, 0)).to.be.reverted;
    await expect(ctx.registry.setChallengeParams(0, 0)).to.be.revertedWith("registry: zero window");
    await expect(ctx.registry.setChallengeParams(120, E(5)))
      .to.emit(ctx.registry, "ChallengeParamsSet")
      .withArgs(120, E(5));

    await expect(ctx.registry.connect(ctx.stranger).issueChallenge(ctx.provider.address)).to.be.revertedWith(
      "registry: not attester",
    );
    await expect(ctx.registry.issueChallenge(ctx.stranger.address)).to.be.revertedWith("registry: not attested");
  });

  it("passes an answered challenge and refreshes the attestation", async () => {
    const ctx = await deploy();
    const before = (await ctx.registry.attestations(ctx.provider.address)).attestedAt;
    const id = await issue(ctx);

    expect(await ctx.registry.openChallenge(ctx.provider.address)).to.equal(id);
    await expect(ctx.registry.issueChallenge(ctx.provider.address)).to.be.revertedWith("registry: challenge open");
    await expect(ctx.registry.connect(ctx.provider).unstake(E(1))).to.be.revertedWith("registry: challenge open");
    await expect(ctx.registry.connect(ctx.stranger).respondChallenge(id, 900, HASH)).to.be.revertedWith(
      "registry: not challenged",
    );
    await expect(ctx.registry.resolveChallenge(id, true)).to.be.revertedWith("registry: not responded");

    await time.increase(60);
    await expect(ctx.registry.connect(ctx.provider).respondChallenge(id, 900, HASH))
      .to.emit(ctx.registry, "ChallengeResponded")
      .withArgs(id, ctx.provider.address, 900, HASH);
    await expect(ctx.registry.connect(ctx.provider).respondChallenge(id, 900, HASH)).to.be.revertedWith(
      "registry: not open",
    );
    await expect(ctx.registry.connect(ctx.stranger).resolveChallenge(id, true)).to.be.revertedWith(
      "registry: not attester",
    );

    await expect(ctx.registry.resolveChallenge(id, true))
      .to.emit(ctx.registry, "ChallengeResolved")
      .withArgs(id, ctx.provider.address, Challenge.Passed, 0);

    const c = await ctx.registry.challenges(id);
    expect(c.status).to.equal(Challenge.Passed);
    expect(c.score).to.equal(900);
    expect(c.outputHash).to.equal(HASH);
    expect(await ctx.registry.openChallenge(ctx.provider.address)).to.equal(0);
    expect((await ctx.registry.attestations(ctx.provider.address)).attestedAt).to.be.greaterThan(before);
    const p = await ctx.registry.providers(ctx.provider.address);
    expect(p.stake).to.equal(E(100));
    expect(p.completed).to.equal(1);
    await ctx.registry.connect(ctx.provider).unstake(E(1));
  });

  it("slashes free stake to the treasury and revokes attestation on a failed answer", async () => {
    const ctx = await deploy();
    const id = await issue(ctx);
    await ctx.registry.connect(ctx.provider).respondChallenge(id, 10, HASH);

    await expect(ctx.registry.resolveChallenge(id, false))
      .to.emit(ctx.registry, "ChallengeResolved")
      .withArgs(id, ctx.provider.address, Challenge.Failed, E(10))
      .and.to.emit(ctx.registry, "AttestationRevoked")
      .withArgs(ctx.provider.address)
      .and.to.emit(ctx.registry, "Slashed")
      .withArgs(ctx.provider.address, E(10), ctx.treasury.address);

    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(E(10));
    expect(await ctx.registry.isAttested(ctx.provider.address)).to.equal(false);
    const p = await ctx.registry.providers(ctx.provider.address);
    expect(p.stake).to.equal(E(90));
    expect(p.failed).to.equal(1);
    expect(p.reputation).to.equal(4000);
    await expect(ctx.registry.issueChallenge(ctx.provider.address)).to.be.revertedWith("registry: not attested");
  });

  it("lets anyone fail a provider that misses the deadline", async () => {
    const ctx = await deploy();
    const id = await issue(ctx);

    await expect(ctx.registry.connect(ctx.stranger).expireChallenge(id)).to.be.revertedWith("registry: not expired");
    await time.increase(WINDOW + 1);
    await expect(ctx.registry.connect(ctx.provider).respondChallenge(id, 900, HASH)).to.be.revertedWith(
      "registry: deadline passed",
    );

    await expect(ctx.registry.connect(ctx.stranger).expireChallenge(id))
      .to.emit(ctx.registry, "ChallengeResolved")
      .withArgs(id, ctx.provider.address, Challenge.Failed, E(10));
    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(E(10));
    expect(await ctx.registry.isAttested(ctx.provider.address)).to.equal(false);
    await expect(ctx.registry.expireChallenge(id)).to.be.revertedWith("registry: not open");
  });

  it("lapses an answer the attester never judges, without penalty", async () => {
    const ctx = await deploy();
    const id = await issue(ctx);
    await ctx.registry.connect(ctx.provider).respondChallenge(id, 900, HASH);

    await time.increase(WINDOW + 1);
    await expect(ctx.registry.expireChallenge(id)).to.be.revertedWith("registry: not expired");
    await time.increase(WINDOW);
    await expect(ctx.registry.resolveChallenge(id, false)).to.be.revertedWith("registry: judging lapsed");

    await expect(ctx.registry.connect(ctx.stranger).expireChallenge(id))
      .to.emit(ctx.registry, "ChallengeResolved")
      .withArgs(id, ctx.provider.address, Challenge.Lapsed, 0);
    expect((await ctx.registry.providers(ctx.provider.address)).stake).to.equal(E(100));
    expect(await ctx.registry.openChallenge(ctx.provider.address)).to.equal(0);
  });

  it("never slashes stake bonded to an active lease", async () => {
    const ctx = await deploy();
    await ctx.rental.connect(ctx.provider).createListing(E(1), HOUR, 1, 10, '{"gpu":"RTX4070"}');
    await ctx.token.connect(ctx.requester).approve(await ctx.rental.getAddress(), E(1000));
    await ctx.rental.connect(ctx.requester).requestLease(1, 2, "ipfs://manifest");
    await ctx.rental.connect(ctx.provider).acceptLease(1);

    const bonded = (await ctx.registry.providers(ctx.provider.address)).bonded;
    await ctx.registry.setChallengeParams(WINDOW, E(500));
    const id = await issue(ctx);
    await time.increase(WINDOW + 1);
    await ctx.registry.expireChallenge(id);

    const p = await ctx.registry.providers(ctx.provider.address);
    expect(p.bonded).to.equal(bonded);
    expect(p.stake).to.equal(bonded);
    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(E(100) - bonded);
  });
});
