import { expect, test as base, type Page } from "@playwright/test";

const routes = [
  { path: "/", title: "Overview", navLabel: "Overview" },
  { path: "/rent", title: "Rent GPUs", navLabel: "Rent GPUs" },
  { path: "/leases", title: "My leases", navLabel: "My leases" },
  { path: "/models", title: "Models", navLabel: "Models" },
  { path: "/providers", title: "Provider console", navLabel: "Providers" },
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
  if (path === "/") {
    await expect(page.getByRole("heading", { name: "Your active leases", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top providers", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run a model", exact: true })).toBeVisible();
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
  } else if (path === "/providers") {
    await expect(page.getByRole("heading", { name: "Operate as a provider", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provider registry", exact: true })).toBeVisible();
    await expectLoaded(page, "Loading providers");
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
  await page.goto("/", { waitUntil: "domcontentloaded" });

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

test("explorer tabs expose indexed read-only sections", async ({ page }) => {
  await page.goto("/explorer", { waitUntil: "domcontentloaded" });

  const sections = [
    { tab: "Leases", headings: ["Rental leases"], loading: ["Loading leases"] },
    { tab: "Jobs and tasks", headings: ["Verifiable jobs", "Tasks"], loading: ["Loading jobs", "Loading tasks"] },
    { tab: "Disputes", headings: ["Verification disputes"], loading: ["Loading disputes"] },
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
