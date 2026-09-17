// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/// @title RentalMarket
/// @notice Time-based compute leases backed by requester escrow, provider stake,
///         and explicit per-interval availability evidence.
/// @dev Must be authorized in ProviderRegistry to bond and slash provider stake.
contract RentalMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    ProviderRegistry public immutable registry;

    uint256 public bondPerLease = 50 ether;
    uint256 public graceSecs = 5 minutes;

    enum LeaseStatus {
        Pending,
        Active,
        Ended,
        Terminated,
        Rejected,
        Cancelled
    }

    struct Listing {
        address provider;
        uint256 pricePerInterval;
        uint64 intervalSecs;
        uint32 minIntervals;
        uint32 maxIntervals;
        bool available;
        uint256 activeLeaseId;
        string spec;
    }

    struct Lease {
        uint256 listingId;
        address requester;
        address provider;
        uint256 pricePerInterval;
        uint64 intervalSecs;
        uint64 start;
        uint32 fundedIntervals;
        uint32 maxIntervals;
        uint32 heartbeatedIntervals;
        uint32 settledIntervals;
        uint256 escrow;
        uint256 bond;
        LeaseStatus status;
        string manifest;
    }

    uint256 public nextListingId = 1;
    uint256 public nextLeaseId = 1;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Lease) public leases;
    mapping(uint256 => mapping(uint32 => uint64)) public heartbeatAt;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed provider,
        uint256 pricePerInterval,
        uint64 intervalSecs,
        uint32 minIntervals,
        uint32 maxIntervals,
        string spec
    );
    event ListingAvailabilityChanged(uint256 indexed listingId, bool available, uint256 indexed leaseId);
    event LeaseRequested(
        uint256 indexed leaseId,
        uint256 indexed listingId,
        address indexed requester,
        address provider,
        uint32 fundedIntervals,
        uint256 escrow,
        string manifest
    );
    event LeaseAccepted(uint256 indexed leaseId, address indexed provider, uint64 start, uint256 bond);
    event LeaseRejected(uint256 indexed leaseId, address indexed provider, uint256 refunded);
    event LeaseCancelled(uint256 indexed leaseId, address indexed requester, uint256 refunded);
    event Heartbeat(uint256 indexed leaseId, address indexed provider, uint32 indexed interval, uint64 timestamp);
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

    function setBondPerLease(uint256 value) external onlyOwner {
        bondPerLease = value;
    }

    function setGraceSecs(uint256 value) external onlyOwner {
        graceSecs = value;
    }

    // --------------------------------------------------------------------- //
    // Listings
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
            available: true,
            activeLeaseId: 0,
            spec: spec
        });
        emit ListingCreated(
            listingId,
            msg.sender,
            pricePerInterval,
            intervalSecs,
            minIntervals,
            maxIntervals,
            spec
        );
    }

    function setListingAvailable(uint256 listingId, bool available) external {
        Listing storage listing = listings[listingId];
        require(listing.provider == msg.sender, "rental: not your listing");
        require(listing.activeLeaseId == 0, "rental: listing reserved");
        listing.available = available;
        emit ListingAvailabilityChanged(listingId, available, 0);
    }

    // --------------------------------------------------------------------- //
    // Lease requests
    // --------------------------------------------------------------------- //

    function requestLease(
        uint256 listingId,
        uint32 intervals,
        string calldata manifest
    ) external nonReentrant returns (uint256 leaseId) {
        Listing storage listing = listings[listingId];
        require(listing.provider != address(0) && listing.available, "rental: listing unavailable");
        require(intervals >= listing.minIntervals && intervals <= listing.maxIntervals, "rental: bad duration");
        require(bytes(manifest).length > 0, "rental: empty manifest");
        require(registry.isEligible(listing.provider), "rental: provider ineligible");
        require(registry.isAttested(listing.provider), "rental: provider unattested");

        uint256 escrow = listing.pricePerInterval * uint256(intervals);
        leaseId = nextLeaseId++;
        leases[leaseId] = Lease({
            listingId: listingId,
            requester: msg.sender,
            provider: listing.provider,
            pricePerInterval: listing.pricePerInterval,
            intervalSecs: listing.intervalSecs,
            start: 0,
            fundedIntervals: intervals,
            maxIntervals: listing.maxIntervals,
            heartbeatedIntervals: 0,
            settledIntervals: 0,
            escrow: escrow,
            bond: 0,
            status: LeaseStatus.Pending,
            manifest: manifest
        });

        token.safeTransferFrom(msg.sender, address(this), escrow);
        emit LeaseRequested(leaseId, listingId, msg.sender, listing.provider, intervals, escrow, manifest);
    }

    function acceptLease(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Pending, "rental: not pending");
        require(lease.provider == msg.sender, "rental: not provider");

        Listing storage listing = listings[lease.listingId];
        require(listing.available && listing.activeLeaseId == 0, "rental: listing unavailable");
        require(registry.isEligible(msg.sender), "rental: provider ineligible");
        require(registry.isAttested(msg.sender), "rental: provider unattested");

        uint256 bond = bondPerLease;
        uint64 start = uint64(block.timestamp);
        lease.status = LeaseStatus.Active;
        lease.start = start;
        lease.bond = bond;
        listing.available = false;
        listing.activeLeaseId = leaseId;

        registry.bond(msg.sender, bond);
        emit ListingAvailabilityChanged(lease.listingId, false, leaseId);
        emit LeaseAccepted(leaseId, msg.sender, start, bond);
    }

    function rejectLease(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Pending, "rental: not pending");
        require(lease.provider == msg.sender, "rental: not provider");

        uint256 refund = lease.escrow;
        lease.escrow = 0;
        lease.status = LeaseStatus.Rejected;

        token.safeTransfer(lease.requester, refund);
        emit LeaseRejected(leaseId, msg.sender, refund);
    }

    function cancelLease(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Pending, "rental: not pending");
        require(lease.requester == msg.sender, "rental: not requester");

        uint256 refund = lease.escrow;
        lease.escrow = 0;
        lease.status = LeaseStatus.Cancelled;

        token.safeTransfer(msg.sender, refund);
        emit LeaseCancelled(leaseId, msg.sender, refund);
    }

    // --------------------------------------------------------------------- //
    // Active leases
    // --------------------------------------------------------------------- //

    /// @notice Record evidence for the current interval. A missed interval cannot
    ///         be covered by a later heartbeat.
    function heartbeat(uint256 leaseId) external {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");
        require(lease.provider == msg.sender, "rental: not provider");

        uint256 currentInterval = (block.timestamp - uint256(lease.start)) / uint256(lease.intervalSecs);
        require(currentInterval < lease.fundedIntervals, "rental: lease expired");
        uint32 interval = uint32(currentInterval);
        require(heartbeatAt[leaseId][interval] == 0, "rental: already heartbeated");
        require(interval == lease.heartbeatedIntervals, "rental: interval missed");

        uint64 timestamp = uint64(block.timestamp);
        heartbeatAt[leaseId][interval] = timestamp;
        lease.heartbeatedIntervals = interval + 1;
        emit Heartbeat(leaseId, msg.sender, interval, timestamp);
    }

    function extendLease(uint256 leaseId, uint32 moreIntervals) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");
        require(lease.requester == msg.sender, "rental: not requester");
        require(moreIntervals > 0, "rental: zero");
        require(
            uint256(lease.fundedIntervals) + uint256(moreIntervals) <= uint256(lease.maxIntervals),
            "rental: exceeds max duration"
        );

        uint256 addedEscrow = lease.pricePerInterval * uint256(moreIntervals);
        lease.fundedIntervals += moreIntervals;
        lease.escrow += addedEscrow;

        token.safeTransferFrom(msg.sender, address(this), addedEscrow);
        emit LeaseExtended(leaseId, moreIntervals, addedEscrow);
    }

    /// @notice Pay all completed intervals in the contiguous heartbeated prefix.
    function settle(uint256 leaseId) public nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");
        (uint32 due, uint256 amount) = _accrue(lease);
        if (amount > 0) {
            token.safeTransfer(lease.provider, amount);
            emit IntervalSettled(leaseId, lease.provider, due, amount);
        }
    }

    /// @notice The requester voluntarily ends a lease. Completed heartbeated
    ///         intervals are paid and all remaining escrow is refunded.
    function endLease(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");
        require(lease.requester == msg.sender, "rental: not requester");

        (uint32 due, uint256 payment) = _accrue(lease);
        uint256 refund = lease.escrow;
        lease.escrow = 0;
        lease.status = LeaseStatus.Ended;
        _releaseListing(lease.listingId, leaseId);

        registry.unbond(lease.provider, lease.bond);
        registry.recordOutcome(lease.provider, true);
        if (payment > 0) {
            token.safeTransfer(lease.provider, payment);
            emit IntervalSettled(leaseId, lease.provider, due, payment);
        }
        if (refund > 0) token.safeTransfer(lease.requester, refund);
        emit LeaseEnded(leaseId, refund);
    }

    /// @notice Finalize a lease after every funded interval has completed and
    ///         has explicit heartbeat evidence.
    function finalizeExpired(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");

        (uint32 due, uint256 payment) = _accrue(lease);
        require(lease.settledIntervals == lease.fundedIntervals, "rental: not fully served");
        uint256 refund = lease.escrow;
        lease.escrow = 0;
        lease.status = LeaseStatus.Ended;
        _releaseListing(lease.listingId, leaseId);

        registry.unbond(lease.provider, lease.bond);
        registry.recordOutcome(lease.provider, true);
        if (payment > 0) {
            token.safeTransfer(lease.provider, payment);
            emit IntervalSettled(leaseId, lease.provider, due, payment);
        }
        if (refund > 0) token.safeTransfer(lease.requester, refund);
        emit LeaseEnded(leaseId, refund);
    }

    /// @notice Terminate after the first unheartbeated interval ends plus grace.
    ///         Only the prior contiguous heartbeated intervals are payable.
    function terminate(uint256 leaseId) external nonReentrant {
        Lease storage lease = leases[leaseId];
        require(lease.status == LeaseStatus.Active, "rental: not active");
        require(_isDown(lease), "rental: provider still live");

        (uint32 due, uint256 payment) = _accrue(lease);
        uint256 refund = lease.escrow;
        uint256 bond = lease.bond;
        lease.escrow = 0;
        lease.status = LeaseStatus.Terminated;
        _releaseListing(lease.listingId, leaseId);

        registry.slash(lease.provider, bond, lease.requester);
        registry.recordOutcome(lease.provider, false);
        if (payment > 0) {
            token.safeTransfer(lease.provider, payment);
            emit IntervalSettled(leaseId, lease.provider, due, payment);
        }
        if (refund > 0) token.safeTransfer(lease.requester, refund);
        emit LeaseTerminated(leaseId, bond, refund);
    }

    // --------------------------------------------------------------------- //
    // Internal
    // --------------------------------------------------------------------- //

    function _accrue(Lease storage lease) internal returns (uint32 due, uint256 amount) {
        uint32 payableCount = _payableIntervals(lease);
        if (payableCount > lease.settledIntervals) {
            due = payableCount - lease.settledIntervals;
            amount = uint256(due) * lease.pricePerInterval;
            lease.settledIntervals = payableCount;
            lease.escrow -= amount;
        }
    }

    function _payableIntervals(Lease storage lease) internal view returns (uint32) {
        if (lease.start == 0) return 0;
        uint256 completed = (block.timestamp - uint256(lease.start)) / uint256(lease.intervalSecs);
        if (completed > lease.fundedIntervals) completed = lease.fundedIntervals;
        if (completed > lease.heartbeatedIntervals) completed = lease.heartbeatedIntervals;
        return uint32(completed);
    }

    function _isDown(Lease storage lease) internal view returns (bool) {
        if (lease.status != LeaseStatus.Active || lease.heartbeatedIntervals >= lease.fundedIntervals) return false;
        uint256 deadline = uint256(lease.start)
            + (uint256(lease.heartbeatedIntervals) + 1) * uint256(lease.intervalSecs)
            + graceSecs;
        return block.timestamp > deadline;
    }

    function _releaseListing(uint256 listingId, uint256 leaseId) internal {
        Listing storage listing = listings[listingId];
        require(listing.activeLeaseId == leaseId, "rental: reservation mismatch");
        listing.activeLeaseId = 0;
        listing.available = true;
        emit ListingAvailabilityChanged(listingId, true, leaseId);
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

    function payableIntervals(uint256 leaseId) external view returns (uint32) {
        return _payableIntervals(leases[leaseId]);
    }

    function isDown(uint256 leaseId) external view returns (bool) {
        return _isDown(leases[leaseId]);
    }
}
