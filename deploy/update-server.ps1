# Cập nhật backend đang chạy trên Windows Server.
#
# Chép file này lên server một lần, để cạnh thư mục ứng dụng. Mỗi lần cập nhật
# chỉ cần chạy lại — nó tự dừng dịch vụ, sao lưu database, chép mã nguồn mới,
# cài thêm thư viện nếu cần, bật lại và kiểm tra hộ.
#
# Chạy trong PowerShell quyền Administrator:
#     .\update-server.ps1 -Source "C:\Users\Administrator\Desktop\lora_moi"
#
# -Source là thư mục chứa bản mới, phải có src\ và package.json bên trong.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Source,

  [string] $AppDir  = "D:\lora_project",
  [string] $Service = "LoraFarmBackend",
  [string] $Nssm    = "D:\nssm-2.24\win64\nssm.exe",
  [string] $HealthUrl = "http://localhost:4000/api/health"
)

$ErrorActionPreference = "Stop"

function Say($msg, $color = "Gray") { Write-Host "  $msg" -ForegroundColor $color }

Write-Host "`n=== CAP NHAT BACKEND ===" -ForegroundColor Cyan

# --- Kiểm tra đầu vào trước khi đụng vào bất cứ thứ gì đang chạy ---------------
if (-not (Test-Path "$Source\src\index.js")) {
  throw "Khong thay $Source\src\index.js — kiem tra lai duong dan -Source"
}
if (-not (Test-Path $AppDir)) { throw "Khong thay thu muc ung dung: $AppDir" }
if (-not (Test-Path $Nssm))   { throw "Khong thay nssm.exe: $Nssm" }

Say "Nguon : $Source"
Say "Dich  : $AppDir"

# --- 1. Dừng dịch vụ ----------------------------------------------------------
# Dừng trước khi chép: SQLite đang giữ file database mở, và tiến trình đang chạy
# có thể khoá file .js khiến chép đè thất bại giữa chừng.
Write-Host "`n[1/5] Dung dich vu..." -ForegroundColor Yellow
& $Nssm stop $Service | Out-Null
Start-Sleep -Seconds 2
Say "da dung"

# --- 2. Sao lưu database ------------------------------------------------------
# Rẻ, và là thứ duy nhất không thể tạo lại: lịch sử đo, ngưỡng đã chỉnh, tài khoản.
Write-Host "`n[2/5] Sao luu database..." -ForegroundColor Yellow
$db = "$AppDir\data\farm.db"
if (Test-Path $db) {
  $stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$AppDir\backup"
  New-Item -ItemType Directory -Force $backup | Out-Null
  Copy-Item $db "$backup\farm-$stamp.db"
  Say "da luu: backup\farm-$stamp.db" "Green"

  # Giữ 10 bản gần nhất, dọn phần còn lại cho khỏi đầy ổ
  Get-ChildItem "$backup\farm-*.db" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 10 |
    Remove-Item -Force
} else {
  Say "chua co database, bo qua"
}

# --- 3. Chép mã nguồn ---------------------------------------------------------
# CHỈ chép src\ và hai file package. Ba thứ tuyệt đối không đụng:
#   .env          — chứa khoá thật, khác hẳn .env.example
#   data\         — database
#   node_modules\ — biên dịch sẵn cho đúng máy này
Write-Host "`n[3/5] Chep ma nguon..." -ForegroundColor Yellow
Remove-Item "$AppDir\src" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$Source\src" "$AppDir\src" -Recurse -Force
Say "src\ da chep"

$depsChanged = $false
foreach ($f in @("package.json", "package-lock.json")) {
  if (-not (Test-Path "$Source\$f")) { continue }
  $new = (Get-FileHash "$Source\$f").Hash
  $old = if (Test-Path "$AppDir\$f") { (Get-FileHash "$AppDir\$f").Hash } else { "" }
  if ($new -ne $old) { $depsChanged = $true }
  Copy-Item "$Source\$f" "$AppDir\$f" -Force
}

# --- 4. Cài thư viện nếu cần --------------------------------------------------
Write-Host "`n[4/5] Thu vien..." -ForegroundColor Yellow
if ($depsChanged) {
  Say "package.json doi -> npm install" "Yellow"
  Push-Location $AppDir
  npm install --omit=dev
  Pop-Location
} else {
  Say "khong doi, bo qua npm install"
}

# --- 5. Bật lại và kiểm tra ---------------------------------------------------
# Migration schema chạy tự động lúc khởi động (db.js), nên bật lại là đã áp dụng.
Write-Host "`n[5/5] Bat lai dich vu..." -ForegroundColor Yellow
& $Nssm start $Service | Out-Null

$ok = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-RestMethod $HealthUrl -TimeoutSec 3
    if ($r.ok) { $ok = $true; break }
  } catch { }
}

Write-Host ""
if ($ok) {
  Write-Host "=== XONG — backend da chay lai ===" -ForegroundColor Green
  Say "Kiem tra tu ngoai: http://be-shopminhnhat.click/api/health"
} else {
  Write-Host "=== KHONG LEN DUOC ===" -ForegroundColor Red
  Say "Xem log:  Get-Content '$AppDir\logs\err.log' -Tail 40" "Red"
  Say "Quay lai ban cu: chep lai src\ cu roi chay lai script nay" "Red"
  exit 1
}
