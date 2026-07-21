import { Injectable } from "@nestjs/common";
import type { ProviderCapability, ProviderId, ProviderMetadata } from "@omniscience/types";
import { aiDomainError, hasCapability, type OmniProvider } from "./ai-provider.interface";

/**
 * In-memory registry of every `OmniProvider` adapter the API process
 * knows about (Phase 4 Step 1). Nothing here is vendor-aware — it only
 * ever operates on the `OmniProvider` interface and `ProviderId`
 * strings, per the Provider Rule (`docs/04_System_Architecture.md`).
 *
 * Populated once at bootstrap by `AiProviderSeedService`
 * (`OnModuleInit`), which is the only caller of `register()` in this
 * step — nothing else adds providers at runtime yet.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly providers = new Map<ProviderId, OmniProvider>();

  /** Registers a provider. Throws `DUPLICATE_PROVIDER` if the id is already registered. */
  register(provider: OmniProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw aiDomainError(
        "DUPLICATE_PROVIDER",
        `A provider with id "${provider.providerId}" is already registered.`,
      );
    }
    this.providers.set(provider.providerId, provider);
  }

  /** Returns the provider for `providerId`, or throws `PROVIDER_NOT_FOUND`. */
  getById(providerId: ProviderId): OmniProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw aiDomainError("PROVIDER_NOT_FOUND", `No provider is registered with id "${providerId}".`);
    }
    return provider;
  }

  /** All registered providers, in registration order. */
  list(): readonly OmniProvider[] {
    return Array.from(this.providers.values());
  }

  /** Providers that declare support for every capability in `capabilities`. */
  filterByCapabilities(capabilities: readonly ProviderCapability[]): readonly OmniProvider[] {
    return this.list().filter((provider) =>
      capabilities.every((capability) => hasCapability(provider.capabilities, capability)),
    );
  }

  /** Safe, secret-free metadata for every registered provider — the exact shape `GET /ai/providers` returns. */
  listMetadata(): readonly ProviderMetadata[] {
    return this.list().map((provider) => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      capabilities: provider.capabilities,
      configStatus: provider.configStatus(),
      priority: provider.priority,
    }));
  }
}
