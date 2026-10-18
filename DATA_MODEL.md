# Data model

Everything planmyfuture saves, what each field means, and how it maps to a future backend.

> The site used to be called *My Future Planner*. The storage keys (`future-planner-…`), the export file's `"app": "my-future-planner"` and the calendar event IDs keep that old name on purpose: changing them would lose saved data, break older export files and duplicate calendar events.

Today all of it lives in the browser's `localStorage`. The code reads it **once at startup** into one in-memory `state` object (`store.js`), and every change goes through **one `save()` function**. Swapping `localStorage` for a server only changes that file.

Dates are text in `YYYY-MM-DD` form (for example `2026-11-18`), or `YYYY-MM` when only the month is known. IDs are strings: new ones are UUIDs from `crypto.randomUUID()`. Universities saved before the switch keep their old number IDs, stored as text (for example `"1712345678901"`).

---

## 1. University

Saved as a list under `future-planner-universities`. One entry per university and course.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique ID (UUID) |
| `name` | string | University name, as you typed it |
| `course` | string | Course or programme |
| `city`, `country` | string | Where the course is taught |
| `lat`, `lng` | number | Position of the globe pin |
| `deadline` | date or `""` | The deadline in the form. **Your** deadline: always shown. |
| `requirements` | string | Entry requirements |
| `applicationInfo` | string | How to apply |
| `courseDescription` | string | Short course description |
| `notes` | string | Important notes |
| `pros`, `cons` | string | One point per line |
| `website` | URL or `""` | Official website (from Wikidata) |
| `about` | string | Short description (from Wikipedia) |
| `sources` | URL[] | Pages auto-fill used (up to 3) |
| `verified` | boolean | Every source was on the official website |
| `aiSearched` | boolean | Auto-fill searched with Claude |
| `intake` | `YYYY-MM` or `""` | The start date the dates were searched for |
| `applicationDates` | ApplicationDate[] | Every date auto-fill found (section 2) |
| `rolling` | boolean | The university uses rolling admissions |
| `firstChoice` | boolean | Starred as first choice (gold pin). At most one university. |

### Which deadline wins?
The form's `deadline` is yours, so it always counts. `applicationDates` are suggestions from auto-fill; they appear on the Timeline after **Generate Timeline**. If a found deadline has the same date as `deadline`, it's shown once.

## 2. Application date (found by auto-fill)

Inside `university.applicationDates`.

| Field | Type | Meaning |
|---|---|---|
| `label` | string | e.g. `Round 1`, `Scholarship deadline`, `Course starts` |
| `campus` | string | e.g. `Paris`, or `""` if the same for every campus |
| `date` | date or `YYYY-MM` | When |
| `approximate` | boolean | `true` when only the month is known |
| `type` | `opens` \| `deadline` \| `decision` \| `start` \| `other` | What kind of date. The auto-fill experiment's version B can also find `test`, `interview`, `documents` and `enrolment` |
| `sourceUrl` | URL or `""` | Page it came from |
| `appliesTo` | string, optional | Who the date is for, e.g. `international applicants`. Only version B of the experiment finds this; left out when it's for everyone |

These have no stored ID. The Timeline identifies one by `type|campus|label|date` in lower case (for example `deadline|paris|round 1|2026-11-18`). That's the value stored in `targetId` and `removedDates`. The deadline from the form uses the ID `official`.

## 3. Timeline entry

Saved as an object under `future-planner-timeline`, keyed by university `id`. One per university.

