param([switch]$Test, [switch]$SetupOnly, [switch]$Paranoid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$projectDir = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectDir
$runtimeDir = Join-Path $projectDir '.runtime'
$manifestPath = Join-Path $PSScriptRoot 'windows-runtime.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$readyPath = Join-Path $runtimeDir 'ready.txt'
$python = Join-Path $runtimeDir 'python.exe'
try {
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'This test kit requires 64-bit Windows (x64).'
    }
    $ready = (Test-Path -LiteralPath $readyPath) -and (Test-Path -LiteralPath $python)
    if ($ready) { $ready = ((Get-Content -LiteralPath $readyPath -Raw).Trim() -eq $manifestHash) }
    if (-not $ready) {
        Write-Host 'Preparing a local Windows runtime. First launch needs an internet connection.'
        Write-Host 'No admin rights, system Python, PATH changes, or persistent PowerShell policy changes are needed.'
        $downloads = Join-Path $projectDir '.downloads'
        New-Item -ItemType Directory -Force -Path $downloads, $runtimeDir | Out-Null
        $archive = Join-Path $downloads 'python-embed.zip'
        if (-not (Test-Path -LiteralPath $archive)) {
            $partial = "$archive.part"
            Invoke-WebRequest -UseBasicParsing -Uri $manifest.python.url -OutFile $partial
            $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $manifest.python.sha256) { throw 'Python runtime SHA-256 mismatch.' }
            Move-Item -LiteralPath $partial -Destination $archive -Force
        }
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $manifest.python.sha256) { throw 'Cached Python runtime SHA-256 mismatch. Remove .downloads/python-embed.zip and retry.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
        # Paths are relative to python.exe; this is an isolated app-local runtime.
        @('python313.zip', '.', 'Lib\site-packages', '..', 'import site') |
            Set-Content -LiteralPath (Join-Path $runtimeDir 'python313._pth') -Encoding ASCII
        & $python (Join-Path $PSScriptRoot 'bootstrap_windows.py')
        if ($LASTEXITCODE -ne 0) { throw 'Native dependency setup failed; see the message above.' }
        $oldPlatform = $env:QT_QPA_PLATFORM
        try {
            $env:QT_QPA_PLATFORM = 'offscreen'
            # A script file avoids Windows PowerShell 5.1 stripping quotes
            # from Python -c arguments during native command-line marshalling.
            & $python (Join-Path $PSScriptRoot 'runtime_smoke_test.py')
            if ($LASTEXITCODE -ne 0) { throw 'Native runtime smoke test failed.' }
        } finally {
            if ($null -eq $oldPlatform) { Remove-Item Env:QT_QPA_PLATFORM -ErrorAction SilentlyContinue }
            else { $env:QT_QPA_PLATFORM = $oldPlatform }
        }
        Set-Content -LiteralPath $readyPath -Value $manifestHash -Encoding ASCII
    }
    if ($SetupOnly) { exit 0 }
    if ($Test) {
        $env:QT_QPA_PLATFORM = 'offscreen'
        & $python -m unittest discover -s tests -v
    } else {
        # Always use the native Windows platform, even when launched from WSL.
        $env:QT_QPA_PLATFORM = 'windows'
        $hostArgs = @('-m', 'keybard_host')
        if ($Paranoid) { $hostArgs += '--paranoid' }
        Start-Process -FilePath (Join-Path $runtimeDir 'pythonw.exe') -ArgumentList $hostArgs -WorkingDirectory $projectDir
        exit 0
    }
    if ($LASTEXITCODE -ne 0) { throw "Keybard Overlay exited with code $LASTEXITCODE" }
} catch {
    Write-Host "Keybard Overlay: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
