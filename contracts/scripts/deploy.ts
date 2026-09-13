import { ethers, network } from "hardhat";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Deploys the full ShaderMesh stack and wires up permissions:
 *   SmeshToken  -> ProviderRegistry -> JobMarket -> Verification
 * then authorizes JobMarket & Verification to mutate registry economics,
 * and points JobMarket at the Verification contract.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = deployer.address;
  console.log("Deployer:", owner);

  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1,000,000 SMESH
  const MIN_STAKE = ethers.parseEther("50"); // provider must stake >= 50 SMESH

  const Token = await ethers.getContractFactory("SmeshToken");
  const token = await Token.deploy(INITIAL_SUPPLY, owner);
  await token.waitForDeployment();
  console.log("SmeshToken:      ", await token.getAddress());

  const Registry = await ethers.getContractFactory("ProviderRegistry");
  const registry = await Registry.deploy(await token.getAddress(), MIN_STAKE, owner);
  await registry.waitForDeployment();
  console.log("ProviderRegistry:", await registry.getAddress());

  const Market = await ethers.getContractFactory("JobMarket");
  const market = await Market.deploy(await token.getAddress(), await registry.getAddress(), owner);
  await market.waitForDeployment();
  console.log("JobMarket:       ", await market.getAddress());

  const Verification = await ethers.getContractFactory("Verification");
  const verification = await Verification.deploy(
    await market.getAddress(),
    await registry.getAddress(),
    owner
  );
  await verification.waitForDeployment();
  console.log("Verification:    ", await verification.getAddress());

  // Wire permissions.
  await (await registry.setAuthorized(await market.getAddress(), true)).wait();
  await (await registry.setAuthorized(await verification.getAddress(), true)).wait();
  await (await market.setVerification(await verification.getAddress())).wait();

  console.log("\nWiring complete. ShaderMesh is deployed and authorized.");

  // Persist addresses AND ABIs so off-chain services (orchestrator, agents) can
  // discover everything they need from one file, without hardcoding interfaces.
  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: owner,
    contracts: {
      SmeshToken: await token.getAddress(),
      ProviderRegistry: await registry.getAddress(),
      JobMarket: await market.getAddress(),
      Verification: await verification.getAddress(),
    },
    abis: {
      SmeshToken: JSON.parse(Token.interface.formatJson()),
      ProviderRegistry: JSON.parse(Registry.interface.formatJson()),
      JobMarket: JSON.parse(Market.interface.formatJson()),
      Verification: JSON.parse(Verification.interface.formatJson()),
    },
    timestamp: new Date().toISOString(),
  };

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${network.name}.json`);
  writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Deployment written to deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
