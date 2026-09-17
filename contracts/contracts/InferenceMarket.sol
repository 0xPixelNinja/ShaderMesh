// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/// @title InferenceMarket
/// @notice Prepaid, requester-metered credits for managed model inference.
contract InferenceMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    ProviderRegistry public immutable registry;

    struct Offer {
        address provider;
        uint256 pricePerToken;
        bool active;
        string modelIdentifier;
    }

    struct Credit {
        uint256 offerId;
        address requester;
        address provider;
        uint256 pricePerToken;
        uint256 escrow;
        uint256 paid;
        uint256 promptTokens;
        uint256 completionTokens;
        bool active;
    }

    uint256 public nextOfferId = 1;
    uint256 public nextCreditId = 1;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => Credit) public credits;

    event OfferCreated(
        uint256 indexed offerId,
        address indexed provider,
        string modelIdentifier,
        uint256 pricePerToken
    );
    event OfferDeactivated(uint256 indexed offerId, address indexed provider);
    event CreditOpened(
        uint256 indexed creditId,
        uint256 indexed offerId,
        address indexed requester,
        address provider,
        uint256 pricePerToken,
        uint256 escrow
    );
    event UsageSettled(
        uint256 indexed creditId,
        address indexed requester,
        address indexed provider,
        uint256 promptTokens,
        uint256 completionTokens,
        uint256 billedTokens,
        uint256 payment,
        uint256 remainingEscrow
    );
    event CreditClosed(
        uint256 indexed creditId,
        address indexed requester,
        address indexed provider,
        uint256 promptTokens,
        uint256 completionTokens,
        uint256 totalPaid,
        uint256 refund
    );

    constructor(IERC20 token_, ProviderRegistry registry_) {
        token = token_;
        registry = registry_;
    }

    function createOffer(
        string calldata modelIdentifier,
        uint256 pricePerToken
    ) external returns (uint256 offerId) {
        require(bytes(modelIdentifier).length > 0, "inference: empty model");
        require(pricePerToken > 0, "inference: zero price");
        require(registry.isEligible(msg.sender), "inference: not eligible");
        require(registry.isAttested(msg.sender), "inference: not attested");

        offerId = nextOfferId++;
        offers[offerId] = Offer({
            provider: msg.sender,
            pricePerToken: pricePerToken,
            active: true,
            modelIdentifier: modelIdentifier
        });

        emit OfferCreated(offerId, msg.sender, modelIdentifier, pricePerToken);
    }

    function deactivateOffer(uint256 offerId) external {
        Offer storage offer = offers[offerId];
        require(offer.provider == msg.sender, "inference: not provider");
        require(offer.active, "inference: offer inactive");

        offer.active = false;
        emit OfferDeactivated(offerId, msg.sender);
    }

    function openCredit(
        uint256 offerId,
        uint256 escrow
    ) external nonReentrant returns (uint256 creditId) {
        Offer storage offer = offers[offerId];
        require(offer.provider != address(0) && offer.active, "inference: offer inactive");
        require(escrow > 0, "inference: zero escrow");
        require(registry.isEligible(offer.provider), "inference: provider ineligible");
        require(registry.isAttested(offer.provider), "inference: provider unattested");

        creditId = nextCreditId++;
        credits[creditId] = Credit({
            offerId: offerId,
            requester: msg.sender,
            provider: offer.provider,
            pricePerToken: offer.pricePerToken,
            escrow: escrow,
            paid: 0,
            promptTokens: 0,
            completionTokens: 0,
            active: true
        });

        token.safeTransferFrom(msg.sender, address(this), escrow);
        emit CreditOpened(
            creditId,
            offerId,
            msg.sender,
            offer.provider,
            offer.pricePerToken,
            escrow
        );
    }

    /// @notice Record cumulative usage. Replaying the latest counters pays zero.
    function settleUsage(
        uint256 creditId,
        uint256 cumulativePromptTokens,
        uint256 cumulativeCompletionTokens
    ) external nonReentrant {
        Credit storage credit = credits[creditId];
        require(credit.active, "inference: credit inactive");
        require(credit.requester == msg.sender, "inference: not requester");
        require(cumulativePromptTokens >= credit.promptTokens, "inference: prompt decreased");
        require(
            cumulativeCompletionTokens >= credit.completionTokens,
            "inference: completion decreased"
        );

        uint256 billedTokens = (cumulativePromptTokens - credit.promptTokens)
            + (cumulativeCompletionTokens - credit.completionTokens);
        uint256 payment = billedTokens * credit.pricePerToken;
        require(payment <= credit.escrow, "inference: exceeds escrow");

        credit.promptTokens = cumulativePromptTokens;
        credit.completionTokens = cumulativeCompletionTokens;
        credit.escrow -= payment;
        credit.paid += payment;

        if (payment > 0) token.safeTransfer(credit.provider, payment);
        emit UsageSettled(
            creditId,
            msg.sender,
            credit.provider,
            cumulativePromptTokens,
            cumulativeCompletionTokens,
            billedTokens,
            payment,
            credit.escrow
        );
    }

    function closeCredit(uint256 creditId) external nonReentrant {
        Credit storage credit = credits[creditId];
        require(credit.active, "inference: credit inactive");
        require(credit.requester == msg.sender, "inference: not requester");

        uint256 refund = credit.escrow;
        credit.escrow = 0;
        credit.active = false;

        if (refund > 0) token.safeTransfer(msg.sender, refund);
        emit CreditClosed(
            creditId,
            msg.sender,
            credit.provider,
            credit.promptTokens,
            credit.completionTokens,
            credit.paid,
            refund
        );
    }

    function getOffer(uint256 offerId) external view returns (Offer memory) {
        return offers[offerId];
    }

    function getCredit(uint256 creditId) external view returns (Credit memory) {
        return credits[creditId];
    }
}
