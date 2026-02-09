# QLab Operations Guide for Production Hub Integration

This guide walks you through building QLab cue lists that talk to the Production Hub—an OSC router that manages audio, lighting, cameras, and streaming for your show.

## 1. QLab Network Setup

Before you build any cues, configure QLab to send OSC to the hub.

### Steps

1. Open QLab → **Settings** (top menu bar)
2. Navigate to **Network** → **OSC**
3. Set the following:
   - **Destination IP:** the IP address of the machine running the Production Hub (e.g., `10.0.0.100`)
   - **Destination Port:** `9000`
4. Leave other settings at defaults
5. Click **OK**

### How It Works

QLab sends all OSC messages to a single destination (the hub on port 9000). The hub listens for incoming messages and routes them by prefix:

- `/avantis/...` → Allen & Heath Avantis audio mixer (MIDI TCP)
- `/lights/...` → ChamSys QuickQ 20 lighting desk (OSC relay)
- `/obs/...` → OBS Studio streaming/recording (WebSocket)
- `/cam1/...`, `/cam2/...` → PTZ cameras (VISCA over IP)
- `/td/...` → TouchDesigner rendering (OSC relay)

You don't configure each device separately in QLab. The hub handles it.

### Cue Type

All cues that talk to external devices must be **Network Cue** type in QLab. Click **Cue > New > Network Cue** or right-click in the cue list and select it from the menu.

---

## 2. Audio Cues (Avantis Mixer)

Audio control happens via OSC messages to the Avantis. All values are floating-point unless noted otherwise.

### Set a Fader Level

**Use this to adjust a channel without timing.**

- **OSC Address:** `/avantis/ch/1/mix/fader`
- **Argument:** float `0.75` (roughly -6dB; 0.0 = silence, 1.0 = unity gain)
- **Example:** To set channel 5 to 50% level:
  - Address: `/avantis/ch/5/mix/fader`
  - Argument: `0.5`

### Mute a Channel

- **OSC Address:** `/avantis/ch/5/mix/mute`
- **Argument:** int `1` (mute on) or `0` (mute off)

### Timed Fade (Smooth Level Change Over Time)

This is the most important one. Use `/fade` to create smooth fades that the hub interpolates at 50Hz—much smoother than clicking faders in QLab.

- **OSC Address:** `/avantis/ch/1/mix/fade`
- **Arguments (in order):**
  1. float `0.0` (target level: 0.0 = silence, 1.0 = unity)
  2. float `3.0` (duration in seconds)
  3. string `scurve` (easing curve: `linear`, `scurve`, `easein`, or `easeout`)
- **Example:** Fade channel 1 to silence over 3 seconds with a smooth curve:
  - Address: `/avantis/ch/1/mix/fade`
  - Arguments: `0.0` (float), `3.0` (float), `scurve` (string)
- **Example:** Fade channel 3 to full level over 2 seconds:
  - Address: `/avantis/ch/3/mix/fade`
  - Arguments: `1.0` (float), `2.0` (float), `linear` (string)

### Recall a Scene

Pre-program scenes on the Avantis (mixer memory), then recall them via OSC.

- **OSC Address:** `/avantis/scene/recall`
- **Argument:** int `5` (scene number 0–127)

### DCA Fader (Group Control)

DCAs let you control multiple channels as one unit. Program DCAs on the mixer first, then control them here.

- **OSC Address:** `/avantis/dca/1/fader`
- **Argument:** float `1.0` (unity gain)
- **Example:** Fade DCA 1 (e.g., "Vocals") to full over 2 seconds:
  - Address: `/avantis/dca/1/fade`
  - Arguments: `1.0` (float), `2.0` (float), `scurve` (string)

### Main Output (Master Fade)

- **OSC Address:** `/avantis/main/mix/fade`
- **Arguments:** float (target), float (duration), string (easing)
- **Example:** Fade entire mix to silence over 5 seconds:
  - Address: `/avantis/main/mix/fade`
  - Arguments: `0.0` (float), `5.0` (float), `scurve` (string)

---

## 3. Lighting Cues (ChamSys QuickQ 20)

The QuickQ is a lighting console controlled via OSC relay. Program your cue stacks and playbacks on the physical desk first, then trigger them from QLab.

### Go on a Playback

This executes the next step in a playback stack.

- **OSC Address:** `/lights/pb/1/1`
- **Arguments:** none
- **What it does:** Presses the "Go" button for Playback 1, Button 1 on the desk
- **Setup:** Pre-program your cue stack into Playback 1 on the QuickQ, then use this cue to step through it

### Set a Playback Fader Level

- **OSC Address:** `/lights/pb/1/1/level`
- **Argument:** float `0.5` (50%)

### Execute a Cue Directly

- **OSC Address:** `/lights/exec/1`
- **Arguments:** none
- **What it does:** Steps through the cue list in the executor

### Release a Playback

