/**
 * ShaderMesh Orchestrator (thin, untrusted coordinator).
 *
 * Splits jobs into tiles, indexes on-chain events into a projection, stitches
 * verified tiles into a final image, and serves a read API with a live stream.
 * It holds no funds and cannot forge results. All value and validation stay on
 * chain; the projection is a rebuildable view of chain history.
 */
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { ethers } from "ethers";
import { loadConfig } from "./config";
import { ProjectionStore } from "./store";
import { makeStorage } from "./storage";
import { JobService } from "./jobservice";
import { Indexer, withRpcRetry } from "./indexer";
import { createApi } from "./api";
import { ServiceHealth } from "./health";
import { PostgresPersistence, type DeploymentIdentity } from "./persistence";

async function main() {
  const cfg = loadConfig();
  const store = new ProjectionStore();
  const health = new ServiceHealth();
  health.fail("indexing", "indexer has not started");
  const storage = makeStorage(cfg.storageBackend, {
    root: cfg.storageRoot,
    ipfsApiUrl: cfg.ipfsApiUrl,
  });
  const jobService = new JobService(storage, store);
  const emitter = new EventEmitter();

  const dep = JSON.parse(readFileSync(cfg.deploymentsFile, "utf-8"));
  const deploymentInfo = { chainId: Number(dep.chainId), contracts: dep.contracts as Record<string, string> };
  const identity: DeploymentIdentity = {
    chainId: BigInt(dep.chainId).toString(),
    contracts: dep.contracts,
    deploymentId: String(dep.timestamp ?? ""),
  };
  const persistence = new PostgresPersistence(cfg.databaseUrl, identity);
  try {
    // After an unclean Docker restart, Postgres can still be in crash recovery
    // when this container starts, so wait for it instead of giving up.
    for (let attempt = 1; ; attempt++) {
      try {
        await persistence.initialize();
        break;
      } catch (error) {
        if (attempt >= 24) throw error;
        console.warn(`[orchestrator] database not ready (attempt ${attempt}), retrying in 5 s`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    health.recover("persistence");
  } catch (error) {
    health.fail("persistence", error);
    console.error("[orchestrator] database initialization failed:", error);
  }

  const server = createApi(store, jobService, emitter, deploymentInfo, {
    requestBodyLimitBytes: cfg.requestBodyLimitBytes,
    providerFetchTimeoutMs: cfg.providerFetchTimeoutMs,
    providerHostAllowlist: cfg.providerHostAllowlist,
    replayStore: persistence,
    health,
  });
  server.listen(cfg.port, () => console.log(`[orchestrator] API on :${cfg.port}`));

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const network = await withRpcRetry(
      () => provider.getNetwork(),
      cfg.indexerRpcRetryAttempts,
      cfg.indexerRpcRetryIntervalMs,
    );
    if (network.chainId !== BigInt(dep.chainId)) {
      throw new Error(`deployment chain ${dep.chainId} does not match RPC chain ${network.chainId}`);
    }

    const market = new ethers.Contract(dep.contracts.JobMarket, dep.abis.JobMarket, provider);
    const verification = new ethers.Contract(dep.contracts.Verification, dep.abis.Verification, provider);
    const rental = new ethers.Contract(dep.contracts.RentalMarket, dep.abis.RentalMarket, provider);
    const registry = new ethers.Contract(dep.contracts.ProviderRegistry, dep.abis.ProviderRegistry, provider);
    const inference = new ethers.Contract(dep.contracts.InferenceMarket, dep.abis.InferenceMarket, provider);

    const indexer = new Indexer(
      market,
      verification,
      rental,
      registry,
      inference,
      store,
      emitter,
      {
        persistence,
        identity,
        health,
        getBlockNumber: () => provider.getBlockNumber(),
        maxBlockRange: cfg.indexerBlockRange,
        pollIntervalMs: cfg.indexerPollIntervalMs,
        rpcRetryAttempts: cfg.indexerRpcRetryAttempts,
        rpcRetryIntervalMs: cfg.indexerRpcRetryIntervalMs,
      }
    );

    // Stitch automatically once a job's tasks all settle.
    emitter.on("update", async (u: { name: string; payload: any }) => {
      if (u.name === "JobCompleted") {
        try {
          const cid = await jobService.stitchJob(Number(u.payload.jobId));
          await indexer.persistCurrentSnapshot();
          console.log(`[orchestrator] stitched job ${u.payload.jobId} -> ${cid}`);
        } catch (err) {
          console.error(`[orchestrator] stitch failed:`, err);
        }
      }
    });

    await indexer.start(Number(dep.deploymentBlock ?? 0));
    console.log(`[orchestrator] indexing JobMarket at ${await market.getAddress()}`);
    console.log(`[orchestrator] indexing InferenceMarket at ${await inference.getAddress()}`);
  } catch (err) {
    health.fail("indexing", err);
    console.error("[orchestrator] chain/indexing failed; serving degraded API:", err);
  }
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
