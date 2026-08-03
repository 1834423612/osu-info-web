import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const maplibreRoot = dirname(require.resolve("maplibre-gl/package.json"));
const sourceDirectory = join(maplibreRoot, "dist");
const targetDirectory = join(projectRoot, "public", "maplibre");
const workerFiles = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

await mkdir(targetDirectory, { recursive: true });
await Promise.all(
  workerFiles.map((fileName) =>
    copyFile(join(sourceDirectory, fileName), join(targetDirectory, fileName)),
  ),
);

console.log(
  `Synced MapLibre worker ${workerFiles.join(", ")} to public/maplibre.`,
);
