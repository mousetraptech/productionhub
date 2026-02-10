/**
 * PreshowChecklist — Configurable manual pre-show task list
 *
 * Items are defined in the YAML config. Runtime state (checked/unchecked)
 * is held in-memory. The dashboard renders checkboxes and a reset button.
 */

export interface ChecklistItem {
  id: number;
  label: string;
  checked: boolean;
}

export interface ChecklistState {
  items: ChecklistItem[];
  total: number;
  checked: number;
  allDone: boolean;
}

export class PreshowChecklist {
  private items: ChecklistItem[];

  constructor(labels: string[]) {
    this.items = labels.map((label, index) => ({
      id: index,
      label,
      checked: false,
    }));
  }

  /** Get full checklist state for serialization */
  getState(): ChecklistState {
    const checked = this.items.filter(i => i.checked).length;
    return {
      items: this.items.map(i => ({ ...i })),
      total: this.items.length,
      checked,
      allDone: checked === this.items.length && this.items.length > 0,
    };
  }

  /** Toggle a single item by ID. Returns false if ID not found. */
  toggle(id: number): boolean {
    const item = this.items.find(i => i.id === id);
    if (!item) return false;
    item.checked = !item.checked;
    return true;
  }

  /** Reset all items to unchecked */
  reset(): void {
    for (const item of this.items) {
      item.checked = false;
    }
  }
}