- **OSC Address:** `/lights/release/1`
- **Arguments:** none
- **What it does:** Releases playback 1 (resets lighting to previous state)

### Pro Tip

The QuickQ does the actual lighting work. QLab is just the trigger. Always test your playback stacks on the physical desk during tech rehearsal before running them from QLab.

---

## 4. Camera Cues (PTZ Cameras)

PTZ (Pan-Tilt-Zoom) cameras are controlled via VISCA-over-IP. Pre-program your shots as presets on the camera, then recall them from QLab. For continuous moves (pan, tilt, zoom), send a speed command followed by a stop command.

### Recall a Preset

Pre-program your shots on the camera (e.g., wide shot, medium, close-up, speaker shot) and give each a preset number.

- **OSC Address:** `/cam1/preset/recall/3`
- **Arguments:** none
- **What it does:** Recalls preset 3 on camera 1
- **For camera 2:** use `/cam2/preset/recall/3`

### Store a Preset

- **OSC Address:** `/cam1/preset/store/3`
- **Arguments:** none

### Pan and Tilt (with Speed Control)

- **OSC Address:** `/cam1/pantilt/speed`
- **Arguments:**
  1. float `-0.3` to `0.3` (pan speed: negative = left, positive = right)
  2. float `-0.3` to `0.3` (tilt speed: negative = down, positive = up)
- **Example:** Pan camera 1 right at 30% speed while tilting up at 20% speed:
  - Address: `/cam1/pantilt/speed`
  - Arguments: `0.3` (float), `0.2` (float)
- **Important:** Don't forget to stop the movement:
  - Address: `/cam1/pantilt/stop`
  - Arguments: none

### Zoom

- **OSC Address:** `/cam1/zoom/speed`
- **Argument:** float `-0.5` to `0.5` (negative = zoom out, positive = zoom in)
- **Example:** Zoom in at 50% speed:
  - Address: `/cam1/zoom/speed`
  - Argument: `0.5` (float)
- **Stop zoom:**
  - Address: `/cam1/zoom/stop`
  - Arguments: none

### Multi-Camera Shows

Use `/cam1/...` for camera 1 and `/cam2/...` for camera 2. Cue up camera moves in parallel if your show needs them.

---

## 5. Streaming Cues (OBS Studio)

OBS is controlled via WebSocket. Use these cues to switch scenes, start/stop stream and recording, and set transitions.

### Switch Scene

Change the active scene in OBS.

- **OSC Address:** `/obs/scene/Live` (scene name is in the path)
- **Arguments:** none
- **Example:** Switch to "Pre-Show" scene:
  - Address: `/obs/scene/Pre-Show`
  - Arguments: none

### Start and Stop Stream

- **OSC Address (start):** `/obs/stream/start`
- **OSC Address (stop):** `/obs/stream/stop`
- **Arguments:** none

### Start and Stop Recording

- **OSC Address (start):** `/obs/record/start`
- **OSC Address (stop):** `/obs/record/stop`
- **Arguments:** none

### Set Transition

Tell OBS which transition to use, then set its duration.

- **OSC Address:** `/obs/transition/Cut` (transition name is in the path)
- **Arguments:** none
- **Set transition duration:**
  - Address: `/obs/transition/duration`
  - Argument: int `500` (milliseconds)
- **Example:** Use a Cut transition with 500ms duration:
  1. Cue 1: `/obs/transition/Cut` (no args)
  2. Cue 2: `/obs/transition/duration` with argument `500` (int)

---

## 6. Rendering Cues (TouchDesigner)

TouchDesigner receives OSC via an OSC In CHOP. The hub relays any `/td/...` address to TD's listen port (default 12000) with the `/td` prefix stripped. The OSC address path becomes a channel name in the CHOP, so design your TD project's OSC namespace to match whatever addresses you send from QLab.

### Trigger Render

- **OSC Address:** `/td/render/start`
- **Arguments:** none

### Set a Parameter

- **OSC Address:** `/td/param/opacity`
- **Argument:** float `0.75`

The parameter name in the address maps to whatever you've wired up in TD. Common patterns:

- `/td/param/{name}` — control any named parameter
- `/td/cue/{n}` — trigger cue N
- `/td/blend/{layer}` — set layer blend
- `/td/opacity` — master opacity

Since this is a transparent relay, any address structure works — just make sure your TD project's OSC In CHOP is mapped to handle it.

---

## 7. Building a Complete Show Cue List

Here's a realistic example for a church service or live event. Use this as a template.

