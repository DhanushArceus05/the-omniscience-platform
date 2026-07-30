import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

describe("ConversationsController", () => {
  let controller: ConversationsController;
  const conversationsService = {
    createConversation: jest.fn(),
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    listMessages: jest.fn(),
    sendMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: conversationsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConversationsController>(ConversationsController);
  });

  it("create() delegates to ConversationsService with the caller's own id and the workspace id, and wraps the result", async () => {
    conversationsService.createConversation.mockResolvedValue({
      id: "665f1c2b9a4e8f0012345678",
      workspaceId: "workspace_1",
      title: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await controller.create(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      {},
    );

    expect(conversationsService.createConversation).toHaveBeenCalledWith("user_1", "workspace_1");
    expect(result).toEqual({
      success: true,
      data: {
        id: "665f1c2b9a4e8f0012345678",
        workspaceId: "workspace_1",
        title: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("list() delegates to ConversationsService with the caller's own id, the workspace id, and the parsed query", async () => {
    conversationsService.listConversations.mockResolvedValue({ conversations: [], nextCursor: null });

    const result = await controller.list(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      { limit: 10 },
    );

    expect(conversationsService.listConversations).toHaveBeenCalledWith("user_1", "workspace_1", {
      limit: 10,
    });
    expect(result).toEqual({ success: true, data: { conversations: [], nextCursor: null } });
  });

  it("getById() delegates to ConversationsService with the caller's own id, the workspace id, and the conversation id", async () => {
    conversationsService.getConversation.mockResolvedValue({
      id: "665f1c2b9a4e8f0012345678",
      workspaceId: "workspace_1",
      title: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await controller.getById(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
    );

    expect(conversationsService.getConversation).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
    );
    expect(result.success).toBe(true);
    expect(result.data.id).toBe("665f1c2b9a4e8f0012345678");
  });

  it("listMessages() delegates to ConversationsService with the caller's own id, workspace id, conversation id, and the parsed query", async () => {
    conversationsService.listMessages.mockResolvedValue({ messages: [], nextCursor: null });

    const result = await controller.listMessages(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      { limit: 10 },
    );

    expect(conversationsService.listMessages).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      { limit: 10 },
    );
    expect(result).toEqual({ success: true, data: { messages: [], nextCursor: null } });
  });

  it("sendMessage() delegates to ConversationsService with the caller's own id, workspace id, conversation id, and the message content", async () => {
    const userMessage = {
      id: "665f1c2b9a4e8f0012345679",
      conversationId: "665f1c2b9a4e8f0012345678",
      role: "user",
      content: "Hello",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const assistantMessage = {
      id: "665f1c2b9a4e8f001234567a",
      conversationId: "665f1c2b9a4e8f0012345678",
      role: "assistant",
      content: "Hi there!",
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    conversationsService.sendMessage.mockResolvedValue({ userMessage, assistantMessage });

    const result = await controller.sendMessage(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      { content: "Hello" },
    );

    expect(conversationsService.sendMessage).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      "Hello",
    );
    expect(result).toEqual({ success: true, data: { userMessage, assistantMessage } });
  });
});
