# NDI Record Agent — Windows Service

Run the NDI Record Agent as a Windows service that starts on boot and restarts on crash.

## Prerequisites

- **Node.js** v18+ installed and in PATH
- **NSSM** downloaded from https://nssm.cc/download and placed at `C:\tools\nssm\nssm.exe`
- **config.json** configured with NDI sources, recording/archive paths, and port

## Install

Run as Administrator in PowerShell:

```powershell
.\install-service.ps1
```

The script validates prerequisites, installs the service, configures log rotation, and starts it.

## Verify

```powershell
Get-Service NDIRecordAgent
# or
nssm status NDIRecordAgent
```

## Log Location

```
ndi-record-agent\logs\stdout.log   # agent output
ndi-record-agent\logs\stderr.log   # errors
```

Logs rotate automatically at 5 MB.

## Manual Control

```powershell
Start-Service NDIRecordAgent
Stop-Service NDIRecordAgent
Restart-Service NDIRecordAgent
```

## Uninstall

```powershell
Stop-Service NDIRecordAgent
nssm remove NDIRecordAgent confirm
```

## Update Agent Code

```powershell
Stop-Service NDIRecordAgent
# pull new code / edit agent.js
Start-Service NDIRecordAgent
```

## Troubleshooting

- **Service won't start** — check `logs\stderr.log`, verify all paths in `config.json` are absolute
- **Port conflict** — change `port` in `config.json`, restart service
- **NDI Record.exe not found** — verify `ndiRecordPath` in `config.json` points to the correct executable
