# Dashboard Requests Feature - Product & Design Questions

> **Purpose**: These are questions I need answered to properly scope, design, and implement the "Dashboard Requests" feature. These cover product decisions, edge cases, and operational details that weren't specified in the initial requirements.
> 
> **Instructions**: Please answer each question. If you're uncertain, feel free to say "decide for me" and I'll make a reasonable choice.

---

## 1. RevOps Admin Role

### 1.1 Role Inheritance
Should "RevOps Admin" have all the same page access as regular "Admin", plus the Dashboard Requests management capabilities? Or should it be more limited?

**Current Admin access**: Funnel Performance, Open Pipeline, Explore, SGA Hub, SGA Management, Recruiter Hub, Settings

**Your answer**: Yes, RevOps Amdin should have access to everything PLUS the dashboard requests management capabilities 

---

### 1.2 Multiple RevOps Admins?
Can there be multiple users with the "RevOps Admin" role, or is this strictly a single-person role (just you)?

**Your answer**: there can be multiple users with RevOps Admin roles

---

### 1.3 User Management Permissions
Should RevOps Admin be able to manage users (create/edit/delete users) like Admin, or should that remain Admin-only?

**Your answer**: yes they should be able to manage users

---

## 2. Request Submission Form

### 2.1 Required vs Optional Fields
For the submission form, which fields should be required vs optional?

| Field | Required? | Notes |
|-------|-----------|-------|
| Request Type (Feature Request / Data Error) | | |
| Title/Subject | | |
| Description | | |
| Priority (Low/Medium/High/Immediate) | | Should users be able to set their own priority? |
| Affected Dashboard Page | | Dropdown of pages? |
| Screenshots/Attachments | | |

**Your answer**: request type is required, title is required, description is required, priority isnt required but should be there and they can select it, affected dashboard page with a dropdown of pages would be great and not required and screenshots/attachments is not required but should exist

---

### 2.2 Priority Setting
Should all users be able to set priority on their requests, or should that be:
- A) User sets their perceived priority
- B) Only RevOps Admin sets priority after review
- C) User suggests priority, RevOps Admin can override

**Your answer**: C) User suggests priority, RevOps Admin can override

---

### 2.3 Data Error Specifics
For "Data Error" reports, do you want structured fields like:
- Which page were you on?
- What filters did you apply?
- What value did you see?
- What value did you expect?
- Date/time of occurrence?

Or just a free-form description?

**Your answer**:for data error reports I want fields structured as you said and I do want them to free-form descriptoin on it. none of the fields should be required, they should be able to input it as much as they want. 

---

### 2.4 Screenshot/Attachment Support
Do you want users to be able to attach screenshots or files to their requests? 

If yes:
- What file types should be allowed?
- Max file size?
- Where should files be stored (Vercel Blob, S3, just Wrike)?

**Your answer**: yes I want them to be able to submit screenshots adn that's it. no max file size. if they can go to wrike, that would be great, we dont need it anywhere else. 

---

## 3. Request Visibility & Access

### 3.1 View Own Submissions
Should users be able to see their own submitted requests that are still in "Submitted" status (before you move them to Planned/Prioritized)?

**Your answer**: Users should be able to see their own submitted requests

---

### 3.2 Who Can See What

| User Type | Can See Own Submissions? | Can See All Planned/In Progress/Done? | Can See Notes? |
|-----------|-------------------------|--------------------------------------|----------------|
| Admin |x |x |x |
| Manager |x |x |x |
| SGM |x |x |x |
| SGA |x |x |x |
| Viewer |x |x |x |
| RevOps Admin | All submissions | All | All + Edit |

**Your answer** (fill in the table): 

---

### 3.3 Anonymous Submissions
Should users be able to submit requests anonymously, or should their name/email always be attached?

**Your answer**: their name and email should be attached

---

## 4. Status Workflow

### 4.1 Status Definitions
Please confirm or adjust the status definitions:

| Status | Definition |
|--------|------------|
| Submitted | New request, not yet reviewed |
| Planned/Prioritized | Reviewed and added to backlog |
| In Progress | Currently being worked on |
| Done | Completed |

Should there be additional statuses like:
- **Declined/Won't Do** - for requests you're rejecting?
- **Needs More Info** - when you need clarification?
- **On Hold** - paused but not declined?

