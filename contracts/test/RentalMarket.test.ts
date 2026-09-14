import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E = (n: string | number) => ethers.parseEther(String(n));
const HOUR = 3600;

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

    await token.transfer(requester.address, E(1000));
    await token.transfer(provider.address, E(200));
    await token.transfer(requester2.address, E(1000));
    await token.transfer(provider2.address, E(200));
    await token.transfer(stranger.address, E(200));

    return { owner, requester, provider, requester2, provider2, stranger, token, registry, rental };
  }

  async function readyProvider(ctx: any, provider: any) {
    await ctx.registry.connect(provider).register('{"gpu":"RTX4090"}');
    await ctx.token.connect(provider).approve(await ctx.registry.getAddress(), E(100));
    await ctx.registry.connect(provider).stake(E(100));
    await ctx.registry.connect(ctx.owner).attest(provider.address, "RTX4090", 24, 1000);
  }

  it("streams escrow per interval, then refunds the unused remainder on end", async () => {
    const ctx = await deploy();
    const { requester, provider, token, rental, registry } = ctx;
    await readyProvider(ctx, provider);

    const listingId = await rental.nextListingId();
    await rental.connect(provider).createListing(E(1), HOUR, 1, 100, '{"gpu":"RTX4090","region":"us-east"}');

    await token.connect(requester).approve(await rental.getAddress(), E(1000));
    const leaseId = await rental.nextLeaseId();
    await rental.connect(requester).openLease(listingId, 10); // escrow 10

    // Three intervals pass; provider keeps the lease alive, then it settles.
    await time.increase(3 * HOUR);
    await rental.connect(provider).heartbeat(leaseId);
    await rental.settle(leaseId);

    // Provider paid for 3 served intervals: 200 - 100 stake + 3 = 103.
    expect(await token.balanceOf(provider.address)).to.equal(E(103));
    let lease = await rental.getLease(leaseId);
    expect(lease.settledIntervals).to.equal(3n);

    // Renter ends the lease: unused 7 intervals refunded.
    await rental.connect(requester).endLease(leaseId);
    expect(await token.balanceOf(requester.address)).to.equal(E(997)); // 1000 - 10 + 7
    lease = await rental.getLease(leaseId);
    expect(Number(lease.status)).to.equal(1); // Ended
    expect(await registry.availableStake(provider.address)).to.equal(E(100)); // bond released
    expect(await registry.reputationOf(provider.address)).to.equal(6000n);
  });

  it("terminates a lease on provider downtime and slashes the bond to the renter", async () => {
    const ctx = await deploy();
    const { requester2, provider2, token, rental, registry } = ctx;
    await readyProvider(ctx, provider2);

    const listingId = await rental.nextListingId();
    await rental.connect(provider2).createListing(E(1), HOUR, 1, 100, '{"gpu":"RTX4090"}');

    await token.connect(requester2).approve(await rental.getAddress(), E(1000));
    const leaseId = await rental.nextLeaseId();
    await rental.connect(requester2).openLease(listingId, 10);

    // Provider never sends a heartbeat. Coverage ends at start + interval + grace.
    await time.increase(HOUR + 2000); // ~1h33m: 1 interval served, then down
    expect(await rental.isDown(leaseId)).to.equal(true);
    await rental.connect(requester2).terminate(leaseId);

    // Provider paid for the 1 covered interval, then slashed 50 bond.
    expect(await token.balanceOf(provider2.address)).to.equal(E(101)); // 100 + 1
    // Renter: 1000 - 10 escrow + 9 refund + 50 slash = 1049.
    expect(await token.balanceOf(requester2.address)).to.equal(E(1049));
    expect(await registry.availableStake(provider2.address)).to.equal(E(50)); // 100 - 50 slashed
    const lease = await rental.getLease(leaseId);
    expect(Number(lease.status)).to.equal(2); // Terminated
    expect(await registry.reputationOf(provider2.address)).to.equal(4000n);
  });

  it("blocks listings from unattested or ineligible providers", async () => {
    const ctx = await deploy();
    const { registry, token, rental, stranger } = ctx;

    // Registered and staked, but never attested.
    await registry.connect(stranger).register('{"gpu":"?"}');
    await token.connect(stranger).approve(await registry.getAddress(), E(100));
    await registry.connect(stranger).stake(E(100));

    await expect(
      rental.connect(stranger).createListing(E(1), HOUR, 1, 10, "{}")
    ).to.be.revertedWith("rental: not attested");
  });

  it("only the provider can heartbeat, and duration bounds are enforced", async () => {
    const ctx = await deploy();
    const { requester, provider, token, rental } = ctx;
    await readyProvider(ctx, provider);
    const listingId = await rental.nextListingId();
    await rental.connect(provider).createListing(E(1), HOUR, 2, 5, "{}");

    await token.connect(requester).approve(await rental.getAddress(), E(1000));
    await expect(rental.connect(requester).openLease(listingId, 1)).to.be.revertedWith("rental: bad duration");
    await expect(rental.connect(requester).openLease(listingId, 6)).to.be.revertedWith("rental: bad duration");

    const leaseId = await rental.nextLeaseId();
    await rental.connect(requester).openLease(listingId, 3);
    await expect(rental.connect(requester).heartbeat(leaseId)).to.be.revertedWith("rental: not provider");
  });
});
