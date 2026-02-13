/**
 * Cue List Loader
 *
 * Loads cue lists from YAML files.
 * Supports standalone cuelist YAML files and
 * cuelist sections embedded in the main config.
 */

import * as fs from 'fs';
import { parse as parseYaml } from 'yaml';
import { CueList, Cue, CueAction } from './types';

/**
 * Load a cue list from a YAML file.
 *
 * Expected format:
 * ```yaml
 * cuelist:
 *   name: "Sunday Concert"
 *   cues:
 *     - id: preshow
 *       name: "Pre-Show Look"
 *       actions:
 *         - address: /lights/pb/1/1
 *         - address: /avantis/dca/1/fader
 *           args: [0.0]
 * ```
 */
export function loadCueListFromFile(filePath: string): CueList {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[CueSeq] Cue list file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseCueListYaml(raw);
}

/** Parse a YAML string into a CueList */
export function parseCueListYaml(yaml: string): CueList {
  const doc = parseYaml(yaml) as any;

  if (!doc?.cuelist) {
    throw new Error('[CueSeq] YAML must contain a "cuelist" section');
  }

  return parseCueList(doc.cuelist);
}

/** Parse a cuelist object from parsed YAML */
export function parseCueList(data: any): CueList {
  if (!data.name) {
    throw new Error('[CueSeq] Cue list missing "name"');
  }

  if (!Array.isArray(data.cues)) {
    throw new Error('[CueSeq] Cue list missing "cues" array');
  }

  const cues: Cue[] = data.cues.map((cueData: any, index: number) => {
    const id = cueData.id ?? `cue-${index}`;
    const name = cueData.name ?? `Cue ${index + 1}`;

    if (!Array.isArray(cueData.actions)) {
      throw new Error(`[CueSeq] Cue "${id}" missing "actions" array`);
    }

    const actions: CueAction[] = cueData.actions.map((actionData: any) => {
      if (!actionData.address) {
        throw new Error(`[CueSeq] Action in cue "${id}" missing "address"`);
      }

      return {
        address: actionData.address,
        args: Array.isArray(actionData.args) ? actionData.args : [],
        delayMs: actionData.delayMs ?? undefined,
      };
    });

    return {
      id,
      name,
      actions,
      preWaitMs: cueData.preWaitMs ?? undefined,
      postWaitMs: cueData.postWaitMs ?? undefined,
      autoFollow: cueData.autoFollow ?? undefined,
    };
  });

  return {
    name: data.name,
    cues,
  };
}