**Your answer**: These definitions are good. we should be able to delete submissoins or anythign in planned/prioritized and in progress and done. we dont need the other statusees like declined, needs more info, on hold

---

### 4.2 Status Change Notifications
When you change a request's status, should the submitter be notified?
- A) Yes, via email
- B) Yes, they'll see it when they log in
- C) No notification needed

**Your answer**: i would like both email and when they login 

---

### 4.3 Closing Without Completion
Can you mark something as "Done" even if you didn't actually implement it (e.g., determined it wasn't needed, or was a user error)? Or do you need a separate "Closed - No Action" status?

**Your answer**: We should just mark it Done even if we didnt implement for the reasons you laid out or we just delete it. or we mark it done and add the reason why in the notes in the done feature

---

## 5. Notes & Communication

### 5.1 Note Types
You mentioned adding notes that display to users. Should there be:
- A) Only public notes (visible to submitter and all users viewing the request)
- B) Public notes + internal notes (only you can see internal notes)
- C) Just public notes is fine

**Your answer**: Just public notes are fine

---

### 5.2 User Comments
Should users be able to reply/comment on their own requests after submission? Or is this one-way (they submit, you respond via notes)?

**Your answer**: they should be abl eto reply and comment on their own requests after submission 

---

### 5.3 Note History
Should notes show a history/timeline (who said what, when), or just the latest update?

**Your answer**: yes, we should have a history/timeline

---

## 6. Wrike Integration

### 6.1 Bi-Directional Sync Frequency
For Wrike ↔ Dashboard sync, how should updates propagate?
- A) Real-time webhooks (instant sync when either side changes)
- B) Poll Wrike every X minutes for changes
- C) Sync only when you manually trigger it
- D) Dashboard is master, Wrike is just a mirror (no sync back from Wrike)

**Your answer**:Real-time webhooks (instant sync when either side changes)

---

### 6.2 Wrike Task Mapping
In the Wrike project (ID: 4362507163), what should the task structure look like?
- Task title: Request title
- Task description: Request description
- Status: Map to Wrike workflow statuses?

What custom fields exist in Wrike that we should map to?

**Your answer**: right now we have no custom fields set up, but we could do that if we need to do that manually we can, we just need to be told what to do, if it's possible to set that up agetnically, that would be great to do it through API calls, but we can do it manually if needed. 

---

### 6.3 Wrike as Source of Truth
If someone updates a task in Wrike AND someone updates the same request in the Dashboard at the same time, which wins?
- A) Last write wins
- B) Dashboard always wins
- C) Wrike always wins
- D) Show a conflict warning

**Your answer**:Last write wins

---

### 6.4 Who Works in Wrike?
Besides you, who else might be updating these tasks in Wrike? Do they need to see the Dashboard Requests page, or do they only work in Wrike?

**Your answer**: only revops admins work in wrike too its fine

---

## 7. Kanban View (RevOps Admin)

### 7.1 Kanban Columns
Should the Kanban view show all four statuses as columns?
| Submitted | Planned/Prioritized | In Progress | Done |

Or should "Submitted" be a separate queue/list above the Kanban?

**Your answer**: yes show all four 

---

### 7.2 Drag and Drop
Should moving cards between columns be drag-and-drop, or click + select new status?

**Your answer**: drag-and-drop

---

### 7.3 Card Information
What information should be visible on each card in the Kanban view?
- [ ] Title
- [ ] Request type (Feature Request / Data Error)
- [ ] Priority badge
- [ ] Submitter name
- [ ] Submission date
- [ ] Days in current status
- [ ] Latest note preview
- [ ] Other: ___________

**Your answer**: all of those things should be there

---

### 7.4 Filtering & Sorting
Should the Kanban view support filtering/sorting by:
- [ ] Request type
- [ ] Priority
- [ ] Submitter
- [ ] Date range
- [ ] Other: ___________

**Your answer**: yes it should be filterable like that

---

## 8. User-Facing View (Non-Admin)

### 8.1 View Format
How should non-admin users see the Planned/In Progress/Done requests?
- A) Same Kanban view (but no edit capabilities)
- B) Simple list/table grouped by status
- C) Card grid organized by status
- D) Feed/timeline view showing recent updates

**Your answer**:Same Kanban view (but no edit capabilities)

---

