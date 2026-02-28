"""
Seedance 3.0 Pro — 运营管理服务
启动时自动认证 + 上架商品，提供 Web 运营界面
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse

from config import PACTUM_API_URL, WALLET_API_KEY, PORT
from items import ITEMS
from pactum_client import PactumClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seedance")

client: PactumClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = PactumClient(PACTUM_API_URL, WALLET_API_KEY)

    # 1. 认证
    logger.info("Authenticating with Pactum...")
    client.authenticate()

    # 2. 注册卖家（幂等）
    client.register_seller(
        endpoint="",  # 手动交付，不需要 endpoint
        description="Seedance 3.0 Pro — AI Video Generation Service",
    )

    # 3. 检查已上架商品
    existing = client.get_my_items()
    existing_names = {item["name"] for item in existing}
    logger.info(f"Existing items: {existing_names}")

    # 4. 上架缺少的商品
    for item in ITEMS:
        if item["name"] not in existing_names:
            try:
                client.list_item(
                    name=item["name"],
                    description=item["description"],
                    price=item["price"],
                    item_type=item["type"],
                )
                logger.info(f"Listed: {item['name']} @ ${item['price']}")
            except Exception as e:
                logger.error(f"Failed to list {item['name']}: {e}")
        else:
            logger.info(f"Already listed: {item['name']}")

    yield


app = FastAPI(title="Seedance Service", lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
async def index():
    template = Path(__file__).parent / "templates" / "index.html"
    return HTMLResponse(template.read_text())


@app.get("/api/orders")
async def get_orders():
    orders = client.get_orders()
    pending = [o for o in orders if o.get("status") in ("paid", "processing")]
    return {"orders": pending, "count": len(pending)}


@app.post("/api/deliver/{order_id}")
async def deliver(order_id: str, file: UploadFile = File(...)):
    content = await file.read()
    result = client.deliver_file(
        order_id=order_id,
        filename=file.filename or "video.mp4",
        content=content,
        content_type=file.content_type or "video/mp4",
        message="Your Seedance 3.0 Pro video is ready!",
    )
    return result


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
