// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PactumEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Minimal mock USDC (6 decimals)
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PactumEscrowTest is Test {
    PactumEscrow escrow;
    MockUSDC usdc;

    address owner    = address(0x1);
    address operator = address(0x2);
    address feeRecip = address(0x3);
    address buyer    = address(0x4);
    address seller   = address(0x5);

    uint256 constant FEE_BPS = 250; // 2.5%
    uint256 constant AMOUNT  = 100e6; // 100 USDC

    bytes32 constant ORDER_ID = keccak256("order-001");

    function setUp() public {
        usdc = new MockUSDC();

        vm.prank(owner);
        escrow = new PactumEscrow(address(usdc), operator, feeRecip, FEE_BPS);

        // fund buyer
        usdc.mint(buyer, 1000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ----------------------------------------------------------------
    // deposit
    // ----------------------------------------------------------------

    function test_deposit() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        PactumEscrow.Order memory o = escrow.getOrder(ORDER_ID);
        assertEq(o.buyer, buyer);
        assertEq(o.seller, seller);
        assertEq(o.amount, AMOUNT);
        assertEq(uint8(o.status), uint8(PactumEscrow.Status.Pending));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_deposit_revert_zeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.ZeroAmount.selector);
        escrow.deposit(ORDER_ID, seller, 0);
    }

    function test_deposit_revert_selfAsSeller() public {
        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.InvalidSeller.selector);
        escrow.deposit(ORDER_ID, buyer, AMOUNT);
    }

    function test_deposit_revert_duplicateOrder() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        usdc.mint(buyer, AMOUNT);
        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.OrderNotFound.selector);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
    }

    // ----------------------------------------------------------------
    // confirm (buyer)
    // ----------------------------------------------------------------

    function test_confirm_releases_to_seller() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.prank(buyer);
        escrow.confirm(ORDER_ID);

        uint256 fee = (AMOUNT * FEE_BPS) / 10000; // 2.5 USDC
        assertEq(usdc.balanceOf(seller), AMOUNT - fee);
        assertEq(escrow.accumulatedFees(), fee);
        assertEq(uint8(escrow.getOrder(ORDER_ID).status), uint8(PactumEscrow.Status.Released));
    }

    function test_confirm_revert_notBuyer() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.prank(seller);
        vm.expectRevert(PactumEscrow.NotBuyer.selector);
        escrow.confirm(ORDER_ID);
    }

    function test_confirm_revert_alreadyReleased() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
        vm.prank(buyer);
        escrow.confirm(ORDER_ID);

        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.OrderNotPending.selector);
        escrow.confirm(ORDER_ID);
    }

    // ----------------------------------------------------------------
    // autoConfirm
    // ----------------------------------------------------------------

    function test_autoConfirm_after_window() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.warp(block.timestamp + 1 days + 1);

        escrow.autoConfirm(ORDER_ID); // anyone can call

        uint256 fee = (AMOUNT * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(seller), AMOUNT - fee);
        assertEq(uint8(escrow.getOrder(ORDER_ID).status), uint8(PactumEscrow.Status.Released));
    }

    function test_autoConfirm_revert_windowOpen() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.expectRevert(PactumEscrow.ConfirmWindowOpen.selector);
        escrow.autoConfirm(ORDER_ID);
    }

    // ----------------------------------------------------------------
    // dispute
    // ----------------------------------------------------------------

    function test_dispute() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.prank(buyer);
        escrow.dispute(ORDER_ID);

        assertEq(uint8(escrow.getOrder(ORDER_ID).status), uint8(PactumEscrow.Status.Disputed));
    }

    function test_dispute_revert_afterWindow() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.ConfirmWindowClosed.selector);
        escrow.dispute(ORDER_ID);
    }

    // ----------------------------------------------------------------
    // operator resolve
    // ----------------------------------------------------------------

    function test_resolveRelease() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
        vm.prank(buyer);
        escrow.dispute(ORDER_ID);

        vm.prank(operator);
        escrow.resolveRelease(ORDER_ID);

        uint256 fee = (AMOUNT * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(seller), AMOUNT - fee);
        assertEq(uint8(escrow.getOrder(ORDER_ID).status), uint8(PactumEscrow.Status.Released));
    }

    function test_resolveRefund() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
        vm.prank(buyer);
        escrow.dispute(ORDER_ID);

        vm.prank(operator);
        escrow.resolveRefund(ORDER_ID);

        assertEq(usdc.balanceOf(buyer), 1000e6); // full refund
        assertEq(uint8(escrow.getOrder(ORDER_ID).status), uint8(PactumEscrow.Status.Refunded));
    }

    function test_resolveRelease_revert_notDisputed() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.prank(operator);
        vm.expectRevert(PactumEscrow.OrderNotDisputed.selector);
        escrow.resolveRelease(ORDER_ID);
    }

    function test_emergencyRefund() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        vm.prank(operator);
        escrow.emergencyRefund(ORDER_ID);

        assertEq(usdc.balanceOf(buyer), 1000e6);
    }

    function test_resolveRelease_revert_notOperator() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
        vm.prank(buyer);
        escrow.dispute(ORDER_ID);

        vm.prank(buyer);
        vm.expectRevert(PactumEscrow.NotOperator.selector);
        escrow.resolveRelease(ORDER_ID);
    }

    // ----------------------------------------------------------------
    // withdrawFees
    // ----------------------------------------------------------------

    function test_withdrawFees() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);
        vm.prank(buyer);
        escrow.confirm(ORDER_ID);

        uint256 fee = (AMOUNT * FEE_BPS) / 10000;

        vm.prank(operator);
        escrow.withdrawFees();

        assertEq(usdc.balanceOf(feeRecip), fee);
        assertEq(escrow.accumulatedFees(), 0);
    }

    function test_withdrawFees_revert_noFees() public {
        vm.prank(operator);
        vm.expectRevert(PactumEscrow.NoFeesToWithdraw.selector);
        escrow.withdrawFees();
    }

    // ----------------------------------------------------------------
    // owner config
    // ----------------------------------------------------------------

    function test_setFeeBps() public {
        vm.prank(owner);
        escrow.setFeeBps(500);
        assertEq(escrow.feeBps(), 500);
    }

    function test_setFeeBps_revert_tooHigh() public {
        vm.prank(owner);
        vm.expectRevert(PactumEscrow.FeeTooHigh.selector);
        escrow.setFeeBps(1001);
    }

    function test_setOperator() public {
        vm.prank(owner);
        escrow.setOperator(address(0x99));
        assertEq(escrow.operator(), address(0x99));
    }

    function test_transferOwnership() public {
        vm.prank(owner);
        escrow.transferOwnership(address(0x99));
        assertEq(escrow.owner(), address(0x99));
    }

    // ----------------------------------------------------------------
    // isConfirmable
    // ----------------------------------------------------------------

    function test_isConfirmable() public {
        vm.prank(buyer);
        escrow.deposit(ORDER_ID, seller, AMOUNT);

        assertFalse(escrow.isConfirmable(ORDER_ID));

        vm.warp(block.timestamp + 1 days + 1);
        assertTrue(escrow.isConfirmable(ORDER_ID));
    }
}
