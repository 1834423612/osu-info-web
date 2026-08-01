import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buckeye Parking",
    short_name: "Parking",
    description: "OSU Columbus Campus 停车实时浏览",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4f5",
    theme_color: "#ba0c2f",
    lang: "zh-CN",
    categories: ["navigation", "travel", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
