// Sari · Máy theo dõi Phòng Vận hành
// Chỉ ĐỌC trạng thái: tiến trình, Task Scheduler, file log, git. Không bật/tắt/sửa tool nào.
// Chạy: node ops-server.js   → mở http://localhost:8787
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const PORT = +process.env.SARI_OPS_PORT || 8787;
const CFG = path.join(__dirname, "tools.json");
const PAGE = path.join(process.env.USERPROFILE || "C:\\Users\\admin", "SariMarketing3D", "Phong Marketing Sari.html");
const SCAN_MS = 15000;

const env = s => String(s || "").replace(/%([A-Z_]+)%/gi, (_, k) => process.env[k] || "");
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(CFG, "utf8").replace(/^﻿/, "")); } catch (e) { return { tools: [], error: String(e.message) }; } };
const GH = fs.existsSync("C:/Program Files/GitHub CLI/gh.exe") ? "C:/Program Files/GitHub CLI/gh.exe" : "gh";
const run = (file, args, timeout = 20000) => new Promise(r => execFile(file, args, { maxBuffer: 64 << 20, windowsHide: true, timeout, encoding: "utf8" }, (e, o) => r(e ? "" : o)));
const ps = cmd => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + cmd]);
const asArr = v => v == null ? [] : Array.isArray(v) ? v : [v];

let procs = [], tasks = {}, git = {}, gh = {}, lastScan = 0, ghOk = null, peerData = {};
const HOST = () => { const c = loadCfg(); if (c.machine) return c.machine; try { return fs.readFileSync(path.join(__dirname, "machine.txt"), "utf8").replace(/^﻿/, "").trim() || require("os").hostname(); } catch (e) { return require("os").hostname(); } };
const TS = "C:/Program Files/Tailscale/tailscale.exe";
let FB = null; try { FB = require("./fb-poster"); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") console.error("fb-poster:", e.message); }
function getJson(url, ms = 5000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: ms }, res => { let b = ""; res.setEncoding("utf8"); res.on("data", d => b += d); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  });
}

function getJson(url, ms = 5000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: ms }, res => { let b = ""; res.setEncoding("utf8"); res.on("data", d => b += d); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  });
}
async function scanPeers(cfg) {
  // Tự tìm các PC trong mạng Tailscale + các peer khai báo tay trong tools.json
  const targets = (cfg.peers || []).map(p => ({ key: p.url, url: p.url.replace(/\/$/, ""), name: p.name }));
  if (fs.existsSync(TS)) {
    const out = await run(TS, ["status", "--json"], 10000);
    try {
      const j = JSON.parse(out);
      for (const p of Object.values(j.Peer || {})) {
        const ip = (p.TailscaleIPs || []).find(x => x.includes("."));
        if (ip && (p.OS || "").toLowerCase().startsWith("windows")) targets.push({ key: ip, url: "http://" + ip + ":8787", name: p.HostName, online: p.Online });
      }
    } catch (e) {}
  }
  for (const t of targets) {
    const d = t.online === false ? null : await getJson(t.url + "/status?local=1", 5000);
    const prev = peerData[t.key];
    if (d && Array.isArray(d.tools)) peerData[t.key] = { ok: true, name: (cfg.alias || {})[d.host] || d.host || t.name, url: t.url, tools: d.tools, known: true };
    else if (prev && prev.known) peerData[t.key] = { ...prev, ok: false };   // từng kết nối, giờ mất
    else delete peerData[t.key];                                             // PC chưa cài Sari Ops: bỏ qua
  }
}

