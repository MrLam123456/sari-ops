# Gom kich ban UiPath (tool 8) tren may nay va gui ve PC 1 - 892 qua Tailscale (Taildrop).
# Chay tren may dang co robot UiPath (PowerShell thuong, khong can Admin):
#   irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/tools/pack-uipath.ps1 | iex
# Chi DOC va sao chep file kich ban (.xaml, project.json, file du lieu nho). Khong sua/xoa gi tren may.
$ErrorActionPreference = "Continue"
$dest = if ($env:SARI_PC1) { $env:SARI_PC1 } else { "desktop-d4sad92" }
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$work = Join-Path $env:TEMP ("tool8-uipath-" + $env:COMPUTERNAME + "-" + $stamp)
New-Item -ItemType Directory -Force -Path $work | Out-Null
$keep = @("*.xaml", "*.json", "*.xlsx", "*.xls", "*.csv", "*.txt", "*.md", "*.config", "*.cs", "*.vb", "*.png", "*.jpg")
$skipDir = '\\(\.local|\.objects|\.tmp|\.screenshots|node_modules|\.git)(\\|$)'
$manifest = New-Object System.Collections.Generic.List[string]
$manifest.Add("May: $env:COMPUTERNAME  Nguoi dung: $env:USERNAME  Luc: $(Get-Date -Format s)")

function Copy-Project($src, $name) {
  $out = Join-Path $work $name
  $n = 0
  Get-ChildItem -LiteralPath $src -Recurse -File -Include $keep -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $skipDir -and $_.Length -lt 20MB } | ForEach-Object {
      $rel = $_.FullName.Substring($src.Length).TrimStart('\')
      $t = Join-Path $out $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $t -Force
      $n++
    }
  $manifest.Add("$name <= $src ($n file)")
}

# 1) Du an UiPath Studio (thu muc co project.json kieu UiPath) trong ho so nguoi dung
$roots = @("$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\OneDrive") | Where-Object { Test-Path $_ }
$seen = @{}
foreach ($r in $roots) {
  Get-ChildItem -LiteralPath $r -Recurse -Depth 5 -Filter project.json -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $skipDir } | ForEach-Object {
      $txt = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
      if ($txt -match '"(studioVersion|main|expressionLanguage)"' -and -not $seen[$_.DirectoryName]) {
        $seen[$_.DirectoryName] = 1
        Copy-Project $_.DirectoryName ("studio\" + (Split-Path $_.DirectoryName -Leaf))
      }
    }
}

# 2) Goi process robot da tai ve (.nuget\packages\<ten>\<phien ban>) - chi goi co .xaml
$nu = "$env:USERPROFILE\.nuget\packages"
if (Test-Path $nu) {
  Get-ChildItem -LiteralPath $nu -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $pkg = $_
    if ($pkg.Name -match '^(uipath\.|system\.|microsoft\.|newtonsoft|nuget\.)') { return }
    $ver = Get-ChildItem -LiteralPath $pkg.FullName -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($ver -and (Get-ChildItem -LiteralPath $ver.FullName -Recurse -Filter *.xaml -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      Copy-Project $ver.FullName ("robot\" + $pkg.Name + "\" + $ver.Name)
    }
  }
}

# 3) Thong tin robot (phien ban, khong lay mat khau/khoa)
$robot = Get-ChildItem "C:\Program Files\UiPathPlatform\Robot" -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
$manifest.Add("UiPath Robot: $($robot -join ', ')")
$manifest | Set-Content -LiteralPath (Join-Path $work "MANIFEST.txt") -Encoding UTF8

$zip = "$work.zip"
Compress-Archive -Path (Join-Path $work "*") -DestinationPath $zip -Force
Write-Host ("Da gom: " + $zip + " (" + [math]::Round((Get-Item $zip).Length / 1MB, 2) + " MB)")
$manifest | ForEach-Object { Write-Host "  $_" }

$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (-not (Test-Path $ts)) { $ts = "tailscale" }
& $ts file cp $zip ($dest + ":")
if ($LASTEXITCODE -eq 0) { Write-Host "Da gui ve $dest qua Tailscale. Xong." -ForegroundColor Green }
else { Write-Host "Gui qua Tailscale loi. File van o: $zip" -ForegroundColor Yellow }
