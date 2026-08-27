/**
 * Offline-first playback event queue.
 * Queues events on disk (AsyncStorage) and batch-uploads them when internet
 * is available. Nothing is lost during offline periods.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type PlaybackEvent } from "./api";

const QUEUE_KEY = "qwickads.playback_queue";
const MAX_QUEUE = 500;

async function readQueue(): Promise<PlaybackEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PlaybackEvent[];
  } catch {
    return [];
  }
}

async function writeQueue(events: PlaybackEvent[]) {
  const trimmed = events.slice(-MAX_QUEUE);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
}

export const playbackQueue = {
  async enqueue(event: PlaybackEvent): Promise<void> {
    const q = await readQueue();
    q.push(event);
    await writeQueue(q);
  },

  async size(): Promise<number> {
    return (await readQueue()).length;
  },

  async flush(screen_id: string, screen_token: string): Promise<number> {
    const q = await readQueue();
    if (q.length === 0) return 0;
    try {
      const chunkSize = 50;
      let sent = 0;
      for (let i = 0; i < q.length; i += chunkSize) {
        const chunk = q.slice(i, i + chunkSize);
        await api.sendPlaybackBatch(screen_token, screen_id, chunk);
        sent += chunk.length;
      }
      await writeQueue([]);
      return sent;
    } catch (err) {
      // Keep queue intact for next attempt.
      console.warn("[playbackQueue] flush failed:", err);
      return 0;
    }
  },

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  },
};
