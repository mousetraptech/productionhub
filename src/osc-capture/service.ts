/**
 * OSC Capture Service
 *
 * Logs every OSC message routed through the hub to MongoDB.
 * Fire-and-forget writes — never blocks the OSC pipeline.
 */

import { MongoClient, Collection } from 'mongodb';
import { getLogger } from '../logger';

const log = getLogger('OSCCapture');

interface OSCEventDocument {
  timestamp: Date;
  address: string;
  args: any[];
  show_id?: string | null;
}

export class OSCCaptureService {
  private client: MongoClient;
  private collection: Collection<OSCEventDocument> | null = null;
  private dbName: string;
  private getShowId: () => Promise<string | null>;

  constructor(
    config: { mongoUrl: string; dbName?: string },
    getShowId: () => Promise<string | null>,
  ) {
    this.client = new MongoClient(config.mongoUrl);
    this.dbName = config.dbName ?? 'productionhub';
    this.getShowId = getShowId;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.collection = db.collection<OSCEventDocument>('osc_events');
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ address: 1 });
    await this.collection.createIndex({ show_id: 1, timestamp: -1 }, { sparse: true });
    log.info('OSC capture connected');
  }

  /** Log an OSC message — fire and forget */
  capture(address: string, args: any[]): void {
    if (!this.collection) return;

    const doc: OSCEventDocument = {
      timestamp: new Date(),
      address,
      args: args.map(a => (typeof a === 'object' && a.value !== undefined) ? a.value : a),
    };

    this.getShowId()
      .then(showId => {
        doc.show_id = showId;
        return this.collection!.insertOne(doc);
      })
      .catch(err => {
        log.warn({ err: err.message }, 'OSC capture write failed');
      });
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
