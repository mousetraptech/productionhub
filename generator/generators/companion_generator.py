"""
Companion Page Generator
========================
Generates Bitfocus Companion page layout JSON from event definitions.

Produces a .companionconfig-compatible JSON structure with:
  - Styled buttons for each cue (color-coded by type)
  - OSC actions targeting the Production Hub
  - Page layout organized by show phase (pre-show, show, post-show)
"""

import json
from typing import Any


# Button color palette (decimal RGB values for Companion)
# Companion stores colors as: R + (G * 256) + (B * 65536)
COLORS = {
    "lighting":   {"bg": 204 + (153 * 256) + (0 * 65536),    "text": 0},              # amber
    "audio":      {"bg": 0 + (153 * 256) + (204 * 65536),    "text": 0},              # teal
    "video":      {"bg": 51 + (102 * 256) + (204 * 65536),   "text": 16777215},       # blue
    "system":     {"bg": 153 + (51 * 256) + (153 * 65536),   "text": 16777215},       # purple
    "go":         {"bg": 0 + (204 * 256) + (0 * 65536),      "text": 0},              # green
    "stop":       {"bg": 204 + (0 * 256) + (0 * 65536),      "text": 16777215},       # red
    "header":     {"bg": 40 + (40 * 256) + (40 * 65536),     "text": 16777215},       # dark gray
    "blank":      {"bg": 0,                                    "text": 5592405},        # black/gray
}


