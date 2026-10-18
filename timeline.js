// =========================================================
// PLANMYFUTURE - APPLICATION TIMELINE
//
// This file builds the Timeline tab. It loads last, after the other files
// and reuses things from it: the `universities` list, DataStore,
// STORAGE_KEYS, parseDate, daysUntil, formatDate, sortByDeadline,
// makeElement, makeIcon, refreshIcons, showToast, intakeLabel, the
// application date helpers (itemText, itemEndDate, cleanDateItem,
// DATE_TYPES) and, from dates.js (section 3b), the shared timeline
// data: MILESTONES, TimelineStore, cardDates, findTarget, todayText,
// isDateText and isPastItem.
//
// The Timeline SHOWS you information. It doesn't choose for you:
// every date auto-fill found is listed, you pick a target deadline
// (if you want one) and drag the slider to your planned date.
//
// Sections in this file:
//   1. Settings (statuses)
//   2. Date helpers
//   3. Timeline cards
//   4. The timeline bar with a slider
//   5. The summary at the top
//   6. Calendar export (.ics files)
//   7. Drawing the page
// =========================================================


// =========================================================
// 1. SETTINGS
// =========================================================

const STATUSES = [
  { key: "researching", label: "Researching" },
  { key: "applying",    label: "Applying" },
  { key: "submitted",   label: "Submitted" },
  { key: "offer",       label: "Offer" },
  { key: "rejected",    label: "Rejected" },
];

// Once an application is in one of these states, deadlines no longer matter
const FINISHED_STATUSES = ["submitted", "offer", "rejected"];

// Names for the date types (in the list and the "Add date" form)
const DATE_TYPE_LABELS = {
  deadline: "Deadline",
  opens: "Applications open",
  decision: "Decision / results",
  start: "Course starts",
  other: "Other",
  // Only found by auto-fill version B (the experiment); not in the "Add date" form
  test: "Test",
  interview: "Interview",
  documents: "Documents",
  enrolment: "Enrolment",
};


// =========================================================
// 2. DATE HELPERS
// (More are in dates.js, section 3b.)
// =========================================================

const DAY = 24 * 60 * 60 * 1000;

// "2026-10-08" plus 3 days -> "2026-10-11" (use a negative number to go back)
function addDays(dateText, days) {
  const date = parseDate(dateText);
  date.setDate(date.getDate() + days);
  return toDateText(date);
}

// Number of days from one date to another
function daysBetween(fromText, toText) {
  return Math.round((parseDate(toText) - parseDate(fromText)) / DAY);
}

function laterDate(a, b) { return a > b ? a : b; }

