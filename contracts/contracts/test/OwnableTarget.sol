// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test-only. A minimal contract exposing `owner()` so the registry's
///      owner-proven provenance path can be exercised.
contract OwnableTarget {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}
