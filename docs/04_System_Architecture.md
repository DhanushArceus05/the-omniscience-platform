# System Architecture

Version: 1.0
Status: Approved
Last Updated: 2026-07-11

## Style

Monorepo + modular monolith first; microservices later only if needed.

## Apps

- React/Vite web app
- NestJS API
- FastAPI AI/ML service

## Flow

User → Assistant → OmniCore → capability plan → OmniProvider/Model Manager → specialized modules → validator/reviewer → response composer.

## OmniCore

Fast rules, intent intelligence, complex-task planner, pipeline builder, execution manager, validation, confidence, fallback and response composition.

## Provider Rule

Business logic requests capabilities, never vendor names.

---

# Future Architecture Extension – Arceus Activation Mode

## Status

**Future Phase (Locked)**

The following architecture is reserved for the final flagship capability of The Omniscience Platform.

It extends the existing platform architecture without replacing any current components.

---

# Architectural Principle

Arceus Activation Mode is **not** a separate AI assistant.

Instead, it is an additional interaction layer that communicates with the same platform services used by the existing web application.

The platform will always maintain a single intelligence layer responsible for:

- Conversations
- Memory
- Planning
- Agent orchestration
- Tool execution
- Provider routing
- Security
- Audit logging

Voice interaction is simply another interface into these shared capabilities.

---

# Conceptual Architecture

```
                    +----------------------+
                    |   Wake Phrase Layer  |
                    | "Activate Arceus"    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Voice Session Layer  |
                    +----------+-----------+
                               |
                  +------------+------------+
                  |                         |
                  v                         v
        Speech-to-Text               Text Interface
                  |                         |
                  +------------+------------+
                               |
                               v
                  +--------------------------+
                  | Conversation Engine      |
                  +------------+-------------+
                               |
                               v
                  +--------------------------+
                  | Planner / Orchestrator   |
                  +------------+-------------+
                               |
        +-----------+----------+----------+-----------+
        |           |                     |           |
        v           v                     v           v
   Provider     Agent Layer          Tool Layer   Memory
   Router                           (RAG/Search)
        |                                           |
        +--------------------+----------------------+
                             |
                             v
                  +--------------------------+
                  | Execution Result         |
                  +------------+-------------+
                               |
                +--------------+--------------+
                |                             |
                v                             v
         Web / Mobile UI             Speech Output (TTS)
```

---

# Future Components

The following components are planned for future implementation:

### Voice Session Manager

Responsible for:

- Wake phrase lifecycle
- Push-to-talk
- Voice session timeout
- Streaming audio
- Speech coordination

---

### Desktop Companion

Responsibilities include:

- Operating-system integration
- File access
- Application launching
- Local automation
- Secure command execution
- Trusted device registration

The companion communicates securely with the platform and executes only authorized actions.

---

### Mobile Companion

Responsibilities include:

- Voice interaction
- Deep linking
- Notifications
- Cross-device continuity
- Mobile-specific automation

Capabilities vary depending on operating-system restrictions.

---

### Unified Memory

All interaction modes share the same memory.

This includes:

- Voice conversations
- Text conversations
- Workspace memory
- User preferences
- Long-term memory
- Running tasks

There is never a separate "voice memory."

---

### Shared Tool Layer

Every interaction method uses the same platform tools.

Examples include:

- RAG
- Web Search
- Website Crawling
- File Analysis
- AI Providers
- Connected Services
- Future Plugins

Tool execution remains completely provider-independent.

---

# Security Boundary

Desktop automation exists outside the browser sandbox.

Therefore:

- Browser components never execute unrestricted operating-system commands.
- Sensitive operations require user approval.
- Desktop automation must occur through a trusted native companion.
- Every action must be authenticated, authorized, and auditable.

This separation preserves platform security while enabling advanced automation.

---

# Design Goals

The future architecture is designed to achieve the following goals:

- Maintain a single intelligence layer.
- Avoid duplicated business logic.
- Reuse existing infrastructure.
- Support multiple interaction modes.
- Preserve enterprise-grade security.
- Scale across desktop, mobile, and cloud environments.
- Allow future expansion without architectural redesign.

---

# Architecture Status

Current Platform:

- Web Interface
- AI Conversations
- Provider Abstraction
- Memory
- Agent Framework
- Tool Orchestration

Future Platform:

- Voice Interface
- Wake Phrase
- Desktop Companion
- Mobile Companion
- Cross-Device Continuity
- Secure Automation

The future architecture builds incrementally on the existing platform rather than replacing it.

---

# Reference

The complete long-term engineering vision for this architecture is documented in:

**`claude/ARCEUS_ACTIVATION_VISION.md`**