// "2026-10-08" -> "8 Oct"
function shortDate(dateText) {
  return parseDate(dateText).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// "in 5 days", "today", "3 days ago"
function relativeDays(dateText) {
  const days = daysUntil(dateText);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return "in " + days + " days";
  return Math.abs(days) + (days === -1 ? " day ago" : " days ago");
}

// Where a date sits on the timeline bar. A month on its own goes in the middle.
function itemBarDate(item) {
  return item.approximate ? item.date + "-15" : item.date;
}


// =========================================================
// 3. TIMELINE CARDS
// One card per university. When something changes, only the
// parts that depend on it are redrawn (so the box you're typing
// in keeps its place).
// =========================================================

// Give dates to the milestones, counting back from YOUR planned date.
// If there's less time than ideal, every step is squeezed in proportion.
// Only counted-back dates (or empty ones) are changed: dates you typed
// yourself are never moved.
function scheduleMilestones(entry, submitDate) {
  const today = todayText();
  const window = Math.max(daysBetween(today, submitDate), 0);
  let longest = 0;
  MILESTONES.forEach(function (milestone) {
    if (!entry.milestones[milestone.key].done) longest = Math.max(longest, milestone.daysBefore);
  });
  const squeeze = longest > window && longest > 0 ? window / longest : 1;

  MILESTONES.forEach(function (milestone) {
    const state = entry.milestones[milestone.key];
    if (state.done || (state.date && !state.auto)) return;
    state.date = laterDate(today, addDays(submitDate, -Math.round(milestone.daysBefore * squeeze)));
    state.auto = true;
  });
}

// Which cards are open. Kept while the page is open, so a card stays
// open when the Timeline is redrawn (for example after switching tabs).
const openCards = new Set();

function buildCard(uni) {
  const entry = TimelineStore.get(uni.id);
  const idPrefix = "tl-" + uni.id + "-";

  const card = makeElement("article", "card tl-card");
  card.dataset.id = uni.id;

  function save() {
    TimelineStore.save(uni.id, entry);
    drawSummary();
  }

  // Save the change, then redraw the parts of the card that show it
  function saveAndRefresh() {
    save();
    refresh();
  }

  // Set your planned date (from the slider or the date box)
  function setPlannedDate(dateText) {
    entry.plannedDate = isDateText(dateText) ? dateText : "";
    if (entry.plannedDate) {
      scheduleMilestones(entry, entry.plannedDate);   // count back from your date
      updateMilestoneInputs();
    }
  }

  // ----- Summary row (always visible): name, course, deadline, planned
  // date, status and an arrow. Clicking it opens or closes the details. -----
  const summary = makeElement("button", "tl-summary");
  summary.type = "button";
  summary.setAttribute("aria-controls", idPrefix + "details");

  const titles = makeElement("span", "tl-titles");
  titles.append(
    makeElement("span", "tl-name", uni.name),
    makeElement("span", "tl-course", uni.course + " · " + uni.city + ", " + uni.country +
      (uni.intake ? " · For " + intakeLabel(uni.intake) + " entry" : ""))
  );

  // One small "label + value" pair, e.g. DEADLINE / 18 Nov 2026
  function makeFact(label) {
    const fact = makeElement("span", "tl-fact");
    const value = makeElement("strong", "tl-fact-value");
    fact.append(makeElement("span", "tl-fact-label", label), value);
    return { fact: fact, value: value };
  }
  const deadlineFact = makeFact("Deadline");
  const plannedFact = makeFact("Planned");
  const facts = makeElement("span", "tl-facts");
  facts.append(deadlineFact.fact, plannedFact.fact);

  const statusLabel = makeElement("span", "tl-status-label");
  const chevron = makeElement("span", "tl-chevron");
  chevron.append(makeIcon("chevron-down"));

  summary.append(titles, facts, statusLabel, chevron);

  // Fill in the summary. plannedText lets the slider show the date while
  // you're still dragging (before it's saved).
  function updateSummary(plannedText) {
    const dates = cardDates(uni, entry);
    const deadline = findTarget(dates, entry) ||
      dates.find(function (item) { return item.type === "deadline" && !isPastItem(item); }) || null;
    deadlineFact.value.textContent = deadline ? itemDateText(deadline) : "None yet";
    deadlineFact.fact.title = deadline ? itemText(deadline) : "";
    deadlineFact.value.classList.toggle("is-empty", !deadline);

    const planned = plannedText !== undefined ? plannedText : entry.plannedDate;
    plannedFact.value.textContent = planned ? formatDate(planned) : "Not set";
    plannedFact.value.classList.toggle("is-empty", !planned);

    const status = STATUSES.find(function (s) { return s.key === entry.status; }) || STATUSES[0];
    statusLabel.textContent = status.label;
  }

  // ----- Status (inside the details) -----
  const statusRow = makeElement("div", "tl-status-row");
  const statusText = makeElement("label", "tl-date-label", "Status");
  statusText.htmlFor = idPrefix + "status";

  const statusSelect = document.createElement("select");
  statusSelect.className = "status-select";
  statusSelect.id = idPrefix + "status";
  statusSelect.setAttribute("aria-label", "Application status for " + uni.name);
  STATUSES.forEach(function (status) {
    const option = document.createElement("option");
    option.value = status.key;
    option.textContent = status.label;
    statusSelect.append(option);
  });
  statusSelect.value = entry.status;
  statusSelect.addEventListener("change", function () {
    entry.status = statusSelect.value;
    saveAndRefresh();
  });

  statusRow.append(statusText, statusSelect);

  // ----- Left side: the dates, then the timeline bar -----
  const left = makeElement("div", "tl-left");

  const datesHeading = makeElement("h4", "eyebrow", "Application dates");

  // "Timeline not generated yet" + Generate Timeline / Clear Timeline.
  // Nothing is filled in until you click Generate Timeline.
  const generateBox = makeElement("div", "tl-generate");
  const dateList = makeElement("ul", "tl-date-list");
  const dateTools = makeElement("div", "tl-date-tools");   // add / restore buttons and the add form

  // One short line, only for rolling admissions
  const rollingLine = makeElement("p", "tl-rolling");
  rollingLine.append(makeIcon("info"), "Rolling admissions: earlier is better.");
  rollingLine.hidden = !uni.rolling;

  // Planned submission date: the slider and the date box
  const planBox = makeElement("div", "tl-plan");
  const plannedRow = makeElement("div", "tl-planned-row");
  const plannedLabel = makeElement("label", "tl-date-label", "Planned submission");
  plannedLabel.htmlFor = idPrefix + "planned";
  const plannedInput = document.createElement("input");
  plannedInput.type = "date";
  plannedInput.id = idPrefix + "planned";
  plannedInput.value = entry.plannedDate;
  plannedInput.addEventListener("change", function () {
    setPlannedDate(plannedInput.value);
    saveAndRefresh();
  });
  plannedRow.append(plannedLabel, plannedInput);

  const barHolder = makeElement("div");
  const warning = makeElement("p", "tl-warning");
  warning.setAttribute("role", "status");
  planBox.append(plannedRow, barHolder, warning);

  left.append(datesHeading, generateBox, dateList, dateTools, rollingLine, planBox);

  // Generate Timeline: add every date auto-fill found for this university.
  // (The deadline from the Universities tab is always shown.) Dates you
  // added, your planned date and your milestones are never changed.
  function generateTimeline() {
    entry.generated = true;
    saveAndRefresh();
    const found = (uni.applicationDates || []).length;
    if (found === 0) {
      showToast("Auto-fill found no dates for " + uni.name + ". Add dates yourself, or use Search again on the Universities tab.", "circle-alert");
    } else {
      showToast("Timeline generated for " + uni.name + ".");
    }
  }

  // Clear Timeline: take the found dates off again (your own dates stay)
  function clearTimeline() {
    entry.generated = false;
    entry.removedDates = [];
    const ownTarget = entry.manualDates.some(function (d) { return d.id === entry.targetId; });
    if (!ownTarget) entry.targetId = "";
    saveAndRefresh();
    showToast("Cleared the generated dates for " + uni.name + ". Your own dates and plans were kept.");
  }

  function drawGenerateBox() {
    generateBox.innerHTML = "";
    if (!entry.generated) {
      generateBox.append(makeElement("p", "tl-generate-message", "Timeline not generated yet"));
    }
    const generateButton = makeElement("button", "button button-small button-primary");
    generateButton.type = "button";
    generateButton.append(makeIcon("sparkles"), "Generate Timeline");
    generateButton.addEventListener("click", generateTimeline);
    generateBox.append(generateButton);

    if (entry.generated) {
      const clearButton = makeElement("button", "button button-small");
      clearButton.type = "button";
      clearButton.append(makeIcon("eraser"), "Clear Timeline");
      clearButton.addEventListener("click", clearTimeline);
      generateBox.append(clearButton);
    }
  }

  // Show a small warning if your planned date is after the deadline you chose
  function updateWarning(dateText, target) {
    const late = Boolean(target && dateText && dateText > itemEndDate(target));
    warning.hidden = !late;
    warning.innerHTML = "";
    if (late) {
      warning.append(makeIcon("triangle-alert"), "Your planned date is after your target deadline (" + itemText(target) + ").");
      refreshIcons();
    }
  }

  // The list of dates
  function drawDates(dates, target) {
    dateList.innerHTML = "";
    if (dates.length === 0 && entry.generated) {
      dateList.append(makeElement("li", "tl-date-empty muted", "No application dates found yet. Add one below."));
    }

    dates.forEach(function (item) {
      const isDeadline = item.type === "deadline";
      const isTarget = Boolean(target && target.id === item.id);
      const row = makeElement("li", "tl-date-item tl-type-" + item.type +
        (isPastItem(item) ? " is-past" : "") + (isTarget ? " is-target" : ""));

      // Deadlines are buttons: click to choose one as your target, click again to unselect
      const main = makeElement(isDeadline ? "button" : "span", "tl-date-main");
      main.append(makeElement("i", "tl-dot"), makeElement("span", "tl-date-text", itemText(item)));
      if (isDeadline) {
        main.type = "button";
        main.setAttribute("aria-pressed", String(isTarget));
        main.title = isTarget ? "Your target. Click to unselect." : "Click to make this your target deadline";
        main.addEventListener("click", function () {
          entry.targetId = isTarget ? "" : item.id;
          saveAndRefresh();
        });
        if (isTarget) main.append(makeElement("span", "tl-target-badge", "Target"));
      } else {
        main.append(makeElement("span", "tl-type-tag", DATE_TYPE_LABELS[item.type]));
      }
      row.append(main);

      if (item.sourceUrl) {
        const source = document.createElement("a");
        source.className = "tl-date-source";
        source.href = item.sourceUrl;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        source.title = "Open the page this date came from";
        source.setAttribute("aria-label", "Source for " + itemText(item));
        source.append(makeIcon("external-link"));
        row.append(source);
      }

      const remove = makeElement("button", "tl-date-remove");
      remove.type = "button";
      remove.title = "Delete this date";
      remove.setAttribute("aria-label", "Delete " + itemText(item));
      remove.append(makeIcon("x"));
      remove.addEventListener("click", function () {
        if (item.manual) {
          entry.manualDates = entry.manualDates.filter(function (d) { return d.id !== item.id; });
        } else {
          entry.removedDates.push(item.id);
        }
        if (entry.targetId === item.id) entry.targetId = "";
        saveAndRefresh();
      });
      row.append(remove);

      dateList.append(row);
    });

    // A short hint while no deadline is chosen
    if (!target && dates.some(function (item) { return item.type === "deadline"; })) {
      dateList.append(makeElement("li", "tl-date-hint", "Tap a deadline to make it your target."));
    }
  }

  // "Add date" and "Restore deleted dates"
  function drawDateTools() {
    dateTools.innerHTML = "";

    const addButton = makeElement("button", "tl-add-date");
    addButton.type = "button";
    addButton.append(makeIcon("plus"), "Add date");
    dateTools.append(addButton);

    if (entry.removedDates.length > 0) {
      const restore = makeElement("button", "tl-add-date");
      restore.type = "button";
      restore.append(makeIcon("rotate-ccw"),
        "Restore " + entry.removedDates.length + (entry.removedDates.length === 1 ? " deleted date" : " deleted dates"));
      restore.addEventListener("click", function () {
        entry.removedDates = [];
        saveAndRefresh();
      });
      dateTools.append(restore);
    }

    // A small form for adding a date yourself
    const addForm = makeElement("div", "tl-add-form");
    addForm.hidden = true;
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "e.g. Round 2";
    nameInput.maxLength = 60;
    nameInput.setAttribute("aria-label", "Date name");
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.setAttribute("aria-label", "Date");
    const typeSelect = document.createElement("select");
    typeSelect.setAttribute("aria-label", "Type of date");
    DATE_TYPES.forEach(function (type) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = DATE_TYPE_LABELS[type];
      typeSelect.append(option);
    });
    const saveButton = makeElement("button", "button button-small", "Add");
    saveButton.type = "button";
    saveButton.addEventListener("click", function () {
      if (!isDateText(dateInput.value)) {
        showToast("Pick the date first.", "circle-alert");
        return;
      }
      entry.manualDates.push({ id: newId(), label: nameInput.value.trim() || DATE_TYPE_LABELS[typeSelect.value],
        campus: "", date: dateInput.value, type: typeSelect.value });
      saveAndRefresh();
    });
    const cancelButton = makeElement("button", "button button-small", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", function () {
      addForm.hidden = true;
      addButton.hidden = false;
    });
    addForm.append(nameInput, dateInput, typeSelect, saveButton, cancelButton);

    addButton.addEventListener("click", function () {
      addButton.hidden = true;
      addForm.hidden = false;
      nameInput.focus();
    });
    dateTools.append(addForm);
  }

  // ----- Right side: the milestone checklist -----
  const right = makeElement("div", "tl-right");
  const milestoneHeader = makeElement("div", "tl-milestone-header");
  const progressText = makeElement("span", "tl-progress-text");
  milestoneHeader.append(makeElement("h4", "eyebrow", "Milestones"), progressText);

  const progressBar = makeElement("div", "meter");
  const progressFill = makeElement("div", "meter-fill");
  progressBar.append(progressFill);

  const list = makeElement("ul", "tl-milestones");
  const rows = {};
  MILESTONES.forEach(function (milestone) {
    const state = entry.milestones[milestone.key];
    const row = makeElement("li", "tl-milestone");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = idPrefix + milestone.key;
    checkbox.checked = state.done;
    checkbox.addEventListener("change", function () {
      state.done = checkbox.checked;
      saveAndRefresh();
    });

    const label = makeElement("label", "tl-milestone-label", milestone.label);
    label.htmlFor = checkbox.id;

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "tl-milestone-date";
    dateInput.value = state.date;
    dateInput.setAttribute("aria-label", "Target date for " + milestone.label);
    dateInput.addEventListener("change", function () {
      state.date = isDateText(dateInput.value) ? dateInput.value : "";
      state.auto = false;   // you set it, so it won't be moved
      saveAndRefresh();
    });

    row.append(checkbox, label, dateInput);
    list.append(row);
    rows[milestone.key] = { row: row, dateInput: dateInput };
  });

  function updateMilestoneInputs() {
    MILESTONES.forEach(function (milestone) {
      rows[milestone.key].dateInput.value = entry.milestones[milestone.key].date;
    });
  }

  function updateMilestoneProgress() {
    const doneCount = MILESTONES.filter(function (m) { return entry.milestones[m.key].done; }).length;
    progressText.textContent = doneCount + " of " + MILESTONES.length + " done";
    progressFill.style.width = (doneCount / MILESTONES.length) * 100 + "%";

    // Mark done steps, and steps whose date has passed without being done
    MILESTONES.forEach(function (milestone) {
      const state = entry.milestones[milestone.key];
      const overdue = !state.done && state.date && daysUntil(state.date) < 0;
      rows[milestone.key].row.classList.toggle("is-done", state.done);
      rows[milestone.key].row.classList.toggle("is-overdue", Boolean(overdue));
    });
  }

  right.append(milestoneHeader, progressBar, list);

  // ----- Footer: calendar export -----
  const footer = makeElement("div", "tl-footer");
  const exportButton = makeElement("button", "button button-small");
  exportButton.type = "button";
  exportButton.append(makeIcon("calendar-plus"), "Export to calendar");
  exportButton.addEventListener("click", function () {
    exportCalendar([uni], slugify(uni.name) + "-timeline.ics");
  });
  footer.append(exportButton);

  // ----- Put the card together -----
  // The details slide open below the summary (style.css section 21)
  const body = makeElement("div", "tl-body");
  body.append(left, right);
  const details = makeElement("div", "tl-details");
  details.id = idPrefix + "details";
  const detailsInner = makeElement("div", "tl-details-inner");
  detailsInner.append(statusRow, body, footer);
  details.append(detailsInner);
  card.append(summary, details);

  // Open or close the details. "inert" stops the hidden parts from being
  // reached with the keyboard while closed.
  function setOpen(open) {
    card.classList.toggle("is-open", open);
    summary.setAttribute("aria-expanded", String(open));
    details.inert = !open;
    if (open) openCards.add(uni.id);
    else openCards.delete(uni.id);
  }
  summary.addEventListener("click", function () {
    setOpen(!card.classList.contains("is-open"));
  });
  setOpen(openCards.has(uni.id));

  // Redraw everything that depends on the saved data
  function refresh() {
    const dates = cardDates(uni, entry);
    const target = findTarget(dates, entry);

    // Status color on the card and the dropdown
    STATUSES.forEach(function (status) {
      card.classList.toggle("status-" + status.key, entry.status === status.key);
    });

    updateSummary();
    drawGenerateBox();
    drawDates(dates, target);
    drawDateTools();

    plannedInput.value = entry.plannedDate;
    barHolder.innerHTML = "";
    barHolder.append(buildTimelineBar(uni, dates, target, entry, {
      // While dragging: show the date and the warning, but don't save yet
      preview: function (dateText) {
        plannedInput.value = dateText;
        updateSummary(dateText);
        updateWarning(dateText, target);
      },
      // When you let go (or press an arrow key): save it
      commit: function (dateText) {
        setPlannedDate(dateText);
        plannedInput.value = entry.plannedDate;
        updateWarning(entry.plannedDate, target);
        updateMilestoneProgress();
        updateSummary();
        save();
      },
    }));
    updateWarning(entry.plannedDate, target);

    updateMilestoneProgress();
    refreshIcons();
  }

  refresh();
  return card;
}