| Field | Type | Meaning |
|---|---|---|
| `status` | `researching` \| `applying` \| `submitted` \| `offer` \| `rejected` | Application status |
| `plannedDate` | date or `""` | Your planned submission date (slider / date box) |
| `targetId` | string | The deadline you chose (an application-date ID, `official`, or a manual date's `id`), or `""` |
| `generated` | boolean | You clicked Generate Timeline (auto-fill's dates are shown) |
| `manualDates` | ManualDate[] | Dates you added yourself |
| `removedDates` | string[] | IDs of found dates you deleted |
| `milestones` | { [key]: Milestone } | Your checklist (section 4) |
| `updatedAt` | number | When it last changed (milliseconds since 1970) |

**ManualDate**: `{ id: UUID, label, campus, date, type }`, with the same `type` values as section 2.

## 4. Milestone

Inside `timeline[id].milestones`, one for each of these keys, in order:
`testsBooked`, `statementDrafted`, `referencesRequested`, `statementFinal`, `referencesReceived`, `formFilled`, `finalReview`, `submission`.

| Field | Type | Meaning |
|---|---|---|
| `done` | boolean | Ticked |
| `date` | date or `""` | Target date |
| `auto` | boolean | `true` if counted back from your planned date (moves when you move it). Dates you type are `false` and never move. |

## 5. Profile texts

One text per key, saved under `future-planner-profile-<key>`:
`personal`, `achievements`, `statement` (limit 4,000 characters), `notes`, `snippets`.

## 6. Academic profile

Saved under `future-planner-academic-profile`. It's sent with every auto-fill search.

| Field | Type | Meaning |
|---|---|---|
| `intendedStartDate` | `YYYY-MM` or `""` | When you want to start |
| `currentGradeLevel` | string | e.g. `Year 13 (Grade 12)` |
| `schoolSystem` | string | e.g. `IB`, `A-levels`, `Abitur` |
| `countryOfResidence` | string | e.g. `Germany` (also the start of the globe's "arcs from home") |

## 7. Settings

| Key | Shape | Meaning |
|---|---|---|
| `future-planner-globe-settings` | `{ spin, borders, arcs, glow }` (booleans) | The globe's ⚙️ switches |
| `future-planner-home-place` | `{ country, lat, lng }` | Cached map position of your home country |
| `future-planner-claude-key` | text | Your Claude API key. **Secret, never exported.** Moves to the server with the backend. |
| `future-planner-search-cache` | `{ [key]: { version, savedAt, found, about, details } }` | Remembered auto-fill searches (7 days, up to 30). A cache, not your data. |
| `future-planner-timeline-version` | number | Which one-time data updates have run |

---

## Export file (`planmyfuture-YYYY-MM-DD.json`)

**Export my data** saves your data in this shape, and **Import data** reads it back. It's also how your data will move into the backend.

```json
{
  "app": "my-future-planner",
  "version": 1,
  "exportedAt": "2026-10-09T10:00:00.000Z",
  "universities": [ /* section 1 */ ],
  "timeline": { "<university id>": { /* section 3 */ } },
  "profile": { "personal": "", "achievements": "", "statement": "", "notes": "", "snippets": "" },
  "academicProfile": { /* section 6 */ },
  "settings": { "globe": { /* section 7 */ } }
}
```

The API key and the search cache are never exported.

**Import data** checks the file first: `app` must be `my-future-planner`, `version` must not be newer than the app's, and `universities` must be a list. Unknown fields in the profile and settings are dropped. Importing **replaces** everything saved in the browser except the API key, and asks first if anything is there.

## Updating old data (and retiring that code)

Data saved by older versions is updated to the current format once, at startup, by `upgradeOldData()` in `main.js`. Imports run through it too. It covers:

- number IDs turned into text
- `admissionsRounds` / `admissionsType` / `recommendedWindow` turned into `applicationDates` and `rolling` (`migrateUniversity`)
- old timeline entries (`TimelineStore.migrate`)
- marking timelines that existed before **Generate Timeline** as generated (`markExistingGenerated`, `timeline-version` 2)

An exported file is always in the current format. Once everyone's data has been exported and re-imported (or moved to the backend), these updates can be deleted, leaving `upgradeOldData()` empty.

---

## Backend (Supabase)

The database setup is in [`supabase/schema.sql`](supabase/schema.sql). There is **one table, `planner_data`, with one row per person**, holding the same parts as the export file:

| Column | Type | Holds |
|---|---|---|
| `user_id` | uuid (key) | The signed-in person (Supabase Auth) |
| `universities` | jsonb | Section 1 (with 2 inside) |
| `timeline` | jsonb | Sections 3 and 4 |
| `profile` | jsonb | Section 5 |
| `academic_profile` | jsonb | Section 6 |
| `settings` | jsonb | `{ globe }` from section 7. Never the API key. |
| `updated_at` | timestamptz | When it last changed |

Row Level Security means each person can only read and change their own row.

### How syncing works (`sync.js`)
- **Signed out:** only the browser's copy (`localStorage`) is used.
- **Signed in:** the browser keeps its copy, and every change is also sent to the account (the whole row, about 1 second after the last change).
- **Opening the site signed in** loads the account's copy. If the account can't be reached within 6 seconds, the browser's copy is used and the header says **Not synced**.
- **First time a browser connects** (`future-planner-owner` is empty): if the browser already has a planner, it's **merged** into the account: universities the account doesn't have are added, and empty profile boxes are filled. Nothing is thrown away.
- **Sign out:** waiting changes are sent first, then the planner is removed from the browser (the API key and globe settings stay).
- **Coming back to the tab** loads changes made on another device.
- `future-planner-owner` (browser only) remembers which account the browser's copy belongs to, so one person's planner is never added to someone else's account. Separate tables (universities, milestones, …) can come later if the planner ever needs to search or share across people.

**Account notes (Supabase Auth `user_metadata`):** `has_password: true` once the account has a password (set at sign-up, on a password sign-in, or when saving one). Accounts made with the old email link don't have it, so the account window offers "Set a password" only to them.

**Deleting an account:** the database function `delete_my_account()` ([`supabase/delete-account.sql`](supabase/delete-account.sql)) deletes the caller's `planner_data` row and their login. It runs with the database owner's rights but only ever deletes the person calling it. The website then signs out and removes everything planmyfuture saved in the browser.

Still to come: a shared `search_cache` table and a daily auto-fill limit, when auto-fill moves to the server.
