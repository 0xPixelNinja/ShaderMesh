import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E = (n: string | number) => ethers.parseEther(String(n));
const PRICE = E("0.01");
const MODEL = "meta-llama/Llama-3.1-8B-Instruct";

describe("InferenceMarket", () => {
  async function deploy() {
    const [owner, requester, requester2, provider, otherProvider, stranger] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("SmeshToken");
    const token = await Token.deploy(E(1_000_000), owner.address);

    const Registry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Registry.deploy(
      await token.getAddress(),
      E(50),
      owner.address,
    );
    await registry.setAttester(owner.address);

    const Inference = await ethers.getContractFactory("InferenceMarket");
    const inference = await Inference.deploy(
      await token.getAddress(),
      await registry.getAddress(),
    );

    for (const account of [requester, requester2]) {
      await token.transfer(account.address, E(100));
      await token.connect(account).approve(await inference.getAddress(), E(100));
    }
    for (const account of [provider, otherProvider]) {
      await token.transfer(account.address, E(100));
    }

    return {
      owner,
      requester,
      requester2,
      provider,
      otherProvider,
      stranger,
      token,
      registry,
      inference,
    };
  }

  async function registerAndStake(
    ctx: Awaited<ReturnType<typeof deploy>>,
    provider = ctx.provider,
  ) {
    await ctx.registry.connect(provider).register('{"gpu":"RTX4090"}');
    await ctx.token.connect(provider).approve(await ctx.registry.getAddress(), E(100));
    await ctx.registry.connect(provider).stake(E(100));
  }

  async function readyProvider(
    ctx: Awaited<ReturnType<typeof deploy>>,
    provider = ctx.provider,
  ) {
    await registerAndStake(ctx, provider);
    await ctx.registry
      .connect(ctx.owner)
      .attest(provider.address, "RTX4090", 24, 1000);
  }

  async function createOffer(ctx: Awaited<ReturnType<typeof deploy>>) {
    await readyProvider(ctx);
    const offerId = await ctx.inference.nextOfferId();
    await ctx.inference.connect(ctx.provider).createOffer(MODEL, PRICE);
    return offerId;
  }

  async function openCredit(
    ctx: Awaited<ReturnType<typeof deploy>>,
    escrow = E(10),
    requester = ctx.requester,
    offerId?: bigint,
  ) {
    const resolvedOfferId = offerId ?? (await createOffer(ctx));
    const creditId = await ctx.inference.nextCreditId();
    await ctx.inference.connect(requester).openCredit(resolvedOfferId, escrow);
    return { offerId: resolvedOfferId, creditId };
  }

  it("allows only eligible, attested providers to create valid offers", async () => {
    const ctx = await deploy();

    await expect(
      ctx.inference.connect(ctx.provider).createOffer(MODEL, PRICE),
    ).to.be.revertedWith("inference: not eligible");

    await registerAndStake(ctx);
    await expect(
      ctx.inference.connect(ctx.provider).createOffer(MODEL, PRICE),
    ).to.be.revertedWith("inference: not attested");
    await ctx.registry
      .connect(ctx.owner)
      .attest(ctx.provider.address, "RTX4090", 24, 1000);

    await expect(
      ctx.inference.connect(ctx.provider).createOffer("", PRICE),
    ).to.be.revertedWith("inference: empty model");
    await expect(
      ctx.inference.connect(ctx.provider).createOffer(MODEL, 0),
    ).to.be.revertedWith("inference: zero price");

    await expect(ctx.inference.connect(ctx.provider).createOffer(MODEL, PRICE))
      .to.emit(ctx.inference, "OfferCreated")
      .withArgs(1, ctx.provider.address, MODEL, PRICE);

    const offer = await ctx.inference.getOffer(1);
    expect(offer.provider).to.equal(ctx.provider.address);
    expect(offer.pricePerToken).to.equal(PRICE);
    expect(offer.modelIdentifier).to.equal(MODEL);
    expect(offer.active).to.equal(true);
  });

  it("opens funded credits with snapshotted provider and price", async () => {
    const ctx = await deploy();
    const offerId = await createOffer(ctx);

    await expect(ctx.inference.connect(ctx.requester).openCredit(offerId, 0)).to.be
      .revertedWith("inference: zero escrow");
    await expect(ctx.inference.connect(ctx.requester).openCredit(999, E(1))).to.be
      .revertedWith("inference: offer inactive");

    await expect(ctx.inference.connect(ctx.requester).openCredit(offerId, E(10)))
      .to.emit(ctx.inference, "CreditOpened")
      .withArgs(
        1,
        offerId,
        ctx.requester.address,
        ctx.provider.address,
        PRICE,
        E(10),
      );

    const credit = await ctx.inference.getCredit(1);
    expect(credit.offerId).to.equal(offerId);
    expect(credit.requester).to.equal(ctx.requester.address);
    expect(credit.provider).to.equal(ctx.provider.address);
    expect(credit.pricePerToken).to.equal(PRICE);
    expect(credit.escrow).to.equal(E(10));
    expect(credit.active).to.equal(true);
    expect(await ctx.token.balanceOf(await ctx.inference.getAddress())).to.equal(E(10));
  });

  it("settles multiple cumulative usage reports and makes replay a no-op", async () => {
    const ctx = await deploy();
    const { creditId } = await openCredit(ctx);

    await expect(ctx.inference.connect(ctx.requester).settleUsage(creditId, 10, 20))
      .to.emit(ctx.inference, "UsageSettled")
      .withArgs(
        creditId,
        ctx.requester.address,
        ctx.provider.address,
        10,
        20,
        30,
        E("0.3"),
        E("9.7"),
      );
    await expect(ctx.inference.connect(ctx.requester).settleUsage(creditId, 30, 50))
      .to.emit(ctx.inference, "UsageSettled")
      .withArgs(
        creditId,
        ctx.requester.address,
        ctx.provider.address,
        30,
        50,
        50,
        E("0.5"),
        E("9.2"),
      );
    await expect(ctx.inference.connect(ctx.requester).settleUsage(creditId, 30, 50))
      .to.emit(ctx.inference, "UsageSettled")
      .withArgs(
        creditId,
        ctx.requester.address,
        ctx.provider.address,
        30,
        50,
        0,
        0,
        E("9.2"),
      );

    const credit = await ctx.inference.getCredit(creditId);
    expect(credit.promptTokens).to.equal(30);
    expect(credit.completionTokens).to.equal(50);
    expect(credit.paid).to.equal(E("0.8"));
    expect(credit.escrow).to.equal(E("9.2"));
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E("0.8"));
  });

  it("rejects decreasing counters and usage that would overdraw escrow", async () => {
    const ctx = await deploy();
    const { creditId } = await openCredit(ctx, E(1));
    await ctx.inference.connect(ctx.requester).settleUsage(creditId, 10, 20);

    await expect(
      ctx.inference.connect(ctx.requester).settleUsage(creditId, 9, 20),
    ).to.be.revertedWith("inference: prompt decreased");
    await expect(
      ctx.inference.connect(ctx.requester).settleUsage(creditId, 10, 19),
    ).to.be.revertedWith("inference: completion decreased");
    await expect(
      ctx.inference.connect(ctx.requester).settleUsage(creditId, 80, 51),
    ).to.be.revertedWith("inference: exceeds escrow");

    const credit = await ctx.inference.getCredit(creditId);
    expect(credit.promptTokens).to.equal(10);
    expect(credit.completionTokens).to.equal(20);
    expect(credit.paid).to.equal(E("0.3"));
    expect(credit.escrow).to.equal(E("0.7"));
  });

  it("prevents providers and third parties from debiting or closing credit", async () => {
    const ctx = await deploy();
    const { offerId, creditId } = await openCredit(ctx);

    await expect(
      ctx.inference.connect(ctx.provider).settleUsage(creditId, 1, 1),
    ).to.be.revertedWith("inference: not requester");
    await expect(
      ctx.inference.connect(ctx.stranger).settleUsage(creditId, 1, 1),
    ).to.be.revertedWith("inference: not requester");
    await expect(ctx.inference.connect(ctx.provider).closeCredit(creditId)).to.be
      .revertedWith("inference: not requester");
    await expect(ctx.inference.connect(ctx.stranger).deactivateOffer(offerId)).to.be
      .revertedWith("inference: not provider");

    expect((await ctx.inference.getCredit(creditId)).escrow).to.equal(E(10));
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(0);
  });

  it("blocks new credits after deactivation without disrupting existing credit", async () => {
    const ctx = await deploy();
    const { offerId, creditId } = await openCredit(ctx);

    await expect(ctx.inference.connect(ctx.provider).deactivateOffer(offerId))
      .to.emit(ctx.inference, "OfferDeactivated")
      .withArgs(offerId, ctx.provider.address);
    await expect(ctx.inference.connect(ctx.provider).deactivateOffer(offerId)).to.be
      .revertedWith("inference: offer inactive");
    await expect(
      ctx.inference.connect(ctx.requester2).openCredit(offerId, E(1)),
    ).to.be.revertedWith("inference: offer inactive");

    await ctx.inference.connect(ctx.requester).settleUsage(creditId, 10, 10);
    expect((await ctx.inference.getCredit(creditId)).paid).to.equal(E("0.2"));
  });

  it("checks provider eligibility and attestation again when credit opens", async () => {
    const ctx = await deploy();
    const offerId = await createOffer(ctx);

    await ctx.registry.connect(ctx.provider).setActive(false);
    await expect(
      ctx.inference.connect(ctx.requester).openCredit(offerId, E(1)),
    ).to.be.revertedWith("inference: provider ineligible");
    await ctx.registry.connect(ctx.provider).setActive(true);

    await ctx.registry.setAttestationTtl(1);
    await time.increase(2);
    await expect(
      ctx.inference.connect(ctx.requester).openCredit(offerId, E(1)),
    ).to.be.revertedWith("inference: provider unattested");
  });

  it("closes credit and refunds all unspent escrow", async () => {
    const ctx = await deploy();
    const { creditId } = await openCredit(ctx);
    await ctx.inference.connect(ctx.requester).settleUsage(creditId, 25, 25);

    await expect(ctx.inference.connect(ctx.requester).closeCredit(creditId))
      .to.emit(ctx.inference, "CreditClosed")
      .withArgs(
        creditId,
        ctx.requester.address,
        ctx.provider.address,
        25,
        25,
        E("0.5"),
        E("9.5"),
      );

    const credit = await ctx.inference.getCredit(creditId);
    expect(credit.active).to.equal(false);
    expect(credit.escrow).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E("99.5"));
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E("0.5"));
    await expect(ctx.inference.connect(ctx.requester).closeCredit(creditId)).to.be
      .revertedWith("inference: credit inactive");
    await expect(
      ctx.inference.connect(ctx.requester).settleUsage(creditId, 26, 25),
    ).to.be.revertedWith("inference: credit inactive");
  });

  it("conserves requester funds across concurrent credits, payments, and refunds", async () => {
    const ctx = await deploy();
    const offerId = await createOffer(ctx);
    const first = await openCredit(ctx, E(10), ctx.requester, offerId);
    const second = await openCredit(ctx, E(7), ctx.requester2, offerId);
    const marketAddress = await ctx.inference.getAddress();
    const totalBefore =
      (await ctx.token.balanceOf(ctx.requester.address)) +
      (await ctx.token.balanceOf(ctx.requester2.address)) +
      (await ctx.token.balanceOf(ctx.provider.address)) +
      (await ctx.token.balanceOf(marketAddress));

    await ctx.inference.connect(ctx.requester).settleUsage(first.creditId, 100, 100);
    await ctx.inference.connect(ctx.requester2).settleUsage(second.creditId, 50, 50);

    const firstCredit = await ctx.inference.getCredit(first.creditId);
    const secondCredit = await ctx.inference.getCredit(second.creditId);
    expect(await ctx.token.balanceOf(marketAddress)).to.equal(
      firstCredit.escrow + secondCredit.escrow,
    );

    await ctx.inference.connect(ctx.requester).closeCredit(first.creditId);
    await ctx.inference.connect(ctx.requester2).closeCredit(second.creditId);

    const totalAfter =
      (await ctx.token.balanceOf(ctx.requester.address)) +
      (await ctx.token.balanceOf(ctx.requester2.address)) +
      (await ctx.token.balanceOf(ctx.provider.address)) +
      (await ctx.token.balanceOf(marketAddress));
    expect(totalAfter).to.equal(totalBefore);
    expect(await ctx.token.balanceOf(marketAddress)).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(3));
  });
});
