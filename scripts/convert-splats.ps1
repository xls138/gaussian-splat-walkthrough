param(
  [string]$Room = "",
  [ValidateSet("low", "medium", "high", "all")]
  [string]$Tier = "medium",
  [switch]$All,
  [switch]$Overwrite,
  [int]$LowCount = 1250000,
  [int]$MediumCount = 2500000,
  [int]$HighCount = 9000000,
  [ValidateRange(0, 3)]
  [int]$HighHarmonics = 2,
  [int]$Iterations = 10,
  [string]$Gpu = "",
  [string]$Rotate = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$roomsPath = Join-Path $projectRoot "public\content\rooms.json"
$tool = Join-Path $projectRoot "node_modules\.bin\splat-transform.cmd"

if (!(Test-Path -LiteralPath $tool)) {
  throw "splat-transform was not found. Run npm.cmd install first."
}

$config = Get-Content -LiteralPath $roomsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rooms = @($config.rooms)

if ($All) {
  $selectedRooms = $rooms
} else {
  if (!$Room) {
    throw "Pass -Room <room-id>, or use -All. Example: npm.cmd run splat:convert -- -Room public-area -Tier medium"
  }
  $selectedRooms = @($rooms | Where-Object { $_.id -eq $Room })
  if (!$selectedRooms.Count) {
    throw "Room not found in rooms.json: $Room"
  }
}

$tiers = if ($Tier -eq "all") { @("low", "medium", "high") } else { @($Tier) }

foreach ($roomItem in $selectedRooms) {
  $source = $roomItem.sourcePly
  if (!$source -or !(Test-Path -LiteralPath $source)) {
    throw "Source PLY not found for $($roomItem.id): $source"
  }

  foreach ($tierName in $tiers) {
    $splatUrl = $roomItem.splat.$tierName
    if (!$splatUrl) {
      Write-Warning "Skipping $($roomItem.id) $tierName because rooms.json has no splat URL."
      continue
    }

    $relative = $splatUrl.TrimStart("/") -replace "/", "\"
    $output = Join-Path (Join-Path $projectRoot "public") $relative
    $outputDir = Split-Path -Parent $output
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

    if ((Test-Path -LiteralPath $output) -and !$Overwrite) {
      Write-Host "Skipping existing file: $output"
      continue
    }

    if ($tierName -eq "low") {
      $targetCount = $LowCount
      $harmonics = 0
    } elseif ($tierName -eq "medium") {
      $targetCount = $MediumCount
      $harmonics = 0
    } else {
      $targetCount = $HighCount
      $harmonics = $HighHarmonics
    }

    $args = @("-w", "-i", "$Iterations")
    if ($Gpu) {
      $args += @("-g", $Gpu)
    }
    $args += @($source)
    if ($Rotate) {
      $args += @("-r", $Rotate)
    }
    $args += @(
      "-N",
      "-H", "$harmonics",
      "-F", "$targetCount",
      $output
    )

    Write-Host ""
    Write-Host "Converting $($roomItem.id) [$tierName]"
    Write-Host "  input : $source"
    Write-Host "  output: $output"
    Write-Host "  count : $targetCount"
    Write-Host "  SH    : $harmonics"
    & $tool @args

    if ($LASTEXITCODE -ne 0) {
      throw "splat-transform failed for $($roomItem.id) [$tierName] with exit code $LASTEXITCODE"
    }
  }
}
