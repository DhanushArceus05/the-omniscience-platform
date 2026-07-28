import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { anyInputSchema, stringSchema, type Tool } from "../tool.interface";

/**
 * Generates a new random UUID (Phase 5 Step 5, requirement 4
 * "Built-in Tools"), using the same `node:crypto` `randomUUID` already
 * used elsewhere in this module (`ExecutionStageBuilderService`,
 * `TaskPlannerService`). Ignores its input entirely, same rationale as
 * `CurrentTimeTool`.
 */
@Injectable()
export class UUIDTool implements Tool<unknown, string> {
  readonly id = "uuid";
  readonly name = "UUID Generator";
  readonly description = "Generates a new random UUID (v4).";
  readonly capabilities = ["utility"];
  readonly inputSchema = anyInputSchema;
  readonly outputSchema = stringSchema;

  async execute(): Promise<string> {
    return randomUUID();
  }
}
