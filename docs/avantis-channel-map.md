# DMMS Avantis Channel Map

> **Draylen Mason Music Studio — Allen & Heath Avantis**
> Documented: February 28, 2026 | IP: `192.168.10.20` | MIDI TCP: `51325`
> Production Hub prefix: `/avantis`

This document maps every channel on the DMMS Avantis mixing console — physical inputs, IP audio sources, output buses, and FX — to their Production Hub OSC addresses. It serves as both a MOD training reference and a machine-readable source for Production Hub integration.

---

## Network & Protocol

| Setting | Value |
|---------|-------|
| Console IP | `192.168.10.20` |
| MIDI TCP Port | `51325` |
| MIDI Base Channel | 1 (channels 1-5) |
| Virtual Soundcheck | Available (toggle on console) |
| SLink / DX168 I/O | 5 DX ports populated |

---

## Input Channels 1-48: DX Stageboxes

The first 48 inputs are patched from DX168 stageboxes via SLink. These carry all physical microphones and stage sources. Channel assignments vary per show — the DX patching is reconfigured for each event based on the input list.

| Avantis Ch | DX Port.Input | Production Hub OSC | Notes |
|------------|---------------|-------------------|-------|
| 1-12 | DX 1-1 to DX 1-12 | `/avantis/ch/1/…` to `/avantis/ch/12/…` | DX Port 1 |
| 13-24 | DX 2-1 to DX 2-12 | `/avantis/ch/13/…` to `/avantis/ch/24/…` | DX Port 2 |
| 25-36 | DX 3-1 to DX 3-12 | `/avantis/ch/25/…` to `/avantis/ch/36/…` | DX Port 3 |
| 37-48 | DX 4-1 to DX 4-12 | `/avantis/ch/37/…` to `/avantis/ch/48/…` | DX Port 4 |

> **MOD Note:** DX channel assignments change per show. Always check the show's input list or the console's Name screen for current patching. The DX labels on the touchscreen (e.g., "DX 1-1", "DX 2-5") tell you which physical stagebox input is routed to that channel.

---

## Input Channels 49-64: IP Audio & System Sources

These are the permanent infrastructure channels — they don't change between shows. This is the section MODs need to know cold.

### Mono IP Inputs

| Ch | Label | Type | Color | Gain | Production Hub OSC | Purpose |
|----|-------|------|-------|------|--------------------|---------|
| 49 | **Talkback** | Ip | Red/Orange | 50 dB | `/avantis/ch/49/…` | Booth-to-stage/greenroom comms |
| 50 | **Zoom** | Ip | Yellow | Trim 0.0 dB | `/avantis/ch/50/…` | Zoom call audio (remote guests/meetings) |
| 51 | **SF FL** | Ip | Yellow-Green | 25 dB | `/avantis/ch/51/…` | Surround Field mic — Front Left |
| 52 | **SF FR** | Ip | Yellow-Green | 25 dB | `/avantis/ch/52/…` | Surround Field mic — Front Right |
| 53 | **SF RL** | Ip | Yellow-Green | 25 dB | `/avantis/ch/53/…` | Surround Field mic — Rear Left |
| 54 | **SF RR** | Ip | Yellow-Green | 25 dB | `/avantis/ch/54/…` | Surround Field mic — Rear Right |
| 55 | **RF 1** | Ip | Blue | 0 dB | `/avantis/ch/55/…` | Wireless handheld/lapel 1 |
| 56 | **RF 2** | Ip | Blue | 0 dB | `/avantis/ch/56/…` | Wireless handheld/lapel 2 |

### Stereo IP Inputs

| Ch | Label | Type | Color | Gain/Trim | Production Hub OSC | Purpose |
|----|-------|------|-------|----------|--------------------|---------|
| 57/58 | **iMac** | St Ip | Dark/Navy | 12 dB | `/avantis/ch/57/…` | Booth iMac system audio |
| 59/60 | **Q-Lab** | St Ip | Green | Trim -23.4 dB | `/avantis/ch/59/…` | QLab playback (SFX, walk-in, beds) |
| 61/62 | **Spotify** | St Ip | Bright Green | Trim -0.1 dB | `/avantis/ch/61/…` | Spotify/music playback |
| 63/64 | **AudioRTN** | St Ip | Green | Trim 0.0 dB | `/avantis/ch/63/…` | Audio return (monitoring/playback) |

> **Gain Notes:**
> - Q-Lab is trimmed way down (-23.4 dB) — QLab outputs hot; this prevents clipping at the console
> - Talkback runs at 50 dB gain — needs to be loud and clear for comms
> - SF mics are all matched at 25 dB for consistent surround imaging
> - RF wireless channels are at 0 dB — gain is set on the wireless receivers

---

## Output Buses

### Aux Sends

| Bus | Label | Type | Color | Production Hub OSC | Destination |
|-----|-------|------|-------|--------------------|-------------|
| Aux 7 | **Green Rm** | Aux (mono) | Yellow | `/avantis/mix/7/…` | Green room speakers |
| Aux 8 | **Lobby** | Aux (mono) | Yellow | `/avantis/mix/8/…` | Lobby/hallway speakers |

### Stereo Aux Sends

| Bus | Label | Type | Color | Production Hub OSC | Destination |
|-----|-------|------|-------|--------------------|-------------|
| St Aux 1 | **CR Mix** | St Aux | Yellow | `/avantis/mix/9/…` | Control room monitors |
| St Aux 2 | **PA L/R** | St Aux | Yellow | `/avantis/mix/10/…` | Main PA house speakers |

