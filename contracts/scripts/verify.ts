import hre, { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Verifies every contract from deployments/<network>.json on the block explorer,
 * reconstructing the constructor arguments used by scripts/deploy.ts.
 * Already-verified contracts are reported and skipped.
 */
async function main() {
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  const dep = JSON.parse(readFileSync(file, "utf8"));
  const c = dep.contracts;
  const owner = dep.deployer;

  const targets: [string, string, unknown[]][] = [
    ["SmeshToken", c.SmeshToken, [ethers.parseEther("1000000"), owner]],
    ["ProviderRegistry", c.ProviderRegistry, [c.SmeshToken, ethers.parseEther("50"), owner]],
    ["JobMarket", c.JobMarket, [c.SmeshToken, c.ProviderRegistry, owner]],
    ["Verification", c.Verification, [c.JobMarket, c.ProviderRegistry, owner]],
    ["RentalMarket", c.RentalMarket, [c.SmeshToken, c.ProviderRegistry, owner]],
    ["InferenceMarket", c.InferenceMarket, [c.SmeshToken, c.ProviderRegistry]],
  ];

  for (const [name, address, constructorArguments] of targets) {
    try {
      await hre.run("verify:verify", { address, constructorArguments });
      console.log(`${name}: verified at ${address}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already verified/i.test(message)) console.log(`${name}: already verified`);
      else throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
