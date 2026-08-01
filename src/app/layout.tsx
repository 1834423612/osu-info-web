import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buckeye Parking · OSU 校园停车实时浏览",
  description:
    "无需登录，查看 Ohio State Columbus Campus 停车占用、停车证时段、CABS 实时车辆和 EV 充电位置。",
  applicationName: "Buckeye Parking",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
  },
  category: "transportation",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Buckeye Parking",
    description: "OSU 校园停车实时浏览",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#141516" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
