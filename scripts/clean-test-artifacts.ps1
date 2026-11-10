param([switch]$Apply, [string[]]$AdditionalTargets = @())
$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$relativeTargets = @('test-results', 'playwright-report', 'coverage', 'debug.log', 'tsconfig.tsbuildinfo', 'output/weekly-reports', 'output/task-plan-actual', 'output/half-year-simulation', 'output/audit-remediation')
$relativeTargets += $AdditionalTargets
$relativeTargets += @(Get-ChildItem -LiteralPath (Join-Path $workspace 'output') -File | Where-Object { $_.Extension -in @('.log', '.sql', '.prisma') -or $_.Name -like 'deploy-*.mjs' -or $_.Name -match '(migration|verification).*\.json$' } | ForEach-Object { 'output/' + $_.Name })
$targets = @()
foreach ($relative in $relativeTargets) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $workspace $relative))
  if (-not $candidate.StartsWith($workspace + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup target outside workspace' }
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  if (-not $resolved.StartsWith($workspace + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Resolved target outside workspace' }
  $item = Get-Item -LiteralPath $resolved -Force
  $descendants = @($item) + @(if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $resolved -Recurse -Force })
  if ($descendants | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }) { throw 'Refusing cleanup of reparse points' }
  $targets += [pscustomobject]@{ Relative = $relative; Absolute = $resolved }
}
$files = @($targets | ForEach-Object { if ((Get-Item -LiteralPath $_.Absolute).PSIsContainer) { Get-ChildItem -LiteralPath $_.Absolute -Recurse -File -Force } else { Get-Item -LiteralPath $_.Absolute } })
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
if (-not $Apply) { [pscustomobject]@{ Mode='Preview'; Targets=$targets.Relative; Files=$files.Count; Bytes=$bytes } | ConvertTo-Json -Depth 4; exit 0 }
if (-not $targets.Count) { Write-Output 'No generated test artifacts to clean'; exit 0 }
$archiveDir = Join-Path $workspace ('.maintenance/file-cleanup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $archiveDir | Out-Null
$archive = Join-Path $archiveDir 'generated-artifacts.zip'
Compress-Archive -LiteralPath $targets.Absolute -DestinationPath $archive -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -eq 0) { throw 'Artifact archive failed; nothing removed' }
foreach ($target in $targets) { Remove-Item -LiteralPath $target.Absolute -Recurse -Force }
$result = [pscustomobject]@{ Mode='Applied'; Removed=$targets.Relative; Files=$files.Count; Bytes=$bytes; Archive=$archive; Sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash; CreatedAt=(Get-Date).ToUniversalTime().ToString('o') }
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $archiveDir 'manifest.json') -Encoding UTF8
$result | ConvertTo-Json -Depth 4
