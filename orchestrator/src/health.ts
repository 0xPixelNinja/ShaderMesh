export type HealthComponent = "persistence" | "indexing";

export class ServiceHealth {
  private failures = new Map<HealthComponent, string>();

  fail(component: HealthComponent, error: unknown): void {
    this.failures.set(component, error instanceof Error ? error.message : String(error));
  }

  recover(component: HealthComponent): void {
    this.failures.delete(component);
  }

  report(): { status: "ok" | "degraded"; failures?: Record<string, string> } {
    if (this.failures.size === 0) return { status: "ok" };
    return { status: "degraded", failures: Object.fromEntries(this.failures) };
  }
}
