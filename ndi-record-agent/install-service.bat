@echo off
REM Install NDI Record Agent as a Windows service using NSSM.
REM Requires: nssm.exe on PATH (https://nssm.cc)
REM Run as Administrator.

setlocal

set SERVICE_NAME=NDIRecordAgent
set AGENT_DIR=%~dp0
set NODE_EXE=node
set AGENT_SCRIPT=%AGENT_DIR%agent.js
set LOG_DIR=%AGENT_DIR%logs

REM Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Run this script as Administrator.
    pause
    exit /b 1
)

REM Check nssm exists
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: nssm not found on PATH. Download from https://nssm.cc
    pause
    exit /b 1
)

REM Create log directory
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo Installing %SERVICE_NAME%...

nssm install %SERVICE_NAME% "%NODE_EXE%" "%AGENT_SCRIPT%"
nssm set %SERVICE_NAME% AppDirectory "%AGENT_DIR%"
nssm set %SERVICE_NAME% DisplayName "NDI Record Agent"
nssm set %SERVICE_NAME% Description "Production Hub NDI recording agent — WebSocket server controlling NDI Record.exe"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppStdout "%LOG_DIR%\stdout.log"
nssm set %SERVICE_NAME% AppStderr "%LOG_DIR%\stderr.log"
nssm set %SERVICE_NAME% AppStdoutCreationDisposition 4
nssm set %SERVICE_NAME% AppStderrCreationDisposition 4
nssm set %SERVICE_NAME% AppRotateFiles 1
nssm set %SERVICE_NAME% AppRotateBytes 5242880
nssm set %SERVICE_NAME% AppRestartDelay 5000
nssm set %SERVICE_NAME% AppExit Default Restart

echo.
echo Service installed. Starting...
nssm start %SERVICE_NAME%

echo.
echo Done. Service status:
nssm status %SERVICE_NAME%
echo.
echo Logs: %LOG_DIR%
pause
