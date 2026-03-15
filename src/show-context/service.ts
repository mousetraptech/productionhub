/**
 * Show Context Service
 *
 * Manages show session lifecycle in MongoDB.
 * Provides start/end/status operations and device snapshot on show start.
 */

import { randomUUID } from 'crypto';
import { MongoClient, Collection, Db } from 'mongodb';
import { ShowDocument, ShowContextState, ShowContextStatus, DeviceSnapshot } from './types';
import { getLogger } from '../logger';

const log = getLogger('ShowContext');

export type DeviceSnapshotFn = () => Promise<DeviceSnapshot>;

export interface ShowContextServiceConfig {
  mongoUrl: string;
  dbName?: string;
}

export class ShowContextService {
  private client: MongoClient;
  private db: Db | null = null;
  private shows: Collection<ShowDocument> | null = null;
  private showContext: Collection | null = null;
  private dbName: string;
  private snapshotFn: DeviceSnapshotFn;

  constructor(config: ShowContextServiceConfig, snapshotFn: DeviceSnapshotFn) {
    this.client = new MongoClient(config.mongoUrl);
    this.dbName = config.dbName ?? 'productionhub';
    this.snapshotFn = snapshotFn;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.shows = this.db.collection<ShowDocument>('shows');
    this.showContext = this.db.collection('show_context');

    // Detect orphaned active shows on startup
    await this.closeOrphanedShows();

    log.info('Show context service connected');
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    this.db = null;
    this.shows = null;
  }

  /** Extract display name from canonical "YYYYMMDD Show Name" format */
  private extractDisplayName(canonicalName: string): string {
    const match = canonicalName.match(/^\d{8}\s+(.+)$/);
    return match ? match[1] : canonicalName;
  }

  /** Start a new show. Auto-closes any active show first. */
  async startShow(name: string): Promise<ShowDocument> {
    this.ensureConnected();

    // Auto-close any active show
    const active = await this.getActiveShow();
    if (active) {
      log.warn({ previousShow: active.name }, 'Auto-closing active show');
      await this.closeShow(active.show_id, false);
    }

    const snapshot = await this.snapshotFn();
    const now = new Date();
    const displayName = this.extractDisplayName(name);

    const doc: ShowDocument = {
      show_id: randomUUID(),
      name,
      displayName,
      date: now.toISOString().split('T')[0],
      started_at: now.toISOString(),
      ended_at: null,
      closed_properly: false,
      state: 'active',
      operator: 'dave',
      device_snapshot: snapshot,
      notes: '',
    };

    await this.shows!.insertOne(doc);

    // Update singleton for fast boot reads
    await this.showContext!.updateOne(
      { _id: 'current' as any },
      { $set: { showId: doc.show_id, canonicalName: name, displayName, startedAt: now } },
      { upsert: true },
    );

    log.info({ show_id: doc.show_id, name, displayName }, 'Show started');
    return doc;
  }

  /** End the current active show. */
  async endShow(): Promise<ShowDocument | null> {
    this.ensureConnected();

    const active = await this.getActiveShow();
    if (!active) {
      log.warn('No active show to end');
      return null;
    }

    await this.closeShow(active.show_id, true);

    // Clear singleton
    await this.showContext!.updateOne(
      { _id: 'current' as any },
      { $set: { showId: null, canonicalName: null, displayName: null, startedAt: null } },
      { upsert: true },
    );

    const updated = await this.shows!.findOne({ show_id: active.show_id });
    log.info({ show_id: active.show_id, name: active.name }, 'Show ended');
    return updated;
  }

  /** Get the currently active show, or null. */
  async getActiveShow(): Promise<ShowDocument | null> {
    this.ensureConnected();
    return this.shows!.findOne({ state: 'active' });
  }

  /** Get current show context status for UI. */
  async getStatus(): Promise<ShowContextStatus> {
    const show = await this.getActiveShow();
    return {
      state: show ? 'active' : 'idle',
      show,
    };
  }

  /** Close a show by ID. */
  private async closeShow(showId: string, properly: boolean): Promise<void> {
    const now = new Date().toISOString();
    const state: ShowContextState = properly ? 'archived' : 'improperly_closed';
    await this.shows!.updateOne(
      { show_id: showId },
      { $set: { ended_at: now, closed_properly: properly, state } },
    );
  }

  /** Detect and close orphaned active shows (from unclean shutdown). */
  private async closeOrphanedShows(): Promise<void> {
    this.ensureConnected();

    const orphans = await this.shows!.find({ state: 'active' }).toArray();
    if (orphans.length === 0) return;

    const now = new Date().toISOString();
    for (const orphan of orphans) {
      await this.shows!.updateOne(
        { show_id: orphan.show_id },
        { $set: { ended_at: now, closed_properly: false, state: 'improperly_closed' as ShowContextState } },
      );
      log.warn({ show_id: orphan.show_id, name: orphan.name }, 'Closed orphaned show');
    }
  }

  /** Get the underlying collection (for tagging actions/errors with show_id). */
  getCollection(): Collection<ShowDocument> | null {
    return this.shows;
  }

  /** Get the database instance (for other collections to add show_id). */
  getDb(): Db | null {
    return this.db;
  }

  /** Get the current show_id, or null if no show is active. */
  async getCurrentShowId(): Promise<string | null> {
    const active = await this.getActiveShow();
    return active?.show_id ?? null;
  }

  /** Fast boot read — get current show context from singleton doc. */
  async getCurrentShowContext(): Promise<{ showId: string; canonicalName: string; displayName: string; startedAt: Date } | null> {
    if (!this.showContext) return null;
    const doc = await this.showContext.findOne({ _id: 'current' as any });
    if (!doc || !doc.showId) return null;
    return {
      showId: doc.showId,
      canonicalName: doc.canonicalName,
      displayName: doc.displayName,
      startedAt: doc.startedAt,
    };
  }

  private ensureConnected(): void {
    if (!this.shows) {
      throw new Error('ShowContextService not connected. Call connect() first.');
    }
  }
}
