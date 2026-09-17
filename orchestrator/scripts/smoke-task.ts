import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { parse as parseEnv } from "dotenv";

const smokeEnv = process.env.SMOKE_ENV_FILE
  ? parseEnv(readFileSync(process.env.SMOKE_ENV_FILE))
  : {};
const rpcUrl = process.env.RPC_URL ?? smokeEnv.SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545";
const gatewayUrl = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";
const deploymentsFile = process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/localhost.json";
const accountIndex = Number(process.env.SMOKE_ACCOUNT_INDEX ?? 4);
const privateKey = process.env.SMOKE_PRIVATE_KEY ?? smokeEnv.PRIVATE_KEY;

async function waitForJson<T>(path: string, accept: (value: T) => boolean, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${gatewayUrl}${path}`);
    if (response.ok) {
      const value = await response.json() as T;
      if (accept(value)) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  if (Number(deployment.chainId) !== 31337 && !privateKey) {
    throw new Error("a private key is required outside the local Hardhat network");
  }

  const rpc = new JsonRpcProvider(rpcUrl);
  const signer = privateKey
    ? new Wallet(privateKey, rpc)
    : await rpc.getSigner(accountIndex);
  const requester = await signer.getAddress();
  const token = new Contract(deployment.contracts.SmeshToken, deployment.abis.SmeshToken, signer);
  const market = new Contract(deployment.contracts.JobMarket, deployment.abis.JobMarket, signer);

  const preparedResponse = await fetch(`${gatewayUrl}/jobs/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spec: {
        width: 64,
        height: 64,
        re_min: -2.2,
        re_max: 0.8,
        im_min: -1.5,
        im_max: 1.5,
        max_iter: 100,
      },
      tilesX: 1,
      tilesY: 1,
    }),
  });
  const prepared: any = await preparedResponse.json();
  if (!preparedResponse.ok) throw new Error(prepared.error ?? "job preparation failed");

  const reward = parseEther("0.1");
  await (await token.approve(deployment.contracts.JobMarket, reward)).wait();
  const jobId = Number(await market.nextJobId());
  await (await market.postJob(prepared.inputCID, prepared.taskCount, reward, 0)).wait();

  await waitForJson<any>(
    `/jobs/${jobId}`,
    (value) => value.tasks?.[0]?.status === "Submitted",
  );
  const challengeWindow = Number(await market.challengeWindow());
  await new Promise((resolve) => setTimeout(resolve, (challengeWindow + 8) * 1_000));
  await (await market.finalizeTask(jobId, 0)).wait();

  const completed = await waitForJson<any>(
    `/jobs/${jobId}`,
    (value) => value.job?.completed === true && value.tasks?.[0]?.status === "Paid",
  );
  const result = await waitForJson<any>(
    `/jobs/${jobId}/result`,
    (value) => typeof value.resultCID === "string" && value.resultCID.length > 0,
  );

  console.log(JSON.stringify({
    jobId,
    requester,
    inputCID: prepared.inputCID,
    outputCID: completed.tasks[0].outputCID,
    resultCID: result.resultCID,
    status: "passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
