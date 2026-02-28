"""
轻量 Pactum API 客户端 — Wallet API key 认证，纯 httpx
"""
import logging

import httpx

logger = logging.getLogger("seedance.pactum")


class PactumClient:
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.wallet: str | None = None
        self.token: str | None = None
        self._http = httpx.Client(timeout=30)

    def _headers(self) -> dict:
        if not self.token:
            self.authenticate()
        return {"Authorization": f"Bearer {self.token}"}

    def authenticate(self):
        resp = self._http.post(
            f"{self.api_url}/market/auth/wallet",
            json={"api_key": self.api_key},
        )
        resp.raise_for_status()
        data = resp.json()
        self.token = data["token"]
        self.wallet = data["wallet"]
        logger.info(f"Authenticated as {self.wallet}")

    def register_seller(self, endpoint: str, description: str):
        resp = self._http.post(
            f"{self.api_url}/market/register/seller",
            headers={**self._headers(), "X-Wallet-Api-Key": self.api_key},
            json={"endpoint": endpoint, "description": description},
        )
        if resp.status_code == 409:
            return resp.json()
        resp.raise_for_status()
        return resp.json()

    def get_my_items(self) -> list:
        resp = self._http.get(
            f"{self.api_url}/market/my-items",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json().get("items", [])

    def list_item(self, name: str, description: str, price: float, item_type: str = "digital") -> dict:
        resp = self._http.post(
            f"{self.api_url}/market/items",
            headers=self._headers(),
            json={"name": name, "description": description, "price": price, "type": item_type},
        )
        resp.raise_for_status()
        return resp.json()

    def get_orders(self) -> list:
        resp = self._http.get(
            f"{self.api_url}/market/orders",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json().get("orders", [])

    def deliver_file(self, order_id: str, filename: str, content: bytes, content_type: str, message: str = None) -> dict:
        files = {"file": (filename, content, content_type)}
        data = {}
        if message:
            data["content"] = message
        resp = self._http.post(
            f"{self.api_url}/market/orders/{order_id}/deliver-file",
            headers=self._headers(),
            files=files,
            data=data,
        )
        resp.raise_for_status()
        return resp.json()