| Cue | Action | OSC Address | Arguments |
|-----|--------|-------------|-----------|
| 1 | House lights to 50% | /lights/pb/1/1/level | 0.5 (float) |
| 2 | Start recording | /obs/record/start | — |
| 3 | Switch to wide shot | /cam1/preset/recall/1 | — |
| 4 | OBS to "Pre-Show" scene | /obs/scene/Pre-Show | — |
| 5 | Fade worship band to unity | /avantis/dca/1/fade | 1.0 (float), 2.0 (float), scurve (string) |
| 6 | House lights down | /lights/pb/2/1 | — |
| 7 | Start stream | /obs/stream/start | — |
| 8 | OBS to "Live" scene | /obs/scene/Live | — |
| 8b | TD render start | /td/render/start | — |
| 9 | Camera to speaker preset | /cam1/preset/recall/2 | — |
| 10 | Fade band to -10dB | /avantis/dca/1/fade | 0.6 (float), 1.5 (float), scurve (string) |
| ... | ... | ... | ... |
| 25 | Fade all to silence | /avantis/main/mix/fade | 0.0 (float), 5.0 (float), scurve (string) |
| 26 | Stop stream | /obs/stream/stop | — |
| 27 | Stop recording | /obs/record/stop | — |
| 28 | House lights up | /lights/pb/3/1 | — |

**Key idea:** Group related cues into "GO groups" in QLab (Cue > Go Group) so one GO press fires camera + scene + lighting changes together. This keeps your stage call clean.

---

## 8. Tips and Best Practices

### Testing and Rehearsal

- Always test cues during soundcheck, not during the live event
- Run through the full cue list at least twice before show time
- Have a backup USB drive with the QLab workspace on it

### GO Groups

Use GO groups to fire multiple related cues simultaneously. Example: one GO press triggers camera move + OBS scene switch + lighting fade. This reduces the number of times you have to press GO.

### Fader Value Reference

For the Avantis mixer:
- `0.0` = -∞ (silence)
- `0.75` ≈ -6dB
- `1.0` = unity gain (0dB)
- Values above 1.0 add gain (up to +10dB at `1.1`)

### Network Resilience

- If the Production Hub is not running, QLab cues time out silently—nothing breaks, nothing crashes
- The hub auto-reconnects to all devices if a connection drops during the show
- If a device goes offline mid-show, the hub will try to reconnect automatically

### Debugging with Verbose Logging

The hub can log every OSC message it receives and routes. Enable this in config.yml:
```
logging:
  verbose: true
```
This is invaluable if a cue isn't working—you'll see exactly what the hub received.

---

## 9. Troubleshooting

### "Cue fires but nothing happens"

1. Check that the Production Hub is running (look for the process on the hub machine)
2. Verify the hub's IP address in QLab Settings > Network > OSC matches the machine running the hub
3. Check that the target device (mixer, camera, OBS, lighting desk) is powered on and connected to the network
4. If still stuck, enable verbose logging on the hub and check the logs for errors

### "Audio fades are steppy instead of smooth"

You're probably sending individual fader steps from QLab instead of using the `/fade` address. Always use `/avantis/ch/X/mix/fade` or `/avantis/dca/X/fade` for smooth fades—the hub interpolates at 50Hz.

### "OBS doesn't respond to cues"

1. Check that WebSocket is enabled in OBS: **Tools > WebSocket Server Settings > Enable WebSocket Server**
2. Verify the WebSocket password in OBS matches the one in the hub's config.yml
3. Restart OBS and the hub

### "Camera doesn't move or recall presets"

1. Verify the camera IP address is correct in the hub's config.yml
2. Check that VISCA over IP is enabled in the camera's network settings
3. Test that you can ping the camera from the hub machine: `ping <camera-ip>`
4. Pre-program presets on the camera first—you can't recall a preset that doesn't exist

### "Lighting cues do nothing"

1. Check that you've programmed the playbacks and cue stacks on the physical QuickQ desk
2. Verify the playback number in the OSC address matches the playback on the desk (e.g., `/lights/pb/1/1` = Playback 1, Button 1)
3. Test manually pressing the playback on the desk to confirm it works
4. Then test the cue from QLab

---

## Quick Reference: OSC Address Summary

| Device | Action | Address | Args |
|--------|--------|---------|------|
| **Avantis** | Fade channel | /avantis/ch/X/mix/fade | float, float, string |
| | Mute channel | /avantis/ch/X/mix/mute | int (0 or 1) |
| | Fade DCA | /avantis/dca/X/fade | float, float, string |
| | Recall scene | /avantis/scene/recall | int |
| **Lights** | Go playback | /lights/pb/X/1 | — |
| | Set fader level | /lights/pb/X/1/level | float |
| **Cameras** | Recall preset | /cam1/preset/recall/X | — |
| | Pan/tilt | /cam1/pantilt/speed | float, float |
| | Zoom | /cam1/zoom/speed | float |
| **OBS** | Switch scene | /obs/scene/NAME | — |
| | Start stream | /obs/stream/start | — |
| | Stop stream | /obs/stream/stop | — |
| | Start recording | /obs/record/start | — |
| | Stop recording | /obs/record/stop | — |

---

**Questions or issues?** Check the hub logs with verbose mode enabled, or ask the tech director before the show. You've got this.
