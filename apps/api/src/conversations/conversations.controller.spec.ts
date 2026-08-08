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
    sendMessageStream: jest.fn(),
    renameConversation: jest.fn(),
    deleteConversation: jest.fn(),
    deleteLastMessage: jest.fn(),
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

  it("rename() delegates to ConversationsService with the caller's own id, workspace id, conversation id, and the new title", async () => {
    conversationsService.renameConversation.mockResolvedValue({
      id: "665f1c2b9a4e8f0012345678",
      workspaceId: "workspace_1",
      title: "My renamed conversation",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await controller.rename(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      { title: "My renamed conversation" },
    );

    expect(conversationsService.renameConversation).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      "My renamed conversation",
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: "665f1c2b9a4e8f0012345678",
        workspaceId: "workspace_1",
        title: "My renamed conversation",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("remove() delegates to ConversationsService with the caller's own id, workspace id, and conversation id, and returns { deleted: true }", async () => {
    conversationsService.deleteConversation.mockResolvedValue(undefined);

    const result = await controller.remove(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
    );

    expect(conversationsService.deleteConversation).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
    );
    expect(result).toEqual({ success: true, data: { deleted: true } });
  });

  it("removeMessage() delegates to ConversationsService with the caller's own id, workspace id, conversation id, and message id, and returns { deleted: true }", async () => {
    conversationsService.deleteLastMessage.mockResolvedValue(undefined);

    const result = await controller.removeMessage(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      "665f1c2b9a4e8f0012345679",
    );

    expect(conversationsService.deleteLastMessage).toHaveBeenCalledWith(
      "user_1",
      "workspace_1",
      "665f1c2b9a4e8f0012345678",
      "665f1c2b9a4e8f0012345679",
    );
    expect(result).toEqual({ success: true, data: { deleted: true } });
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

  describe("sendMessageStream() — Phase 6 Step 2", () => {
    /** Minimal stand-in for Express's `Request`: only `.on`/`.off`, both jest mocks so a test can grab whatever handler the controller registered. */
    function makeFakeReq(): { on: jest.Mock; off: jest.Mock } {
      return { on: jest.fn(), off: jest.fn() };
    }

    /** Minimal stand-in for Express's `Response`: records every `write()` call verbatim (so a test can assert exact SSE framing) plus whether `writeHead`/`end` were called, with `writableEnded`/`destroyed` toggling accordingly. `on`/`off` are jest mocks, same as `makeFakeReq`'s, so a test can grab whichever of `req`'s or `res`'s `"close"` registration it needs. */
    function makeFakeRes(): {
      writeHead: jest.Mock;
      flushHeaders: jest.Mock;
      write: jest.Mock;
      end: jest.Mock;
      on: jest.Mock;
      off: jest.Mock;
      readonly writes: string[];
      readonly writableEnded: boolean;
      readonly destroyed: boolean;
    } {
      const writes: string[] = [];
      let ended = false;
      return {
        writeHead: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((chunk: string) => {
          writes.push(chunk);
          return true;
        }),
        end: jest.fn(() => {
          ended = true;
        }),
        on: jest.fn(),
        off: jest.fn(),
        get writes() {
          return writes;
        },
        get writableEnded() {
          return ended;
        },
        get destroyed() {
          return false;
        },
      };
    }

    function fakeGenerator<T>(items: readonly T[]): AsyncGenerator<T> {
      return (async function* () {
        for (const item of items) {
          yield item;
        }
      })();
    }

    it("opens SSE headers with the exact required values, then writes each event correctly framed, then ends the response", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      conversationsService.sendMessageStream.mockReturnValue(
        fakeGenerator([
          { event: "start", data: { userMessage: { id: "msg_1" } } },
          { event: "delta", data: { text: "Hel" } },
          { event: "delta", data: { text: "lo!" } },
          { event: "done", data: { assistantMessage: { id: "msg_2" } } },
        ]),
      );

      await controller.sendMessageStream(
        { sub: "user_1", email: "user@example.com" },
        "workspace_1",
        "conv_1",
        { content: "Hello" },
        req as unknown as Parameters<typeof controller.sendMessageStream>[4],
        res as unknown as Parameters<typeof controller.sendMessageStream>[5],
      );

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      expect(res.flushHeaders).toHaveBeenCalled();
      expect(res.writes).toEqual([
        `event: start\ndata: ${JSON.stringify({ userMessage: { id: "msg_1" } })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Hel" })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "lo!" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ assistantMessage: { id: "msg_2" } })}\n\n`,
      ]);
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it("calls ConversationsService.sendMessageStream with the caller's own id, workspace id, conversation id, content, and an AbortSignal", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      conversationsService.sendMessageStream.mockReturnValue(
        fakeGenerator([{ event: "start", data: { userMessage: {} } }]),
      );

      await controller.sendMessageStream(
        { sub: "user_1", email: "user@example.com" },
        "workspace_1",
        "conv_1",
        { content: "Hello" },
        req as unknown as Parameters<typeof controller.sendMessageStream>[4],
        res as unknown as Parameters<typeof controller.sendMessageStream>[5],
      );

      expect(conversationsService.sendMessageStream).toHaveBeenCalledWith(
        "user_1",
        "workspace_1",
        "conv_1",
        "Hello",
        expect.any(AbortSignal),
      );
    });

    it("registers a close handler on both req and res that aborts the same AbortSignal forwarded to ConversationsService.sendMessageStream", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      let capturedSignal: AbortSignal | undefined;
      conversationsService.sendMessageStream.mockImplementation(async function* (
        _ownerId: string,
        _workspaceId: string,
        _conversationId: string,
        _content: string,
        signal: AbortSignal,
      ) {
        capturedSignal = signal;
        yield { event: "start", data: { userMessage: {} } };
        yield { event: "done", data: { assistantMessage: {} } };
      });

      const promise = controller.sendMessageStream(
        { sub: "user_1", email: "user@example.com" },
        "workspace_1",
        "conv_1",
        { content: "hi" },
        req as unknown as Parameters<typeof controller.sendMessageStream>[4],
        res as unknown as Parameters<typeof controller.sendMessageStream>[5],
      );

      // `req.on("close", ...)`/`res.on("close", ...)` are this
      // controller method's very first statements — both have already
      // run synchronously by this point, before this test has awaited
      // anything at all.
      const reqCloseRegistration = req.on.mock.calls.find(([event]: [string]) => event === "close");
      const resCloseRegistration = res.on.mock.calls.find(([event]: [string]) => event === "close");
      expect(reqCloseRegistration).toBeDefined();
      expect(resCloseRegistration).toBeDefined();
      const [, onReqCloseHandler] = reqCloseRegistration as [string, () => void];
      const [, onResCloseHandler] = resCloseRegistration as [string, () => void];
      // Both `req` and `res` are wired to the exact same handler —
      // Node's own documented signal for "connection terminated before
      // the response completed" isn't consistently on one or the
      // other, so this method relies on whichever fires.
      expect(onReqCloseHandler).toBe(onResCloseHandler);

      onResCloseHandler();
      expect(capturedSignal?.aborted).toBe(true);

      await promise;
    });

    it("removes the close listener from both req and res once streaming completes normally", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      conversationsService.sendMessageStream.mockReturnValue(
        fakeGenerator([{ event: "start", data: { userMessage: {} } }]),
      );

      await controller.sendMessageStream(
        { sub: "user_1", email: "user@example.com" },
        "workspace_1",
        "conv_1",
        { content: "hi" },
        req as unknown as Parameters<typeof controller.sendMessageStream>[4],
        res as unknown as Parameters<typeof controller.sendMessageStream>[5],
      );

      const [, onCloseHandler] = req.on.mock.calls.find(([event]: [string]) => event === "close") as [
        string,
        () => void,
      ];
      expect(req.off).toHaveBeenCalledWith("close", onCloseHandler);
      expect(res.off).toHaveBeenCalledWith("close", onCloseHandler);
    });

    it("propagates a failure that happens before any event is yielded, without ever opening SSE headers — an ordinary HTTP error response", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      const planningError = { response: { code: "AMBIGUOUS_INTENT" } };
      // A plain object with `.next()` — not `async function*` — because
      // this mock never yields anything: the controller's very first
      // `await events.next()` is meant to reject immediately, before it
      // ever opens SSE headers. A generator function with no `yield` is
      // exactly that scenario, but is also flagged by the `require-yield`
      // lint rule; a hand-built object satisfies the one method the
      // controller actually calls in this path without ever being
      // declared as a generator.
      conversationsService.sendMessageStream.mockReturnValue({
        next: () => Promise.reject(planningError),
      });

      await expect(
        controller.sendMessageStream(
          { sub: "user_1", email: "user@example.com" },
          "workspace_1",
          "conv_1",
          { content: "hi" },
          req as unknown as Parameters<typeof controller.sendMessageStream>[4],
          res as unknown as Parameters<typeof controller.sendMessageStream>[5],
        ),
      ).rejects.toBe(planningError);

      expect(res.writeHead).not.toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
      // Regression check: a `finally` block that unconditionally calls
      // `res.end()` would implicitly flush a default `200` response
      // here (Node sends default headers on the first `end()`/`write()`
      // if `writeHead` was never called), before Nest's own exception
      // handling ever gets to set the real status — turning an ordinary
      // `404`/`422`/etc. into an incorrect `200` and crashing on "Cannot
      // set headers after they are sent". `res.end()` must stay
      // untouched for a failure that happened before headers ever
      // opened, so the thrown error can propagate to Nest unimpeded.
      expect(res.end).not.toHaveBeenCalled();
    });

    it("still ends the response and removes the close listener even when the generator itself throws mid-stream", async () => {
      const req = makeFakeReq();
      const res = makeFakeRes();
      const midStreamError = { response: { code: "PROVIDER_UNAVAILABLE" } };
      conversationsService.sendMessageStream.mockImplementation(async function* () {
        yield { event: "start", data: { userMessage: {} } };
        throw midStreamError;
      });

      await expect(
        controller.sendMessageStream(
          { sub: "user_1", email: "user@example.com" },
          "workspace_1",
          "conv_1",
          { content: "hi" },
          req as unknown as Parameters<typeof controller.sendMessageStream>[4],
          res as unknown as Parameters<typeof controller.sendMessageStream>[5],
        ),
      ).rejects.toBe(midStreamError);

      // Headers/first event were already written before the throw — this
      // proves the `finally` block still ends the response even though
      // the error propagated out past the try, matching real Node
      // behavior for an unclosed response left mid-stream.
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(req.off).toHaveBeenCalled();
    });
  });
});
