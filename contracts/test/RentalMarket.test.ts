import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const E = (n: string | number) => ethers.parseEther(String(n));
const HOUR = 3600;
const MANIFEST = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q";

enum Status {
  Pending,
  Active,
  Ended,
  Terminated,
  Rejected,
  Cancelled,
}

describe("RentalMarket", () => {
  async function deploy() {
    const [owner, requester, provider, requester2, provider2, stranger] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SmeshToken");
    const token = await Token.deploy(E(1_000_000), owner.address);

    const Registry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Registry.deploy(await token.getAddress(), E(50), owner.address);

    const Rental = await ethers.getContractFactory("RentalMarket");
    const rental = await Rental.deploy(await token.getAddress(), await registry.getAddress(), owner.address);

    await registry.setAuthorized(await rental.getAddress(), true);
    await registry.setAttester(owner.address);

    for (const account of [requester, requester2]) await token.transfer(account.address, E(1000));
    for (const account of [provider, provider2, stranger]) await token.transfer(account.address, E(200));

    return { owner, requester, provider, requester2, provider2, stranger, token, registry, rental };
  }

  async function readyProvider(ctx: Awaited<ReturnType<typeof deploy>>, provider = ctx.provider) {
    await ctx.registry.connect(provider).register('{"gpu":"RTX4090"}');
    await ctx.token.connect(provider).approve(await ctx.registry.getAddress(), E(100));
    await ctx.registry.connect(provider).stake(E(100));
    await ctx.registry.connect(ctx.owner).attest(provider.address, "RTX4090", 24, 1000);
  }

  async function createListing(
    ctx: Awaited<ReturnType<typeof deploy>>,
    minIntervals = 1,
    maxIntervals = 10,
  ) {
    const listingId = await ctx.rental.nextListingId();
    await expect(
      ctx.rental
        .connect(ctx.provider)
        .createListing(E(1), HOUR, minIntervals, maxIntervals, '{"gpu":"RTX4090"}'),
    )
      .to.emit(ctx.rental, "ListingCreated")
      .withArgs(
        listingId,
        ctx.provider.address,
        E(1),
        HOUR,
        minIntervals,
        maxIntervals,
        '{"gpu":"RTX4090"}',
      );
    return listingId;
  }

  async function request(
    ctx: Awaited<ReturnType<typeof deploy>>,
    listingId: bigint,
    intervals = 3,
    requester = ctx.requester,
  ) {
    await ctx.token.connect(requester).approve(await ctx.rental.getAddress(), E(1000));
    const leaseId = await ctx.rental.nextLeaseId();
    await ctx.rental.connect(requester).requestLease(listingId, intervals, MANIFEST);
    return leaseId;
  }

  async function activeLease(ctx: Awaited<ReturnType<typeof deploy>>, intervals = 3, maxIntervals = 10) {
    await readyProvider(ctx);
    const listingId = await createListing(ctx, 1, maxIntervals);
    const leaseId = await request(ctx, listingId, intervals);
    await ctx.rental.connect(ctx.provider).acceptLease(leaseId);
    return { listingId, leaseId };
  }

  it("creates a funded pending request bound to a non-empty manifest", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx, 2, 5);
    await ctx.token.connect(ctx.requester).approve(await ctx.rental.getAddress(), E(1000));
    const leaseId = await ctx.rental.nextLeaseId();

    await expect(ctx.rental.connect(ctx.requester).requestLease(listingId, 3, MANIFEST))
      .to.emit(ctx.rental, "LeaseRequested")
      .withArgs(leaseId, listingId, ctx.requester.address, ctx.provider.address, 3, E(3), MANIFEST);

    const lease = await ctx.rental.getLease(leaseId);
    expect(lease.status).to.equal(Status.Pending);
    expect(lease.manifest).to.equal(MANIFEST);
    expect(lease.start).to.equal(0);
    expect(lease.bond).to.equal(0);
    expect(lease.escrow).to.equal(E(3));
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(997));
    expect(await ctx.registry.availableStake(ctx.provider.address)).to.equal(E(100));

    await expect(ctx.rental.connect(ctx.requester).requestLease(listingId, 3, "")).to.be.revertedWith(
      "rental: empty manifest",
    );
    await expect(ctx.rental.connect(ctx.requester).requestLease(listingId, 1, MANIFEST)).to.be.revertedWith(
      "rental: bad duration",
    );
  });

  it("sets start, bond, and listing reservation only when the provider accepts", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx);
    const leaseId = await request(ctx, listingId);

    await expect(ctx.rental.connect(ctx.provider).acceptLease(leaseId))
      .to.emit(ctx.rental, "LeaseAccepted")
      .and.to.emit(ctx.rental, "ListingAvailabilityChanged")
      .withArgs(listingId, false, leaseId);

    const lease = await ctx.rental.getLease(leaseId);
    const listing = await ctx.rental.getListing(listingId);
    expect(lease.status).to.equal(Status.Active);
    expect(lease.start).not.to.equal(0);
    expect(lease.bond).to.equal(E(50));
    expect(listing.available).to.equal(false);
    expect(listing.activeLeaseId).to.equal(leaseId);
    expect(await ctx.registry.availableStake(ctx.provider.address)).to.equal(E(50));
  });

  it("lets the provider reject and refunds all pending escrow", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx);
    const leaseId = await request(ctx, listingId);

    await expect(ctx.rental.connect(ctx.provider).rejectLease(leaseId))
      .to.emit(ctx.rental, "LeaseRejected")
      .withArgs(leaseId, ctx.provider.address, E(3));

    expect((await ctx.rental.getLease(leaseId)).status).to.equal(Status.Rejected);
    expect((await ctx.rental.getLease(leaseId)).escrow).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(1000));
    expect((await ctx.rental.getListing(listingId)).available).to.equal(true);
  });

  it("lets the requester cancel and refunds all pending escrow", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx);
    const leaseId = await request(ctx, listingId);

    await expect(ctx.rental.connect(ctx.requester).cancelLease(leaseId))
      .to.emit(ctx.rental, "LeaseCancelled")
      .withArgs(leaseId, ctx.requester.address, E(3));

    expect((await ctx.rental.getLease(leaseId)).status).to.equal(Status.Cancelled);
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(1000));
    expect(await ctx.registry.availableStake(ctx.provider.address)).to.equal(E(100));
  });

  it("prevents concurrent accepted leases and restores availability on end", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx);
    const firstLeaseId = await request(ctx, listingId);
    const secondLeaseId = await request(ctx, listingId, 2, ctx.requester2);
    await ctx.rental.connect(ctx.provider).acceptLease(firstLeaseId);

    await expect(ctx.rental.connect(ctx.provider).acceptLease(secondLeaseId)).to.be.revertedWith(
      "rental: listing unavailable",
    );
    await expect(ctx.rental.connect(ctx.requester2).requestLease(listingId, 2, MANIFEST)).to.be.revertedWith(
      "rental: listing unavailable",
    );

    await expect(ctx.rental.connect(ctx.requester).endLease(firstLeaseId))
      .to.emit(ctx.rental, "ListingAvailabilityChanged")
      .withArgs(listingId, true, firstLeaseId);
    expect((await ctx.rental.getListing(listingId)).activeLeaseId).to.equal(0);

    await ctx.rental.connect(ctx.provider).acceptLease(secondLeaseId);
    expect((await ctx.rental.getLease(secondLeaseId)).status).to.equal(Status.Active);
  });

  it("records one heartbeat per interval and rejects retroactive coverage", async () => {
    const ctx = await deploy();
    const { leaseId } = await activeLease(ctx);
    const lease = await ctx.rental.getLease(leaseId);

    await time.increaseTo(lease.start + BigInt(HOUR + 1));
    await expect(ctx.rental.connect(ctx.provider).heartbeat(leaseId)).to.be.revertedWith(
      "rental: interval missed",
    );
    expect(await ctx.rental.payableIntervals(leaseId)).to.equal(0);
    await ctx.rental.settle(leaseId);
    expect((await ctx.rental.getLease(leaseId)).settledIntervals).to.equal(0);
  });

  it("settles only completed intervals in the contiguous heartbeat prefix", async () => {
    const ctx = await deploy();
    const { leaseId } = await activeLease(ctx);
    let lease = await ctx.rental.getLease(leaseId);

    await expect(ctx.rental.connect(ctx.provider).heartbeat(leaseId))
      .to.emit(ctx.rental, "Heartbeat")
      .withArgs(leaseId, ctx.provider.address, 0, anyValue);
    await expect(ctx.rental.connect(ctx.provider).heartbeat(leaseId)).to.be.revertedWith(
      "rental: already heartbeated",
    );
    await ctx.rental.settle(leaseId);
    expect((await ctx.rental.getLease(leaseId)).settledIntervals).to.equal(0);

    await time.increaseTo(lease.start + BigInt(HOUR + 1));
    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);
    expect(await ctx.rental.heartbeatAt(leaseId, 1)).not.to.equal(0);
    await ctx.rental.settle(leaseId);
    lease = await ctx.rental.getLease(leaseId);
    expect(lease.settledIntervals).to.equal(1);
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(101));

    await time.increaseTo(lease.start + BigInt(2 * HOUR + 1));
    await ctx.rental.settle(leaseId);
    expect((await ctx.rental.getLease(leaseId)).settledIntervals).to.equal(2);
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(102));
  });

  it("rejects expired heartbeats and finalizes a fully served lease", async () => {
    const ctx = await deploy();
    const { listingId, leaseId } = await activeLease(ctx, 2);
    let lease = await ctx.rental.getLease(leaseId);
    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);

    await time.increaseTo(lease.start + BigInt(HOUR + 1));
    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);
    await expect(ctx.rental.finalizeExpired(leaseId)).to.be.revertedWith("rental: not fully served");

    await time.increaseTo(lease.start + BigInt(2 * HOUR + 1));
    await expect(ctx.rental.connect(ctx.provider).heartbeat(leaseId)).to.be.revertedWith(
      "rental: lease expired",
    );
    await expect(ctx.rental.finalizeExpired(leaseId))
      .to.emit(ctx.rental, "LeaseEnded")
      .withArgs(leaseId, 0);

    lease = await ctx.rental.getLease(leaseId);
    expect(lease.status).to.equal(Status.Ended);
    expect(lease.settledIntervals).to.equal(2);
    expect(lease.escrow).to.equal(0);
    expect((await ctx.rental.getListing(listingId)).available).to.equal(true);
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(102));
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(998));
    expect(await ctx.token.balanceOf(await ctx.rental.getAddress())).to.equal(0);
    expect(await ctx.registry.availableStake(ctx.provider.address)).to.equal(E(100));
    expect(await ctx.registry.reputationOf(ctx.provider.address)).to.equal(6000);
  });

  it("conserves rental escrow across interval payment and early-end refund", async () => {
    const ctx = await deploy();
    const { leaseId } = await activeLease(ctx, 3);
    const lease = await ctx.rental.getLease(leaseId);
    const rentalAddress = await ctx.rental.getAddress();
    const totalBefore =
      (await ctx.token.balanceOf(ctx.requester.address)) +
      (await ctx.token.balanceOf(ctx.provider.address)) +
      (await ctx.token.balanceOf(rentalAddress));

    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);
    await time.increaseTo(lease.start + BigInt(HOUR + 1));
    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);
    await time.increaseTo(lease.start + BigInt(2 * HOUR + 1));
    await expect(ctx.rental.connect(ctx.requester).endLease(leaseId))
      .to.emit(ctx.rental, "IntervalSettled")
      .withArgs(leaseId, ctx.provider.address, 2, E(2))
      .and.to.emit(ctx.rental, "LeaseEnded")
      .withArgs(leaseId, E(1));

    const totalAfter =
      (await ctx.token.balanceOf(ctx.requester.address)) +
      (await ctx.token.balanceOf(ctx.provider.address)) +
      (await ctx.token.balanceOf(rentalAddress));
    expect(totalAfter).to.equal(totalBefore);
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(998));
    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(102));
    expect(await ctx.token.balanceOf(rentalAddress)).to.equal(0);
  });

  it("terminates at the first missed deadline, pays the prefix, refunds, and slashes", async () => {
    const ctx = await deploy();
    const { listingId, leaseId } = await activeLease(ctx);
    const lease = await ctx.rental.getLease(leaseId);
    await ctx.rental.connect(ctx.provider).heartbeat(leaseId);

    await time.increaseTo(lease.start + BigInt(2 * HOUR + 301));
    expect(await ctx.rental.isDown(leaseId)).to.equal(true);
    await expect(ctx.rental.connect(ctx.stranger).terminate(leaseId))
      .to.emit(ctx.rental, "LeaseTerminated")
      .withArgs(leaseId, E(50), E(2));

    expect(await ctx.token.balanceOf(ctx.provider.address)).to.equal(E(101));
    expect(await ctx.token.balanceOf(ctx.requester.address)).to.equal(E(1049));
    expect(await ctx.registry.availableStake(ctx.provider.address)).to.equal(E(50));
    expect((await ctx.rental.getLease(leaseId)).status).to.equal(Status.Terminated);
    expect((await ctx.rental.getListing(listingId)).available).to.equal(true);
    expect(await ctx.registry.reputationOf(ctx.provider.address)).to.equal(4000);
  });

  it("does not allow extensions beyond the listing maximum duration", async () => {
    const ctx = await deploy();
    const { leaseId } = await activeLease(ctx, 2, 3);
    await ctx.token.connect(ctx.requester).approve(await ctx.rental.getAddress(), E(10));

    await expect(ctx.rental.connect(ctx.requester).extendLease(leaseId, 1))
      .to.emit(ctx.rental, "LeaseExtended")
      .withArgs(leaseId, 1, E(1));
    expect((await ctx.rental.getLease(leaseId)).fundedIntervals).to.equal(3);
    await expect(ctx.rental.connect(ctx.requester).extendLease(leaseId, 1)).to.be.revertedWith(
      "rental: exceeds max duration",
    );
  });

  it("enforces lifecycle authorization", async () => {
    const ctx = await deploy();
    await readyProvider(ctx);
    const listingId = await createListing(ctx);
    const leaseId = await request(ctx, listingId);

    await expect(ctx.rental.connect(ctx.stranger).acceptLease(leaseId)).to.be.revertedWith("rental: not provider");
    await expect(ctx.rental.connect(ctx.stranger).rejectLease(leaseId)).to.be.revertedWith("rental: not provider");
    await expect(ctx.rental.connect(ctx.stranger).cancelLease(leaseId)).to.be.revertedWith("rental: not requester");
    await ctx.rental.connect(ctx.provider).acceptLease(leaseId);
    await expect(ctx.rental.connect(ctx.requester).heartbeat(leaseId)).to.be.revertedWith("rental: not provider");
    await expect(ctx.rental.connect(ctx.stranger).extendLease(leaseId, 1)).to.be.revertedWith("rental: not requester");
    await expect(ctx.rental.connect(ctx.stranger).endLease(leaseId)).to.be.revertedWith("rental: not requester");
    await expect(ctx.rental.connect(ctx.provider).setListingAvailable(listingId, true)).to.be.revertedWith(
      "rental: listing reserved",
    );
    await expect(ctx.rental.connect(ctx.stranger).setListingAvailable(listingId, true)).to.be.revertedWith(
      "rental: not your listing",
    );
  });

  it("blocks listings from unattested providers", async () => {
    const ctx = await deploy();
    await ctx.registry.connect(ctx.stranger).register('{"gpu":"?"}');
    await ctx.token.connect(ctx.stranger).approve(await ctx.registry.getAddress(), E(100));
    await ctx.registry.connect(ctx.stranger).stake(E(100));

    await expect(
      ctx.rental.connect(ctx.stranger).createListing(E(1), HOUR, 1, 10, "{}"),
    ).to.be.revertedWith("rental: not attested");
  });
});
