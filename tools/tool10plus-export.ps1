# Tool 10+ (FbPostGroup): goi ma nguon + du lieu (tai khoan FB, nhom, lich, bai da dang) tren MAY CU
# va gui sang may moi qua Tailscale (Taildrop). Chi DOC + sao chep, khong xoa gi.
#   irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/tools/tool10plus-export.ps1 | iex
# May nhan mac dinh: Laptop - 078 (desktop-u7gl1f6). Doi bang: $env:SARI_TO='ten-may-tailscale'
$ErrorActionPreference = "Continue"
$to = if ($env:SARI_TO) { $env:SARI_TO } else { "desktop-u7gl1f6" }
$src = if ($env:SARI_FBPG) { $env:SARI_FBPG } else { Join-Path $env:USERPROFILE "Downloads\Fb-POST-GROUP" }
$data = Join-Path $env:APPDATA "fb-post-group"
if (-not (Test-Path (Join-Path $src "package.json"))) { Write-Host "Khong thay ma nguon tool 10+ o $src (dat `$env:SARI_FBPG='duong dan')" -ForegroundColor Red; return }
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$work = Join-Path $env:TEMP ("tool10plus-" + $env:COMPUTERNAME + "-" + $stamp)
New-Item -ItemType Directory -Force -Path $work | Out-Null
Write-Host "Chep ma nguon (bo node_modules, ban build)..."
robocopy $src (Join-Path $work "app") /E /XD node_modules release dist dist-electron .vite /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
if (Test-Path $data) {
  Write-Host "Chep du lieu (tai khoan FB, nhom, lich, bai da dang; bo cache)..."
  robocopy $data (Join-Path $work "data") /E /XD sari-cache Cache "Code Cache" GPUCache DawnCache DawnGraphiteCache DawnWebGPUCache blob_storage Crashpad "Service Worker" /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
} else { Write-Host "Khong thay du lieu o $data - chi gui ma nguon." -ForegroundColor Yellow }
$zip = "$work.zip"
Compress-Archive -Path (Join-Path $work "*") -DestinationPath $zip -Force
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ("Da goi: " + $zip + " (" + [math]::Round((Get-Item $zip).Length / 1MB, 1) + " MB)")
$ts = "C:\Program Files\Tailscale\tailscale.exe"; if (-not (Test-Path $ts)) { $ts = "tailscale" }
& $ts file cp $zip ($to + ":")
if ($LASTEXITCODE -eq 0) { Write-Host "Da gui sang $to. Tren may do chay lenh tool10plus-install." -ForegroundColor Green; Remove-Item $zip -Force -ErrorAction SilentlyContinue }
else { Write-Host "Gui qua Tailscale loi. File van o: $zip" -ForegroundColor Yellow }
