"""
USDC 余额读取 + transfer / approve calldata 构造
USDC (6 decimals)
"""
from web3 import Web3
from config import BASE_RPC_URL, USDC_CONTRACT_ADDRESS

USDC_DECIMALS = 6

# 最小 ABI — balanceOf, transfer, approve
USDC_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
]

# PactumEscrow ABI — 只需 deposit
ESCROW_ABI = [
    {
        "inputs": [
            {"name": "orderId", "type": "bytes32"},
            {"name": "seller", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

# Transfer event — 充值检测用
TRANSFER_EVENT_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "from", "type": "address"},
            {"indexed": True, "name": "to", "type": "address"},
            {"indexed": False, "name": "value", "type": "uint256"},
        ],
        "name": "Transfer",
        "type": "event",
    }
]

_w3: Web3 | None = None


def _get_w3() -> Web3:
    global _w3
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))
    return _w3


def _get_contract():
    w3 = _get_w3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(USDC_CONTRACT_ADDRESS),
        abi=USDC_ABI + TRANSFER_EVENT_ABI,
    )


def get_balance(address: str) -> float:
    """查询 USDC 余额，返回人类可读数值"""
    contract = _get_contract()
    raw = contract.functions.balanceOf(Web3.to_checksum_address(address)).call()
    return raw / (10 ** USDC_DECIMALS)


def build_transfer_calldata(to: str, amount: float) -> str:
    """构造 USDC transfer 的 calldata（hex string）"""
    contract = _get_contract()
    raw_amount = int(amount * (10 ** USDC_DECIMALS))
    return contract.functions.transfer(
        Web3.to_checksum_address(to), raw_amount
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]


def get_transfer_events(from_block: int, to_block: int) -> list[dict]:
    """获取 USDC Transfer 事件"""
    contract = _get_contract()
    w3 = _get_w3()

    # Transfer event topic
    transfer_topic = w3.keccak(text="Transfer(address,address,uint256)").hex()

    logs = w3.eth.get_logs({
        "address": Web3.to_checksum_address(USDC_CONTRACT_ADDRESS),
        "fromBlock": from_block,
        "toBlock": to_block,
        "topics": [transfer_topic],
    })

    events = []
    for log in logs:
        # topics[1] = from, topics[2] = to (padded to 32 bytes)
        from_addr = "0x" + log["topics"][1].hex()[-40:]
        to_addr = "0x" + log["topics"][2].hex()[-40:]
        value = int(log["data"].hex(), 16) / (10 ** USDC_DECIMALS)
        events.append({
            "from": Web3.to_checksum_address(from_addr),
            "to": Web3.to_checksum_address(to_addr),
            "value": value,
            "tx_hash": log["transactionHash"].hex(),
            "block_number": log["blockNumber"],
        })
    return events


def get_latest_block() -> int:
    return _get_w3().eth.block_number


def build_approve_calldata(spender: str, amount: int) -> str:
    """构造 USDC approve calldata（amount 为 raw units，6 decimals）"""
    contract = _get_contract()
    return contract.functions.approve(
        Web3.to_checksum_address(spender), amount
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]


def build_deposit_calldata(order_id_bytes32: str, seller: str, amount: int) -> str:
    """构造 Escrow deposit calldata（amount 为 raw units，6 decimals）"""
    w3 = _get_w3()
    escrow = w3.eth.contract(
        address=Web3.to_checksum_address("0x0000000000000000000000000000000000000000"),
        abi=ESCROW_ABI,
    )
    order_bytes = bytes.fromhex(order_id_bytes32.replace("0x", ""))
    return escrow.functions.deposit(
        order_bytes, Web3.to_checksum_address(seller), amount
    ).build_transaction({"gas": 0, "gasPrice": 0})["data"]
