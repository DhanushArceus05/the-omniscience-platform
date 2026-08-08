import { z } from "zod";
import { omniCorePromptSchema } from "./omnicore";
import { workspaceIdParamSchema } from "./workspaces";

export { workspaceIdParamSchema };

/**
 * Shared conversation/message request schemas (Phase 6 Step 1 —
 * Conversation & Message Persistence Foundation).
 *
 * Follows `workspaces.ts`'s exact conventions: field-level schemas
 * exported individually, `.strict()` request-body schemas so an
 * unexpected field surfaces as a clear `VALIDATION_ERROR` instead of
 * being silently ignored, and bounded/capped list-query schemas so no
 * endpoint can ever be asked to return an unbounded result set.
 */

/**
 * `POST /workspaces/:workspaceId/conversations` body. Empty by design
 * this step: manual rename and auto-title generation are both
 * explicitly out of scope for Step 1 (see the approved roadmap) —
 * every conversation is created with `title: null` server-side, never
 * supplied by the caller. `.strict()` still rejects any field at all,
 * including a `title` a caller might try to send, so that omission is
 * enforced rather than merely assumed.
 */
export const createConversationRequestSchema = z.object({}).strict();

/**
 * `:workspaceId` route param — re-exported verbatim from
 * `./workspaces.ts` (see the `export { workspaceIdParamSchema }`
 * above) rather than redefined here, so every route on this
 * workspace-scoped resource validates the id with the exact same rule
 * `WorkspacesController` already uses, with a single source of truth.
 */

/**
 * `:conversationId` route param. Unlike `workspaceIdParamSchema`
 * (a Prisma `cuid()`, format-unchecked at the schema layer),
 * conversation ids are MongoDB `ObjectId`s — a fixed 24-character
 * lowercase/uppercase hex string — so this schema *does* check the
 * format. A syntactically invalid id (wrong length or character set)
 * is rejected as a `400 VALIDATION_ERROR` before ever reaching
 * `ConversationsRepository`, instead of surfacing as a confusing
 * driver-level `BSONError`.
 */
export const conversationIdParamSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "A valid conversation id is required");

/**
 * `:messageId` route param (Phase 6 Step 5 — Message-Level UX). Same
 * shape and reasoning as `conversationIdParamSchema` immediately
 * above — message ids are MongoDB `ObjectId`s too, so this checks the
 * same fixed 24-character hex format, rejecting a syntactically
 * invalid id as `400 VALIDATION_ERROR` before it ever reaches
 * `ConversationsRepository`.
 */
export const messageIdParamSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "A valid message id is required");

/**
 * Bounded list pagination — conversations. Same shape and reasoning
 * as `listWorkspacesQuerySchema`: `limit` defaults to
 * `DEFAULT_CONVERSATION_LIST_LIMIT` and is capped at
 * `MAX_CONVERSATION_LIST_LIMIT`; `cursor` is an opaque string here
 * (its encoding is `ConversationsRepository`'s concern) — a malformed
 * cursor is rejected by the repository layer, not this schema.
 */
export const DEFAULT_CONVERSATION_LIST_LIMIT = 20;
export const MAX_CONVERSATION_LIST_LIMIT = 50;

export const listConversationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1, "limit must be at least 1")
      .max(MAX_CONVERSATION_LIST_LIMIT, `limit must be at most ${MAX_CONVERSATION_LIST_LIMIT}`)
      .optional(),
    cursor: z.string().trim().min(1, "cursor must not be empty").optional(),
  })
  .strict();

/**
 * Bounded list pagination — messages. A separate, independently
 * tunable limit/cap from the conversation list above (messages within
 * a single conversation are a different shape of collection than
 * conversations within a workspace), even though both currently share
 * the same default/cap values.
 */
export const DEFAULT_MESSAGE_LIST_LIMIT = 20;
export const MAX_MESSAGE_LIST_LIMIT = 50;

export const listMessagesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1, "limit must be at least 1")
      .max(MAX_MESSAGE_LIST_LIMIT, `limit must be at most ${MAX_MESSAGE_LIST_LIMIT}`)
      .optional(),
    cursor: z.string().trim().min(1, "cursor must not be empty").optional(),
  })
  .strict();

/**
 * `POST /workspaces/:workspaceId/conversations/:conversationId/messages`
 * body. `content` reuses `omniCorePromptSchema` verbatim (the exact
 * same trim/min/max-8000 rule `omniCoreExecuteRequestSchema.prompt`
 * already enforces) rather than inventing a second, separately tuned
 * limit — per the approved Step 1 decision, this endpoint's `content`
 * is routed through `OmniCoreService.execute()` unchanged, so it
 * should never accept something OmniCore's own request contract would
 * reject anyway.
 */
export const sendMessageRequestSchema = z
  .object({
    content: omniCorePromptSchema,
  })
  .strict();

/**
 * Trimmed, 1–200 character conversation title (Phase 6 Step 4 —
 * Conversation Management). Same field-level-schema convention as
 * `workspaceNameSchema`/`displayNameSchema` — one place to change the
 * policy later. Empty after trimming is rejected, exactly like
 * `workspaceNameSchema`.
 */
export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1, "Conversation title is required")
  .max(200, "Conversation title must be at most 200 characters");

/**
 * `PATCH /workspaces/:workspaceId/conversations/:conversationId` body
 * (Phase 6 Step 4). `.strict()`, same convention as every other
 * request schema in this module.
 */
export const renameConversationRequestSchema = z
  .object({
    title: conversationTitleSchema,
  })
  .strict();

export type CreateConversationRequestSchema = z.infer<typeof createConversationRequestSchema>;
export type ConversationIdParamSchema = z.infer<typeof conversationIdParamSchema>;
export type MessageIdParamSchema = z.infer<typeof messageIdParamSchema>;
export type ListConversationsQuerySchema = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuerySchema = z.infer<typeof listMessagesQuerySchema>;
export type SendMessageRequestSchema = z.infer<typeof sendMessageRequestSchema>;
export type RenameConversationRequestSchema = z.infer<typeof renameConversationRequestSchema>;
