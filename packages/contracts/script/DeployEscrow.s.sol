// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PactumEscrow.sol";

contract DeployEscrow is Script {
    // USDC on Testnet
    address constant USDC_TESTNET = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);

        address usdcAddress = vm.envOr("USDC_ADDRESS", USDC_TESTNET);

        // operator = deployer by default, update after deploy via setOperator()
        address operatorAddress = vm.envOr("OPERATOR_ADDRESS", deployerAddress);
        address feeRecipientAddress = vm.envOr("FEE_RECIPIENT_ADDRESS", deployerAddress);
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(0)); // default free

        vm.startBroadcast(deployerPrivateKey);

        PactumEscrow escrow = new PactumEscrow(
            usdcAddress,
            operatorAddress,
            feeRecipientAddress,
            feeBps
        );

        console.log("PactumEscrow deployed to:", address(escrow));
        console.log("  USDC:", usdcAddress);
        console.log("  operator:", operatorAddress);
        console.log("  feeRecipient:", feeRecipientAddress);
        console.log("  feeBps:", feeBps);

        vm.stopBroadcast();
    }
}
