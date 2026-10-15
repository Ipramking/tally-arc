// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title  TallyRegistryV2
/// @notice On-chain contract provenance. Links a deployed contract to a public
///         GitHub repository and records *how* the registrant proved control.
///
/// @dev    What this registry proves, and what it does not.
///
///         PROVES
///           - The signer controlled `target` when the record was written, by
///             one of three on-chain checks (see {ProofMethod}).
///           - The exact runtime code (`codehash`) the claim was made about, so
///             a record stops being trusted if the code at the address changes.
///
///         DOES NOT PROVE
///           - That `githubRepo` is the source of `target`, or that the signer
///             controls that repository. Anyone can deploy an Ownable contract
///             and point it at someone else's repository. That link is
///             confirmed off-chain: the repository must list the contract in a
///             `tally.json` file (docs/security.md). Clients MUST NOT show a
///             record as "verified" on the on-chain proof alone.
///
///         Update rules are rank based, so the strongest *live* claim always
///         wins and a squatter can never permanently lock out the party that
///         controls or deployed the contract:
///
///           rank 3  OWNER / ADMIN_ROLE  signer controls `target` right now
///           rank 2  DEPLOYER            signer deployed `target` with CREATE
///           rank 1  SELF_ATTESTED       no proof (only if the chain cannot
///                                       name a controller)
///           rank 0  none, or the code at `target` changed since registration
///
///         A claim replaces the stored record when its rank is higher, or equal
///         and (rank is not 1, or it comes from the same signer). A control
///         record whose signer no longer controls the target counts as rank 1.
///
///         The registry keeps one current record per target, but never forgets:
///         every registration and revocation is also appended to the target's
///         history (see {getHistory}), so a replaced record can still be read.
///
///         Signatures are EIP-712 typed data checked with ERC-1271 support, so
///         multisig / smart-account owners (for example a Safe) can register,
///         and any relayer can submit.
contract TallyRegistryV2 is EIP712 {
    // ------------------------------------------------------------------ types

    /// @dev Values 0-2 match v1 so existing readers decode `provenance`
    ///      unchanged. CONTROL_PROVEN replaces v1's OWNER_PROVEN.
    enum Provenance {
        NONE,
        SELF_ATTESTED,
        CONTROL_PROVEN
    }

    /// @dev How the signer proves control of the target. NONE = self-attested.
    enum ProofMethod {
        NONE,
        OWNER, //      target.owner() == signer
        ADMIN_ROLE, // target.hasRole(DEFAULT_ADMIN_ROLE, signer)
        DEPLOYER //    CREATE(signer, deployerNonce) == target
    }

    struct Claim {
        address target;
        address signer;
        string githubRepo;
        string buildHash;
        ProofMethod method;
        uint256 deployerNonce; // only read when method == DEPLOYER
        uint256 deadline;
    }

    struct Record {
        string githubRepo;
        string buildHash;
        address signer;
        uint64 registeredAt;
        Provenance provenance;
        ProofMethod method;
        bytes32 codehash;
    }

    /// @dev What happened to a record.
    enum HistoryKind {
        REGISTERED,
        REVOKED
    }

    /// @dev One line of a target's append-only history. It packs into a single
    ///      storage slot (20 + 8 + 1 + 1 + 1 bytes). The repository and build hash
    ///      are in the `Registered` event emitted in `blockNumber`, which a client
    ///      can fetch with a single-block log query that every RPC allows.
    struct HistoryEntry {
        address signer; // REGISTERED: who signed the claim. REVOKED: who removed the record.
        uint64 blockNumber;
        HistoryKind kind;
        Provenance provenance; // the level written, or the level that was removed
        ProofMethod method;
    }

    // ------------------------------------------------------------- constants

    uint256 public constant REGISTRY_VERSION = 2;
    /// @notice Bit set in `getRegistration().flags` when the signer still
    ///         controls the target (always set for DEPLOYER records).
    uint8 public constant FLAG_CONTROL_CURRENT = 1;
    /// @notice Bit set when the target's code is unchanged since registration.
    uint8 public constant FLAG_CODE_CURRENT = 2;

    uint8 private constant RANK_SELF = 1;
    uint8 private constant RANK_DEPLOYER = 2;
    uint8 private constant RANK_CONTROL = 3;

    /// @dev Gas given to `owner()` / `hasRole()` probes of untrusted targets.
    ///      Bounds what a hostile target can burn.
    uint256 private constant PROBE_GAS = 30_000;
    /// @dev Most entries `getHistory` returns in one call.
    uint256 private constant MAX_HISTORY_PAGE = 100;
    uint256 private constant MAX_REPO_LENGTH = 200;
    uint256 private constant MAX_BUILD_HASH_LENGTH = 66;
    bytes19 private constant REPO_PREFIX = "https://github.com/";

    bytes32 private constant REGISTER_TYPEHASH =
        keccak256(
            "Register(address target,address signer,string githubRepo,string buildHash,uint8 method,uint256 deployerNonce,uint256 nonce,uint256 deadline)"
        );

    // --------------------------------------------------------------- storage

    mapping(address target => Record) private _records;
    /// @dev Append-only. A record that is replaced or revoked stays here.
    mapping(address target => HistoryEntry[]) private _history;
    /// @notice Per-signer signing nonce, consumed by each registration.
    mapping(address signer => uint256) public nonces;

    // ---------------------------------------------------------------- events

    event Registered(
        address indexed target,
        address indexed signer,
        Provenance provenance,
        ProofMethod method,
        string githubRepo,
        string buildHash,
        bytes32 codehash
    );
    event Revoked(address indexed target, address indexed by);

    // ---------------------------------------------------------------- errors

    error InvalidSigner();
    error NoCode();
    error Expired();
    error BadRepo();
    error BadBuildHash();
    error BadSignature();
    error ControllerExists();
    error NotOwner();
    error NotAdmin();
    error NotDeployer();
    error NonceTooLarge();
    error Outranked();
    error NoRecord();
    error NotAuthorized();

    constructor() EIP712("Tally", "2") {}

    // ------------------------------------------------------------ registration

    /// @notice Register or update provenance for `c.target`. Anyone may relay
    ///         a valid signature; the signer pays nothing.
    function register(Claim calldata c, bytes calldata signature) external {
        if (c.signer == address(0)) revert InvalidSigner();
        if (c.target.code.length == 0) revert NoCode();
        if (block.timestamp > c.deadline) revert Expired();
        if (!_validRepo(c.githubRepo)) revert BadRepo();
        if (!_validBuildHash(c.buildHash)) revert BadBuildHash();

        uint256 nonce = nonces[c.signer];
        if (!SignatureChecker.isValidSignatureNow(c.signer, _digest(c, nonce), signature)) {
            revert BadSignature();
        }
        nonces[c.signer] = nonce + 1;

        Provenance level = _prove(c);
        _store(c, level);
    }

    /// @notice Remove a record. Callable by the record's signer or by whoever
    ///         currently controls the target (owner / default admin).
    function revoke(address target) external {
        Record storage rec = _records[target];
        if (rec.provenance == Provenance.NONE) revert NoRecord();
        if (
            msg.sender != rec.signer &&
            msg.sender != _ownerOf(target) &&
            !_isAdmin(target, msg.sender)
        ) revert NotAuthorized();
        _pushHistory(target, msg.sender, HistoryKind.REVOKED, rec.provenance, rec.method);
        delete _records[target];
        emit Revoked(target, msg.sender);
    }

    // ------------------------------------------------------------------ views

    /// @notice Read a record. The first six outputs are layout-compatible with
    ///         v1's `getRegistration`, so v1 readers keep working.
    /// @return githubRepo      Claimed source repository URL.
    /// @return buildHash       Free-form commit / build identifier.
    /// @return signer          Address that signed the claim.
    /// @return registeredAt    Block timestamp of the write.
    /// @return provenance      0 none, 1 self-attested, 2 control-proven.
    /// @return isControlProven True only for a control-proven record whose
    ///                         signer still controls the target and whose code
    ///                         is unchanged. Not the same as "verified": see
    ///                         the contract-level notes.
    /// @return method          How control was proven.
    /// @return flags           FLAG_CONTROL_CURRENT | FLAG_CODE_CURRENT.
    function getRegistration(
        address target
    )
        external
        view
        returns (
            string memory githubRepo,
            string memory buildHash,
            address signer,
            uint256 registeredAt,
            Provenance provenance,
            bool isControlProven,
            ProofMethod method,
            uint8 flags
        )
    {
        Record storage rec = _records[target];
        githubRepo = rec.githubRepo;
        buildHash = rec.buildHash;
        signer = rec.signer;
        registeredAt = rec.registeredAt;
        provenance = rec.provenance;
        method = rec.method;
        if (provenance == Provenance.NONE) return (githubRepo, buildHash, signer, registeredAt, provenance, false, method, 0);

        bool controlNow = _controlNow(target, rec);
        bool codeNow = target.codehash == rec.codehash;
        if (controlNow) flags |= FLAG_CONTROL_CURRENT;
        if (codeNow) flags |= FLAG_CODE_CURRENT;
        isControlProven = provenance == Provenance.CONTROL_PROVEN && controlNow && codeNow;
    }

    /// @notice How many history entries `target` has (registrations and revocations).
    function historyLength(address target) external view returns (uint256) {
        return _history[target].length;
    }

    /// @notice A page of `target`'s history, oldest first. Nothing is ever removed:
    ///         a record that was replaced or revoked is still listed here, with the
    ///         block of the write. The repository and build hash of each entry are in
    ///         the `Registered` event of that block.
    /// @param start First entry to return (0 is the oldest).
    /// @param count Entries wanted; at most 100 are returned.
    function getHistory(address target, uint256 start, uint256 count) external view returns (HistoryEntry[] memory page) {
        HistoryEntry[] storage list = _history[target];
        uint256 total = list.length;
        if (start >= total || count == 0) return new HistoryEntry[](0);
        if (count > MAX_HISTORY_PAGE) count = MAX_HISTORY_PAGE;
        uint256 end = total - start < count ? total : start + count;
        page = new HistoryEntry[](end - start);
        for (uint256 i = start; i < end; ++i) page[i - start] = list[i];
    }

    /// @notice Code hash recorded at registration (zero if unregistered).
    function recordedCodehash(address target) external view returns (bytes32) {
        return _records[target].codehash;
    }

    /// @notice Digest a signer must sign for `c` at their current nonce.
    ///         Useful for smart-account (ERC-1271) flows.
    function hashClaim(Claim calldata c) external view returns (bytes32) {
        return _digest(c, nonces[c.signer]);
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -------------------------------------------------------------- internals

    function _digest(Claim calldata c, uint256 nonce) private view returns (bytes32) {
        bytes memory head = abi.encode(
            REGISTER_TYPEHASH,
            c.target,
            c.signer,
            keccak256(bytes(c.githubRepo)),
            keccak256(bytes(c.buildHash))
        );
        bytes memory tail = abi.encode(uint8(c.method), c.deployerNonce, nonce, c.deadline);
        return _hashTypedDataV4(keccak256(bytes.concat(head, tail)));
    }

    /// @dev Runs the on-chain proof the signer declared. A failed declared
    ///      proof reverts rather than silently downgrading.
    function _prove(Claim calldata c) private view returns (Provenance) {
        ProofMethod m = c.method;
        if (m == ProofMethod.NONE) {
            // The chain can name a controller, so an unproven claim is refused.
            if (_ownerOf(c.target) != address(0)) revert ControllerExists();
            return Provenance.SELF_ATTESTED;
        }
        if (m == ProofMethod.OWNER) {
            if (_ownerOf(c.target) != c.signer) revert NotOwner();
        } else if (m == ProofMethod.ADMIN_ROLE) {
            if (!_isAdmin(c.target, c.signer)) revert NotAdmin();
        } else {
            if (c.deployerNonce > type(uint32).max) revert NonceTooLarge();
            if (_createAddress(c.signer, c.deployerNonce) != c.target) revert NotDeployer();
        }
        return Provenance.CONTROL_PROVEN;
    }

    function _store(Claim calldata c, Provenance level) private {
        Record storage rec = _records[c.target];
        uint8 newRank = _methodRank(c.method);
        uint8 oldRank = _effectiveRank(c.target, rec);
        if (newRank < oldRank || (newRank == oldRank && newRank == RANK_SELF && c.signer != rec.signer)) {
            revert Outranked();
        }

        bytes32 codehash = c.target.codehash;
        rec.githubRepo = c.githubRepo;
        rec.buildHash = c.buildHash;
        rec.signer = c.signer;
        rec.registeredAt = uint64(block.timestamp);
        rec.provenance = level;
        rec.method = c.method;
        rec.codehash = codehash;
        _pushHistory(c.target, c.signer, HistoryKind.REGISTERED, level, c.method);
        _emitRegistered(c, level, codehash);
    }

    function _pushHistory(address target, address who, HistoryKind kind, Provenance level, ProofMethod method) private {
        _history[target].push(
            HistoryEntry({signer: who, blockNumber: uint64(block.number), kind: kind, provenance: level, method: method})
        );
    }

    function _emitRegistered(Claim calldata c, Provenance level, bytes32 codehash) private {
        emit Registered(c.target, c.signer, level, c.method, c.githubRepo, c.buildHash, codehash);
    }

    function _methodRank(ProofMethod m) private pure returns (uint8) {
        if (m == ProofMethod.NONE) return RANK_SELF;
        if (m == ProofMethod.DEPLOYER) return RANK_DEPLOYER;
        return RANK_CONTROL;
    }

    /// @dev Rank of the stored record as it stands now. Changed code voids the
    ///      record; lost control demotes a control record to rank 1.
    function _effectiveRank(address target, Record storage rec) private view returns (uint8) {
        if (rec.provenance == Provenance.NONE) return 0;
        if (target.codehash != rec.codehash) return 0;
        if (rec.method == ProofMethod.DEPLOYER) return RANK_DEPLOYER;
        if (rec.method == ProofMethod.NONE) return RANK_SELF;
        return _controlNow(target, rec) ? RANK_CONTROL : RANK_SELF;
    }

    function _controlNow(address target, Record storage rec) private view returns (bool) {
        ProofMethod m = rec.method;
        if (m == ProofMethod.OWNER) return _ownerOf(target) == rec.signer;
        if (m == ProofMethod.ADMIN_ROLE) return _isAdmin(target, rec.signer);
        return m == ProofMethod.DEPLOYER; // deployer fact is permanent
    }

    function _ownerOf(address target) private view returns (address) {
        (bool ok, uint256 word) = _probe(target, abi.encodeWithSignature("owner()"));
        if (!ok || word > type(uint160).max) return address(0);
        return address(uint160(word));
    }

    function _isAdmin(address target, address account) private view returns (bool) {
        (bool ok, uint256 word) = _probe(
            target,
            abi.encodeWithSignature("hasRole(bytes32,address)", bytes32(0), account)
        );
        return ok && word == 1;
    }

    /// @dev Static call with a gas cap, reading exactly one return word. A
    ///      hostile target cannot make this revert, burn more than PROBE_GAS,
    ///      or force a large returndata copy.
    function _probe(address target, bytes memory callData) private view returns (bool ok, uint256 word) {
        uint256 gasCap = PROBE_GAS;
        assembly ("memory-safe") {
            let success := staticcall(gasCap, target, add(callData, 0x20), mload(callData), 0x00, 0x20)
            if and(success, eq(returndatasize(), 0x20)) {
                ok := 1
                word := mload(0x00)
            }
        }
    }

    /// @dev Address created by `deployer` with CREATE at account nonce `nonce`
    ///      (RLP([deployer, nonce]) hashed). Supports nonces up to 2^32 - 1.
    function _createAddress(address deployer, uint256 nonce) internal pure returns (address) {
        bytes memory data;
        if (nonce == 0) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        } else if (nonce <= 0x7f) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, uint8(nonce));
        } else if (nonce <= 0xff) {
            data = abi.encodePacked(bytes1(0xd7), bytes1(0x94), deployer, bytes1(0x81), uint8(nonce));
        } else if (nonce <= 0xffff) {
            data = abi.encodePacked(bytes1(0xd8), bytes1(0x94), deployer, bytes1(0x82), uint16(nonce));
        } else if (nonce <= 0xffffff) {
            data = abi.encodePacked(bytes1(0xd9), bytes1(0x94), deployer, bytes1(0x83), uint24(nonce));
        } else {
            data = abi.encodePacked(bytes1(0xda), bytes1(0x94), deployer, bytes1(0x84), uint32(nonce));
        }
        return address(uint160(uint256(keccak256(data))));
    }

    /// @dev `https://github.com/<owner>/<repo>[/<path>]`, charset [A-Za-z0-9._/-],
    ///      no empty or dots-only segments, at most MAX_REPO_LENGTH bytes. Keeps
    ///      scheme tricks (javascript:, data:), markup and control characters
    ///      out of storage. Clients must still validate what they render.
    function _validRepo(string calldata s) private pure returns (bool) {
        bytes calldata b = bytes(s);
        uint256 n = b.length;
        if (n <= 19 || n > MAX_REPO_LENGTH) return false;
        if (bytes19(b[:19]) != REPO_PREFIX) return false;

        uint256 slashes;
        bool segHasContent;
        bool segHasNonDot;
        for (uint256 i = 19; i < n; ++i) {
            bytes1 ch = b[i];
            if (ch == "/") {
                if (!segHasContent || !segHasNonDot) return false;
                ++slashes;
                segHasContent = false;
                segHasNonDot = false;
            } else if (ch == ".") {
                segHasContent = true;
            } else if (ch == "-" || ch == "_" || _isAlnum(ch)) {
                segHasContent = true;
                segHasNonDot = true;
            } else {
                return false;
            }
        }
        return segHasContent && segHasNonDot && slashes >= 1;
    }

    /// @dev Empty, or up to 66 bytes of [A-Za-z0-9._-] (a git SHA or 0x + 32 bytes).
    function _validBuildHash(string calldata s) private pure returns (bool) {
        bytes calldata b = bytes(s);
        uint256 n = b.length;
        if (n > MAX_BUILD_HASH_LENGTH) return false;
        for (uint256 i; i < n; ++i) {
            bytes1 ch = b[i];
            if (!(ch == "." || ch == "-" || ch == "_" || _isAlnum(ch))) return false;
        }
        return true;
    }

    function _isAlnum(bytes1 ch) private pure returns (bool) {
        return (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
    }
}
