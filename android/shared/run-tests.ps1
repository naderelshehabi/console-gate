# Builds and runs the shared-module unit suite with a plain JDK (no Gradle/JUnit).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force build | Out-Null
$srcs = Get-ChildItem -Recurse -Filter *.java src | ForEach-Object { $_.FullName }
& javac -Xlint:all -d build $srcs
& java -cp build com.consolegate.shared.TestMain
exit $LASTEXITCODE
