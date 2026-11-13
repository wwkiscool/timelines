[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$BackendRoot = 'D:\mySpace\nextjs\backend',
    [switch]$CheckOnly,
    [ValidateRange(10, 300)][int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$timelineWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$timelineBackend = [IO.Path]::GetFullPath($BackendRoot)
$timelineRuntimeRoot = Join-Path $timelineWorkspace 'artifacts\backend-local'
$timelineSettingsFile = Join-Path $timelineWorkspace '.env.backend.local'
$timelineClasses = Join-Path $timelineBackend 'target\classes'
$timelineClasspathFile = Join-Path $timelineBackend 'target\cp-test.txt'
$timelineSourceRoot = Join-Path $timelineBackend 'src\main\java'

function Read-TimelineEnvFile([string]$FilePath) {
    $settings = @{}
    if (!(Test-Path -LiteralPath $FilePath)) { return $settings }
    $lineNumber = 0
    foreach ($line in (Get-Content -LiteralPath $FilePath)) {
        $lineNumber++
        $trimmed = $line.Trim()
        if (!$trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            throw ('Invalid environment setting at ' + $FilePath + ':' + $lineNumber + '. No value was printed.')
        }
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $settings[$name] = $value
    }
    return $settings
}

function Assert-TimelineJwt([string]$Value) {
    if ([Text.Encoding]::UTF8.GetByteCount($Value) -lt 32 -or $Value -match '^(dev-only-jwt-secret|learn-demo-jwt-secret)') {
        throw 'JWT_SECRET must be a strong key of at least 32 bytes. The existing value was retained and was not printed.'
    }
}

foreach ($requiredPath in @($timelineClasspathFile, (Join-Path $timelineClasses 'com\demo\backend\BackendApplication.class'))) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw ('Missing compiled backend dependency: ' + $requiredPath) }
}

# Check the timeline endpoints and their authentication/account dependencies before using cached classes.
$timelineRelatedSources = @(
    'com\demo\backend\BackendApplication.java',
    'com\demo\backend\config\WebConfig.java',
    'com\demo\backend\config\TimelineWebConfig.java',
    'com\demo\backend\controller\TimelineAuthController.java',
    'com\demo\backend\controller\TimelineController.java',
    'com\demo\backend\controller\TimelineAdminController.java',
    'com\demo\backend\dto\TimelineDtos.java',
    'com\demo\backend\dto\UserInfo.java',
    'com\demo\backend\entity\User.java',
    'com\demo\backend\entity\TimelineMoment.java',
    'com\demo\backend\entity\TimelinePreference.java',
    'com\demo\backend\repository\UserRepository.java',
    'com\demo\backend\repository\TimelineMomentRepository.java',
    'com\demo\backend\repository\TimelinePreferenceRepository.java',
    'com\demo\backend\security\AuthInterceptor.java',
    'com\demo\backend\security\UserContext.java',
    'com\demo\backend\security\JwtService.java',
    'com\demo\backend\security\TimelineAccessInterceptor.java',
    'com\demo\backend\service\AuthService.java',
    'com\demo\backend\service\SmsService.java',
    'com\demo\backend\service\TimelineService.java'
)
foreach ($relativeSource in $timelineRelatedSources) {
    $sourcePath = Join-Path $timelineSourceRoot $relativeSource
    $classPath = Join-Path $timelineClasses ([IO.Path]::ChangeExtension($relativeSource, '.class'))
    if (!(Test-Path -LiteralPath $sourcePath) -or !(Test-Path -LiteralPath $classPath)) {
        throw ('Missing timeline source or compiled class: ' + $relativeSource)
    }
    if ((Get-Item -LiteralPath $classPath).LastWriteTimeUtc -lt (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc) {
        throw ('Cached backend class is older than its source. Rebuild the backend first: ' + $relativeSource)
    }
}
$timelineResource = Join-Path $timelineBackend 'src\main\resources\application.yml'
$timelineCompiledResource = Join-Path $timelineClasses 'application.yml'
if (!(Test-Path -LiteralPath $timelineCompiledResource) -or
    (Get-FileHash -LiteralPath $timelineResource).Hash -ne (Get-FileHash -LiteralPath $timelineCompiledResource).Hash) {
    throw 'Cached application.yml differs from the backend source. Rebuild the backend first.'
}

$timelineClasspath = $timelineClasses + ';' + (Get-Content -LiteralPath $timelineClasspathFile -Raw).Trim()
foreach ($dependencyPath in $timelineClasspath.Split(';')) {
    if (!(Test-Path -LiteralPath $dependencyPath)) { throw ('Missing classpath entry: ' + $dependencyPath) }
}
$timelineJava = (Get-Command java.exe -ErrorAction Stop).Source
if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 8080) {
    throw 'Port 8080 is already occupied. No existing process was stopped.'
}

