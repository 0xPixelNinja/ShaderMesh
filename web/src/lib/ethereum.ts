import type { EIP1193Provider } from "viem";

export function getEthereumProvider(): EIP1193Provider | undefined {
  return (globalThis as typeof globalThis & { ethereum?: EIP1193Provider }).ethereum;
}
