# QwickAds Power Player + Super Admin — PRD

## Product
A production digital-signage platform that scales to ~200 cab screens and consists of two applications sharing one FastAPI + MongoDB backend:

1. **QwickAds Power Player** — Android/Expo app on Lenovo M10 tablets, permanently mounted in cabs. Distraction-free, offline-first, kiosk-oriented.
2. **QwickAds Super Admin** — web dashboard (`/admin/*`) for managing areas, cabs, screens, media, campaigns, playlists, analytics and system settings.

The tablet is authenticated by its own `screen_token`. The web dashboard authenticates via JWT (bcrypt-hashed passwords). Machine-to-machine access via `X-Admin-Token` is preserved for backwards compat.

## Backend surface

Player (X-Screen-Token):
- `POST /api/screens/register`
- `GET  /api/screens/{screen_id}/playlist`
- `POST /api/screens/heartbeat`
- `POST /api/playback/batch`
- `GET  /api/screens/{screen_id}/commands`
- `POST /api/screens/{screen_id}/commands/{command_id}/ack`

Auth:
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`

Admin (Bearer JWT or X-Admin-Token):
- `/api/areas`  CRUD
- `/api/cabs`  CRUD (soft-delete)
- `/api/screens` list; `/api/screens/{id}`; `/api/screens/{id}/unregister`; `/api/screens/{id}/commands`
- `/api/screens/registration-codes` create; `/list`; DELETE (revoke)
- `/api/media`  CRUD (metadata only; Cloudinary can be enabled later without contract change)
- `/api/campaigns`  CRUD (soft-delete)
- `/api/playlists/{screen_id}` GET/PUT (publish → bumps `playlist_version`)
- `/api/analytics/overview,campaigns,screens` (range: today | yesterday | 7d | 30d)
- `/api/settings` GET/PUT
- `/api/audit`

Public: `GET /api/health`

## Key business rules

- **Screen identity is permanent.** Once a tablet registers, it stays registered through reboots, offline periods, and app restarts. Only an explicit **Unregister Screen** action from the Super Admin rotates the token and forces re-registration.
- **Safe playlist switching.** The Power Player only switches to a new playlist after ALL its media has been downloaded locally. A failed download never breaks the running loop.
- **Offline-first.** Cached playlist is loaded at cold start before any network I/O. Playback events queue on disk and are batch-uploaded on reconnect.
- **Impression definition.** An impression is a playback event with `completion_percentage >= 80`. Documented in code + dashboard.
- **Cross-screen isolation.** A screen token cannot read another screen's data.
- **Registration codes** are single-use, have a configurable expiry (default 24 h) and can be revoked.
- **Soft delete** for cabs and campaigns so historical playback analytics stay meaningful.

## Frontend

- Player screens: `/register`, `/player`, `/maintenance` (landscape, kiosk-oriented, native only).
- Super Admin: `/admin/login`, `/admin`, `/admin/screens|cabs|areas|media|campaigns|playlists|analytics|audit|settings` — web-only via Expo Router.
- Shared design tokens in `src/theme.ts`.
- Admin session context in `src/admin/session.tsx`; API helper `adminRequest` attaches Bearer JWT.

## Tests

- Backend: **36 pytest tests** (16 player + 20 admin) covering auth, RBAC, CRUD, registration code lifecycle, playlist publishing, media reference protection, analytics, settings, audit trail, and the full integration flow (area → cab → code → register → publish → heartbeat → command → ack).
- Frontend: Playwright smoke on preview validates login, all sidebar nav, resource CRUDs, code generation, analytics range picker and logout.

## Deployment notes

- All secrets via `.env`: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ADMIN_TOKEN`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
- No secrets are ever exposed to the frontend. `EXPO_PUBLIC_BACKEND_URL` is the only public value.
- Kiosk / auto-boot: shipped-as-native. Requires the APK to be set as **device owner** (`adb shell dpm set-device-owner`) to enter lock-task mode. Documented in README.
