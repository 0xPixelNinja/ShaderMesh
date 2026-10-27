const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

// A loopback URL baked into the build only works on the host machine. In the
// browser, point it at the host the page was loaded from, so a phone or a second
// laptop on the same network reaches the same services. Server rendering keeps
// the configured value, and real hostnames are never rewritten.
function browserReachable(configured: string): string {
  if (typeof window === "undefined") return configured;
  try {
    const url = new URL(configured);
    if (!LOOPBACK_HOSTS.has(url.hostname)) return configured;
    url.hostname = window.location.hostname;
    return configured.endsWith("/") ? url.href : url.href.replace(/\/$/, "");
  } catch {
    return configured;
  }
}

export const ORCHESTRATOR_URL = browserReachable(
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4000",
);
export const RPC_URL = browserReachable(process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545");
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

const configuredAuthorizationTtl = Number(
  process.env.NEXT_PUBLIC_INFERENCE_AUTH_TTL_SECONDS ?? 120,
);
export const INFERENCE_AUTH_TTL_SECONDS =
  Number.isInteger(configuredAuthorizationTtl) && configuredAuthorizationTtl > 0
    ? configuredAuthorizationTtl
    : 120;
export const DEFAULT_INFERENCE_CREDIT_SMESH =
  process.env.NEXT_PUBLIC_DEFAULT_INFERENCE_CREDIT_SMESH?.trim() || "10";

const IPFS_MANIFEST = /^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/[^\s?#]+)*$/;

export function isContentAddressedManifest(value: string): boolean {
  return IPFS_MANIFEST.test(value.trim());
}

const configuredManifest = process.env.NEXT_PUBLIC_DEFAULT_LEASE_MANIFEST?.trim() ?? "";
export const DEFAULT_LEASE_MANIFEST = isContentAddressedManifest(configuredManifest)
  ? configuredManifest
  : "";

// The demo pegs 1 SMESH to 1 USD, so token base units map directly to dollars.
export const USD_PER_SMESH = 1;
