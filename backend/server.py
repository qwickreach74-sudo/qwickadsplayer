"""
QwickAds Power Player - Backend API
====================================
Shared backend for:
  * The Android Player app (screen-token authenticated)
  * The future QwickAds Super Admin web app (admin-token authenticated)

Screens communicate ONLY via their own screen_token.
Super Admin uses ADMIN_TOKEN (from env) to seed registration codes,
manage screens and publish playlists.
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

# Admin token is used by the QwickAds Super Admin web app to seed screens.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "qwickads-super-admin-dev-token")

# ---------------------------------------------------------------------------
# FastAPI setup
# ---------------------------------------------------------------------------
app = FastAPI(title="QwickAds Power Player API", version="1.0.0")
api_router = APIRouter(prefix="/api")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_code(prefix: str, length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    # Avoid ambiguous characters
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(length))


def _clean(doc: Optional[dict]) -> Optional[dict]:
    """Strip Mongo _id (not JSON serializable)."""
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
    return _clean(screen)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AdvertisementIn(BaseModel):
    advertisement_id: str = Field(default_factory=lambda: f"AD-{uuid.uuid4().hex[:8].upper()}")
    campaign_id: str = "default"
    media_url: str
    media_type: Literal["video", "image"]
    duration: int = 10  # seconds (used for images / max for videos)
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
    command: Literal["SYNC_PLAYLIST", "CLEAR_CACHE", "RESTART_PLAYER", "DISABLE_SCREEN"]
    payload: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/health")
async def health():
    try:
        await db.command("ping")
        return {"status": "ok", "time": utc_now().isoformat()}
    except Exception as exc:  # pragma: no cover
        return {"status": "degraded", "error": str(exc)}


# ---------------------------------------------------------------------------
# Admin endpoints (Super Admin panel will use these)
# ---------------------------------------------------------------------------
@api_router.post("/admin/screens/create-code", response_model=CreateCodeResponse)
async def admin_create_code(body: CreateCodeRequest, _: bool = Depends(require_admin)):
    code = _generate_code("REG")
    doc = {
        "registration_code": code,
        "cab_number": body.cab_number,
        "area": body.area,
        "notes": body.notes,
        "used": False,
        "created_at": utc_now().isoformat(),
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
        "updated_at": utc_now().isoformat(),
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
    screen = await db.screens.find_one({"screen_id": screen_id})
    if not screen:
        raise HTTPException(status_code=404, detail="Screen not found")
    cmd_doc = {
        "command_id": f"CMD-{uuid.uuid4().hex[:10].upper()}",
        "screen_id": screen_id,
        "command": body.command,
        "payload": body.payload or {},
        "status": "pending",
        "created_at": utc_now().isoformat(),
    }
    await db.commands.insert_one(cmd_doc)
    return {"ok": True, "command_id": cmd_doc["command_id"]}


# ---------------------------------------------------------------------------
# Screen registration
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

    # Generate stable screen identity
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
        "cab_number": code_doc.get("cab_number"),
        "area": code_doc.get("area"),
        "device_model": body.device_model,
        "android_version": body.android_version,
        "app_version": body.app_version,
        "registered_at": utc_now().isoformat(),
        "last_seen": utc_now().isoformat(),
        "playlist_version": 0,
    }
    await db.screens.insert_one(screen_doc)
    await db.registration_codes.update_one(
        {"registration_code": code_doc["registration_code"]},
        {"$set": {"used": True, "used_by": screen_id, "used_at": utc_now().isoformat()}},
    )

    return RegisterResponse(
        screen_id=screen_id,
        screen_token=screen_token,
        cab_number=screen_doc.get("cab_number"),
        area=screen_doc.get("area"),
    )


# ---------------------------------------------------------------------------
# Screen endpoints
# ---------------------------------------------------------------------------
@api_router.get("/screens/{screen_id}/playlist")
async def get_playlist(screen_id: str, screen: dict = Depends(require_screen)):
    playlist = await db.playlists.find_one({"screen_id": screen_id})
    if not playlist:
        return {
            "screen_id": screen_id,
            "playlist_version": 0,
            "advertisements": [],
        }
    playlist.pop("_id", None)
    return playlist


@api_router.post("/screens/heartbeat")
async def heartbeat(body: HeartbeatIn, x_screen_token: Optional[str] = Header(default=None)):
    if not x_screen_token:
        raise HTTPException(status_code=401, detail="Missing screen token")
    screen = await db.screens.find_one({"screen_id": body.screen_id})
    if not screen or screen.get("screen_token") != x_screen_token:
        raise HTTPException(status_code=401, detail="Invalid screen credentials")

    await db.screens.update_one(
        {"screen_id": body.screen_id},
        {
            "$set": {
                "last_seen": utc_now().isoformat(),
                "app_version": body.app_version or screen.get("app_version"),
                "device_model": body.device_model or screen.get("device_model"),
                "current_ad_id": body.current_ad_id,
                "current_campaign_id": body.current_campaign_id,
                "storage_used_bytes": body.storage_used_bytes,
            }
        },
    )
    # Return the current playlist_version so the player can decide to refresh
    return {
        "ok": True,
        "server_time": utc_now().isoformat(),
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
            "advertisement_id": e.advertisement_id,
            "campaign_id": e.campaign_id,
            "started_at": e.started_at,
            "completed_at": e.completed_at,
            "duration_played": e.duration_played,
            "completion_percentage": e.completion_percentage,
            "device_timestamp": e.device_timestamp,
            "received_at": utc_now().isoformat(),
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
    return {"commands": cmds}


@api_router.post("/screens/{screen_id}/commands/{command_id}/ack")
async def ack_command(
    screen_id: str, command_id: str, screen: dict = Depends(require_screen)
):
    result = await db.commands.update_one(
        {"screen_id": screen_id, "command_id": command_id, "status": "pending"},
        {"$set": {"status": "acknowledged", "acknowledged_at": utc_now().isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api_router)

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
    # Ensure useful indexes
    await db.screens.create_index("screen_id", unique=True)
    await db.registration_codes.create_index("registration_code", unique=True)
    await db.playlists.create_index("screen_id", unique=True)
    await db.commands.create_index([("screen_id", 1), ("status", 1)])
    await db.playback_events.create_index([("screen_id", 1), ("received_at", -1)])
    logger.info("QwickAds Power Player API ready")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
