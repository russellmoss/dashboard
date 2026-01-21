# Vercel Deployment Readiness Checklist

## ✅ Configuration Files

- [x] `vercel.json` - Configured with function timeouts and cron jobs
- [x] `next.config.js` - Sentry configured, instrumentation hook enabled
- [x] `package.json` - Build script includes `prisma generate`
- [x] `postinstall` script - Runs `prisma generate` automatically
- [x] `.gitignore` - Properly excludes sensitive files

## ⚠️ Environment Variables Required in Vercel

### Required Variables:

1. **`DATABASE_URL`** (or `POSTGRES_PRISMA_URL` / `POSTGRES_URL`)
   - PostgreSQL connection string (Neon or Vercel Postgres)
   - Format: `postgresql://user:password@host:port/database?sslmode=require`

2. **`NEXTAUTH_SECRET`**
   - Random secret for session encryption
   - Generate with: `openssl rand -base64 32`

3. **`NEXTAUTH_URL`**
   - Production URL: `https://your-app.vercel.app`
   - Vercel auto-sets `VERCEL_URL`, but explicit is better

4. **`GCP_PROJECT_ID`**
   - Set to: `savvy-gtm-analytics`

5. **`GOOGLE_APPLICATION_CREDENTIALS_JSON`**
   - BigQuery service account JSON as a single-line string
   - **IMPORTANT**: Must be valid JSON with `\n` escape sequences for private_key
   - Do NOT set `GOOGLE_APPLICATION_CREDENTIALS` in Vercel (file path won't work)

6. **`GOOGLE_SHEETS_CREDENTIALS_JSON`** (if using Google Sheets export)
   - Google Sheets service account JSON as a single-line string
   - Same format requirements as above

7. **`GOOGLE_SHEETS_TEMPLATE_ID`** (if using Google Sheets export)
   - Google Sheets template ID for exports

8. **`ANTHROPIC_API_KEY`** (if using Explore/AI features)
   - Claude API key for the Explore feature

### Optional Variables:

- **`SENTRY_DSN`** - Server-side Sentry error tracking
- **`NEXT_PUBLIC_SENTRY_DSN`** - Client-side Sentry error tracking
- **`CRON_SECRET`** - Auto-injected by Vercel for cron job authentication

## 🔧 Pre-Deployment Steps

1. **Database Setup**:
   - Ensure Neon database is provisioned and migrations are applied
   - Run: `npx prisma migrate deploy` (or `prisma db push` for dev)
   - Verify `SavedReport` table exists

2. **Service Account Setup**:
   - Convert BigQuery service account JSON to single-line format
   - Ensure `private_key` uses `\n` escape sequences (not actual newlines)
   - Test credentials locally before deploying

3. **Build Test**:
   ```bash
   npm run build
   ```
   - Should complete without errors
   - Prisma client will be generated automatically

4. **Environment Variables**:
   - Set all required variables in Vercel dashboard
   - Verify `NEXTAUTH_URL` matches your production domain
   - Double-check JSON credentials are properly formatted

## ⚠️ Known Issues to Address

### 1. Hardcoded Production URL (Minor)
**File**: `src/lib/auth.ts` (line 26)
- Has fallback: `'https://dashboard-eta-lime-45.vercel.app'`
- **Action**: Consider removing or making configurable via env var
- **Impact**: Low - only used as last-resort fallback

### 2. Localhost Fallback in API Client (Acceptable)
**File**: `src/lib/api-client.ts` (line 75)
- Fallback to `http://localhost:3000` for build-time
- **Action**: None needed - this is intentional for build-time safety
- **Impact**: None - only used during build, not runtime

## ✅ Deployment Checklist

- [ ] All environment variables set in Vercel dashboard
- [ ] Database migrations applied (`prisma migrate deploy`)
- [ ] Service account JSONs properly formatted (single-line, escaped newlines)
- [ ] `NEXTAUTH_URL` matches production domain
- [ ] Build completes successfully (`npm run build`)
- [ ] Test authentication flow
- [ ] Test BigQuery queries
- [ ] Test database operations (saved reports)
- [ ] Verify cron job is scheduled correctly
- [ ] Check Sentry error tracking (if configured)

## 🚀 Deployment Commands

```bash
# Connect to Vercel (if not already connected)
vercel link

# Deploy to production
vercel --prod

# Or push to main branch (if auto-deploy is enabled)
git push origin main
```

## 📝 Post-Deployment Verification

1. **Health Check**: Visit `https://your-app.vercel.app`
2. **Authentication**: Test login flow
3. **Dashboard**: Verify data loads correctly
4. **Saved Reports**: Test creating/editing/deleting reports
5. **BigQuery**: Verify queries execute successfully
6. **Error Tracking**: Check Sentry for any errors

## 🔍 Troubleshooting

### Build Fails
- Check environment variables are set
- Verify Prisma schema is valid
- Check for TypeScript errors (though ESLint is disabled during builds)

### Runtime Errors
- Check Vercel function logs
- Verify environment variables are accessible
- Check BigQuery credentials format
- Verify database connection string

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly
- Check SSL mode (`?sslmode=require`)
- Ensure database allows connections from Vercel IPs

### BigQuery Errors
- Verify `GOOGLE_APPLICATION_CREDENTIALS_JSON` format
- Check that `private_key` uses `\n` (not actual newlines)
- Verify service account has BigQuery permissions

## 📚 Additional Notes

- **Prisma**: Client is auto-generated via `postinstall` script
- **Cron Jobs**: Configured in `vercel.json` for cache refresh
- **Function Timeouts**: Set to 60s for export and agent routes
- **Sentry**: Configured for error tracking (optional)
- **TypeScript**: Build errors are checked (not ignored)
- **ESLint**: Disabled during builds for speed
