import { describe, expect, it } from "vitest";
import { Wallet, verifyMessage } from "ethers";
import { canonicalRequestAuthorization, hashMessages } from "./authorization";

describe("request authorization", () => {
  it("canonicalizes message object keys and produces an EIP-191 verifiable payload", async () => {
    const requester = Wallet.createRandom();
    const provider = Wallet.createRandom();
    const authorization = {
      creditId: "01",
      requestId: "request-1",
      requester: requester.address,
      provider: provider.address,
      model: "model-a",
      expiry: 1_800_000_000,
    };
    const messages = [{ content: "hello", role: "user" }];

    expect(hashMessages(messages)).toBe(hashMessages([{ role: "user", content: "hello" }]));
    const canonical = canonicalRequestAuthorization(authorization, messages);
    expect(canonical).toContain('"creditId":"1"');
    expect(canonical).toContain(`"messagesHash":"${hashMessages(messages)}"`);

    const signature = await requester.signMessage(canonical);
    expect(verifyMessage(canonical, signature)).toBe(requester.address);
  });
});
