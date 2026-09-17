import { createHash } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import type { ProjectionSnapshot, RestorableProjectionSnapshot } from "./store";

export interface DeploymentIdentity {
  chainId: string;
  contracts: Record<string, string>;
  deploymentId?: string;
}

export interface EventCursor {
  blockNumber: number;
  logIndex: number;
}

export interface PersistedProjection {
  snapshot: RestorableProjectionSnapshot;
  cursor: EventCursor | null;
}

export interface ProjectionPersistence {
  load(identity: DeploymentIdentity): Promise<PersistedProjection | null>;
  save(identity: DeploymentIdentity, snapshot: ProjectionSnapshot, cursor: EventCursor | null): Promise<void>;
}

export interface ReplayStore {
  consume(key: string, expiry: number, now: number): Promise<boolean>;
  cleanupExpired(now: number): Promise<void>;
}

function normalizedIdentity(identity: DeploymentIdentity): DeploymentIdentity {
  return {
    chainId: BigInt(identity.chainId).toString(),
    deploymentId: identity.deploymentId ?? "",
    contracts: Object.fromEntries(
      Object.entries(identity.contracts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, address]) => [name, address.toLowerCase()])
    ),
  };
}

export function deploymentKey(identity: DeploymentIdentity): string {
  return createHash("sha256").update(JSON.stringify(normalizedIdentity(identity))).digest("hex");
}

export class InMemoryReplayStore implements ReplayStore {
  private keys = new Map<string, number>();

  async consume(key: string, expiry: number, now: number): Promise<boolean> {
    await this.cleanupExpired(now);
    if (this.keys.has(key)) return false;
    this.keys.set(key, expiry);
    return true;
  }

  async cleanupExpired(now: number): Promise<void> {
    for (const [key, expiry] of this.keys) {
      if (expiry <= now) this.keys.delete(key);
    }
  }
}

export class PostgresPersistence implements ProjectionPersistence, ReplayStore {
  private readonly pool: Pool;
  private readonly identityKey: string;

  constructor(databaseUrl: string, private readonly identity: DeploymentIdentity, poolConfig: PoolConfig = {}) {
    this.pool = new Pool({ connectionString: databaseUrl, ...poolConfig });
    this.identityKey = deploymentKey(identity);
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_projection_snapshots (
        deployment_key TEXT PRIMARY KEY,
        chain_id TEXT NOT NULL,
        contract_addresses JSONB NOT NULL,
        snapshot JSONB NOT NULL,
        cursor_block BIGINT,
        cursor_log_index INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((cursor_block IS NULL) = (cursor_log_index IS NULL))
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_inference_replay_keys (
        deployment_key TEXT NOT NULL,
        replay_key TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (deployment_key, replay_key)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS orchestrator_inference_replay_expiry_idx
      ON orchestrator_inference_replay_keys (expires_at)
    `);
  }

  async load(identity: DeploymentIdentity): Promise<PersistedProjection | null> {
    const result = await this.pool.query<{
      snapshot: RestorableProjectionSnapshot;
      cursor_block: string | null;
      cursor_log_index: number | null;
    }>(
      `SELECT snapshot, cursor_block, cursor_log_index
       FROM orchestrator_projection_snapshots WHERE deployment_key = $1`,
      [deploymentKey(identity)]
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      snapshot: row.snapshot,
      cursor: row.cursor_block === null
        ? null
        : { blockNumber: Number(row.cursor_block), logIndex: row.cursor_log_index! },
    };
  }

  async save(identity: DeploymentIdentity, snapshot: ProjectionSnapshot, cursor: EventCursor | null): Promise<void> {
    const normalized = normalizedIdentity(identity);
    await this.pool.query(
      `INSERT INTO orchestrator_projection_snapshots
         (deployment_key, chain_id, contract_addresses, snapshot, cursor_block, cursor_log_index, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, now())
       ON CONFLICT (deployment_key) DO UPDATE SET
         chain_id = EXCLUDED.chain_id,
         contract_addresses = EXCLUDED.contract_addresses,
         snapshot = EXCLUDED.snapshot,
         cursor_block = EXCLUDED.cursor_block,
         cursor_log_index = EXCLUDED.cursor_log_index,
         updated_at = now()`,
      [
        deploymentKey(identity),
        normalized.chainId,
        JSON.stringify(normalized.contracts),
        JSON.stringify(snapshot),
        cursor?.blockNumber ?? null,
        cursor?.logIndex ?? null,
      ]
    );
  }

  async consume(key: string, expiry: number, now: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM orchestrator_inference_replay_keys
         WHERE deployment_key = $1 AND expires_at <= $2`,
        [this.identityKey, now]
      );
      const result = await client.query(
        `INSERT INTO orchestrator_inference_replay_keys (deployment_key, replay_key, expires_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING replay_key`,
        [this.identityKey, key, expiry]
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpired(now: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM orchestrator_inference_replay_keys
       WHERE deployment_key = $1 AND expires_at <= $2`,
      [this.identityKey, now]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
