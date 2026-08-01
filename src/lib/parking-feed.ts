import type { GarageApiItem, GarageApiResponse } from "@/types/parking";
import { isRecord } from "@/lib/utils";

export const GARAGE_API_URL =
  process.env.NEXT_PUBLIC_GARAGE_API_URL ??
  "https://garageapi.campusparc.com/status";

function isGarage(value: unknown): value is GarageApiItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.GarageId === "number" &&
    typeof value.GarageName === "string" &&
    typeof value.GarageCount === "number" &&
    typeof value.GarageCapacity === "number" &&
    typeof value.UsePercentage === "number" &&
    typeof value.GarageType === "number" &&
    typeof value.GarageUrl === "string" &&
    typeof value.OSUID === "string" &&
    typeof value.Modified === "string" &&
    typeof value.Closed === "boolean"
  );
}

export function parseGarageResponse(value: unknown): GarageApiResponse | null {
  if (!isRecord(value) || !Array.isArray(value.Garages)) return null;
  if (!value.Garages.every(isGarage)) return null;
  return { Garages: value.Garages };
}

/**
 * CampusParc emits `MM/DD/YYYY hh:mm:ss A` without an offset. The timestamp is
 * documented by observation as Columbus local time, so it should be labelled
 * as ET instead of being handed to `new Date()` in the visitor's local zone.
 */
export function formatCampusModified(value?: string) {
  if (!value) return "尚未同步";
  const match = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i,
  );
  if (!match) return value;

  const [, month, day, year, rawHour, minute, , meridiem] = match;
  const hour = Number(rawHour);
  const normalized =
    meridiem.toUpperCase() === "PM"
      ? hour === 12
        ? 12
        : hour + 12
      : hour === 12
        ? 0
        : hour;

  return `${year}-${month}-${day} ${String(normalized).padStart(2, "0")}:${minute} ET`;
}
