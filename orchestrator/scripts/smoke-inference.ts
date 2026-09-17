import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { parse as parseEnv } from "dotenv";
import { canonicalRequestAuthorization } from "../src/authorization";

const smokeEnv = process.env.SMOKE_ENV_FILE
  ? parseEnv(readFileSync(process.env.SMOKE_ENV_FILE))
  : {};
const rpcUrl = process.env.RPC_URL ?? smokeEnv.SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545";
const gatewayUrl = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";
const deploymentsFile = process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/localhost.json";
const accountIndex = Number(process.env.SMOKE_ACCOUNT_INDEX ?? 4);
const model = process.env.SMOKE_MODEL ?? "llama-3.1-8b";
const privateKey = process.env.SMOKE_PRIVATE_KEY ?? smokeEnv.PRIVATE_KEY;

async function waitForJson<T>(path: string, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${gatewayUrl}${path}`);
    if (response.ok) {
      const value = await response.json() as T;
      if (accept(value)) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  if (Number(deployment.chainId) !== 31337 && !privateKey) {
    throw new Error("smoke-inference uses an unlocked local Hardhat account only");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const signer = privateKey
    ? new Wallet(privateKey, provider)
    : await provider.getSigner(accountIndex);
  const requester = await signer.getAddress();
  const token = new Contract(deployment.contracts.SmeshToken, deployment.abis.SmeshToken, signer);
  const inference = new Contract(
    deployment.contracts.InferenceMarket,
    deployment.abis.InferenceMarket,
    signer,
  );

  const offers = await waitForJson<Array<{
    id: string;
    provider: string;
    modelIdentifier: string;
    active: boolean;
  }>>("/offers", (value) => value.some((offer) => offer.active && offer.modelIdentifier === model));
  const offer = offers.find((candidate) => candidate.active && candidate.modelIdentifier === model)!;

  const escrow = parseEther("1");
  await (await token.approve(deployment.contracts.InferenceMarket, escrow)).wait();
  const creditId = (await inference.nextCreditId()).toString();
  await (await inference.openCredit(offer.id, escrow)).wait();
  await waitForJson(`/credits/${creditId}`, (value: any) => value.active === true);

  const messages = [{ role: "user", content: "Return a short ShaderMesh health confirmation." }];
  const authorization = {
    creditId,
    requestId: `smoke-${Date.now()}`,
    requester,
    provider: offer.provider,
    model,
    expiry: Math.floor(Date.now() / 1000) + 120,
  };
  const signature = await signer.signMessage(canonicalRequestAuthorization(authorization, messages));
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      authorization: {
        credit_id: creditId,
        request_id: authorization.requestId,
        requester,
        provider: offer.provider,
        expiry: authorization.expiry,
        signature,
      },
    }),
  });
  const completion: any = await response.json();
  if (!response.ok) throw new Error(completion.error ?? `gateway returned HTTP ${response.status}`);

  const promptTokens = BigInt(completion.usage?.prompt_tokens ?? 0);
  const completionTokens = BigInt(completion.usage?.completion_tokens ?? 0);
  if (promptTokens + completionTokens === 0n) throw new Error("provider returned no billable usage");

  await (await inference.settleUsage(creditId, promptTokens, completionTokens)).wait();
  const settled = await waitForJson<any>(
    `/credits/${creditId}`,
    (value) => BigInt(value.promptTokens) === promptTokens && BigInt(value.completionTokens) === completionTokens,
  );
  await (await inference.closeCredit(creditId)).wait();
  await waitForJson<any>(`/credits/${creditId}`, (value) => value.active === false);

  console.log(JSON.stringify({
    creditId,
    model,
    provider: offer.provider,
    promptTokens: promptTokens.toString(),
    completionTokens: completionTokens.toString(),
    paid: settled.paid,
    status: "passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
