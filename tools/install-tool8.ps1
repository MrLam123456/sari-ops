# Cai tool 8 (Nhan tin booking toi Zalo = UiPath) len may nay.
#   irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/tools/install-tool8.ps1 | iex
# Ma nguon nam o kho RIENG TU Sari-tool/8-Zalo-Booking-UiPath -> can dang nhap GitHub (1 lan).
# Khong ghi de du an UiPath dang co: trung ten thi doi ten cu thanh .bak-<gio>.
$ErrorActionPreference = "Continue"
$repo = "Sari-tool/8-Zalo-Booking-UiPath"
$uip = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "UiPath"
$src = Join-Path $uip "_tool8-repo"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
function Say($m, $c = "Cyan") { Write-Host $m -ForegroundColor $c }

# 1) GitHub CLI + dang nhap
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh -and (Test-Path "C:\Program Files\GitHub CLI\gh.exe")) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }
if (-not $gh) {
  Say "Cai GitHub CLI..."
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements | Out-Null
  $gh = "C:\Program Files\GitHub CLI\gh.exe"
}
& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say "Dang nhap GitHub (tai khoan co quyen vao Sari-tool) - lam theo huong dan tren man hinh:" "Yellow"
  & $gh auth login --web --git-protocol https
}

# 2) Tai / cap nhat kho
New-Item -ItemType Directory -Force -Path $uip | Out-Null
if (Test-Path (Join-Path $src ".git")) { Say "Cap nhat kho..."; git -C $src pull -q }
else { Say "Tai kho $repo..."; & $gh repo clone $repo $src -- -q }
if (-not (Test-Path (Join-Path $src "studio"))) { Say "Khong tai duoc kho $repo. Kiem tra quyen GitHub." "Red"; return }

# 3) Chep du an Studio vao Documents\UiPath
Get-ChildItem (Join-Path $src "studio") -Directory | ForEach-Object {
  $to = Join-Path $uip $_.Name
  if (Test-Path $to) { Rename-Item -LiteralPath $to -NewName ($_.Name + ".bak-" + $stamp); Say "  Du an cu $($_.Name) -> $($_.Name).bak-$stamp" "DarkGray" }
  Copy-Item -LiteralPath $_.FullName -Destination $to -Recurse
  Say "  Da chep du an: $($_.Name)"
}

# 4) Thu vien Python (neu co Python)
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($py) {
  Say "Cai thu vien Python..."
  & $py -m pip install -q flask fuzzywuzzy rapidfuzz gspread google-api-python-client google-auth-oauthlib openai requests
} else { Say "Chua co Python: cai Python 3 (winget install Python.Python.3.12) roi chay lai lenh nay." "Yellow" }

# 5) Kiem tra UiPath
$robot = Get-ChildItem "C:\Program Files\UiPathPlatform\Robot" -Directory -ErrorAction SilentlyContinue
if ($robot) { Say "UiPath Robot da co: $($robot.Name -join ', ')" "Green" } else { Say "Chua cai UiPath." "Yellow" }

Say ""
Say "CON PHAI LAM TAY:" "Yellow"
Say " 1. UiPath: tai Studio/Assistant tu cloud.uipath.com, dang nhap CUNG to chuc Automation Cloud voi PC 3 - 176."
Say " 2. Chep credentials.json + token.json tu D:\BlankProcess\ tren PC 3 - 176 sang D:\BlankProcess\ may nay."
Say " 3. Thay DIEN_OPENAI_API_KEY trong cac file .py bang khoa OpenAI that."
Say " 4. Chrome: dang nhap Zalo Web + cai tien ich UiPath cho Chrome."
Say " Chi de MOT may chay robot gui booking cung luc." "Yellow"
Say "Xong phan tu dong. Du an o: $uip" "Green"
