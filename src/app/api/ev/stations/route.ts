import { NextResponse } from "next/server";

/**
 * EV upstream requests deliberately no longer run on the Next.js server.
 *
 * NLR applies per-IP quotas, so proxying every visitor through one deployment
 * IP caused avoidable throttling. Tesla also rejects the deployment IP with
 * Akamai 403 responses. The client hook now issues the documented GET requests
 * from the user's browser and persists a six-hour browser cache.
 */
export function GET() {
  return NextResponse.json(
    {
      error: "EV 数据已改为浏览器直连；此服务器代理端点已停用。",
      requestOrigin: "browser",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
        "X-EV-Upstream-Requests": "disabled",
      },
    },
  );
}
