// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProviderRegistry
/// @notice Tracks compute providers: their stake (collateral), the portion bonded
///         to active tasks, an on-chain reputation score, declared capabilities,
///         and slashing. Economic mutations (bond/unbond/slash/reputation) are
///         restricted to authorized protocol contracts (JobMarket, Verification).
contract ProviderRegistry is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Reputation is scaled 0..10000 (=0.00%..100.00%). New providers start neutral.
    uint256 public constant REP_SCALE = 10_000;
    uint256 public constant REP_START = 5_000;

    /// @notice EMA smoothing factor denominator: rep = (rep*(K-1) + target)/K.
    uint256 public constant REP_EMA_K = 5;

    IERC20 public immutable token;

    /// @notice Minimum total stake required to be eligible to claim tasks.
    uint256 public minStake;

    struct Provider {
        bool registered;
        bool active;
        uint256 stake; // total staked collateral
        uint256 bonded; // portion locked against active tasks
        uint256 reputation; // 0..REP_SCALE, EMA of outcomes
        uint64 completed;
        uint64 failed;
        string capabilities; // free-form JSON: GPU model, VRAM, CPU, etc.
    }

    mapping(address => Provider) public providers;
    mapping(address => bool) public authorized; // protocol contracts allowed to mutate economics

    /// @notice Structured, attested hardware capability for a provider. Proves the
    ///         advertised GPU via a benchmark or attestation challenge answered off chain
    ///         and recorded here by the trusted attester.
    struct Attestation {
        uint64 attestedAt;
        uint32 vramGB;
        uint256 benchmarkScore;
        string gpuModel;
    }

    mapping(address => Attestation) public attestations;
    /// @notice Address permitted to record attestations (the challenge verifier).
    address public attester;
    /// @notice Attestation is considered fresh for this long.
    uint256 public attestationTtl = 7 days;

    enum ChallengeStatus {
        None,
        Open,
        Responded,
        Passed,
        Failed,
        Lapsed
    }

    /// @notice A benchmark challenge issued by the attester. The provider must answer
    ///         with the seeded output hash and a measured score before the deadline.
    struct Challenge {
        address provider;
        bytes32 seed;
        uint64 issuedAt;
        uint64 deadline;
        uint64 respondedAt;
        ChallengeStatus status;
        uint256 score;
        bytes32 outputHash;
    }

    mapping(uint256 => Challenge) public challenges;
    /// @notice Open (unresolved) challenge per provider, 0 when none.
    mapping(address => uint256) public openChallenge;
    uint256 public nextChallengeId = 1;
    /// @notice Time a provider has to answer a challenge. The attester has the same
    ///         window after the deadline to judge an answer before it lapses.
    uint256 public challengeWindow = 15 minutes;
    /// @notice Free stake slashed when a provider fails or misses a challenge.
    uint256 public challengeSlash;
    /// @notice Recipient of challenge slashes.
    address public treasury;

    event ProviderRegistered(address indexed provider, string capabilities);
    event CapabilitiesUpdated(address indexed provider, string capabilities);
    event Staked(address indexed provider, uint256 amount, uint256 totalStake);
    event Unstaked(address indexed provider, uint256 amount, uint256 totalStake);
    event Bonded(address indexed provider, uint256 amount, uint256 totalBonded);
    event Unbonded(address indexed provider, uint256 amount, uint256 totalBonded);
    event Slashed(address indexed provider, uint256 amount, address indexed beneficiary);
    event ReputationUpdated(address indexed provider, uint256 reputation, bool success);
    event AuthorizedSet(address indexed account, bool allowed);
    event ActiveSet(address indexed provider, bool active);
    event AttesterSet(address indexed attester);
    event Attested(address indexed provider, string gpuModel, uint32 vramGB, uint256 benchmarkScore);
    event AttestationRevoked(address indexed provider);
    event TreasurySet(address indexed treasury);
    event ChallengeParamsSet(uint256 window, uint256 slashAmount);
    event ChallengeIssued(uint256 indexed id, address indexed provider, bytes32 seed, uint64 deadline);
    event ChallengeResponded(uint256 indexed id, address indexed provider, uint256 score, bytes32 outputHash);
    event ChallengeResolved(uint256 indexed id, address indexed provider, ChallengeStatus status, uint256 slashed);

    constructor(IERC20 token_, uint256 minStake_, address owner_) Ownable(owner_) {
        token = token_;
        minStake = minStake_;
        treasury = owner_;
        challengeSlash = minStake_ / 5;
    }

    modifier onlyAuthorized() {
        require(authorized[msg.sender], "registry: not authorized");
        _;
    }

    // --------------------------------------------------------------------- //
    // Admin
    // --------------------------------------------------------------------- //

    function setAuthorized(address account, bool allowed) external onlyOwner {
        authorized[account] = allowed;
        emit AuthorizedSet(account, allowed);
    }

    function setMinStake(uint256 value) external onlyOwner {
        minStake = value;
    }

    function setAttester(address account) external onlyOwner {
        attester = account;
        emit AttesterSet(account);
    }

    function setAttestationTtl(uint256 value) external onlyOwner {
        attestationTtl = value;
    }

    function setTreasury(address account) external onlyOwner {
        require(account != address(0), "registry: zero treasury");
        treasury = account;
        emit TreasurySet(account);
    }

    function setChallengeParams(uint256 window, uint256 slashAmount) external onlyOwner {
        require(window > 0, "registry: zero window");
        challengeWindow = window;
        challengeSlash = slashAmount;
        emit ChallengeParamsSet(window, slashAmount);
    }

    /// @notice Record a passed hardware attestation for a provider. Only the attester
    ///         (the challenge verifier) may call this.
    function attest(
        address provider,
        string calldata gpuModel,
        uint32 vramGB,
        uint256 benchmarkScore
    ) external {
        require(msg.sender == attester, "registry: not attester");
        require(providers[provider].registered, "registry: not registered");
        attestations[provider] = Attestation({
            attestedAt: uint64(block.timestamp),
            vramGB: vramGB,
            benchmarkScore: benchmarkScore,
            gpuModel: gpuModel
        });
        emit Attested(provider, gpuModel, vramGB, benchmarkScore);
    }

    /// @notice Whether a provider has a fresh attestation on record.
    function isAttested(address who) public view returns (bool) {
        uint64 at = attestations[who].attestedAt;
        return at != 0 && block.timestamp <= uint256(at) + attestationTtl;
    }

    // --------------------------------------------------------------------- //
    // Benchmark challenges
    // --------------------------------------------------------------------- //

    /// @notice Issue a benchmark challenge to an attested provider. The seed comes
    ///         from chain randomness so the provider cannot precompute the answer.
    function issueChallenge(address provider) external returns (uint256 id) {
        require(msg.sender == attester, "registry: not attester");
        require(attestations[provider].attestedAt != 0, "registry: not attested");
        require(openChallenge[provider] == 0, "registry: challenge open");
        id = nextChallengeId++;
        bytes32 seed = keccak256(abi.encode(block.prevrandao, provider, id));
        uint64 deadline = uint64(block.timestamp + challengeWindow);
        challenges[id] = Challenge({
            provider: provider,
            seed: seed,
            issuedAt: uint64(block.timestamp),
            deadline: deadline,
            respondedAt: 0,
            status: ChallengeStatus.Open,
            score: 0,
            outputHash: bytes32(0)
        });
        openChallenge[provider] = id;
        emit ChallengeIssued(id, provider, seed, deadline);
    }

    /// @notice Answer an open challenge with the seeded output hash and measured score.
    function respondChallenge(uint256 id, uint256 score, bytes32 outputHash) external {
        Challenge storage c = challenges[id];
        require(c.provider == msg.sender, "registry: not challenged");
        require(c.status == ChallengeStatus.Open, "registry: not open");
        require(block.timestamp <= c.deadline, "registry: deadline passed");
        c.status = ChallengeStatus.Responded;
        c.respondedAt = uint64(block.timestamp);
        c.score = score;
        c.outputHash = outputHash;
        emit ChallengeResponded(id, msg.sender, score, outputHash);
    }

    /// @notice Judge an answered challenge. The attester recomputes the output hash
    ///         off chain and compares the score to the attested benchmark. A pass
    ///         refreshes the attestation; a fail slashes free stake and revokes it.
    function resolveChallenge(uint256 id, bool passed) external {
        require(msg.sender == attester, "registry: not attester");
        Challenge storage c = challenges[id];
        require(c.status == ChallengeStatus.Responded, "registry: not responded");
        require(block.timestamp <= uint256(c.deadline) + challengeWindow, "registry: judging lapsed");
        if (passed) {
            c.status = ChallengeStatus.Passed;
            openChallenge[c.provider] = 0;
            attestations[c.provider].attestedAt = uint64(block.timestamp);
            _recordOutcome(c.provider, true);
            emit ChallengeResolved(id, c.provider, ChallengeStatus.Passed, 0);
        } else {
            _failChallenge(id, c);
        }
    }

    /// @notice Close a challenge whose window ran out. Anyone may call it. A missed
    ///         deadline fails the provider with no trusted input; an answer the
    ///         attester never judged lapses without penalty.
    function expireChallenge(uint256 id) external {
        Challenge storage c = challenges[id];
        if (c.status == ChallengeStatus.Open) {
            require(block.timestamp > c.deadline, "registry: not expired");
            _failChallenge(id, c);
        } else {
            require(c.status == ChallengeStatus.Responded, "registry: not open");
            require(block.timestamp > uint256(c.deadline) + challengeWindow, "registry: not expired");
            c.status = ChallengeStatus.Lapsed;
            openChallenge[c.provider] = 0;
            emit ChallengeResolved(id, c.provider, ChallengeStatus.Lapsed, 0);
        }
    }

    /// @dev Slashes only free stake, so bonds held by active leases and tasks stay whole.
    function _failChallenge(uint256 id, Challenge storage c) internal {
        address who = c.provider;
        c.status = ChallengeStatus.Failed;
        openChallenge[who] = 0;
        attestations[who].attestedAt = 0;
        Provider storage p = providers[who];
        uint256 free = p.stake - p.bonded;
        uint256 amt = challengeSlash > free ? free : challengeSlash;
        p.stake -= amt;
        _recordOutcome(who, false);
        emit AttestationRevoked(who);
        emit ChallengeResolved(id, who, ChallengeStatus.Failed, amt);
        if (amt > 0) {
            token.safeTransfer(treasury, amt);
            emit Slashed(who, amt, treasury);
        }
    }

    // --------------------------------------------------------------------- //
    // Provider actions
    // --------------------------------------------------------------------- //

    function register(string calldata capabilities) external {
        Provider storage p = providers[msg.sender];
        require(!p.registered, "registry: already registered");
        p.registered = true;
        p.active = true;
        p.reputation = REP_START;
        p.capabilities = capabilities;
        emit ProviderRegistered(msg.sender, capabilities);
    }

    function updateCapabilities(string calldata capabilities) external {
        require(providers[msg.sender].registered, "registry: not registered");
        providers[msg.sender].capabilities = capabilities;
        emit CapabilitiesUpdated(msg.sender, capabilities);
    }

    function setActive(bool active) external {
        require(providers[msg.sender].registered, "registry: not registered");
        providers[msg.sender].active = active;
        emit ActiveSet(msg.sender, active);
    }

    function stake(uint256 amount) external {
        Provider storage p = providers[msg.sender];
        require(p.registered, "registry: register first");
        require(amount > 0, "registry: zero");
        token.safeTransferFrom(msg.sender, address(this), amount);
        p.stake += amount;
        emit Staked(msg.sender, amount, p.stake);
    }

    function unstake(uint256 amount) external {
        Provider storage p = providers[msg.sender];
        require(openChallenge[msg.sender] == 0, "registry: challenge open");
        require(availableStake(msg.sender) >= amount, "registry: exceeds free stake");
        p.stake -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, p.stake);
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    /// @notice Stake not currently bonded to an active task.
    function availableStake(address who) public view returns (uint256) {
        Provider storage p = providers[who];
        return p.stake - p.bonded;
    }

    /// @notice Whether `who` may claim tasks: registered, active, and meets minStake.
    function isEligible(address who) external view returns (bool) {
        Provider storage p = providers[who];
        return p.registered && p.active && p.stake >= minStake;
    }

    function reputationOf(address who) external view returns (uint256) {
        return providers[who].reputation;
    }

    // --------------------------------------------------------------------- //
    // Authorized economic mutations (called by JobMarket / Verification)
    // --------------------------------------------------------------------- //

    function bond(address who, uint256 amount) external onlyAuthorized {
        Provider storage p = providers[who];
        require(availableStake(who) >= amount, "registry: insufficient free stake");
        p.bonded += amount;
        emit Bonded(who, amount, p.bonded);
    }

    function unbond(address who, uint256 amount) external onlyAuthorized {
        Provider storage p = providers[who];
        require(p.bonded >= amount, "registry: unbond exceeds bonded");
        p.bonded -= amount;
        emit Unbonded(who, amount, p.bonded);
    }

    /// @notice Slash up to `amount` from a provider's stake, sending it to `beneficiary`.
    ///         Bonded accounting is reduced first.
    function slash(address who, uint256 amount, address beneficiary) external onlyAuthorized {
        Provider storage p = providers[who];
        uint256 amt = amount > p.stake ? p.stake : amount;
        if (p.bonded >= amt) {
            p.bonded -= amt;
        } else {
            p.bonded = 0;
        }
        p.stake -= amt;
        if (amt > 0 && beneficiary != address(0)) {
            token.safeTransfer(beneficiary, amt);
        }
        emit Slashed(who, amt, beneficiary);
    }

    /// @notice Update reputation via EMA toward 100% (success) or 0% (failure).
    function recordOutcome(address who, bool success) external onlyAuthorized {
        _recordOutcome(who, success);
    }

    function _recordOutcome(address who, bool success) internal {
        Provider storage p = providers[who];
        uint256 target = success ? REP_SCALE : 0;
        p.reputation = (p.reputation * (REP_EMA_K - 1) + target) / REP_EMA_K;
        if (success) {
            p.completed += 1;
        } else {
            p.failed += 1;
        }
        emit ReputationUpdated(who, p.reputation, success);
    }
}
