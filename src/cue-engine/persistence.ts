/**
 * Show Persistence
 *
 * Save and load shows to YAML files in the shows/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ShowState } from './types';

export class ShowPersistence {
  private showsDir: string;

  constructor(showsDir?: string) {
    this.showsDir = showsDir ?? path.join(process.cwd(), 'shows');
  }

  /** Ensure the shows directory exists */
  private ensureDir(): void {
    if (!fs.existsSync(this.showsDir)) {
      fs.mkdirSync(this.showsDir, { recursive: true });
    }
  }

  /** Save a show state to a YAML file */
  save(name: string, state: ShowState): void {
    this.ensureDir();
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filePath = path.join(this.showsDir, `${safeName}.yml`);

    // Convert to a clean YAML-friendly structure
    const data = {
      name: state.name,
      savedAt: new Date().toISOString(),
      cues: state.cues.map(cue => ({
        id: cue.id,
        name: cue.name,
        actions: cue.actions.map(a => {
          if (a.delay) return { actionId: a.actionId, delay: a.delay };
          return a.actionId;
        }),
        ...(cue.autoFollow ? { autoFollow: cue.autoFollow } : {}),
      })),
    };

    fs.writeFileSync(filePath, stringifyYaml(data), 'utf-8');
    console.log(`[ShowPersistence] Saved show "${name}" to ${filePath}`);
  }

  /** Load a show from a YAML file */
  load(name: string): ShowState | null {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filePath = path.join(this.showsDir, `${safeName}.yml`);

    if (!fs.existsSync(filePath)) {
      console.warn(`[ShowPersistence] Show not found: ${filePath}`);
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const doc = parseYaml(raw);

    const state: ShowState = {
      name: doc.name ?? name,
      cues: (doc.cues ?? []).map((cue: any) => ({
        id: cue.id ?? `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cue.name ?? '',
        actions: (cue.actions ?? []).map((a: any) => {
          if (typeof a === 'string') return { actionId: a };
          return { actionId: a.actionId, delay: a.delay };
        }),
        autoFollow: cue.autoFollow,
      })),
      activeCueIndex: null,
      firedCues: [],
    };

    console.log(`[ShowPersistence] Loaded show "${name}" with ${state.cues.length} cues`);
    return state;
  }

  /** List all saved shows */
  list(): string[] {
    this.ensureDir();
    return fs.readdirSync(this.showsDir)
      .filter(f => f.endsWith('.yml'))
      .map(f => f.replace(/\.yml$/, ''));
  }
}
