"""Super Admin backend routes.

All routes are protected by `get_current_admin` which accepts either:
  * `Authorization: Bearer <jwt>`  (web dashboard users)
  * `X-Admin-Token: <static>`      (machine access / dev scripts)

Nothing here breaks the Player-facing endpoints defined in `server.py`.
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field

from auth import (
    ChangePasswordIn, LoginIn, Role, TokenOut, AdminUserOut, JWT_EXPIRE_MINUTES,
    get_current_admin, hash_password, make_token, require_roles, verify_password,
)


router = APIRouter(prefix="/api")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso() -> str:
    return utc_now().isoformat()


def clean(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    doc.pop("_id", None)
    doc.pop("screen_token", None)  # never leak tokens to admins
    doc.pop("password_hash", None)
    return doc


def cleans(docs: List[dict]) -> List[dict]:
    return [clean(d) for d in docs if d is not None]  # type: ignore


async def audit(db, admin: dict, action: str, entity: str, entity_id: Optional[str] = None, meta: Optional[dict] = None):
    await db.audit_logs.insert_one(
        {
            "admin_email": admin.get("email"),
            "admin_id": admin.get("id"),
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "meta": meta or {},
            "timestamp": utc_iso(),
        }
    )


def _gen_code(prefix: str, length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(length))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request):
    db = request.app.state.db
    user = await db.admin_users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("disabled"):
        raise HTTPException(status_code=403, detail="Account disabled")
    token = make_token(user)
    return {
        "access_token": token,
        "expires_in": 60 * JWT_EXPIRE_MINUTES,
        "user": AdminUserOut(
            id=str(user["_id"]),
            email=user["email"],
            role=user["role"],
            disabled=bool(user.get("disabled", False)),
        ),
    }


@auth_router.get("/me", response_model=AdminUserOut)
async def me(admin=Depends(get_current_admin)):
    return AdminUserOut(
        id=admin.get("id", "machine"),
        email=admin.get("email"),
        role=admin.get("role"),
        disabled=False,
    )


@auth_router.post("/change-password")
async def change_password(body: ChangePasswordIn, request: Request, admin=Depends(get_current_admin)):
    if admin.get("principal") == "machine":
        raise HTTPException(status_code=400, detail="Machine principals cannot change passwords")
    if not verify_password(body.current_password, admin["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must be different")
    from bson import ObjectId

    db = request.app.state.db
    await db.admin_users.update_one(
        {"_id": ObjectId(admin["id"])},
        {"$set": {"password_hash": hash_password(body.new_password)}, "$inc": {"password_version": 1}},
    )
    await audit(db, admin, "change_password", "admin_user", admin.get("id"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS = {
    "heartbeat_interval_seconds": 60,
    "offline_threshold_seconds": 180,
    "registration_code_expiry_hours": 24,
    "default_ad_duration_seconds": 10,
    "playback_batch_size": 50,
    "playlist_poll_seconds": 300,
    "command_poll_seconds": 30,
}


async def get_settings(db) -> dict:
    doc = await db.settings.find_one({"_id": "system"})
    if not doc:
        merged = dict(DEFAULT_SETTINGS)
    else:
        doc.pop("_id", None)
        merged = {**DEFAULT_SETTINGS, **doc}
    return merged


class SettingsIn(BaseModel):
    heartbeat_interval_seconds: Optional[int] = None
    offline_threshold_seconds: Optional[int] = None
    registration_code_expiry_hours: Optional[int] = None
    default_ad_duration_seconds: Optional[int] = None
    playback_batch_size: Optional[int] = None
    playlist_poll_seconds: Optional[int] = None
    command_poll_seconds: Optional[int] = None


@router.get("/settings")
async def settings_get(request: Request, admin=Depends(get_current_admin)):
    return await get_settings(request.app.state.db)


@router.put("/settings")
async def settings_put(body: SettingsIn, request: Request, admin=Depends(get_current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return await get_settings(request.app.state.db)
    await request.app.state.db.settings.update_one(
        {"_id": "system"}, {"$set": updates}, upsert=True
    )
    await audit(request.app.state.db, admin, "update", "settings", "system", updates)
    return await get_settings(request.app.state.db)


# ---------------------------------------------------------------------------
# Areas
# ---------------------------------------------------------------------------
class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    active: bool = True


@router.get("/areas")
async def areas_list(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    areas = await db.areas.find({}, {"_id": 0}).to_list(1000)
    # Enrich with cab/screen counts
    for a in areas:
        a["cab_count"] = await db.cabs.count_documents({"area_id": a["area_id"]})
        a["screen_count"] = await db.screens.count_documents({"area_id": a["area_id"]})
    return {"areas": areas}


@router.post("/areas")
async def areas_create(body: AreaIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    exists = await db.areas.find_one({"name": body.name})
    if exists:
        raise HTTPException(status_code=409, detail="Area with this name already exists")
    doc = {
        "area_id": f"AREA-{uuid.uuid4().hex[:8].upper()}",
        **body.model_dump(),
        "created_at": utc_iso(),
        "updated_at": utc_iso(),
    }
    await db.areas.insert_one(doc)
    await audit(db, admin, "create", "area", doc["area_id"], {"name": body.name})
    return clean(doc)


@router.put("/areas/{area_id}")
async def areas_update(area_id: str, body: AreaIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    upd = {**body.model_dump(), "updated_at": utc_iso()}
    res = await db.areas.update_one({"area_id": area_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Area not found")
    await audit(db, admin, "update", "area", area_id, upd)
    doc = await db.areas.find_one({"area_id": area_id}, {"_id": 0})
    return doc


@router.delete("/areas/{area_id}")
async def areas_delete(area_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    in_use = await db.cabs.count_documents({"area_id": area_id})
    if in_use:
        raise HTTPException(status_code=409, detail=f"Area is used by {in_use} cab(s)")
    res = await db.areas.delete_one({"area_id": area_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Area not found")
    await audit(db, admin, "delete", "area", area_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Cabs
# ---------------------------------------------------------------------------
class CabIn(BaseModel):
    cab_number: str = Field(min_length=1)
    driver_name: Optional[str] = None
    driver_mobile: Optional[str] = None
    area_id: Optional[str] = None
    monthly_payment: Optional[float] = 0
    notes: Optional[str] = None
    active: bool = True


async def _enrich_cab(db, cab: dict) -> dict:
    if cab.get("area_id"):
        area = await db.areas.find_one({"area_id": cab["area_id"]}, {"_id": 0, "name": 1})
        cab["area_name"] = area["name"] if area else None
    screen = await db.screens.find_one({"cab_id": cab["cab_id"]}, {"_id": 0, "screen_id": 1, "last_seen": 1})
    cab["screen_id"] = screen["screen_id"] if screen else None
    cab["screen_last_seen"] = screen.get("last_seen") if screen else None
    return cab


@router.get("/cabs")
async def cabs_list(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    cabs = await db.cabs.find({}, {"_id": 0}).to_list(1000)
    for c in cabs:
        await _enrich_cab(db, c)
    return {"cabs": cabs}


@router.post("/cabs")
async def cabs_create(body: CabIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    if await db.cabs.find_one({"cab_number": body.cab_number}):
        raise HTTPException(status_code=409, detail="Cab number already exists")
    if body.area_id and not await db.areas.find_one({"area_id": body.area_id}):
        raise HTTPException(status_code=404, detail="Area not found")
    doc = {
        "cab_id": f"CAB-{uuid.uuid4().hex[:8].upper()}",
        **body.model_dump(),
        "created_at": utc_iso(),
        "updated_at": utc_iso(),
    }
    await db.cabs.insert_one(doc)
    await audit(db, admin, "create", "cab", doc["cab_id"], {"cab_number": body.cab_number})
    return await _enrich_cab(db, dict(doc, _id=None) and {k: v for k, v in doc.items() if k != "_id"})


@router.put("/cabs/{cab_id}")
async def cabs_update(cab_id: str, body: CabIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    existing = await db.cabs.find_one({"cab_id": cab_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Cab not found")
    if body.cab_number != existing.get("cab_number"):
        clash = await db.cabs.find_one({"cab_number": body.cab_number})
        if clash:
            raise HTTPException(status_code=409, detail="Cab number already exists")
    upd = {**body.model_dump(), "updated_at": utc_iso()}
    await db.cabs.update_one({"cab_id": cab_id}, {"$set": upd})
    # Propagate area_id to the associated screen too
    if body.area_id != existing.get("area_id"):
        await db.screens.update_many(
            {"cab_id": cab_id}, {"$set": {"area_id": body.area_id}}
        )
    await audit(db, admin, "update", "cab", cab_id, upd)
    cab = await db.cabs.find_one({"cab_id": cab_id}, {"_id": 0})
    return await _enrich_cab(db, cab)  # type: ignore


@router.delete("/cabs/{cab_id}")
async def cabs_delete(cab_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    # Soft-delete: mark inactive, DO NOT delete playback events.
    res = await db.cabs.update_one({"cab_id": cab_id}, {"$set": {"active": False, "deleted_at": utc_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cab not found")
    await audit(db, admin, "delete", "cab", cab_id)
    return {"ok": True, "soft_deleted": True}


# ---------------------------------------------------------------------------
# Screens & registration codes
# ---------------------------------------------------------------------------
class ScreenRegCodeIn(BaseModel):
    cab_id: Optional[str] = None
    area_id: Optional[str] = None
    expiry_hours: Optional[int] = None
    notes: Optional[str] = None


async def _enrich_screen(db, screen: dict, offline_threshold_seconds: int) -> dict:
    screen.pop("screen_token", None)
    cab = None
    if screen.get("cab_id"):
        cab = await db.cabs.find_one({"cab_id": screen["cab_id"]}, {"_id": 0})
    if cab:
        screen["cab_number"] = cab.get("cab_number")
        screen["driver_name"] = cab.get("driver_name")
    if screen.get("area_id"):
        area = await db.areas.find_one({"area_id": screen["area_id"]}, {"_id": 0, "name": 1})
        screen["area_name"] = area["name"] if area else None
    # Online status via last_seen
    last_seen = screen.get("last_seen")
    if not last_seen:
        screen["status"] = "never_connected"
    else:
        try:
            dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            delta = (utc_now() - dt).total_seconds()
            screen["status"] = "online" if delta <= offline_threshold_seconds else "offline"
            screen["seconds_since_seen"] = int(delta)
        except Exception:
            screen["status"] = "offline"
    return screen


@router.get("/screens")
async def screens_list(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    settings = await get_settings(db)
    thr = int(settings["offline_threshold_seconds"])
    screens = await db.screens.find({}, {"_id": 0}).to_list(1000)
    for s in screens:
        await _enrich_screen(db, s, thr)
    return {"screens": screens}


@router.get("/screens/{screen_id}")
async def screens_detail(screen_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    s = await db.screens.find_one({"screen_id": screen_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Screen not found")
    settings = await get_settings(db)
    await _enrich_screen(db, s, int(settings["offline_threshold_seconds"]))
    return s


@router.post("/screens/registration-codes")
async def create_registration_code(body: ScreenRegCodeIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    settings = await get_settings(db)
    hours = body.expiry_hours or int(settings["registration_code_expiry_hours"])
    if body.cab_id and not await db.cabs.find_one({"cab_id": body.cab_id}):
        raise HTTPException(status_code=404, detail="Cab not found")
    if body.area_id and not await db.areas.find_one({"area_id": body.area_id}):
        raise HTTPException(status_code=404, detail="Area not found")
    # If cab_id is present, hydrate area from the cab
    area_id = body.area_id
    if body.cab_id and not area_id:
        cab = await db.cabs.find_one({"cab_id": body.cab_id}, {"_id": 0, "area_id": 1})
        area_id = cab.get("area_id") if cab else None

    code = _gen_code("REG")
    expires_at = (utc_now() + timedelta(hours=hours)).isoformat()
    doc = {
        "registration_code": code,
        "cab_id": body.cab_id,
        "area_id": area_id,
        "expiry_hours": hours,
        "expires_at": expires_at,
        "notes": body.notes,
        "status": "pending",
        "used": False,
        "created_at": utc_iso(),
    }
    await db.registration_codes.insert_one(doc)
    await audit(db, admin, "create", "registration_code", code, {"cab_id": body.cab_id, "area_id": area_id})
    return clean(doc)


@router.get("/screens/registration-codes/list")
async def list_registration_codes(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    codes = await db.registration_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Compute expired
    for c in codes:
        if c.get("used"):
            c["status"] = "used"
        elif c.get("expires_at") and datetime.fromisoformat(c["expires_at"].replace("Z", "+00:00")) < utc_now():
            c["status"] = "expired"
        else:
            c["status"] = "pending"
    return {"registration_codes": codes}


@router.delete("/screens/registration-codes/{code}")
async def revoke_registration_code(code: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    res = await db.registration_codes.update_one(
        {"registration_code": code, "used": False},
        {"$set": {"revoked": True, "expires_at": utc_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code not found or already used")
    await audit(db, admin, "revoke", "registration_code", code)
    return {"ok": True}


@router.post("/screens/{screen_id}/unregister")
async def unregister_screen(screen_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    s = await db.screens.find_one({"screen_id": screen_id})
    if not s:
        raise HTTPException(status_code=404, detail="Screen not found")
    # Rotate token so the physical tablet is forced to re-register
    await db.screens.update_one(
        {"screen_id": screen_id},
        {"$set": {"screen_token": f"UNREGISTERED-{uuid.uuid4().hex}", "disabled": True, "unregistered_at": utc_iso()}},
    )
    await audit(db, admin, "unregister", "screen", screen_id)
    return {"ok": True}


class ScreenCommandIn(BaseModel):
    command: Literal["SYNC_PLAYLIST", "CLEAR_CACHE", "RESTART_PLAYER", "RECONNECT", "DISABLE_SCREEN"]
    payload: Optional[Dict[str, Any]] = None


@router.post("/screens/{screen_id}/commands")
async def send_screen_command(screen_id: str, body: ScreenCommandIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    if not await db.screens.find_one({"screen_id": screen_id}):
        raise HTTPException(status_code=404, detail="Screen not found")
    doc = {
        "command_id": f"CMD-{uuid.uuid4().hex[:10].upper()}",
        "screen_id": screen_id,
        "command": body.command,
        "payload": body.payload or {},
        "status": "pending",
        "created_at": utc_iso(),
    }
    await db.commands.insert_one(doc)
    await audit(db, admin, "issue_command", "screen", screen_id, {"command": body.command})
    return {"ok": True, "command_id": doc["command_id"]}


# ---------------------------------------------------------------------------
# Media library (metadata only — no Cloudinary in this iteration)
# ---------------------------------------------------------------------------
class MediaIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    media_url: str
    media_type: Literal["image", "video"]
    duration: Optional[int] = None  # seconds
    file_size_bytes: Optional[int] = None
    dimensions: Optional[str] = None  # e.g. "1920x1080"
    active: bool = True


@router.get("/media")
async def media_list(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    items = await db.media.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"media": items}


@router.post("/media")
async def media_create(body: MediaIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    doc = {
        "media_id": f"MED-{uuid.uuid4().hex[:8].upper()}",
        **body.model_dump(),
        "created_at": utc_iso(),
        "updated_at": utc_iso(),
    }
    await db.media.insert_one(doc)
    await audit(db, admin, "create", "media", doc["media_id"], {"title": body.title})
    return clean(dict(doc))


@router.put("/media/{media_id}")
async def media_update(media_id: str, body: MediaIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    upd = {**body.model_dump(), "updated_at": utc_iso()}
    res = await db.media.update_one({"media_id": media_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Media not found")
    await audit(db, admin, "update", "media", media_id)
    return await db.media.find_one({"media_id": media_id}, {"_id": 0})


@router.delete("/media/{media_id}")
async def media_delete(media_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    # Prevent delete if referenced by any active playlist item
    in_use = await db.playlists.count_documents({"advertisements.media_id": media_id})
    if in_use:
        raise HTTPException(status_code=409, detail=f"Media in use by {in_use} playlist(s)")
    res = await db.media.delete_one({"media_id": media_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Media not found")
    await audit(db, admin, "delete", "media", media_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------
class CampaignIn(BaseModel):
    name: str
    advertiser: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    priority: int = 100
    media_ids: List[str] = []
    area_ids: List[str] = []
    screen_ids: List[str] = []
    status: Literal["draft", "scheduled", "active", "paused", "completed"] = "draft"


@router.get("/campaigns")
async def campaigns_list(request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    items = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"campaigns": items}


@router.post("/campaigns")
async def campaigns_create(body: CampaignIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    doc = {
        "campaign_id": f"CMP-{uuid.uuid4().hex[:8].upper()}",
        **body.model_dump(),
        "created_at": utc_iso(),
        "updated_at": utc_iso(),
    }
    await db.campaigns.insert_one(doc)
    await audit(db, admin, "create", "campaign", doc["campaign_id"], {"name": body.name})
    return clean(dict(doc))


@router.put("/campaigns/{campaign_id}")
async def campaigns_update(campaign_id: str, body: CampaignIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    upd = {**body.model_dump(), "updated_at": utc_iso()}
    res = await db.campaigns.update_one({"campaign_id": campaign_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await audit(db, admin, "update", "campaign", campaign_id)
    return await db.campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})


@router.delete("/campaigns/{campaign_id}")
async def campaigns_delete(campaign_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    # Soft-delete: keep historical playback events meaningful
    res = await db.campaigns.update_one(
        {"campaign_id": campaign_id}, {"$set": {"status": "deleted", "deleted_at": utc_iso()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await audit(db, admin, "delete", "campaign", campaign_id)
    return {"ok": True, "soft_deleted": True}


# ---------------------------------------------------------------------------
# Playlist assignment (per-screen)
# ---------------------------------------------------------------------------
class PlaylistItemIn(BaseModel):
    media_id: str
    campaign_id: Optional[str] = None
    duration: int = 10
    priority: int = 100


class PublishPlaylistIn(BaseModel):
    items: List[PlaylistItemIn]


@router.get("/playlists/{screen_id}")
async def playlist_get(screen_id: str, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    if not await db.screens.find_one({"screen_id": screen_id}):
        raise HTTPException(status_code=404, detail="Screen not found")
    pl = await db.playlists.find_one({"screen_id": screen_id}, {"_id": 0})
    return pl or {"screen_id": screen_id, "playlist_version": 0, "advertisements": []}


@router.put("/playlists/{screen_id}")
async def playlist_publish(screen_id: str, body: PublishPlaylistIn, request: Request, admin=Depends(get_current_admin)):
    db = request.app.state.db
    screen = await db.screens.find_one({"screen_id": screen_id})
    if not screen:
        raise HTTPException(status_code=404, detail="Screen not found")

    ads: List[dict] = []
    for it in body.items:
        media = await db.media.find_one({"media_id": it.media_id}, {"_id": 0})
        if not media:
            raise HTTPException(status_code=404, detail=f"Media {it.media_id} not found")
        ads.append(
            {
                "advertisement_id": f"AD-{uuid.uuid4().hex[:8].upper()}",
                "media_id": it.media_id,
                "campaign_id": it.campaign_id or "default",
                "media_url": media["media_url"],
                "media_type": media["media_type"],
                "duration": it.duration or media.get("duration") or 10,
                "priority": it.priority,
            }
        )
    new_version = int(screen.get("playlist_version", 0)) + 1
    await db.playlists.update_one(
        {"screen_id": screen_id},
        {
            "$set": {
                "screen_id": screen_id,
                "playlist_version": new_version,
                "advertisements": ads,
                "updated_at": utc_iso(),
            }
        },
        upsert=True,
    )
    await db.screens.update_one({"screen_id": screen_id}, {"$set": {"playlist_version": new_version}})
    await audit(db, admin, "publish", "playlist", screen_id, {"version": new_version, "count": len(ads)})
    return {"ok": True, "playlist_version": new_version, "items": len(ads)}


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
def _range_from_query(range_key: str) -> Optional[str]:
    now = utc_now()
    ranges = {
        "today": now.replace(hour=0, minute=0, second=0, microsecond=0),
        "yesterday": (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0),
        "7d": now - timedelta(days=7),
        "30d": now - timedelta(days=30),
    }
    if range_key not in ranges:
        return None
    return ranges[range_key].isoformat()


@router.get("/analytics/overview")
async def analytics_overview(request: Request, range: str = "7d", admin=Depends(get_current_admin)):
    db = request.app.state.db
    since = _range_from_query(range) or _range_from_query("7d")
    settings = await get_settings(db)
    thr = int(settings["offline_threshold_seconds"])
    now = utc_now()

    total_screens = await db.screens.count_documents({})
    total_cabs = await db.cabs.count_documents({"active": True})
    total_areas = await db.areas.count_documents({"active": True})
    active_campaigns = await db.campaigns.count_documents({"status": "active"})

    # Online screens via last_seen
    screens = await db.screens.find({}, {"_id": 0, "last_seen": 1}).to_list(1000)
    online = 0
    offline = 0
    never = 0
    for s in screens:
        ls = s.get("last_seen")
        if not ls:
            never += 1
            continue
        try:
            dt = datetime.fromisoformat(ls.replace("Z", "+00:00"))
            if (now - dt).total_seconds() <= thr:
                online += 1
            else:
                offline += 1
        except Exception:
            offline += 1

    # Playback events aggregation.
    # Impression definition: a playback event whose completion_percentage >= 80.
    pipeline_plays = [
        {"$match": {"received_at": {"$gte": since}}},
        {
            "$group": {
                "_id": None,
                "plays": {"$sum": 1},
                "completed": {
                    "$sum": {
                        "$cond": [{"$gte": ["$completion_percentage", 80]}, 1, 0]
                    }
                },
                "duration_seconds": {"$sum": "$duration_played"},
            }
        },
    ]
    agg = await db.playback_events.aggregate(pipeline_plays).to_list(1)
    plays = agg[0]["plays"] if agg else 0
    completed = agg[0]["completed"] if agg else 0
    duration_seconds = agg[0]["duration_seconds"] if agg else 0

    # Screens needing attention: offline + no playlist + very old sync
    attention = offline + never

    return {
        "range": range,
        "totals": {
            "screens": total_screens,
            "online": online,
            "offline": offline,
            "never_connected": never,
            "cabs": total_cabs,
            "areas": total_areas,
            "active_campaigns": active_campaigns,
            "plays": plays,
            "completed_plays": completed,
            "completion_rate": (completed / plays * 100) if plays else 0,
            "hours_played": round(duration_seconds / 3600, 2),
            "screens_attention": attention,
        },
    }


@router.get("/analytics/campaigns")
async def analytics_campaigns(request: Request, range: str = "7d", admin=Depends(get_current_admin)):
    db = request.app.state.db
    since = _range_from_query(range) or _range_from_query("7d")
    pipeline = [
        {"$match": {"received_at": {"$gte": since}}},
        {
            "$group": {
                "_id": "$campaign_id",
                "plays": {"$sum": 1},
                "completed": {"$sum": {"$cond": [{"$gte": ["$completion_percentage", 80]}, 1, 0]}},
                "duration_seconds": {"$sum": "$duration_played"},
                "screens": {"$addToSet": "$screen_id"},
            }
        },
        {
            "$project": {
                "campaign_id": "$_id",
                "_id": 0,
                "plays": 1,
                "completed": 1,
                "duration_seconds": 1,
                "screens_count": {"$size": "$screens"},
            }
        },
        {"$sort": {"plays": -1}},
    ]
    rows = await db.playback_events.aggregate(pipeline).to_list(200)
    return {"campaigns": rows}


@router.get("/analytics/screens")
async def analytics_screens(request: Request, range: str = "7d", admin=Depends(get_current_admin)):
    db = request.app.state.db
    since = _range_from_query(range) or _range_from_query("7d")
    pipeline = [
        {"$match": {"received_at": {"$gte": since}}},
        {
            "$group": {
                "_id": "$screen_id",
                "plays": {"$sum": 1},
                "duration_seconds": {"$sum": "$duration_played"},
            }
        },
        {"$project": {"screen_id": "$_id", "_id": 0, "plays": 1, "duration_seconds": 1}},
        {"$sort": {"plays": -1}},
    ]
    rows = await db.playback_events.aggregate(pipeline).to_list(200)
    return {"screens": rows}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
@router.get("/audit")
async def audit_list(request: Request, limit: int = Query(default=200, le=1000), admin=Depends(get_current_admin)):
    db = request.app.state.db
    rows = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"audit_logs": rows}
