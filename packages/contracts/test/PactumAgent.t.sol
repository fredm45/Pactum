// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PactumAgent.sol";

contract PactumAgentTest is Test {
    PactumAgent agent;

    address alice;
    uint256 aliceKey;
    address bob;
    uint256 bobKey;
    address charlie;

    function setUp() public {
        agent = new PactumAgent();

        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        charlie = makeAddr("charlie");
    }

    // ----------------------------------------------------------------
    // Registration
    // ----------------------------------------------------------------

    function test_registerAgent() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        assertEq(tokenId, 1);
        assertEq(agent.ownerOf(1), alice);
        assertEq(agent.walletToToken(alice), 1);
        assertTrue(agent.isRegistered(alice));

        PactumAgent.AgentRecord memory rec = agent.getAgentRecord(1);
        assertEq(rec.agentCardHash, keccak256("card1"));
        assertTrue(rec.active);
        assertEq(rec.totalRating, 0);
        assertEq(rec.reviewCount, 0);
    }

    function test_registerAgent_secondAgent() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        uint256 tokenId = agent.registerAgent(keccak256("card2"), address(0));

        assertEq(tokenId, 2);
        assertEq(agent.ownerOf(2), bob);
    }

    function test_revert_registerAgent_alreadyRegistered() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        vm.expectRevert(PactumAgent.AlreadyRegistered.selector);
        agent.registerAgent(keccak256("card2"), address(0));
    }

    // ----------------------------------------------------------------
    // Verify (ECDSA)
    // ----------------------------------------------------------------

    function test_verify() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        bytes32 message = keccak256("hello");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertTrue(agent.verify(alice, message, signature));
    }

    function test_verify_wrongSigner() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        bytes32 message = keccak256("hello");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verify(alice, message, signature));
    }

    function test_verify_unregisteredWallet() public {
        bytes32 message = keccak256("hello");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verify(alice, message, signature));
    }

    function test_verify_deactivated() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        agent.deactivate(tokenId);

        bytes32 message = keccak256("hello");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verify(alice, message, signature));
    }

    // ----------------------------------------------------------------
    // Deactivate
    // ----------------------------------------------------------------

    function test_deactivate() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        agent.deactivate(tokenId);

        PactumAgent.AgentRecord memory rec = agent.getAgentRecord(tokenId);
        assertFalse(rec.active);
    }

    function test_revert_deactivate_notOwner() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        vm.expectRevert(PactumAgent.NotTokenOwner.selector);
        agent.deactivate(tokenId);
    }

    function test_revert_deactivate_alreadyInactive() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        agent.deactivate(tokenId);

        vm.prank(alice);
        vm.expectRevert(PactumAgent.AgentNotActive.selector);
        agent.deactivate(tokenId);
    }

    // ----------------------------------------------------------------
    // Reviews
    // ----------------------------------------------------------------

    function test_submitReview() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        agent.submitReview(tokenId, 5, "QmHash1");

        assertTrue(agent.hasUserReviewed(tokenId, bob));

        (uint256 avgRating, uint256 reviewCount) = agent.getAgentStats(tokenId);
        assertEq(avgRating, 500); // 5.00 * 100
        assertEq(reviewCount, 1);
    }

    function test_submitReview_multipleReviewers() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        agent.submitReview(tokenId, 4, "");

        vm.prank(charlie);
        agent.submitReview(tokenId, 2, "");

        (uint256 avgRating, uint256 reviewCount) = agent.getAgentStats(tokenId);
        assertEq(avgRating, 300); // (4+2)/2 = 3.00 * 100
        assertEq(reviewCount, 2);
    }

    function test_revert_submitReview_invalidRating() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        vm.expectRevert(PactumAgent.InvalidRating.selector);
        agent.submitReview(tokenId, 0, "");

        vm.prank(bob);
        vm.expectRevert(PactumAgent.InvalidRating.selector);
        agent.submitReview(tokenId, 6, "");
    }

    function test_revert_submitReview_selfReview() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        vm.expectRevert(PactumAgent.CannotReviewSelf.selector);
        agent.submitReview(tokenId, 5, "");
    }

    function test_revert_submitReview_duplicate() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(bob);
        agent.submitReview(tokenId, 5, "");

        vm.prank(bob);
        vm.expectRevert(PactumAgent.AlreadyReviewed.selector);
        agent.submitReview(tokenId, 3, "");
    }

    function test_revert_submitReview_inactiveAgent() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        agent.deactivate(tokenId);

        vm.prank(bob);
        vm.expectRevert(PactumAgent.AgentNotActive.selector);
        agent.submitReview(tokenId, 5, "");
    }

    // ----------------------------------------------------------------
    // Transfer — walletToToken sync
    // ----------------------------------------------------------------

    function test_transfer_updatesWalletToToken() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        vm.prank(alice);
        agent.transferFrom(alice, bob, tokenId);

        assertEq(agent.ownerOf(tokenId), bob);
        assertEq(agent.walletToToken(bob), tokenId);
        // alice's mapping cleared
        assertEq(agent.walletToToken(alice), 0);
        assertFalse(agent.isRegistered(alice));
        assertTrue(agent.isRegistered(bob));
    }

    // ----------------------------------------------------------------
    // getAgentStats — no reviews
    // ----------------------------------------------------------------

    function test_getAgentStats_noReviews() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));

        (uint256 avgRating, uint256 reviewCount) = agent.getAgentStats(tokenId);
        assertEq(avgRating, 0);
        assertEq(reviewCount, 0);
    }

    // ----------------------------------------------------------------
    // Verify EIP-712
    // ----------------------------------------------------------------

    function test_verifyEIP712() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        bytes32 challenge = keccak256("random-challenge");
        uint256 timestamp = 1700000000;

        // Build EIP-712 digest
        bytes32 structHash = keccak256(abi.encode(
            agent.AUTH_TYPEHASH(),
            alice,
            challenge,
            timestamp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            agent.DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertTrue(agent.verifyEIP712(alice, challenge, timestamp, signature));
    }

    function test_verifyEIP712_wrongSigner() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        bytes32 challenge = keccak256("random-challenge");
        uint256 timestamp = 1700000000;

        bytes32 structHash = keccak256(abi.encode(
            agent.AUTH_TYPEHASH(),
            alice,
            challenge,
            timestamp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            agent.DOMAIN_SEPARATOR(),
            structHash
        ));
        // Sign with bob's key instead
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verifyEIP712(alice, challenge, timestamp, signature));
    }

    function test_verifyEIP712_unregistered() public {
        bytes32 challenge = keccak256("random-challenge");
        uint256 timestamp = 1700000000;

        bytes32 structHash = keccak256(abi.encode(
            agent.AUTH_TYPEHASH(),
            alice,
            challenge,
            timestamp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            agent.DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verifyEIP712(alice, challenge, timestamp, signature));
    }

    function test_verifyEIP712_deactivated() public {
        vm.prank(alice);
        uint256 tokenId = agent.registerAgent(keccak256("card1"), address(0));
        vm.prank(alice);
        agent.deactivate(tokenId);

        bytes32 challenge = keccak256("random-challenge");
        uint256 timestamp = 1700000000;

        bytes32 structHash = keccak256(abi.encode(
            agent.AUTH_TYPEHASH(),
            alice,
            challenge,
            timestamp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            agent.DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertFalse(agent.verifyEIP712(alice, challenge, timestamp, signature));
    }

    function test_verifyEIP712_wrongChallenge() public {
        vm.prank(alice);
        agent.registerAgent(keccak256("card1"), address(0));

        bytes32 challenge = keccak256("random-challenge");
        uint256 timestamp = 1700000000;

        // Sign the correct challenge
        bytes32 structHash = keccak256(abi.encode(
            agent.AUTH_TYPEHASH(),
            alice,
            challenge,
            timestamp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            agent.DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Verify with a different challenge — should fail
        bytes32 wrongChallenge = keccak256("different-challenge");
        assertFalse(agent.verifyEIP712(alice, wrongChallenge, timestamp, signature));
    }

    // ----------------------------------------------------------------
    // ERC-721 metadata
    // ----------------------------------------------------------------

    function test_name_symbol() public view {
        assertEq(agent.name(), "PactumAgent");
        assertEq(agent.symbol(), "PAGENT");
    }
}
