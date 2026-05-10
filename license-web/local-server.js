const fs = require("fs");
const http = require("http");
const path = require("path");
const generateHandler = require("./api/generate");

const root = __dirname;
const publicRoot = path.join(root, "public");
const port = Number(process.env.PORT || 4173);

if (!process.env.LICENSE_ADMIN_TOKEN) {
  process.env.LICENSE_ADMIN_TOKEN = "dev-admin";
}

if (!process.env.LICENSE_PRIVATE_KEY && !process.env.LICENSE_PRIVATE_KEY_BASE64) {
  const localPrivateKey = path.resolve(root, "..", "license-secrets", "license-private.pem");
  if (fs.existsSync(localPrivateKey)) {
    process.env.LICENSE_PRIVATE_KEY = fs.readFileSync(localPrivateKey, "utf8");
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicRoot, normalizedPath);

  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(contents);
  });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/generate")) {
    generateHandler(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`License web running at http://localhost:${port}`);
  console.log(`Local admin token: ${process.env.LICENSE_ADMIN_TOKEN}`);
  if (!process.env.LICENSE_PRIVATE_KEY && !process.env.LICENSE_PRIVATE_KEY_BASE64) {
    console.warn("Warning: no private key found. Set LICENSE_PRIVATE_KEY_BASE64 or create license-secrets/license-private.pem.");
  }
});
