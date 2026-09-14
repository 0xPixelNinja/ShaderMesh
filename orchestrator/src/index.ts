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
import { Indexer } from "./indexer";
import { createApi } from "./api";

async function main() {
  const cfg = loadConfig();
  const store = new ProjectionStore();
  const storage = makeStorage(cfg.storageBackend, {
    root: cfg.storageRoot,
    ipfsApiUrl: cfg.ipfsApiUrl,
  });
  const jobService = new JobService(storage, store);
  const emitter = new EventEmitter();

  let deploymentInfo: { chainId: number; contracts: Record<string, string> } | undefined;
  try {
    const dep = JSON.parse(readFileSync(cfg.deploymentsFile, "utf-8"));
    deploymentInfo = { chainId: dep.chainId, contracts: dep.contracts };
  } catch {
    deploymentInfo = undefined;
  }

  const server = createApi(store, jobService, emitter, deploymentInfo);
  server.listen(cfg.port, () => console.log(`[orchestrator] API on :${cfg.port}`));

  try {
    const dep = JSON.parse(readFileSync(cfg.deploymentsFile, "utf-8"));
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    await provider.getNetwork();

    const market = new ethers.Contract(dep.contracts.JobMarket, dep.abis.JobMarket, provider);
    const verification = new ethers.Contract(dep.contracts.Verification, dep.abis.Verification, provider);
    const rental = new ethers.Contract(dep.contracts.RentalMarket, dep.abis.RentalMarket, provider);
    const registry = new ethers.Contract(dep.contracts.ProviderRegistry, dep.abis.ProviderRegistry, provider);

    const indexer = new Indexer(market, verification, rental, registry, store, emitter);

    // Stitch automatically once a job's tasks all settle.
    emitter.on("update", async (u: { name: string; payload: any }) => {
      if (u.name === "JobCompleted") {
        try {
          const cid = await jobService.stitchJob(Number(u.payload.jobId));
          console.log(`[orchestrator] stitched job ${u.payload.jobId} -> ${cid}`);
        } catch (err) {
          console.error(`[orchestrator] stitch failed:`, err);
        }
      }
    });

    await indexer.start();
    console.log(`[orchestrator] indexing JobMarket at ${await market.getAddress()}`);
  } catch (err) {
    console.error("[orchestrator] chain connection failed; serving API only:", err);
  }
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
