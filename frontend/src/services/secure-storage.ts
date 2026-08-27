/**
 * SecureStorage wrapper.
 * expo-secure-store on native (Android Keystore / iOS Keychain).
 * Falls back to AsyncStorage on web (Expo Go preview) so registration
 * still works in the browser preview.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isNative) {
      return SecureStore.getItemAsync(key);
    }
    return AsyncStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (isNative) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    if (isNative) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

export const SCREEN_ID_KEY = "qwickads.screen_id";
export const SCREEN_TOKEN_KEY = "qwickads.screen_token";
export const SCREEN_CAB_KEY = "qwickads.screen_cab";
export const SCREEN_AREA_KEY = "qwickads.screen_area";

export type ScreenIdentity = {
  screen_id: string;
  screen_token: string;
  cab_number?: string | null;
  area?: string | null;
};

export async function saveScreenIdentity(id: ScreenIdentity) {
  await secureStorage.set(SCREEN_ID_KEY, id.screen_id);
  await secureStorage.set(SCREEN_TOKEN_KEY, id.screen_token);
  if (id.cab_number) await secureStorage.set(SCREEN_CAB_KEY, id.cab_number);
  if (id.area) await secureStorage.set(SCREEN_AREA_KEY, id.area);
}

export async function loadScreenIdentity(): Promise<ScreenIdentity | null> {
  const screen_id = await secureStorage.get(SCREEN_ID_KEY);
  const screen_token = await secureStorage.get(SCREEN_TOKEN_KEY);
  if (!screen_id || !screen_token) return null;
  const cab_number = await secureStorage.get(SCREEN_CAB_KEY);
  const area = await secureStorage.get(SCREEN_AREA_KEY);
  return { screen_id, screen_token, cab_number, area };
}

export async function clearScreenIdentity() {
  await secureStorage.remove(SCREEN_ID_KEY);
  await secureStorage.remove(SCREEN_TOKEN_KEY);
  await secureStorage.remove(SCREEN_CAB_KEY);
  await secureStorage.remove(SCREEN_AREA_KEY);
}
