"""JWT + bcrypt authentication for the QwickAds Super Admin.

- Web dashboard users authenticate via /api/auth/login and use a Bearer JWT.
- Existing machine-to-machine access via `X-Admin-Token` header (used by the
  Power Player registration flow and internal scripts) remains supported.
- On startup a seed super_admin is upserted (idempotent).
"""
from __future__ import annotations

import hmac
import os
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import bcrypt
from bson import ObjectId
from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field

JWT_SECRET = os.environ.get("JWT_SECRET", "qwickads-dev-jwt-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))  # 8h sessions
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "qwickads-super-admin-dev-token")

SEED_ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@qwickads.com")
SEED_ADMIN_PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe@2026")

bearer_scheme = HTTPBearer(auto_error=False)


class Role(str, Enum):
    super_admin = "super_admin"
    operations = "operations"
    sales = "sales"
    analyst = "analyst"


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class AdminUserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    disabled: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AdminUserOut


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def make_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["_id"]),
        "email": user["email"],
        "role": user["role"],
        "pwdv": user.get("password_version", 0),
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
        "iss": "qwickads-admin-api",
        "aud": "qwickads-admin-panel",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def seed_super_admin(db) -> None:
    """Idempotently ensure a super_admin exists on startup."""
    await db.admin_users.create_index("email", unique=True)
    existing = await db.admin_users.find_one({"email": SEED_ADMIN_EMAIL.lower()})
    if existing:
        return
    await db.admin_users.insert_one(
        {
            "email": SEED_ADMIN_EMAIL.lower(),
            "password_hash": hash_password(SEED_ADMIN_PASSWORD),
            "role": Role.super_admin.value,
            "disabled": False,
            "password_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )


async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    x_admin_token: Optional[str] = Header(default=None),
):
    """Resolves the current admin from Bearer JWT or the static X-Admin-Token.

    Returns a dict with at least: role, email, principal ('machine' or user id).
    """
    if ADMIN_TOKEN and x_admin_token and hmac.compare_digest(x_admin_token, ADMIN_TOKEN):
        return {
            "principal": "machine",
            "email": "machine@qwickads",
            "role": Role.super_admin.value,
            "id": "machine",
        }

    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        claims = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            issuer="qwickads-admin-api",
            audience="qwickads-admin-panel",
            options={"require_exp": True, "require_sub": True},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        user = await request.app.state.db.admin_users.find_one(
            {"_id": ObjectId(claims["sub"])}
        )
    except Exception:
        user = None
    if not user or user.get("disabled"):
        raise HTTPException(status_code=401, detail="Account invalid")
    if claims.get("pwdv", -1) != user.get("password_version", 0):
        raise HTTPException(status_code=401, detail="Session expired")
    return {
        "principal": str(user["_id"]),
        "id": str(user["_id"]),
        "email": user["email"],
        "role": user["role"],
        "password_hash": user["password_hash"],
        "password_version": user.get("password_version", 0),
    }


def require_roles(*allowed: Role):
    async def dep(admin=Depends(get_current_admin)):
        if admin.get("role") not in {r.value for r in allowed}:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return admin

    return dep
