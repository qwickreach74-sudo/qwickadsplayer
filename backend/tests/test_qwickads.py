"""QwickAds Power Player - backend regression tests."""
import os, uuid, pytest, requests

BASE = "https://cab-display-ads.preview.emergentagent.com".rstrip("/")
ADMIN = {"X-Admin-Token": "qwickads-super-admin-dev-token"}

@pytest.fixture(scope="module")
def code():
    r = requests.post(f"{BASE}/api/admin/screens/create-code",
                      json={"cab_number": f"TEST_{uuid.uuid4().hex[:6]}", "area": "TEST"},
                      headers=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["registration_code"]

@pytest.fixture(scope="module")
def registered(code):
    r = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": code, "device_model": "TEST"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()

# ---- Health & admin auth ----
def test_health():
    r = requests.get(f"{BASE}/api/health", timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "ok"

def test_admin_requires_token():
    r = requests.post(f"{BASE}/api/admin/screens/create-code", json={}, timeout=15)
    assert r.status_code == 401

def test_admin_create_code(code):
    assert code.startswith("REG-")

# ---- Registration ----
def test_register_invalid_code():
    r = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": "REG-NOPEXX"}, timeout=15)
    assert r.status_code == 404

def test_register_returns_screen(registered):
    assert registered["screen_id"].startswith("QA-SCR-")
    assert len(registered["screen_id"]) == 13  # QA-SCR-000000
    assert registered["screen_token"]

def test_register_code_single_use(code):
    r = requests.post(f"{BASE}/api/screens/register",
                      json={"registration_code": code}, timeout=15)
    assert r.status_code == 409

# ---- Playlist auth ----
def test_playlist_requires_token(registered):
    r = requests.get(f"{BASE}/api/screens/{registered['screen_id']}/playlist", timeout=15)
    assert r.status_code == 401

def test_playlist_wrong_token(registered):
    r = requests.get(f"{BASE}/api/screens/{registered['screen_id']}/playlist",
                     headers={"X-Screen-Token": "bad"}, timeout=15)
    assert r.status_code == 401

def test_playlist_empty_initially(registered):
    r = requests.get(f"{BASE}/api/screens/{registered['screen_id']}/playlist",
                     headers={"X-Screen-Token": registered["screen_token"]}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["playlist_version"] == 0
    assert d["advertisements"] == []

# ---- Publish playlist ----
def test_publish_and_get_playlist(registered):
    ads = [{"advertisement_id": "AD-T1", "campaign_id": "c1",
            "media_url": "https://picsum.photos/1280/720",
            "media_type": "image", "duration": 5, "priority": 100}]
    r = requests.post(f"{BASE}/api/admin/screens/{registered['screen_id']}/playlist",
                      json={"advertisements": ads}, headers=ADMIN, timeout=15)
    assert r.status_code == 200
    v = r.json()["playlist_version"]
    assert v >= 1
    # verify via GET
    r2 = requests.get(f"{BASE}/api/screens/{registered['screen_id']}/playlist",
                      headers={"X-Screen-Token": registered["screen_token"]}, timeout=15)
    assert r2.status_code == 200
    d = r2.json()
    assert d["playlist_version"] == v
    assert len(d["advertisements"]) == 1
    assert d["advertisements"][0]["advertisement_id"] == "AD-T1"

# ---- Heartbeat ----
def test_heartbeat(registered):
    r = requests.post(f"{BASE}/api/screens/heartbeat",
                      json={"screen_id": registered["screen_id"], "app_version": "1.0.0"},
                      headers={"X-Screen-Token": registered["screen_token"]}, timeout=15)
    assert r.status_code == 200
    assert "playlist_version" in r.json()

def test_heartbeat_no_token(registered):
    r = requests.post(f"{BASE}/api/screens/heartbeat",
                      json={"screen_id": registered["screen_id"]}, timeout=15)
    assert r.status_code == 401

# ---- Playback batch ----
def test_playback_batch(registered):
    ev = {"advertisement_id": "AD-T1", "campaign_id": "c1",
          "started_at": "2026-01-01T00:00:00Z", "completed_at": "2026-01-01T00:00:05Z",
          "duration_played": 5.0, "completion_percentage": 100.0}
    r = requests.post(f"{BASE}/api/playback/batch",
                      json={"screen_id": registered["screen_id"], "events": [ev]},
                      headers={"X-Screen-Token": registered["screen_token"]}, timeout=15)
    assert r.status_code == 200 and r.json()["inserted"] == 1

def test_playback_batch_requires_token(registered):
    r = requests.post(f"{BASE}/api/playback/batch",
                      json={"screen_id": registered["screen_id"], "events": []}, timeout=15)
    assert r.status_code == 401

# ---- Commands ----
def test_command_lifecycle(registered):
    sid, tok = registered["screen_id"], registered["screen_token"]
    r = requests.post(f"{BASE}/api/admin/screens/{sid}/commands",
                      json={"command": "SYNC_PLAYLIST"}, headers=ADMIN, timeout=15)
    assert r.status_code == 200
    cid = r.json()["command_id"]
    r2 = requests.get(f"{BASE}/api/screens/{sid}/commands",
                      headers={"X-Screen-Token": tok}, timeout=15)
    assert r2.status_code == 200
    assert any(c["command_id"] == cid for c in r2.json()["commands"])
    r3 = requests.post(f"{BASE}/api/screens/{sid}/commands/{cid}/ack",
                       headers={"X-Screen-Token": tok}, timeout=15)
    assert r3.status_code == 200
    r4 = requests.get(f"{BASE}/api/screens/{sid}/commands",
                      headers={"X-Screen-Token": tok}, timeout=15)
    assert not any(c["command_id"] == cid for c in r4.json()["commands"])

# ---- Cross-screen isolation ----
def test_cross_screen_isolation(registered):
    r = requests.post(f"{BASE}/api/admin/screens/create-code",
                      json={"cab_number": f"TEST_ISO_{uuid.uuid4().hex[:4]}"},
                      headers=ADMIN, timeout=15)
    code2 = r.json()["registration_code"]
    r2 = requests.post(f"{BASE}/api/screens/register",
                       json={"registration_code": code2}, timeout=15).json()
    # Try to fetch screen A's playlist using screen B's token
    r3 = requests.get(f"{BASE}/api/screens/{registered['screen_id']}/playlist",
                      headers={"X-Screen-Token": r2["screen_token"]}, timeout=15)
    assert r3.status_code == 401
