-- Phase 7 Steps 3–5 repair: fence lifecycle attempts and publish generations atomically.
ALTER TYPE "KnowledgeFileStatus" ADD VALUE 'DELETING';

ALTER TABLE "knowledge_files"
  ADD COLUMN "processingAttemptId" TEXT,
  ADD COLUMN "activeGenerationId" TEXT;
