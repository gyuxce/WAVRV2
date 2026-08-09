const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.CUSTARA_STATIC_PORT || 5500);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

http.createServer((request, response) => {
  let pathname = decodeURIComponent(url.parse(request.url || "/").pathname || "/");
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Custara static server: http://127.0.0.1:${port}`);
});
