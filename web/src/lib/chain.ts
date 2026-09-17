import { defineChain } from "viem";
import { CHAIN_ID, RPC_URL } from "./config";

export const shaderChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 11155111 ? "Sepolia" : "ShaderMesh Dev",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
