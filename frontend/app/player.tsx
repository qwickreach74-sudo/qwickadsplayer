import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  AppState,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Network from "expo-network";
import { useRouter, useFocusEffect } from "expo-router";
import Constants from "expo-constants";

import { colors, radius, spacing } from "@/src/theme";
import { api, type Advertisement } from "@/src/services/api";
import { loadScreenIdentity, type ScreenIdentity } from "@/src/services/secure-storage";
import { mediaCache, playlistStore } from "@/src/services/media-cache";
import { playbackQueue } from "@/src/services/playback-queue";

type PlayableAd = Advertisement & { local_uri: string };

const HEARTBEAT_INTERVAL_MS = 60_000;
const PLAYLIST_POLL_MS = 5 * 60_000;
const COMMAND_POLL_MS = 30_000;
const QUEUE_FLUSH_MS = 2 * 60_000;
const IMAGE_MIN_DURATION_S = 3;

export default function PlayerScreen() {
  // Keep the display awake on native devices only. Wake-lock throws on web
  // browsers when the tab has no user gesture yet, so we guard it.
  useEffect(() => {
    if (Platform.OS === "web") return;
    activateKeepAwakeAsync("qwickads-player").catch(() => {});
    return () => {
      deactivateKeepAwake("qwickads-player");
    };
  }, []);
  const router = useRouter();

  const [identity, setIdentity] = useState<ScreenIdentity | null>(null);
  const [playlist, setPlaylist] = useState<PlayableAd[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "waiting" | "playing" | "error">(
    "loading"
  );
  const [online, setOnline] = useState(true);

  const playlistVersionRef = useRef<number>(0);
  const currentAdStartRef = useRef<number>(0);
  const cornerTapsRef = useRef<{ count: number; last: number }>({ count: 0, last: 0 });

  // ---------------------------------------------------------------------
  // Bootstrap: load stored identity + cached playlist immediately
  // ---------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const id = await loadScreenIdentity();
      if (!id) {
        router.replace("/register");
        return;
      }
      setIdentity(id);

      const stored = await playlistStore.load();
      if (stored && stored.advertisements.length > 0) {
        playlistVersionRef.current = stored.playlist_version;
        const enriched: PlayableAd[] = [];
        for (const ad of stored.advertisements) {
          const uri = await mediaCache.getPlayableUri(ad);
          enriched.push({ ...ad, local_uri: uri });
        }
        setPlaylist(enriched);
        setStatus("playing");
      } else {
        setStatus("waiting");
      }
    })();
  }, [router]);

  // ---------------------------------------------------------------------
  // Sync playlist from backend (safe playlist switching)
  // ---------------------------------------------------------------------
  const syncPlaylist = useCallback(async () => {
    if (!identity) return;
    try {
      const remote = await api.getPlaylist(identity.screen_id, identity.screen_token);
      if (
        remote.playlist_version === playlistVersionRef.current &&
        playlist.length > 0
      ) {
        return; // unchanged
      }
      if (!remote.advertisements || remote.advertisements.length === 0) {
        // Empty playlist -> keep current playing content, don't wipe local cache.
        if (playlist.length === 0) setStatus("waiting");
        return;
      }

      // Prefetch all media BEFORE switching
      const { failed } = await mediaCache.prefetchAll(remote.advertisements);
      if (failed.length > 0 && playlist.length > 0) {
        console.warn("[player] new playlist has failed downloads, keeping current");
        return;
      }

      const enriched: PlayableAd[] = [];
      for (const ad of remote.advertisements) {
        const uri = await mediaCache.getPlayableUri(ad);
        enriched.push({ ...ad, local_uri: uri });
      }

      // Cleanup old files (but keep everything in the new list)
      const keep = new Set(remote.advertisements.map((a) => a.advertisement_id));
      await mediaCache.cleanup(keep);

      await playlistStore.save({
        playlist_version: remote.playlist_version,
        advertisements: remote.advertisements,
        saved_at: new Date().toISOString(),
      });
      playlistVersionRef.current = remote.playlist_version;
      setPlaylist(enriched);
      setCurrentIndex(0);
      setStatus("playing");
    } catch (err) {
      // Offline / server unavailable — keep playing whatever we have.
      console.warn("[player] sync failed:", err);
    }
  }, [identity, playlist.length]);

  useEffect(() => {
    if (!identity) return;
    syncPlaylist(); // initial refresh
    const t = setInterval(syncPlaylist, PLAYLIST_POLL_MS);
    return () => clearInterval(t);
  }, [identity, syncPlaylist]);

  // ---------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!identity) return;
    const send = async () => {
      try {
        const currentAd = playlist[currentIndex];
        const bytes = await mediaCache.totalBytes();
        const res = await api.heartbeat(identity.screen_token, {
          screen_id: identity.screen_id,
          app_version: Constants.expoConfig?.version ?? "1.0.0",
          device_model: Platform.OS,
          current_ad_id: currentAd?.advertisement_id ?? null,
          current_campaign_id: currentAd?.campaign_id ?? null,
          storage_used_bytes: bytes,
        });
        setOnline(true);
        // If server has a newer playlist, pick it up now
        if (res.playlist_version !== playlistVersionRef.current) {
          syncPlaylist();
        }
      } catch {
        setOnline(false);
      }
    };
    send();
    const t = setInterval(send, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [identity, playlist, currentIndex, syncPlaylist]);

  // ---------------------------------------------------------------------
  // Playback queue flush + connectivity check
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!identity) return;
    const tick = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        setOnline(!!state.isInternetReachable || !!state.isConnected);
        if (state.isConnected) {
          await playbackQueue.flush(identity.screen_id, identity.screen_token);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, QUEUE_FLUSH_MS);
    return () => clearInterval(t);
  }, [identity]);

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!identity) return;
    const poll = async () => {
      try {
        const { commands } = await api.getCommands(
          identity.screen_id,
          identity.screen_token
        );
        for (const c of commands) {
          try {
            if (c.command === "SYNC_PLAYLIST") await syncPlaylist();
            if (c.command === "CLEAR_CACHE") {
              await mediaCache.clearAll();
              await syncPlaylist();
            }
            await api.ackCommand(identity.screen_id, c.command_id, identity.screen_token);
          } catch {}
        }
      } catch {}
    };
    const t = setInterval(poll, COMMAND_POLL_MS);
    return () => clearInterval(t);
  }, [identity, syncPlaylist]);

  // ---------------------------------------------------------------------
  // Playback engine
  // ---------------------------------------------------------------------
  const currentAd = playlist[currentIndex];

  useEffect(() => {
    if (currentAd) {
      currentAdStartRef.current = Date.now();
    }
  }, [currentIndex, currentAd?.advertisement_id]);

  const advance = useCallback(
    (completion = 100) => {
      const ad = currentAd;
      if (ad && identity) {
        const now = new Date();
        const startedAt = new Date(currentAdStartRef.current).toISOString();
        const played = (Date.now() - currentAdStartRef.current) / 1000;
        playbackQueue
          .enqueue({
            advertisement_id: ad.advertisement_id,
            campaign_id: ad.campaign_id,
            started_at: startedAt,
            completed_at: now.toISOString(),
            duration_played: played,
            completion_percentage: completion,
            device_timestamp: now.toISOString(),
          })
          .catch(() => {});
      }
      setCurrentIndex((i) => {
        if (playlist.length === 0) return 0;
        return (i + 1) % playlist.length;
      });
    },
    [currentAd, identity, playlist.length]
  );

  // Image auto-advance timer
  useEffect(() => {
    if (!currentAd || currentAd.media_type !== "image") return;
    const durationS = Math.max(IMAGE_MIN_DURATION_S, currentAd.duration || 10);
    const t = setTimeout(() => advance(100), durationS * 1000);
    return () => clearTimeout(t);
  }, [currentAd, advance]);

  // ---------------------------------------------------------------------
  // App state handling (pause on background, resume on foreground)
  // ---------------------------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && identity) {
        syncPlaylist();
      }
    });
    return () => sub.remove();
  }, [identity, syncPlaylist]);

  // ---------------------------------------------------------------------
  // Hidden maintenance access (5 taps in top-left corner)
  // ---------------------------------------------------------------------
  const onCornerTap = () => {
    const now = Date.now();
    const tap = cornerTapsRef.current;
    if (now - tap.last > 2000) tap.count = 0;
    tap.count += 1;
    tap.last = now;
    if (tap.count >= 5) {
      tap.count = 0;
      router.push("/maintenance");
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (status === "loading") {
    return (
      <View style={styles.blackScreen} testID="player-loading">
        <ActivityIndicator color={colors.onSurfaceInverse} />
      </View>
    );
  }

  if (playlist.length === 0 || !currentAd) {
    return (
      <View style={styles.fallback} testID="player-fallback">
        <Pressable
          onPress={onCornerTap}
          style={styles.corner}
          testID="maintenance-corner"
        />
        <View style={styles.fallbackCard}>
          <View style={styles.brandDot}>
            <Text style={styles.brandLetter}>Q</Text>
          </View>
          <Text style={styles.fallbackTitle}>QwickAds Power</Text>
          <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
          <Text style={styles.fallbackText}>Waiting for advertising content…</Text>
          {!online ? (
            <Text style={styles.fallbackDim}>Offline · will retry automatically</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.blackScreen} testID="player-screen">
      {currentAd.media_type === "video" ? (
        <VideoAd key={currentAd.advertisement_id} ad={currentAd} onEnd={advance} />
      ) : (
        <Image
          testID={`ad-image-${currentAd.advertisement_id}`}
          source={{ uri: currentAd.local_uri }}
          style={styles.media}
          contentFit="contain"
          transition={200}
        />
      )}
      <Pressable
        onPress={onCornerTap}
        style={styles.corner}
        testID="maintenance-corner"
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Video sub-component isolates the useVideoPlayer hook so each ad remounts
// cleanly, releasing native resources.
// -----------------------------------------------------------------------------
function VideoAd({ ad, onEnd }: { ad: PlayableAd; onEnd: () => void }) {
  const player = useVideoPlayer(ad.local_uri, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => onEnd());
    const errSub = player.addListener("statusChange", (event: any) => {
      if (event?.status === "error") onEnd();
    });
    return () => {
      sub.remove();
      errSub.remove();
    };
  }, [player, onEnd]);

  // Safety timeout for videos that never emit playToEnd (corrupt/streaming).
  useEffect(() => {
    const durationMs = Math.max(5, ad.duration || 30) * 1000 + 5_000;
    const t = setTimeout(onEnd, durationMs);
    return () => clearTimeout(t);
  }, [ad.advertisement_id, ad.duration, onEnd]);

  return (
    <VideoView
      testID={`ad-video-${ad.advertisement_id}`}
      player={player}
      style={styles.media}
      contentFit="contain"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

const styles = StyleSheet.create({
  blackScreen: {
    flex: 1,
    backgroundColor: colors.surfaceInverse,
  },
  media: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceInverse,
  },
  corner: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 96,
    height: 96,
  },
  fallback: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    alignItems: "center",
    minWidth: 360,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  brandDot: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  brandLetter: {
    color: colors.onSurfaceInverse,
    fontSize: 22,
    fontWeight: "800",
  },
  fallbackTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.onSurface,
  },
  fallbackText: {
    fontSize: 14,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
  },
  fallbackDim: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.warning,
  },
});
