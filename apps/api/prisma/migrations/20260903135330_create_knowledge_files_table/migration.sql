-- CreateEnum
CREATE TYPE "KnowledgeFileStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'EMBEDDING_PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_files" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "KnowledgeFileStatus" NOT NULL DEFAULT 'UPLOADED',
    "chunkCount" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_files_storageKey_key" ON "knowledge_files"("storageKey");

-- CreateIndex
CREATE INDEX "knowledge_files_workspaceId_idx" ON "knowledge_files"("workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_files_ownerId_idx" ON "knowledge_files"("ownerId");

-- AddForeignKey
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
