import { expect, test as base, type Page } from "@playwright/test";

const routes = [
  { path: "/dashboard", title: "Home", navLabel: "Home" },
  { path: "/rent", title: "Marketplace", navLabel: "Marketplace" },
  { path: "/leases", title: "My leases", navLabel: "My leases" },
  { path: "/models", title: "Inference", navLabel: "Inference" },
  { path: "/provide", title: "Node", navLabel: "Node" },
  { path: "/provide/capacity", title: "Capacity", navLabel: "Capacity" },
  { path: "/provide/stake", title: "Stake", navLabel: "Stake" },
  { path: "/explorer", title: "Explorer", navLabel: "Explorer" },
] as const;

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

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => {
    const root = document.documentElement;
    return { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth };
  });
  expect(dimensions.scrollWidth, `document width was ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(
    dimensions.clientWidth,
  );
}

async function expectLoaded(page: Page, statusName: string) {
  await expect(page.getByRole("status", { name: statusName })).toBeHidden();
}

async function expectKeySections(page: Page, path: string) {
  if (path === "/dashboard") {
    await expect(page.getByRole("region", { name: "Renting" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Providing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Network now", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity", exact: true })).toBeVisible();
  } else if (path === "/rent") {
    await expect(page.getByRole("heading", { name: "Available GPUs", exact: true })).toBeVisible();
    await expectLoaded(page, "Loading available GPUs");
  } else if (path === "/leases") {
    await expect(page.getByText("Connect your wallet to see your leases", { exact: true })).toBeVisible();
  } else if (path === "/models") {
    await expect(page.getByRole("heading", { name: "Inference offers", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prepaid credit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transaction state", exact: true })).toBeVisible();
    await expectLoaded(page, "Loading inference offers");
  } else if (path === "/provide") {
    await expect(page.getByRole("heading", { name: "Connect your provider wallet", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provider registry", exact: true })).toBeVisible();
  } else if (path === "/provide/capacity" || path === "/provide/stake") {
    await expect(page.getByRole("heading", { name: "Connect your provider wallet", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Protocol state", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rental leases", exact: true })).toBeVisible();
    await expectLoaded(page, "Loading leases");
  }

  // Next.js includes an empty route-announcer with role="alert". Only fail on
  // visible application alerts that contain an error message.
  await expect(page.locator('[role="alert"]:visible').filter({ hasText: /\S/ })).toHaveCount(0);
}

test.describe("dashboard routes", () => {
  for (const route of routes) {
    test(`${route.title} renders cleanly`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response?.ok(), `${route.path} returned HTTP ${response?.status()}`).toBe(true);
      await expect(page).toHaveTitle("ShaderMesh");
      await expect(page.locator("h1")).toHaveText(route.title);
      await expectKeySections(page, route.path);
      await expectNoDocumentOverflow(page);
    });
  }
});

test("navigation reaches every route", async ({ page }, testInfo) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  const mobile = testInfo.project.name === "mobile-390-chromium";
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
  const desktopNavigation = page.locator("aside");
  await expect(mobileNavigation).toBeVisible({ visible: mobile });
  await expect(desktopNavigation).toBeVisible({ visible: !mobile });

  const navigation = mobile ? mobileNavigation : desktopNavigation;
  for (const route of routes) {
    await navigation.getByRole("link", { name: route.navLabel, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === route.path);
    await expect(page.locator("h1")).toHaveText(route.title);
  }

  expect(page.viewportSize()?.width).toBe(mobile ? 390 : 1440);
  await expectNoDocumentOverflow(page);
});

test("/providers redirects to /provide", async ({ page }) => {
  await page.goto("/providers", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL((url) => url.pathname === "/provide");
  await expect(page.locator("h1")).toHaveText("Node");
});

test("explorer tabs expose indexed read-only sections", async ({ page }) => {
  await page.goto("/explorer", { waitUntil: "domcontentloaded" });

  const sections = [
    { tab: "Leases", headings: ["Rental leases"], loading: ["Loading leases"] },
    { tab: "Events and slashes", headings: ["Chronological activity"], loading: ["Loading event history"] },
  ];

  for (const section of sections) {
    const tab = page.getByRole("tab", { name: section.tab, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    for (const heading of section.headings) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    for (const loading of section.loading) await expectLoaded(page, loading);
  }

  const slashes = page.getByRole("button", { name: "Slashes", exact: true });
  await slashes.click();
  await expect(slashes).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[role="alert"]:visible').filter({ hasText: /\S/ })).toHaveCount(0);
  await expectNoDocumentOverflow(page);
});

test("landing page explains the protocol and opens the app", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rent GPUs by the hour.");
  await expect(page.getByRole("img", { name: /Lease lifecycle/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Token flow/ })).toBeVisible();
  await page.getByRole("link", { name: "Open app" }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === "/dashboard");
});

test("theme toggle switches to dark and persists", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
