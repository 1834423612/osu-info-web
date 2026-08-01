"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useState } from "react";

const CAMPUS_TIME_ZONE = "America/New_York";

function formatClock(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CAMPUS_TIME_ZONE,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function TimeDisplay({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState<Date>();
  const localZone = useMemo(
    () =>
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : CAMPUS_TIME_ZONE,
    [],
  );

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!now) {
    return <div className="h-9 w-36 animate-pulse rounded-xl bg-black/5" />;
  }

  const hasSecondZone = localZone !== CAMPUS_TIME_ZONE;

  return (
    <div className="time-display" aria-label="校园与本地时间">
      <div className="time-display__primary">
        <span className="time-display__icon">
          <Icon icon="solar:clock-circle-bold" />
        </span>
        <span>
          <small>Columbus · ET</small>
          <strong>{formatClock(now, CAMPUS_TIME_ZONE)}</strong>
        </span>
      </div>
      {!compact && (
        <span className="hidden text-xs text-[var(--muted)] xl:block">
          {formatDate(now)}
        </span>
      )}
      {hasSecondZone && (
        <>
          <span className="time-display__divider" />
          <span className="time-display__local">
            <small>你的本地</small>
            <strong>{formatClock(now, localZone)}</strong>
          </span>
        </>
      )}
    </div>
  );
}
