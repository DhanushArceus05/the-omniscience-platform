import { HttpException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { OmniCoreService } from "../omnicore/omnicore.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ConversationsService } from "./conversations.service";
import { ConversationsRepository } from "./conversations.repository";

describe("ConversationsService", () => {
  let service: ConversationsService;

  const repository = {
    createConversation: jest.fn(),
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    touchConversation: jest.fn(),
    createMessage: jest.fn(),
    listMessages: jest.fn(),
    renameConversation: jest.fn(),
    deleteConversation: jest.fn(),
    getLastMessage: jest.fn(),
    deleteMessage: jest.fn(),
  };
  const workspaces = { getById: jest.fn() };
  const omniCore = { execute: jest.fn(), executeStream: jest.fn() };

  const workspace = {
    id: "workspace_1",
    name: "Research",
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const conversation = {
    id: "665f1c2b9a4e8f0012345678",
    workspaceId: "workspace_1",
    title: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    workspaces.getById.mockResolvedValue(workspace);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: ConversationsRepository, useValue: repository },
        { provide: WorkspacesService, useValue: workspaces },
        { provide: OmniCoreService, useValue: omniCore },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  describe("createConversation", () => {
    it("verifies workspace ownership before creating a conversation", async () => {
      repository.createConversation.mockResolvedValue(conversation);

      const result = await service.createConversation("user_1", "workspace_1");

      expect(workspaces.getById).toHaveBeenCalledWith("user_1", "workspace_1");
      expect(repository.createConversation).toHaveBeenCalledWith("user_1", "workspace_1");
      expect(result).toEqual(conversation);
    });

    it("propagates WORKSPACE_NOT_FOUND without ever creating a conversation", async () => {
      workspaces.getById.mockRejectedValue(
        new NotFoundException({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found." }),
      );

      await expect(service.createConversation("user_1", "foreign-workspace")).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.createConversation).not.toHaveBeenCalled();
    });
  });

  describe("getConversation", () => {
    it("returns the caller's own conversation", async () => {
      repository.getConversation.mockResolvedValue(conversation);

      const result = await service.getConversation("user_1", "workspace_1", conversation.id);

      expect(result).toEqual(conversation);
    });

    it("throws the identical CONVERSATION_NOT_FOUND for a missing conversation", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.getConversation("user_1", "workspace_1", "665f1c2b9a4e8f0012345678"),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
    });

    it("throws the identical CONVERSATION_NOT_FOUND for another owner's conversation (repository returns null either way)", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.getConversation("user_2", "workspace_1", conversation.id),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
    });

    it("throws CONVERSATION_NOT_FOUND — never WORKSPACE_NOT_FOUND — for a workspace the caller doesn't own at all, and never calls WorkspacesService", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.getConversation("user_2", "someone-elses-workspace", conversation.id),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      expect(workspaces.getById).not.toHaveBeenCalled();
    });
  });

  describe("renameConversation", () => {
    it("resolves ownership first, then renames via the repository", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      const renamed = { ...conversation, title: "My renamed conversation" };
      repository.renameConversation.mockResolvedValue(renamed);

      const result = await service.renameConversation(
        "user_1",
        "workspace_1",
        conversation.id,
        "My renamed conversation",
      );

      expect(repository.getConversation).toHaveBeenCalledWith("user_1", "workspace_1", conversation.id);
      expect(repository.renameConversation).toHaveBeenCalledWith(
        "user_1",
        "workspace_1",
        conversation.id,
        "My renamed conversation",
      );
      expect(result).toEqual(renamed);
    });

    it("throws CONVERSATION_NOT_FOUND without ever calling the repository's rename, for a conversation the caller doesn't own", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.renameConversation("user_2", "workspace_1", conversation.id, "Hijacked title"),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      expect(repository.renameConversation).not.toHaveBeenCalled();
    });

    it("throws CONVERSATION_NOT_FOUND if the repository's rename itself returns null (defensive fallback, e.g. a concurrent delete)", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.renameConversation.mockResolvedValue(null);

      await expect(
        service.renameConversation("user_1", "workspace_1", conversation.id, "New title"),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
    });
  });

  describe("deleteConversation", () => {
    it("resolves ownership first, then deletes via the repository", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.deleteConversation.mockResolvedValue(true);

      await service.deleteConversation("user_1", "workspace_1", conversation.id);

      expect(repository.getConversation).toHaveBeenCalledWith("user_1", "workspace_1", conversation.id);
      expect(repository.deleteConversation).toHaveBeenCalledWith("user_1", "workspace_1", conversation.id);
    });

    it("throws CONVERSATION_NOT_FOUND without ever calling the repository's delete, for a conversation the caller doesn't own", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.deleteConversation("user_2", "workspace_1", conversation.id),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      expect(repository.deleteConversation).not.toHaveBeenCalled();
    });

    it("throws CONVERSATION_NOT_FOUND if the repository's delete itself returns false (defensive fallback, e.g. a concurrent delete)", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.deleteConversation.mockResolvedValue(false);

      await expect(
        service.deleteConversation("user_1", "workspace_1", conversation.id),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
    });
  });

  describe("sendMessage", () => {
    const userMessage = {
      id: "665f1c2b9a4e8f0012345679",
      conversationId: conversation.id,
      role: "user" as const,
      content: "Hello, OmniCore.",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const assistantMessage = {
      id: "665f1c2b9a4e8f001234567a",
      conversationId: conversation.id,
      role: "assistant" as const,
      content: "Hello! How can I help?",
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    const omniCoreResult = {
      planId: "plan_1",
      intent: "simple-generation" as const,
      matchedRuleId: "fast-rule.simple-generation",
      confidence: 0.9,
      text: "Hello! How can I help?",
      providerId: "anthropic" as const,
      modelId: "claude-sonnet-5" as const,
      taskPlan: { taskPlanId: "task-plan_1" } as never,
      execution: { taskPlanId: "task-plan_1" } as never,
    };

    beforeEach(() => {
      repository.getConversation.mockResolvedValue(conversation);
    });

    it("persists the user message before calling OmniCoreService.execute()", async () => {
      const callOrder: string[] = [];
      repository.createMessage.mockImplementation(async (input: { role: string }) => {
        callOrder.push(`createMessage:${input.role}`);
        return input.role === "user" ? userMessage : assistantMessage;
      });
      omniCore.execute.mockImplementation(async () => {
        callOrder.push("omniCore.execute");
        return omniCoreResult;
      });

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Hello, OmniCore.");

      expect(callOrder).toEqual(["createMessage:user", "omniCore.execute", "createMessage:assistant"]);
    });

    it("calls OmniCoreService.execute() directly, not through HTTP", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);
      omniCore.execute.mockResolvedValue(omniCoreResult);

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Hello, OmniCore.");

      expect(omniCore.execute).toHaveBeenCalledWith("Hello, OmniCore.");
    });

    it("persists only the trimmed OmniCore metadata on the assistant message", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);
      omniCore.execute.mockResolvedValue(omniCoreResult);

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Hello, OmniCore.");

      expect(repository.createMessage).toHaveBeenNthCalledWith(2, {
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: "assistant",
        content: "Hello! How can I help?",
        omniCore: {
          planId: "plan_1",
          intent: "simple-generation",
          matchedRuleId: "fast-rule.simple-generation",
          confidence: 0.9,
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
          taskPlanId: "task-plan_1",
        },
      });
    });

    it("returns both the user and assistant messages", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);
      omniCore.execute.mockResolvedValue(omniCoreResult);

      const result = await service.sendMessage(
        "user_1",
        "workspace_1",
        conversation.id,
        "Hello, OmniCore.",
      );

      expect(result).toEqual({ userMessage, assistantMessage });
    });

    it("keeps the user message persisted and never persists an assistant message when OmniCore execution fails", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage);
      const omniCoreError = new Error("AMBIGUOUS_INTENT");
      omniCore.execute.mockRejectedValue(omniCoreError);

      await expect(
        service.sendMessage("user_1", "workspace_1", conversation.id, "Hello, OmniCore."),
      ).rejects.toThrow(omniCoreError);

      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(repository.createMessage).toHaveBeenCalledWith({
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: "user",
        content: "Hello, OmniCore.",
      });
      expect(repository.touchConversation).not.toHaveBeenCalled();
    });

    it("throws CONVERSATION_NOT_FOUND before ever persisting a message for a foreign conversation", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.sendMessage("user_2", "workspace_1", conversation.id, "Hello, OmniCore."),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });

      expect(repository.createMessage).not.toHaveBeenCalled();
      expect(omniCore.execute).not.toHaveBeenCalled();
    });

    it("throws CONVERSATION_NOT_FOUND — never WORKSPACE_NOT_FOUND — when sending to another owner's conversation via a workspace the caller doesn't own", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.sendMessage("user_2", "someone-elses-workspace", conversation.id, "Hello, OmniCore."),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });

      expect(workspaces.getById).not.toHaveBeenCalled();
      expect(repository.createMessage).not.toHaveBeenCalled();
      expect(omniCore.execute).not.toHaveBeenCalled();
    });
  });

  describe("sendMessageStream — Phase 6 Step 2", () => {
    const userMessage = {
      id: "665f1c2b9a4e8f0012345679",
      conversationId: conversation.id,
      role: "user" as const,
      content: "Hello, OmniCore.",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "complete" as const,
    };
    const completeAssistantMessage = {
      id: "665f1c2b9a4e8f001234567a",
      conversationId: conversation.id,
      role: "assistant" as const,
      content: "Hello! How can I help?",
      createdAt: "2026-01-01T00:00:01.000Z",
      status: "complete" as const,
    };
    const incompleteAssistantMessage = {
      ...completeAssistantMessage,
      content: "Hello! How can",
      status: "incomplete" as const,
    };

    const omniCoreMetadata = {
      planId: "plan_1",
      intent: "simple-generation" as const,
      matchedRuleId: "fast-rule.simple-generation",
      confidence: 0.9,
      providerId: "anthropic" as const,
      modelId: "claude-sonnet-5" as const,
      taskPlanId: "task-plan_1",
    };

    function fakeStream(chunks: readonly string[]): AsyncIterable<string> {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    }

    function fakeFailingStream(
      chunksBeforeFailure: readonly string[],
      error: unknown,
    ): AsyncIterable<string> {
      return (async function* () {
        for (const chunk of chunksBeforeFailure) {
          yield chunk;
        }
        throw error;
      })();
    }

    function streamResult(textStream: AsyncIterable<string>): {
      planId: string;
      intent: "simple-generation";
      matchedRuleId: string;
      confidence: number;
      providerId: "anthropic";
      modelId: "claude-sonnet-5";
      taskPlan: { taskPlanId: string };
      textStream: AsyncIterable<string>;
    } {
      return {
        planId: omniCoreMetadata.planId,
        intent: omniCoreMetadata.intent,
        matchedRuleId: omniCoreMetadata.matchedRuleId,
        confidence: omniCoreMetadata.confidence,
        providerId: omniCoreMetadata.providerId,
        modelId: omniCoreMetadata.modelId,
        taskPlan: { taskPlanId: omniCoreMetadata.taskPlanId },
        textStream,
      };
    }

    async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
      const results: T[] = [];
      for await (const item of iterable) {
        results.push(item);
      }
      return results;
    }

    beforeEach(() => {
      repository.getConversation.mockResolvedValue(conversation);
    });

    it("persists the user message before calling OmniCoreService.executeStream()", async () => {
      const callOrder: string[] = [];
      repository.createMessage.mockImplementation(async (input: { role: string }) => {
        callOrder.push(`createMessage:${input.role}`);
        return input.role === "user" ? userMessage : completeAssistantMessage;
      });
      omniCore.executeStream.mockImplementation(async () => {
        callOrder.push("omniCore.executeStream");
        return streamResult(fakeStream(["Hello!"]));
      });
      const controller = new AbortController();

      await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          controller.signal,
        ),
      );

      expect(callOrder).toEqual([
        "createMessage:user",
        "omniCore.executeStream",
        "createMessage:assistant",
      ]);
    });

    it("forwards the caller's AbortSignal to OmniCoreService.executeStream()", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(completeAssistantMessage);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["hi"])));
      const controller = new AbortController();

      await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          controller.signal,
        ),
      );

      expect(omniCore.executeStream).toHaveBeenCalledWith("Hello, OmniCore.", {
        signal: controller.signal,
      });
    });

    it("yields start, then one delta per chunk in order, then done", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(completeAssistantMessage);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["Hel", "lo!"])));

      const events = await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      expect(events).toEqual([
        { event: "start", data: { userMessage } },
        { event: "delta", data: { text: "Hel" } },
        { event: "delta", data: { text: "lo!" } },
        { event: "done", data: { assistantMessage: completeAssistantMessage } },
      ]);
    });

    it("persists the accumulated text as a complete assistant message with trimmed OmniCore metadata, and touches the conversation", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(completeAssistantMessage);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["Hello", "!"])));

      await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      expect(repository.createMessage).toHaveBeenNthCalledWith(2, {
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: "assistant",
        content: "Hello!",
        omniCore: omniCoreMetadata,
        status: "complete",
      });
      expect(repository.touchConversation).toHaveBeenCalledWith(conversation.id, "Hello!");
    });

    it("persists accumulated non-empty text as incomplete, and yields a terminal error event, on a mid-stream provider error", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(incompleteAssistantMessage);
      const providerError = new HttpException(
        { code: "PROVIDER_RATE_LIMITED", message: "The provider is rate limiting requests." },
        429,
      );
      omniCore.executeStream.mockResolvedValue(
        streamResult(fakeFailingStream(["Hello! How can"], providerError)),
      );

      const events = await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      expect(events).toEqual([
        { event: "start", data: { userMessage } },
        { event: "delta", data: { text: "Hello! How can" } },
        {
          event: "error",
          data: { code: "PROVIDER_RATE_LIMITED", message: "The provider is rate limiting requests." },
        },
      ]);
      expect(repository.createMessage).toHaveBeenNthCalledWith(2, {
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: "assistant",
        content: "Hello! How can",
        omniCore: omniCoreMetadata,
        status: "incomplete",
      });
      expect(repository.createMessage).toHaveBeenCalledTimes(2);
      expect(repository.touchConversation).toHaveBeenCalledWith(conversation.id, "Hello! How can");
    });

    it("persists accumulated non-empty text as incomplete on cancellation (EXECUTION_CANCELLED), exactly like any other mid-stream failure", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(incompleteAssistantMessage);
      const cancelledError = new HttpException(
        { code: "EXECUTION_CANCELLED", message: "Execution was cancelled while streaming." },
        499,
      );
      omniCore.executeStream.mockResolvedValue(
        streamResult(fakeFailingStream(["partial "], cancelledError)),
      );

      const events = await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      expect(events.at(-1)).toEqual({
        event: "error",
        data: { code: "EXECUTION_CANCELLED", message: "Execution was cancelled while streaming." },
      });
      expect(repository.createMessage).toHaveBeenCalledTimes(2);
      expect(repository.createMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ status: "incomplete", content: "partial " }),
      );
    });

    it("never persists an assistant message, and never touches the conversation, when the failure happens before any text was accumulated", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage);
      const providerError = new HttpException(
        { code: "PROVIDER_UNAVAILABLE", message: "The provider is currently unavailable." },
        503,
      );
      omniCore.executeStream.mockResolvedValue(streamResult(fakeFailingStream([], providerError)));

      const events = await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      expect(events).toEqual([
        { event: "start", data: { userMessage } },
        {
          event: "error",
          data: { code: "PROVIDER_UNAVAILABLE", message: "The provider is currently unavailable." },
        },
      ]);
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(repository.touchConversation).not.toHaveBeenCalled();
    });

    it("normalizes a non-HttpException failure to a safe generic error event, never leaking the raw error message", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage);
      omniCore.executeStream.mockResolvedValue(
        streamResult(fakeFailingStream([], new Error("raw internal stack-trace-looking detail"))),
      );

      const events = await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      const errorEvent = events.at(-1) as { event: string; data: { code: string; message: string } };
      expect(errorEvent.event).toBe("error");
      expect(errorEvent.data.code).toBe("INTERNAL_ERROR");
      expect(errorEvent.data.message).not.toContain("raw internal stack-trace-looking detail");
    });

    it("keeps the user message persisted and yields no events at all when OmniCoreService.executeStream() itself fails before the first yield", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage);
      const planningError = new HttpException(
        { code: "AMBIGUOUS_INTENT", message: "The request is ambiguous." },
        422,
      );
      omniCore.executeStream.mockRejectedValue(planningError);

      const generator = service.sendMessageStream(
        "user_1",
        "workspace_1",
        conversation.id,
        "Hello, OmniCore.",
        new AbortController().signal,
      );

      await expect(generator.next()).rejects.toBe(planningError);
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(repository.createMessage).toHaveBeenCalledWith({
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: "user",
        content: "Hello, OmniCore.",
      });
    });

    it("throws CONVERSATION_NOT_FOUND before ever persisting a message or calling OmniCoreService for a foreign conversation", async () => {
      repository.getConversation.mockResolvedValue(null);

      const generator = service.sendMessageStream(
        "user_2",
        "workspace_1",
        conversation.id,
        "Hello, OmniCore.",
        new AbortController().signal,
      );

      await expect(generator.next()).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      expect(repository.createMessage).not.toHaveBeenCalled();
      expect(omniCore.executeStream).not.toHaveBeenCalled();
    });

    it("never persists more than one assistant message total, regardless of how the stream ends", async () => {
      repository.createMessage
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(completeAssistantMessage);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["Hello", "!"])));

      await collect(
        service.sendMessageStream(
          "user_1",
          "workspace_1",
          conversation.id,
          "Hello, OmniCore.",
          new AbortController().signal,
        ),
      );

      const assistantPersistCalls = repository.createMessage.mock.calls.filter(
        ([input]: [{ role: string }]) => input.role === "assistant",
      );
      expect(assistantPersistCalls).toHaveLength(1);
    });
  });

  describe("deleteLastMessage", () => {
    it("resolves ownership first, then delegates to the repository", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.deleteMessage.mockResolvedValue("deleted");

      await service.deleteLastMessage("user_1", "workspace_1", conversation.id, "message_1");

      expect(repository.getConversation).toHaveBeenCalledWith("user_1", "workspace_1", conversation.id);
      expect(repository.deleteMessage).toHaveBeenCalledWith(
        "user_1",
        "workspace_1",
        conversation.id,
        "message_1",
      );
    });

    it("throws CONVERSATION_NOT_FOUND without calling the repository's deleteMessage, for a conversation the caller doesn't own", async () => {
      repository.getConversation.mockResolvedValue(null);

      await expect(
        service.deleteLastMessage("user_2", "workspace_1", conversation.id, "message_1"),
      ).rejects.toMatchObject({
        response: { code: "CONVERSATION_NOT_FOUND" },
      });
      expect(repository.deleteMessage).not.toHaveBeenCalled();
    });

    it("maps a \"not_found\" repository outcome to MESSAGE_NOT_FOUND", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.deleteMessage.mockResolvedValue("not_found");

      await expect(
        service.deleteLastMessage("user_1", "workspace_1", conversation.id, "message_1"),
      ).rejects.toMatchObject({
        response: { code: "MESSAGE_NOT_FOUND" },
      });
    });

    it("maps a \"not_last\" repository outcome to MESSAGE_NOT_LAST", async () => {
      repository.getConversation.mockResolvedValue(conversation);
      repository.deleteMessage.mockResolvedValue("not_last");

      await expect(
        service.deleteLastMessage("user_1", "workspace_1", conversation.id, "message_1"),
      ).rejects.toMatchObject({
        response: { code: "MESSAGE_NOT_LAST" },
      });
    });
  });
});
