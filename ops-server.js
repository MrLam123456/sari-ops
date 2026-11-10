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
// Cấu hình máy (đọc 1 lần): CPU, số luồng, RAM, tên Windows — để Phòng Vận hành biết tool chạy trên máy nào.
const HW = (() => { const os = require("os"), c = os.cpus() || [];
  const cpu = String((c[0] && c[0].model) || "").replace(/\((R|TM)\)/gi, "").replace(/ CPU /gi, " ").replace(/@.*$/, "").replace(/\s+/g, " ").trim();
  return { cpu, threads: c.length, ramGB: Math.round(os.totalmem() / 2 ** 30), pc: os.hostname() }; })();
// Tải máy hiện tại: % CPU (đo chênh lệch 5 giây) và % RAM đang dùng.
let LOAD = null, prevCpu = null;
function sampleLoad() {
  const os = require("os"); let idle = 0, total = 0;
  for (const x of os.cpus() || []) { for (const k in x.times) total += x.times[k]; idle += x.times.idle; }
  const tm = os.totalmem(), fm = os.freemem();
  if (prevCpu && total > prevCpu.total) LOAD = { cpu: Math.round(100 * (1 - (idle - prevCpu.idle) / (total - prevCpu.total))), ram: Math.round(100 * (1 - fm / tm)), ramUsedGB: +((tm - fm) / 2 ** 30).toFixed(1), at: new Date().toISOString() };
  prevCpu = { idle, total };
}
sampleLoad(); setInterval(sampleLoad, 5000).unref();
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
    if (d && Array.isArray(d.tools)) peerData[t.key] = { ok: true, name: aliasOf(cfg, d) || d.host || t.name, url: t.url, tools: d.tools, hw: d.hw || null, load: d.load || null, known: true };
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
// ===== Lệnh từ PC 1 qua profile trên GitHub (không mở thêm cổng mạng) =====
// "enforce": { "<TÊN WINDOWS>": { "stop": ["<id tool>"] } }
// -> máy có đúng tên Windows đó tự tắt tool + tắt tự khởi động (giống "Disable" trong Task Manager). Chỉ TẮT, không chạy lệnh tùy ý.
const ENF_LOG = path.join(__dirname, "enforce.log");
const enfLog = m => { try { fs.appendFileSync(ENF_LOG, new Date().toISOString() + " " + m + "\n", "utf8"); } catch (e) {} };
const STARTUP_OFF_PS = String.raw`
$sa='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'; $off=[byte[]](3,0,0,0,0,0,0,0,0,0,0,0); $done=@()
function Off($sub,$name){ $k="$sa\$sub"; if(-not(Test-Path $k)){ New-Item $k -Force | Out-Null }; $cur=(Get-ItemProperty $k -EA SilentlyContinue).$name; if(-not $cur -or $cur[0] -ne 3){ New-ItemProperty $k -Name $name -PropertyType Binary -Value $off -Force | Out-Null; $script:done+="$sub/$name" } }
$run=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -EA SilentlyContinue
if($run){ $run.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and ("$($_.Name) $($_.Value)" -match $re) } | ForEach-Object { Off 'Run' $_.Name } }
$sf=[Environment]::GetFolderPath('Startup'); Get-ChildItem $sf -File -EA SilentlyContinue | Where-Object { $_.Name -match $re } | ForEach-Object { Off 'StartupFolder' $_.Name }
$hk=Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -EA SilentlyContinue
if($hk){ $hk.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and ("$($_.Name) $($_.Value)" -match $re) } | ForEach-Object { $done+="HKLM-can-Admin/$($_.Name)" } }
$done -join ';'`;
const STARTUP_ON_PS = String.raw`
$sa='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'; $on=[byte[]](2,0,0,0,0,0,0,0,0,0,0,0); $done=@(); $cmd=$null
function On($sub,$name){ $k="$sa\$sub"; $cur=(Get-ItemProperty $k -EA SilentlyContinue).$name; if($cur -and $cur[0] -ne 2){ New-ItemProperty $k -Name $name -PropertyType Binary -Value $on -Force | Out-Null; $script:done+="bat-tu-khoi-dong:$sub/$name" } }
$run=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -EA SilentlyContinue
if($run){ $run.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and ("$($_.Name) $($_.Value)" -match $re) } | ForEach-Object { On 'Run' $_.Name; if(-not $cmd){ $cmd=$_.Value } } }
$sf=[Environment]::GetFolderPath('Startup'); $lnk=Get-ChildItem $sf -File -EA SilentlyContinue | Where-Object { $_.Name -match $re }
$lnk | ForEach-Object { On 'StartupFolder' $_.Name }
$exe=$null
foreach($d in @($dir, "$env:ProgramFiles\$name", ("" + [Environment]::GetEnvironmentVariable('ProgramFiles(x86)') + "\$name"), "$env:LOCALAPPDATA\Programs\$name")){ if($d -and (Test-Path $d)){ $exe=Get-ChildItem $d -Filter *.exe -EA SilentlyContinue | Where-Object { $_.Name -notmatch '(?i)unins|uninstall|update|elevate' } | Sort-Object { -not ($_.BaseName -match $re) } | Select-Object -First 1; if($exe){ break } } }
if($exe){ Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName; $done+="mo:$($exe.FullName)" }
elseif($lnk){ Invoke-Item ($lnk | Select-Object -First 1).FullName; $done+="mo:$(($lnk | Select-Object -First 1).Name)" }
elseif($cmd){ Start-Process cmd.exe -ArgumentList '/c','start','""',$cmd -WindowStyle Hidden; $done+="mo:$cmd" }
else { $done+="KHONG-TIM-THAY-APP" }
$done -join ';'`;
const startedAt = {};
const enforcedAt = {};
async function enforce(cfg) {
  const me = require("os").hostname().toLowerCase();
  const rule = Object.entries(cfg.enforce || {}).find(([k]) => k.toLowerCase() === me);
  const stop = rule && rule[1] && Array.isArray(rule[1].stop) ? rule[1].stop : [];
  for (const id of stop) {
    const t = cfg.tools.find(x => x.id === id); if (!t || !t.match) continue;
    const re = new RegExp(t.match, "i"), ex = t.exclude ? new RegExp(t.exclude, "i") : null;
    const pids = procs.filter(x => re.test(x.CommandLine) && !(ex && ex.test(x.CommandLine)) && !/ops-server\.js/.test(x.CommandLine)).map(x => String(x.ProcessId));
    if (!enforcedAt[id] || Date.now() - enforcedAt[id] > 30 * 60000) { // tắt tự khởi động: lần đầu + 30 phút/lần
      enforcedAt[id] = Date.now();
      const o = (await ps("$re='" + t.match.replace(/'/g, "''") + "';" + STARTUP_OFF_PS)).trim();
      if (o) enfLog(`[${id}] tắt tự khởi động: ${o}`);
    }
    if (pids.length) {
      await run("taskkill", ["/F", "/T", ...pids.flatMap(p => ["/PID", p])]);
      enfLog(`[${id}] đã tắt ${pids.length} tiến trình theo lệnh PC 1 (${t.name})`);
    }
  }
  if (rule && rule[1] && Array.isArray(rule[1].install)) await enforceInstall(cfg, rule[1].install).catch(e => enfLog("lỗi cài đặt: " + e.message));
  const start = rule && rule[1] && Array.isArray(rule[1].start) ? rule[1].start : [];
  for (const id of start) { // bật lại tool (lệnh PC 1): mở app nếu chưa chạy, tối đa 30 phút/lần
    const t = cfg.tools.find(x => x.id === id); if (!t || !t.match) continue;
    const re = new RegExp(t.match, "i");
    if (procs.some(x => re.test(x.CommandLine) && !/ops-server\.js/.test(x.CommandLine))) continue;
    if (startedAt[id] && Date.now() - startedAt[id] < 30 * 60000) continue;
    startedAt[id] = Date.now();
    const q = v => "'" + String(v || "").replace(/'/g, "''") + "'";
    const name = (t.app || t.match).split("|")[0].replace(/\\/g, "");
    const dir = t.path ? t.path.replace(/%([^%]+)%/g, (_, k) => process.env[k] || "") : "";
    const o = (await ps("$re=" + q(t.match) + ";$name=" + q(name) + ";$dir=" + q(dir) + ";" + STARTUP_ON_PS)).trim();
    enfLog(`[${id}] bật lại theo lệnh PC 1 (${t.name}): ${o}`);
  }
}
// ===== Cài bản mới từ xa (enforce.install): file cài gửi qua Taildrop, kiểm SHA256, cài khi bản trên máy thấp hơn =====
const installAt = {};
const verLt = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
async function enforceInstall(cfg, items) {
  for (const it of items) {
    const t = cfg.tools.find(x => x.id === it.id); if (!t || !it.version || !it.file || !/^[0-9a-f]{64}$/i.test(it.sha256 || "")) continue;
    if (installAt[it.id] && Date.now() - installAt[it.id] < 30 * 60000) continue;
    const dir = (t.path || "").replace(/%([^%]+)%/g, (_, k) => process.env[k] || "");
    const q = v => "'" + String(v).replace(/'/g, "''") + "'";
    const cur = (await ps("$e=Get-ChildItem " + q(dir) + " -Filter *.exe -EA SilentlyContinue | Where-Object { $_.Name -notmatch '(?i)unins|uninstall|elevate' } | Select-Object -First 1; if($e){ $e.VersionInfo.FileVersion }")).trim();
    if (cur && !verLt(cur, it.version)) { if (installAt[it.id] !== -1) enfLog(`[${it.id}] cài đặt: máy đã có bản ${cur} (>= ${it.version})`); installAt[it.id] = -1; continue; }
    installAt[it.id] = Date.now();
    const inbox = path.join(__dirname, "inbox"); fs.mkdirSync(inbox, { recursive: true });
    const file = path.join(inbox, path.basename(it.file));
    if (!fs.existsSync(file)) await run("C:\\Program Files\\Tailscale\\tailscale.exe", ["file", "get", "--conflict=overwrite", inbox]);
    if (!fs.existsSync(file)) { enfLog(`[${it.id}] cài đặt: đang chờ file ${it.file} gửi qua Tailscale (bản hiện tại: ${cur || "chưa cài"})`); installAt[it.id] = Date.now() - 25 * 60000; continue; }
    const h = require("crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (h.toLowerCase() !== it.sha256.toLowerCase()) { enfLog(`[${it.id}] cài đặt: SHA256 KHÔNG khớp, đã xoá file ${it.file}`); try { fs.unlinkSync(file); } catch (e) {} continue; }
    const exe = (await ps("$e=Get-ChildItem " + q(dir) + " -Filter *.exe -EA SilentlyContinue | Where-Object { $_.Name -notmatch '(?i)unins|uninstall|elevate' } | Select-Object -First 1; if($e){ $e.FullName }")).trim();
    const script = "$ErrorActionPreference='Continue'; Get-Process | Where-Object { $_.Path -and $_.Path -like " + q(dir + "\\*") + " } | Stop-Process -Force; Start-Sleep 2; " +
      "$p=Start-Process -FilePath " + q(file) + " -ArgumentList '/S','/allusers' -Verb RunAs -PassThru -Wait; " +
      (exe ? "Start-Sleep 3; Start-Process -FilePath " + q(exe) + "; " : "") +
      "Add-Content -LiteralPath " + q(ENF_LOG) + " -Encoding utf8 -Value ((Get-Date).ToString('o') + ' [" + it.id + "] cài đặt xong, mã thoát ' + $p.ExitCode)";
    require("child_process").spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    enfLog(`[${it.id}] cài đặt: SHA256 khớp, đang cài ${it.file} (${cur || "chưa cài"} → ${it.version}) — Windows sẽ hỏi quyền Admin (UAC), cần bấm Yes trên máy`);
  }
}
// ===== Tự cập nhật ops-server.js từ GitHub (chỉ máy phụ có profile.txt; PC 1 sửa tay) =====
const RAW_SRV = "https://raw.githubusercontent.com/MrLam123456/sari-ops/main/ops-server.js";
let lastSelfUpd = Date.now() - 25 * 60000; // lần đầu sau ~5 phút
async function selfUpdate() {
  if (!fs.existsSync(path.join(__dirname, "profile.txt")) || Date.now() - lastSelfUpd < 30 * 60000) return;
  lastSelfUpd = Date.now();
  const txt = await httpsText(RAW_SRV + "?t=" + Date.now());
  if (!txt || txt.length < 5000 || !txt.includes("Phòng Vận hành") || txt === fs.readFileSync(__filename, "utf8")) return;
  const tmp = __filename.replace(/\.js$/, "") + ".new.js"; fs.writeFileSync(tmp, txt, "utf8"); // node --check cần đuôi .js
  const ok = await new Promise(r => execFile(process.execPath, ["--check", tmp], { windowsHide: true }, e => r(!e)));
  if (!ok) { enfLog("tự cập nhật: bản mới lỗi cú pháp, giữ bản cũ"); try { fs.unlinkSync(tmp); } catch (e) {} return; }
  fs.copyFileSync(__filename, __filename + ".bak"); fs.renameSync(tmp, __filename);
  enfLog("tự cập nhật: đã thay bản mới, khởi động lại");
  require("child_process").spawn(process.execPath, [__filename, ...process.argv.slice(2)], { cwd: __dirname, detached: true, stdio: "ignore", windowsHide: true }).unref();
  setTimeout(() => process.exit(0), 300);
}
async function scan() {
  syncProfile().catch(() => {});
  const cfg = loadCfg();
  await Promise.all([scanProcs(), scanTasks(cfg), scanGit(cfg), scanPeers(cfg)]);
  lastScan = Date.now();
  enforce(cfg).catch(e => enfLog("lỗi enforce: " + e.message));
  scanGh(cfg).catch(() => {});
  selfUpdate().catch(e => enfLog("lỗi tự cập nhật: " + e.message));
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
    host: HOST(), hw: HW, id: t.id, name: t.name, role: t.role, page: t.page, repo: t.repo, kind: t.kind, start: t.start, path: p,
    state, label, running,
    activity: log ? log.last : running ? "Đang chạy (tool không ghi log)" : t.kind === "cloud" ? "Xem lịch chạy trong Apps Script" : !exists ? "Không thấy bản cài ở " + p : "—",
    since: starts[0] || null, pids: mine.map(x => x.ProcessId).slice(0, 8),
    log: log ? { file: log.file, mtime: new Date(log.mtime).toISOString(), tail: log.tail } : null,
    task, git: git[t.id] || null, gh: gh[t.id] && !gh[t.id].error ? gh[t.id] : null
  };
}

// Tên PC: ưu tiên theo tên Windows (hw.pc) để cài lại máy không lẫn tên; sau đó theo tên máy tự báo.
function aliasOf(cfg, d) {
  const al = cfg.alias || {}, keys = Object.keys(al), pick = v => { const k = v && keys.find(x => x.toLowerCase() === String(v).toLowerCase()); return k ? al[k] : null; };
  return pick(d.hw && d.hw.pc) || pick(d.host);
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
    const peers = [], hwOf = d => { const n = (cfg.hwNote || {})[d.name]; return d.hw ? (n && n.label ? { ...d.hw, label: n.label } : d.hw) : (n && n.cpu ? n : null); };
    if (!localOnly) for (const d of Object.values(peerData)) {
      peers.push({ name: d.name, url: d.url, ok: d.ok, hw: hwOf(d), load: d.ok ? d.load || null : null });
      for (const pt of d.tools) {
        if (pt.state === "absent") continue;
        const i = tools.findIndex(t => t.id === pt.id);
        if (i >= 0) pt.name = tools[i].name; // tên do PC chính đặt, không chờ PC kia tải profile mới
        const remote = d.ok ? { ...pt, host: d.name, hw: hwOf(d) || pt.hw || null, gh: (i >= 0 && tools[i].gh) || pt.gh }
          : { ...pt, host: d.name, hw: hwOf(d) || pt.hw || null, state: "unknown", label: "Mất kết nối " + d.name, activity: "Máy theo dõi trên " + d.name + " không trả lời (PC tắt, mất mạng hoặc Tailscale chưa đăng nhập)", log: null };
        if (i < 0) tools.push(remote);
        else if (["absent", "off", "down", "unknown"].includes(tools[i].state) && (tools[i].state === "absent" || remote.state === "ok" || remote.state === "warn" || remote.state === "idle")) tools[i] = remote;
      }
    }
    const body = { at: new Date().toISOString(), scannedAt: lastScan ? new Date(lastScan).toISOString() : null, host: HOST(), hw: HW, load: LOAD, pageAt: (() => { try { return fs.statSync(PAGE).mtimeMs; } catch (e) { return null; } })(), gh: ghOk, peers, error: cfg.error || null, tools };
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
let busyTries = 0; // sau khi tự cập nhật, bản cũ có thể chưa nhả cổng kịp -> thử lại vài lần
server.on("error", e => {
  if (e.code === "EADDRINUSE" && ++busyTries <= 10) { setTimeout(() => server.listen(PORT, "0.0.0.0"), 2000); return; }
  console.error(e.code === "EADDRINUSE" ? `Cổng ${PORT} đang bận: có thể máy theo dõi đã chạy rồi.` : e); process.exit(1);
});
scan().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log(`Phòng Vận hành: http://localhost:${PORT}`));
  setInterval(() => scan().catch(() => {}), SCAN_MS);
});
