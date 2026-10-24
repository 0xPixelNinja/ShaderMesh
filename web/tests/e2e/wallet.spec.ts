import { randomBytes } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import {
  api,
  ensureAvailableListing,
  ensureSmesh,
  hardhatAccount,
  installWallet,
  rpc,
  smeshBalance,
} from "./wallet";

// These specs sign real transactions against the local Compose stack. They
// share one chain and one provider listing, so they run serially.

const MANIFEST = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q";

interface ApiLease {
  id: number;
  requester: string;
  status: string;
  escrow: string;
}
interface ApiCredit {
  id: string;
  requester: string;
  active: boolean;
  escrow: string;
  paid: string;
}

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      await use(errors);
      expect(errors, "the page emitted browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

const header = (page: Page) => page.getByRole("banner");

async function connect(page: Page, account: string) {
  // A grant from earlier in the tab is restored on load, so connect only if needed.
  const address = header(page).getByText(`${account.slice(0, 6)}…${account.slice(-4)}`);
  const button = header(page).getByRole("button", { name: "Connect wallet" });
  // The server-rendered button can be clicked before hydration attaches its
  // handler, so retry the click until the address appears.
  await expect(async () => {
    if (await button.isVisible()) await button.click();
    await expect(address).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("wallet writes against the local stack", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("connects a wallet and shows the address and SMESH balance", async ({ page }) => {
    const account = await hardhatAccount(7);
    await ensureSmesh(account, "50");
    await installWallet(page, account);

    await page.goto("/dashboard");
    await expect(header(page).getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await connect(page, account);

    const balance = Number(await smeshBalance(account)) / 1e18;
    const shown = header(page).locator("span", { hasText: /^\$[\d,.]+SMESH$/ }).first();
    await expect(shown).toBeVisible();
    await expect.poll(async () => Number((await shown.innerText()).replace(/[^\d.]/g, ""))).toBeGreaterThan(0);
    const text = Number((await shown.innerText()).replace(/[^\d.]/g, ""));
    expect(Math.abs(text - balance)).toBeLessThan(Math.max(1, balance * 0.01));

    // The connection survives a reload, then can be dropped from the header.
    await page.reload();
    await expect(header(page).getByRole("button", { name: "Disconnect wallet" })).toBeVisible();
    await header(page).getByRole("button", { name: "Disconnect wallet" }).click();
    await expect(header(page).getByRole("button", { name: "Connect wallet" })).toBeVisible();
  });

  test("rents a GPU, shows heartbeat evidence, and ends the lease with a refund", async ({ page }) => {
    const account = await hardhatAccount(5);
    await ensureSmesh(account, "20");
    await ensureAvailableListing();
    const before = await api<ApiLease[]>("/leases");
    const lastId = Math.max(0, ...before.map((lease) => lease.id));

    await installWallet(page, account);
    await page.goto("/rent");
    await connect(page, account);

    // Use a short lease and set the manifest explicitly so the test does not
    // depend on the dev server's NEXT_PUBLIC defaults.
    await expect(page.getByRole("heading", { name: "Configure lease" })).toBeVisible();
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Workload manifest" }).click();
    await page.getByPlaceholder("ipfs://<CID>").fill(MANIFEST);
    await page.getByRole("button", { name: /^Request lease/ }).click();
    await expect(page.getByText(/Lease requested for/)).toBeVisible({ timeout: 60_000 });

    // The indexer picks up the new lease. The provider agent accepts it
    // within seconds, so Pending can be too brief to observe reliably.
    let leaseId = 0;
    await expect.poll(async () => {
      const leases = await api<ApiLease[]>("/leases");
      const lease = leases.find((entry) => entry.id > lastId && entry.requester.toLowerCase() === account.toLowerCase());
      leaseId = lease?.id ?? 0;
      return lease?.status;
    }, { timeout: 30_000 }).toMatch(/Pending|Active/);

    await page.goto("/leases");
    await connect(page, account);
    const row = page.getByRole("row").filter({ hasText: `lease #${leaseId}` });
    await expect(row).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible({ timeout: 90_000 });

    await expect(page.getByText("Lease evidence")).toBeVisible();
    await expect(page.getByText("Escrow intervals")).toBeVisible();
    await expect(page.getByText("Lifecycle")).toBeVisible();
    // The agent heartbeats once per 60 second interval.
    await expect(row.getByText(/· [1-9]\d*\/\d+ beats/)).toBeVisible({ timeout: 120_000 });

    const balanceBefore = await smeshBalance(account);
    const escrowBefore = BigInt((await api<ApiLease[]>("/leases")).find((entry) => entry.id === leaseId)!.escrow);
    await row.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByText(`End transaction submitted for lease #${leaseId}.`)).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Ended", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("No actions")).toBeVisible();

    const refunded = (await smeshBalance(account)) - balanceBefore;
    expect(refunded).toBeGreaterThan(0n);
    expect(refunded).toBeLessThanOrEqual(escrowBefore);
    const ended = (await api<ApiLease[]>("/leases")).find((entry) => entry.id === leaseId)!;
    expect(ended.status).toBe("Ended");
    expect(ended.escrow).toBe("0");
  });

  test("buys prepaid inference credit, chats with a signed request, and closes the credit", async ({ page }) => {
    const account = await hardhatAccount(6);
    await ensureSmesh(account, "20");
    const known = new Set((await api<ApiCredit[]>(`/credits?requester=${account}`)).map((credit) => credit.id));

    await installWallet(page, account);
    await page.goto("/models");
    await connect(page, account);

    await expect(page.getByRole("button", { pressed: true }).first()).toBeVisible();
    await page.getByLabel("New credit amount").fill("2");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByText(/Credit confirmed/)).toBeVisible({ timeout: 60_000 });

    let creditId = "";
    await expect.poll(async () => {
      const credit = (await api<ApiCredit[]>(`/credits?requester=${account}`)).find((entry) => !known.has(entry.id));
      creditId = credit?.id ?? "";
      return credit?.active;
    }, { timeout: 30_000 }).toBe(true);

    const picker = page.getByLabel("Active credit");
    await expect(picker.locator(`option[value="${creditId}"]`)).toBeAttached({ timeout: 30_000 });
    await picker.selectOption(creditId);

    const prompt = "Say hello to the ShaderMesh e2e suite.";
    await page.getByLabel("Prompt").fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The playground shows the user turn, then the provider reply and the
    // on-chain usage settlement the requester signs after it.
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    await expect(page.getByText(/Usage settled and confirmed|Usage settlement reconciled/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/\d+ in · \d+ out/)).toBeVisible();
    const bubbles = page.locator("div.whitespace-pre-wrap");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.nth(1)).not.toHaveText(/^\(no content\)$/);
    await expect(bubbles.nth(1)).not.toBeEmpty();

    await expect.poll(async () => {
      const credit = (await api<ApiCredit[]>(`/credits?requester=${account}`)).find((entry) => entry.id === creditId);
      return credit ? BigInt(credit.paid) : 0n;
    }, { timeout: 30_000 }).toBeGreaterThan(0n);

    const balanceBefore = await smeshBalance(account);
    const close = page.getByRole("button", { name: "Close credit and refund balance" });
    await expect(close).toBeEnabled();
    await close.click();
    await expect.poll(async () => {
      const credit = (await api<ApiCredit[]>(`/credits?requester=${account}`)).find((entry) => entry.id === creditId);
      return credit?.active;
    }, { timeout: 30_000 }).toBe(false);
    expect(await smeshBalance(account)).toBeGreaterThan(balanceBefore);
  });

  test("registers and stakes a fresh provider that is shown as unattested", async ({ page }) => {
    // A new address each run keeps the test repeatable. The node impersonates
    // it, so it signs transactions but needs ETH for gas.
    const account = `0x${randomBytes(20).toString("hex")}`;
    await rpc("hardhat_setBalance", [account, "0x56BC75E2D63100000"]);
    await rpc("hardhat_impersonateAccount", [account]);

    await installWallet(page, account);
    await page.goto("/providers");
    await connect(page, account);

    await expect(page.getByText("Not registered", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Claim 1,000 SMESH" }).click();
    await expect(header(page).getByText("$1,000.00")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Register provider" }).click();
    await expect(page.getByRole("button", { name: "Update capabilities" })).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("Add stake").fill("100");
    await page.getByRole("button", { name: "Approve and stake" }).click();
    await expect(page.getByText(/Stake confirmed/)).toBeVisible({ timeout: 60_000 });

    // Attestation comes from the attester service, so a new provider stays unattested.
    await expect(page.getByText("Required for market offers")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Not attested\. Market listings and inference offers require/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create listing" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create inference offer" })).toBeDisabled();

    const registry = page.getByRole("row").filter({ has: page.locator(`[title="${account}" i]`) });
    await expect(registry).toBeVisible({ timeout: 30_000 });
    await expect(registry.getByText("Active", { exact: true })).toBeVisible();
    await expect(registry.getByText("100.00 SMESH free")).toBeVisible();
  });
});
