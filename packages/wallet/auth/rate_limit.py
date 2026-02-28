"""
内存级限流 — 基于滑动窗口
用于保护注册/验证等公开端点
"""
import time
from collections import defaultdict

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _cleanup(self, key: str):
        now = time.time()
        cutoff = now - self.window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

    def check(self, key: str) -> None:
        self._cleanup(key)
        if len(self._requests[key]) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Max {self.max_requests} requests per {self.window_seconds}s.",
            )
        self._requests[key].append(time.time())


# 全局限流器实例
register_limiter = RateLimiter(max_requests=3, window_seconds=60)      # 3 次/分钟
verify_limiter = RateLimiter(max_requests=5, window_seconds=60)        # 5 次/分钟
api_limiter = RateLimiter(max_requests=60, window_seconds=60)          # 60 次/分钟


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
