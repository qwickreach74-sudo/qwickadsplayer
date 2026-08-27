# QwickAds Power Player – PRD

## Product
Android digital signage **player** for Lenovo Tab M10 tablets in in-cab advertising. Distraction-free, kiosk-oriented, offline-first. Runs 24/7 in landscape. Ships as an Expo Router (React Native) app with a shared FastAPI + MongoDB backend that is also consumed by a separate QwickAds Super Admin web app.

## Non-goals
No consumer features, no dashboards inside the player, no advertisement targeting logic on device, no admin console inside the player. The tablet only follows the playlist assigned by the backend.

## Key user flows
1. **First launch** → Registration screen. Operator enters a `REG-XXXXXX` code from the Super Admin panel → `POST /api/screens/register` → tablet stores `screen_id` + `screen_token` in Keystore and switches to Player mode.
2. **Playback** → Fullscreen distraction-free loop. Ads (image/video) play in playlist order and loop indefinitely. All media is downloaded once and played from local storage.
3. **Sync** → Every 5 min and on every heartbeat response the player checks `playlist_version`. If new: download all media first, then swap the playlist. Never break the currently-working loop.
4. **Reporting** → After each ad, a `PlaybackEvent` is queued locally and batch-uploaded via `POST /api/playback/batch` when connectivity returns.
5. **Heartbeat** → Every 60 s the player reports `current_ad_id`, storage_used, app version. Backend returns `playlist_version` so the player can proactively resync.
6. **Commands** → Every 30 s the player fetches pending commands (`SYNC_PLAYLIST`, `CLEAR_CACHE`, etc.), executes and acks them.
7. **Maintenance** → 5 taps in top-left corner → PIN gate (default `1234`) → dashboard with Sync Now / Reconnect / Clear Cache / Unregister Screen / Return to Player.
8. **Fallback** → When there is no cached playlist yet, a branded "Waiting for advertising content…" screen is displayed instead of an error.

## Backend surface
Admin (X-Admin-Token):
- `POST /api/admin/screens/create-code`
- `GET  /api/admin/screens`
- `POST /api/admin/screens/{screen_id}/playlist`
- `POST /api/admin/screens/{screen_id}/commands`

Screen (X-Screen-Token):
- `POST /api/screens/register`
- `GET  /api/screens/{screen_id}/playlist`
- `POST /api/screens/heartbeat`
- `POST /api/playback/batch`
- `GET  /api/screens/{screen_id}/commands`
- `POST /api/screens/{screen_id}/commands/{command_id}/ack`

Public: `GET /api/health`

## Offline-first guarantees
- Cached playlist loaded before any network call at cold start.
- Media served from `documentDirectory/qwickads_media/` on every loop.
- Playback events persist through offline periods and are batch-uploaded on reconnect.
- **Safe playlist switching**: a new playlist replaces the current one only after all its media has been prefetched successfully.

## Kiosk configuration (documented, not enforced from a normal app)
Landscape lock, keep-awake, immersive fullscreen, and boot receiver are wired up. True lock-task requires the APK to be set as **device owner** (`adb shell dpm set-device-owner`).
