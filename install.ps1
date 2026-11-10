# Sari Ops - cai may theo doi Phong Van hanh len 1 PC
# Chay trong PowerShell:
#   irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
# Danh sach tool cua may tu cap nhat tu profiles/<bo tool>.json moi 10 phut.
# Doi ten may / bo tool (tuy chon):
#   $env:SARI_MAY='PC 3 - 176'; $env:SARI_PROFILE='pc2'; irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://raw.githubusercontent.com/MrLam123456/sari-ops/main'
$may  = if ($env:SARI_MAY) { $env:SARI_MAY } else { $env:COMPUTERNAME }
$prof = if ($env:SARI_PROFILE) { $env:SARI_PROFILE } else { 'pc2' }
$dest = Join-Path $env:USERPROFILE 'SariOps'
$ts   = 'C:\Program Files\Tailscale\tailscale.exe'
$node = 'C:\Program Files\nodejs\node.exe'

Write-Host "== Sari Ops: cai cho may '$may' (bo tool: $prof) ==" -ForegroundColor Cyan

Write-Host '[1/6] Node.js...'
if (-not (Test-Path $node) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
}

Write-Host '[2/6] Tailscale...'
if (-not (Test-Path $ts)) {
  winget install -e --id Tailscale.Tailscale --silent --accept-package-agreements --accept-source-agreements
}

Write-Host "[3/6] Tai file ve $dest ..."
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest "$base/ops-server.js"        -OutFile (Join-Path $dest 'ops-server.js') -UseBasicParsing
Invoke-WebRequest "$base/Sari%20Ops.vbs"       -OutFile (Join-Path $dest 'Sari Ops.vbs')  -UseBasicParsing
Invoke-WebRequest "$base/profiles/$prof.json" -OutFile (Join-Path $dest 'tools.json') -UseBasicParsing
[IO.File]::WriteAllText((Join-Path $dest 'profile.txt'), $prof, (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $dest 'machine.txt'), $may, (New-Object Text.UTF8Encoding $false))

Write-Host '[4/6] Tu bat cung Windows...'
$startup = [Environment]::GetFolderPath('Startup')
Copy-Item (Join-Path $dest 'Sari Ops.vbs') (Join-Path $startup 'Sari Ops.vbs') -Force

Write-Host '[5/6] Mo cong 8787 CHI cho mang Tailscale (bam Yes khi Windows hoi)...'
$fw = "Remove-NetFirewallRule -DisplayName SariOps8787 -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName SariOps8787 -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null"
try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',$fw } catch { Write-Host '   Bo qua mo cong (khong co quyen admin). May chinh se khong doc duoc may nay.' -ForegroundColor Yellow }

Write-Host '[6/6] Bat may theo doi...'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ops-server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $dest 'Sari Ops.vbs') + '"'), 'nobrowser'

$state = (& $ts status 2>&1 | Out-String)
if ($state -match 'Logged out|NeedsLogin|log in') {
  Write-Host ''
  Write-Host '>> Dang nhap Tailscale bang CUNG tai khoan voi PC chinh:' -ForegroundColor Yellow
  & $ts login
}
Write-Host ''
Write-Host '===== XONG =====' -ForegroundColor Green
Write-Host ("May: $may  |  Tailscale IP: " + ((& $ts ip -4) | Select-Object -First 1))
Write-Host 'PC chinh se tu tim thay may nay trong khoang 1 phut.'
