/**
 * Action Registry
 *
 * Loads human-readable action definitions from actions.yml and
 * resolves them to OSC command bundles. The MOD interface and
 * cue engine both reference action IDs, never raw OSC.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { Action, ActionCategory, ActionCommand } from './types';

export class ActionRegistry {
  private actions: Map<string, Action> = new Map();
  private filePath: string;
  private watcher?: fs.FSWatcher;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(process.cwd(), 'actions.yml');
  }

  /** Load actions from YAML file */
  load(): void {
    if (!fs.existsSync(this.filePath)) {
      console.warn(`[ActionRegistry] actions.yml not found at ${this.filePath}`);
      return;
    }

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const doc = parseYaml(raw);

    if (!doc?.actions || typeof doc.actions !== 'object') {
      console.warn('[ActionRegistry] No actions found in actions.yml');
      return;
    }

    this.actions.clear();
    for (const [id, def] of Object.entries(doc.actions)) {
      const d = def as any;
      const action: Action = {
        id,
        label: d.label ?? id,
        category: d.category ?? 'Uncategorized',
        icon: d.icon ?? '⚡',
        color: d.color ?? '#64748B',
        description: d.description ?? '',
        commands: (d.commands ?? []).map((cmd: any): ActionCommand => ({
          device: cmd.device,
          prefix: cmd.prefix,
          address: cmd.address,
          args: cmd.args,
        })),
      };
      this.actions.set(id, action);
    }

    console.log(`[ActionRegistry] Loaded ${this.actions.size} actions`);
  }

  /** Watch the YAML file for changes and hot-reload */
  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.filePath, (eventType) => {
        if (eventType === 'change') {
          console.log('[ActionRegistry] actions.yml changed, reloading...');
          try {
            this.load();
          } catch (err: any) {
            console.error(`[ActionRegistry] Reload error: ${err.message}`);
          }
        }
      });
    } catch {
      // File watching not critical
    }
  }

  /** Stop watching */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  /** Get a single action by ID */
  getAction(id: string): Action | undefined {
    return this.actions.get(id);
  }

  /** Get all unique category names */
  getCategories(): string[] {
    const cats = new Set<string>();
    for (const action of this.actions.values()) {
      cats.add(action.category);
    }
    return Array.from(cats);
  }

  /** Get all actions in a category */
  getActionsByCategory(category: string): Action[] {
    return Array.from(this.actions.values())
      .filter(a => a.category === category);
  }

  /** Get all actions grouped by category (for the UI palette) */
  getCategoryList(): ActionCategory[] {
    const catMap = new Map<string, ActionCategory>();

    for (const action of this.actions.values()) {
      let cat = catMap.get(action.category);
      if (!cat) {
        cat = {
          category: action.category,
          icon: action.icon,
          color: action.color,
          items: [],
        };
        catMap.set(action.category, cat);
      }
      cat.items.push({
        id: action.id,
        label: action.label,
        desc: action.description,
        commands: action.commands.map(c => ({ device: c.device, prefix: c.prefix, address: c.address })),
      });
    }

    return Array.from(catMap.values());
  }

  /** Get all action IDs */
  getAllIds(): string[] {
    return Array.from(this.actions.keys());
  }

  /** Check if an action ID exists */
  has(id: string): boolean {
    return this.actions.has(id);
  }
}
