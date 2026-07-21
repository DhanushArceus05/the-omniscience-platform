import { HttpException, HttpStatus } from "@nestjs/common";
import type {
  ModelCapability,
  ModelId,
  ModelMetadata,
  ProviderCapability,
  ProviderConfigStatus,
  ProviderId,
} from "@omniscience/types";

/**
 * Provider-neutral contract every OmniProvider adapter implements
 * (Phase 4 Step 1). Business logic (the future OmniCore/Assistant) is
 * meant to depend on this interface and on `ProviderRegistryService` /
 * `ModelCatalogService` — never on a concrete adapter class — per the
 * `docs/04_System_Architecture.md` Provider Rule: "business logic
 * requests capabilities, never vendor names."
 *
 * Every execution method (`generateText`, `generateStructured`,
 * `embed`) is intentionally unimplemented in every adapter registered
 * this step: they throw `notImplementedError()` below. Real vendor
 * integration is out of Phase 4 Step 1's scope by design (see
 * `claude/CURRENT_PHASE.md`) — this interface exists so a future phase
 * can implement these methods against a real vendor SDK without any
 * caller-facing change.
 */
export interface OmniProvider {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
  /** Lower number = higher priority; see `ModelSelectorService`'s algorithm. */
  readonly priority: number;

  /** Whether this provider's configuration (e.g. an API key) is currently present and valid. */
  configStatus(): ProviderConfigStatus;

  /** Whether the provider is ready to serve requests right now (Step 1: identical to `configStatus() === "configured"`). */
  isReady(): boolean;

  /** All models this provider currently exposes, regardless of capability. */
  listModels(): readonly ModelMetadata[];

  generateText(modelId: ModelId, prompt: string): Promise<string>;
  generateStructured(modelId: ModelId, prompt: string, schemaName: string): Promise<unknown>;
  embed(modelId: ModelId, input: string): Promise<readonly number[]>;
}

/**
 * Domain error codes for the OmniProvider / Model Manager foundation.
 * Each is mapped to an `HttpException` constructor below so every
 * throw site produces the exact `{ code, message }` body
 * `AllExceptionsFilter` already knows how to render — no new
 * error-handling abstraction, same convention `WorkspacesService`
 * established.
 */
export type AiDomainErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "DUPLICATE_PROVIDER"
  | "DUPLICATE_MODEL"
  | "NO_COMPATIBLE_MODEL"
  | "PROVIDER_NOT_CONFIGURED"
  | "CAPABILITY_NOT_SUPPORTED"
  | "NOT_IMPLEMENTED";

/**
 * Builds the one `HttpException` every `ai` module error site should
 * throw, keyed by domain code. Centralized here (rather than
 * constructed ad hoc at each call site) so the HTTP status for a given
 * domain error can never drift between call sites.
 */
const AI_DOMAIN_ERROR_STATUS: Readonly<Record<AiDomainErrorCode, HttpStatus>> = {
  PROVIDER_NOT_FOUND: HttpStatus.NOT_FOUND,
  MODEL_NOT_FOUND: HttpStatus.NOT_FOUND,
  DUPLICATE_PROVIDER: HttpStatus.CONFLICT,
  DUPLICATE_MODEL: HttpStatus.CONFLICT,
  NO_COMPATIBLE_MODEL: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_NOT_CONFIGURED: HttpStatus.UNPROCESSABLE_ENTITY,
  CAPABILITY_NOT_SUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,
};

export function aiDomainError(code: AiDomainErrorCode, message: string): HttpException {
  return new HttpException({ code, message }, AI_DOMAIN_ERROR_STATUS[code]);
}

/**
 * The single throw every adapter's execution methods use in Step 1.
 * Never leaks provider internals — just the capability that was
 * requested and which provider/model it was requested against.
 */
export function notImplementedError(providerId: ProviderId, modelId: ModelId): HttpException {
  return aiDomainError(
    "NOT_IMPLEMENTED",
    `Provider "${providerId}" has no real execution implementation yet for model "${modelId}" — OmniProvider Step 1 is architecture-only.`,
  );
}

/** Narrowing helper shared by every stub adapter's capability checks. */
export function hasCapability(
  capabilities: readonly ModelCapability[],
  capability: ModelCapability,
): boolean {
  return capabilities.includes(capability);
}