async function scanProcs() {
  const out = await ps("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,Name,CommandLine,ExecutablePath,@{n='Start';e={ if($_.CreationDate){ $_.CreationDate.ToString('o') } }} | ConvertTo-Json -Compress");
  try { const a = asArr(JSON.parse(out)); if (a.length) procs = a; } catch (e) { /* giữ lần quét trước */ }
}
async function scanTasks(cfg) {
  const names = [...new Set(cfg.tools.filter(t => t.task).map(t => t.task))];
  if (!names.length) return;
  const items = names.map(n => { const q = n.replace(/'/g, "''"); return `(& { $t=Get-ScheduledTask -TaskName '${q}' -EA SilentlyContinue; $i=$null; if($t){$i=$t|Get-ScheduledTaskInfo -EA SilentlyContinue}; [pscustomobject]@{n='${q}';state=[string]$t.State;last=$(if($i -and $i.LastRunTime){$i.LastRunTime.ToString('o')});result=$(if($i){$i.LastTaskResult})} })`; }).join(",");
  const out = await ps(`@(${items}) | ConvertTo-Json -Compress`);
  try { const m = {}; asArr(JSON.parse(out)).forEach(x => m[x.n] = x); tasks = m; } catch (e) {}
}
async function scanGit(cfg) {
  for (const t of cfg.tools) {
    const p = env(t.path); if (!p || !fs.existsSync(path.join(p, ".git"))) continue;
    const g = git[t.id]; if (g && Date.now() - g.at < 5 * 60000) continue;
    const o = (await run("git", ["-C", p, "log", "-1", "--format=%cI|%h|%s"])).trim();
    if (o) { const [date, hash, ...msg] = o.split("|"); git[t.id] = { at: Date.now(), date, hash, msg: msg.join("|") }; }
  }
}
async function scanGh(cfg) {
  if (ghOk === false) return;
  for (const t of cfg.tools) {
    if (!t.repo) continue;
    const g = gh[t.id]; if (g && Date.now() - g.at < 30 * 60000) continue;
    const o = await run(GH, ["api", "repos/" + t.repo, "--jq", "{pushed:.pushed_at,desc:.description,private:.private,url:.html_url}"]);
    if (!o) { if (ghOk === null) ghOk = false; gh[t.id] = { at: Date.now(), error: true }; continue; }
    ghOk = true;
    try { gh[t.id] = { at: Date.now(), ...JSON.parse(o) }; } catch (e) {}
  }
}
const RAW = "https://raw.githubusercontent.com/MrLam123456/sari-ops/main/profiles/";
let lastProfileSync = 0;
function httpsText(url) {
  return new Promise(resolve => {
    require("https").get(url, { timeout: 10000 }, res => { if (res.statusCode !== 200) { res.resume(); return resolve(null); } let b = ""; res.setEncoding("utf8"); res.on("data", d => b += d); res.on("end", () => resolve(b)); }).on("error", () => resolve(null));
  });
}
async function syncProfile() {
  const pf = path.join(__dirname, "profile.txt");
  if (!fs.existsSync(pf) || Date.now() - lastProfileSync < 10 * 60000) return;
  lastProfileSync = Date.now();
  const name = fs.readFileSync(pf, "utf8").replace(/^\uFEFF/, "").trim(); if (!/^[\w-]+$/.test(name)) return;
  const txt = await httpsText(RAW + name + ".json?t=" + Date.now());
  try { const j = JSON.parse(txt); if (Array.isArray(j.tools) && txt !== fs.readFileSync(CFG, "utf8")) fs.writeFileSync(CFG, txt, "utf8"); } catch (e) {}
}
async function scan() {
  syncProfile().catch(() => {});
  const cfg = loadCfg();
  await Promise.all([scanProcs(), scanTasks(cfg), scanGit(cfg), scanPeers(cfg)]);
  lastScan = Date.now();
  scanGh(cfg).catch(() => {});
}

function newestIn(dir, pattern) {
  try {
    const re = new RegExp(pattern || ".", "i");
    return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f))
      .map(f => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)[0]?.f || null;
  } catch (e) { return null; }
}
function readLog(t) {
  if (!t.log) return null;
  const file = typeof t.log === "string" ? env(t.log) : newestIn(env(t.log.dir), t.log.pattern);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const st = fs.statSync(file), size = st.size, n = Math.min(size, 24000);
    const fd = fs.openSync(file, "r"), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, t.logPick === "head" ? 0 : size - n); fs.closeSync(fd);
    const lines = buf.toString("utf8").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const tail = t.logPick === "head" ? lines.slice(0, 20) : lines.slice(-20);
    const last = t.logPick === "head" ? (lines[1] || lines[0] || "") : (lines[lines.length - 1] || "");
    return { file, mtime: st.mtimeMs, last: last.slice(0, 300), tail };
  } catch (e) { return null; }
}
const ago = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + " phút" : m < 1440 ? Math.round(m / 60) + " giờ" : Math.round(m / 1440) + " ngày"; };

