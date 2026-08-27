/**
 * Thin HTTP client for the QwickAds Power Player backend.
 * Uses EXPO_PUBLIC_BACKEND_URL (from .env) + '/api'.
 * Never contains hardcoded URLs.
 */
export type Advertisement = {
  advertisement_id: string;
  campaign_id: string;
  media_url: string;
  media_type: "video" | "image";
  duration: number;
  priority: number;
};

export type PlaylistResponse = {
  screen_id: string;
  playlist_version: number;
  advertisements: Advertisement[];
};

export type RegisterResponse = {
  screen_id: string;
  screen_token: string;
  cab_number?: string | null;
  area?: string | null;
};

export type PlaybackEvent = {
  advertisement_id: string;
  campaign_id?: string;
  started_at: string;
  completed_at: string;
  duration_played: number;
  completion_percentage: number;
  device_timestamp?: string;
};

const BASE_URL =
  (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "") + "/api";

async function request<T>(
  path: string,
  init: RequestInit & { screenToken?: string; timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.screenToken) headers["X-Screen-Token"] = init.screenToken;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const detail = (body && body.detail) || `HTTP ${res.status}`;
      throw new Error(String(detail));
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  registerScreen: (registration_code: string, device: {
    device_model?: string;
    android_version?: string;
    app_version?: string;
  }) =>
    request<RegisterResponse>("/screens/register", {
      method: "POST",
      body: JSON.stringify({ registration_code, ...device }),
    }),

  getPlaylist: (screen_id: string, screen_token: string) =>
    request<PlaylistResponse>(`/screens/${screen_id}/playlist`, {
      screenToken: screen_token,
    }),

  heartbeat: (screen_token: string, payload: {
    screen_id: string;
    app_version?: string;
    device_model?: string;
    current_ad_id?: string | null;
    current_campaign_id?: string | null;
    storage_used_bytes?: number;
  }) =>
    request<{ ok: boolean; playlist_version: number; server_time: string }>(
      "/screens/heartbeat",
      {
        method: "POST",
        body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
        screenToken: screen_token,
        timeoutMs: 10_000,
      }
    ),

  sendPlaybackBatch: (
    screen_token: string,
    screen_id: string,
    events: PlaybackEvent[]
  ) =>
    request<{ ok: boolean; inserted: number }>("/playback/batch", {
      method: "POST",
      body: JSON.stringify({ screen_id, events }),
      screenToken: screen_token,
    }),

  getCommands: (screen_id: string, screen_token: string) =>
    request<{ commands: { command_id: string; command: string; payload: any }[] }>(
      `/screens/${screen_id}/commands`,
      { screenToken: screen_token }
    ),

  ackCommand: (screen_id: string, command_id: string, screen_token: string) =>
    request<{ ok: boolean }>(
      `/screens/${screen_id}/commands/${command_id}/ack`,
      { method: "POST", screenToken: screen_token }
    ),
};

export const BACKEND_BASE_URL = BASE_URL;
