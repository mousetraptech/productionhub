/**
 * Broadlink IR Device Driver
 *
 * Controls IR devices (projectors, TVs, screens, etc.) via a Broadlink
 * RM Mini 3/4 IR blaster. Sends learned IR codes over the local network
 * using the Broadlink UDP protocol.
 *
 * IR codes are persisted to MongoDB (collection: ir_commands) and also
 * seeded from config. Use /learn/{name} to capture new codes from a remote.
 *
 * OSC addresses (prefix stripped):
 *   /send/{command}         Send a learned IR code by name
 *   /learn/{command}        Enter learning mode, save result as {command}
 *   /delete/{command}       Delete a learned command
 *   /list                   Emit feedback with all known command names
 *   /{command}              Shorthand for /send/{command}
 */

import { EventEmitter } from 'events';
import { MongoClient, Collection, Db } from 'mongodb';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';
import { getLogger } from '../logger';

const log = getLogger('Broadlink');

export interface BroadlinkConfig extends DeviceConfig {
  type: 'broadlink';
  /** Named IR codes as hex strings (seed values, also stored in MongoDB) */
  commands?: Record<string, string>;
  /** MongoDB connection URL */
  mongoUrl?: string;
  /** MongoDB database name */
  mongoDbName?: string;
}

interface IrCommandDoc {
  name: string;
  hex: string;
  learnedAt: Date;
  source: 'config' | 'learned';
}

