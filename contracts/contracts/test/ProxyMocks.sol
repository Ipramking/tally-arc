// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/// @dev Test-only. The logic behind an EIP-1967 proxy: an owner and an upgrade function.
contract UpgradableLogicV1 {
    address public owner;

    function initialize(address o) external {
        require(owner == address(0), "initialized");
        owner = o;
    }

    function upgradeTo(address implementation) external {
        require(msg.sender == owner, "not owner");
        ERC1967Utils.upgradeToAndCall(implementation, "");
    }

    function version() external pure virtual returns (uint256) {
        return 1;
    }
}

/// @dev Test-only. The same logic with different behaviour: what a malicious upgrade swaps in.
contract UpgradableLogicV2 is UpgradableLogicV1 {
    function version() external pure override returns (uint256) {
        return 2;
    }
}

/// @dev Test-only. A plain EIP-1967 proxy (OpenZeppelin's), compiled under a name the tests can deploy.
contract TestProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
