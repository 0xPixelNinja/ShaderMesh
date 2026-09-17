// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/// @title JobMarket
/// @notice Core marketplace: requesters post jobs (funds locked in escrow), which are
///         divided into independent tasks (frames/tiles). Providers claim tasks (bonding
///         stake), run them off-chain, and submit a result commitment (hash + IPFS CID).
///         Payment settles optimistically after a challenge window unless the Verification
///         contract flags a dispute.
/// @dev    Off-chain work (rendering, containers) happens on provider agents. On-chain we
///         only store commitments and move value. The Verification contract is the only
///         address permitted to force dispute outcomes.
contract JobMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    ProviderRegistry public immutable registry;

    /// @notice Stake bonded by a provider per claimed task (at risk of slashing).
    uint256 public bondPerTask = 10 ether;
    /// @notice Optimistic challenge window (seconds) after a result is submitted.
    uint256 public challengeWindow = 1 hours;
    /// @notice Time a provider has to submit after claiming before the task can be reclaimed.
    uint256 public claimTimeout = 1 hours;

    /// @notice Verification contract allowed to drive dispute outcomes.
    address public verification;

    enum TaskStatus {
        Open, // 0 - available to claim
        Claimed, // 1 - a provider is working on it
        Submitted, // 2 - result committed, in challenge window
        Disputed, // 3 - under challenge in Verification
        Paid, // 4 - settled, provider paid
        Failed // 5 - reserved
    }

    struct Job {
        address requester;
        string inputCID; // IPFS CID of scene/inputs + manifest
        uint32 taskCount; // number of independent tasks (frames/tiles)
        uint32 completedTasks;
        uint256 rewardPerTask; // paid to provider per verified task
        uint8 verificationPolicy; // 0 = exact keccak256, 1 = perceptual/off-chain assisted
        bool exists;
    }

    struct Task {
        address provider;
        bytes32 resultHash; // commitment to the output
        string outputCID; // IPFS CID of the produced artifact
        TaskStatus status;
        uint256 bond;
        uint64 claimedAt;
        uint64 submittedAt;
    }

    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => mapping(uint32 => Task)) public tasks;

    event JobPosted(
        uint256 indexed jobId,
        address indexed requester,
        string inputCID,
        uint32 taskCount,
        uint256 rewardPerTask,
        uint8 verificationPolicy
    );
    event TaskClaimed(uint256 indexed jobId, uint32 indexed index, address indexed provider, uint256 bond);
    event ResultSubmitted(uint256 indexed jobId, uint32 indexed index, address indexed provider, bytes32 resultHash, string outputCID);
    event TaskPaid(uint256 indexed jobId, uint32 indexed index, address indexed provider, uint256 reward);
    event TaskSlashed(uint256 indexed jobId, uint32 indexed index, address indexed provider, address beneficiary);
    event TaskReopened(uint256 indexed jobId, uint32 indexed index);
    event JobCompleted(uint256 indexed jobId);

    constructor(IERC20 token_, ProviderRegistry registry_, address owner_) Ownable(owner_) {
        token = token_;
        registry = registry_;
    }

    modifier onlyVerification() {
        require(msg.sender == verification, "market: only verification");
        _;
    }

    // --------------------------------------------------------------------- //
    // Admin
    // --------------------------------------------------------------------- //

    function setVerification(address v) external onlyOwner {
        verification = v;
    }

    function setBondPerTask(uint256 v) external onlyOwner {
        bondPerTask = v;
    }

    function setChallengeWindow(uint256 v) external onlyOwner {
        challengeWindow = v;
    }

    function setClaimTimeout(uint256 v) external onlyOwner {
        claimTimeout = v;
    }

    // --------------------------------------------------------------------- //
    // Requester flow
    // --------------------------------------------------------------------- //

    /// @notice Post a job and lock `rewardPerTask * taskCount` tokens in escrow.
    function postJob(
        string calldata inputCID,
        uint32 taskCount,
        uint256 rewardPerTask,
        uint8 verificationPolicy
    ) external nonReentrant returns (uint256 jobId) {
        require(taskCount > 0, "market: no tasks");
        require(rewardPerTask > 0, "market: zero reward");
        require(verificationPolicy <= 1, "market: bad verification policy");

        uint256 escrow = rewardPerTask * uint256(taskCount);
        token.safeTransferFrom(msg.sender, address(this), escrow);

        jobId = nextJobId++;
        jobs[jobId] = Job({
            requester: msg.sender,
            inputCID: inputCID,
            taskCount: taskCount,
            completedTasks: 0,
            rewardPerTask: rewardPerTask,
            verificationPolicy: verificationPolicy,
            exists: true
        });
        // Tasks default to TaskStatus.Open (enum value 0).
        emit JobPosted(jobId, msg.sender, inputCID, taskCount, rewardPerTask, verificationPolicy);
    }

    // --------------------------------------------------------------------- //
    // Provider flow
    // --------------------------------------------------------------------- //

    function claimTask(uint256 jobId, uint32 index) external nonReentrant {
        Job storage j = jobs[jobId];
        require(j.exists, "market: no job");
        require(index < j.taskCount, "market: bad index");
        require(registry.isEligible(msg.sender), "market: not eligible");

        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Open, "market: not open");

        registry.bond(msg.sender, bondPerTask);
        t.provider = msg.sender;
        t.status = TaskStatus.Claimed;
        t.bond = bondPerTask;
        t.claimedAt = uint64(block.timestamp);

        emit TaskClaimed(jobId, index, msg.sender, bondPerTask);
    }

    function submitResult(
        uint256 jobId,
        uint32 index,
        bytes32 resultHash,
        string calldata outputCID
    ) external {
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Claimed, "market: not claimed");
        require(t.provider == msg.sender, "market: not your task");
        require(resultHash != bytes32(0), "market: empty result");

        t.resultHash = resultHash;
        t.outputCID = outputCID;
        t.status = TaskStatus.Submitted;
        t.submittedAt = uint64(block.timestamp);

        emit ResultSubmitted(jobId, index, msg.sender, resultHash, outputCID);
    }

    /// @notice After the challenge window with no upheld dispute, settle and pay.
    ///         Callable by anyone (typically the provider or orchestrator).
    function finalizeTask(uint256 jobId, uint32 index) external nonReentrant {
        Job storage j = jobs[jobId];
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Submitted, "market: not submitted");
        require(block.timestamp >= t.submittedAt + challengeWindow, "market: window open");
        _payAndRelease(jobId, index, j, t);
    }

    /// @notice Reopen a task whose provider claimed but never submitted in time; the
    ///         abandoning provider's bond is slashed to the requester.
    function reclaimTimedOut(uint256 jobId, uint32 index) external nonReentrant {
        Job storage j = jobs[jobId];
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Claimed, "market: not claimed");
        require(block.timestamp > t.claimedAt + claimTimeout, "market: not timed out");

        address bad = t.provider;
        uint256 bond = t.bond;
        _reset(t);
        registry.slash(bad, bond, j.requester);
        registry.recordOutcome(bad, false);
        emit TaskSlashed(jobId, index, bad, j.requester);
        emit TaskReopened(jobId, index);
    }

    // --------------------------------------------------------------------- //
    // Verification-driven outcomes
    // --------------------------------------------------------------------- //

    function markDisputed(uint256 jobId, uint32 index) external onlyVerification {
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Submitted, "market: not submitted");
        t.status = TaskStatus.Disputed;
    }

    /// @notice Verification upheld cheating: slash the provider's bond to `beneficiary`
    ///         (typically the challenger) and reopen the task for re-execution.
    function resolveCheating(uint256 jobId, uint32 index, address beneficiary) external onlyVerification nonReentrant {
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Disputed || t.status == TaskStatus.Submitted, "market: bad state");
        address bad = t.provider;
        uint256 bond = t.bond;
        _reset(t);
        registry.slash(bad, bond, beneficiary);
        registry.recordOutcome(bad, false);
        emit TaskSlashed(jobId, index, bad, beneficiary);
        emit TaskReopened(jobId, index);
    }

    /// @notice Verification vindicated the provider: pay out as normal.
    function resolveHonest(uint256 jobId, uint32 index) external onlyVerification nonReentrant {
        Job storage j = jobs[jobId];
        Task storage t = tasks[jobId][index];
        require(t.status == TaskStatus.Disputed || t.status == TaskStatus.Submitted, "market: bad state");
        _payAndRelease(jobId, index, j, t);
    }

    // --------------------------------------------------------------------- //
    // Internal
    // --------------------------------------------------------------------- //

    function _payAndRelease(uint256 jobId, uint32 index, Job storage j, Task storage t) internal {
        address provider = t.provider;
        uint256 bond = t.bond;
        uint256 reward = j.rewardPerTask;

        t.status = TaskStatus.Paid;
        registry.unbond(provider, bond);
        registry.recordOutcome(provider, true);

        j.completedTasks += 1;
        token.safeTransfer(provider, reward);
        emit TaskPaid(jobId, index, provider, reward);

        if (j.completedTasks == j.taskCount) {
            emit JobCompleted(jobId);
        }
    }

    function _reset(Task storage t) internal {
        t.provider = address(0);
        t.resultHash = bytes32(0);
        t.outputCID = "";
        t.status = TaskStatus.Open;
        t.bond = 0;
        t.claimedAt = 0;
        t.submittedAt = 0;
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    function getTask(uint256 jobId, uint32 index) external view returns (Task memory) {
        return tasks[jobId][index];
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
