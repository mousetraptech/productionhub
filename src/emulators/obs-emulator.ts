/**
 * OBS Emulator
 *
 * Virtual OBS Studio instance. Mirrors the real OBSDriver's OSC address space:
 *   /scene/{name}              Switch program scene
 *   /scene/preview/{name}      Switch preview scene
 *   /stream/start|stop|toggle  Stream control
 *   /record/start|stop|toggle  Record control
 *   /virtualcam/start|stop     Virtual camera control
 *   /source/{name}/visible     Source visibility (int 0|1)
 *   /transition/{name}         Set transition type
 *   /transition/duration       Set transition duration (int ms)
 *
 * Feedback events emitted:
 *   /scene/current    string (current program scene name)
 *   /stream/status    int 0|1
 *   /record/status    int 0|1
 */

import { DeviceConfig, HubContext } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';

export class OBSEmulator extends DeviceEmulator {
  readonly name: string;
  readonly prefix: string;

  private currentScene: string = '';
  private previewScene: string = '';
  private streaming: boolean = false;
  private recording: boolean = false;
  private virtualCam: boolean = false;
  private currentTransition: string = 'Cut';
  private transitionDuration: number = 300;
  private sourceVisibility: Map<string, boolean> = new Map();

  constructor(config: DeviceConfig, hubContext: HubContext, verbose = false) {
    super(config, hubContext, verbose);
    this.name = config.name ?? 'obs';
    this.prefix = config.prefix;
  }

  handleOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'scene':
        this.handleSceneCommand(parts.slice(1), args);
        break;
      case 'stream':
        this.handleStreamCommand(parts.slice(1));
        break;
      case 'record':
        this.handleRecordCommand(parts.slice(1));
        break;
      case 'transition':
        this.handleTransitionCommand(parts.slice(1), args);
        break;
      case 'virtualcam':
        this.handleVirtualCamCommand(parts.slice(1));
        break;
      case 'source':
        this.handleSourceCommand(parts.slice(1), args);
        break;
      default:
        this.log('Unhandled', `${address} [${this.formatArgs(args)}]`);
    }
  }

  /** OBS doesn't use the fade engine */
  protected onFadeTick(_key: string, _value: number): void {
    // No-op
  }

  getState(): Record<string, any> {
    const state: Record<string, any> = {
      currentScene: this.currentScene,
      previewScene: this.previewScene,
      streaming: this.streaming,
      recording: this.recording,
      virtualCam: this.virtualCam,
      currentTransition: this.currentTransition,
      transitionDuration: this.transitionDuration,
    };

    if (this.sourceVisibility.size > 0) {
      state.sources = Object.fromEntries(this.sourceVisibility);
    }

    return state;
  }

  // --- Command handlers ---

  private handleSceneCommand(parts: string[], _args: any[]): void {
    if (parts.length === 0) return;

    if (parts[0] === 'preview' && parts.length >= 2) {
      const sceneName = decodeURIComponent(parts.slice(1).join('/'));
      this.previewScene = sceneName;
      this.log('Preview', sceneName);
    } else {
      // Use original case from the raw address parts
      const sceneName = decodeURIComponent(parts.join('/'));
      this.currentScene = sceneName;
      this.emitFeedback('/scene/current', [{ type: 's', value: sceneName }]);
      this.log('Scene', sceneName);
    }
  }

  private handleStreamCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start':
        this.streaming = true;
        break;
      case 'stop':
        this.streaming = false;
        break;
      case 'toggle':
        this.streaming = !this.streaming;
        break;
      default:
        return;
    }
    this.emitFeedback('/stream/status', [{ type: 'i', value: this.streaming ? 1 : 0 }]);
    this.log('Stream', this.streaming ? 'started' : 'stopped');
  }

  private handleRecordCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start':
        this.recording = true;
        break;
      case 'stop':
        this.recording = false;
        break;
      case 'toggle':
        this.recording = !this.recording;
        break;
      default:
        return;
    }
    this.emitFeedback('/record/status', [{ type: 'i', value: this.recording ? 1 : 0 }]);
    this.log('Record', this.recording ? 'started' : 'stopped');
  }

  private handleTransitionCommand(parts: string[], args: any[]): void {
    if (parts.length === 0) return;
    if (parts[0] === 'duration') {
      this.transitionDuration = this.getInt(args);
      this.log('Transition', `duration → ${this.transitionDuration}ms`);
    } else {
      const name = decodeURIComponent(parts.join('/'));
      this.currentTransition = name;
      this.log('Transition', name);
    }
  }

  private handleVirtualCamCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start':
        this.virtualCam = true;
        this.log('VirtualCam', 'started');
        break;
      case 'stop':
        this.virtualCam = false;
        this.log('VirtualCam', 'stopped');
        break;
    }
  }

  private handleSourceCommand(parts: string[], args: any[]): void {
    if (parts.length < 2) return;
    const lastPart = parts[parts.length - 1];
    if (lastPart === 'visible') {
      const sourceName = decodeURIComponent(parts.slice(0, -1).join('/'));
      const visible = this.getInt(args) >= 1;
      this.sourceVisibility.set(sourceName, visible);
      this.log('Source', `${sourceName} → ${visible ? 'visible' : 'hidden'}`);
    }
  }

  // --- Helpers ---

  private getInt(args: any[], index = 0): number {
    if (!args || args.length <= index) return 0;
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? Math.round(val) : parseInt(val, 10) || 0;
  }

  private formatArgs(args: any[]): string {
    return args.map(a => {
      if (typeof a === 'object' && a.value !== undefined) return a.value;
      return a;
    }).join(', ');
  }
}
