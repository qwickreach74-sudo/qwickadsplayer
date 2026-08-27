"""
QwickAds Power Player - Backend API
====================================
Shared backend for:
  * The Android Player app (screen-token authenticated)
  * The QwickAds Super Admin web panel (JWT / X-Admin-Token)

Screens communicate ONLY via their own `screen_token`.
Super Admin uses either a JWT (issued via /api/auth/login) or the static
ADMIN_TOKEN header for machine access.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import secrets
import string
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "qwickads-super-admin-dev-token")

# ---------------------------------------------------------------------------
# FastAPI setup
# ---------------------------------------------------------------------------
app = FastAPI(title="QwickAds Power Player API", version="1.1.0")
app.state.db = db  # exposed to auth/admin routers

api_router = APIRouter(prefix="/api")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso() -> str:
    return utc_now().isoformat()


def _generate_code(prefix: str, length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(length))


def _clean(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
async def require_admin(x_admin_token: Optional[str] = Header(default=None)):
    if not x_admin_token or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return True


async def require_screen(
    screen_id: str,
    x_screen_token: Optional[str] = Header(default=None),
):
    if not x_screen_token:
        raise HTTPException(status_code=401, detail="Missing screen token")
    screen = await db.screens.find_one({"screen_id": screen_id})
    if not screen or screen.get("screen_token") != x_screen_token:
        raise HTTPException(status_code=401, detail="Invalid screen credentials")
    if screen.get("disabled"):
        raise HTTPException(status_code=403, detail="Screen disabled")
    return _clean(screen)


# ---------------------------------------------------------------------------
# Player-facing models (kept backwards-compatible)
# ---------------------------------------------------------------------------
class AdvertisementIn(BaseModel):
    advertisement_id: str = Field(default_factory=lambda: f"AD-{uuid.uuid4().hex[:8].upper()}")
    campaign_id: str = "default"
    media_url: str
    media_type: Literal["video", "image"]
    duration: int = 10
    priority: int = 100


class CreateCodeRequest(BaseModel):
    cab_number: Optional[str] = None
    area: Optional[str] = None
    notes: Optional[str] = None


class CreateCodeResponse(BaseModel):
    registration_code: str
    expires_at: Optional[str] = None
    cab_number: Optional[str] = None
    area: Optional[str] = None


class RegisterRequest(BaseModel):
    registration_code: str
    device_model: Optional[str] = None
    android_version: Optional[str] = None
    app_version: Optional[str] = None


class RegisterResponse(BaseModel):
    screen_id: str
    screen_token: str
    cab_number: Optional[str] = None
    area: Optional[str] = None


class HeartbeatIn(BaseModel):
    screen_id: str
    app_version: Optional[str] = None
    device_model: Optional[str] = None
    current_ad_id: Optional[str] = None
    current_campaign_id: Optional[str] = None
    storage_used_bytes: Optional[int] = None
    timestamp: Optional[str] = None


class PlaybackEvent(BaseModel):
    advertisement_id: str
    campaign_id: Optional[str] = None
    started_at: str
    completed_at: str
    duration_played: float
    completion_percentage: float
    device_timestamp: Optional[str] = None


class PlaybackBatchIn(BaseModel):
    screen_id: str
    events: List[PlaybackEvent]


class PublishPlaylistRequest(BaseModel):
    advertisements: List[AdvertisementIn]


class CommandIn(BaseModel):
    command: Literal["SYNC_PLAYLIST", "CLEAR_CACHE", "RESTART_PLAYER", "DISABLE_SCREEN", "RECONNECT"]
    payload: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/health")
async def health():
    try:
        await db.command("ping")
        return {"status": "ok", "time": utc_iso()}
    except Exception as exc:  # pragma: no cover
        return {"status": "degraded", "error": str(exc)}


# ---------------------------------------------------------------------------
# Legacy admin machine endpoints (backwards compatibility)
# ---------------------------------------------------------------------------
@api_router.post("/admin/screens/create-code", response_model=CreateCodeResponse)
async def admin_create_code(body: CreateCodeRequest, _: bool = Depends(require_admin)):
    code = _generate_code("REG")
    # Legacy shape stored cab_number/area as free strings. New Super Admin uses
    # /api/screens/registration-codes with cab_id/area_id references. Both are
    # accepted at registration time (see /api/screens/register below).
    doc = {
        "registration_code": code,
        "cab_number": body.cab_number,
        "area": body.area,
        "notes": body.notes,
        "used": False,
        "created_at": utc_iso(),
        "expires_at": None,  # legacy codes do not expire
    }
    await db.registration_codes.insert_one(doc)
    return CreateCodeResponse(
        registration_code=code,
        cab_number=body.cab_number,
        area=body.area,
    )


@api_router.get("/admin/screens")
async def admin_list_screens(_: bool = Depends(require_admin)):
    screens = await db.screens.find({}, {"_id": 0, "screen_token": 0}).to_list(1000)
    return {"screens": screens}


@api_router.post("/admin/screens/{screen_id}/playlist")
async def admin_publish_playlist(
    screen_id: str,
    body: PublishPlaylistRequest,
    _: bool = Depends(require_admin),
):
    screen = await db.screens.find_one({"screen_id": screen_id})
    if not screen:
        raise HTTPException(status_code=404, detail="Screen not found")
    new_version = int(screen.get("playlist_version", 0)) + 1
    playlist_doc = {
        "screen_id": screen_id,
        "playlist_version": new_version,
        "advertisements": [ad.dict() for ad in body.advertisements],
        "updated_at": utc_iso(),
    }
    await db.playlists.update_one(
        {"screen_id": screen_id}, {"$set": playlist_doc}, upsert=True
    )
    await db.screens.update_one(
        {"screen_id": screen_id}, {"$set": {"playlist_version": new_version}}
    )
    return {"ok": True, "playlist_version": new_version}


@api_router.post("/admin/screens/{screen_id}/commands")
async def admin_queue_command(
    screen_id: str, body: CommandIn, _: bool = Depends(require_admin)
):
    if not await db.screens.find_one({"screen_id": screen_id}):
        raise HTTPException(status_code=404, detail="Screen not found")
    cmd_doc = {
        "command_id": f"CMD-{uuid.uuid4().hex[:10].upper()}",
        "screen_id": screen_id,
        "command": body.command,
        "payload": body.payload or {},
        "status": "pending",
        "created_at": utc_iso(),
    }
    await db.commands.insert_one(cmd_doc)
    return {"ok": True, "command_id": cmd_doc["command_id"]}


# ---------------------------------------------------------------------------
# Screen registration (player-facing)
# ---------------------------------------------------------------------------
@api_router.post("/screens/register", response_model=RegisterResponse)
async def register_screen(body: RegisterRequest):
    code_doc = await db.registration_codes.find_one(
        {"registration_code": body.registration_code.strip().upper()}
    )
    if not code_doc:
        raise HTTPException(status_code=404, detail="Invalid registration code")
    if code_doc.get("used"):
        raise HTTPException(status_code=409, detail="Registration code already used")
    if code_doc.get("revoked"):
        raise HTTPException(status_code=410, detail="Registration code was revoked")
    expires_at = code_doc.get("expires_at")
    if expires_at:
        try:
            dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if dt < utc_now():
                raise HTTPException(status_code=410, detail="Registration code has expired")
        except HTTPException:
            raise
        except Exception:
            pass

    # Resolve associated cab and area (support both legacy free-string codes
    # and new cab_id/area_id references from the Super Admin flow).
    cab_id = code_doc.get("cab_id")
    area_id = code_doc.get("area_id")
    cab_number = code_doc.get("cab_number")
    area_name = code_doc.get("area")
    if cab_id and not cab_number:
        cab = await db.cabs.find_one({"cab_id": cab_id}, {"_id": 0, "cab_number": 1, "area_id": 1})
        if cab:
            cab_number = cab.get("cab_number")
            area_id = area_id or cab.get("area_id")
    if area_id and not area_name:
        area = await db.areas.find_one({"area_id": area_id}, {"_id": 0, "name": 1})
        area_name = area["name"] if area else None

    seq = await db.counters.find_one_and_update(
        {"_id": "screen_seq"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    seq_value = (seq or {}).get("value", 1)
    screen_id = f"QA-SCR-{seq_value:06d}"
    screen_token = secrets.token_urlsafe(32)

    screen_doc = {
        "screen_id": screen_id,
        "screen_token": screen_token,
        "cab_id": cab_id,
        "cab_number": cab_number,
        "area_id": area_id,
        "area": area_name,
        "device_model": body.device_model,
        "android_version": body.android_version,
        "app_version": body.app_version,
        "registered_at": utc_iso(),
        "last_seen": utc_iso(),
        "playlist_version": 0,
        "disabled": False,
    }
    await db.screens.insert_one(screen_doc)
    await db.registration_codes.update_one(
        {"registration_code": code_doc["registration_code"]},
        {"$set": {"used": True, "used_by": screen_id, "used_at": utc_iso(), "status": "used"}},
    )

    return RegisterResponse(
        screen_id=screen_id,
        screen_token=screen_token,
        cab_number=cab_number,
        area=area_name,
    )


# ---------------------------------------------------------------------------
# Screen endpoints
# ---------------------------------------------------------------------------
@api_router.get("/screens/{screen_id}/playlist")
async def get_playlist(screen_id: str, screen: dict = Depends(require_screen)):
    playlist = await db.playlists.find_one({"screen_id": screen_id})
    if not playlist:
        return {"screen_id": screen_id, "playlist_version": 0, "advertisements": []}
    playlist.pop("_id", None)
    return playlist


@api_router.post("/screens/heartbeat")
async def heartbeat(body: HeartbeatIn, x_screen_token: Optional[str] = Header(default=None)):
    if not x_screen_token:
        raise HTTPException(status_code=401, detail="Missing screen token")
    screen = await db.screens.find_one({"screen_id": body.screen_id})
    if not screen or screen.get("screen_token") != x_screen_token:
        raise HTTPException(status_code=401, detail="Invalid screen credentials")
    if screen.get("disabled"):
        raise HTTPException(status_code=403, detail="Screen disabled")

    await db.screens.update_one(
        {"screen_id": body.screen_id},
        {
            "$set": {
                "last_seen": utc_iso(),
                "app_version": body.app_version or screen.get("app_version"),
                "device_model": body.device_model or screen.get("device_model"),
                "current_ad_id": body.current_ad_id,
                "current_campaign_id": body.current_campaign_id,
                "storage_used_bytes": body.storage_used_bytes,
            }
        },
    )
    return {
        "ok": True,
        "server_time": utc_iso(),
        "playlist_version": screen.get("playlist_version", 0),
    }


@api_router.post("/playback/batch")
async def playback_batch(body: PlaybackBatchIn, x_screen_token: Optional[str] = Header(default=None)):
    if not x_screen_token:
        raise HTTPException(status_code=401, detail="Missing screen token")
    screen = await db.screens.find_one({"screen_id": body.screen_id})
    if not screen or screen.get("screen_token") != x_screen_token:
        raise HTTPException(status_code=401, detail="Invalid screen credentials")

    if not body.events:
        return {"ok": True, "inserted": 0}

    docs = [
        {
            "screen_id": body.screen_id,
            "cab_id": screen.get("cab_id"),
            "area_id": screen.get("area_id"),
            "advertisement_id": e.advertisement_id,
            "campaign_id": e.campaign_id,
            "started_at": e.started_at,
            "completed_at": e.completed_at,
            "duration_played": e.duration_played,
            "completion_percentage": e.completion_percentage,
            "device_timestamp": e.device_timestamp,
            "received_at": utc_iso(),
        }
        for e in body.events
    ]
    await db.playback_events.insert_many(docs)
    return {"ok": True, "inserted": len(docs)}


@api_router.get("/screens/{screen_id}/commands")
async def get_commands(screen_id: str, screen: dict = Depends(require_screen)):
    cmds = await db.commands.find(
        {"screen_id": screen_id, "status": "pending"}, {"_id": 0}
    ).to_list(50)
    # Mark as delivered on first fetch
    if cmds:
        await db.commands.update_many(
            {
                "screen_id": screen_id,
                "command_id": {"$in": [c["command_id"] for c in cmds]},
                "status": "pending",
            },
            {"$set": {"status": "delivered", "delivered_at": utc_iso()}},
        )
    return {"commands": cmds}


@api_router.post("/screens/{screen_id}/commands/{command_id}/ack")
async def ack_command(
    screen_id: str, command_id: str, screen: dict = Depends(require_screen)
):
    result = await db.commands.update_one(
        {"screen_id": screen_id, "command_id": command_id, "status": {"$in": ["pending", "delivered"]}},
        {"$set": {"status": "acknowledged", "acknowledged_at": utc_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api_router)

# Wire the Super Admin routers (JWT-authenticated)
from auth import seed_super_admin  # noqa: E402
from admin_routes import router as admin_router, auth_router  # noqa: E402

app.include_router(auth_router)
app.include_router(admin_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    await db.screens.create_index("screen_id", unique=True)
    await db.registration_codes.create_index("registration_code", unique=True)
    await db.playlists.create_index("screen_id", unique=True)
    await db.commands.create_index([("screen_id", 1), ("status", 1)])
    await db.playback_events.create_index([("screen_id", 1), ("received_at", -1)])
    await db.playback_events.create_index([("campaign_id", 1), ("received_at", -1)])
    await db.areas.create_index("area_id", unique=True)
    await db.cabs.create_index("cab_id", unique=True)
    await db.cabs.create_index("cab_number", unique=True)
    await db.media.create_index("media_id", unique=True)
    await db.campaigns.create_index("campaign_id", unique=True)
    await db.audit_logs.create_index([("timestamp", -1)])
    await seed_super_admin(db)
    logger.info("QwickAds backend ready (Player + Super Admin)")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
