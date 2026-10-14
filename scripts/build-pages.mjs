import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const workerFile = fileURLToPath(new URL("../worker.js", import.meta.url));

// dist is generated output in this checkout, never the source directory.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(publicDirectory, outputDirectory, { recursive: true });
await cp(workerFile, fileURLToPath(new URL("../dist/_worker.js", import.meta.url)));

console.log("Built Cloudflare Pages output in dist/ (assets + Pages Function).");
