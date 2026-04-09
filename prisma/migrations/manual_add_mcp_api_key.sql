/*
  Add bqAccess column to User table and create mcp_api_keys table.
  Run in Neon SQL Editor. Then run: npx prisma generate
  Idempotent: safe to run more than once.
*/

-- Step 1: Add bqAccess to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bqAccess" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Create mcp_api_keys table
CREATE TABLE IF NOT EXISTS "mcp_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id")
);

-- Step 3: Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_api_keys_key_key" ON "mcp_api_keys"("key");
CREATE INDEX IF NOT EXISTS "mcp_api_keys_userId_idx" ON "mcp_api_keys"("userId");
CREATE INDEX IF NOT EXISTS "mcp_api_keys_key_idx" ON "mcp_api_keys"("key");
CREATE INDEX IF NOT EXISTS "mcp_api_keys_isActive_idx" ON "mcp_api_keys"("isActive");

-- Step 4: Foreign Key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mcp_api_keys_userId_fkey'
  ) THEN
    ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
