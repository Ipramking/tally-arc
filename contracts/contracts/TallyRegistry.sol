// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title  TallyRegistry
/// @notice On-chain contract provenance for Arc Mainnet. Maps a target
///         contract address to the public source repo + build hash of the
///         code that was deployed there.
///
/// @dev    Provenance is *enforced*, not merely asserted:
///
///         - If the target contract exposes `owner()` (the common Ownable
///           pattern), registration is only accepted from that owner. This
///           gives a strong, on-chain-verifiable link: only the party that
///           controls the contract can claim its source. Records get
///           `Provenance.OWNER_PROVEN`.
///
///         - If the target does not expose `owner()` (an EOA, or a contract
///           with no ownership surface), the record is accepted first-come as
///           `Provenance.SELF_ATTESTED`. This is an honest downgrade: the
///           registry does not pretend to have verified control it cannot
///           check. Consumers (extension, badge API) MUST surface the
///           difference to users.
///
///         Signatures are EIP-712 typed data so registration can be relayed
///         (the signer pays nothing; a relayer submits and pays USDC gas).
contract TallyRegistry is EIP712 {
    using ECDSA for bytes32;

    enum Provenance {
        NONE, // 0 - never registered
        SELF_ATTESTED, // 1 - target has no owner() surface; claimant unproven
        OWNER_PROVEN // 2 - signer == target.owner(); strong link
    }

    bytes32 private constant REGISTER_TYPEHASH =
        keccak256(
            "Register(address target,string githubRepo,string buildHash,uint256 nonce)"
        );

    struct ContractRecord {
        string githubRepo;
        string buildHash;
        address owner; // the signer that registered / controls the record
        uint256 registeredAt;
        Provenance provenance;
    }

    mapping(address => ContractRecord) private _registry;
    /// @notice Per-target signing nonce, consumed on each registration.
    mapping(address => uint256) public nonces;

    event ContractRegistered(
        address indexed targetContract,
        string githubRepo,
        string buildHash,
        address indexed owner,
        Provenance provenance,
        uint256 timestamp
    );

    constructor() EIP712("Tally", "1") {}

    /// @notice Register (or update) provenance for `_target` using an
    ///         EIP-712 signature. May be relayed by any caller.
    function registerWithSignature(
        address _target,
        string calldata _githubRepo,
        string calldata _buildHash,
        bytes calldata _signature
    ) external {
        require(_target != address(0), "Invalid target address");
        require(bytes(_githubRepo).length != 0, "Empty repo");

        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_TYPEHASH,
                _target,
                keccak256(bytes(_githubRepo)),
                keccak256(bytes(_buildHash)),
                nonces[_target]++
            )
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), _signature);
        require(signer != address(0), "Invalid signature");

        // Enforce provenance where the chain can actually prove it.
        Provenance level = _resolveProvenance(_target, signer);

        ContractRecord storage existing = _registry[_target];
        if (existing.provenance != Provenance.NONE) {
            // Once a record exists, only its owner may update it. And a
            // self-attested record can never overwrite an owner-proven one.
            require(existing.owner == signer, "Unauthorized: not record owner");
            require(
                level == Provenance.OWNER_PROVEN ||
                    existing.provenance != Provenance.OWNER_PROVEN,
                "Cannot downgrade proven record"
            );
        }

        _registry[_target] = ContractRecord({
            githubRepo: _githubRepo,
            buildHash: _buildHash,
            owner: signer,
            registeredAt: block.timestamp,
            provenance: level
        });

        emit ContractRegistered(
            _target,
            _githubRepo,
            _buildHash,
            signer,
            level,
            block.timestamp
        );
    }

    /// @dev If the target exposes `owner()`, the signer MUST be that owner —
    ///      anything else reverts, so nobody can squat provenance on a
    ///      contract they don't control. Targets with no `owner()` fall back
    ///      to a clearly-labelled self-attestation.
    function _resolveProvenance(
        address _target,
        address _signer
    ) private view returns (Provenance) {
        // Non-contract targets (EOAs) can never be owner-proven.
        if (_target.code.length == 0) {
            return Provenance.SELF_ATTESTED;
        }

        (bool ok, bytes memory data) = _target.staticcall{gas: 30_000}(
            abi.encodeWithSignature("owner()")
        );

        if (ok && data.length == 32) {
            address targetOwner = abi.decode(data, (address));
            if (targetOwner != address(0)) {
                require(_signer == targetOwner, "Signer is not contract owner");
                return Provenance.OWNER_PROVEN;
            }
        }
        return Provenance.SELF_ATTESTED;
    }

    /// @notice Read a registration. `provenance` is 0 (none), 1 (self-attested)
    ///         or 2 (owner-proven). `isVerified` is true only for owner-proven.
    function getRegistration(
        address _target
    )
        external
        view
        returns (
            string memory githubRepo,
            string memory buildHash,
            address owner,
            uint256 registeredAt,
            Provenance provenance,
            bool isVerified
        )
    {
        ContractRecord memory rec = _registry[_target];
        return (
            rec.githubRepo,
            rec.buildHash,
            rec.owner,
            rec.registeredAt,
            rec.provenance,
            rec.provenance == Provenance.OWNER_PROVEN
        );
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