// =========================================================
// 4. THE TIMELINE BAR WITH A SLIDER
// A bar from today to the latest date found. Every date is a dot
// (deadlines are red diamonds). Hover or tap a dot to see what it is.
// Drag the handle to set your planned submission date: it snaps to
// whole days. Works with a mouse, a finger, or the arrow keys.
// =========================================================

function buildTimelineBar(uni, dates, target, entry, actions) {
  const box = makeElement("div", "tl-bar-box");
  const today = todayText();

  // Dates still to come (past dates are only in the list, greyed out)
  const upcoming = dates.filter(function (item) { return !isPastItem(item); });

  // The bar runs from today to the latest date, plus a little extra
  // so you can drag past the last deadline (at least 30 days long)
  let latest = today;
  upcoming.forEach(function (item) { latest = laterDate(latest, itemBarDate(item)); });
  if (entry.plannedDate) latest = laterDate(latest, entry.plannedDate);
  const span = daysBetween(today, latest);
  const end = addDays(today, Math.max(span + Math.max(14, Math.round(span * 0.08)), 30));
  const totalDays = daysBetween(today, end);

  // Where a date sits on the bar, as a percentage from the left
  function position(dateText) {
    const days = Math.min(Math.max(daysBetween(today, dateText), 0), totalDays);
    return (days / totalDays) * 100;
  }

  const bar = makeElement("div", "tl-bar");
  const inner = makeElement("div", "tl-bar-inner");   // the part dates are placed on
  const fill = makeElement("div", "tl-bar-fill");     // today -> your planned date
  inner.append(makeElement("div", "tl-bar-line"), fill);

  // "Today" at the start
  const todayMark = makeElement("span", "tl-bar-today");
  todayMark.append(makeElement("span", "tl-bar-today-label", "Today"));
  inner.append(todayMark);

  // A dot for each date. Dates on the same day share one dot.
  const groups = [];
  upcoming.forEach(function (item) {
    const date = laterDate(itemBarDate(item), today);
    const group = groups.find(function (g) { return g.date === date; });
    if (group) group.items.push(item);
    else groups.push({ date: date, items: [item] });
  });
  groups.forEach(function (group) {
    const hasDeadline = group.items.some(function (item) { return item.type === "deadline"; });
    const hasTarget = Boolean(target) && group.items.some(function (item) { return item.id === target.id; });
    const marker = makeElement("button", "tl-bar-marker" + (hasDeadline ? " is-deadline" : "") + (hasTarget ? " is-target" : ""));
    marker.type = "button";
    const left = position(group.date);
    marker.style.left = left + "%";
    // Keep the label inside the card near the ends
    if (left > 70) marker.classList.add("tip-left");
    if (left < 30) marker.classList.add("tip-right");
    const text = group.items.map(itemText).join("\n");
    marker.setAttribute("aria-label", text);
    marker.append(makeElement("span", "tl-bar-tip", text));
    inner.append(marker);
  });

  // The handle you drag
  const handle = makeElement("div", "tl-bar-handle");
  handle.tabIndex = 0;
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-label", "Planned submission date for " + uni.name);
  handle.setAttribute("aria-valuemin", "0");
  handle.setAttribute("aria-valuemax", String(totalDays));
  const bubble = makeElement("span", "tl-bar-bubble");
  handle.append(bubble);
  inner.append(handle);

  bar.append(inner);

  // Scale under the bar
  const scale = makeElement("div", "tl-bar-scale");
  scale.append(makeElement("span", "", shortDate(today)), makeElement("span", "", formatDate(end)));

  // Move the handle to a date (without saving)
  let current = entry.plannedDate;
  function show(dateText) {
    current = dateText;
    const isSet = Boolean(dateText);
    const left = isSet ? position(dateText) : 0;
    handle.style.left = left + "%";
    fill.style.width = left + "%";
    handle.classList.toggle("is-unset", !isSet);
    bubble.textContent = isSet ? formatDate(dateText) : "Drag to plan";
    handle.setAttribute("aria-valuenow", String(isSet ? Math.max(daysBetween(today, dateText), 0) : 0));
    handle.setAttribute("aria-valuetext", isSet ? formatDate(dateText) : "Not set");
    // Keep the bubble inside the card near the ends
    bubble.classList.toggle("is-start", left < 12);
    bubble.classList.toggle("is-end", left > 88);
  }
  show(entry.plannedDate);

  // A point on the screen -> the nearest whole day
  function dateAt(clientX) {
    const rect = inner.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return addDays(today, Math.round(fraction * totalDays));
  }

  // Dragging (pointer events cover mouse, touch and pen)
  let dragging = false;
  bar.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Tapping a dot shows what it is instead of moving the handle
    if (event.target.closest(".tl-bar-marker")) return;
    dragging = true;
    bar.setPointerCapture(event.pointerId);
    bar.classList.add("is-dragging");
    show(dateAt(event.clientX));
    actions.preview(current);
    handle.focus({ preventScroll: true });
    event.preventDefault();
  });
  bar.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    const date = dateAt(event.clientX);
    if (date !== current) {
      show(date);
      actions.preview(current);
    }
  });
  function stopDragging() {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove("is-dragging");
    actions.commit(current);
  }
  bar.addEventListener("pointerup", stopDragging);
  bar.addEventListener("pointercancel", stopDragging);

  // Keyboard: arrows move one day, Page Up/Down one week
  handle.addEventListener("keydown", function (event) {
    const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 7, PageDown: -7 };
    let date = null;
    if (event.key in steps) {
      date = addDays(current || today, steps[event.key]);
      if (date < today) date = today;
      if (date > end) date = end;
    } else if (event.key === "Home") {
      date = today;
    } else if (event.key === "End") {
      date = end;
    }
    if (!date) return;
    event.preventDefault();
    show(date);
    actions.commit(date);
  });

  // Small key under the bar
  const legend = makeElement("div", "tl-bar-legend");
  const keyItem = function (className, text) {
    const item = makeElement("span", "");
    item.append(makeElement("i", className), text);
    return item;
  };
  legend.append(keyItem("tl-key tl-key-deadline", "Deadline"), keyItem("tl-key", "Other date"),
    keyItem("tl-key tl-key-planned", "Your planned date"));

  box.append(bar, scale, legend);
  return box;
}


