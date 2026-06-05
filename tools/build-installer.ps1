param(
    [string]$Configuration = "release",
    [string]$OutDir = "dist-installer",
    [string]$DevtoolsModule = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$SrcTauri = Join-Path $Root "src-tauri"
$Target = Join-Path $SrcTauri "target\$Configuration"
$Stage = Join-Path $Root "$OutDir\payload"
$Setup = Join-Path $Root "$OutDir\NyxSetup.exe"

function Copy-RequiredFile {
    param([string]$From, [string]$To)
    if (!(Test-Path $From)) { throw "Missing required file: $From" }
    $Parent = Split-Path -Parent $To
    if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
    Copy-Item -LiteralPath $From -Destination $To -Force
}

function Copy-OptionalTree {
    param([string]$From, [string]$To)
    if (Test-Path $From) {
        New-Item -ItemType Directory -Force -Path $To | Out-Null
        Get-ChildItem -LiteralPath $From -Force | Copy-Item -Destination $To -Recurse -Force
    }
}

Write-Host "Building frontend"
Push-Location $Root
npm run build
Pop-Location

Write-Host "Building Rust release binaries"
Push-Location $SrcTauri
cargo build --release --bin thazts-ide --bin nyx-keyman --bin nyx-installer --bin NyxCli
Pop-Location

if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Copy-RequiredFile (Join-Path $Target "thazts-ide.exe") (Join-Path $Stage "Nyx.exe")
Copy-RequiredFile (Join-Path $Target "nyx-keyman.exe") (Join-Path $Stage "nyx-keyman.exe")
Copy-RequiredFile (Join-Path $Target "NyxCli.exe") (Join-Path $Stage "NyxCli\NyxCli.exe")

Copy-OptionalTree (Join-Path $Root "dist") (Join-Path $Stage "dist")
Copy-OptionalTree (Join-Path $Root "media") (Join-Path $Stage "assets\media")
Copy-OptionalTree (Join-Path $Root "nyx_runtime") (Join-Path $Stage "runtime")
Copy-OptionalTree (Join-Path $Root "presets") (Join-Path $Stage "presets")

if (Test-Path (Join-Path $SrcTauri "icons\icon.ico")) {
    Copy-RequiredFile (Join-Path $SrcTauri "icons\icon.ico") (Join-Path $Stage "assets\icon.ico")
}

if ($DevtoolsModule -and (Test-Path $DevtoolsModule)) {
    Copy-OptionalTree $DevtoolsModule (Join-Path $Stage "modules\devtools")
} elseif (Test-Path (Join-Path $Root "devtools-module")) {
    Copy-OptionalTree (Join-Path $Root "devtools-module") (Join-Path $Stage "modules\devtools")
}

$InstallerStub = Join-Path $Target "nyx-installer.exe"
Copy-RequiredFile $InstallerStub (Join-Path $Root "$OutDir\nyx-installer-stub.exe")

Write-Host "Packing self-extracting installer"
& $InstallerStub --pack $InstallerStub $Stage $Setup

Write-Host ""
Write-Host "Installer ready: $Setup"
Write-Host "Payload staged at: $Stage"
