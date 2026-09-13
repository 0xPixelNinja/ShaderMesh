/**
 * ShaderMesh Orchestrator (thin, untrusted coordinator)
 * -----------------------------------------------------
 * Splits jobs into tasks, indexes on-chain events, assists matchmaking, and
 * stitches verified tiles/frames into the final artifact. It holds NO custody
 * of funds and cannot forge results — all value + validation stay on-chain.
 *
 * STATUS: functional skeleton — connects to the chain, loads deployment
 * addresses, subscribes to JobPosted, and serves a health endpoint. Splitting,
 * IPFS pinning, indexing to Postgres, and stitching are Phase P4 TODOs.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYMENTS_FILE = process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/docker.json";
const PORT = Number(process.env.PORT ?? 4000);

// Minimal ABI: just the event we index at this stage.
const JOB_MARKET_ABI = [
  "event JobPosted(uint256 indexed jobId, address indexed requester, string inputCID, uint32 taskCount, uint256 rewardPerTask, uint8 verificationPolicy)",
];

type Deployment = {
  network: string;
  chainId: number;
  contracts: Record<string, string>;
};

function loadDeployment(path: string): Deployment {
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function main() {
  let status = "starting";

  // Health endpoint first, so the container is observable even while connecting.
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "orchestrator", status }));
  }).listen(PORT, () => console.log(`[orchestrator] health on :${PORT}`));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await provider.getNetwork(); // throws if unreachable
  const deployment = loadDeployment(DEPLOYMENTS_FILE);
  const market = new ethers.Contract(deployment.contracts.JobMarket, JOB_MARKET_ABI, provider);

  status = "connected";
  console.log(`[orchestrator] chainId=${deployment.chainId} JobMarket=${await market.getAddress()}`);

  market.on(
    "JobPosted",
    (jobId, requester, inputCID, taskCount, rewardPerTask, _policy) => {
      console.log(
        `[orchestrator] JobPosted #${jobId} by ${requester}: ${taskCount} task(s) @ ${ethers.formatEther(
          rewardPerTask
        )} SMESH, input=${inputCID}`
      );
      // TODO(P4): split into tasks, pin manifest to IPFS, index to Postgres,
      //           and (post-verification) stitch tiles into the final artifact.
    }
  );

  console.log("[orchestrator] indexing JobPosted events...");
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
