import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Logger } from "pino";
import { LOGGER } from "../../config/config.constants";
import { CurrentTimeTool } from "./built-in/current-time.tool";
import { EchoTool } from "./built-in/echo.tool";
import { UUIDTool } from "./built-in/uuid.tool";
import { ToolRegistryService } from "./tool-registry.service";

/**
 * Registers every built-in `Tool` into `ToolRegistryService` exactly
 * once, on module init — the tool-calling counterpart to
 * `AiProviderSeedService` (`apps/api/src/ai/ai-provider-seed.service.ts`),
 * same shape: this is the *only* place any concrete tool class is
 * referenced by name; `ToolExecutorService`/`StepExecutorService`
 * depend solely on `ToolRegistryService` and the `Tool` interface.
 * Adding a fourth built-in tool in a future phase means adding one
 * line here, not touching any other file in this module.
 */
@Injectable()
export class ToolSeedService implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly echo: EchoTool,
    private readonly currentTime: CurrentTimeTool,
    private readonly uuid: UUIDTool,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const tools = [this.echo, this.currentTime, this.uuid];

    for (const tool of tools) {
      this.registry.register(tool);
    }

    this.logger.info(
      { toolIds: tools.map((tool) => tool.id) },
      "omnicore: tool registry seeded",
    );
  }
}
