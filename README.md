# QwickAds Power Player

A production-oriented **Android digital signage player** built with Expo Router (React Native) and a FastAPI + MongoDB backend. Designed for the **Lenovo Tab M10** in permanent-mount in-cab advertising displays.

Its only job: **DOWNLOAD → CACHE → PLAY → REPORT → REPEAT.**

---

## Architecture

```
QwickAds Power Player (Android tablet)   <— screen_token —>   FastAPI backend  ← admin_token ←   QwickAds Super Admin
                                                                    |
                                                                    ├── MongoDB (screens, playlists, playback_events, commands, registration_codes)
                                                                    └── Cloudinary URLs (returned to player, not credentials)
```

- **Screen identity** (`screen_id` + `screen_token`) is generated on registration and stored in Android Keystore via `expo-secure-store`.
- Screens **cannot** access admin endpoints. Admin endpoints require the `X-Admin-Token` header.
- Media is downloaded once and played from local device storage for every subsequent loop (offline-first).

### Modules

| Layer | File | Responsibility |
|------|------|---------------|
| API client | `src/services/api.ts` | Typed calls to backend, screen-token headers, timeouts |
| Secure storage | `src/services/secure-storage.ts` | Persist screen identity in Keystore |
| Media cache | `src/services/media-cache.ts` | Download-once → local file, cleanup, versioned playlist store |
| Playback queue | `src/services/playback-queue.ts` | Offline-first playback event batching |
| Registration | `app/register.tsx` | First-launch pairing UI |
| Player | `app/player.tsx` | Fullscreen distraction-free playback engine, heartbeat, commands |
| Maintenance | `app/maintenance.tsx` | PIN-gated diagnostics + actions (5-tap corner to open) |

---

## Backend API

`EXPO_PUBLIC_BACKEND_URL` (frontend `.env`) points at the FastAPI service. All routes are prefixed `/api`.

### Admin (Super Admin panel) — requires `X-Admin-Token`
- `POST /api/admin/screens/create-code` — mint a `REG-XXXXXX` code (optional cab_number/area).
- `GET  /api/admin/screens` — list screens (no tokens exposed).
- `POST /api/admin/screens/{screen_id}/playlist` — publish a new playlist. Bumps `playlist_version`.
- `POST /api/admin/screens/{screen_id}/commands` — queue a `SYNC_PLAYLIST` / `CLEAR_CACHE` / `RESTART_PLAYER` / `DISABLE_SCREEN` command.

### Screen (Player) — requires `X-Screen-Token`
- `POST /api/screens/register` — exchange registration code for `screen_id` + `screen_token`.
- `GET  /api/screens/{screen_id}/playlist`
- `POST /api/screens/heartbeat` — sends `current_ad_id`, storage, etc; returns `playlist_version`.
- `POST /api/playback/batch` — batch upload playback events (offline-safe).
- `GET  /api/screens/{screen_id}/commands` — pending remote commands.
- `POST /api/screens/{screen_id}/commands/{command_id}/ack`

Public:
- `GET /api/health`

---

## Running locally

The Emergent preview already runs `frontend` (Expo) on port 3000 and `backend` (FastAPI) on port 8001.

### 1. Mint a registration code (Super Admin action)
```bash
curl -X POST "$EXPO_PUBLIC_BACKEND_URL/api/admin/screens/create-code" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: qwickads-super-admin-dev-token" \
  -d '{"cab_number":"CAB-001","area":"Bangalore"}'
```

### 2. Register on the tablet
Enter the returned `REG-XXXXXX` code on the Registration screen and tap **Activate Screen**.

### 3. Publish a playlist
```bash
curl -X POST "$EXPO_PUBLIC_BACKEND_URL/api/admin/screens/QA-SCR-000001/playlist" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: qwickads-super-admin-dev-token" \
  -d '{
        "advertisements": [
          {"media_url":"https://sample-videos.com/img/Sample-jpg-image-1mb.jpg","media_type":"image","duration":8,"campaign_id":"welcome"},
          {"media_url":"https://download.samplelib.com/mp4/sample-5s.mp4","media_type":"video","duration":5,"campaign_id":"welcome"}
        ]
      }'
```
The player will pick this up on its next heartbeat (≤ 60 s) or immediately during the 5-minute periodic sync.

---

## Offline-first guarantees

- Cached playlist is loaded from AsyncStorage **before** any network call at cold start.
- Every ad is downloaded to `documentDirectory/qwickads_media/` and played from disk on every loop.
- Playback events are queued locally and batch-uploaded (`/api/playback/batch`) when connectivity returns.
- **Safe playlist switching**: a new playlist replaces the current one *only after* all its media has been downloaded successfully. A failed download never breaks the currently-playing loop.

---

## Kiosk / auto-boot notes (Lenovo Tab M10 APK)

Not possible from Expo Go — the following require a **native/dev APK build**:

- **Landscape lock**: enforced at runtime via `expo-screen-orientation` and declared in `app.json`.
- **Keep screen awake**: `expo-keep-awake` is active on the Player screen.
- **Immersive fullscreen**: `expo-status-bar` hides the status bar; on Android edge-to-edge is enabled in `app.json`.
- **Auto-launch after boot**: add a `BOOT_COMPLETED` broadcast receiver in a custom Expo config plugin, or set the app as **device owner** via `adb shell dpm set-device-owner com.qwickads.powerplayer/.AdminReceiver` and use lock-task mode.
- **True kiosk (block Home / back)**: only possible when the app is a **device owner** and calls `startLockTask()`. Document this in your MDM playbook. A normal Android app cannot fully prevent exit.

Permissions declared in `app.json → android.permissions`: `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`.

---

## Maintenance

- Tap the **top-left corner 5 times** within 2 s while playing to open the Maintenance screen.
- Default PIN: **`1234`** (change `MAINTENANCE_PIN` in `app/maintenance.tsx` and ship via config).
- Actions: Sync Now · Reconnect · Clear Cache · Unregister Screen · Return to Player.

---

## Security

- Only screen tokens are ever stored on the device.
- `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` are **never** shipped with the player.
- All backend calls are HTTPS via `EXPO_PUBLIC_BACKEND_URL`.
