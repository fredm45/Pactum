"""
CDP Bundler + Paymaster HTTP 客户端（JSON-RPC）
ERC-7677 三步 Paymaster 流程:
  1. pm_getPaymasterStubData — 获取 stub paymaster 字段
  2. eth_estimateUserOperationGas — 用 stub 估算 gas
  3. pm_getPaymasterData — 用最终 gas 值获取真实 paymaster 签名
"""
import asyncio
import logging

import httpx

from config import BUNDLER_RPC_URL, ENTRYPOINT_ADDRESS, CHAIN_ID, BASE_RPC_URL

logger = logging.getLogger("wallet.userop.bundler")

CHAIN_ID_HEX = hex(CHAIN_ID)


class BundlerClient:
    def __init__(self, rpc_url: str | None = None):
        self.rpc_url = rpc_url or BUNDLER_RPC_URL
        if not self.rpc_url:
            raise RuntimeError("BUNDLER_RPC_URL not configured")
        self._id = 0

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    async def _rpc(self, method: str, params: list) -> dict:
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(self.rpc_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                logger.error(f"Bundler RPC error ({method}): {data['error']}")
                raise RuntimeError(f"Bundler RPC error: {data['error']}")
            return data["result"]

    async def _get_gas_price(self) -> str:
        """从 Base RPC 获取当前 gas price"""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(BASE_RPC_URL, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_gasPrice",
                "params": [],
            })
            return resp.json()["result"]

    async def sponsor_user_op(self, user_op: dict) -> dict:
        """
        ERC-7677 三步 Paymaster 流程：
        1. pm_getPaymasterStubData — 获取 stub paymaster 字段
        2. eth_estimateUserOperationGas — 用 stub 估算 gas
        3. pm_getPaymasterData — 用最终 gas 值获取真实 paymaster 签名
        """
        clean_op = {k: v for k, v in user_op.items() if v is not None}

        # Step 1: 获取 stub paymaster 数据
        stub = await self._rpc(
            "pm_getPaymasterStubData",
            [clean_op, ENTRYPOINT_ADDRESS, CHAIN_ID_HEX],
        )
        for key in ["paymaster", "paymasterData", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]:
            if key in stub and stub[key]:
                user_op[key] = stub[key]

        logger.info(f"Paymaster stub: {stub.get('paymaster', 'unknown')}")

        # Step 2: 用 stub 估算 gas
        clean_op2 = {k: v for k, v in user_op.items() if v is not None}
        gas = await self._rpc(
            "eth_estimateUserOperationGas",
            [clean_op2, ENTRYPOINT_ADDRESS],
        )
        for key in ["preVerificationGas", "callGasLimit", "verificationGasLimit",
                     "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]:
            if key in gas and gas[key]:
                user_op[key] = gas[key]

        # 填充 gas price
        gas_price = await self._get_gas_price()
        user_op["maxFeePerGas"] = gas_price
        user_op["maxPriorityFeePerGas"] = gas_price

        logger.info(f"Gas estimated: call={gas.get('callGasLimit')} verify={gas.get('verificationGasLimit')}")

        # Step 3: 用最终 gas 值获取真实 paymaster 签名
        clean_op3 = {k: v for k, v in user_op.items() if v is not None}
        pm_data = await self._rpc(
            "pm_getPaymasterData",
            [clean_op3, ENTRYPOINT_ADDRESS, CHAIN_ID_HEX],
        )
        for key in ["paymaster", "paymasterData", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]:
            if key in pm_data and pm_data[key]:
                user_op[key] = pm_data[key]

        logger.info(f"UserOp sponsored by paymaster: {user_op.get('paymaster', 'unknown')}")
        return user_op

    async def send_user_op(self, user_op: dict) -> str:
        """
        eth_sendUserOperation → 返回 userOpHash
        """
        clean_op = {k: v for k, v in user_op.items() if v is not None}
        user_op_hash = await self._rpc(
            "eth_sendUserOperation",
            [clean_op, ENTRYPOINT_ADDRESS],
        )
        logger.info(f"UserOp submitted: {user_op_hash}")
        return user_op_hash

    async def wait_for_receipt(
        self,
        user_op_hash: str,
        timeout: int = 60,
        interval: float = 2.0,
    ) -> dict:
        """
        轮询 eth_getUserOperationReceipt 直到成功或超时
        """
        elapsed = 0.0
        while elapsed < timeout:
            try:
                result = await self._rpc(
                    "eth_getUserOperationReceipt",
                    [user_op_hash],
                )
                if result is not None:
                    success = result.get("success", False)
                    tx_hash = result.get("receipt", {}).get("transactionHash", "")
                    logger.info(f"UserOp receipt: success={success} tx={tx_hash}")
                    if not success:
                        raise RuntimeError(f"UserOp failed: {result.get('reason', 'unknown')}")
                    return result
            except RuntimeError as e:
                if "UserOp failed" in str(e):
                    raise
                # RPC error (not found yet), keep polling
                pass

            await asyncio.sleep(interval)
            elapsed += interval

        raise TimeoutError(f"UserOp {user_op_hash} not confirmed within {timeout}s")
