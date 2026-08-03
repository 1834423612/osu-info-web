import teslaChargerSnapshot from "../../data-example/get-charger-details.json";
import teslaLocationSnapshot from "../../data-example/get-location-details.json";

import { KNOWN_TESLA_LOCATIONS } from "@/lib/ev-stations";
import { parseTeslaStation } from "@/lib/tesla-ev";
import type { EvStation } from "@/types/ev";

export const TESLA_SNAPSHOT_CHECKED_AT = "2026-08-01T00:00:00-04:00";

export function teslaWestThirdSnapshot(baseStation?: EvStation) {
  const identity = KNOWN_TESLA_LOCATIONS["afdc-320148"];
  return parseTeslaStation(
    teslaChargerSnapshot,
    teslaLocationSnapshot,
    "static-snapshot",
    TESLA_SNAPSHOT_CHECKED_AT,
    { ...identity, baseStation },
  );
}
