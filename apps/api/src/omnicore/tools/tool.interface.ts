import type { ToolCapability } from "@omniscience/types";

/**
 * A single validation issue from a `ToolSchema.safeParse()` failure.
 * Same shape `ZodLikeIssue` already uses in
 * `apps/api/src/common/pipes/zod-validation.pipe.ts` — kept
 * structurally identical (not imported from there) since that file's
 * shape is a private implementation detail of that pipe, not a shared
 * export.
 */
export interface ToolSchemaIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/** The result of validating a value against a `ToolSchema<T>`. */
export type ToolSchemaParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly ToolSchemaIssue[] } };

/**
 * A tool's input/output validator. Structurally typed (a bare
 * `safeParse` method) rather than importing `zod` directly, the same
 * "no direct `zod` dependency outside `@omniscience/schemas`"
 * convention `ZodValidationPipe` already established for HTTP request
 * bodies — any real Zod schema's `safeParse` already satisfies this
 * shape, so a future tool is free to build its `inputSchema`/
 * `outputSchema` from real `zod` schemas (via a small local adapter)
 * without this interface ever needing to change. This phase's three
 * built-in tools (`apps/api/src/omnicore/tools/built-in/`) implement
 * it by hand, since their inputs/outputs are simple enough not to need
 * a validation library at all.
 */
export interface ToolSchema<T> {
  safeParse(value: unknown): ToolSchemaParseResult<T>;
}

/**
 * The generic contract every tool implements (Phase 5 Step 5,
 * requirement 1 "Tool Framework") — the tool-calling counterpart to
 * `OmniProvider` (`apps/api/src/ai/ai-provider.interface.ts`): business
 * logic (`ToolExecutorService`, and through it `StepExecutorService`)
 * depends only on this interface and on `ToolRegistryService`, never
 * on a concrete tool class, the same Provider Rule shape
 * `docs/04_System_Architecture.md` already established for models.
 *
 * `TInput`/`TOutput` are validated, not merely declared:
 * `ToolExecutorService.execute()` always runs `inputSchema.safeParse()`
 * before calling `execute()`, and `outputSchema.safeParse()` on
 * whatever `execute()` resolves with, before returning it to its own
 * caller — a tool's declared types are a real, enforced input/output
 * contract, not just documentation.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly ToolCapability[];
  readonly inputSchema: ToolSchema<TInput>;
  readonly outputSchema: ToolSchema<TOutput>;
  execute(input: TInput): Promise<TOutput>;
}

/** A `ToolSchema<T>` built from a plain predicate — the common case for this phase's simple built-in tools, which need no full validation library. */
export function predicateSchema<T>(predicate: (value: unknown) => value is T, message: string): ToolSchema<T> {
  return {
    safeParse: (value: unknown): ToolSchemaParseResult<T> =>
      predicate(value) ? { success: true, data: value } : { success: false, error: { issues: [{ path: [], message }] } },
  };
}

/** A `ToolSchema<unknown>` that accepts any value — for tools (`CurrentTimeTool`, `UUIDTool`) that ignore their input entirely. */
export const anyInputSchema: ToolSchema<unknown> = {
  safeParse: (value: unknown): ToolSchemaParseResult<unknown> => ({ success: true, data: value }),
};

/** A `ToolSchema<string>` — shared by every built-in tool in this phase, since all three currently accept/return a plain string. */
export const stringSchema: ToolSchema<string> = predicateSchema(
  (value): value is string => typeof value === "string",
  "Expected a string value.",
);
