import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPersistence, deploymentKey, type DeploymentIdentity } from "./persistence";
import { ProjectionStore } from "./store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("Postgres persistence", () => {
  const identity: DeploymentIdentity = {
    chainId: "31337",
    contracts: { JobMarket: `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` },
  };
  let persistence: PostgresPersistence;

  beforeAll(async () => {
    persistence = new PostgresPersistence(databaseUrl!, identity);
    await persistence.initialize();
  });

  afterAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl! });
    await pool.query("DELETE FROM orchestrator_inference_replay_keys WHERE deployment_key = $1", [deploymentKey(identity)]);
    await pool.query("DELETE FROM orchestrator_projection_snapshots WHERE deployment_key = $1", [deploymentKey(identity)]);
    await pool.end();
    await persistence.close();
  });

  it("roundtrips snapshots and atomically consumes expiring replay keys", async () => {
    const store = new ProjectionStore();
    store.onOfferCreated("1", "0xProvider", "model-a", "7");
    const cursor = { blockNumber: 42, logIndex: 3 };
    await persistence.save(identity, store.snapshot(), cursor);

    expect(await persistence.load(identity)).toEqual({ snapshot: store.snapshot(), cursor });
    const consumed = await Promise.all([
      persistence.consume("requester:id", 200, 100),
      persistence.consume("requester:id", 200, 100),
    ]);
    expect(consumed.sort()).toEqual([false, true]);
    expect(await persistence.consume("requester:id", 300, 200)).toBe(true);
  });
});
