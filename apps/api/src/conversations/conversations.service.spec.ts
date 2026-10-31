import { HttpException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { OmniCoreService } from "../omnicore/omnicore.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ConversationsService } from "./conversations.service";
import { ConversationsRepository } from "./conversations.repository";
import { KnowledgeRetrievalService } from "../knowledge/knowledge-retrieval.service";
import { KnowledgeContextService } from "../knowledge/knowledge-context.service";

describe("ConversationsService", () => {
  let service: ConversationsService;

  const repository = {
    createConversation: jest.fn(),
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    touchConversation: jest.fn(),
    createMessage: jest.fn(),
    beginUserMessageRequest: jest.fn(),
    assertUserMessageRequest: jest.fn().mockResolvedValue(undefined),
    heartbeatUserMessageRequest: jest.fn().mockResolvedValue(undefined),
    markUserMessageRequestRetryable: jest.fn().mockResolvedValue(undefined),
    publishAssistantMessage: jest.fn(),
    persistIncompleteAssistantAttempt: jest.fn().mockResolvedValue(undefined),
    listMessages: jest.fn(),
    renameConversation: jest.fn(),
    deleteConversation: jest.fn(),
    getLastMessage: jest.fn(),
    deleteMessage: jest.fn(),
  };
  const workspaces = { getById: jest.fn() };
  const omniCore = { execute: jest.fn(), executeStream: jest.fn() };
  const knowledgeRetrieval = { retrieve: jest.fn(), validateSources: jest.fn(), assertLeases: jest.fn().mockResolvedValue(undefined), renewLeases: jest.fn().mockResolvedValue(true), releaseLeases: jest.fn().mockResolvedValue(undefined) };
  const knowledgeContext = { build: jest.fn() };

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
    knowledgeRetrieval.retrieve.mockResolvedValue([]);
    knowledgeRetrieval.validateSources.mockResolvedValue([]);
    repository.beginUserMessageRequest.mockImplementation(async (input: Record<string, unknown>) => ({
      userMessage: await repository.createMessage(input),
      ...(input.requestId ? { requestId: input.requestId, leaseId: "lease" } : {}),
    }));
    repository.publishAssistantMessage.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "published-assistant", conversationId: input.conversationId, role: "assistant", content: input.content,
      createdAt: "2026-01-01T00:00:01.000Z", status: input.status ?? "complete",
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: ConversationsRepository, useValue: repository },
        { provide: WorkspacesService, useValue: workspaces },
        { provide: OmniCoreService, useValue: omniCore },
        { provide: KnowledgeRetrievalService, useValue: knowledgeRetrieval },
        { provide: KnowledgeContextService, useValue: knowledgeContext },
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

    it("keeps retrieval disabled by default, preserves the original prompt, and marks new responses NO_KNOWLEDGE", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);
      omniCore.execute.mockResolvedValue({ ...omniCoreResult, text: "Literal [S1]" });
      await service.sendMessage("user_1", "workspace_1", conversation.id, "Question");
      expect(knowledgeRetrieval.retrieve).not.toHaveBeenCalled();
      expect(omniCore.execute).toHaveBeenCalledWith("Question");
      expect(repository.createMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
        content: "Literal [S1]", knowledge: { grounding: "NO_KNOWLEDGE", citations: [] },
      }));
    });

    it("propagates read-lease loss to non-streaming model execution, waits for provider abort, and permits a safe retry", async () => {
      jest.useFakeTimers();
      try {
        const requestId = "f810393f-395b-4319-8d40-fdd578b96934";
        const source = {
          sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.txt",
          generationId: "generation-1", chunkId: "chunk-1", chunkIndex: 0, text: "leased context", score: 0.9,
        };
        const lease = { id: "read-lease-1", workspaceId: "workspace_1", fileId: "file_1", generationId: "generation-1" };
        knowledgeRetrieval.retrieve.mockResolvedValue({ sources: [source], leases: [lease] });
        knowledgeContext.build.mockReturnValue({ prompt: "user question plus leased context", sources: [{ label: "S1", source }] });
        knowledgeRetrieval.renewLeases.mockResolvedValue(false);
        repository.createMessage.mockResolvedValue(userMessage);

        let providerSignal: AbortSignal | undefined;
        let signalSeen!: () => void;
        const executionStarted = new Promise<void>((resolve) => { signalSeen = resolve; });
        let rejectProvider!: (error: unknown) => void;
        const providerOperation = new Promise<never>((_resolve, reject) => { rejectProvider = reject; });
        omniCore.execute.mockImplementation((_prompt: string, options?: { signal?: AbortSignal }) => {
          providerSignal = options?.signal;
          signalSeen();
          return providerOperation;
        });

        const firstAttempt = service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true, requestId);
        const firstAttemptRejected = expect(firstAttempt).rejects.toBeDefined();
        await executionStarted;
        expect(providerSignal).toBeInstanceOf(AbortSignal);
        expect(providerSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(30_000);
        expect(providerSignal?.aborted).toBe(true);
        // The service keeps the read lease until the provider operation itself
        // terminates; merely aborting a signal or racing the outer promise is
        // not treated as completed cleanup.
        expect(knowledgeRetrieval.releaseLeases).not.toHaveBeenCalled();

        rejectProvider(new Error("provider observed abort"));
        await firstAttemptRejected;
        expect(knowledgeRetrieval.releaseLeases).toHaveBeenCalledWith([lease]);
        expect(repository.publishAssistantMessage).not.toHaveBeenCalled();

        knowledgeRetrieval.renewLeases.mockResolvedValue(true);
        omniCore.execute.mockReset().mockResolvedValue(omniCoreResult);
        await expect(service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true, requestId))
          .resolves.toMatchObject({ assistantMessage: { content: omniCoreResult.text } });
        expect(repository.beginUserMessageRequest).toHaveBeenCalledTimes(2);
        expect(repository.publishAssistantMessage).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("uses bounded retrieved context and persists only validated source-label citations", async () => {
      const source = {
        sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.pdf", generationId: "gen_1",
        chunkId: "chunk_1", chunkIndex: 0, text: "The policy is 30 days.", score: 0.88, pageNumbers: [4],
      };
      knowledgeRetrieval.retrieve.mockResolvedValue([source]);
      knowledgeContext.build.mockReturnValue({ prompt: "bounded protected context", sources: [{ label: "S1", source }] });
      knowledgeRetrieval.validateSources.mockResolvedValue([source]);
      omniCore.execute.mockResolvedValue({ ...omniCoreResult, text: "The policy is 30 days [S1]. Unknown [S9]." });
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true);

      expect(knowledgeRetrieval.retrieve).toHaveBeenCalledWith("user_1", "workspace_1", "Question");
      expect(knowledgeContext.build).toHaveBeenCalledWith("Question", [source]);
      expect(omniCore.execute).toHaveBeenCalledWith("bounded protected context");
      expect(repository.createMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: "user", knowledgeRequested: true }));
      expect(repository.createMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
        content: "The policy is 30 days [S1]. Unknown .",
        knowledge: { grounding: "SOURCE_REFERENCED", citations: [{
          id: "chunk_1", sourceId: "S1", fileId: "file_1", fileName: "guide.pdf", chunkId: "chunk_1", chunkIndex: 0,
          pageNumbers: [4], retrievalScore: 0.88, excerpt: "The policy is 30 days.", excerptKind: "GENERAL_SOURCE_EXCERPT",
        }] },
      }));
    });

    it.each([
      "The policy lasts 90 days [S1].",
      "The weather is sunny [S1].",
      'The policy lasts 30 days and the source says "The policy lasts 30 days." [S1].',
      'The policy lasts 90 days, as shown in "an invented quotation" [S1] (fake.pdf, page 999).',
    ])("does not claim semantic grounding for a contradicted, unrelated, or fabricated quotation response: %s", async (modelText) => {
      const source = {
        sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.pdf", generationId: "gen_1",
        chunkId: "chunk_1", chunkIndex: 0, text: "The policy lasts 30 days.", score: 0.88, pageNumbers: [4],
      };
      knowledgeRetrieval.retrieve.mockResolvedValue([source]);
      knowledgeContext.build.mockReturnValue({ prompt: "bounded protected context", sources: [{ label: "S1", source }] });
      knowledgeRetrieval.validateSources.mockResolvedValue([source]);
      omniCore.execute.mockResolvedValue({ ...omniCoreResult, text: `${modelText} [S1]` });
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true);

      const assistantInput = repository.createMessage.mock.calls[1]?.[0] as { content: string; knowledge: { grounding: string; citations: Array<Record<string, unknown>> } };
      expect(assistantInput.knowledge.grounding).toBe("SOURCE_REFERENCED");
      expect(assistantInput.knowledge.grounding).not.toBe("GROUNDED");
      expect(assistantInput.knowledge.grounding).not.toBe("PARTIALLY_GROUNDED");
      expect(assistantInput.content).toContain("[S1]");
      expect(assistantInput.knowledge.citations).toEqual([expect.objectContaining({
        fileName: "guide.pdf", pageNumbers: [4], excerpt: "The policy lasts 30 days.", excerptKind: "GENERAL_SOURCE_EXCERPT",
      })]);
      expect(JSON.stringify(assistantInput.knowledge.citations)).not.toContain("fake.pdf");
      expect(JSON.stringify(assistantInput.knowledge.citations)).not.toContain("invented quotation");
    });

    it.each(["deleted source", "inactive generation", "cross-workspace source"])("does not cite an inaccessible %s", async () => {
      const source = { sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.pdf", generationId: "gen_1", chunkId: "chunk_1", chunkIndex: 0, text: "The policy lasts 30 days.", score: 0.88 };
      knowledgeRetrieval.retrieve.mockResolvedValue([source]);
      knowledgeContext.build.mockReturnValue({ prompt: "bounded protected context", sources: [{ label: "S1", source }] });
      knowledgeRetrieval.validateSources.mockResolvedValue([]);
      omniCore.execute.mockResolvedValue({ ...omniCoreResult, text: "The policy lasts 30 days [S1]." });
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);
      await service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true);
      expect(repository.createMessage.mock.calls[1]?.[0]).toMatchObject({ knowledge: { grounding: "NOT_GROUNDED", citations: [] } });
    });

    it("deduplicates repeated valid source labels and drops unknown labels", async () => {
      const source = {
        sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.pdf", generationId: "gen_1",
        chunkId: "chunk_1", chunkIndex: 0, text: "The policy lasts 30 days.", score: 0.88,
      };
      knowledgeRetrieval.retrieve.mockResolvedValue([source]);
      knowledgeContext.build.mockReturnValue({ prompt: "bounded protected context", sources: [{ label: "S1", source }] });
      knowledgeRetrieval.validateSources.mockResolvedValue([source]);
      omniCore.execute.mockResolvedValue({ ...omniCoreResult, text: "A [S1] B [S1] C [S99]." });
      repository.createMessage.mockResolvedValueOnce(userMessage).mockResolvedValueOnce(assistantMessage);

      await service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true);

      const assistantInput = repository.createMessage.mock.calls[1]?.[0] as { content: string; knowledge: { citations: unknown[] } };
      expect(assistantInput.content).toBe("A [S1] B [S1] C .");
      expect(assistantInput.knowledge.citations).toHaveLength(1);
    });

    it("propagates retrieval infrastructure failures after persisting the user turn without generating or citing", async () => {
      repository.createMessage.mockResolvedValueOnce(userMessage);
      knowledgeRetrieval.retrieve.mockRejectedValue(new Error("private database detail"));
      await expect(service.sendMessage("user_1", "workspace_1", conversation.id, "Question", true)).rejects.toThrow("private database detail");
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(omniCore.execute).not.toHaveBeenCalled();
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
        knowledge: { grounding: "NO_KNOWLEDGE", citations: [] },
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

    it("keeps split streaming source labels bounded and persists citations only for validated labels", async () => {
      const source = {
        sourceId: "source-a", workspaceId: "workspace_1", fileId: "file_1", fileName: "guide.pdf", generationId: "gen_1",
        chunkId: "chunk_1", chunkIndex: 0, text: "Supported fact.", score: 0.9,
      };
      knowledgeRetrieval.retrieve.mockResolvedValue([source]);
      knowledgeContext.build.mockReturnValue({ prompt: "protected", sources: [{ label: "S1", source }] });
      knowledgeRetrieval.validateSources.mockResolvedValue([source]);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["Supported [S", "1] and [S9]", "."])));
      repository.createMessage.mockImplementation(async (input: { role: string; content: string; knowledge?: unknown }) => ({
        ...(input.role === "assistant" ? completeAssistantMessage : userMessage), content: input.content,
        ...(input.knowledge ? { knowledge: input.knowledge } : {}),
      } as never));

      const events = await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, true));
      expect(omniCore.executeStream).toHaveBeenCalledWith("protected", expect.any(Object));
      expect(events.filter((event) => event.event === "delta").map((event) => event.event === "delta" ? event.data.text : "").join(""))
        .toBe("Supported [S1] and .");
      expect(repository.createMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
        content: "Supported [S1] and .",
        knowledge: { grounding: "SOURCE_REFERENCED", citations: [expect.objectContaining({ sourceId: "S1", chunkId: "chunk_1", excerptKind: "GENERAL_SOURCE_EXCERPT" })] },
      }));
    });

    it("emits the persisted user turn and a safe retrieval error without invoking generation", async () => {
      const retrievalError = new HttpException({ code: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", message: "Knowledge search is temporarily unavailable." }, 503);
      knowledgeRetrieval.retrieve.mockRejectedValue(retrievalError);
      repository.createMessage.mockResolvedValueOnce(userMessage);
      const events = await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, true));
      expect(events).toEqual([
        { event: "start", data: { userMessage, assistantExpected: false } },
        { event: "error", data: { code: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", message: "Knowledge search is temporarily unavailable.", assistantMessagePersisted: false, retryable: true } },
      ]);
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(omniCore.executeStream).not.toHaveBeenCalled();
    });

    it("reuses the persisted user turn on a retrieval retry with the same request ID", async () => {
      const requestId = "8c4c3b0c-2395-4b7a-92ab-0f0bd3e3cc05";
      const persistedUser = { ...userMessage, requestId };
      repository.beginUserMessageRequest.mockResolvedValue({ userMessage: persistedUser, requestId, leaseId: "attempt-1" });
      knowledgeRetrieval.retrieve.mockRejectedValueOnce(new HttpException({ code: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", message: "Retry" }, 503)).mockResolvedValueOnce([]);
      omniCore.executeStream.mockResolvedValue(streamResult(fakeStream(["Answer"]))) ;
      await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, true, requestId));
      repository.beginUserMessageRequest.mockResolvedValue({ userMessage: persistedUser, requestId, leaseId: "attempt-2" });
      await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, true, requestId));
      expect(repository.beginUserMessageRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId, role: "user" }));
      expect(repository.beginUserMessageRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId, role: "user" }));
      expect(repository.createMessage.mock.calls.filter(([input]) => input.role === "user")).toHaveLength(0);
      expect(repository.publishAssistantMessage).toHaveBeenCalledTimes(1);
      expect(repository.createMessage.mock.calls.filter(([input]) => input.role === "assistant")).toHaveLength(0);
    });

    it("keeps partial stream output incomplete and retries the same user turn to one complete response", async () => {
      const requestId = "d744efc8-f4d2-4a71-8c72-2997776c61ad";
      const persistedUser = { ...userMessage, requestId };
      repository.beginUserMessageRequest
        .mockResolvedValueOnce({ userMessage: persistedUser, requestId, leaseId: "attempt-a" })
        .mockResolvedValueOnce({ userMessage: persistedUser, requestId, leaseId: "attempt-b" });
      const providerError = new HttpException({ code: "PROVIDER_UNAVAILABLE", message: "Unavailable" }, 503);
      omniCore.executeStream
        .mockResolvedValueOnce(streamResult(fakeFailingStream(["partial answer"], providerError)))
        .mockResolvedValueOnce(streamResult(fakeStream(["complete answer"])));

      const failed = await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, false, requestId));
      expect(failed.some((event) => event.event === "delta" && event.data.text === "partial answer")).toBe(true);
      expect(failed.some((event) => event.event === "done")).toBe(false);
      expect(repository.persistIncompleteAssistantAttempt).toHaveBeenCalledWith(expect.objectContaining({ content: "partial answer", status: "incomplete" }), requestId, "attempt-a");

      const retried = await collect(service.sendMessageStream("user_1", "workspace_1", conversation.id, "Question", new AbortController().signal, false, requestId));
      expect(retried.some((event) => event.event === "done")).toBe(true);
      expect(repository.publishAssistantMessage).toHaveBeenCalledTimes(1);
      expect(repository.publishAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "complete answer", status: "complete" }), requestId, "attempt-b");
      expect(repository.markUserMessageRequestRetryable).toHaveBeenCalledWith(persistedUser.id, requestId, "attempt-a");
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
        knowledge: { grounding: "NO_KNOWLEDGE", citations: [] },
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
        knowledge: { grounding: "NO_KNOWLEDGE", citations: [] },
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
