// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/// @title RentalMarket
/// @notice The primary market: time-based leases of provider compute (GPU or CPU),
///         used to run anything including LLM inference and fine-tuning. A rented
///         result cannot be re-executed and checked, so trust is availability based:
///         the provider stakes and posts a heartbeat each interval, escrow streams to
///         the provider only for intervals it kept alive, unused time is refunded, and
///         missed heartbeats (downtime) let anyone terminate the lease and slash the
///         provider for the SLA breach.
/// @dev    Reuses SmeshToken for escrow and ProviderRegistry for stake, attestation,
///         reputation, and slashing. Must be authorized in the registry.
contract RentalMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    ProviderRegistry public immutable registry;

    /// @notice Stake bonded by the provider for the duration of a lease.
    uint256 public bondPerLease = 50 ether;
    /// @notice Extra time beyond one interval before a missing heartbeat is a breach.
    uint256 public graceSecs = 5 minutes;

    enum LeaseStatus {
        Active,
        Ended,
        Terminated
    }

    struct Listing {
        address provider;
        uint256 pricePerInterval; // in SMESH base units
        uint64 intervalSecs;
        uint32 minIntervals;
        uint32 maxIntervals;
        bool active;
        string spec; // JSON: gpu model, vram, region, served models, etc.
    }

    struct Lease {
        uint256 listingId;
        address requester;
        address provider;
        uint256 pricePerInterval;
        uint64 intervalSecs;
        uint64 start;
        uint64 lastHeartbeat;
        uint32 fundedIntervals;
        uint32 settledIntervals;
        uint256 escrow; // remaining funds held for this lease
        uint256 bond;
        LeaseStatus status;
    }

    uint256 public nextListingId = 1;
    uint256 public nextLeaseId = 1;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Lease) public leases;

    event ListingCreated(uint256 indexed listingId, address indexed provider, uint256 pricePerInterval, uint64 intervalSecs, string spec);
    event ListingActiveSet(uint256 indexed listingId, bool active);
    event LeaseOpened(uint256 indexed leaseId, uint256 indexed listingId, address indexed requester, address provider, uint32 fundedIntervals, uint256 escrow);
    event Heartbeat(uint256 indexed leaseId, address indexed provider, uint64 timestamp);
    event IntervalSettled(uint256 indexed leaseId, address indexed provider, uint32 intervals, uint256 amount);
    event LeaseExtended(uint256 indexed leaseId, uint32 addedIntervals, uint256 addedEscrow);
    event LeaseEnded(uint256 indexed leaseId, uint256 refunded);
    event LeaseTerminated(uint256 indexed leaseId, uint256 slashed, uint256 refunded);

    constructor(IERC20 token_, ProviderRegistry registry_, address owner_) Ownable(owner_) {
        token = token_;
        registry = registry_;
    }

    // --------------------------------------------------------------------- //
    // Admin
    // --------------------------------------------------------------------- //

    function setBondPerLease(uint256 v) external onlyOwner {
        bondPerLease = v;
    }

    function setGraceSecs(uint256 v) external onlyOwner {
        graceSecs = v;
    }

    // --------------------------------------------------------------------- //
    // Provider: listings
    // --------------------------------------------------------------------- //

    function createListing(
        uint256 pricePerInterval,
        uint64 intervalSecs,
        uint32 minIntervals,
        uint32 maxIntervals,
        string calldata spec
    ) external returns (uint256 listingId) {
        require(pricePerInterval > 0, "rental: zero price");
        require(intervalSecs > 0, "rental: zero interval");
        require(minIntervals >= 1 && minIntervals <= maxIntervals, "rental: bad bounds");
        require(registry.isEligible(msg.sender), "rental: not eligible");
        require(registry.isAttested(msg.sender), "rental: not attested");

        listingId = nextListingId++;
        listings[listingId] = Listing({
            provider: msg.sender,
            pricePerInterval: pricePerInterval,
            intervalSecs: intervalSecs,
            minIntervals: minIntervals,
            maxIntervals: maxIntervals,
            active: true,
            spec: spec
        });
        emit ListingCreated(listingId, msg.sender, pricePerInterval, intervalSecs, spec);
    }

    function setListingActive(uint256 listingId, bool active) external {
        Listing storage l = listings[listingId];
        require(l.provider == msg.sender, "rental: not your listing");
        l.active = active;
        emit ListingActiveSet(listingId, active);
    }

    // --------------------------------------------------------------------- //
    // Requester: leases
    // --------------------------------------------------------------------- //

    function openLease(uint256 listingId, uint32 intervals) external nonReentrant returns (uint256 leaseId) {
        Listing storage lst = listings[listingId];
        require(lst.provider != address(0) && lst.active, "rental: listing unavailable");
        require(intervals >= lst.minIntervals && intervals <= lst.maxIntervals, "rental: bad duration");
        require(registry.isEligible(lst.provider), "rental: provider ineligible");
        require(registry.isAttested(lst.provider), "rental: provider unattested");

        uint256 escrow = lst.pricePerInterval * uint256(intervals);
        token.safeTransferFrom(msg.sender, address(this), escrow);
        registry.bond(lst.provider, bondPerLease);

        leaseId = nextLeaseId++;
        leases[leaseId] = Lease({
            listingId: listingId,
            requester: msg.sender,
            provider: lst.provider,
            pricePerInterval: lst.pricePerInterval,
            intervalSecs: lst.intervalSecs,
            start: uint64(block.timestamp),
            lastHeartbeat: uint64(block.timestamp),
            fundedIntervals: intervals,
            settledIntervals: 0,
            escrow: escrow,
            bond: bondPerLease,
            status: LeaseStatus.Active
        });
        emit LeaseOpened(leaseId, listingId, msg.sender, lst.provider, intervals, escrow);
    }

    /// @notice Provider proves the lease is live for the current interval.
    function heartbeat(uint256 leaseId) external {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        require(l.provider == msg.sender, "rental: not provider");
        l.lastHeartbeat = uint64(block.timestamp);
        emit Heartbeat(leaseId, msg.sender, l.lastHeartbeat);
    }

    /// @notice Add more funded intervals to an active lease.
    function extendLease(uint256 leaseId, uint32 moreIntervals) external nonReentrant {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        require(l.requester == msg.sender, "rental: not renter");
        require(moreIntervals > 0, "rental: zero");
        uint256 add = l.pricePerInterval * uint256(moreIntervals);
        token.safeTransferFrom(msg.sender, address(this), add);
        l.fundedIntervals += moreIntervals;
        l.escrow += add;
        emit LeaseExtended(leaseId, moreIntervals, add);
    }

    /// @notice Release payment for every interval the provider has kept alive.
    ///         Callable by anyone.
    function settle(uint256 leaseId) public nonReentrant {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        _settle(leaseId, l);
    }

    /// @notice Renter ends the lease. Served intervals are paid, unused time refunded.
    function endLease(uint256 leaseId) external nonReentrant {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        require(l.requester == msg.sender, "rental: not renter");
        _settle(leaseId, l);
        uint256 refund = l.escrow;
        l.escrow = 0;
        l.status = LeaseStatus.Ended;
        registry.unbond(l.provider, l.bond);
        registry.recordOutcome(l.provider, true);
        if (refund > 0) {
            token.safeTransfer(l.requester, refund);
        }
        emit LeaseEnded(leaseId, refund);
    }

    /// @notice Finalize a lease whose funded time is fully served and paid.
    function finalizeExpired(uint256 leaseId) external nonReentrant {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        _settle(leaseId, l);
        require(l.settledIntervals == l.fundedIntervals, "rental: not fully served");
        uint256 refund = l.escrow; // should be zero
        l.escrow = 0;
        l.status = LeaseStatus.Ended;
        registry.unbond(l.provider, l.bond);
        registry.recordOutcome(l.provider, true);
        if (refund > 0) {
            token.safeTransfer(l.requester, refund);
        }
        emit LeaseEnded(leaseId, refund);
    }

    /// @notice Terminate a lease whose provider stopped sending heartbeats (downtime).
    ///         Served time is paid, unused time refunded, and the provider bond is
    ///         slashed to the renter for the SLA breach. Callable by anyone.
    function terminate(uint256 leaseId) external nonReentrant {
        Lease storage l = leases[leaseId];
        require(l.status == LeaseStatus.Active, "rental: not active");
        require(
            block.timestamp > uint256(l.lastHeartbeat) + uint256(l.intervalSecs) + graceSecs,
            "rental: provider still live"
        );
        _settle(leaseId, l);
        uint256 refund = l.escrow;
        uint256 bond = l.bond;
        l.escrow = 0;
        l.status = LeaseStatus.Terminated;
        registry.slash(l.provider, bond, l.requester);
        registry.recordOutcome(l.provider, false);
        if (refund > 0) {
            token.safeTransfer(l.requester, refund);
        }
        emit LeaseTerminated(leaseId, bond, refund);
    }

    // --------------------------------------------------------------------- //
    // Internal
    // --------------------------------------------------------------------- //

    function _settle(uint256 leaseId, Lease storage l) internal {
        uint32 served = _servedIntervals(l);
        if (served > l.settledIntervals) {
            uint32 due = served - l.settledIntervals;
            uint256 amount = uint256(due) * l.pricePerInterval;
            l.settledIntervals = served;
            l.escrow -= amount;
            token.safeTransfer(l.provider, amount);
            emit IntervalSettled(leaseId, l.provider, due, amount);
        }
    }

    function _servedIntervals(Lease storage l) internal view returns (uint32) {
        uint256 coverageEnd = uint256(l.lastHeartbeat) + uint256(l.intervalSecs) + graceSecs;
        uint256 servedUntil = block.timestamp < coverageEnd ? block.timestamp : coverageEnd;
        if (servedUntil <= l.start) {
            return 0;
        }
        uint256 served = (servedUntil - uint256(l.start)) / uint256(l.intervalSecs);
        if (served > l.fundedIntervals) {
            served = l.fundedIntervals;
        }
        return uint32(served);
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getLease(uint256 leaseId) external view returns (Lease memory) {
        return leases[leaseId];
    }

    /// @notice Intervals served (and payable) so far for a lease.
    function servedIntervals(uint256 leaseId) external view returns (uint32) {
        return _servedIntervals(leases[leaseId]);
    }

    /// @notice Whether a lease is currently past its downtime deadline.
    function isDown(uint256 leaseId) external view returns (bool) {
        Lease storage l = leases[leaseId];
        if (l.status != LeaseStatus.Active) return false;
        return block.timestamp > uint256(l.lastHeartbeat) + uint256(l.intervalSecs) + graceSecs;
    }
}
