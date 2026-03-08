/**
 * MIDI Capture Types
 *
 * Schema for MIDI event documents stored in MongoDB.
 */

import { StripType } from '../midi-protocol';

export interface MIDIEventDocument {
  event_id: string;
  show_id: string | null;
  timestamp: string;          // ISO datetime, millisecond precision
  source: 'avantis';
  type: 'nrpn' | 'noteon' | 'pc';
  strip: { type: StripType; number: number } | null;
  param: 'fader' | 'mute' | 'pan' | 'scene' | 'unknown';
  value: number;              // float 0.0-1.0 for fader/pan, 0|1 for mute, integer for scene
  raw: Record<string, number>;
}
