// Human-readable ABIs for the two registry generations. The contracts test
// suite checks every signature here against the compiled contracts (selectors
// for functions, events and errors), so these cannot drift.
import { parseAbi } from "viem";

export const registryV1Abi = parseAbi([
  "function registerWithSignature(address _target, string _githubRepo, string _buildHash, bytes _signature)",
  "function nonces(address) view returns (uint256)",
  "function getRegistration(address _target) view returns (string githubRepo, string buildHash, address owner, uint256 registeredAt, uint8 provenance, bool isVerified)",
  "function domainSeparator() view returns (bytes32)",
]);

export const registryV2Abi = parseAbi([
  "function register((address target, address signer, string githubRepo, string buildHash, uint8 method, uint256 deployerNonce, uint256 deadline) c, bytes signature)",
  "function revoke(address target)",
  "function nonces(address) view returns (uint256)",
  "function getRegistration(address target) view returns (string githubRepo, string buildHash, address signer, uint256 registeredAt, uint8 provenance, bool isControlProven, uint8 method, uint8 flags)",
  "function hashClaim((address target, address signer, string githubRepo, string buildHash, uint8 method, uint256 deployerNonce, uint256 deadline) c) view returns (bytes32)",
  "function domainSeparator() view returns (bytes32)",
  "function REGISTRY_VERSION() view returns (uint256)",
  "event Registered(address indexed target, address indexed signer, uint8 provenance, uint8 method, string githubRepo, string buildHash, bytes32 codehash)",
  "event Revoked(address indexed target, address indexed by)",
  "error InvalidSigner()",
  "error NoCode()",
  "error Expired()",
  "error BadRepo()",
  "error BadBuildHash()",
  "error BadSignature()",
  "error ControllerExists()",
  "error NotOwner()",
  "error NotAdmin()",
  "error NotDeployer()",
  "error NonceTooLarge()",
  "error Outranked()",
  "error NoRecord()",
  "error NotAuthorized()",
]);

export const ownableAbi = parseAbi(["function owner() view returns (address)"]);
export const accessControlAbi = parseAbi(["function hasRole(bytes32 role, address account) view returns (bool)"]);

/** Plain-English explanations for the registry's custom errors. */
export const REVERT_HELP: Readonly<Record<string, string>> = {
  InvalidSigner: "The signer address is empty.",
  NoCode: "There is no contract at that address on this network.",
  Expired: "The signature expired. Sign again.",
  BadRepo: "The repository must be a plain https://github.com/owner/repo URL.",
  BadBuildHash: "The build hash may only contain letters, digits, dots, dashes and underscores (66 characters at most).",
  BadSignature: "The signature does not match the signer. Sign again with the same wallet.",
  ControllerExists: "This contract has an owner, so it cannot be self-attested. Register from the owner wallet.",
  NotOwner: "The connected wallet is not the owner of this contract.",
  NotAdmin: "The connected wallet does not hold the default admin role on this contract.",
  NotDeployer: "The connected wallet did not deploy this contract with that nonce.",
  NonceTooLarge: "The deployer nonce is too large.",
  Outranked: "A stronger record already exists for this contract, so this one was refused.",
  NoRecord: "There is no record to revoke.",
  NotAuthorized: "Only the record's signer or the contract's controller can revoke it.",
};
