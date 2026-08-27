import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDirectory = path.join(workspace, "opt-lab", "web");
const moduleRoots = {
  "cs2-sensitivity": path.join(workspace, "cs2-sensitivity"),
  "cs2-lineups": path.join(workspace, "cs2-lineups")
};
const port = Number(process.env.OPT_LAB_PORT ?? 4173);
const blockedModuleParts = new Set(["tests", "docs", "readme.md"]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function isBlockedModuleRelative(relativePath) {
  return relativePath.split(/[\\/]/).some((part) => blockedModuleParts.has(part.toLowerCase()));
}

function resolveUnderRoot(root, relativePath) {
  const asset = path.resolve(root, relativePath);
  return asset.startsWith(`${root}${path.sep}`) ? asset : null;
}

function resolveAsset(urlPathname) {
  const pathname = decodeURIComponent(urlPathname);
  if (pathname === "/" || pathname === "/index.html") {
    return path.join(shellDirectory, "index.html");
  }
  if (pathname.includes("..") || pathname.startsWith("//")) {
    return null;
  }

  const moduleMatch = pathname.match(/^\/modules\/(cs2-sensitivity|cs2-lineups)(?:\/(.*))?$/);
  if (moduleMatch) {
    const relativePath = moduleMatch[2] && moduleMatch[2].length ? moduleMatch[2] : "index.html";
    if (isBlockedModuleRelative(relativePath)) {
      return null;
    }
    return resolveUnderRoot(moduleRoots[moduleMatch[1]], relativePath);
  }

  return resolveUnderRoot(shellDirectory, pathname.replace(/^\/+/, ""));
}

const server = http.createServer(async (request, response) => {
  const asset = resolveAsset(new URL(request.url, "http://localhost").pathname);
  if (!asset || !existsSync(asset)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const metadata = await stat(asset);
    if (!metadata.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      "Content-Type": contentTypes.get(path.extname(asset)) ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(asset).pipe(response);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to read preview asset");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`OPT / LAB preview: http://127.0.0.1:${port}\n`);
});