// =========================================================
// 5. THE SUMMARY AT THE TOP
// How many applications are at each status, and what's next.
// =========================================================

const timelineSummary = document.getElementById("timeline-summary");

function drawSummary() {
  timelineSummary.innerHTML = "";
  if (state.universities.length === 0) return;

  const upcoming = [];   // things still to do, with a date
  let overdue = 0;
  const counts = {};

  state.universities.forEach(function (uni) {
    const entry = TimelineStore.get(uni.id);
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    if (FINISHED_STATUSES.indexOf(entry.status) !== -1) return;

    MILESTONES.forEach(function (milestone) {
      const state = entry.milestones[milestone.key];
      if (state.done || !state.date) return;
      if (daysUntil(state.date) < 0) overdue++;
      else upcoming.push({ date: state.date, text: milestone.label, uni: uni });
    });

    if (entry.plannedDate && daysUntil(entry.plannedDate) >= 0) {
      upcoming.push({ date: entry.plannedDate, text: "Planned submission", uni: uni });
    }

    // The deadline you chose
    const target = findTarget(cardDates(uni, entry), entry);
    if (target && !target.approximate && daysUntil(target.date) >= 0) {
      upcoming.push({ date: target.date, text: "Target deadline", uni: uni });
    }
  });

  // Status counts, e.g. "2 Applying"
  const chips = makeElement("div", "tl-status-counts");
  STATUSES.forEach(function (status) {
    if (!counts[status.key]) return;
    chips.append(makeElement("span", "tl-count status-" + status.key, counts[status.key] + " " + status.label));
  });

  // The next thing to do
  const next = makeElement("div", "tl-next");
  upcoming.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (upcoming.length > 0) {
    const item = upcoming[0];
    next.append(makeIcon("flag"), makeElement("span", "",
      "Next up: " + item.text + " for " + item.uni.name + ", " + relativeDays(item.date) + " (" + shortDate(item.date) + ")"));
  } else {
    next.append(makeIcon("info"), makeElement("span", "", "Open a card and drag its slider to set your planned date."));
  }
  if (overdue > 0) {
    next.append(makeElement("span", "tl-overdue-count", overdue + (overdue === 1 ? " step overdue" : " steps overdue")));
  }

  timelineSummary.append(chips, next);
  refreshIcons();
}


