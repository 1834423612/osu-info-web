import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function occupancyLevel(percentage: number) {
  if (percentage >= 90) return "critical";
  if (percentage >= 70) return "busy";
  if (percentage >= 45) return "steady";
  return "open";
}

export function occupancyLabel(percentage: number, closed = false) {
  if (closed) return "已关闭";
  if (percentage >= 90) return "接近满位";
  if (percentage >= 70) return "较为繁忙";
  if (percentage >= 45) return "车位适中";
  return "空位充足";
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1609.344).toFixed(1)} 英里`;
}

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function directionsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
