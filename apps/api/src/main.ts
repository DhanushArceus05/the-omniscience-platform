import "reflect-metadata";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadEnv } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ service: "api", level: env.LOG_LEVEL });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.enableCors({ origin: env.API_CORS_ORIGIN, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  // Phase 3 Step 3 — serves uploaded avatars back out as plain static
  // files. `AvatarStorageService.buildPublicUrl` builds URLs assuming
  // exactly this prefix; if this ever changes, that's the other half
  // of the same contract to update.
  app.useStaticAssets(path.resolve(env.AVATAR_STORAGE_DIR), { prefix: "/uploads/avatars" });

  await app.listen(env.API_PORT, env.API_HOST);
  logger.info({ port: env.API_PORT, host: env.API_HOST }, "api service started");
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during API bootstrap:", error);
  process.exit(1);
});
