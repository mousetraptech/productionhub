"""
Setup Checklist Generator
==========================
Generates a comprehensive Markdown setup checklist from an event definition.

The checklist covers:
  - Pre-event hardware setup
  - Network configuration verification
  - Software configuration steps
  - Sound check procedures
  - Show-time checklist
  - Post-show teardown
"""

from datetime import datetime
from typing import Any


class ChecklistGenerator:
    """Generates a Markdown setup checklist from an event definition."""

    def __init__(self, event_data: dict):
        self.event = event_data

    def generate(self) -> str:
        """Generate the complete checklist as Markdown."""
        sections = [
            self._header(),
            self._hardware_setup(),
            self._network_setup(),
            self._software_config(),
            self._sound_check(),
            self._video_check(),
            self._lighting_check(),
            self._show_time(),
            self._post_show(),
            self._emergency_contacts(),
        ]
        return "\n".join(sections)

    def _header(self) -> str:
        event_name = self.event.get("event_name", "Untitled Event")
        event_type = self.event.get("event_type", "unknown")
        venue = self.event.get("venue", "TBD")
        performers = self.event.get("performers", {}).get("count", 0)
        date = datetime.now().strftime("%Y-%m-%d")

        return f"""# Setup Checklist: {event_name}

| Field | Value |
|-------|-------|
| Event Type | `{event_type}` |
| Venue | {venue} |
| Performers | {performers} |
| Generated | {date} |
| Template Version | {self.event.get("metadata", {}).get("version", "1.0")} |

---

"""

    def _hardware_setup(self) -> str:
        mics = self.event.get("audio", {}).get("microphones", [])
        cameras = self.event.get("video", {}).get("cameras", [])

        lines = [
            "## 1. Hardware Setup",
            "",
            "### Audio",
            "",
        ]

        for mic in mics:
            mic_id = mic.get("id", "unknown")
            mic_type = mic.get("type", "unknown")
            model = mic.get("model", "TBD")
            channel = mic.get("input_channel", "?")
            performer = mic.get("performer", "TBD")
            lines.append(f"- [ ] **{mic_id}** ({mic_type}): {model}")
            lines.append(f"  - Assigned to: {performer}")
            lines.append(f"  - Input channel: {channel}")
            lines.append(f"  - Battery check: fresh batteries installed")

        recording = self.event.get("audio", {}).get("recording", {})
        if recording.get("enabled"):
            lines.append(f"- [ ] Audio recording configured ({recording.get('format', 'wav')}, {recording.get('sample_rate', 48000)}Hz)")

        lines.append("")
        lines.append("### Video")
        lines.append("")

        for cam in cameras:
            cam_id = cam.get("id", "unknown")
            position = cam.get("position", "TBD")
            shot = cam.get("shot", "TBD")
            resolution = cam.get("resolution", "1080p")
            lines.append(f"- [ ] **{cam_id}** positioned at {position}")
            lines.append(f"  - Shot type: {shot}")
            lines.append(f"  - Resolution: {resolution}")
            lines.append(f"  - Focus and framing verified")

        vid_recording = self.event.get("video", {}).get("recording", {})
        if vid_recording.get("enabled"):
            lines.append(f"- [ ] Video recording configured ({vid_recording.get('format', 'h264')}, {vid_recording.get('bitrate', '20Mbps')})")

        lines.append("")
        return "\n".join(lines)

    def _network_setup(self) -> str:
        network = self.event.get("network", {})
        hub = network.get("hub", {})
        qlab = network.get("qlab", {})
        companion = network.get("companion", {})
        td = network.get("touchdesigner", {})
        lighting = network.get("lighting_console", {})

        return f"""## 2. Network Configuration

- [ ] All devices on same network / VLAN
- [ ] Production Hub running at `{hub.get("host", "127.0.0.1")}:{hub.get("port", 9000)}`
- [ ] Hub dashboard accessible at `http://{hub.get("host", "127.0.0.1")}:8080/`
- [ ] All hub drivers connected (check `/health` endpoint)
- [ ] QLab machine reachable at `{qlab.get("host", "127.0.0.1")}:{qlab.get("port", 53000)}`
- [ ] Companion reachable at `{companion.get("host", "127.0.0.1")}:{companion.get("port", 8000)}`
- [ ] TouchDesigner OSC listening on port `{td.get("osc_listen_port", 12000)}`
- [ ] Lighting console at `{lighting.get("host", "TBD")}:{lighting.get("port", "TBD")}` ({lighting.get("protocol", "OSC")})
- [ ] Firewall rules allow OSC traffic (UDP) between all devices
- [ ] Network switch / router powered and verified

"""

    def _software_config(self) -> str:
        network = self.event.get("network", {})
        hub = network.get("hub", {})
        qlab_passcode = network.get("qlab", {}).get("passcode", "1234")
        hub_port = hub.get("port", 9000)
        td_port = network.get("touchdesigner", {}).get("osc_listen_port", 12000)

        return f"""## 3. Software Configuration

### Production Hub
- [ ] Hub process running (`npm start` or systemd service)
- [ ] All device drivers connected (check dashboard at `:8080`)
- [ ] Hub OSC port `{hub_port}` receiving traffic
- [ ] Systems check passing (`/system/check`)

### QLab
- [ ] QLab workspace open
- [ ] OSC passcode set to `{qlab_passcode}`
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
- [ ] OSC input receiving from hub on port `{td_port}`
- [ ] Video switch responding to cue triggers

"""

    def _sound_check(self) -> str:
        mics = self.event.get("audio", {}).get("microphones", [])

        lines = [
            "## 4. Sound Check",
            "",
        ]

        for mic in mics:
            mic_id = mic.get("id", "unknown")
            performer = mic.get("performer", "TBD")
            gain = mic.get("gain_db", -12)
            channel = mic.get("input_channel", "?")
            lines.append(f"- [ ] **{mic_id}** ({performer})")
            lines.append(f"  - Channel {channel} signal present")
            lines.append(f"  - Gain at {gain}dB, adjust to taste")
            lines.append(f"  - No feedback at performance levels")
            lines.append(f"  - Monitor mix set for performer")

        lines.append("- [ ] Main mix balanced")
        lines.append("- [ ] Recording levels verified (peaks below -6dB)")
        lines.append("- [ ] Mute/unmute cues tested from Companion")
        lines.append("")

        return "\n".join(lines)

    def _video_check(self) -> str:
        cameras = self.event.get("video", {}).get("cameras", [])

        lines = [
            "## 5. Video Check",
            "",
        ]

        for cam in cameras:
            cam_id = cam.get("id", "unknown")
            shot = cam.get("shot", "TBD")
            lines.append(f"- [ ] **{cam_id}** ({shot} shot)")
            lines.append(f"  - Image quality verified")
            lines.append(f"  - White balance set")
            lines.append(f"  - Focus locked")

        lines.append("- [ ] Video switch tested (all camera cuts clean)")
        lines.append("- [ ] Recording test: start/stop verified")
        lines.append("- [ ] Output feed confirmed on program monitor")
        lines.append("")

        return "\n".join(lines)

    def _lighting_check(self) -> str:
        presets = self.event.get("lighting", {}).get("presets", [])

        lines = [
            "## 6. Lighting Check",
            "",
            f"- [ ] Lighting console: {self.event.get('lighting', {}).get('controller', 'TBD')}",
            f"- [ ] Universe: {self.event.get('lighting', {}).get('universe', 1)}",
            "",
        ]

        for preset in presets:
            name = preset.get("name", "Unknown")
            desc = preset.get("description", "")
            lines.append(f"- [ ] Preset **{name}** verified")
            if desc:
                lines.append(f"  - {desc}")

        lines.append("- [ ] All lighting cues fire correctly from QLab/Companion")
        lines.append("- [ ] Fade times feel appropriate")
        lines.append("")

        return "\n".join(lines)

    def _show_time(self) -> str:
        cues = self.event.get("cues", [])

        lines = [
            "## 7. Show Time Checklist",
            "",
            "### 15 Minutes Before",
            "- [ ] All systems powered and stable",
            "- [ ] Recording media has sufficient space",
            "- [ ] Companion page on Show Control",
            "- [ ] QLab playhead on first cue",
            "",
            "### 5 Minutes Before",
            "- [ ] House to half (cue ready)",
            "- [ ] Performers miked and in position",
            "- [ ] Stage manager confirms ready",
            "",
            "### Cue Sequence",
            "",
        ]

        for cue in cues:
            number = cue.get("number", "???")
            name = cue.get("name", "Untitled")
            timing = cue.get("timing", "manual")
            cue_type = cue.get("type", "unknown")
            lines.append(f"- [ ] **Q{number}** {name} [{cue_type}] @ {timing}")

        lines.append("")
        return "\n".join(lines)

    def _post_show(self) -> str:
        return """## 8. Post-Show

- [ ] Recording stopped and files verified
- [ ] All recordings backed up to secondary media
- [ ] Microphones powered down, batteries removed
- [ ] Cameras powered down
- [ ] Lighting returned to house preset
- [ ] QLab workspace saved
- [ ] Companion configuration saved
- [ ] Network equipment powered down (if applicable)
- [ ] Venue walkthrough - all gear accounted for

"""

    def _emergency_contacts(self) -> str:
        return """## 9. Emergency Procedures

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
"""

    def write(self, output_path: str) -> str:
        """Generate and write the checklist to a Markdown file."""
        checklist = self.generate()
        with open(output_path, "w") as f:
            f.write(checklist)
        return output_path
