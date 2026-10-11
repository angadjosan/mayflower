import { describe, it, expect } from "vitest";
import { parseInboundText, dmChatGuid, splitMessage } from "./bluebubbles";
import { signApprovalLink, verifyApprovalLink } from "./approval-links";

describe("parseInboundText", () => {
  const base = { type: "new-message", data: { guid: "g1", text: "hi", handle: { address: "+15551234567", service: "iMessage" }, isFromMe: false, itemType: 0, associatedMessageGuid: null, dateCreated: 1760200000000, chats: [{ guid: "iMessage;-;+15551234567", style: 45 }] } };
  it("accepts a fresh inbound DM", () => {
    expect(parseInboundText(base)).toMatchObject({ externalId: "g1", text: "hi", fromHandle: "+15551234567", chatGuid: "iMessage;-;+15551234567" });
  });
  it("ignores own messages, reactions, group chats, other events", () => {
    expect(parseInboundText({ ...base, data: { ...base.data, isFromMe: true } })).toBeNull();
    expect(parseInboundText({ ...base, data: { ...base.data, associatedMessageGuid: "x" } })).toBeNull();
    expect(parseInboundText({ ...base, data: { ...base.data, chats: [{ guid: "iMessage;+;chat1" }] } })).toBeNull();
    expect(parseInboundText({ type: "typing-indicator", data: {} })).toBeNull();
  });
  it("builds DM guids", () => {
    expect(dmChatGuid("(555) 123-4567")).toBe("iMessage;-;+15551234567");
  });
  it("splits long messages on paragraphs", () => {
    expect(splitMessage("a".repeat(900) + "\n\n" + "b".repeat(900), 1500)).toHaveLength(2);
  });
});

describe("approval links", () => {
  it("round-trips and rejects tampering/expiry", () => {
    const p = { proposalId: "p1", version: 1, bindingHash: "h", userId: "u", exp: Math.floor(Date.now() / 1000) + 60 };
    const t = signApprovalLink(p, "s");
    expect(verifyApprovalLink(t, "s")).toEqual(p);
    expect(verifyApprovalLink(t, "wrong")).toBeNull();
    expect(verifyApprovalLink(t + "x", "s")).toBeNull();
    expect(verifyApprovalLink(signApprovalLink({ ...p, exp: 1 }, "s"), "s")).toBeNull();
  });
});
