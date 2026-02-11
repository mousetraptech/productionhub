# Setup Checklist: Standard Recital

| Field | Value |
|-------|-------|
| Event Type | `standard_recital` |
| Venue | Main Hall |
| Performers | 2 |
| Generated | 2026-02-11 |
| Template Version | 1.0 |

---


## 1. Hardware Setup

### Audio

- [ ] **lav1** (lavalier): Sennheiser EW 100
  - Assigned to: Performer 1
  - Input channel: 1
  - Battery check: fresh batteries installed
- [ ] **lav2** (lavalier): Sennheiser EW 100
  - Assigned to: Performer 2
  - Input channel: 2
  - Battery check: fresh batteries installed
- [ ] Audio recording configured (wav, 48000Hz)

### Video

- [ ] **cam1** positioned at front_center
  - Shot type: wide
  - Resolution: 1920x1080
  - Focus and framing verified
- [ ] **cam2** positioned at stage_left
  - Shot type: medium
  - Resolution: 1920x1080
  - Focus and framing verified
- [ ] Video recording configured (h264, 20Mbps)

## 2. Network Configuration

- [ ] All devices on same network / VLAN
- [ ] Production Hub running at `127.0.0.1:9000`
- [ ] Hub dashboard accessible at `http://127.0.0.1:8080/`
- [ ] All hub drivers connected (check `/health` endpoint)
- [ ] QLab machine reachable at `127.0.0.1:53000`
- [ ] Companion reachable at `127.0.0.1:8000`
- [ ] TouchDesigner OSC listening on port `12000`
- [ ] Lighting console at `192.168.1.100:8000` (osc)
- [ ] Firewall rules allow OSC traffic (UDP) between all devices
- [ ] Network switch / router powered and verified


## 3. Software Configuration

### Production Hub
- [ ] Hub process running (`npm start` or systemd service)
- [ ] All device drivers connected (check dashboard at `:8080`)
- [ ] Hub OSC port `9000` receiving traffic
- [ ] Systems check passing (`/system/check`)

### QLab
- [ ] QLab workspace open
- [ ] OSC passcode set to `1234`
- [ ] Cue list built (run `standard_recital_qlab_cues.py`)
- [ ] Network cues targeting hub verified (check destination host/port)
- [ ] All cues verified in cue list

### Companion
- [ ] Companion running and accessible via web UI
- [ ] Page configuration imported (`companion_config.json`)
- [ ] OSC connection to Production Hub verified (test a cue button)
- [ ] Stream Deck / control surface connected and showing buttons

### TouchDesigner
- [ ] TouchDesigner project open
- [ ] Setup script executed (`touchdesigner_setup.py`)
- [ ] Camera inputs recognized and showing video
- [ ] OSC input receiving from hub on port `12000`
- [ ] Video switch responding to cue triggers


## 4. Sound Check

- [ ] **lav1** (Performer 1)
  - Channel 1 signal present
  - Gain at -12dB, adjust to taste
  - No feedback at performance levels
  - Monitor mix set for performer
- [ ] **lav2** (Performer 2)
  - Channel 2 signal present
  - Gain at -12dB, adjust to taste
  - No feedback at performance levels
  - Monitor mix set for performer
- [ ] Main mix balanced
- [ ] Recording levels verified (peaks below -6dB)
- [ ] Mute/unmute cues tested from Companion

## 5. Video Check

- [ ] **cam1** (wide shot)
  - Image quality verified
  - White balance set
  - Focus locked
- [ ] **cam2** (medium shot)
  - Image quality verified
  - White balance set
  - Focus locked
- [ ] Video switch tested (all camera cuts clean)
- [ ] Recording test: start/stop verified
- [ ] Output feed confirmed on program monitor

## 6. Lighting Check

- [ ] Lighting console: ETC Eos
- [ ] Universe: 1

- [ ] Preset **Warm Stage Wash** verified
  - Full warm wash at 80% for performance
- [ ] Preset **House Full** verified
  - House lights at full
- [ ] Preset **House Half** verified
  - House lights at 50%
- [ ] Preset **House Out** verified
  - House lights fully dimmed
- [ ] Preset **Blackout** verified
  - All lights off
- [ ] All lighting cues fire correctly from QLab/Companion
- [ ] Fade times feel appropriate

## 7. Show Time Checklist

### 15 Minutes Before
- [ ] All systems powered and stable
- [ ] Recording media has sufficient space
- [ ] Companion page on Show Control
- [ ] QLab playhead on first cue

### 5 Minutes Before
- [ ] House to half (cue ready)
- [ ] Performers miked and in position
- [ ] Stage manager confirms ready

### Cue Sequence

- [ ] **Q010** House to Half [lighting] @ pre-show
- [ ] **Q020** House Out [lighting] @ pre-show
- [ ] **Q030** Stage Wash Up [lighting] @ 0:00
- [ ] **Q040** Mics Hot [audio] @ 0:00
- [ ] **Q050** Camera 1 Live [video] @ 0:00
- [ ] **Q060** Recording Start [system] @ 0:00
- [ ] **Q070** Camera 2 [video] @ manual
- [ ] **Q080** Camera 1 [video] @ manual
- [ ] **Q090** Recording Stop [system] @ post-show
- [ ] **Q100** Mics Off [audio] @ post-show
- [ ] **Q110** House to Full [lighting] @ post-show
- [ ] **Q120** Stage Blackout [lighting] @ post-show

## 8. Post-Show

- [ ] Recording stopped and files verified
- [ ] All recordings backed up to secondary media
- [ ] Microphones powered down, batteries removed
- [ ] Cameras powered down
- [ ] Lighting returned to house preset
- [ ] QLab workspace saved
- [ ] Companion configuration saved
- [ ] Network equipment powered down (if applicable)
- [ ] Venue walkthrough - all gear accounted for


## 9. Emergency Procedures

- [ ] Know location of circuit breaker panel
- [ ] Backup audio path identified (direct mic to speaker)
- [ ] Manual camera override procedure known
- [ ] Lighting console manual override accessible
- [ ] Contact info for:
  - [ ] Venue technical contact: _______________
  - [ ] Audio engineer: _______________
  - [ ] Video operator: _______________
  - [ ] Lighting operator: _______________

---
*Generated by the Production Event Template System*
