# Production Event Template System

Define an event type once. Generate show control configurations for QLab, Companion, and TouchDesigner automatically.

## What This Does

You describe a live event in a single YAML file — performers, mics, cameras, lighting presets, cue list — and the template engine generates ready-to-use configuration files for your entire show control stack:

| Output | Format | Purpose |
|--------|--------|---------|
| **Companion page layout** | JSON | Button grid with OSC actions for Bitfocus Companion / Stream Deck |
| **QLab cue builder** | Python script | Connects to QLab via OSC and creates your entire cue list |
| **TouchDesigner setup** | Python script | Builds the video switching network inside TouchDesigner |
| **Setup checklist** | Markdown | Hardware, network, sound check, show-time, and teardown procedures |

## Quick Start

```bash
# Install dependencies
pip install pyyaml python-osc

# Generate all outputs from the standard recital template
python generate.py templates/standard_recital.yaml

# Generate to a custom directory
python generate.py templates/standard_recital.yaml --output-dir ./my_show

# Generate only specific outputs
python generate.py templates/standard_recital.yaml --only companion checklist
```

Outputs land in `./output/` by default.

## Project Structure

```
event-template-system/
├── generate.py                  # Main entry point
├── requirements.txt             # Python dependencies
├── templates/
│   └── standard_recital.yaml    # Example event definition
├── generators/
│   ├── __init__.py
│   ├── companion_generator.py   # Companion JSON builder
│   ├── qlab_generator.py        # QLab OSC script builder
│   ├── touchdesigner_generator.py  # TouchDesigner script builder
│   └── checklist_generator.py   # Markdown checklist builder
└── output/                      # Generated files land here
```

## Writing Event Templates

Templates are YAML files with these top-level sections:

### Minimal Template

```yaml
event_type: my_event
event_name: "My Event"
cues:
  - id: cue_010
    number: "010"
    name: "House to Half"
    type: lighting
    timing: pre-show
```

### Full Template Sections

**Event metadata** — type, name, venue, description.

**Performers** — count and stage positions.

**Audio** — microphones with type, model, channel assignment, gain. Recording settings.

**Video** — cameras with position, shot type, resolution. Switching mode and recording settings.

**Lighting** — controller, universe, named presets with channel levels and color temperature.

**Cues** — the show sequence. Each cue has:

- `id` / `number` / `name` — identification
- `type` — `lighting`, `audio`, `video`, or `system`
- `timing` — `pre-show`, `post-show`, `manual`, or `MM:SS` relative to show start
- `target` / `targets` — what the cue acts on
- `action` — what it does (`unmute`, `mute`, `switch`, `record_start`, etc.)
- `fade_duration` / `follow` — timing behavior

**Network** — host/port for QLab, Companion, TouchDesigner, and lighting console.

See `templates/standard_recital.yaml` for a complete example.

## Using the Generated Files

### Companion JSON

1. Open Bitfocus Companion web UI
2. Go to **Import / Export**
3. Import `standard_recital_companion.json`
4. Configure the OSC connection to point to your QLab machine
5. Two pages are generated:
   - **Show Control** — cue buttons organized by phase (pre-show / show / post-show) plus GO and STOP
   - **A/V Control** — direct camera, audio, and lighting preset buttons

### QLab Cue Builder

```bash
# Test without connecting to QLab
python output/standard_recital_qlab_cues.py --dry-run

# Build cues in QLab (must be running with a workspace open)
python output/standard_recital_qlab_cues.py

# Custom host/port
python output/standard_recital_qlab_cues.py --host 192.168.1.50 --port 53000 --passcode 5678
```

The script creates group cues for each show phase and individual cues with names, numbers, colors, fade times, and pre/post waits.

### TouchDesigner Setup

1. Open TouchDesigner
2. Create a **Text DAT** (right-click canvas > DAT > Text)
3. Paste the contents of `standard_recital_touchdesigner_setup.py`
4. Right-click the Text DAT > **Run Script**
5. The script creates camera inputs, a video switch, OSC listener, and cue handler

### Setup Checklist

The Markdown checklist covers 9 sections with 84 checkboxes covering everything from battery checks to emergency procedures. Open it in any Markdown viewer, or print it for the venue.

## Extending the System

### Adding a New Event Type

1. Copy `templates/standard_recital.yaml`
2. Modify for your event (add mics, cameras, cues, etc.)
3. Run `python generate.py templates/your_event.yaml`

### Adding a New Generator

1. Create a new file in `generators/`
2. Implement a class with `__init__(self, event_data)`, `generate()`, and `write(output_path)`
3. Wire it into `generate.py`

## Technical Details

**QLab OSC**: Commands target port 53000 (default). The script uses `/new` to create cues and `/cue/selected/*` to set properties on the just-created cue. QLab 5 requires a workspace passcode for OSC control.

**Companion JSON**: Buttons use decimal RGB color values (`R + G*256 + B*65536`). Actions reference the `generic-osc` module with paths like `/cue/{number}/start`. The format is compatible with Companion 4.x import.

**TouchDesigner**: Since `.tox` files are binary, the generator produces a Python setup script that runs inside TD. It uses the TD Python API (`op()`, `.create()`, `.par.*`) to build the operator network programmatically.

## Requirements

- Python 3.8+
- `pyyaml` >= 6.0
- `python-osc` >= 1.8.0 (only needed at runtime for the QLab script, not for generation)
