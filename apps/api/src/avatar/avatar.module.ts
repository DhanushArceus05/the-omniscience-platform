import { Global, Module } from "@nestjs/common";
import { AvatarStorageService } from "./avatar-storage.service";

/**
 * `@Global()`, same convention `PrismaModule`/`RedisModule`/`MailModule`
 * already follow — imported once here (`AppModule`) and then
 * `AvatarStorageService` is injectable anywhere (`UsersService`)
 * without every consuming module needing its own explicit import.
 *
 * No `MulterModule` registration lives here on purpose: `UsersController`
 * passes `FileInterceptor("file", { limits: { fileSize: ... } })` its
 * own local options directly (a fixed, generous DoS backstop constant —
 * see `users.controller.ts`), so there is nothing global to configure.
 * The authoritative, env-configurable (`AVATAR_MAX_UPLOAD_BYTES`) size
 * check happens in `AvatarStorageService.assertValid` itself, after the
 * file is buffered — see its docstring for the full reasoning.
 */
@Global()
@Module({
  providers: [AvatarStorageService],
  exports: [AvatarStorageService],
})
export class AvatarModule {}