# Load backend configuration without changing or printing it. Process environment wins.
$timelineSettings = Read-TimelineEnvFile (Join-Path $timelineBackend '.env.local')
$timelineJwt = [Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
if ($null -eq $timelineJwt -and $timelineSettings.ContainsKey('JWT_SECRET')) { $timelineJwt = $timelineSettings['JWT_SECRET'] }
if ([string]::IsNullOrWhiteSpace($timelineJwt)) {
    $timelineSavedSettings = Read-TimelineEnvFile $timelineSettingsFile
    if ($timelineSavedSettings.ContainsKey('JWT_SECRET')) { $timelineJwt = $timelineSavedSettings['JWT_SECRET'] }
}
if (![string]::IsNullOrWhiteSpace($timelineJwt)) { Assert-TimelineJwt $timelineJwt }
& git -c core.excludesFile= -C $timelineWorkspace check-ignore --quiet -- .env.backend.local
if ($LASTEXITCODE -ne 0) { throw '.env.backend.local must be ignored by Git before starting the backend.' }

if ($CheckOnly) {
    Write-Output 'Backend preflight passed: compiled timeline classes, dependencies, configuration, and port 8080.'
    Write-Output 'CheckOnly: no database connection, file changes, or backend startup performed.'
    return
}
if (!$PSCmdlet.ShouldProcess('Local backend 127.0.0.1:8080 and workspace runtime files', 'Start compiled backend with local-only mock SMS profile; no migration')) { return }

if ([string]::IsNullOrWhiteSpace($timelineJwt)) {
    # Keep a stable local key across restarts. Exclusive access prevents concurrent launchers from creating different keys.
    $timelineSettingsStream = [IO.File]::Open($timelineSettingsFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $timelineReader = New-Object IO.StreamReader($timelineSettingsStream, [Text.Encoding]::UTF8, $true, 1024, $true)
        try { $timelineExistingSettings = $timelineReader.ReadToEnd() } finally { $timelineReader.Dispose() }
        if ($timelineExistingSettings -match '(?m)^\s*JWT_SECRET\s*=\s*(\S+)\s*$') {
            $timelineJwt = $Matches[1].Trim('"', "'")
        } else {
            $timelineRandomBytes = New-Object byte[] 48
            $timelineRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $timelineRandom.GetBytes($timelineRandomBytes) } finally { $timelineRandom.Dispose() }
            $timelineJwt = [Convert]::ToBase64String($timelineRandomBytes)
            $timelineSavedBytes = (New-Object Text.UTF8Encoding($false)).GetBytes("`r`nJWT_SECRET=$timelineJwt`r`n")
            $null = $timelineSettingsStream.Seek(0, [IO.SeekOrigin]::End)
            $timelineSettingsStream.Write($timelineSavedBytes, 0, $timelineSavedBytes.Length)
            $timelineSettingsStream.Flush()
        }
        Assert-TimelineJwt $timelineJwt
    } finally { $timelineSettingsStream.Dispose() }
    Write-Output 'Saved a stable JWT key in ignored .env.backend.local; its value was not printed.'
}

$timelineTemp = Join-Path $timelineRuntimeRoot 'tmp'
$timelineUploads = Join-Path $timelineRuntimeRoot 'uploads'
New-Item -ItemType Directory -Path $timelineRuntimeRoot, $timelineTemp, $timelineUploads -Force | Out-Null
$timelineStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$timelineStdout = Join-Path $timelineRuntimeRoot ('backend-8080-' + $timelineStamp + '.stdout.log')
$timelineStderr = Join-Path $timelineRuntimeRoot ('backend-8080-' + $timelineStamp + '.stderr.log')
$timelineRuntimeFile = Join-Path $timelineRuntimeRoot 'backend-runtime.json'
$timelineArguments = @(
    ('"-Djava.io.tmpdir=' + $timelineTemp + '"'),
    '-cp', ('"' + $timelineClasspath + '"'),
    'com.demo.backend.BackendApplication',
    '--spring.profiles.active=timeline-local',
    '--sms.mock=true',
    '--server.address=127.0.0.1', '--server.port=8080',
    ('"--app.upload.dir=' + $timelineUploads + '"'),
    ('"--spring.servlet.multipart.location=' + $timelineTemp + '"'),
    ('"--logging.file.path=' + $timelineRuntimeRoot + '"'),
    ('"--logging.file.name=' + (Join-Path $timelineRuntimeRoot ('backend-8080-' + $timelineStamp + '.app.log')) + '"')
)

