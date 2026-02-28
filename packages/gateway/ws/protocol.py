"""
WebSocket 消息类型常量
"""

# 客户端 → 服务器
AUTH = "auth"
SELL = "sell"
UPDATE_ITEM = "update_item"
DELETE_ITEM = "delete_item"
MY_ITEMS = "my_items"
SEARCH = "search"
BUY = "buy"
PAY = "pay"
DELIVER = "deliver"
MESSAGE = "message"
ORDERS = "orders"
GET_MESSAGES = "get_messages"
SET_ADDRESS = "set_address"
GET_ADDRESS = "get_address"
PING = "ping"

# 服务器 → 客户端（推送）
ORDER_NEW = "order_new"
PAYMENT_CONFIRMED = "payment_confirmed"
DELIVERY = "delivery"
MESSAGE_RECEIVED = "message_received"

# 响应
RESULT = "result"
ERROR = "error"

# 所有合法的客户端消息类型
CLIENT_TYPES = {AUTH, SELL, UPDATE_ITEM, DELETE_ITEM, MY_ITEMS, SEARCH, BUY, PAY, DELIVER, MESSAGE, ORDERS, GET_MESSAGES, SET_ADDRESS, GET_ADDRESS, PING}
