# Phase 3A Testing Guide - Feedback Database Integration

## Prerequisites
- ✅ Database table created (`ExploreFeedback`)
- ✅ Prisma Client generated
- ✅ API route created (`/api/explore/feedback`)
- ✅ ResponseFeedback component updated
- ✅ Response prop passed to component

## Testing Steps

### 1. Start Development Server
```powershell
npm run dev
```

### 2. Navigate to Explore Page
- Go to: `http://localhost:3000/dashboard/explore`
- Ensure you're logged in

### 3. Test Positive Feedback Flow

**Steps:**
1. Ask a question that returns results (e.g., "How many SQOs did we have this quarter?")
2. Wait for results to appear
3. Click the thumbs up (👍) button
4. **Expected Results:**
   - "Saving..." text appears briefly
   - "Thanks for your feedback!" message appears
   - No comment input should appear
   - Feedback is saved to database immediately

**Verify in Database:**
```sql
SELECT * FROM "ExploreFeedback" 
WHERE feedback = 'positive' 
ORDER BY "createdAt" DESC 
LIMIT 1;
```
- Should show: `feedback = 'positive'`, `comment = NULL`
- Should have: `userId`, `question`, `templateId`, `compiledQuery`, `resultSummary`

### 4. Test Negative Feedback Flow (With Comment)

**Steps:**
1. Ask another question (e.g., "SQOs by channel this quarter")
2. Wait for results
3. Click the thumbs down (👎) button
4. **Expected Results:**
   - Comment input field appears
   - "Send" button is **disabled** (grayed out)
   - Placeholder says "What went wrong? (required)"

5. Try to submit without comment:
   - Click "Send" button (should be disabled)
   - If enabled, should show error: "Please provide a comment explaining what went wrong"

6. Enter a comment (e.g., "The results don't match what I see in the main dashboard")
7. Click "Send" or press Enter
8. **Expected Results:**
   - "Saving..." text appears
   - Comment input disappears
   - "Thanks for your feedback!" message appears
   - Feedback is saved to database

**Verify in Database:**
```sql
SELECT * FROM "ExploreFeedback" 
WHERE feedback = 'negative' 
ORDER BY "createdAt" DESC 
LIMIT 1;
```
- Should show: `feedback = 'negative'`, `comment` has the text you entered
- Should have: All fields populated including `compiledQuery` and `resultSummary` as JSON

### 5. Test Comment Requirement Validation

**Steps:**
1. Click thumbs down
2. Type only spaces in comment field
3. Try to submit
4. **Expected Results:**
   - Error message appears: "Please provide a comment explaining what went wrong"
   - Submit button remains disabled
   - Comment field stays visible

5. Type actual text
6. **Expected Results:**
   - Error message disappears
   - Submit button becomes enabled
   - Can successfully submit

### 6. Test Error Handling

**Option A: Test API Error (Temporary)**
1. Temporarily break the API route by commenting out the database call:
   ```typescript
   // const feedbackRecord = await prisma.exploreFeedback.create({...});
   ```
2. Try to submit feedback
3. **Expected Results:**
   - Error message appears: "Failed to save feedback"
   - User is not blocked (can still interact with page)
   - Error is logged to console

**Option B: Test Network Error**
1. Disconnect from internet
2. Try to submit feedback
3. **Expected Results:**
   - Error message appears
   - User experience remains smooth

### 7. Verify JSON Fields in Database

**Check compiledQuery:**
```sql
SELECT 
  id,
  question,
  "templateId",
  "compiledQuery"->>'sql' as sql_snippet,
  "compiledQuery"->>'templateId' as template_id
FROM "ExploreFeedback"
WHERE "compiledQuery" IS NOT NULL
LIMIT 1;
```
- Should return valid JSON with `sql` and `templateId` fields

