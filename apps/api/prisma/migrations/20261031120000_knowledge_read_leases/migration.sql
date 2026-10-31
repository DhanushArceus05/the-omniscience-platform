CREATE TABLE "knowledge_file_read_leases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_file_read_leases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_file_read_leases_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "knowledge_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "knowledge_file_read_leases_workspaceId_fileId_expiresAt_idx" ON "knowledge_file_read_leases"("workspaceId", "fileId", "expiresAt");
CREATE INDEX "knowledge_file_read_leases_workspaceId_fileId_generationId_expiresAt_idx" ON "knowledge_file_read_leases"("workspaceId", "fileId", "generationId", "expiresAt");
