/**
 * Deck Button Fire Logic
 *
 * Executes a deck button's actions in parallel or series.
 * The callback handles actual OSC routing — this module is transport-agnostic.
 */

import { DeckAction } from './types';

type FireCallback = (actionId: string, osc?: { address: string; args: any[]; label: string }) => void;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fireDeckButton(
  actions: DeckAction[],
  mode: 'parallel' | 'series',
  seriesGap: number,
  callback: FireCallback,
): Promise<void> {
  if (mode === 'parallel') {
    for (const action of actions) {
      callback(action.actionId, action.osc);
    }
    return;
  }

  // Series: fire one at a time with gap between
  for (let i = 0; i < actions.length; i++) {
    callback(actions[i].actionId, actions[i].osc);
    if (i < actions.length - 1) {
      await delay(seriesGap);
    }
  }
}
