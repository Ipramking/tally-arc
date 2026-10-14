// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Test-only contracts. Never deployed.

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {TallyRegistryV2} from "../TallyRegistryV2.sol";

/// Ownable-style target whose owner can change.
contract TransferableOwner {
    address public owner;

    constructor(address o) {
        owner = o;
    }

    function transferOwnership(address n) external {
        require(msg.sender == owner, "not owner");
        owner = n;
    }
}

/// OpenZeppelin AccessControl target (no `owner()`).
contract AdminTarget is AccessControl {
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
}

/// A contract with no ownership surface at all.
contract Plain {
    uint256 public x = 1;
}

/// Minimal ERC-1271 smart account controlled by one EOA (stand-in for a Safe).
contract Wallet1271 is IERC1271 {
    address public immutable controller;

    constructor(address c) {
        controller = c;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address rec, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, sig);
        return err == ECDSA.RecoverError.NoError && rec == controller ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// Answers every call with 0xff..ff (dirty address word, and not `true`).
contract DirtyAnswer {
    fallback() external {
        assembly {
            mstore(0, not(0))
            return(0, 32)
        }
    }
}

/// Burns all gas on any call.
contract GasBomb {
    fallback() external {
        while (true) {}
    }
}

/// Returns a large blob on any call.
contract ReturnBomb {
    fallback() external {
        assembly {
            return(0, 60000)
        }
    }
}

/// Reverts on any call.
contract Reverter {
    fallback() external {
        revert("nope");
    }
}

/// Exposes the internal CREATE address helper for testing.
contract TallyRegistryV2Harness is TallyRegistryV2 {
    function createAddress(address deployer, uint256 nonce) external pure returns (address) {
        return _createAddress(deployer, nonce);
    }
}