function status(t) {
  const p = env(t.path), exists = !p || fs.existsSync(p);
  let mine = [];
  if (t.match) {
    const re = new RegExp(t.match, "i"), ex = t.exclude ? new RegExp(t.exclude, "i") : null;
    mine = procs.filter(x => re.test(x.CommandLine) && !(ex && ex.test(x.CommandLine)) && !/ops-server\.js/.test(x.CommandLine));
  }
  const task = t.task ? tasks[t.task] || null : null;
  const running = mine.length > 0 || (task && task.state === "Running");
  const log = readLog(t), age = log ? Date.now() - log.mtime : null;
  // Tool chạy theo đợt (Task Scheduler gọi lại vài phút một lần): giữa 2 đợt không thấy tiến trình,
  // nhưng log vừa ghi gần đây thì vẫn coi là đang làm việc.
  const freshLog = !running && exists && t.kind === "service" && age != null && age <= (t.staleMin || 15) * 60000;
  let state, label;
  if (t.kind === "cloud") { state = "cloud"; label = "Chạy trên Google, máy không theo dõi được"; }
  else if (running || freshLog) {
    const err = !t.noErr && log && /error|traceback|exception|fatal|lỗi/i.test(log.last) && !(t.ignore && new RegExp(t.ignore, "i").test(log.last));
    if (err) { state = "warn"; label = "Đang chạy, vừa báo lỗi"; }
    else if (t.staleMin && age != null && age > t.staleMin * 60000) { state = "idle"; label = "Đang chạy, im lặng " + ago(age); }
    else { state = "ok"; label = freshLog ? "Đang làm việc (chạy theo đợt, log " + ago(age) + " trước)" : "Đang làm việc"; }
  } else if (!exists) { state = "absent"; label = "Chưa cài trên máy này"; }
  else if (t.kind === "service") { state = "down"; label = "Đã dừng"; }
  else { state = "off"; label = "Nghỉ, chạy khi cần"; }
  if (loadCfg().onlyRunning && !running && !freshLog && t.kind !== "cloud") { state = "absent"; label = "Không chạy trên máy này"; }
  const starts = mine.map(x => x.Start).filter(Boolean).sort();
  return {
    host: HOST(), id: t.id, name: t.name, role: t.role, page: t.page, repo: t.repo, kind: t.kind, start: t.start, path: p,
    state, label, running,
    activity: log ? log.last : running ? "Đang chạy (tool không ghi log)" : t.kind === "cloud" ? "Xem lịch chạy trong Apps Script" : !exists ? "Không thấy bản cài ở " + p : "—",
    since: starts[0] || null, pids: mine.map(x => x.ProcessId).slice(0, 8),
    log: log ? { file: log.file, mtime: new Date(log.mtime).toISOString(), tail: log.tail } : null,
    task, git: git[t.id] || null, gh: gh[t.id] && !gh[t.id].error ? gh[t.id] : null
  };
}

const allowed = ip => { ip = String(ip || "").replace(/^::ffff:/, ""); if (ip === "127.0.0.1" || ip === "::1") return true;
  const m = ip.match(/^100\.(\d+)\./); if (m && +m[1] >= 64 && +m[1] <= 127) return true; // Tailscale 100.64.0.0/10
  return /^fd7a:115c:a1e0:/i.test(ip); };
const server = http.createServer((req, res) => {
  if (!allowed(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
  const url = req.url.split("?")[0];
  if (FB && FB.handle(req, res, url)) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url === "/status") {
    const cfg = loadCfg();
    const localOnly = /[?&]local=1/.test(req.url);
    let tools = cfg.tools.map(status);
    const peers = [];
    if (!localOnly) for (const d of Object.values(peerData)) {
      peers.push({ name: d.name, url: d.url, ok: d.ok });
      for (const pt of d.tools) {
        if (pt.state === "absent") continue;
        const i = tools.findIndex(t => t.id === pt.id);
        const remote = d.ok ? { ...pt, host: d.name, gh: (i >= 0 && tools[i].gh) || pt.gh }
          : { ...pt, host: d.name, state: "unknown", label: "Mất kết nối " + d.name, activity: "Máy theo dõi trên " + d.name + " không trả lời (PC tắt, mất mạng hoặc Tailscale chưa đăng nhập)", log: null };
        if (i < 0) tools.push(remote);
        else if (["absent", "off", "down", "unknown"].includes(tools[i].state) && (tools[i].state === "absent" || remote.state === "ok" || remote.state === "warn" || remote.state === "idle")) tools[i] = remote;
      }
    }
    const body = { at: new Date().toISOString(), scannedAt: lastScan ? new Date(lastScan).toISOString() : null, host: HOST(), gh: ghOk, peers, error: cfg.error || null, tools };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(body));
  }
  if (url === "/procs") {
    const seen = {};
    for (const x of procs) {
      const exe = x.ExecutablePath || x.Name || "";
      if (/^C:.Windows./i.test(exe) || /ops-server.js/.test(x.CommandLine)) continue;
      const cmd = String(x.CommandLine || "").replace(/((token|key|pass|secret|pwd|cookie)\w*["']?\s*[=:\s]\s*)\S+/gi, "$1***").slice(0, 220);
      const k = exe + "|" + cmd; if (!seen[k]) seen[k] = { name: x.Name, exe, cmd, n: 0 }; seen[k].n++;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ host: HOST(), procs: Object.values(seen) }));
  }
  if (url === "/" || url === "/index.html") {
    fs.readFile(PAGE, (e, d) => {
      if (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Không thấy file " + PAGE); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(d);
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.on("error", e => { console.error(e.code === "EADDRINUSE" ? `Cổng ${PORT} đang bận: có thể máy theo dõi đã chạy rồi.` : e); process.exit(1); });
scan().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log(`Phòng Vận hành: http://localhost:${PORT}`));
  setInterval(() => scan().catch(() => {}), SCAN_MS);
});
