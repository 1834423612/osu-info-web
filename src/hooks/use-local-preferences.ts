"use client";

import { useCallback, useEffect, useState } from "react";

import type { UserPreferences } from "@/types/parking";

const STORAGE_KEY = "buckeye-parking:preferences:v1";

const defaults: UserPreferences = {
  permitCode: "none",
  favorites: [],
  evMode: false,
  mapTransitVisible: true,
  dismissedWelcome: false,
};

export function useLocalPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(defaults);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as
          | Partial<UserPreferences>
          | undefined;
        setPreferences({
          ...defaults,
          ...saved,
          favorites: Array.isArray(saved?.favorites)
            ? saved.favorites.filter((value) => typeof value === "number")
            : [],
        });
      } catch {
        setPreferences(defaults);
      } finally {
        setHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences remain usable in memory when storage is disabled.
    }
  }, [hydrated, preferences]);

  const update = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const toggleFavorite = useCallback((id: number) => {
    setPreferences((current) => ({
      ...current,
      favorites: current.favorites.includes(id)
        ? current.favorites.filter((favorite) => favorite !== id)
        : [...current.favorites, id],
    }));
  }, []);

  return { preferences, hydrated, update, toggleFavorite };
}
