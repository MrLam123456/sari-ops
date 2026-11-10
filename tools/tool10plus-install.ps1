# Tool 10+ (FbPostGroup): nhan goi tu may cu qua Tailscale, cai va chay tren MAY NAY, tu khoi dong cung Windows.
#   irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/tools/tool10plus-install.ps1 | iex
# Khong ghi de: thu muc/du lieu cu (neu co) doi ten thanh .bak-<gio>.
$ErrorActionPreference = "Continue"
function Say($m, $c = "Cyan") { Write-Host $m -ForegroundColor $c }
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$app = Join-Path $env:USERPROFILE "Fb-POST-GROUP"
$data = Join-Path $env:APPDATA "fb-post-group"
$inbox = Join-Path $env:TEMP "tool10plus-inbox"
New-Item -ItemType Directory -Force -Path $inbox | Out-Null
$ts = "C:\Program Files\Tailscale\tailscale.exe"; if (-not (Test-Path $ts)) { $ts = "tailscale" }

# 1) Nhan goi (cho toi khi may cu gui toi)
$zip = Get-ChildItem $inbox -Filter "tool10plus-*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) {
  Say "Dang cho goi tool 10+ gui tu may cu qua Tailscale (chay tool10plus-export tren may cu)..." "Yellow"
  & $ts file get --wait $inbox
  $zip = Get-ChildItem $inbox -Filter "tool10plus-*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $zip) { Say "Khong nhan duoc goi tool 10+." "Red"; return }
Say "Da nhan: $($zip.Name)"
$x = Join-Path $env:TEMP ("tool10plus-x-" + $stamp)
Expand-Archive -LiteralPath $zip.FullName -DestinationPath $x -Force

# 2) Chep ma nguon + du lieu
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Fb-POST-GROUP' -and $_.CommandLine -notmatch 'tool10plus' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path $app) { Rename-Item -LiteralPath $app -NewName ("Fb-POST-GROUP.bak-" + $stamp); Say "  Ban cu -> Fb-POST-GROUP.bak-$stamp" "DarkGray" }
Copy-Item -LiteralPath (Join-Path $x "app") -Destination $app -Recurse
if (Test-Path (Join-Path $x "data")) {
  if (Test-Path $data) { Rename-Item -LiteralPath $data -NewName ("fb-post-group.bak-" + $stamp); Say "  Du lieu cu -> fb-post-group.bak-$stamp" "DarkGray" }
  Copy-Item -LiteralPath (Join-Path $x "data") -Destination $data -Recurse
  Say "  Da chep du lieu (tai khoan FB, nhom, lich)"
}

# 3) Node + thu vien
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Say "Cai Node.js LTS..."; winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
Say "Cai thu vien (npm install) - mat vai phut..."
Push-Location $app; npm install --no-audit --no-fund 2>&1 | Select-Object -Last 3; Pop-Location
if (-not (Test-Path (Join-Path $app "node_modules\electron"))) { Say "npm install loi - xem thong bao o tren." "Red"; return }

# 4) Tu khoi dong cung Windows + chay ngay
$vbs = Join-Path ([Environment]::GetFolderPath("Startup")) "FbPostGroup tool 10+.vbs"
$lines = @(
  'Set sh = CreateObject("WScript.Shell")',
  ('sh.CurrentDirectory = "' + $app + '"'),
  'sh.Run "cmd /c npm run dev >> fbpostgroup.log 2>&1", 0, False'
)
Set-Content -LiteralPath $vbs -Value $lines -Encoding ASCII
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip.FullName -Force -ErrorAction SilentlyContinue
Say "Xong: tool 10+ dang khoi dong tren may nay (cua so FbPostGroup se hien sau ~20 giay) va tu chay khi bat may." "Green"
Say "Kiem tra trang Tai khoan FB trong app: cac tai khoan phai o trang thai dang nhap. Cookie loi thi dan lai." "Yellow"
