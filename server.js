// 鍵盤ハーモニカ展示デモ用のローカルサーバー（Node.js だけで動きます。追加インストール不要）
//   node server.js        → ポート 8080 で起動
//   PORT=9000 node server.js
// 表示用PC:   http://localhost:8080/#display
// タブレット: http://<このPCのIPアドレス>:8080/#controller
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8080;
const PAGE = path.join(__dirname, "index.html");
const STALE_MS = 2500; // a tablet that stops sending heartbeats has its notes released

const controllers = new Map(); // id → { held: number[], seen: ms }
const listeners = new Set();
let lastSent = "";

function snapshot() {
  const held = new Set();
  for (const c of controllers.values()) c.held.forEach(i => held.add(i));
  return JSON.stringify({ held: [...held].sort((a, b) => a - b), controllers: controllers.size });
}
function broadcast(force) {
  const s = snapshot();
  if (!force && s === lastSent) return;
  lastSent = s;
  for (const res of listeners) res.write(`data: ${s}\n\n`);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of controllers) if (now - c.seen > STALE_MS) controllers.delete(id);
  broadcast(false);
}, 500);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && ["/", "/index.html", "/display.html"].includes(url.pathname)) {
    const file = url.pathname === "/display.html" ? path.join(__dirname, "display.html") : PAGE;
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(500); res.end(path.basename(file) + " が見つかりません"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(buf);
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`retry: 1000\ndata: ${snapshot()}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); listeners.delete(res); });
    return;
  }
  if (req.method === "POST" && url.pathname === "/held") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => {
      try {
        const { id, held } = JSON.parse(body);
        if (typeof id !== "string" || !Array.isArray(held)) throw 0;
        const clean = held.filter(i => Number.isInteger(i) && i >= 0 && i < 8);
        controllers.set(id.slice(0, 40), { held: clean, seen: Date.now() });
        broadcast(false);
        res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => {
  console.log("鍵盤ハーモニカ展示デモ サーバー起動");
  console.log(`  表示用（このPC）:  http://localhost:${PORT}/display.html`);
  console.log("止めるときは Ctrl+C");
  watchAddresses();
});

// Print the tablet URL for every network this PC is on, and keep watching:
// USB tethering or Wi-Fi turned on after start-up shows up here within a few seconds.
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
    .map(a => a.address);
}
function watchAddresses() {
  let known = new Set(), warned = false;
  const check = () => {
    const now = lanAddresses();
    now.filter(ip => !known.has(ip)).forEach(ip => console.log(`  タブレット:        http://${ip}:${PORT}/#controller`));
    known.forEach(ip => { if (!now.includes(ip)) console.log(`  （${ip} のネットワークが切れました）`); });
    known = new Set(now);
    if (!now.length && !warned) {
      console.log("  タブレット用のネットワークがまだありません。");
      console.log("  USBテザリング（またはWi-Fi）をオンにすると、ここにタブレット用URLが表示されます。");
      warned = true;
    }
    if (now.length) warned = false;
  };
  check();
  setInterval(check, 2000);
}
