import { defineChain } from "viem";
import { CHAIN_ID, RPC_URL } from "./config";

export const shaderChain = defineChain({
  id: CHAIN_ID,
  name: "ShaderMesh Dev",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
