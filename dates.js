// =========================================================
// PLANMYFUTURE: dates.js
// Deadlines and "your date": the timeline data every page shares.
//
// Sections: 3. Deadlines, 3b. Your dates
// (The site's JavaScript is split into files that load in this order:
//  store.js, helpers.js, dates.js, globe.js, autofill.js, universities.js,
//  profile.js, auth.js, sync.js, main.js, timeline.js. The section numbers run across all of them.)
// =========================================================

// =========================================================
// 3. DEADLINES
// Works out how many days are left and picks a color level:
//   "later"  = green  (45+ days)
//   "soon"   = amber  (15 to 44 days)
//   "urgent" = red    (under 15 days)
//   "none"   = gray   (no date, or already passed)
// =========================================================

// Turn "2027-01-15" into a date. We split it ourselves so the
// date doesn't shift because of time zones.
function parseDate(text) {
  const parts = text.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function daysUntil(dateText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDate(dateText) - today) / millisecondsPerDay);
}

// Show a date in a friendly way, e.g. "15 Jan 2027"
// Always "6 Nov 2026": the month as a word, so nobody reads 06/11 as 11 June
function formatDate(dateText) {
  return parseDate(dateText).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "12-16 Oct 2026", "20 Jul - 28 Sep 2026" or "28 Dec 2026 - 3 Jan 2027"
function formatDateRange(startText, endText) {
  const start = parseDate(startText);
  const end = parseDate(endText);
  if (start.getFullYear() !== end.getFullYear()) return formatDate(startText) + " \u2013 " + formatDate(endText);
  const month = function (d) { return d.toLocaleDateString("en-GB", { month: "short" }); };
  if (start.getMonth() === end.getMonth()) return start.getDate() + "\u2013" + formatDate(endText);
  return start.getDate() + " " + month(start) + " \u2013 " + formatDate(endText);
}

function getDeadlineStatus(dateText) {
  if (!dateText) {
    return { level: "none", label: "No deadline" };
  }

  const days = daysUntil(dateText);

  if (days < 0) return { level: "none", label: "Closed", days: days };
  if (days === 0) return { level: "urgent", label: "Due today", days: days };

  const label = days === 1 ? "1 day left" : days + " days left";
  if (days < 15) return { level: "urgent", label: label, days: days };
  if (days < 45) return { level: "soon", label: label, days: days };
  return { level: "later", label: label, days: days };
}

// Soonest date first (your date, see getMyDate); universities without one go last
function sortByDeadline(list) {
  const dates = {};
  list.forEach(function (uni) { dates[uni.id] = getMyDate(uni).date; });
  return list.slice().sort(function (a, b) {
    if (!dates[a.id]) return dates[b.id] ? 1 : 0;
    if (!dates[b.id]) return -1;
    return dates[a.id] < dates[b.id] ? -1 : dates[a.id] > dates[b.id] ? 1 : 0;
  });
}


// =========================================================
// 3b. YOUR DATES (shared by every page)
// The Timeline tab saves your planned date, the deadline you chose
// and dates you added. This section reads them, so the map, the
// university list and the Timeline all show the same date:
// getMyDate(uni) is the one place that decides which date that is.
// =========================================================

// The steps of an application.
//   daysBefore: ideally done this many days before your planned date
const MILESTONES = [
  { key: "testsBooked",         label: "Tests booked",               daysBefore: 56 },
  { key: "statementDrafted",    label: "Personal statement drafted", daysBefore: 42 },
  { key: "referencesRequested", label: "References requested",       daysBefore: 42 },
  { key: "statementFinal",      label: "Personal statement final",   daysBefore: 14 },
  { key: "referencesReceived",  label: "References received",        daysBefore: 10 },
  { key: "formFilled",          label: "Online application filled",  daysBefore: 7 },
  { key: "finalReview",         label: "Final review",               daysBefore: 3 },
  { key: "submission",          label: "Submission day",             daysBefore: 0 },
];

// ----- Saving and loading timeline data -----
// Timeline data is saved separately from the universities, one entry
// per university (found by the university's id). One entry looks like this:
// {
//   plannedDate: "2026-11-10",     your planned submission date, or ""
//   status: "applying",            one of the STATUSES keys
//   targetId: "deadline|paris|round 1|2026-11-18",
//                                  the deadline you chose, or "" for none
//   generated: true,               true once you've clicked Generate Timeline
//                                  (until then, auto-fill's dates aren't shown)
//   manualDates: [                 dates you added yourself
//     { id: "3b241101-e2bb-...", label: "Scholarship", campus: "", date: "2027-01-10", type: "deadline" }
//   ],
//   removedDates: ["opens||applications open|2026-09-01"],
//                                  ids of found dates you deleted
//   milestones: {
//     statementDrafted: { done: true, date: "2026-10-01", auto: false },
//     ...one for every milestone. auto = true if the date was counted back
//     from your planned date, so it moves when you move that date.
//     Dates you type yourself are never moved.
//   },
//   updatedAt: 1791500000000       when it was last changed
// }
//
// BACKEND: this matches an "applications" table with a university_id
// column (manualDates can be its own "application_dates" table).
// Replace the insides of TimelineStore with fetch() calls.

// Timeline entries live in state.timeline (section 1); this reads and
// changes them, and saves through save("timeline").
const TimelineStore = {
  readAll: function () {
    return state.timeline;
  },

  // Get one university's entry, with every field filled in
  // (so the rest of the code never has to check for missing parts)
  get: function (uniId) {
    const saved = TimelineStore.readAll()[uniId] || {};
    const savedMilestones = saved.milestones || {};

    const milestones = {};
    MILESTONES.forEach(function (milestone) {
      const old = savedMilestones[milestone.key] || {};
      milestones[milestone.key] = { done: Boolean(old.done), date: isDateText(old.date) ? old.date : "", auto: Boolean(old.auto) };
    });

    return {
      plannedDate: isDateText(saved.plannedDate) ? saved.plannedDate : "",
      status: saved.status || "researching",
      targetId: typeof saved.targetId === "string" ? saved.targetId : "",
      generated: saved.generated === true,   // true once you've clicked Generate Timeline
      // Copies, so changes only count once they're saved
      manualDates: Array.isArray(saved.manualDates) ? saved.manualDates.slice() : [],
      removedDates: Array.isArray(saved.removedDates) ? saved.removedDates.slice() : [],
      milestones: milestones,
      updatedAt: saved.updatedAt || null,
    };
  },

  save: function (uniId, entry) {
    entry.updatedAt = Date.now();
    state.timeline[uniId] = entry;
    save("timeline");
  },

  // Remove entries for universities that have been deleted
  removeMissing: function (existingIds) {
    const all = TimelineStore.readAll();
    let changed = false;
    Object.keys(all).forEach(function (id) {
      if (existingIds.indexOf(String(id)) === -1) {
        delete all[id];
        changed = true;
      }
    });
    if (changed) save("timeline");
  },

  // Entries saved by the old planner had a recommended plan in them.
  // Keep your status, milestones and any planned date you typed;
  // drop the planner's own choices (target round, campus, dates it picked).
  // Rounds you added yourself become dates you added yourself.
  migrate: function () {
    const all = TimelineStore.readAll();
    let changed = false;

    Object.keys(all).forEach(function (id) {
      const old = all[id] || {};
      const isOld = ["plannedAuto", "targetRound", "campus", "manualRounds"].some(function (key) { return key in old; });
      if (!isOld) return;

      const milestones = old.milestones || {};
      if (old.plannedAuto) {
        // The planner chose that date, not you: forget it and the
        // milestone dates it counted back from it
        Object.keys(milestones).forEach(function (key) {
          if (milestones[key] && milestones[key].auto) milestones[key].date = "";
        });
      }

      all[id] = {
        plannedDate: old.plannedAuto ? "" : old.plannedDate || "",
        status: old.status || "researching",
        targetId: "",
        generated: true,
        manualDates: (Array.isArray(old.manualRounds) ? old.manualRounds : []).map(function (round, index) {
          const item = cleanDateItem({ label: round.label, date: round.date, type: "deadline" });
          if (item) item.id = round.key || "m" + index;
          return item;
        }).filter(Boolean),
        removedDates: [],
        milestones: milestones,
        updatedAt: old.updatedAt || null,
      };
      changed = true;
    });

    if (changed) save("timeline");
  },

  // The Timeline used to show auto-fill's dates straight away. Now you
  // click "Generate Timeline" first. Universities you added before that
  // change keep their timelines: this marks them as generated, once.
  markExistingGenerated: function (uniIds) {
    if (state.meta.timelineVersion >= 2) return;
    const all = TimelineStore.readAll();
    uniIds.forEach(function (id) {
      all[id] = all[id] || {};
      if (!("generated" in all[id])) all[id].generated = true;
    });
    state.meta.timelineVersion = 2;
    save("timeline");
    save("meta");
  },
};


// ----- Date helpers -----
// Dates are kept as "YYYY-MM-DD" text. Text dates in this format
// can be compared directly ("2026-11-01" < "2026-12-01").

// A date -> "2026-10-08"
function toDateText(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function todayText() {
  return toDateText(new Date());
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

// A date that has gone completely (a month counts as gone once it's over)
function isPastItem(item) {
  return itemEndDate(item) < todayText();
}

// ----- The dates for one university -----
// The deadline from the Universities tab and the dates you added, plus
// (once you've clicked Generate Timeline) every date auto-fill found.
// Dates you deleted are left out.
// Each one gets an id so it can be chosen or deleted.

function autoDateId(item) {
  return [item.type, item.campus, item.label, item.date].join("|").toLowerCase();
}

function cardDates(uni, entry) {
  const dates = [];
  // Before you click Generate Timeline, only your own dates are used
  const found = entry.generated ? uni.applicationDates || [] : [];

  found.forEach(function (raw) {
    const item = cleanDateItem(raw);
    if (!item) return;
    item.id = autoDateId(item);
    if (!dates.some(function (d) { return d.id === item.id; })) dates.push(item);
  });

  // The deadline on the Universities tab, if it isn't in the list already.
  // It's yours (you can type it in the form), so it always counts, even
  // before you click Generate Timeline.
  if (isDateText(uni.deadline) && !dates.some(function (d) { return d.type === "deadline" && d.date === uni.deadline; })) {
    dates.push({ id: "official", label: "Application deadline", campus: "", date: uni.deadline,
      type: "deadline", sourceUrl: (uni.sources && uni.sources[0]) || "", approximate: false });
  }

  entry.manualDates.forEach(function (raw) {
    const item = cleanDateItem(raw);
    if (!item) return;
    item.id = raw.id;
    item.manual = true;
    dates.push(item);
  });

  return sortDateItems(dates.filter(function (item) {
    return entry.removedDates.indexOf(item.id) === -1;
  }));
}

// The deadline you chose, or null
function findTarget(dates, entry) {
  return dates.find(function (item) { return item.id === entry.targetId && item.type === "deadline"; }) || null;
}


// ----- Your date: the one date every page shows -----
// In this order:
//   1. your planned submission date (slider or date box)  -> "Planned"
//   2. the deadline you chose on the Timeline              -> "Deadline"
//   3. the next upcoming deadline auto-fill found          -> "Next deadline"
//   4. nothing                                             -> "No date yet"
// Returns {
//   kind: "planned" | "deadline" | "next" | "none",
//   label: "Planned",
//   date: "2026-11-02"        (for counting days and sorting; "" if none)
//   dateText: "2 Nov 2026"    (how to show it; months say "approx.")
//   deadline: the hard limit to show underneath (your chosen deadline,
//             otherwise the next one), or null
// }
function getMyDate(uni) {
  const entry = TimelineStore.get(uni.id);
  const dates = cardDates(uni, entry);
  const target = findTarget(dates, entry);
  const next = dates.find(function (item) { return item.type === "deadline" && !isPastItem(item); }) || null;
  const deadline = target || next;

  if (entry.plannedDate) {
    return { kind: "planned", label: "Planned", date: entry.plannedDate, dateText: formatDate(entry.plannedDate), deadline: deadline };
  }
  if (deadline) {
    return { kind: target ? "deadline" : "next", label: target ? "Deadline" : "Next deadline",
      date: itemEndDate(deadline), dateText: itemDateText(deadline), deadline: deadline };
  }
  return { kind: "none", label: "No date yet", date: "", dateText: "", deadline: null };
}

// Days left and a color level for your date (like getDeadlineStatus).
// A planned date that has passed is "Overdue"; a deadline that has passed is "Closed".
function getMyDateStatus(myDate) {
  if (!myDate.date) return { level: "none", label: "No date yet" };
  const status = getDeadlineStatus(myDate.date);
  if (status.days < 0 && myDate.kind === "planned") return { level: "urgent", label: "Overdue", days: status.days };
  return status;
}

function makeMyDateChip(myDate) {
  const status = getMyDateStatus(myDate);
  return makeElement("span", "chip level-" + status.level, status.label);
}

// The two lines of text for your date, e.g.
//   main: "Planned · 2 Nov 2026"
//   sub:  "Deadline: Paris · Round 1 · 18 Nov 2026"
// For a deadline, sub says which one it is ("Paris · Round 1").
function describeMyDate(myDate) {
  if (myDate.kind === "none") return { main: "", sub: "" };   // the chip already says "No date yet"
  const main = myDate.label + " · " + myDate.dateText;
  if (myDate.kind === "planned") {
    return { main: main, sub: myDate.deadline ? "Deadline: " + itemText(myDate.deadline) : "" };
  }
  const item = myDate.deadline;
  return { main: main, sub: [item.campus, item.label].filter(Boolean).join(" · ") };
}
