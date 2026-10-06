import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./src/server/main.js";

const here = dirname(fileURLToPath(import.meta.url));
startServer({ rootDir: here });
