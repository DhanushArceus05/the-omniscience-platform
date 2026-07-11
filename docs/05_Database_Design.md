# Database & Storage Design

Version: 1.0
Status: Approved
Last Updated: 2026-07-11

- PostgreSQL: users, auth, roles, workspaces, files metadata, workflows, reports metadata, model registry, audit logs
- MongoDB: conversations, messages, flexible AI outputs, agent/workflow events, timeline, diagnostics
- Vector DB: knowledge and memory embeddings
- Redis: OTP, sessions/cache, queues, rate limits, live status and locks
- Object storage: private uploads, audio, images, reports, exports and snapshots
- Knowledge graph: PostgreSQL entity/relationship tables for v1; Neo4j-ready later

Rules: UUIDs, single source of truth, workspace isolation, soft delete, encryption, signed URLs and AI trace IDs.
