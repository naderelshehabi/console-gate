# Runs every host-testable suite in the repo. Exits non-zero if any suite fails.
# Requires: Node 22+, a C compiler (gcc), and a JDK (javac/java) on PATH.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$fail = 0

function Section($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# --- Hub (Node) ---
Section "Hub (node:test)"
Push-Location (Join-Path $root "hub")
try {
  & npm run typecheck
  & npm test
  if ($LASTEXITCODE -ne 0) { $fail = 1 }
} finally { Pop-Location }

# --- agent-core (C) ---
Section "agent-core (gcc)"
Push-Location (Join-Path $root "agent-core")
try {
  New-Item -ItemType Directory -Force build | Out-Null
  $src = Get-ChildItem src/*.c | ForEach-Object { $_.FullName }
  $tst = Get-ChildItem test/*.c | ForEach-Object { $_.FullName }
  & gcc -std=c99 -Wall -Wextra -O2 -Iinclude -Itest $src $tst -o build/cgtest.exe
  if ($LASTEXITCODE -ne 0) { $fail = 1 } else { & ./build/cgtest.exe; if ($LASTEXITCODE -ne 0) { $fail = 1 } }
} finally { Pop-Location }

# --- android/shared (JDK) ---
Section "android/shared (javac/java)"
Push-Location (Join-Path $root "android/shared")
try {
  New-Item -ItemType Directory -Force build | Out-Null
  $java = Get-ChildItem -Recurse -Filter *.java src | ForEach-Object { $_.FullName }
  & javac -Xlint:all -d build $java
  if ($LASTEXITCODE -ne 0) { $fail = 1 } else { & java -cp build com.consolegate.shared.TestMain; if ($LASTEXITCODE -ne 0) { $fail = 1 } }
} finally { Pop-Location }

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL SUITES PASSED" -ForegroundColor Green } else { Write-Host "SOME SUITES FAILED" -ForegroundColor Red }
exit $fail
