import { describe, expect, it } from "vitest";
import { ProjectionStore } from "./store";
import { dispatch } from "./indexer";

describe("inference projection", () => {
  it("tracks offers and the complete prepaid credit lifecycle without losing uint256 precision", () => {
    const store = new ProjectionStore();
    const id = "9007199254740993";

    dispatch(store, "OfferCreated", {
      offerId: BigInt(id),
      provider: "0xProvider",
      modelIdentifier: "model-a",
      pricePerToken: 7n,
    });
    dispatch(store, "CreditOpened", {
      creditId: BigInt(id),
      offerId: BigInt(id),
      requester: "0xRequester",
      provider: "0xProvider",
      pricePerToken: 7n,
      escrow: 100n,
    });

    expect(store.getOffer(id)).toMatchObject({ id, active: true, pricePerToken: "7" });
    expect(store.getCredit(id)).toMatchObject({
      id,
      offerId: id,
      escrow: "100",
      paid: "0",
      active: true,
    });

    dispatch(store, "UsageSettled", {
      creditId: BigInt(id),
      promptTokens: 4n,
      completionTokens: 3n,
      payment: 49n,
      remainingEscrow: 51n,
    });
    expect(store.getCredit(id)).toMatchObject({
      promptTokens: "4",
      completionTokens: "3",
      paid: "49",
      escrow: "51",
    });

    dispatch(store, "OfferDeactivated", { offerId: BigInt(id), provider: "0xProvider" });
    dispatch(store, "CreditClosed", {
      creditId: BigInt(id),
      requester: "0xRequester",
      provider: "0xProvider",
      promptTokens: 4n,
      completionTokens: 3n,
      totalPaid: 49n,
      refund: 51n,
    });

    expect(store.getOffer(id)?.active).toBe(false);
    expect(store.getCredit(id)).toMatchObject({ active: false, escrow: "0", paid: "49" });
  });

  it("filters credits by requester without case sensitivity", () => {
    const store = new ProjectionStore();
    store.onCreditOpened("1", "1", "0xAbC", "0xProvider", "1", "10");
    store.onCreditOpened("2", "1", "0xDef", "0xProvider", "1", "10");

    expect(store.listCredits("0xabc").map((credit) => credit.id)).toEqual(["1"]);
  });
});
