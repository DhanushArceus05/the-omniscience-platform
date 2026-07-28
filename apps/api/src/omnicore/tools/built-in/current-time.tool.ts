import { Injectable } from "@nestjs/common";
import { anyInputSchema, stringSchema, type Tool } from "../tool.interface";

/**
 * Returns the current UTC timestamp as an ISO 8601 string (Phase 5
 * Step 5, requirement 4 "Built-in Tools"). Ignores its input entirely
 * — `anyInputSchema` accepts anything — since there is nothing for a
 * caller to parameterize about "what time is it right now."
 */
@Injectable()
export class CurrentTimeTool implements Tool<unknown, string> {
  readonly id = "current-time";
  readonly name = "Current Time";
  readonly description = "Returns the current UTC timestamp.";
  readonly capabilities = ["utility"];
  readonly inputSchema = anyInputSchema;
  readonly outputSchema = stringSchema;

  async execute(): Promise<string> {
    return new Date().toISOString();
  }
}