class CompanionGenerator:
    """Generates Companion page configuration from an event definition."""

    def __init__(self, event_data: dict):
        self.event = event_data
        self.grid_cols = 8  # Stream Deck XL / standard layout
        self.grid_rows = 4

    def generate(self) -> dict:
        """Generate the full Companion config structure."""
        pages = {}

        # Page 1: Show Control (main cue buttons)
        pages["page_1"] = self._build_show_control_page()

        # Page 2: Camera & Audio direct controls
        pages["page_2"] = self._build_av_control_page()

        config = {
            "version": "4.2.0",
            "type": "page_export",
            "event_type": self.event.get("event_type", "unknown"),
            "event_name": self.event.get("event_name", "Untitled Event"),
            "pages": pages,
            "connections": [self._build_osc_connection()],
        }

        return config

    def _build_show_control_page(self) -> dict:
        """Build the main show control page with cue buttons."""
        buttons = {}
        cues = self.event.get("cues", [])

        # Row 0: Header row
        buttons["0,0"] = self._make_button(
            text=f"{self.event.get('event_name', 'Show')}\nCONTROL",
            style="header", size="14"
        )
        buttons["0,1"] = self._make_button(text="PRE-SHOW", style="header", size="14")
        buttons["0,4"] = self._make_button(text="SHOW", style="header", size="14")
        buttons["0,6"] = self._make_button(text="POST-SHOW", style="header", size="14")

        # GO and STOP buttons in top-right
        buttons["0,2"] = self._make_go_button()
        buttons["0,3"] = self._make_stop_button()

        # Distribute cues across rows 1-3
        pre_show = [c for c in cues if c.get("timing") == "pre-show"]
        show_cues = [c for c in cues if c.get("timing") not in ("pre-show", "post-show")]
        post_show = [c for c in cues if c.get("timing") == "post-show"]

        col = 0
        row = 1

        # Pre-show cues
        for cue in pre_show:
            if col >= self.grid_cols:
                col = 0
                row += 1
            buttons[f"{row},{col}"] = self._make_cue_button(cue)
            col += 1

        # Show cues
        col = 0
        row = 2
        for cue in show_cues:
            if col >= self.grid_cols:
                col = 0
                row += 1
            buttons[f"{row},{col}"] = self._make_cue_button(cue)
            col += 1

        # Post-show cues
        col = 0
        row = 3
        for cue in post_show:
            if col >= self.grid_cols:
                col = 0
                row += 1
            buttons[f"{row},{col}"] = self._make_cue_button(cue)
            col += 1

        return {
            "name": "Show Control",
            "gridSize": {"columns": self.grid_cols, "rows": self.grid_rows},
            "buttons": buttons,
        }

    def _build_av_control_page(self) -> dict:
        """Build the AV direct control page."""
        buttons = {}

        # Row 0: Header
        buttons["0,0"] = self._make_button(
            text="A/V\nCONTROL", style="header", size="14"
        )

        # Camera buttons (row 1)
        buttons["1,0"] = self._make_button(text="CAMERAS", style="header", size="12")
        cameras = self.event.get("video", {}).get("cameras", [])
        for i, cam in enumerate(cameras):
            cam_id = cam.get("id", f"cam{i+1}")
            shot = cam.get("shot", "")
            # Scene name derives from camera id: cam1 -> Camera1
            scene_name = cam_id.replace("cam", "Camera")
            buttons[f"1,{i+1}"] = self._make_button(
                text=f"{cam_id.upper()}\n{shot}",
                style="video",
                size="14",
                actions=[
                    {
                        "actionId": "osc:send_no_args",
                        "options": {"path": f"/obs/scene/{scene_name}"},
                    },
                    {
                        "actionId": "osc:send_no_args",
                        "options": {"path": f"/{cam_id}/preset/recall/1"},
                    },
                ],
            )

        # Audio buttons (row 2) — mute toggle via two steps
        buttons["2,0"] = self._make_button(text="AUDIO", style="header", size="12")
        mics = self.event.get("audio", {}).get("microphones", [])
        for i, mic in enumerate(mics):
            mic_id = mic.get("id", f"mic{i+1}")
            channel = mic.get("input_channel", i + 1)
            mute_path = f"/avantis/ch/{channel}/mix/mute"
            buttons[f"2,{i+1}"] = self._make_button(
                text=f"{mic_id.upper()}\nMUTE",
                style="audio",
                size="14",
                actions=[{
                    "actionId": "osc:send_integer",
                    "options": {"path": mute_path, "value": 1},
                }],
            )
            # Add an unmute button next to the mute button
            unmute_col = i + 1 + len(mics)
            if unmute_col < self.grid_cols:
                buttons[f"2,{unmute_col}"] = self._make_button(
                    text=f"{mic_id.upper()}\nUNMUTE",
                    style="go",
                    size="14",
                    actions=[{
                        "actionId": "osc:send_integer",
                        "options": {"path": mute_path, "value": 0},
                    }],
                )

        # Lighting presets (row 3)
        buttons["3,0"] = self._make_button(text="LIGHTING", style="header", size="12")
        presets = self.event.get("lighting", {}).get("presets", [])
        for i, preset in enumerate(presets[:7]):  # max 7 to fit row
            preset_name = preset.get("name", f"Preset {i+1}")
            exec_num = i + 1
            # Wrap long names
            display = preset_name.replace(" ", "\n") if len(preset_name) > 10 else preset_name
            buttons[f"3,{i+1}"] = self._make_button(
                text=display,
                style="lighting",
                size="11",
                actions=[{
                    "actionId": "osc:send_no_args",
                    "options": {"path": f"/lights/exec/{exec_num}"},
                }],
            )

        return {
            "name": "A/V Control",
            "gridSize": {"columns": self.grid_cols, "rows": self.grid_rows},
            "buttons": buttons,
        }

    def _make_cue_button(self, cue: dict) -> dict:
        """Create a button for a specific cue."""
        cue_type = cue.get("type", "system")
        cue_number = cue.get("number", "???")
        cue_name = cue.get("name", "Untitled")
        hub_actions = cue.get("hub_actions", [])

        # Truncate name for button display
        display_name = cue_name[:16]

        if hub_actions:
            actions = self._hub_actions_to_osc(hub_actions)
        else:
            # Fallback: placeholder
            actions = [{
                "actionId": "osc:send_no_args",
                "options": {
                    "path": f"/cue/{cue_number}/start",
                },
            }]

        return self._make_button(
            text=f"Q{cue_number}\n{display_name}",
            style=cue_type,
            size="12",
            actions=actions,
        )

    @staticmethod
    def _hub_actions_to_osc(hub_actions: list) -> list:
        """Convert hub_actions list to Companion OSC action list."""
        actions = []
        for ha in hub_actions:
            address = ha.get("address", "")
            args = ha.get("args")
            if args is not None and len(args) > 0:
                arg = args[0]
                if isinstance(arg, float):
                    actions.append({
                        "actionId": "osc:send_float",
                        "options": {"path": address, "value": arg},
                    })
                elif isinstance(arg, int):
                    actions.append({
                        "actionId": "osc:send_integer",
                        "options": {"path": address, "value": arg},
                    })
                else:
                    actions.append({
                        "actionId": "osc:send_string",
                        "options": {"path": address, "value": str(arg)},
                    })
            else:
                actions.append({
                    "actionId": "osc:send_no_args",
                    "options": {"path": address},
                })
        return actions

    def _make_go_button(self) -> dict:
        """Create the master GO button (requires separate QLab connection)."""
        return self._make_button(
            text="GO\n(QLab)",
            style="go",
            size="14",
        )

    def _make_stop_button(self) -> dict:
        """Create the master STOP button (requires separate QLab connection)."""
        return self._make_button(
            text="STOP\n(QLab)",
            style="stop",
            size="14",
        )

    def _make_button(
        self,
        text: str = "",
        style: str = "blank",
        size: str = "14",
        actions: list | None = None,
    ) -> dict:
        """Create a generic Companion button object."""
        palette = COLORS.get(style, COLORS["blank"])

        button = {
            "type": "button",
            "enabled": True,
            "style": {
                "text": text,
                "size": f"{size}px",
                "color": palette["text"],
                "bgcolor": palette["bg"],
                "alignment": "center",
                "show_topbar": style != "header",
                "textExpression": False,
            },
            "steps": {},
            "feedbacks": [],
        }

        if actions:
            button["steps"]["step0"] = {
                "down": actions,
                "up": [],
            }

        return button

    def _build_osc_connection(self) -> dict:
        """Build the OSC connection config targeting the Production Hub."""
        network = self.event.get("network", {})
        hub = network.get("hub", {})

        return {
            "id": "osc_hub",
            "module": "generic-osc",
            "label": "Production Hub",
            "config": {
                "host": hub.get("host", "127.0.0.1"),
                "port": hub.get("port", 9000),
                "send_enabled": True,
            },
        }

    def write(self, output_path: str) -> str:
        """Generate and write the Companion config to a JSON file."""
        config = self.generate()
        with open(output_path, "w") as f:
            json.dump(config, f, indent=2)
        return output_path
