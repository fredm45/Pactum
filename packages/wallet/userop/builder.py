"""
ERC-4337 UserOperation 构造 + hash 计算
- SimpleAccount v0.7 (execute / executeBatch)
- SimpleAccountFactory v0.7 (getAddress / createAccount)
- EntryPoint v0.7 (getNonce)
"""
import logging
from eth_abi import encode
from web3 import Web3

from config import (
    BASE_RPC_URL,
    CHAIN_ID,
    ENTRYPOINT_ADDRESS,
    SIMPLE_ACCOUNT_FACTORY,
)

logger = logging.getLogger("wallet.userop.builder")

# ── ABI 片段 ──

SIMPLE_ACCOUNT_ABI = [
    {
        "inputs": [
            {"name": "dest", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "func", "type": "bytes"},
        ],
        "name": "execute",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "dest", "type": "address[]"},
            {"name": "value", "type": "uint256[]"},
            {"name": "func", "type": "bytes[]"},
        ],
        "name": "executeBatch",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

FACTORY_ABI = [
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "salt", "type": "uint256"},
        ],
        "name": "getAddress",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "salt", "type": "uint256"},
        ],
        "name": "createAccount",
        "outputs": [{"name": "ret", "type": "address"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

ENTRYPOINT_ABI = [
    {
        "inputs": [
            {"name": "sender", "type": "address"},
            {"name": "key", "type": "uint192"},
        ],
        "name": "getNonce",
        "outputs": [{"name": "nonce", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

_w3: Web3 | None = None


def _get_w3() -> Web3:
    global _w3
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))
    return _w3


# ── 合约实例 ──

def _factory():
    w3 = _get_w3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(SIMPLE_ACCOUNT_FACTORY),
        abi=FACTORY_ABI,
    )


def _entrypoint():
    w3 = _get_w3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(ENTRYPOINT_ADDRESS),
        abi=ENTRYPOINT_ABI,
    )


def _account_contract(address: str):
    w3 = _get_w3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(address),
        abi=SIMPLE_ACCOUNT_ABI,
    )


# ── 公开 API ──

def get_smart_account_address(owner: str, salt: int = 0) -> str:
    """通过 Factory.getAddress() 计算 counterfactual 地址"""
    factory = _factory()
    addr = factory.functions.getAddress(
        Web3.to_checksum_address(owner), salt
    ).call()
    logger.info(f"Smart account for {owner}: {addr}")
    return addr


def get_nonce(sender: str) -> int:
    """获取 EntryPoint 中 sender 的 nonce（key=0）"""
    ep = _entrypoint()
    return ep.functions.getNonce(Web3.to_checksum_address(sender), 0).call()


def build_factory_init_code(owner: str, salt: int = 0) -> str:
    """
    构造 initCode = factory_address + createAccount(owner, salt) calldata
    用于首次部署 smart account
    """
    factory = _factory()
    create_data = factory.functions.createAccount(
        Web3.to_checksum_address(owner), salt
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]
    return SIMPLE_ACCOUNT_FACTORY + create_data[2:]  # 拼接


def build_execute_calldata(to: str, value: int, data: str) -> str:
    """包装成 SimpleAccount.execute(to, value, data)"""
    account = _account_contract("0x" + "00" * 20)
    data_bytes = bytes.fromhex(data.replace("0x", "")) if data else b""
    return account.functions.execute(
        Web3.to_checksum_address(to), value, data_bytes
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]


def build_execute_batch_calldata(calls: list[dict]) -> str:
    """
    包装成 SimpleAccount.executeBatch(dests, values, funcs)
    calls: [{"to": "0x...", "value": 0, "data": "0x..."}]
    """
    account = _account_contract("0x" + "00" * 20)
    dests = [Web3.to_checksum_address(c["to"]) for c in calls]
    values = [c.get("value", 0) for c in calls]
    funcs = [bytes.fromhex(c["data"].replace("0x", "")) if c.get("data") else b"" for c in calls]
    return account.functions.executeBatch(
        dests, values, funcs
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]


def build_user_operation(
    sender: str,
    call_data: str,
    is_deployed: bool,
    owner: str,
    salt: int = 0,
) -> dict:
    """
    构造 ERC-4337 v0.7 PackedUserOperation（未签名）
    gas 值先填 placeholder，由 bundler sponsor 填充
    """
    nonce = get_nonce(sender)

    # initCode: 未部署时需要
    factory = "0x" + "00" * 20
    factory_data = "0x"
    if not is_deployed:
        factory_contract = _factory()
        factory_data = factory_contract.functions.createAccount(
            Web3.to_checksum_address(owner), salt
        ).build_transaction({"gas": 0, "gasPrice": 0})["data"]
        factory = SIMPLE_ACCOUNT_FACTORY

    op = {
        "sender": Web3.to_checksum_address(sender),
        "nonce": hex(nonce),
        "factory": Web3.to_checksum_address(factory) if factory != "0x" + "00" * 20 else None,
        "factoryData": factory_data if factory != "0x" + "00" * 20 else None,
        "callData": call_data,
        "callGasLimit": "0x0",
        "verificationGasLimit": "0x0",
        "preVerificationGas": "0x0",
        "maxFeePerGas": "0x0",
        "maxPriorityFeePerGas": "0x0",
        # Dummy signature for gas estimation.
        # Must be a valid ECDSA format: r (32B) + s (32B) + v (1B).
        # s must be in low-half order (≤ secp256k1n/2) to pass OpenZeppelin ECDSA check.
        # Using r=1, s=1, v=27.
        "signature": "0x" + "00" * 31 + "01" + "00" * 31 + "01" + "1b",
        "paymaster": None,
        "paymasterData": None,
        "paymasterVerificationGasLimit": None,
        "paymasterPostOpGasLimit": None,
    }

    return op


def compute_user_op_hash(op: dict, entrypoint: str, chain_id: int) -> bytes:
    """
    计算 v0.7 PackedUserOperation 的 hash
    hash(pack(userOp), entryPoint, chainId)
    """
    def _hex_to_int(h: str) -> int:
        if isinstance(h, int):
            return h
        return int(h, 16)

    def _hex_to_bytes(h: str | None) -> bytes:
        if not h or h == "0x":
            return b""
        return bytes.fromhex(h.replace("0x", ""))

    sender = bytes.fromhex(op["sender"].replace("0x", ""))
    nonce = _hex_to_int(op["nonce"])

    # initCode = factory + factoryData (or empty)
    if op.get("factory") and op["factory"] != "0x" + "00" * 20:
        init_code = _hex_to_bytes(op["factory"]) + _hex_to_bytes(op.get("factoryData"))
    else:
        init_code = b""
    init_code_hash = Web3.keccak(init_code)

    call_data = _hex_to_bytes(op["callData"])
    call_data_hash = Web3.keccak(call_data)

    # accountGasLimits = verificationGasLimit (16 bytes) || callGasLimit (16 bytes)
    vgl = _hex_to_int(op.get("verificationGasLimit", "0x0"))
    cgl = _hex_to_int(op.get("callGasLimit", "0x0"))
    account_gas_limits = vgl.to_bytes(16, "big") + cgl.to_bytes(16, "big")

    pre_verification_gas = _hex_to_int(op.get("preVerificationGas", "0x0"))

    # gasFees = maxPriorityFeePerGas (16 bytes) || maxFeePerGas (16 bytes)
    mpfpg = _hex_to_int(op.get("maxPriorityFeePerGas", "0x0"))
    mfpg = _hex_to_int(op.get("maxFeePerGas", "0x0"))
    gas_fees = mpfpg.to_bytes(16, "big") + mfpg.to_bytes(16, "big")

    # paymasterAndData = paymaster + paymasterVerificationGasLimit + paymasterPostOpGasLimit + paymasterData (or empty)
    if op.get("paymaster"):
        pm = _hex_to_bytes(op["paymaster"])
        pm_vgl = _hex_to_int(op.get("paymasterVerificationGasLimit", "0x0"))
        pm_pogl = _hex_to_int(op.get("paymasterPostOpGasLimit", "0x0"))
        pm_data = _hex_to_bytes(op.get("paymasterData"))
        paymaster_and_data = pm + pm_vgl.to_bytes(16, "big") + pm_pogl.to_bytes(16, "big") + pm_data
    else:
        paymaster_and_data = b""
    paymaster_and_data_hash = Web3.keccak(paymaster_and_data)

    # Pack: abi.encode(sender, nonce, initCodeHash, callDataHash, accountGasLimits, preVerificationGas, gasFees, paymasterAndDataHash)
    packed = encode(
        ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            op["sender"],
            nonce,
            init_code_hash,
            call_data_hash,
            account_gas_limits,
            pre_verification_gas,
            gas_fees,
            paymaster_and_data_hash,
        ],
    )

    # Final hash: keccak256(abi.encode(keccak256(packed), entryPoint, chainId))
    inner_hash = Web3.keccak(packed)
    final = Web3.keccak(
        encode(
            ["bytes32", "address", "uint256"],
            [inner_hash, entrypoint, chain_id],
        )
    )
    return final