### Main Output

| Bus | Label | Type | Color | Production Hub OSC | Destination |
|-----|-------|------|-------|--------------------|-------------|
| St Main 1/2 | **STREAM** | St Main | Yellow | `/avantis/main/…` | Livestream / broadcast feed |

> **Architecture Note:** The main stereo bus goes to STREAM (not PA). PA L/R is a stereo aux. This means the livestream mix and house mix are independently controllable — you can ride the stream fader without affecting what the audience hears in the room, and vice versa.

---

## FX Rack

| Slot | Label | Type | Engine | Production Hub OSC |
|------|-------|------|--------|--------------------|
| FX1 Send | **FX1 SND** | St FX Send | — | `/avantis/fxsend/1/…` |
| FX2 Send | **FX2 SND** | St FX Send | — | `/avantis/fxsend/2/…` |
| FX1 Return | **FX1 RTN** | FX Return | SMR Verb | `/avantis/fxrtn/1/…` |
| FX2 Return | **FX2 RTN** | FX Return | SMR Verb | `/avantis/fxrtn/2/…` |

All four FX slots are loaded with **SMR Verb** (the Avantis's flagship reverb engine). Two sends, two returns, all stereo.

### Other Mix Channels

| Label | Type | Color | Production Hub OSC | Purpose |
|-------|------|-------|--------------------|---------|
| **ALS** | Mix | Cyan | `/avantis/mix/…` | Assistive Listening System feed |

---

## Production Hub OSC Quick Reference

Every channel supports these OSC sub-addresses (append to the channel's base path):

| Command | OSC Address | Args | Example |
|---------|------------|------|---------|
| Fader level | `/mix/fader` | float 0.0-1.0 | `/avantis/ch/59/mix/fader 0.75` |
| Mute | `/mix/mute` | int 0/1 | `/avantis/ch/49/mix/mute 1` |
| Pan | `/mix/pan` | float 0.0-1.0 | `/avantis/ch/55/mix/pan 0.5` |
| Fade | `/mix/fade` | float target, float secs [, string easing] | `/avantis/ch/61/mix/fade 0.0 3.0 scurve` |
| Fade stop | `/fade/stop` | string key | `/avantis/fade/stop input/61/fader` |
| Scene recall | `/scene/recall` | int scene# | `/avantis/scene/recall 5` |

### Common MOD Operations via Production Hub

```
# Mute talkback
/avantis/ch/49/mix/mute 1

# Fade Spotify to zero over 5 seconds (smooth walk-in music fadeout)
/avantis/ch/61/mix/fade 0.0 5.0 scurve

# Bring Q-Lab to 75% instantly
/avantis/ch/59/mix/fader 0.75

# Fade PA to zero for intermission
/avantis/mix/10/mix/fade 0.0 2.0 scurve

# Recall scene 3 (e.g., "Concert Default")
/avantis/scene/recall 3

# Fade stream output up from zero
/avantis/main/mix/fade 0.85 3.0 scurve
```

---

## Color Coding System

The console uses consistent color coding across all banks:

| Color | Category | Examples |
|-------|----------|----------|
| Red/Orange | Comms & Talkback | Talkback |
| Yellow | Conference/Zoom, Output buses | Zoom, Green Rm, Lobby, CR Mix, PA L/R, STREAM |
| Yellow-Green | Surround field mics | SF FL, SF FR, SF RL, SF RR |
| Blue | Wireless / RF | RF 1, RF 2 |
| Dark/Navy | Computer system audio | iMac |
| Green | Playback sources & returns | Q-Lab, Spotify, AudioRTN |
| Cyan | Accessibility | ALS |

---

## MIDI Channel Layout (Production Hub Internal)

For reference — this is how Production Hub's Avantis driver maps strip types to MIDI channels over TCP port 51325:

| MIDI Channel | Strip Types | Hex Range |
|--------------|-------------|-----------|
| 1 (base+0) | Inputs 1-64 | 0x00-0x3F |
| 2 (base+1) | Groups 1-40 | 0x00-0x27 (mono), 0x40-0x53 (stereo) |
| 3 (base+2) | Aux/Mix 1-40 | 0x00-0x27 (mono), 0x40-0x53 (stereo) |
| 4 (base+3) | Matrix 1-40 | 0x00-0x27 (mono), 0x40-0x53 (stereo) |
| 5 (base+4) | FX Send, FX Return, Main, DCA, Mute Groups | See driver docs |

---

## Surround Field (SF) Mic Notes

The four SF channels (51-54) form a quad surround pickup array:

```
        STAGE
   ┌─────────────┐
   │  SF FL  SF FR│   Front Left / Front Right
   │     (51) (52)│
   │              │
   │              │   AUDIENCE
   │              │
   │  SF RL  SF RR│   Rear Left / Rear Right
   │     (53) (54)│
   └─────────────┘
        BOOTH
```

All four are gain-matched at 25 dB. These are valuable for:
- Ambient room capture for livestream
- Immersive audio recording
- Declaration Showcase surround content
- Virtual soundcheck with room ambience

---

## Virtual Soundcheck

The console has a clearly labeled **Virtual Soundcheck ON/OFF** toggle (visible on the left side of the fader bank). When enabled, DX inputs are routed from recorded multitrack rather than live stageboxes, allowing full rehearsal and mix refinement without performers present.

---

*Document generated from console photography, February 28, 2026.*
*Source photos: IMG_1629-IMG_1635*
*For Production Hub driver details, see: `src/drivers/avantis-driver.ts` and `src/midi-protocol.ts`*
