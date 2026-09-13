// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SmeshToken
/// @notice ERC-20 utility token for ShaderMesh: used for job payments, provider
///         staking/collateral, and verification rewards. Includes a testnet faucet.
/// @dev This is a utility/test token for the platform, not an investment instrument.
contract SmeshToken is ERC20, Ownable {
    /// @notice Amount minted per faucet call (testnet convenience).
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    /// @notice Per-address cooldown between faucet claims.
    uint256 public faucetCooldown = 1 days;

    mapping(address => uint256) public lastFaucet;

    event Faucet(address indexed to, uint256 amount);

    constructor(uint256 initialSupply, address owner_)
        ERC20("ShaderMesh Token", "SMESH")
        Ownable(owner_)
    {
        if (initialSupply > 0) {
            _mint(owner_, initialSupply);
        }
    }

    /// @notice Owner can mint (e.g., to seed reward pools or the faucet on testnets).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Claim testnet tokens. Rate-limited per address.
    function faucet() external {
        require(
            block.timestamp - lastFaucet[msg.sender] >= faucetCooldown,
            "faucet: cooldown active"
        );
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    function setFaucetCooldown(uint256 secondsCooldown) external onlyOwner {
        faucetCooldown = secondsCooldown;
    }
}
