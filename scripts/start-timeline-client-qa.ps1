[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 3301,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaRoot = Join-Path $workspaceRoot 'artifacts\timeline-integration-qa'
# Keep previous QA snapshots intact; every run checks a fresh source copy.
$qaRunId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$qaClientRoot = Join-Path $qaRoot ('client-' + $qaRunId)
$qaNextCli = Join-Path $workspaceRoot 'node_modules\next\dist\bin\next'
if (!(Test-Path -LiteralPath $qaNextCli)) { throw 'The workspace Next.js dependency is missing.' }
if (Test-Path -LiteralPath $qaClientRoot) { throw 'The QA client copy already exists; inspect it before replacing it.' }
if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port) {
    throw ('Port ' + $Port + ' is already occupied; no process was stopped.')
}
$qaNode = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $qaClientRoot -Force | Out-Null
foreach ($qaSource in @('src', 'public', 'package.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts')) {
    Copy-Item -LiteralPath (Join-Path $workspaceRoot $qaSource) -Destination $qaClientRoot -Recurse -Force
}
# Node and Next resolve dependencies from the workspace ancestor; no install or junction is needed.
Set-Content -LiteralPath (Join-Path $qaClientRoot '.env.local') -Value 'BACKEND_API_URL=http://127.0.0.1:18080' -Encoding utf8
$qaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$qaStdout = Join-Path $qaRoot ('next-client-' + $qaStamp + '.stdout.log')
$qaStderr = Join-Path $qaRoot ('next-client-' + $qaStamp + '.stderr.log')
$qaRuntimeFile = Join-Path $qaRoot 'next-client-runtime.json'
$qaArguments = @(('"' + $qaNextCli + '"'), 'dev', ('"' + $qaClientRoot + '"'), '--webpack', '--hostname', '127.0.0.1', '--port', [string]$Port)
$qaOriginalBackendUrl = $env:BACKEND_API_URL
$qaOriginalTelemetry = $env:NEXT_TELEMETRY_DISABLED
try {
    $env:BACKEND_API_URL = 'http://127.0.0.1:18080'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $qaProcess = $null
    if (!$Foreground) {
        $qaProcess = Start-Process -FilePath $qaNode -ArgumentList $qaArguments -WorkingDirectory $qaClientRoot -WindowStyle Hidden -RedirectStandardOutput $qaStdout -RedirectStandardError $qaStderr -PassThru
    }
} finally {
    $env:BACKEND_API_URL = $qaOriginalBackendUrl
    $env:NEXT_TELEMETRY_DISABLED = $qaOriginalTelemetry
}
$qaRuntime = [ordered]@{
    startedAt = [DateTimeOffset]::Now.ToString('o')
    launcherPid = $(if ($Foreground) { $PID } else { $qaProcess.Id })
    serverPid = $null
    port = $Port
    address = '127.0.0.1'
    backend = 'http://127.0.0.1:18080'
    clientRoot = $qaClientRoot
    bundler = 'webpack'
    stdout = $qaStdout
    stderr = $qaStderr
    ready = $false
}
$qaRuntime | ConvertTo-Json | Set-Content -LiteralPath $qaRuntimeFile -Encoding utf8
if ($Foreground) {
    # Run under the caller's process manager; do not detach the server.
    try {
        $env:BACKEND_API_URL = 'http://127.0.0.1:18080'
        $env:NEXT_TELEMETRY_DISABLED = '1'
        & $qaNode $qaNextCli dev $qaClientRoot --webpack --hostname 127.0.0.1 --port $Port
        $qaExitCode = $LASTEXITCODE
    } finally {
        $env:BACKEND_API_URL = $qaOriginalBackendUrl
        $env:NEXT_TELEMETRY_DISABLED = $qaOriginalTelemetry
    }
    exit $qaExitCode
}
Add-Type -AssemblyName System.Net.Http
$qaHttp = New-Object Net.Http.HttpClient
$qaHttp.Timeout = [TimeSpan]::FromSeconds(60)
try {
    for ($qaAttempt = 0; $qaAttempt -lt 45; $qaAttempt++) {
        if ($qaProcess.HasExited) { throw ('QA Next.js launcher exited; inspect ' + $qaStderr + ' and ' + $qaStdout) }
        try {
            $qaResponse = $qaHttp.GetAsync(('http://127.0.0.1:' + $Port + '/api/timeline/me')).GetAwaiter().GetResult()
            $qaBody = $qaResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            if ([int]$qaResponse.StatusCode -eq 401 -and $qaBody.code -eq 401) {
                $qaRuntime.ready = $true
                $qaRuntime.apiStatus = 401
                $qaRuntime.apiMessage = $qaBody.message
                break
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if ($qaRuntime.ready) {
        $qaHome = $qaHttp.GetAsync(('http://127.0.0.1:' + $Port + '/')).GetAwaiter().GetResult()
        $qaRuntime.homeStatus = [int]$qaHome.StatusCode
        $qaRuntime.homeContainsMoment = ($qaHome.Content.ReadAsStringAsync().GetAwaiter().GetResult() -match 'MOMENT')
    }
} finally { $qaHttp.Dispose() }
$qaListener = netstat -ano -p tcp | Select-String ('^\s*TCP\s+127\.0\.0\.1:' + $Port + '\s+.*LISTENING\s+(\d+)\s*$') | Select-Object -First 1
if ($qaListener) { $qaRuntime.serverPid = [int]$qaListener.Matches[0].Groups[1].Value }
$qaRuntime | ConvertTo-Json | Set-Content -LiteralPath $qaRuntimeFile -Encoding utf8
if (!$qaRuntime.ready -or $qaRuntime.homeStatus -ne 200) { throw ('QA client is not ready; process was retained. Runtime: ' + $qaRuntimeFile) }
$qaRuntime | ConvertTo-Json
