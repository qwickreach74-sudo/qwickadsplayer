/**
 * Admin session context — stores JWT + user, restores it on reload.
 * Uses localStorage on web (the only environment where the admin runs).
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "qwickads.admin_session";

export type AdminUser = {
  id: string;
  email: string;
  role: "super_admin" | "operations" | "sales" | "analyst";
  disabled?: boolean;
};

export type AdminSession = {
  access_token: string;
  expires_in: number;
  user: AdminUser;
};

type AuthCtx = {
  session: AdminSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const API = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "") + "/api";

function readStorage(): AdminSession | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
}

function writeStorage(s: AdminSession | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(readStorage());
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Login failed");
    setSession(body);
    writeStorage(body);
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    writeStorage(null);
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Failed to change password");
      // password_version rotation invalidates the current JWT — log out
      setSession(null);
      writeStorage(null);
    },
    [session]
  );

  return (
    <Ctx.Provider value={{ session, loading, login, logout, changePassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminSession(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminSession must be inside AdminSessionProvider");
  return v;
}

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// ---------------------------------------------------------------------------
export async function adminRequest<T = any>(
  session: AdminSession | null,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers as any),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err: any = new Error(body.detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body as T;
}
