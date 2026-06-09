# Wrapper used by Windows Task Scheduler to run `npm run export:clients`
# on a schedule and append output to a log file in the project root.
# Self-locating: relies on $PSScriptRoot so the project path is never hard-coded
# (avoids Windows PowerShell 5.1 encoding issues with Hebrew folder names).

$ErrorActionPreference = 'Continue'

$projectDir = Split-Path -Parent $PSScriptRoot
$logPath    = Join-Path $projectDir '.export-clients.log'

Set-Location -LiteralPath $projectDir

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$ts] --- starting export ---" | Out-File -FilePath $logPath -Append -Encoding utf8

try {
  & npm.cmd run export:clients 2>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
  $exit = $LASTEXITCODE
} catch {
  $_ | Out-File -FilePath $logPath -Append -Encoding utf8
  $exit = 1
}

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$ts] --- done (exit $exit) ---`n" | Out-File -FilePath $logPath -Append -Encoding utf8

exit $exit