// =========================================================
// 6. CALENDAR EXPORT (.ics FILES)
// An .ics file is a standard calendar file. Opening it adds the
// events to Apple Calendar, Google Calendar or Outlook.
// Each event is all-day, with a reminder at 9am the day before.
// =========================================================

// Special characters must be escaped in .ics text
function icsText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines in an .ics file may be at most 75 bytes long. Longer lines are
// split, and each extra piece starts with a space.
function icsFoldLine(line) {
  const encoder = new TextEncoder();
  const pieces = [];
  let current = "";
  for (const character of line) {
    const limit = pieces.length === 0 ? 75 : 74; // the space takes one byte
    if (encoder.encode(current + character).length > limit) {
      pieces.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  pieces.push(current);
  return pieces.join("\r\n ");
}

// The events for one university: upcoming deadlines (with an exact day),
// your planned date and unfinished milestones
function calendarEvents(uni) {
  const entry = TimelineStore.get(uni.id);
  const dates = cardDates(uni, entry);
  const target = findTarget(dates, entry);
  const events = [];
  const details = uni.course + " at " + uni.name;

  dates.forEach(function (item) {
    if (item.type !== "deadline" || item.approximate || item.date < todayText()) return;
    const name = [item.campus, item.label].filter(Boolean).join(" ");
    events.push({
      key: item.id === "official" ? "deadline" : "date-" + slugify(item.id),
      date: item.date,
      title: name + ": " + uni.name,
      description: name + " for " + details + "." + (target && target.id === item.id ? " This is your target deadline." : ""),
    });
  });
  if (entry.plannedDate) {
    events.push({ key: "planned", date: entry.plannedDate,
      title: "Submit: " + uni.name, description: "Your planned submission date for " + details + "." });
  }
  MILESTONES.forEach(function (milestone) {
    const state = entry.milestones[milestone.key];
    if (state.date && !state.done) {
      events.push({ key: milestone.key, date: state.date,
        title: milestone.label + " (" + uni.name + ")", description: "Application step for " + details + "." });
    }
  });

  return events.map(function (event) {
    event.uid = uni.id + "-" + event.key + "@my-future-planner";
    return event;
  });
}

function buildIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//planmyfuture//Application Timeline//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:University applications",
  ];

  events.forEach(function (event) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + event.uid,
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + event.date.replace(/-/g, ""),
      "DTEND;VALUE=DATE:" + addDays(event.date, 1).replace(/-/g, ""),
      "SUMMARY:" + icsText(event.title),
      "DESCRIPTION:" + icsText(event.description),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + icsText(event.title),
      "TRIGGER:-PT15H",   // 15 hours before midnight = 9am the day before
      "END:VALARM",
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}

// "University of Edinburgh" -> "university-of-edinburgh"
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "university";
}

