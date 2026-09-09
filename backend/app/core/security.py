"""登录鉴权：口令哈希与令牌签发。

口令用标准库 hashlib.pbkdf2_hmac 加盐派生，令牌用 PyJWT 签发，
不额外引入密码学依赖；将来换 bcrypt / passlib 只需替换本模块。
"""

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings

# 迭代次数按当前服务器性能取一个偏保守的值：越低越容易被暴力破解，越高登录越慢
PBKDF2_ITERATIONS = 200_000
SALT_BYTES = 16
TOKEN_ALGORITHM = "HS256"


def hash_password(raw: str) -> str:
    """生成可存储的口令摘要，格式：算法$迭代次数$盐$摘要。"""
    salt = os.urandom(SALT_BYTES).hex()
    digest = hashlib.pbkdf2_hmac(
        "sha256", raw.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(raw: str, stored: str) -> bool:
    """校验口令：按存储的格式重算摘要并常量时间比对。"""
    try:
        algorithm, iterations, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    recalculated = hashlib.pbkdf2_hmac(
        "sha256", raw.encode("utf-8"), salt.encode("utf-8"), int(iterations)
    )
    # compare_digest 防时序侧信道：普通 == 会在首个不同字节处提前返回
    return hmac.compare_digest(recalculated.hex(), digest)


def create_access_token(username: str, role: str) -> str:
    """签发访问令牌，载荷只放展示与鉴权必需的最小信息。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.auth_token_ttl_minutes),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm=TOKEN_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """解析令牌；过期或签名不符一律返回 None，由调用方决定如何响应。"""
    try:
        return jwt.decode(token, settings.auth_secret, algorithms=[TOKEN_ALGORITHM])
    except jwt.PyJWTError:
        return None
