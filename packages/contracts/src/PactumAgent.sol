// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PactumAgent
 * @notice ERC-8004 Agent Identity + Reputation — unified contract
 * @dev ERC-721 NFT per agent, with on-chain reputation (reviews)
 */
contract PactumAgent is ERC721 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct AgentRecord {
        bytes32 agentCardHash;
        uint256 registeredAt;
        bool active;
        uint256 totalRating;
        uint256 reviewCount;
    }

    uint256 private _nextTokenId = 1; // start at 1 so walletToToken default 0 means "not found"

    // EIP-712
    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant AUTH_TYPEHASH = keccak256("PactumAuth(address wallet,bytes32 challenge,uint256 timestamp)");

    mapping(uint256 => AgentRecord) public records;
    mapping(address => uint256) public walletToToken;
    mapping(uint256 => address) public tokenSigner;  // tokenId → EOA signer (for Smart Accounts)
    mapping(uint256 => mapping(address => bool)) public hasReviewed;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner);
    event AgentDeactivated(uint256 indexed tokenId);
    event ReviewSubmitted(uint256 indexed tokenId, address indexed reviewer, uint8 rating, string commentHash);

    error AlreadyRegistered();
    error NotTokenOwner();
    error AgentNotActive();
    error InvalidRating();
    error AlreadyReviewed();
    error CannotReviewSelf();
    error InvalidSignature();

    constructor() ERC721("PactumAgent", "PAGENT") {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Pactum"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    /**
     * @notice Register a new agent — mints an NFT to msg.sender
     * @param agentCardHash Hash of the agent card JSON
     * @param signer EOA that will sign auth challenges (use address(0) for EOA wallets, msg.sender assumed)
     * @return tokenId The minted token ID
     */
    function registerAgent(
        bytes32 agentCardHash,
        address signer
    ) external returns (uint256 tokenId) {
        if (walletToToken[msg.sender] != 0) revert AlreadyRegistered();

        tokenId = _nextTokenId++;

        _mint(msg.sender, tokenId);

        records[tokenId] = AgentRecord({
            agentCardHash: agentCardHash,
            registeredAt: block.timestamp,
            active: true,
            totalRating: 0,
            reviewCount: 0
        });

        walletToToken[msg.sender] = tokenId;
        // If signer provided (Smart Account case), store it; otherwise default to msg.sender
        tokenSigner[tokenId] = (signer != address(0)) ? signer : msg.sender;

        emit AgentRegistered(tokenId, msg.sender);
    }

    /**
     * @notice Verify that `wallet` owns an active agent NFT and signed `message`
     * @param wallet The wallet address to verify
     * @param message The message hash that was signed
     * @param signature The ECDSA signature
     * @return True if signature is valid and wallet holds an active agent
     */
    function verify(
        address wallet,
        bytes32 message,
        bytes calldata signature
    ) external view returns (bool) {
        if (balanceOf(wallet) == 0) return false;

        uint256 tokenId = walletToToken[wallet];
        if (!records[tokenId].active) return false;

        bytes32 ethSignedHash = message.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        return recovered == wallet;
    }

    /**
     * @notice Verify EIP-712 typed-data signature for challenge-response auth
     * @param wallet The wallet address to verify
     * @param challenge Server-issued random challenge
     * @param timestamp Unix timestamp of the auth request
     * @param signature The EIP-712 signature
     * @return True if signature is valid and wallet holds an active agent
     */
    function verifyEIP712(
        address wallet,
        bytes32 challenge,
        uint256 timestamp,
        bytes calldata signature
    ) external view returns (bool) {
        if (balanceOf(wallet) == 0) return false;
        uint256 tokenId = walletToToken[wallet];
        if (!records[tokenId].active) return false;

        bytes32 structHash = keccak256(abi.encode(AUTH_TYPEHASH, wallet, challenge, timestamp));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = digest.recover(signature);
        // EOA: 直接匹配
        if (recovered == wallet) return true;
        // Smart Account: 检查存储的 signer
        return recovered == tokenSigner[tokenId];
    }

    /**
     * @notice Deactivate an agent (only token owner)
     * @param tokenId The token to deactivate
     */
    function deactivate(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!records[tokenId].active) revert AgentNotActive();
        records[tokenId].active = false;
        emit AgentDeactivated(tokenId);
    }

    /**
     * @notice Check if a wallet has a registered (minted) agent
     */
    function isRegistered(address wallet) external view returns (bool) {
        return balanceOf(wallet) > 0;
    }

    /**
     * @notice Get the full agent record
     */
    function getAgentRecord(uint256 tokenId) external view returns (AgentRecord memory) {
        return records[tokenId];
    }

    // ----------------------------------------------------------------
    // Reputation
    // ----------------------------------------------------------------

    /**
     * @notice Submit a review for an agent
     * @param tokenId The agent's token ID
     * @param rating Rating 1-5
     * @param commentHash Optional IPFS hash of the comment
     */
    function submitReview(
        uint256 tokenId,
        uint8 rating,
        string calldata commentHash
    ) external {
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (!records[tokenId].active) revert AgentNotActive();
        if (ownerOf(tokenId) == msg.sender) revert CannotReviewSelf();
        if (hasReviewed[tokenId][msg.sender]) revert AlreadyReviewed();

        records[tokenId].totalRating += rating;
        records[tokenId].reviewCount += 1;
        hasReviewed[tokenId][msg.sender] = true;

        emit ReviewSubmitted(tokenId, msg.sender, rating, commentHash);
    }

    /**
     * @notice Get average rating and review count
     * @param tokenId The agent's token ID
     * @return avgRating Average rating * 100 (e.g. 450 = 4.50)
     * @return reviewCount Total number of reviews
     */
    function getAgentStats(uint256 tokenId) external view returns (
        uint256 avgRating,
        uint256 reviewCount
    ) {
        AgentRecord memory r = records[tokenId];
        reviewCount = r.reviewCount;
        if (reviewCount == 0) return (0, 0);
        avgRating = (r.totalRating * 100) / reviewCount;
    }

    /**
     * @notice Check if a user has already reviewed an agent
     */
    function hasUserReviewed(uint256 tokenId, address user) external view returns (bool) {
        return hasReviewed[tokenId][user];
    }

    // ----------------------------------------------------------------
    // ERC-721 override: keep walletToToken in sync on transfer
    // ----------------------------------------------------------------

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        // Clear old owner mapping
        if (from != address(0)) {
            delete walletToToken[from];
        }
        // Set new owner mapping
        if (to != address(0)) {
            walletToToken[to] = tokenId;
        }

        return from;
    }
}
