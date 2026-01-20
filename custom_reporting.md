# Custom Reporting Presets - Implementation Requirements

## Codebase Structure

### File Paths

**Prisma Schema:**
- Path: `prisma/schema.prisma`

**GlobalFilters Component:**
- Path: `src/components/dashboard/GlobalFilters.tsx`

**API Routes Structure:**
- Base path: `src/app/api/`
- Dashboard routes: `src/app/api/dashboard/*`
- Admin routes: `src/app/api/admin/*`
- User routes: `src/app/api/users/*`
- Filter presets should be added at: `src/app/api/filter-presets/`

**Filter State Management:**
- Location: `src/app/dashboard/page.tsx`
- Method: **Local React state** using `useState` hook
- State variable: `const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)`
- No Context, Zustand, or URL params currently used
- Filter changes are applied via `onFiltersChange` callback passed to `GlobalFilters` component
- When filters change, `fetchDashboardData()` is called to refetch all dashboard data

### Filter State Flow

```typescript
// In src/app/dashboard/page.tsx
const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);

// GlobalFilters component receives:
<GlobalFilters
  filters={filters}
  filterOptions={filterOptions}
  onFiltersChange={(newFilters) => setFilters(newFilters)}
  onReset={() => setFilters(DEFAULT_FILTERS)}
/>

// When filters change, useEffect triggers data fetch:
useEffect(() => {
  if (filterOptions) {
    fetchDashboardData(); // Refetches all dashboard data
  }
}, [fetchDashboardData, filterOptions]);
```

## Existing User Model

### Prisma Schema

```prisma
model User {
  id           String   @id @default(cuid())  // String type, not UUID
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")    // Role field for admin identification
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy    String?
}
```

**Key Details:**
- **ID Type**: `String @id @default(cuid())` - Uses CUID, not UUID
- **Role Field**: `role String @default("viewer")` - Used for admin identification
- **Relation Setup**: FilterPreset should use `userId String` with `@relation(fields: [userId], references: [id])`

## Admin Identification

### Role-Based Access Control

**Role Values:**
- `'admin'` - Full access, can manage users and create templates
- `'manager'` - Similar to admin, can manage users and create templates
- `'sgm'` - Sales Growth Manager
- `'sga'` - Sales Growth Advisor
- `'viewer'` - Read-only access

**Admin Check Pattern:**
The codebase uses a permissions system via `getUserPermissions()` from `src/lib/permissions.ts`:

```typescript
// Pattern used throughout codebase:
const permissions = getSessionPermissions(session);
if (!['admin', 'manager'].includes(permissions.role)) {
  // Deny access
}
```

**For Filter Presets:**
- Admin template creation should check: `permissions.role === 'admin' || permissions.role === 'manager'`
- User presets are accessible to all authenticated users
- Admin templates are visible to all users but only editable by admins/managers

## Integration Questions

### Filter State Management

**Current Implementation:**
- **Method**: Local React state (`useState`) in `src/app/dashboard/page.tsx`
- **No Context**: No React Context for filter state
- **No Zustand**: No global state management library
- **No URL Params**: Filters are not synced to URL parameters
- **State Location**: `const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)`

**Filter Application:**
- Filters are passed to `GlobalFilters` component via props
- Changes trigger `onFiltersChange` callback which calls `setFilters(newFilters)`
- `useEffect` hook watches `filters` and calls `fetchDashboardData()` to refetch all data
- Function that applies filters: `setFilters()` directly updates state, which triggers data refetch

**Recommendation for Presets:**
- Presets should integrate with existing `setFilters()` pattern
- When a preset is selected, call `setFilters(preset.filters)` 
- This will automatically trigger data refetch via existing `useEffect` dependency
- No need to change current filter management approach

### Existing UI Patterns

**Modal Components:**
The codebase has several modal components following a consistent pattern:

1. **RecordDetailModal** (`src/components/dashboard/RecordDetailModal.tsx`)
   - Uses custom modal overlay with backdrop
   - Close button with X icon (lucide-react)
   - Custom styled sections and detail rows
   - Pattern: `isOpen` prop, `onClose` callback

2. **VolumeDrillDownModal** (`src/components/dashboard/VolumeDrillDownModal.tsx`)
   - Similar modal pattern
   - Uses Tremor Card components for structure

3. **UserModal** (`src/components/settings/UserModal.tsx`)
   - Form-based modal for user management
   - Uses Tremor components

