$ErrorActionPreference = "Stop"

$project = "C:\Users\15225\project2\mipmap1\mipmap1.uproject"
$editor = "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$script = Join-Path $PSScriptRoot "export_unreal_layout.py"
$tempScript = Join-Path $env:TEMP "codex_export_unreal_layout.py"

if (!(Test-Path $project)) {
  throw "Unreal project not found: $project"
}

if (!(Test-Path $editor)) {
  throw "UnrealEditor-Cmd.exe not found: $editor"
}

if (!(Test-Path $script)) {
  throw "Export script not found: $script"
}

Copy-Item -LiteralPath $script -Destination $tempScript -Force
& $editor $project -run=pythonscript -script="$tempScript" -unattended -nop4 -nosplash

if ($LASTEXITCODE -ne 0) {
  throw "Unreal layout export failed with exit code $LASTEXITCODE"
}