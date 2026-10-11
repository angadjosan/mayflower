import { describe, it, expect } from "vitest";
import { eventToMarkets, contractToQuote, mapOrder } from "./gemini-rest";

describe("gemini mapping", () => {
  const ev = { id: "1", title: "Will BTC close above 83k?", type: "binary" as const, category: "Crypto", ticker: "GEMI-BTC", status: "active", contracts: [{ id: "c", label: "Yes", ticker: "HI83000", instrumentSymbol: "GEMI-BTC-HI83000", marketState: "open" as const, status: "active", prices: { buy: { yes: "0.42", no: "0.60" }, sell: { yes: "0.40", no: "0.58" }, lastTradePrice: "0.41" } }] };
  it("maps events to markets", () => {
    const [m] = eventToMarkets(ev);
    expect(m?.id).toBe("GEMI-BTC-HI83000");
    expect(m?.status).toBe("open");
    expect(m?.tags).toContain("crypto");
  });
  it("maps contract prices to a YES quote", () => {
    const q = contractToQuote("GEMI-BTC-HI83000", ev.contracts[0]);
    expect(q.yesAsk).toBe(0.42);
    expect(q.yesBid).toBe(0.40);
  });
  it("maps order status", () => {
    expect(mapOrder({ orderId: 1, status: "open", symbol: "s", side: "buy", outcome: "yes", quantity: "10", filledQuantity: "4", avgExecutionPrice: "0.41" }).status).toBe("partially_filled");
    expect(mapOrder({ orderId: 1, status: "filled", symbol: "s", side: "buy", outcome: "yes", quantity: "10", filledQuantity: "10" }).status).toBe("filled");
  });
});
