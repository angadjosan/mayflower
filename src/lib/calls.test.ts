import { describe, expect, it } from "vitest";
import { wantsCall } from "./calls";

describe("wantsCall", () => {
  it.each(["call me", "Call me!", "can we talk?", "yo call me now", "hop on a call", "ring me"])("yes: %s", (t) => expect(wantsCall(t)).toBe(true));
  it.each(["call me crazy but trump wins", "let's talk bitcoin", "can you call the race for me", "the chiefs win sunday"])("no: %s", (t) =>
    expect(wantsCall(t)).toBe(false));
});

describe("outboundCallPayload", () => {
  it("normal calls carry no first-message override; settlement calls carry the opener and reason", async () => {
    process.env.SESSION_SECRET ||= "test-secret";
    const { outboundCallPayload } = await import("./calls");
    const plain = outboundCallPayload("user_1", "+14155550100", { proposal_id: "" });
    expect(plain.conversation_initiation_client_data).not.toHaveProperty("conversation_config_override");
    // Every tool variable rides on every call, or ElevenLabs hangs up on pickup.
    expect(Object.keys(plain.conversation_initiation_client_data.dynamic_variables).sort()).toEqual(["call_opener", "call_reason", "call_token", "proposal_id", "result_summary"]);
    const s = outboundCallPayload("user_1", "+14155550100", { call_reason: "settlement_loss", call_opener: "BRO.", result_summary: "x" }, "BRO.");
    expect(s.conversation_initiation_client_data).toMatchObject({
      dynamic_variables: { call_reason: "settlement_loss", call_opener: "BRO." },
      conversation_config_override: { agent: { first_message: "BRO." } },
    });
  });
});
