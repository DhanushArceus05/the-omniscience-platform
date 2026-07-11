import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ service: "api", level: env.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({ origin: env.API_CORS_ORIGIN, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);
  logger.info({ port: env.API_PORT, host: env.API_HOST }, "api service started");
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during API bootstrap:", error);
  process.exit(1);
});
