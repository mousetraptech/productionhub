/**
 * Template Loader
 *
 * Loads show templates from templates.yml.
 * Templates define pre-built cue lists for common show types.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

export interface TemplateCue {
  name: string;
  actions: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  cues: TemplateCue[];
}

export class TemplateLoader {
  private templates: Map<string, Template> = new Map();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(process.cwd(), 'templates.yml');
  }

  /** Load templates from YAML file */
  load(): void {
    if (!fs.existsSync(this.filePath)) {
      console.warn(`[TemplateLoader] templates.yml not found at ${this.filePath}`);
      return;
    }

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const doc = parseYaml(raw);

    if (!doc?.templates || typeof doc.templates !== 'object') {
      console.warn('[TemplateLoader] No templates found in templates.yml');
      return;
    }

    this.templates.clear();
    for (const [id, def] of Object.entries(doc.templates)) {
      const d = def as any;
      const template: Template = {
        id,
        name: d.name ?? id,
        description: d.description ?? '',
        icon: d.icon ?? '📄',
        cues: (d.cues ?? []).map((c: any) => ({
          name: c.name ?? '',
          actions: c.actions ?? [],
        })),
      };
      this.templates.set(id, template);
    }

    console.log(`[TemplateLoader] Loaded ${this.templates.size} templates`);
  }

  /** Get a template by ID */
  getTemplate(id: string): Template | undefined {
    return this.templates.get(id);
  }

  /** Get all templates as an array */
  getAll(): Template[] {
    return Array.from(this.templates.values());
  }
}