// Make the .ics file and download it
function exportCalendar(unis, fileName) {
  let events = [];
  unis.forEach(function (uni) {
    events = events.concat(calendarEvents(uni));
  });

  if (events.length === 0) {
    showToast("No dates to export yet. Set a planned date or add a deadline first.", "circle-alert");
    return;
  }

  downloadFile(buildIcs(events), fileName, "text/calendar;charset=utf-8");   // in profile.js, section 14

  showToast("Saved " + events.length + (events.length === 1 ? " date" : " dates") +
    " to " + fileName + ". Open the file to add them to your calendar.", "calendar-check");
}


// =========================================================
// 7. DRAWING THE PAGE
// =========================================================

const timelineList = document.getElementById("timeline-list");
const timelineEmpty = document.getElementById("timeline-empty");

function drawTimeline() {
  // Forget timeline data for universities that were deleted
  TimelineStore.removeMissing(state.universities.map(function (uni) { return uni.id; }));

  timelineList.innerHTML = "";
  timelineEmpty.hidden = state.universities.length > 0;

  // Soonest date first (your planned date, chosen deadline or next deadline),
  // like the university list
  sortByDeadline(state.universities).forEach(function (uni) {
    timelineList.append(buildCard(uni));
  });

  drawSummary();
  refreshIcons();
}

// Redraw when universities are added, edited or deleted...
document.addEventListener("universities-changed", drawTimeline);

// ...and whenever the Timeline tab is opened (so "today" is always up to date)
document.addEventListener("tab-opened", function (event) {
  if (event.detail === "timeline-tab") drawTimeline();
});

document.getElementById("export-all-ics").addEventListener("click", function () {
  exportCalendar(state.universities, "university-applications.ics");
});

// Draw once the saved data has loaded (see startApp in main.js)
appReady.then(function (loaded) {
  if (loaded) drawTimeline();
});
