// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {JobMarket} from "./JobMarket.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/// @title Verification
/// @notice Implements the optimistic verification game: eligible providers act as
///         "challengers" and independently re-execute a submitted task, then commit
///         their result hash. Votes are tallied as agree/disagree versus the original
///         provider's committed hash. After the vote window, the majority decides the
///         outcome and JobMarket pays the honest party or slashes the cheater.
/// @dev    v0 uses on-chain plaintext hash votes with simple majority. Planned upgrades
///         (P2): commit-reveal to prevent copying, reputation-weighted vote power and
///         randomized challenger selection, SSIM/perceptual tolerance for GPU renders,
///         and a monetary verifier reward funded from a job fee.
contract Verification is Ownable {
    JobMarket public immutable market;
    ProviderRegistry public immutable registry;

    /// @notice How long challengers may vote after a dispute is opened.
    uint256 public voteWindow = 30 minutes;
    /// @notice Minimum number of disagreeing votes required to uphold a cheating claim.
    uint256 public quorum = 1;

    struct Dispute {
        bool opened;
        bool resolved;
        bytes32 providerHash;
        uint64 deadline;
        uint32 agree;
        uint32 disagree;
        address firstDisagree; // beneficiary of the slash if cheating is upheld
    }

    mapping(bytes32 => Dispute) internal disputes;
    mapping(bytes32 => mapping(address => bool)) internal voted;

    event DisputeOpened(uint256 indexed jobId, uint32 indexed index, address indexed provider, bytes32 providerHash);
    event ChallengeVote(uint256 indexed jobId, uint32 indexed index, address indexed challenger, bool agree);
    event DisputeResolved(uint256 indexed jobId, uint32 indexed index, bool cheatingUpheld);

    constructor(JobMarket market_, ProviderRegistry registry_, address owner_) Ownable(owner_) {
        market = market_;
        registry = registry_;
    }

    function setVoteWindow(uint256 v) external onlyOwner {
        voteWindow = v;
    }

    function setQuorum(uint256 v) external onlyOwner {
        quorum = v;
    }

    function _key(uint256 jobId, uint32 index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(jobId, index));
    }

    /// @notice Challenge a submitted task by committing an independently computed hash.
    ///         The first challenge opens the dispute and freezes optimistic payout.
    function challenge(uint256 jobId, uint32 index, bytes32 challengerHash) external {
        require(registry.isEligible(msg.sender), "verify: not eligible");

        JobMarket.Task memory t = market.getTask(jobId, index);
        require(t.provider != msg.sender, "verify: cannot self-challenge");

        bytes32 k = _key(jobId, index);
        Dispute storage d = disputes[k];
        require(!d.resolved, "verify: already resolved");
        require(!voted[k][msg.sender], "verify: already voted");

        if (!d.opened) {
            require(t.status == JobMarket.TaskStatus.Submitted, "verify: task not submitted");
            require(
                block.timestamp < uint256(t.submittedAt) + market.challengeWindow(),
                "verify: challenge window closed"
            );
            d.opened = true;
            d.providerHash = t.resultHash;
            d.deadline = uint64(block.timestamp + voteWindow);
            market.markDisputed(jobId, index);
            emit DisputeOpened(jobId, index, t.provider, t.resultHash);
        } else {
            require(block.timestamp <= d.deadline, "verify: vote window closed");
        }

        voted[k][msg.sender] = true;
        bool agree = (challengerHash == d.providerHash);
        if (agree) {
            d.agree += 1;
        } else {
            d.disagree += 1;
            if (d.firstDisagree == address(0)) {
                d.firstDisagree = msg.sender;
            }
        }
        emit ChallengeVote(jobId, index, msg.sender, agree);
    }

    /// @notice After the vote window, resolve the dispute by simple majority.
    function resolve(uint256 jobId, uint32 index) external {
        bytes32 k = _key(jobId, index);
        Dispute storage d = disputes[k];
        require(d.opened && !d.resolved, "verify: nothing to resolve");
        require(block.timestamp > d.deadline, "verify: vote window open");
        d.resolved = true;

        bool cheated = (d.disagree > d.agree) && (d.disagree >= quorum);
        if (cheated) {
            address beneficiary = d.firstDisagree;
            market.resolveCheating(jobId, index, beneficiary);
            if (beneficiary != address(0)) {
                registry.recordOutcome(beneficiary, true);
            }
        } else {
            market.resolveHonest(jobId, index);
            if (d.firstDisagree != address(0)) {
                registry.recordOutcome(d.firstDisagree, false);
            }
        }
        emit DisputeResolved(jobId, index, cheated);
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    function getDispute(uint256 jobId, uint32 index)
        external
        view
        returns (bool opened, bool resolved, bytes32 providerHash, uint64 deadline, uint32 agree, uint32 disagree, address firstDisagree)
    {
        Dispute storage d = disputes[_key(jobId, index)];
        return (d.opened, d.resolved, d.providerHash, d.deadline, d.agree, d.disagree, d.firstDisagree);
    }

    function hasVoted(uint256 jobId, uint32 index, address who) external view returns (bool) {
        return voted[_key(jobId, index)][who];
    }
}
