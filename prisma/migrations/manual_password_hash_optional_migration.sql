-- Make passwordHash optional for OAuth-only users (Google sign-in).
-- Run when DATABASE_URL is set: psql $DATABASE_URL -f prisma/migrations/manual_password_hash_optional_migration.sql
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