**Modal Pattern to Follow:**
```typescript
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  // ... other props
}

// Modal structure:
{isOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
    <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl">
      {/* Modal content */}
    </div>
  </div>
)}
```

**Dropdown Components:**
- No dedicated dropdown component found
- Uses native HTML `<select>` elements in `GlobalFilters.tsx`
- Uses Tremor components where appropriate

**Recommendation:**
- **Save Preset Modal**: Create new component following `RecordDetailModal` pattern
- **Preset Dropdown**: Add to `GlobalFilters.tsx` using native `<select>` or Tremor Select component
- **UI Library**: Continue using Tremor React components for consistency
- **Icons**: Use `lucide-react` icons (already in dependencies)

## Tech Stack

**Frontend:**
- Next.js 14.2.35 (App Router)
- React 18.3.1
- TypeScript 5.9.3
- Tremor React components for UI

**Backend:**
- Next.js API Routes (serverless functions)
- Prisma 6.19.0 (ORM)
- PostgreSQL (Neon database)
- NextAuth 4.24.13 (authentication)

**Data Layer:**
- BigQuery for analytics data
- Neon PostgreSQL for user data, goals, and feedback

## Filter Structure

The dashboard uses a comprehensive filter system that should be fully serializable for presets. The filter structure consists of two main parts:

### 1. DashboardFilters (Primary Filters)

```typescript
interface DashboardFilters {
  startDate: string;                    // ISO date string YYYY-MM-DD
  endDate: string;                      // ISO date string YYYY-MM-DD
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90';
  year: number;                          // e.g., 2026
  channel: string | null;                // Single channel selection
  source: string | null;                 // Single source selection
  sga: string | null;                    // Single SGA selection
  sgm: string | null;                    // Single SGM selection
  stage: string | null;                  // Opportunity stage
  experimentationTag: string | null;      // A/B test tag
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;      // Optional advanced filters (see below)
}
```

### 2. AdvancedFilters (Granular Filters)

```typescript
interface AdvancedFilters {
  // Date range filters
  initialCallScheduled: DateRangeFilter;
  qualificationCallDate: DateRangeFilter;
  
  // Multi-select filters
  channels: MultiSelectFilter;
  sources: MultiSelectFilter;
  sgas: MultiSelectFilter;
  sgms: MultiSelectFilter;
  experimentationTags: MultiSelectFilter;
}

interface DateRangeFilter {
  enabled: boolean;
  preset: 'any' | 'qtd' | 'ytd' | 'custom';
  startDate: string | null;  // ISO date string YYYY-MM-DD
  endDate: string | null;   // ISO date string YYYY-MM-DD
}

interface MultiSelectFilter {
  selectAll: boolean;
  selected: string[];  // Array of selected values
}
```

### Key Requirements for Filter Storage

1. **Future-proof design**: The preset system must be able to save ANY combination of current filters AND accommodate new filters added in the future without breaking existing presets.

2. **Complete state capture**: Presets should capture the entire filter state, including:
   - All primary filters (date ranges, channels, sources, SGAs, SGMs, stages, etc.)
   - All advanced filters (initial call dates, qualification call dates, multi-selects)
   - View mode preferences (if applicable)
   - Any other filter-related state

3. **JSONB storage**: Since the filter structure is complex and may evolve, storing the entire `DashboardFilters` object (including `advancedFilters`) as JSONB in the database is the recommended approach. This allows:
   - Flexibility to add new filter types without schema migrations
   - Backward compatibility with existing presets
   - Easy serialization/deserialization

## Future Scope

### Admin-Created Templates

**Requirement**: Administrators should be able to create "template" reports that all users can access.

**Implementation considerations:**
- Templates should be stored in the same table with a flag indicating they're templates
- Templates should be visible to all users in a separate section of the dropdown
- Templates should be read-only for non-admin users (they can apply them but not modify)
- Admins should be able to update templates, which will affect all users who have that template applied
- Consider a `preset_type` field: `'user' | 'admin_template'` or use a `created_by` field with a special admin user ID

### Sharing Presets (Future Enhancement)

While not in initial scope, the schema should support future sharing capabilities:
- Presets could be shared between team members
- Presets could be shared within specific groups/roles
- Consider adding a `visibility` field: `'private' | 'shared' | 'public'`

## Default Behavior

### User Default Presets

**Requirement**: Users should be able to set a default preset report that automatically loads when they visit the dashboard.

**Implementation:**
- Add `is_default BOOLEAN DEFAULT false` to the presets table
- Only one preset per user can be `is_default = true` at a time
- When a user sets a new default, the previous default should be automatically unset
- On dashboard load:
  - If user has a default preset → automatically apply those filters
  - If no default preset → load the current default view (existing behavior)

