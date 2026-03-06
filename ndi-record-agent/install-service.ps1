#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the NDI Record Agent as a Windows service using NSSM.
.DESCRIPTION
    Run once as Administrator. Idempotent — exits cleanly if already installed.
#>

# --- Configuration ---
$ServiceName   = "NDIRecordAgent"
$ServiceDesc   = "Production Hub NDI Record Agent"
$NssmPath      = "C:\tools\nssm\nssm.exe"
$NodePath      = (Get-Command node -ErrorAction SilentlyContinue).Source
$AgentDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentScript   = Join-Path $AgentDir "agent.js"
$ConfigPath    = Join-Path $AgentDir "config.json"
$LogDir        = Join-Path $AgentDir "logs"
$StdoutLog     = Join-Path $LogDir "stdout.log"
$StderrLog     = Join-Path $LogDir "stderr.log"

# --- Validation ---
if (-not (Test-Path $NssmPath)) {
    Write-Error "NSSM not found at $NssmPath — download from https://nssm.cc/download"
    exit 1
}

if (-not $NodePath) {
    Write-Error "Node.js not found in PATH — install Node.js v18+ first"
    exit 1
}

if (-not (Test-Path $AgentScript)) {
    Write-Error "agent.js not found at $AgentScript"
    exit 1
}

if (-not (Test-Path $ConfigPath)) {
    Write-Error "config.json not found at $ConfigPath — copy config.example.json and configure it"
    exit 1
}

# Check if already installed
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$ServiceName' is already installed (Status: $($existing.Status))"
    exit 0
}

# Create log directory
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
    Write-Host "Created log directory: $LogDir"
}

# --- Install service ---
Write-Host "Installing service '$ServiceName'..."

& $NssmPath install $ServiceName $NodePath $AgentScript $ConfigPath

# Working directory
& $NssmPath set $ServiceName AppDirectory $AgentDir

# Stdio capture
& $NssmPath set $ServiceName AppStdout $StdoutLog
& $NssmPath set $ServiceName AppStderr $StderrLog
& $NssmPath set $ServiceName AppStdoutCreationDisposition 4
& $NssmPath set $ServiceName AppStderrCreationDisposition 4
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 5242880

# Restart on failure
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 3000

# Service metadata
& $NssmPath set $ServiceName Description $ServiceDesc
& $NssmPath set $ServiceName Start SERVICE_AUTO_START

# --- Start ---
Write-Host "Starting service..."
Start-Service $ServiceName

$svc = Get-Service -Name $ServiceName
if ($svc.Status -eq "Running") {
    Write-Host ""
    Write-Host "Service '$ServiceName' is RUNNING" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Service '$ServiceName' status: $($svc.Status)" -ForegroundColor Yellow
    Write-Host "Check stderr log for errors: $StderrLog"
}

Write-Host ""
Write-Host "Logs:"
Write-Host "  stdout: $StdoutLog"
Write-Host "  stderr: $StderrLog"
