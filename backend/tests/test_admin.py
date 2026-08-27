"""QwickAds Super Admin - backend tests (Iteration 2)."""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://cab-display-ads.preview.emergentagent.com").rstrip("/")
ADMIN_HEADER = {"X-Admin-Token": "qwickads-super-admin-dev-token"}
SEED_EMAIL = "admin@qwickads.com"
SEED_PASS = "ChangeMe@2026"

# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def jwt_token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": SEED_EMAIL, "password": SEED_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == SEED_EMAIL
    assert data["user"]["role"] == "super_admin"
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(jwt_token):
    return {"Authorization": f"Bearer {jwt_token}"}


def test_login_wrong_password():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": SEED_EMAIL, "password": "WrongPass!"}, timeout=15)
    assert r.status_code == 401


def test_auth_me(auth_headers):
    r = requests.get(f"{BASE}/api/auth/me", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == SEED_EMAIL
    assert data["role"] == "super_admin"


def test_endpoints_require_auth():
    for path in ["/api/areas", "/api/cabs", "/api/media", "/api/campaigns",
                 "/api/settings", "/api/audit", "/api/screens"]:
        r = requests.get(f"{BASE}{path}", timeout=15)
        assert r.status_code == 401, f"{path} did not 401 without auth (got {r.status_code})"


def test_admin_token_grants_access():
    r = requests.get(f"{BASE}/api/areas", headers=ADMIN_HEADER, timeout=15)
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Areas CRUD
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def area(auth_headers):
    name = f"TEST_AREA_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE}/api/areas",
                      json={"name": name, "city": "TestCity", "active": True},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == name
    assert data["area_id"].startswith("AREA-")
    yield data
    # Cleanup best-effort
    requests.delete(f"{BASE}/api/areas/{data['area_id']}", headers=auth_headers, timeout=15)


def test_areas_list(auth_headers, area):
    r = requests.get(f"{BASE}/api/areas", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    ids = [a["area_id"] for a in r.json()["areas"]]
    assert area["area_id"] in ids


def test_areas_update(auth_headers, area):
    r = requests.put(f"{BASE}/api/areas/{area['area_id']}",
                     json={"name": area["name"], "city": "UpdatedCity", "active": True},
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["city"] == "UpdatedCity"


# ---------------------------------------------------------------------------
# Cabs CRUD
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def cab(auth_headers, area):
    num = f"TESTCAB_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE}/api/cabs",
                      json={"cab_number": num, "driver_name": "Test Driver",
                            "area_id": area["area_id"], "active": True},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["cab_number"] == num
    assert data["cab_id"].startswith("CAB-")
    yield data
    requests.delete(f"{BASE}/api/cabs/{data['cab_id']}", headers=auth_headers, timeout=15)


def test_cabs_duplicate_number(auth_headers, cab):
    r = requests.post(f"{BASE}/api/cabs",
                      json={"cab_number": cab["cab_number"], "active": True},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 409


def test_areas_delete_blocked_when_cabs(auth_headers, area, cab):
    # Should fail (cab references area)
    r = requests.delete(f"{BASE}/api/areas/{area['area_id']}",
                        headers=auth_headers, timeout=15)
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Registration codes + screen register + unregister
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def reg_code(auth_headers, cab):
    r = requests.post(f"{BASE}/api/screens/registration-codes",
                      json={"cab_id": cab["cab_id"]},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["registration_code"].startswith("REG-")
    assert d["expires_at"]
    assert d["area_id"] == cab.get("area_id")
    return d


@pytest.fixture(scope="module")
def registered_screen(reg_code):
    r = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": reg_code["registration_code"],
                            "device_model": "TEST"},
                      timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["screen_id"].startswith("QA-SCR-")
    assert d["screen_token"]
    return d


def test_reg_code_single_use(reg_code, registered_screen):
    r = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": reg_code["registration_code"]},
                      timeout=15)
    assert r.status_code == 409


def test_reg_code_revoke(auth_headers):
    r = requests.post(f"{BASE}/api/screens/registration-codes",
                      json={"expiry_hours": 24},
                      headers=auth_headers, timeout=15)
    code = r.json()["registration_code"]
    rev = requests.delete(f"{BASE}/api/screens/registration-codes/{code}",
                          headers=auth_headers, timeout=15)
    assert rev.status_code == 200
    # Attempt to use revoked code
    r2 = requests.post(f"{BASE}/api/screens/register",
                       json={"registration_code": code}, timeout=15)
    assert r2.status_code == 410


def test_unregister_invalidates_token(auth_headers, registered_screen):
    sid = registered_screen["screen_id"]
    tok = registered_screen["screen_token"]
    # unregister
    r = requests.post(f"{BASE}/api/screens/{sid}/unregister",
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200
    # subsequent player calls with old token should fail
    r2 = requests.get(f"{BASE}/api/screens/{sid}/playlist",
                      headers={"X-Screen-Token": tok}, timeout=15)
    assert r2.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Media + Playlists
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def media(auth_headers):
    r = requests.post(f"{BASE}/api/media",
                      json={"title": f"TEST_MEDIA_{uuid.uuid4().hex[:6]}",
                            "media_url": "https://picsum.photos/1280/720",
                            "media_type": "image", "duration": 8, "active": True},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["media_id"].startswith("MED-")
    return d


@pytest.fixture(scope="module")
def screen_for_playlist(auth_headers, cab):
    # Fresh reg code + register — don't reuse unregistered_screen
    r = requests.post(f"{BASE}/api/screens/registration-codes",
                      json={"cab_id": cab["cab_id"]},
                      headers=auth_headers, timeout=15)
    code = r.json()["registration_code"]
    r2 = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": code}, timeout=15)
    assert r2.status_code == 200, r2.text
    return r2.json()


def test_publish_playlist_and_player_reads(auth_headers, media, screen_for_playlist):
    sid = screen_for_playlist["screen_id"]
    tok = screen_for_playlist["screen_token"]
    r = requests.put(f"{BASE}/api/playlists/{sid}",
                     json={"items": [{"media_id": media["media_id"], "duration": 10}]},
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200
    version = r.json()["playlist_version"]
    assert version >= 1
    # Player fetches
    r2 = requests.get(f"{BASE}/api/screens/{sid}/playlist",
                      headers={"X-Screen-Token": tok}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["playlist_version"] == version
    ads = r2.json()["advertisements"]
    assert len(ads) == 1
    assert ads[0]["media_url"] == "https://picsum.photos/1280/720"


def test_publish_unknown_media_404(auth_headers, screen_for_playlist):
    r = requests.put(f"{BASE}/api/playlists/{screen_for_playlist['screen_id']}",
                     json={"items": [{"media_id": "MED-NOPE", "duration": 5}]},
                     headers=auth_headers, timeout=15)
    assert r.status_code == 404


def test_media_delete_blocked_when_in_playlist(auth_headers, media, screen_for_playlist):
    r = requests.delete(f"{BASE}/api/media/{media['media_id']}",
                        headers=auth_headers, timeout=15)
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------
def test_campaigns_crud(auth_headers):
    r = requests.post(f"{BASE}/api/campaigns",
                      json={"name": f"TEST_CMP_{uuid.uuid4().hex[:6]}",
                            "priority": 100, "status": "draft"},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200
    cid = r.json()["campaign_id"]
    lst = requests.get(f"{BASE}/api/campaigns", headers=auth_headers, timeout=15)
    assert lst.status_code == 200
    assert any(c["campaign_id"] == cid for c in lst.json()["campaigns"])
    d = requests.delete(f"{BASE}/api/campaigns/{cid}",
                        headers=auth_headers, timeout=15)
    assert d.status_code == 200


# ---------------------------------------------------------------------------
# Analytics + Settings + Audit
# ---------------------------------------------------------------------------
def test_analytics_overview(auth_headers):
    r = requests.get(f"{BASE}/api/analytics/overview?range=7d",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200
    totals = r.json()["totals"]
    for k in ["screens", "online", "offline", "never_connected",
              "cabs", "areas", "plays", "completed_plays"]:
        assert k in totals


def test_settings_get_put(auth_headers):
    r = requests.get(f"{BASE}/api/settings", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    original = r.json()["offline_threshold_seconds"]
    new_val = original + 10
    r2 = requests.put(f"{BASE}/api/settings",
                      json={"offline_threshold_seconds": new_val},
                      headers=auth_headers, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["offline_threshold_seconds"] == new_val
    # Restore
    requests.put(f"{BASE}/api/settings",
                 json={"offline_threshold_seconds": original},
                 headers=auth_headers, timeout=15)


def test_audit_records_settings_change(auth_headers):
    r = requests.get(f"{BASE}/api/audit?limit=50", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    logs = r.json()["audit_logs"]
    assert any(l.get("entity") == "settings" for l in logs)


# ---------------------------------------------------------------------------
# Change password — rotates password_version -> old JWT invalidated
# ---------------------------------------------------------------------------
def test_change_password_rotates_pwdv():
    # Login separately so we don't break other module fixtures
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": SEED_EMAIL, "password": SEED_PASS}, timeout=15)
    assert r.status_code == 200
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    new_pass = "ChangeMe@2026-tmp"
    # Change
    r2 = requests.post(f"{BASE}/api/auth/change-password",
                       json={"current_password": SEED_PASS, "new_password": new_pass},
                       headers=h, timeout=15)
    assert r2.status_code == 200
    # Old JWT should now be invalid
    r3 = requests.get(f"{BASE}/api/auth/me", headers=h, timeout=15)
    assert r3.status_code == 401
    # Login with new
    r4 = requests.post(f"{BASE}/api/auth/login",
                       json={"email": SEED_EMAIL, "password": new_pass}, timeout=15)
    assert r4.status_code == 200
    tok2 = r4.json()["access_token"]
    # Restore original password
    r5 = requests.post(f"{BASE}/api/auth/change-password",
                       json={"current_password": new_pass, "new_password": SEED_PASS},
                       headers={"Authorization": f"Bearer {tok2}"}, timeout=15)
    assert r5.status_code == 200


# ---------------------------------------------------------------------------
# Integration flow: reg code -> register -> publish -> command -> ack
# ---------------------------------------------------------------------------
def test_full_integration_flow(area, media):
    # Refresh token (change-password test may have rotated password_version)
    login = requests.post(f"{BASE}/api/auth/login",
                          json={"email": SEED_EMAIL, "password": SEED_PASS}, timeout=15)
    assert login.status_code == 200
    auth_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    # Create fresh cab
    num = f"TESTFLOW_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE}/api/cabs",
                      json={"cab_number": num, "area_id": area["area_id"], "active": True},
                      headers=auth_headers, timeout=15)
    assert r.status_code == 200
    cid = r.json()["cab_id"]
    # Gen reg code
    r2 = requests.post(f"{BASE}/api/screens/registration-codes",
                       json={"cab_id": cid}, headers=auth_headers, timeout=15)
    code = r2.json()["registration_code"]
    # Register screen
    r3 = requests.post(f"{BASE}/api/screens/register",
                       json={"registration_code": code}, timeout=15)
    assert r3.status_code == 200
    sid, tok = r3.json()["screen_id"], r3.json()["screen_token"]
    # Publish
    r4 = requests.put(f"{BASE}/api/playlists/{sid}",
                      json={"items": [{"media_id": media["media_id"], "duration": 5}]},
                      headers=auth_headers, timeout=15)
    assert r4.status_code == 200
    # Heartbeat
    r5 = requests.post(f"{BASE}/api/screens/heartbeat",
                       json={"screen_id": sid, "app_version": "1.0.0"},
                       headers={"X-Screen-Token": tok}, timeout=15)
    assert r5.status_code == 200
    # Command
    r6 = requests.post(f"{BASE}/api/screens/{sid}/commands",
                       json={"command": "SYNC_PLAYLIST"},
                       headers=auth_headers, timeout=15)
    assert r6.status_code == 200
    cmd_id = r6.json()["command_id"]
    # Player fetches
    r7 = requests.get(f"{BASE}/api/screens/{sid}/commands",
                      headers={"X-Screen-Token": tok}, timeout=15)
    assert r7.status_code == 200
    assert any(c["command_id"] == cmd_id for c in r7.json()["commands"])
    # Ack
    r8 = requests.post(f"{BASE}/api/screens/{sid}/commands/{cmd_id}/ack",
                       headers={"X-Screen-Token": tok}, timeout=15)
    assert r8.status_code == 200
    # Cleanup soft-delete cab
    requests.delete(f"{BASE}/api/cabs/{cid}", headers=auth_headers, timeout=15)
