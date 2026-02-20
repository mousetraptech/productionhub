/**
 * Deck Persistence
 *
 * Save and load deck profiles as JSON files in the decks/ directory.
 * Follows the same pattern as ShowPersistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeckProfile } from './types';

export class DeckPersistence {
  private decksDir: string;

  constructor(decksDir?: string) {
    this.decksDir = decksDir ?? path.join(process.cwd(), 'decks');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.decksDir)) {
      fs.mkdirSync(this.decksDir, { recursive: true });
    }
  }

  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  save(name: string, profile: DeckProfile): void {
    this.ensureDir();
    const fileName = this.safeName(name);
    const filePath = path.join(this.decksDir, `${fileName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    console.log(`[DeckPersistence] Saved profile "${name}" to ${filePath}`);
  }

  load(name: string): DeckProfile | null {
    const filePath = path.join(this.decksDir, `${this.safeName(name)}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as DeckProfile;
  }

  delete(name: string): boolean {
    const filePath = path.join(this.decksDir, `${this.safeName(name)}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    console.log(`[DeckPersistence] Deleted profile "${name}"`);
    return true;
  }

  list(): string[] {
    this.ensureDir();
    return fs.readdirSync(this.decksDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  }
}
