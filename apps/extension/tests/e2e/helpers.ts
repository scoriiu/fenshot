import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, so fixture pages can reference package test images. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const EXT_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURES = join(EXT_DIR, "tests", "e2e", "fixtures");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".js": "text/javascript",
  ".css": "text/css",
};

/**
 * Static server over the repo root on 127.0.0.1. Fixtures live under
 * /apps/extension/tests/e2e/fixtures/. Port 0 so parallel files never
 * collide.
 */
export async function serveRepo(): Promise<{ server: Server; origin: string; fixture: (name: string) => string }> {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
    if (path.includes("..")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(join(REPO_ROOT, path));
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    server,
    origin,
    fixture: (name) => `${origin}/apps/extension/tests/e2e/fixtures/${name}`,
  };
}
