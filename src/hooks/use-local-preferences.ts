"use client";

import { useCallback, useEffect, useState } from "react";

import {
  inferIdentityForPermitSelection,
  isUserParkingIdentity,
} from "@/data/permits";
import type { UserPreferences } from "@/types/parking";

const STORAGE_KEY = "buckeye-parking:preferences:v1";

const defaults: UserPreferences = {
  permitCode: "none",
  parkingIdentity: "student",
  favorites: [],
  evMode: false,
  mapTransitVisible: true,
  mapPermitAreasVisible: true,
  mapParkingLocationsVisible: true,
  mapTransitVehiclesVisible: true,
  mapTransitRoutesVisible: true,
  mapTransitEndpointsVisible: true,
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
        const permitCode =
          typeof saved?.permitCode === "string"
            ? saved.permitCode
            : defaults.permitCode;
        const mapTransitVisible =
          typeof saved?.mapTransitVisible === "boolean"
            ? saved.mapTransitVisible
            : defaults.mapTransitVisible;
        setPreferences({
          ...defaults,
          ...saved,
          permitCode,
          mapTransitVisible,
          mapPermitAreasVisible:
            typeof saved?.mapPermitAreasVisible === "boolean"
              ? saved.mapPermitAreasVisible
              : defaults.mapPermitAreasVisible,
          mapParkingLocationsVisible:
            typeof saved?.mapParkingLocationsVisible === "boolean"
              ? saved.mapParkingLocationsVisible
              : defaults.mapParkingLocationsVisible,
          // Before granular controls existed, mapTransitVisible represented
          // the entire CABS layer. Preserve that choice for older snapshots.
          mapTransitVehiclesVisible:
            typeof saved?.mapTransitVehiclesVisible === "boolean"
              ? saved.mapTransitVehiclesVisible
              : mapTransitVisible,
          mapTransitRoutesVisible:
            typeof saved?.mapTransitRoutesVisible === "boolean"
              ? saved.mapTransitRoutesVisible
              : mapTransitVisible,
          mapTransitEndpointsVisible:
            typeof saved?.mapTransitEndpointsVisible === "boolean"
              ? saved.mapTransitEndpointsVisible
              : mapTransitVisible,
          parkingIdentity: isUserParkingIdentity(saved?.parkingIdentity)
            ? saved.parkingIdentity
            : inferIdentityForPermitSelection(permitCode),
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