### 8.2 Search & Filter
Should users be able to search/filter the requests they can see?
- Search by title/description?
- Filter by request type?
- Filter by status?

**Your answer**: they should be able to do all those things

---

## 9. Navigation & Page Structure

### 9.1 Page Names
What should the pages/sections be called in the sidebar?
- Option A: Single "Dashboard Requests" page with tabs for Submit / View Requests
- Option B: "Submit Request" page + "Request Status" page
- Option C: Other suggestion?

**Your answer**:Single "Dashboard Requests" page with tabs for Submit / View Requests

---

### 9.2 Where in Sidebar?
Where should the Dashboard Requests link appear in the sidebar navigation order?
Current order: Funnel Performance → Open Pipeline → Explore → SGA Hub → SGA Management → Recruiter Hub → Settings

**Your answer**:  it should be Funnel Performance → Open Pipeline → Explore → SGA Hub → SGA Management → Recruiter Hub → Dashboard Reuqests → Settings


---

### 9.3 RevOps Admin View Name
For your admin view, should it be:
- A) Same page as users, but with edit toggle/mode
- B) Completely separate page (e.g., "Manage Requests")
- C) Tab within the same page

**Your answer**: Same page as users, but with edit toggle/mode and i see everyone's submissions, they only see their owns. people can see everyone's stuff after submisision, once it's omved into priortized, in progress and done everyone can see it, but only submitters can see their submission, but I can see all of it. I should have the ability to hide prioritized, in progress and done so only the submitter can see it thatshould be something we can toggle where only teh submitter can see it, but in general, default, everyone should see prioritized, in progress and done .

---

## 10. Edge Cases & Policies

### 10.1 Duplicate Requests
How should duplicate requests be handled?
- A) System detects and warns about potential duplicates
- B) You manually mark duplicates and link them
- C) Each request stands alone

**Your answer**:System detects and warns about potential duplicates

---

### 10.2 Request Limits
Should there be any limits on requests?
- Max requests per user per day/week?
- Max open requests per user?
- No limits?

**Your answer**: no limits

---

### 10.3 Edit After Submission
Can users edit their request after submission?
- A) Yes, anytime before you move it from "Submitted"
- B) Yes, always (but changes are tracked)
- C) No, once submitted it's locked

**Your answer**:Yes, always (but changes are tracked)

---

### 10.4 Delete Requests
Can users delete their own submitted requests? Can RevOps Admin delete requests?

**Your answer**: yes users adn revops admin can delete

---

## 11. Data Retention

### 11.1 Completed Requests
How long should "Done" requests be visible?
- A) Forever (archival record)
- B) Auto-hide after X days
- C) Manual archive action

**Your answer**: Forever (archival record) with an archive action

---

### 11.2 Historical Data
Should there be any reporting on requests? (e.g., "this month we had X feature requests, Y data errors, average time to resolution was Z days")

**Your answer**: yes, there should be this month we had X feature requests, Y data errors, average time to resolution was Z days" kind of reporting

---

## 12. Initial Launch

### 12.1 Announcement
How will users learn about this new feature?
- A) Just appears in sidebar
- B) In-app announcement/banner
- C) Email announcement
- D) Training session

**Your answer**: Just appears in sidebar

---

### 12.2 Seeding Initial Data
Do you have any existing requests (from email, Slack, etc.) that should be pre-loaded into the system?

**Your answer**: I do have requests, I'll just put them in manually as hte revops admin to have something in there. 

---

### 12.3 Phased Rollout
Should this launch to all users at once, or rolled out gradually?
- A) All users immediately
- B) Admins/Managers first, then others
- C) Specific group first

**Your answer**:All users immediately

---

## 13. Quick Summary Checklist

Please confirm these key decisions with Y (yes), N (no), or ? (need to discuss):

| Decision | Y/N/? |
|----------|-------|
| RevOps Admin is the only role that can manage requests |Y |
| Users can set their own priority |Y |
| Users can see their own "Submitted" requests | Y|
| Users can comment on their requests after submission | Y|
| Email notifications when status changes | Y|
| Attachments/screenshots supported |Y |
| Bi-directional Wrike sync | Y|
| Drag-and-drop Kanban for RevOps Admin |Y |
| "Declined" status needed |N |

---

## Additional Notes

*Space for any additional context, requirements, or constraints you want to share:*

---

*Document to be completed by: [Your Name]*  
*Date:*
