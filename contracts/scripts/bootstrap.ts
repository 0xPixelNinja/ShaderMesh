import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type ProviderRecord = {
  address: string;
  gpuModel: string;
  vramGB: number;
  benchmarkScore: bigint;
  fundSmesh?: bigint;
};

type RequesterRecord = {
  address: string;
  fundSmesh: bigint;
};

function parseJson(name: string, fallback: string): unknown {
  try {
    return JSON.parse(process.env[name] ?? fallback);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

function parseUint(value: unknown, field: string): bigint {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${field} must be an unsigned integer or integer string`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${field} must be an unsigned integer`);
  }
  if (parsed < 0n) throw new Error(`${field} must be non-negative`);
  if (parsed > ethers.MaxUint256) throw new Error(`${field} exceeds uint256`);
  return parsed;
}

function parseSmesh(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,18})?$/.test(value)) {
    throw new Error(`${field} must be a non-negative decimal string`);
  }
  const parsed = ethers.parseUnits(value, 18);
  if (parsed > ethers.MaxUint256) throw new Error(`${field} exceeds uint256`);
  return parsed;
}

function parseAddress(value: unknown, field: string): string {
  const address = ethers.getAddress(String(value ?? ""));
  if (address === ethers.ZeroAddress) throw new Error(`${field} must not be the zero address`);
  return address;
}

function parseProviders(value: unknown): ProviderRecord[] {
  if (!Array.isArray(value)) throw new Error("BOOTSTRAP_PROVIDERS_JSON must be an array");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`provider ${index} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const address = parseAddress(record.address, `provider ${index} address`);
    if (seen.has(address)) throw new Error(`duplicate provider address ${address}`);
    seen.add(address);
    if (typeof record.gpuModel !== "string" || !record.gpuModel.trim()) {
      throw new Error(`provider ${index} gpuModel must be a non-empty string`);
    }
    const vram = parseUint(record.vramGB, `provider ${index} vramGB`);
    if (vram > 0xffffffffn) throw new Error(`provider ${index} vramGB exceeds uint32`);
    const benchmarkScore = parseUint(
      record.benchmarkScore,
      `provider ${index} benchmarkScore`,
    );
    if (benchmarkScore === 0n) {
      throw new Error(`provider ${index} benchmarkScore must be positive`);
    }
    return {
      address,
      gpuModel: record.gpuModel.trim(),
      vramGB: Number(vram),
      benchmarkScore,
      fundSmesh:
        record.fundSmesh === undefined
          ? undefined
          : parseSmesh(record.fundSmesh, `provider ${index} fundSmesh`),
    };
  });
}

function parseRequester(value: unknown): RequesterRecord | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BOOTSTRAP_REQUESTER_JSON must be an object or null");
  }
  const record = value as Record<string, unknown>;
  return {
    address: parseAddress(record.address, "requester address"),
    fundSmesh: parseSmesh(record.fundSmesh, "requester fundSmesh"),
  };
}

async function fundToTarget(
  token: any,
  address: string,
  target: bigint,
): Promise<void> {
  const balance = await token.balanceOf(address);
  if (balance >= target) {
    console.log(`Funding unchanged for ${address}: balance already meets target`);
    return;
  }
  const amount = target - balance;
  await (await token.mint(address, amount)).wait();
  console.log(`Funded ${address} with ${ethers.formatEther(amount)} SMESH`);
}

async function main() {
  const providers = parseProviders(parseJson("BOOTSTRAP_PROVIDERS_JSON", "[]"));
  const requester = parseRequester(parseJson("BOOTSTRAP_REQUESTER_JSON", "null"));
  if (providers.length === 0 && requester === null) {
    throw new Error("no providers or requester configured for bootstrap");
  }

  const deploymentPath = resolve(
    process.env.DEPLOYMENTS_FILE ??
      join(__dirname, "..", "deployments", `${network.name}.json`),
  );
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (Number(deployment.chainId) !== chainId) {
    throw new Error(
      `deployment chain ${deployment.chainId} does not match RPC chain ${chainId}`,
    );
  }

  const [operator] = await ethers.getSigners();
  const token = await ethers.getContractAt("SmeshToken", deployment.contracts.SmeshToken);
  const registry = await ethers.getContractAt(
    "ProviderRegistry",
    deployment.contracts.ProviderRegistry,
  );

  for (const provider of providers) {
    const state = await registry.providers(provider.address);
    if (!state.registered) {
      throw new Error(`provider ${provider.address} must register before attestation`);
    }
  }

  const fundingRequested =
    requester !== null || providers.some((provider) => provider.fundSmesh !== undefined);
  if (fundingRequested && (await token.owner()) !== operator.address) {
    throw new Error("bootstrap signer is not the token owner required for funding");
  }
  if (providers.length > 0 && (await registry.attester()) !== operator.address) {
    throw new Error("bootstrap signer is not the configured registry attester");
  }

  for (const provider of providers) {
    if (provider.fundSmesh !== undefined) {
      await fundToTarget(token, provider.address, provider.fundSmesh);
    }
    const current = await registry.attestations(provider.address);
    const fresh = await registry.isAttested(provider.address);
    if (
      fresh &&
      current.gpuModel === provider.gpuModel &&
      current.vramGB === BigInt(provider.vramGB) &&
      current.benchmarkScore === provider.benchmarkScore
    ) {
      console.log(`Attestation unchanged for ${provider.address}`);
      continue;
    }
    await (
      await registry.attest(
        provider.address,
        provider.gpuModel,
        provider.vramGB,
        provider.benchmarkScore,
      )
    ).wait();
    console.log(`Attested ${provider.address}: ${provider.gpuModel}`);
  }

  if (requester !== null) {
    await fundToTarget(token, requester.address, requester.fundSmesh);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