**Check resultSummary:**
```sql
SELECT 
  id,
  "resultSummary"->>'rowCount' as row_count,
  "resultSummary"->>'executionTimeMs' as exec_time,
  "resultSummary"->>'visualization' as viz_type
FROM "ExploreFeedback"
WHERE "resultSummary" IS NOT NULL
LIMIT 1;
```
- Should return valid JSON with `rowCount`, `executionTimeMs`, `visualization`

### 8. Test Loading States

**Steps:**
1. Click thumbs up
2. **Expected Results:**
   - Button shows disabled state (opacity-50)
   - "Saving..." text appears next to buttons
   - Buttons are not clickable during save

3. After save completes:
   - "Saving..." disappears
   - "Thanks for your feedback!" appears

### 9. Test Keyboard Shortcut

**Steps:**
1. Click thumbs down
2. Type comment
3. Press Enter key
4. **Expected Results:**
   - Comment submits (same as clicking Send button)
   - Only works if comment has text

### 10. Verify User ID Capture

**Check in Database:**
```sql
SELECT 
  id,
  "userId",
  question,
  feedback,
  "createdAt"
FROM "ExploreFeedback"
ORDER BY "createdAt" DESC
LIMIT 5;
```
- All records should have `userId` matching your logged-in email
- Should not be NULL (unless session issue)

## Database Verification Queries

### Count Feedback by Type
```sql
SELECT 
  feedback,
  COUNT(*) as count,
  COUNT(comment) as with_comments
FROM "ExploreFeedback"
GROUP BY feedback;
```

### Recent Negative Feedback with Comments
```sql
SELECT 
  "userId",
  question,
  "templateId",
  comment,
  "createdAt"
FROM "ExploreFeedback"
WHERE feedback = 'negative' 
  AND comment IS NOT NULL
ORDER BY "createdAt" DESC
LIMIT 10;
```

### Template Performance (Most Negative Feedback)
```sql
SELECT 
  "templateId",
  COUNT(*) FILTER (WHERE feedback = 'negative') as negative_count,
  COUNT(*) FILTER (WHERE feedback = 'positive') as positive_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE feedback = 'negative') / COUNT(*),
    2
  ) as negative_percentage
FROM "ExploreFeedback"
GROUP BY "templateId"
ORDER BY negative_count DESC;
```

## Expected Behavior Summary

✅ **Positive Feedback:**
- Saves immediately on click
- No comment required
- Shows success message
- Stores in database with all context

✅ **Negative Feedback:**
- Shows comment input on click
- Submit button disabled until comment entered
- Comment is required (validated client and server side)
- Saves with comment after submission
- Shows success message

✅ **Error Handling:**
- Shows user-friendly error messages
- Doesn't block user interaction
- Logs errors to console for debugging

✅ **Data Storage:**
- All feedback saved to `ExploreFeedback` table
- `userId` captured from session
- `compiledQuery` stored as JSON
- `resultSummary` stored as JSON
- Timestamps automatically set

## Troubleshooting

**Issue: Feedback not saving**
- Check browser console for errors
- Verify API route is accessible: `http://localhost:3000/api/explore/feedback`
- Check server logs for Prisma errors
- Verify DATABASE_URL is set correctly

**Issue: Comment not required**
- Check that validation is in both client and server
- Verify `handleCommentSubmit` checks for empty comment
- Verify API route validates comment for negative feedback

**Issue: JSON fields empty**
- Verify `response` prop is passed to `ResponseFeedback`
- Check that `response.compiledQuery` exists
- Check that `response.result` exists for `resultSummary`

## Completion Criteria

All items should be verified:
- [x] Positive feedback saves without comment
- [x] Negative feedback requires comment
- [x] Comment validation works (empty comment rejected)
- [x] Feedback saves to database
- [x] compiledQuery JSON stored correctly
- [x] resultSummary JSON stored correctly
- [x] userId captured from session
- [x] Error handling works gracefully
- [x] Loading states display correctly
- [x] Success message appears after save
