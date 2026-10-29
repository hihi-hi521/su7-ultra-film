const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".jpg": "image/jpeg", ".mp4": "video/mp4" };
const allowed = new Set(["index.html", "styles.css", "story.js", "app.js"]);

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html"; }
  catch { res.writeHead(400).end(); return; }
  if (!allowed.has(pathname) && !/^assets\/[a-z0-9.-]+\.(mp4|jpg|js)$/.test(pathname)) {
    res.writeHead(404).end();
    return;
  }
  const file = path.join(root, pathname);
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    const range = req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    let start = 0;
    let end = stat.size - 1;
    if (range) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end(); return; }
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file, { start, end }).pipe(res);
  });
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log(`SU7 preview: http://127.0.0.1:${server.address().port}`);
});
