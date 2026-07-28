import { Injectable } from "@nestjs/common";
import { omniCoreDomainError } from "../omnicore.errors";
import type { Tool } from "./tool.interface";

/**
 * In-memory registry of every `Tool` the API process knows about
 * (Phase 5 Step 5, requirement 2 "Tool Registry") — the tool-calling
 * counterpart to `ProviderRegistryService`
 * (`apps/api/src/ai/provider-registry.service.ts`), same shape:
 * register once, resolve by id, typed error if the id isn't there.
 *
 * Populated once at bootstrap by `ToolSeedService` (`OnModuleInit`),
 * the only caller of `register()` today — nothing else adds tools at
 * runtime yet. "Support future dependency injection" (requirement 2)
 * is already true by construction: every built-in tool
 * (`apps/api/src/omnicore/tools/built-in/`) is itself an `@Injectable()`
 * NestJS provider, constructor-injected into `ToolSeedService` — a
 * future tool with its own dependencies (a database client, an HTTP
 * client, etc.) needs nothing more than the same pattern, not a change
 * to this class.
 */
@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, Tool>();

  /** Registers `tool`. Throws `DUPLICATE_TOOL_ID` if a tool with that id is already registered. */
  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw omniCoreDomainError("DUPLICATE_TOOL_ID", `A tool with id "${tool.id}" is already registered.`);
    }
    this.tools.set(tool.id, tool);
  }

  /** Returns the tool registered under `toolId`, or throws `TOOL_NOT_FOUND`. */
  getById(toolId: string): Tool {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw omniCoreDomainError("TOOL_NOT_FOUND", `No tool is registered with id "${toolId}".`, { toolId });
    }
    return tool;
  }

  /** Returns the tool registered under `toolId`, or `undefined` — the non-throwing counterpart to `getById()`, for callers that want to check existence without handling an exception. */
  tryGetById(toolId: string): Tool | undefined {
    return this.tools.get(toolId);
  }

  /** Every registered tool's metadata, in registration order. */
  list(): readonly Tool[] {
    return Array.from(this.tools.values());
  }
}