### Dashboard Load Logic

```typescript
// Pseudo-code for dashboard initialization
1. Check if user is authenticated
2. If authenticated:
   a. Fetch user's default preset (if exists)
   b. If default preset exists → apply those filters
   c. If no default preset → use current default view logic
3. If not authenticated → use current default view logic
```

## Database Schema Recommendation

Based on the requirements above, here's the recommended Prisma schema:

```prisma
model FilterPreset {
  id            String   @id @default(cuid())
  userId        String?  // NULL for admin templates, user ID for user presets
  name          String   @db.VarChar(255)
  filters       Json     // Store complete DashboardFilters object as JSONB
  dashboard     String   @default("funnel_performance") // Future: support other dashboards
  presetType    String   @default("user") // "user" | "admin_template"
  isDefault     Boolean  @default(false)
  isActive      Boolean  @default(true) // Soft delete capability
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdBy     String?  // Email of user who created (for admin templates, tracks admin)
  
  // Relations
  user          User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([presetType])
  @@index([isDefault])
  @@index([isActive])
  @@unique([userId, isDefault], where: { isDefault: true, isActive: true }) // Only one default per user
}
```

**Schema Notes:**
- `userId` is nullable to support admin templates (NULL = template available to all)
- `filters` is JSON type (Prisma maps to PostgreSQL JSONB)
- `presetType` distinguishes user presets from admin templates
- Unique constraint ensures only one default preset per user
- Soft delete via `isActive` allows recovery if needed

## Additional Implementation Considerations

### API Endpoints Needed

1. **GET /api/filter-presets** - List user's presets + admin templates
2. **GET /api/filter-presets/[id]** - Get specific preset
3. **POST /api/filter-presets** - Create new preset
4. **PUT /api/filter-presets/[id]** - Update preset
5. **DELETE /api/filter-presets/[id]** - Delete preset (soft delete)
6. **POST /api/filter-presets/[id]/set-default** - Set as default preset
7. **GET /api/filter-presets/default** - Get user's default preset

### UI Components Needed

1. **Preset Dropdown** - Add to GlobalFilters component
   - Shows user presets at top
   - Shows admin templates in a separate section
   - Shows "Set as Default" option for user presets
   - Shows "Save Current Filters" button

2. **Save Preset Modal** - For creating/editing presets
   - Name input field
   - Preview of current filters
   - "Set as default" checkbox
   - Save/Cancel buttons

3. **Preset Management** - Optional settings page
   - List all user presets
   - Edit/Delete/Set default actions
   - For admins: manage templates

### Data Migration Considerations

- Existing users will have no presets initially (expected)
- Default behavior should gracefully handle missing presets
- Consider adding a migration to create a few default admin templates for common use cases

### Security Considerations

- Users can only create/edit/delete their own presets
- Admins can create/edit/delete templates
- Users cannot modify admin templates (read-only)
- Validate filter structure on save to prevent malformed data
- Sanitize preset names to prevent XSS

### Performance Considerations

- Index on `userId` and `isDefault` for fast default preset lookup
- Cache user's default preset in session if possible
- Lazy load preset list (only fetch when dropdown is opened)

## Example Filter JSON Structure

Here's an example of what the `filters` JSONB field would contain:

```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-01-20",
  "datePreset": "qtd",
  "year": 2026,
  "channel": null,
  "source": null,
  "sga": "John Doe",
  "sgm": null,
  "stage": null,
  "experimentationTag": null,
  "metricFilter": "all",
  "advancedFilters": {
    "initialCallScheduled": {
      "enabled": false,
      "preset": "any",
      "startDate": null,
      "endDate": null
    },
    "qualificationCallDate": {
      "enabled": true,
      "preset": "custom",
      "startDate": "2026-01-01",
      "endDate": "2026-01-20"
    },
    "channels": {
      "selectAll": true,
      "selected": []
    },
    "sources": {
      "selectAll": false,
      "selected": ["Web", "Paid Search"]
    },
    "sgas": {
      "selectAll": true,
      "selected": []
    },
    "sgms": {
      "selectAll": true,
      "selected": []
    },
    "experimentationTags": {
      "selectAll": true,
      "selected": []
    }
  }
}
```

This structure is flexible enough to accommodate:
- Current filter types
- Future filter additions
- Partial filter states (some filters may be null/empty)
- Backward compatibility as the filter structure evolves
