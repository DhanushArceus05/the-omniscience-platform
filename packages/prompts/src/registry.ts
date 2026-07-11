/**
 * Prompt Registry (structural scaffold).
 *
 * Phase 0 establishes the contract only. No provider calls and no
 * actual prompt content are introduced in this phase (see
 * claude/CURRENT_PHASE.md exclusions). OmniProvider and OmniCore
 * (Phases 4-6) will populate this registry.
 */
export interface PromptTemplate {
  id: string;
  version: string;
  description: string;
  /** Renders the template with strongly typed variables. */
  render: (variables: Record<string, string>) => string;
}

export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): void {
    const key = `${template.id}@${template.version}`;
    if (this.templates.has(key)) {
      throw new Error(`Prompt template already registered: ${key}`);
    }
    this.templates.set(key, template);
  }

  get(id: string, version: string): PromptTemplate {
    const key = `${id}@${version}`;
    const template = this.templates.get(key);
    if (!template) {
      throw new Error(`Prompt template not found: ${key}`);
    }
    return template;
  }

  list(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }
}