export class BroadlinkDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private emulate: boolean;
  private connected: boolean = false;
  private verbose: boolean;
  private device: any = null;
  private commands: Map<string, string>;
  private learning: boolean = false;
  private mongoClient: MongoClient | null = null;
  private irCollection: Collection<IrCommandDoc> | null = null;
  private mongoUrl: string | null;
  private mongoDbName: string;
  private configCommands: Record<string, string>;

  constructor(config: BroadlinkConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'broadlink';
    this.prefix = config.prefix;
    this.host = config.host;
    this.emulate = config.emulate ?? false;
    this.verbose = verbose;
    this.configCommands = config.commands ?? {};
    this.commands = new Map(Object.entries(this.configCommands));
    this.mongoUrl = config.mongoUrl ?? null;
    this.mongoDbName = config.mongoDbName ?? 'productionhub';
  }

  async connect(): Promise<void> {
    // Connect to MongoDB first to load saved commands
    await this.connectMongo();

    if (this.emulate) {
      this.connected = true;
      this.emit('connected');
      log.info('Emulate mode — IR commands will be logged but not sent');
      return;
    }

    try {
      const broadlink = await import('node-broadlink');

      // Try direct probe first (works across VLANs where broadcast fails),
      // then fall back to broadcast discovery
      let device = await this.directProbe(broadlink);
      if (!device) {
        const allDevices = await broadlink.discover(5);
        device = allDevices.find((d: any) => {
          const addr = d.host?.address ?? d.host;
          return addr === this.host;
        }) ?? null;
      }

      if (!device) {
        log.error({ host: this.host }, 'No Broadlink device found');
        this.emit('error', new Error(`No Broadlink device found at ${this.host}`));
        return;
      }

      this.device = device;
      await this.device.auth();
      this.connected = true;
      this.emit('connected');
      log.info({ host: this.host, type: this.device.constructor.name }, 'Connected');
    } catch (err: any) {
      log.error({ err: err.message }, 'Connection failed');
      this.emit('error', err);
    }
  }

  /** Connect to MongoDB and load saved IR commands */
  private async connectMongo(): Promise<void> {
    if (!this.mongoUrl) return;

    try {
      this.mongoClient = new MongoClient(this.mongoUrl);
      await this.mongoClient.connect();
      const db: Db = this.mongoClient.db(this.mongoDbName);
      this.irCollection = db.collection<IrCommandDoc>('ir_commands');

      // Ensure index on name
      await this.irCollection.createIndex({ name: 1 }, { unique: true });

      // Seed config commands into MongoDB (don't overwrite learned ones)
      for (const [name, hex] of Object.entries(this.configCommands)) {
        await this.irCollection.updateOne(
          { name },
          { $setOnInsert: { name, hex, learnedAt: new Date(), source: 'config' as const } },
          { upsert: true },
        );
      }

      // Load all commands from MongoDB
      const docs = await this.irCollection.find().toArray();
      for (const doc of docs) {
        this.commands.set(doc.name, doc.hex);
      }

      log.info({ commands: this.commands.size }, 'Loaded IR commands from MongoDB');
    } catch (err: any) {
      log.warn({ err: err.message }, 'MongoDB unavailable — using config commands only');
      this.irCollection = null;
    }
  }

  /** Send a discovery packet directly to the device IP (no broadcast) */
  private directProbe(broadlink: any): Promise<any> {
    return new Promise((resolve) => {
      const dgram = require('dgram');
      const sock = dgram.createSocket('udp4');
      const timeout = setTimeout(() => { sock.close(); resolve(null); }, 5000);

      sock.on('message', (msg: Buffer, rinfo: any) => {
        clearTimeout(timeout);
        sock.close();
        if (rinfo.address !== this.host || msg.length < 0x40) {
          resolve(null);
          return;
        }
        const devType = msg.readUInt16LE(0x34);
        const mac = Buffer.from(msg.subarray(0x3a, 0x40));
        // Some RM Mini 3 variants (e.g. 0x27d2) aren't in the library's
        // device table. Map unrecognized RM types to a known RM Mini 3 ID.
        const knownRmMini3 = 0x27d3;
        try {
          let device = broadlink.genDevice(devType, { address: this.host, port: 80 }, mac);
          if (device.constructor.name === 'Device') {
            log.info({ devType: '0x' + devType.toString(16) }, 'Unrecognized device type, treating as RM Mini 3');
            device = broadlink.genDevice(knownRmMini3, { address: this.host, port: 80 }, mac);
          }
          resolve(device);
        } catch {
          log.warn({ devType: '0x' + devType.toString(16) }, 'Unknown Broadlink device type');
          resolve(null);
        }
      });

      sock.on('listening', () => {
        const packet = Buffer.alloc(48, 0);
        packet[0x26] = 6;
        const now = new Date();
        packet.writeInt32LE(now.getTimezoneOffset() / -60, 0x08);
        packet.writeUInt16LE(now.getFullYear(), 0x0c);
        packet[0x0e] = now.getMinutes();
        packet[0x0f] = now.getHours();
        packet[0x10] = now.getFullYear() % 100;
        packet[0x11] = now.getDay();
        packet[0x12] = now.getDate();
        packet[0x13] = now.getMonth() + 1;
        sock.send(packet, 0, 48, 80, this.host);
      });

      sock.bind(0);
    });
  }

  disconnect(): void {
    this.device = null;
    this.connected = false;
    if (this.mongoClient) {
      this.mongoClient.close().catch(() => {});
      this.mongoClient = null;
      this.irCollection = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, _args: any[]): void {
    const addr = address.toLowerCase();

    // /send/{command} — send a learned IR code
    const sendMatch = addr.match(/^\/send\/(.+)$/);
    if (sendMatch) {
      this.sendCommand(sendMatch[1]);
      return;
    }

    // /learn/{command} — enter learning mode
    const learnMatch = addr.match(/^\/learn\/(.+)$/);
    if (learnMatch) {
      this.learnCommand(learnMatch[1]);
      return;
    }

    // /delete/{command} — remove a command
    const deleteMatch = addr.match(/^\/delete\/(.+)$/);
    if (deleteMatch) {
      this.deleteCommand(deleteMatch[1]);
      return;
    }

    // /list — list all command names
    if (addr === '/list') {
      const names = Array.from(this.commands.keys()).join(', ');
      this.emitFeedback('/list', [{ type: 's', value: names || '(none)' }]);
      log.info({ commands: names || '(none)' }, 'IR commands');
      return;
    }

    // Shorthand: /{command} — treat as /send/{command}
    const shorthand = addr.match(/^\/([a-z0-9_-]+)$/);
    if (shorthand) {
      this.sendCommand(shorthand[1]);
      return;
    }

    log.warn({ address }, 'Unknown address');
  }

  handleFadeTick(_key: string, _value: number): void {
    // No-op — IR commands are discrete, not continuous
  }

  private async sendCommand(name: string): Promise<void> {
    // In emulate mode, accept any command name (no hex required)
    if (!this.emulate) {
      const hex = this.commands.get(name);
      if (!hex) {
        log.warn({ command: name }, 'Unknown command');
        this.emitFeedback('/error', [{ type: 's', value: `Unknown command: ${name}` }]);
        return;
      }

      if (!this.device || !this.connected) {
        log.warn({ command: name }, 'Not connected');
        return;
      }

      try {
        await this.device.sendData(Buffer.from(hex, 'hex'));
      } catch (err: any) {
        log.error({ err: err.message, command: name }, 'Send failed');
        this.emit('error', err);
        return;
      }
    }

    log.info({ command: name, emulate: this.emulate }, 'Sent IR code');
    this.emitFeedback('/sent', [{ type: 's', value: name }]);
  }

  private async learnCommand(name: string): Promise<void> {
    if (!this.device || !this.connected) {
      log.warn('Not connected — cannot learn');
      return;
    }

    if (this.learning) {
      log.warn('Already in learning mode');
      return;
    }

    this.learning = true;
    this.emitFeedback('/learning', [{ type: 's', value: name }]);
    log.info({ command: name }, 'Learning — press a button on your remote...');

    try {
      await this.device.enterLearning();

      // Poll for data up to 10 seconds
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const data = await this.device.checkData();
          if (data && data.length > 0) {
            const hex = Buffer.from(data).toString('hex');
            this.commands.set(name, hex);

            // Persist to MongoDB
            if (this.irCollection) {
              await this.irCollection.updateOne(
                { name },
                { $set: { name, hex, learnedAt: new Date(), source: 'learned' as const } },
                { upsert: true },
              );
            }

            log.info({ command: name, bytes: data.length }, 'Learned IR code');
            this.emitFeedback('/learned', [
              { type: 's', value: name },
              { type: 's', value: hex },
            ]);
            return;
          }
        } catch {
          // No data yet — keep polling
        }
      }

      log.warn({ command: name }, 'Learning timed out — no IR signal received');
      this.emitFeedback('/learn_timeout', [{ type: 's', value: name }]);
    } catch (err: any) {
      log.error({ err: err.message }, 'Learning failed');
      this.emit('error', err);
    } finally {
      this.learning = false;
    }
  }

  private async deleteCommand(name: string): Promise<void> {
    if (!this.commands.has(name)) {
      log.warn({ command: name }, 'Command not found');
      this.emitFeedback('/error', [{ type: 's', value: `Unknown command: ${name}` }]);
      return;
    }

    this.commands.delete(name);

    if (this.irCollection) {
      await this.irCollection.deleteOne({ name });
    }

    log.info({ command: name }, 'Deleted IR command');
    this.emitFeedback('/deleted', [{ type: 's', value: name }]);
  }

  /** Get all command names (for dashboard/API) */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    const event: FeedbackEvent = { address, args };
    this.emit('feedback', event);
  }
}
