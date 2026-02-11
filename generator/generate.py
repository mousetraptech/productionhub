#!/usr/bin/env python3
"""
Production Event Template System
=================================
Main entry point. Reads a YAML event definition and generates:
  1. Companion page layout (JSON)
  2. QLab OSC cue builder script (Python)
  3. TouchDesigner setup script (Python)
  4. Setup checklist (Markdown)

Usage:
    python generate.py templates/standard_recital.yaml
    python generate.py templates/standard_recital.yaml --output-dir ./my_show
    python generate.py templates/standard_recital.yaml --only companion qlab

Requirements:
    pip install pyyaml python-osc
"""

import argparse
import os
import sys
from pathlib import Path

import yaml

from generators.companion_generator import CompanionGenerator
from generators.qlab_generator import QLabGenerator
from generators.touchdesigner_generator import TouchDesignerGenerator
from generators.checklist_generator import ChecklistGenerator


# ─── Helpers ────────────────────────────────────────────────────────────────

def load_event(yaml_path: str) -> dict:
    """Load and validate an event definition from YAML."""
    path = Path(yaml_path)
    if not path.exists():
        print(f"Error: Template file not found: {yaml_path}")
        sys.exit(1)

    with open(path, "r") as f:
        data = yaml.safe_load(f)

    # Basic validation
    required_keys = ["event_type", "cues"]
    for key in required_keys:
        if key not in data:
            print(f"Error: Missing required key '{key}' in template")
            sys.exit(1)

    # Validate hub_actions
    known_prefixes = ["/avantis", "/lights", "/obs", "/cam", "/td", "/fade", "/system"]
    has_hub_actions = False
    for cue in data.get("cues", []):
        for action in cue.get("hub_actions", []):
            has_hub_actions = True
            address = action.get("address", "")
            if not any(address.startswith(p) for p in known_prefixes):
                print(f"  Warning: cue {cue.get('id')}: hub_action address "
                      f"'{address}' does not match any known hub prefix")

    if has_hub_actions and "hub" not in data.get("network", {}):
        print("  Warning: Cues have hub_actions but no network.hub config defined. "
              "Using default 127.0.0.1:9000")

    return data


def ensure_output_dir(output_dir: str) -> Path:
    """Create the output directory if it doesn't exist."""
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate show control configurations from event templates",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate.py templates/standard_recital.yaml
  python generate.py templates/standard_recital.yaml --output-dir ./show_files
  python generate.py templates/standard_recital.yaml --only companion checklist
        """,
    )
    parser.add_argument(
        "template",
        help="Path to YAML event template file",
    )
    parser.add_argument(
        "--output-dir", "-o",
        default="output",
        help="Output directory (default: ./output)",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        choices=["companion", "qlab", "touchdesigner", "checklist"],
        help="Generate only specific outputs",
    )
    args = parser.parse_args()

    # Load template
    print(f"\n{'=' * 60}")
    print(f"  Production Event Template System")
    print(f"{'=' * 60}")
    print(f"\nLoading template: {args.template}")
    event = load_event(args.template)

    event_type = event.get("event_type", "unknown")
    event_name = event.get("event_name", "Untitled")
    print(f"  Event: {event_name} ({event_type})")
    print(f"  Cues: {len(event.get('cues', []))}")

    # Prepare output directory
    out = ensure_output_dir(args.output_dir)
    print(f"  Output: {out.resolve()}\n")

    targets = args.only or ["companion", "qlab", "touchdesigner", "checklist"]
    generated = []

    # ── Companion ──
    if "companion" in targets:
        print("Generating Companion page layout...")
        gen = CompanionGenerator(event)
        path = gen.write(str(out / f"{event_type}_companion.json"))
        generated.append(("Companion JSON", path))
        print(f"  -> {path}")

    # ── QLab ──
    if "qlab" in targets:
        print("Generating QLab OSC cue builder...")
        gen = QLabGenerator(event)
        path = gen.write(str(out / f"{event_type}_qlab_cues.py"))
        generated.append(("QLab Script", path))
        print(f"  -> {path}")

    # ── TouchDesigner ──
    if "touchdesigner" in targets:
        print("Generating TouchDesigner setup script...")
        gen = TouchDesignerGenerator(event)
        path = gen.write(str(out / f"{event_type}_touchdesigner_setup.py"))
        generated.append(("TouchDesigner Script", path))
        print(f"  -> {path}")

    # ── Checklist ──
    if "checklist" in targets:
        print("Generating setup checklist...")
        gen = ChecklistGenerator(event)
        path = gen.write(str(out / f"{event_type}_checklist.md"))
        generated.append(("Setup Checklist", path))
        print(f"  -> {path}")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  Generated {len(generated)} file(s):")
    for name, path in generated:
        print(f"    {name:.<30s} {path}")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
