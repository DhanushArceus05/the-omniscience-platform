import { describe, expect, it } from "vitest";
import {
  conversationIdParamSchema,
  createConversationRequestSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  renameConversationRequestSchema,
  sendMessageRequestSchema,
} from "./conversations";

describe("createConversationRequestSchema", () => {
  it("accepts an empty payload", () => {
    expect(createConversationRequestSchema.parse({})).toEqual({});
  });

  it("rejects any field at all, including a title", () => {
    expect(() => createConversationRequestSchema.parse({ title: "My conversation" })).toThrow();
  });

  it("rejects an unrelated unknown field", () => {
    expect(() => createConversationRequestSchema.parse({ workspaceId: "someone-else" })).toThrow();
  });
});

describe("conversationIdParamSchema", () => {
  it("accepts a valid 24-character hex ObjectId", () => {
    expect(conversationIdParamSchema.parse("665f1c2b9a4e8f0012345678")).toBe(
      "665f1c2b9a4e8f0012345678",
    );
  });

  it("accepts an uppercase-hex ObjectId", () => {
    expect(conversationIdParamSchema.parse("665F1C2B9A4E8F0012345678")).toBe(
      "665F1C2B9A4E8F0012345678",
    );
  });

  it("rejects a too-short id", () => {
    expect(() => conversationIdParamSchema.parse("665f1c2b9a4e8f")).toThrow();
  });

  it("rejects a too-long id", () => {
    expect(() => conversationIdParamSchema.parse("665f1c2b9a4e8f00123456789abc")).toThrow();
  });

  it("rejects a non-hex id", () => {
    expect(() => conversationIdParamSchema.parse("not-a-valid-object-id-zzzz")).toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => conversationIdParamSchema.parse("")).toThrow();
  });
});

describe("listConversationsQuerySchema", () => {
  it("accepts an empty query, leaving limit/cursor undefined", () => {
    expect(listConversationsQuerySchema.parse({})).toEqual({});
  });

  it("coerces a string limit to a number", () => {
    expect(listConversationsQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("rejects a limit above the safe maximum", () => {
    expect(() => listConversationsQuerySchema.parse({ limit: "51" })).toThrow();
  });

  it("rejects unknown query fields", () => {
    expect(() => listConversationsQuerySchema.parse({ sort: "oldest" })).toThrow();
  });
});

describe("listMessagesQuerySchema", () => {
  it("accepts an empty query, leaving limit/cursor undefined", () => {
    expect(listMessagesQuerySchema.parse({})).toEqual({});
  });

  it("coerces a string limit to a number", () => {
    expect(listMessagesQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("rejects a limit above the safe maximum", () => {
    expect(() => listMessagesQuerySchema.parse({ limit: "51" })).toThrow();
  });

  it("rejects unknown query fields", () => {
    expect(() => listMessagesQuerySchema.parse({ sort: "oldest" })).toThrow();
  });
});

describe("sendMessageRequestSchema", () => {
  it("accepts a valid payload, trimming content", () => {
    expect(sendMessageRequestSchema.parse({ content: "  Hello, OmniCore.  " })).toEqual({
      content: "Hello, OmniCore.",
    });
  });

  it("rejects a missing content field", () => {
    expect(() => sendMessageRequestSchema.parse({})).toThrow();
  });

  it("rejects content that is empty after trimming", () => {
    expect(() => sendMessageRequestSchema.parse({ content: "   " })).toThrow();
  });

  it("rejects content longer than 8000 characters, identical to omniCoreExecuteRequestSchema's own limit", () => {
    expect(() => sendMessageRequestSchema.parse({ content: "a".repeat(8_001) })).toThrow();
  });

  it("accepts content at exactly the 8000-character limit", () => {
    const content = "a".repeat(8_000);
    expect(sendMessageRequestSchema.parse({ content })).toEqual({ content });
  });

  it("rejects unknown fields", () => {
    expect(() => sendMessageRequestSchema.parse({ content: "Hello", role: "assistant" })).toThrow();
  });
});

describe("renameConversationRequestSchema", () => {
  it("accepts a valid payload, trimming the title", () => {
    expect(renameConversationRequestSchema.parse({ title: "  My conversation  " })).toEqual({
      title: "My conversation",
    });
  });

  it("rejects a missing title field", () => {
    expect(() => renameConversationRequestSchema.parse({})).toThrow();
  });

  it("rejects a title that is empty after trimming", () => {
    expect(() => renameConversationRequestSchema.parse({ title: "   " })).toThrow();
  });

  it("rejects a title longer than 200 characters", () => {
    expect(() => renameConversationRequestSchema.parse({ title: "a".repeat(201) })).toThrow();
  });

  it("accepts a title at exactly the 200-character limit", () => {
    const title = "a".repeat(200);
    expect(renameConversationRequestSchema.parse({ title })).toEqual({ title });
  });

  it("rejects unknown fields", () => {
    expect(() =>
      renameConversationRequestSchema.parse({ title: "My conversation", pinned: true }),
    ).toThrow();
  });
});
