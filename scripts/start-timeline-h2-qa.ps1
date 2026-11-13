[CmdletBinding()]
param(
    [string]$BackendRoot = 'D:\mySpace\nextjs\backend',
    [ValidateRange(1, 65535)][int]$Port = 18080,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts\timeline-integration-qa'))
$classpathFile = Join-Path $BackendRoot 'target\cp-test.txt'
$mainClasses = Join-Path $BackendRoot 'target\classes'
$testClasses = Join-Path $BackendRoot 'target\test-classes'
foreach ($requiredPath in @($classpathFile, (Join-Path $mainClasses 'com\demo\backend\BackendApplication.class'), (Join-Path $testClasses 'application-h2.yml'))) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw ('Missing QA dependency: ' + $requiredPath) }
}
if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port) {
    throw ('Port ' + $Port + ' is already occupied; no process was stopped.')
}
$javaPath = (Get-Command java.exe -ErrorAction Stop).Source
$classpath = $testClasses + ';' + $mainClasses + ';' + (Get-Content -LiteralPath $classpathFile -Raw).Trim()
foreach ($dependencyPath in $classpath.Split(';')) {
    if (!(Test-Path -LiteralPath $dependencyPath)) { throw ('Missing classpath entry: ' + $dependencyPath) }
}
$qaTemp = Join-Path $qaRoot 'tmp'
$qaUploads = Join-Path $qaRoot 'uploads'
New-Item -ItemType Directory -Path $qaRoot, $qaTemp, $qaUploads -Force | Out-Null
$qaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $qaRoot ('h2-backend-' + $qaStamp + '.stdout.log')
$stderrPath = Join-Path $qaRoot ('h2-backend-' + $qaStamp + '.stderr.log')
$runtimePath = Join-Path $qaRoot 'h2-backend-runtime.json'
$javaArguments = @(
    ('"-Djava.io.tmpdir=' + $qaTemp + '"'),
    '-cp', ('"' + $classpath + '"'),
    'com.demo.backend.BackendApplication',
    '--spring.profiles.active=h2',
    '--spring.datasource.url=jdbc:h2:mem:timeline_qa_20261109;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=USER;DB_CLOSE_DELAY=-1',
    '--spring.datasource.driver-class-name=org.h2.Driver',
    '--spring.datasource.username=sa',
    '--spring.datasource.password=',
    '--spring.jpa.hibernate.ddl-auto=create-drop',
    '--spring.jpa.show-sql=false',
    '--spring.sql.init.mode=never',
    '--server.address=127.0.0.1', ('--server.port=' + $Port),
    ('"--app.upload.dir=' + $qaUploads + '"'),
    ('"--spring.servlet.multipart.location=' + $qaTemp + '"'),
    '--sms.mock=true',
    '--sms.resend-interval-seconds=0'
)
$qaProcess = $null
if (!$Foreground) {
    $qaProcess = Start-Process -FilePath $javaPath -ArgumentList $javaArguments -WorkingDirectory $qaRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
}
$runtime = [ordered]@{
    startedAt = [DateTimeOffset]::Now.ToString('o')
    pid = $(if ($Foreground) { $PID } else { $qaProcess.Id })
    address = '127.0.0.1'
    port = $Port
    profile = 'h2'
    datasource = 'jdbc:h2:mem:timeline_qa_20261109'
    stdout = $stdoutPath
    stderr = $stderrPath
    ready = $false
}
$runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding utf8
if ($Foreground) {
    # Direct native execution stays attached to the caller's process manager.
    $foregroundArguments = @($javaArguments | ForEach-Object { $_.Trim('"') })
    & $javaPath @foregroundArguments
    exit $LASTEXITCODE
}
Add-Type -AssemblyName System.Net.Http
$qaHttp = New-Object Net.Http.HttpClient
$qaHttp.Timeout = [TimeSpan]::FromSeconds(2)
try {
    for ($qaAttempt = 0; $qaAttempt -lt 45; $qaAttempt++) {
        if ($qaProcess.HasExited) { throw ('H2 process exited; inspect ' + $stderrPath + ' and ' + $stdoutPath) }
        try {
            $qaResponse = $qaHttp.GetAsync(('http://127.0.0.1:' + $Port + '/api/timeline/me')).GetAwaiter().GetResult()
            $qaBody = $qaResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            if ([int]$qaResponse.StatusCode -eq 401 -and $qaBody.code -eq 401) {
                $runtime.ready = $true
                $runtime.healthStatus = 401
                $runtime.healthMessage = $qaBody.message
                break
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
} finally { $qaHttp.Dispose() }
$runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding utf8
if (!$runtime.ready) { throw ('H2 backend has not become ready; process was retained. Runtime: ' + $runtimePath) }
$runtime | ConvertTo-Json
