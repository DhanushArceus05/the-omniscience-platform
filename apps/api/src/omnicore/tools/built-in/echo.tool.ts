import { Injectable } from "@nestjs/common";
import { stringSchema, type Tool } from "../tool.interface";

/**
 * Returns its input unchanged (Phase 5 Step 5, requirement 4
 * "Built-in Tools"). The simplest possible tool — useful for verifying
 * the framework's own plumbing (registry lookup, input/output
 * validation, `StepExecutorService` integration) end to end without
 * any real side effect.
 */
@Injectable()
export class EchoTool implements Tool<string, string> {
  readonly id = "echo";
  readonly name = "Echo";
  readonly description = "Returns the supplied input unchanged.";
  readonly capabilities = ["utility"];
  readonly inputSchema = stringSchema;
  readonly outputSchema = stringSchema;

  async execute(input: string): Promise<string> {
    return input;
  }
}
