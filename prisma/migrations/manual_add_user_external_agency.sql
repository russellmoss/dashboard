/*
  Add externalAgency column to User table.
  Run in Neon SQL Editor. Then run: npx prisma generate
  Idempotent: safe to run more than once.
*/

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "externalAgency" TEXT;
