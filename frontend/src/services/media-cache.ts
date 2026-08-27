/**
 * Media cache manager.
 *
 * Responsibilities:
 *  - Download each advertisement media file to local storage exactly once.
 *  - Reuse local copy on every subsequent loop (offline-first).
 *  - Track metadata (URL, local path, downloaded_at, size) in AsyncStorage.
 *  - Clean up files that are no longer part of the active playlist.
 *  - On web (Expo Go preview) we skip the download and fall back to remote URL
 *    directly so the preview still works.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Advertisement } from "./api";

// Legacy FileSystem API remains stable in SDK 54 and exposes the exact
// methods we need (downloadAsync, getInfoAsync, deleteAsync, documentDirectory).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileSystem: any = Platform.OS === "web" ? null : require("expo-file-system/legacy");

const CACHE_META_KEY = "qwickads.media_cache";
const PLAYLIST_KEY = "qwickads.playlist";
const PLAYLIST_VERSION_KEY = "qwickads.playlist_version";

const MEDIA_DIR =
  FileSystem && FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}qwickads_media/`
    : "";

export type CachedMediaEntry = {
  advertisement_id: string;
  media_url: string;
  local_path: string;
  file_size: number;
  downloaded_at: string;
};

type CacheMap = Record<string, CachedMediaEntry>;

async function readCacheMap(): Promise<CacheMap> {
  const raw = await AsyncStorage.getItem(CACHE_META_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CacheMap;
  } catch {
    return {};
  }
}

async function writeCacheMap(map: CacheMap): Promise<void> {
  await AsyncStorage.setItem(CACHE_META_KEY, JSON.stringify(map));
}

async function ensureDir() {
  if (!FileSystem || !MEDIA_DIR) return;
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
  }
}

function extFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : "bin";
  } catch {
    return "bin";
  }
}

export const mediaCache = {
  /**
   * Return a playable URI for the given ad. Downloads and stores locally
   * if not already cached. On web / when FileSystem is unavailable it
   * returns the remote URL directly.
   */
  async getPlayableUri(ad: Advertisement): Promise<string> {
    if (!FileSystem || !MEDIA_DIR) return ad.media_url;
    await ensureDir();
    const map = await readCacheMap();
    const entry = map[ad.advertisement_id];

    if (entry && entry.media_url === ad.media_url) {
      const info = await FileSystem.getInfoAsync(entry.local_path);
      if (info.exists && info.size && info.size > 0) {
        return entry.local_path;
      }
    }

    const local_path = `${MEDIA_DIR}${ad.advertisement_id}.${extFromUrl(ad.media_url)}`;
    try {
      const download = await FileSystem.downloadAsync(ad.media_url, local_path);
      if (download.status !== 200) {
        throw new Error(`Download HTTP ${download.status}`);
      }
      const info = await FileSystem.getInfoAsync(local_path);
      const next: CachedMediaEntry = {
        advertisement_id: ad.advertisement_id,
        media_url: ad.media_url,
        local_path,
        file_size: info.size ?? 0,
        downloaded_at: new Date().toISOString(),
      };
      map[ad.advertisement_id] = next;
      await writeCacheMap(map);
      return local_path;
    } catch (err) {
      // Fall back to streaming on failure — never break playback.
      console.warn("[mediaCache] download failed, streaming:", err);
      return ad.media_url;
    }
  },

  /**
   * Return true only when the ad has a valid local copy — used to decide
   * whether the playlist can play fully offline.
   */
  async isCached(ad: Advertisement): Promise<boolean> {
    if (!FileSystem) return false;
    const map = await readCacheMap();
    const entry = map[ad.advertisement_id];
    if (!entry || entry.media_url !== ad.media_url) return false;
    const info = await FileSystem.getInfoAsync(entry.local_path);
    return !!info.exists && (info.size ?? 0) > 0;
  },

  /**
   * Ensure ALL ads in the given playlist are downloaded locally.
   * Returns the ids that failed to download (so we don't switch to a
   * broken new playlist).
   */
  async prefetchAll(ads: Advertisement[]): Promise<{ok: string[]; failed: string[]}> {
    const ok: string[] = [];
    const failed: string[] = [];
    for (const ad of ads) {
      const uri = await this.getPlayableUri(ad);
      // If the local file wasn't actually created it will fall back to the
      // remote URL (starts with http). Treat that as failed for prefetch.
      if (uri.startsWith("http")) failed.push(ad.advertisement_id);
      else ok.push(ad.advertisement_id);
    }
    return { ok, failed };
  },

  /**
   * Remove any cached files not referenced by keepIds. Never removes files
   * for currently-playing content — caller guarantees keepIds includes it.
   */
  async cleanup(keepIds: Set<string>): Promise<number> {
    if (!FileSystem) return 0;
    const map = await readCacheMap();
    let removed = 0;
    for (const id of Object.keys(map)) {
      if (!keepIds.has(id)) {
        const entry = map[id];
        try {
          await FileSystem.deleteAsync(entry.local_path, { idempotent: true });
        } catch {}
        delete map[id];
        removed += 1;
      }
    }
    await writeCacheMap(map);
    return removed;
  },

  async clearAll(): Promise<void> {
    if (!FileSystem || !MEDIA_DIR) {
      await AsyncStorage.removeItem(CACHE_META_KEY);
      return;
    }
    try {
      await FileSystem.deleteAsync(MEDIA_DIR, { idempotent: true });
    } catch {}
    await AsyncStorage.removeItem(CACHE_META_KEY);
  },

  async totalBytes(): Promise<number> {
    const map = await readCacheMap();
    return Object.values(map).reduce((s, e) => s + (e.file_size || 0), 0);
  },
};

// ---------------------------------------------------------------------------
// Playlist persistence (offline-first startup)
// ---------------------------------------------------------------------------
export type StoredPlaylist = {
  playlist_version: number;
  advertisements: Advertisement[];
  saved_at: string;
};

export const playlistStore = {
  async load(): Promise<StoredPlaylist | null> {
    const raw = await AsyncStorage.getItem(PLAYLIST_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredPlaylist;
    } catch {
      return null;
    }
  },
  async save(pl: StoredPlaylist): Promise<void> {
    await AsyncStorage.setItem(PLAYLIST_KEY, JSON.stringify(pl));
    await AsyncStorage.setItem(PLAYLIST_VERSION_KEY, String(pl.playlist_version));
  },
  async getVersion(): Promise<number> {
    const v = await AsyncStorage.getItem(PLAYLIST_VERSION_KEY);
    return v ? Number(v) : 0;
  },
};