# Start-Process inherits this temporary environment; restore the caller's environment afterwards.
$timelinePreviousEnvironment = @{}
try {
    foreach ($name in $timelineSettings.Keys) {
        if ($name -in @('HOME', 'CODEX_HOME')) { continue }
        if ($null -eq [Environment]::GetEnvironmentVariable($name, 'Process')) {
            $timelinePreviousEnvironment[$name] = $null
            [Environment]::SetEnvironmentVariable($name, $timelineSettings[$name], 'Process')
        }
    }
    if ([Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process') -ne $timelineJwt) {
        if (!$timelinePreviousEnvironment.ContainsKey('JWT_SECRET')) {
            $timelinePreviousEnvironment['JWT_SECRET'] = [Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
        }
        [Environment]::SetEnvironmentVariable('JWT_SECRET', $timelineJwt, 'Process')
    }
    $timelineProcess = Start-Process -FilePath $timelineJava -ArgumentList $timelineArguments -WorkingDirectory $timelineRuntimeRoot -WindowStyle Hidden -RedirectStandardOutput $timelineStdout -RedirectStandardError $timelineStderr -PassThru
} finally {
    foreach ($name in $timelinePreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $timelinePreviousEnvironment[$name], 'Process')
    }
}

$timelineRuntime = [ordered]@{
    startedAt = [DateTimeOffset]::Now.ToString('o')
    pid = $timelineProcess.Id
    address = '127.0.0.1'
    port = 8080
    profile = 'timeline-local'
    stdout = $timelineStdout
    stderr = $timelineStderr
    uploads = $timelineUploads
    ready = $false
}
$timelineRuntime | ConvertTo-Json | Set-Content -LiteralPath $timelineRuntimeFile -Encoding utf8
Add-Type -AssemblyName System.Net.Http
$timelineHttp = New-Object Net.Http.HttpClient
$timelineHttp.Timeout = [TimeSpan]::FromSeconds(2)
$timelineDeadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
try {
    while ([DateTime]::UtcNow -lt $timelineDeadline) {
        $timelineProcess.Refresh()
        if ($timelineProcess.HasExited) { throw ('Backend exited. Inspect ' + $timelineStderr + ' and ' + $timelineStdout) }
        try {
            $timelineResponse = $timelineHttp.GetAsync('http://127.0.0.1:8080/api/timeline/me').GetAwaiter().GetResult()
            try {
                $timelineBody = $timelineResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                if ([int]$timelineResponse.StatusCode -eq 401 -and $timelineBody.code -eq 401) {
                    $timelineListener = & netstat.exe -ano -p tcp | Select-String '^\s*TCP\s+127\.0\.0\.1:8080\s+\S+\s+LISTENING\s+(\d+)\s*$' | Select-Object -First 1
                    if ($timelineListener -and [int]$timelineListener.Matches[0].Groups[1].Value -eq $timelineProcess.Id) {
                        $timelineRuntime.ready = $true
                        $timelineRuntime.healthStatus = 401
                        break
                    }
                }
            } finally { $timelineResponse.Dispose() }
        } catch { }
        Start-Sleep -Seconds 1
    }
} finally { $timelineHttp.Dispose() }
$timelineRuntime | ConvertTo-Json | Set-Content -LiteralPath $timelineRuntimeFile -Encoding utf8
if (!$timelineRuntime.ready) { throw ('Backend has not become ready. Its process was retained; inspect ' + $timelineRuntimeFile) }
Write-Output ('Backend ready at http://127.0.0.1:8080. Runtime: ' + $timelineRuntimeFile)
Write-Output ('Log: ' + $timelineStdout)
