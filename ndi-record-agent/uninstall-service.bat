@echo off
REM Uninstall NDI Record Agent Windows service.
REM Run as Administrator.

setlocal

set SERVICE_NAME=NDIRecordAgent

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Run this script as Administrator.
    pause
    exit /b 1
)

echo Stopping %SERVICE_NAME%...
nssm stop %SERVICE_NAME% >nul 2>&1

echo Removing %SERVICE_NAME%...
nssm remove %SERVICE_NAME% confirm

echo Done.
pause
