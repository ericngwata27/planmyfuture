// =========================================================
// PLANMYFUTURE: universities.js
// The Universities page: the form, the list, the details panel and the stats.
//
// Sections: 8. The form, 9. The list, 10. The details panel, 11. Summary stats
// (The site's JavaScript is split into files that load in this order:
//  store.js, helpers.js, dates.js, globe.js, autofill.js, universities.js,
//  profile.js, auth.js, sync.js, main.js, timeline.js. The section numbers run across all of them.)
// =========================================================

// =========================================================
// 8. THE FORM (with validation and auto-fill)
// =========================================================

const form = document.getElementById("uni-form");
const formCard = document.getElementById("form-card");
const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const formMessage = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");
const submitIcon = document.getElementById("submit-icon");
const submitLabel = document.getElementById("submit-label");
const searchAgainButton = document.getElementById("search-again");
const cancelEditButton = document.getElementById("cancel-edit");
const foundSection = document.getElementById("found-section");
const lookupStatus = document.getElementById("lookup-status");

// Which data property goes with which input box (by its id)
const fields = {
  name: "name",
  course: "course",
  city: "city",
  country: "country",
  deadline: "deadline",
  requirements: "requirements",
  applicationInfo: "application-info",
  courseDescription: "course-description",
  notes: "notes",
  pros: "pros",
  cons: "cons",
};

// The boxes that the search fills in
const AUTO_FIELDS = ["city", "country", "deadline", "requirements", "applicationInfo", "courseDescription", "notes"];

// The result of the last search (null means no search yet)
let lookup = null;

function readForm() {
  const data = {};
  for (const key in fields) {
    data[key] = document.getElementById(fields[key]).value.trim();
  }
  return data;
}

function fillForm(uni) {
  for (const key in fields) {
    document.getElementById(fields[key]).value = uni[key] || "";
  }
}

// The main button changes depending on what happens next:
// "find" = Find details, "add" = Add to map, "save" = Save changes
function setSubmitMode(mode) {
  const icons = { find: "search", add: "plus", save: "check" };
  const labels = { find: "Find details", add: "Add to map", save: "Save changes" };
  submitIcon.innerHTML = '<i data-lucide="' + icons[mode] + '"></i>';
  submitLabel.textContent = labels[mode];
  refreshIcons();
}

// Fill one auto-filled box, and mark it as found or missing
function setAutoField(key, value, wasSearched) {
  const input = document.getElementById(fields[key]);
  const field = input.closest(".field");
  input.value = value || "";
  field.classList.toggle("is-filled", Boolean(value));
  field.classList.toggle("is-missing", !value);

  if (key === "city" || key === "country") {
    input.placeholder = "Not found. Please type it in.";
  } else if (wasSearched) {
    input.placeholder = "Not published";
  } else {
    input.placeholder = "Not looked up. Add it yourself, or turn on AI search in Auto-fill settings.";
  }
}

function clearAutoFieldMarks() {
  AUTO_FIELDS.forEach(function (key) {
    const input = document.getElementById(fields[key]);
    input.closest(".field").classList.remove("is-filled", "is-missing");
    input.placeholder = "";
  });
}

// ----- The loading animation -----
function showSteps(steps, activeIndex) {
  const list = makeElement("ul", "lookup-steps");
  steps.forEach(function (text, index) {
    const item = makeElement("li");
    if (index < activeIndex) {
      item.className = "is-done";
      item.append(makeIcon("check"));
    } else if (index === activeIndex) {
      item.className = "is-active";
      item.append(makeElement("span", "spinner"));
    } else {
      item.append(makeElement("span", "step-dot"));
    }
    item.append(makeElement("span", "", text));
    list.append(item);
  });

  lookupStatus.innerHTML = "";
  lookupStatus.append(list, makeElement("div", "shimmer-bar"));
  lookupStatus.hidden = false;
  refreshIcons();
}

// ----- The label shown after a search -----
function showLookupResult(result, errorText, cachedAt) {
  const box = makeElement("div", "lookup-result");
  const badge = makeElement("span", "source-badge");
  let message = "";

  if (result.verified) {
    badge.classList.add("is-verified");
    badge.append(makeIcon("shield-check"), "Verified from official sources");
    message = "Everything below comes from " + result.domain + ". Double-check important details there before you apply.";
  } else if (result.aiSearched) {
    badge.classList.add("is-partial");
    badge.append(makeIcon("info"), "From web sources, not verified");
    message = "Some details came from sites other than the official one. Check them on the university's website.";
  } else if (result.foundOnWikidata) {
    badge.classList.add("is-partial");
    badge.append(makeIcon("info"), "Location found");
    message = "We found the location and website. Add a Claude API key in Auto-fill settings to also look up deadlines and entry requirements.";
  } else {
    box.classList.add("is-error");
    badge.classList.add("is-partial");
    badge.append(makeIcon("circle-alert"), "University not found");
    message = "Check the spelling of the university's name, or type the city and country below yourself.";
  }

  box.append(badge, makeElement("p", "", message));
  // Found information can be wrong (see terms.html), so always say where to check
  if (result.aiSearched || result.foundOnWikidata) {
    box.append(makeElement("p", "autofill-disclaimer", "Always confirm deadlines on the official university website."));
  }
  if (cachedAt) {
    box.append(makeElement("p", "", "Saved search from " +
      new Date(cachedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      ", so it was free. Use Search again for the latest details."));
  }
  if (errorText) {
    const error = makeElement("p", "", errorText);
    error.style.color = "var(--red)";
    box.append(error);
  }
  // Only in the experiment (?autofill=A or ?autofill=B in the address)
  if (result.experiment) box.append(experimentResult(result, cachedAt));

  lookupStatus.innerHTML = "";
  lookupStatus.append(box);
  lookupStatus.hidden = false;
  refreshIcons();
}

// ----- The auto-fill experiment's results (see autofill.js, "The A/B experiment") -----
// Under the result: what the search cost and how long it took, then every
// date found (passed ones labelled), and a button that copies it all for
// the Excel sheet, where each date is scored by hand against the screenshots.

// "Passed" if the date is before today (a month on its own: once the month is over)
function experimentStatus(item) {
  return itemEndDate(item) < todayText() ? "Passed" : "Upcoming";
}

// One run as tab-separated rows (Excel puts each part in its own column)
function experimentRows(result, cachedAt) {
  const run = result.experiment;
  const usage = run.usage || {};
  const runAt = new Date(cachedAt || Date.now()).toISOString();
  const header = ["Version", "Run at", "University", "Course", "Admissions cycle", "Type", "Campus", "Name", "Applies to",
    "Date", "Status", "Source", "Runtime (s)", "Searches", "Pages fetched", "Input tokens", "Output tokens", "Cost (USD)"];
  const runParts = [
    usage.runtimeMs ? (usage.runtimeMs / 1000).toFixed(1) : "", usage.searches, usage.fetches,
    usage.inputTokens, usage.outputTokens, typeof usage.cost === "number" ? usage.cost.toFixed(4) : "",
  ];
  // (a run that found no dates still gets one row, so its cost and time are recorded)
  const dates = result.applicationDates.length ? result.applicationDates : [null];
  const rows = dates.map(function (item) {
    const parts = item
      ? [DATE_TYPE_LABELS[item.type] || item.type, item.campus, item.label, item.appliesTo || "", item.date, experimentStatus(item), item.sourceUrl]
      : ["(no dates found)", "", "", "", "", "", ""];
    return [run.version, runAt, result.name, result.course, run.cycle].concat(parts, runParts);
  });
  return [header].concat(rows).map(function (row) {
    return row.map(function (part) { return String(part === undefined || part === null ? "" : part).replace(/[\t\n]+/g, " "); }).join("\t");
  }).join("\n");
}

function experimentResult(result, cachedAt) {
  const run = result.experiment;
  const usage = run.usage;
  const panel = makeElement("div", "experiment-result");
  panel.style.marginTop = "12px";
  panel.append(makeElement("p", "", "Auto-fill experiment: version " + run.version +
    (cachedAt ? " (saved run, the numbers are from when it ran)" : "")));

  // What the search used, as reported by the Claude API
  const facts = makeElement("ul", "muted small experiment-usage");
  if (usage) {
    const number = function (value) { return Number(value || 0).toLocaleString(); };
    [
      "Total runtime: " + (usage.runtimeMs ? (usage.runtimeMs / 1000).toFixed(1) + " s" : "not measured"),
      "Searches performed: " + number(usage.searches),
      "Pages fetched: " + number(usage.fetches),
      "Input tokens: " + number(usage.inputTokens),
      "Output tokens: " + number(usage.outputTokens),
      "Estimated API cost: " + (typeof usage.cost === "number"
        ? "$" + usage.cost.toFixed(3) + " (" + usage.model + ", " + usage.requests + (usage.requests === 1 ? " request)" : " requests)")
        : "unknown (no price for " + usage.model + ")"),
    ].forEach(function (text) { facts.append(makeElement("li", "", text)); });
  } else {
    facts.append(makeElement("li", "", "No Claude search ran, so there's nothing to measure."));
  }
  panel.append(facts);

  if (run.cycle) panel.append(makeElement("p", "experiment-cycle", run.cycle));

  // Every date found
  const list = makeElement("ol", "small experiment-dates");
  result.applicationDates.forEach(function (item) {
    const row = makeElement("li", "", [DATE_TYPE_LABELS[item.type] || item.type, itemText(item),
      "Status: " + experimentStatus(item)].join(" · "));
    if (item.sourceUrl) {
      const link = makeElement("a", "", " source");
      link.href = item.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.append(link);
    }
    list.append(row);
  });
  if (result.aiSearched && result.applicationDates.length === 0) list.append(makeElement("li", "", "No dates found."));
  panel.append(list);

  const copy = makeElement("button", "button button-small experiment-copy", "Copy for Excel");
  copy.type = "button";
  copy.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(experimentRows(result, cachedAt));
      showToast("Copied. Paste it into the Excel sheet.", "copy");
    } catch (error) {
      showToast("Your browser didn't allow copying.", "circle-alert");
    }
  });
  panel.append(copy);
  return panel;
}

// ----- The "Find details" button -----
// Checks the form, shows progress while runAutoFill() works, then fills in the boxes.
// options.fresh = true skips remembered searches (used by "Search again")
async function lookUpUniversity(options) {
  const fresh = Boolean(options && options.fresh);
  const name = document.getElementById("name").value.trim();
  const course = document.getElementById("course").value.trim();

  clearAllErrors();
  if (name.length < 2 || course.length < 2) {
    if (name.length < 2) setFieldError("name", "Enter the university's name.");
    if (course.length < 2) setFieldError("course", "Enter the course you're interested in.");
    document.getElementById(name.length < 2 ? "name" : "course").focus();
    return;
  }

  const steps = hasAiSearch()
    ? ["Finding the university", "Searching the official website", "Filling in the form"]
    : ["Finding the university", "Filling in the form"];

  submitButton.disabled = true;
  searchAgainButton.disabled = true;
  showFormMessage("");
  showSteps(steps, 0);

  const answer = await runAutoFill({ name: name, course: course, fresh: fresh }, function (i) {
    showSteps(steps, i);
  });
  showSteps(steps, steps.length - 1);
  const result = answer.result;
  const details = answer.details;

  // Fill in the form
  foundSection.hidden = false;
  setAutoField("city", result.city, true);
  setAutoField("country", result.country, true);
  AUTO_FIELDS.slice(2).forEach(function (key) {
    setAutoField(key, details ? details[key] : "", result.aiSearched);
  });

  lookup = result;
  showLookupResult(result, answer.errorText, answer.cachedAt);
  submitButton.disabled = false;
  searchAgainButton.disabled = false;
  searchAgainButton.hidden = false;
  setSubmitMode(editingId ? "save" : "add");
}

searchAgainButton.addEventListener("click", function () {
  lookUpUniversity({ fresh: true });
});

// If you change the name or course after a search, the button goes back
// to "Find details" so the information matches what you typed
["name", "course"].forEach(function (id) {
  document.getElementById(id).addEventListener("input", function () {
    if (lookup && !editingId) {
      lookup = null;
      setSubmitMode("find");
    }
  });
});

// ----- Validation: show or clear a message under one field -----
function setFieldError(inputId, message) {
  const field = document.getElementById(inputId).closest(".field");
  field.classList.toggle("has-error", Boolean(message));
  document.getElementById(inputId + "-error").textContent = message || "";
}

function clearAllErrors() {
  ["name", "course", "city", "country", "deadline"].forEach(function (id) {
    setFieldError(id, "");
  });
}

// Check the form. Returns true if everything is OK.
function validateForm(data) {
  clearAllErrors();
  let firstProblem = null;

  function problem(inputId, message) {
    setFieldError(inputId, message);
    if (!firstProblem) firstProblem = inputId;
  }

  // Required fields
  if (data.name.length < 2) problem("name", "Enter the university's name.");
  if (data.course.length < 2) problem("course", "Enter the course you're interested in.");
  if (data.city.length < 2) problem("city", "We couldn't find the city automatically. Please type it in.");
  if (data.country.length < 2) problem("country", "We couldn't find the country automatically. Please type it in.");

  // The deadline is optional, but if there is one it must be a real date
  const deadlineInput = document.getElementById("deadline");
  if (deadlineInput.validity.badInput) {
    problem("deadline", "That date isn't complete. Pick a day, month and year.");
  } else if (data.deadline) {
    const year = Number(data.deadline.slice(0, 4));
    const oldUni = editingId ? findUniversity(editingId) : null;
    const isUnchanged = oldUni && oldUni.deadline === data.deadline;

    if (year < 2000 || year > 2100) {
      problem("deadline", "Check the year. It should look like " + new Date().getFullYear() + ".");
    } else if (daysUntil(data.deadline) < 0 && !isUnchanged) {
      problem("deadline", "That date has already passed. Check the deadline, or leave it empty.");
    }
  }

  // Move the cursor to the first field with a problem
  if (firstProblem) {
    document.getElementById(firstProblem).focus();
    return false;
  }
  return true;
}

// Clear a field's error as soon as you start fixing it
["name", "course", "city", "country", "deadline"].forEach(function (id) {
  document.getElementById(id).addEventListener("input", function () {
    setFieldError(id, "");
  });
});

function showFormMessage(text, type) {
  formMessage.textContent = text || "";
  formMessage.className = "form-message" + (type ? " is-" + type : "");
}

// ----- Edit mode -----
function startEditing(id) {
  const uni = findUniversity(id);
  editingId = id;
  lookup = null;
  fillForm(uni);
  clearAllErrors();
  clearAutoFieldMarks();
  showFormMessage("");

  formTitle.textContent = "Edit university";
  formSubtitle.textContent = "Changing " + uni.name + ". Use Search again to refresh the details.";
  setSubmitMode("save");
  foundSection.hidden = false;
  lookupStatus.hidden = true;
  searchAgainButton.hidden = false;
  cancelEditButton.hidden = false;
  formCard.classList.add("is-editing");

  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("name").focus({ preventScroll: true });
}

// Put the form back to its starting state
function stopEditing() {
  editingId = null;
  lookup = null;
  form.reset();
  clearAllErrors();
  clearAutoFieldMarks();

  formTitle.textContent = "Add a university";
  formSubtitle.textContent = "Type the university and course. We'll look up the rest.";
  setSubmitMode("find");
  foundSection.hidden = true;
  lookupStatus.hidden = true;
  searchAgainButton.hidden = true;
  cancelEditButton.hidden = true;
  formCard.classList.remove("is-editing");
}

cancelEditButton.addEventListener("click", function () {
  stopEditing();
  showFormMessage("");
});

// ----- Submitting the form -----
// First press (no search yet): run the search.
// Second press: save the university and add its pin.
form.addEventListener("submit", async function (event) {
  event.preventDefault(); // stop the page from reloading

  if (!lookup && !editingId) {
    await lookUpUniversity();
    return;
  }

  const data = readForm();
  if (!validateForm(data)) return;

  const oldUni = editingId ? findUniversity(editingId) : null;

  // Extra details from the search that don't have their own box
  if (lookup) {
    data.website = lookup.website;
    data.about = lookup.about;
    data.sources = lookup.sources;
    data.verified = lookup.verified;
    data.aiSearched = lookup.aiSearched;

    // Application dates (only from a Claude search, so a search
    // without an API key doesn't wipe out what an earlier search found)
    if (lookup.aiSearched) {
      data.applicationDates = lookup.applicationDates;
      data.rolling = lookup.rolling;
      data.intake = lookup.intake;
    }
  }

  // Where to put the pin:
  //  1. Wikidata's exact position, if the city and country weren't changed
  //  2. the old position, if editing and the place didn't change
  //  3. otherwise, look it up with the map search (as before)
  const placeUnchanged = oldUni &&
    oldUni.name === data.name && oldUni.city === data.city && oldUni.country === data.country;

  if (lookup && lookup.lat !== null && lookup.city === data.city && lookup.country === data.country) {
    data.lat = lookup.lat;
    data.lng = lookup.lng;
  } else if (placeUnchanged) {
    data.lat = oldUni.lat;
    data.lng = oldUni.lng;
  } else {
    submitButton.disabled = true;
    showFormMessage("Finding " + data.city + " on the map...", "working");

    try {
      const coords = await findCoordinates(data.name, data.city, data.country);
      if (!coords) {
        setFieldError("city", "We couldn't find this place. Check the spelling of the city and country.");
        showFormMessage("");
        document.getElementById("city").focus();
        return;
      }
      data.lat = coords.lat;
      data.lng = coords.lng;
    } catch (error) {
      showFormMessage("Couldn't reach the map search. Check your internet connection and try again.", "error");
      return;
    } finally {
      submitButton.disabled = false; // "finally" runs whether it worked or not
    }
  }

  let savedId;
  if (oldUni) {
    Object.assign(oldUni, data);       // copy the changes onto the existing one
    savedId = oldUni.id;
    showToast("Saved changes to " + data.name);
  } else {
    data.id = newId();                 // a unique id
    state.universities.push(data);
    savedId = data.id;
    newestId = data.id;                // so its card animates in
    showToast(data.name + " added to your map");
  }

  saveUniversities();
  stopEditing();
  showFormMessage("");
  selectUniversity(savedId, true);     // open its details and fly the map to it
});


// =========================================================
// 9. THE UNIVERSITY LIST
// =========================================================

const uniList = document.getElementById("uni-list");
const emptyList = document.getElementById("empty-list");

function drawList() {
  uniList.innerHTML = "";
  emptyList.hidden = state.universities.length > 0;

  sortByDeadline(state.universities).forEach(function (uni) {
    const myDate = getMyDate(uni);           // your planned date, chosen deadline or next deadline
    const status = getMyDateStatus(myDate);

    // The card. Its class sets the colored strip on the left.
    const card = makeElement("li", "uni-card level-" + status.level);
    card.dataset.id = uni.id;
    if (uni.id === selectedId) card.classList.add("is-selected");
    if (uni.id === newestId) card.classList.add("is-new");

    // The clickable main part: name, course, location, deadline
    const main = makeElement("button", "uni-card-main");
    main.title = "Show on the globe";

    const meta = makeElement("div", "uni-meta");
    const course = makeElement("span");
    course.append(makeIcon("book-open"), uni.course);
    const place = makeElement("span");
    place.append(makeIcon("map-pin"), uni.city + ", " + uni.country);
    meta.append(course, place);

    // e.g. [24 days left] Planned · 2 Nov 2026
    //      Deadline: Paris · Round 1 · 18 Nov 2026
    const text = describeMyDate(myDate);
    const deadline = makeElement("div", "uni-deadline");
    deadline.append(makeMyDateChip(myDate), makeElement("span", "", text.main));
    const deadlineSub = makeElement("div", "uni-deadline-sub", text.sub);
    deadlineSub.hidden = !text.sub;

    const nameRow = makeElement("span", "uni-name", uni.name);
    // a small green shield if the details came from the official website
    if (uni.verified) {
      const mark = makeElement("span", "verified-mark");
      mark.title = "Verified from official sources";
      mark.append(makeIcon("shield-check"));
      nameRow.append(mark);
    }

    main.append(nameRow, meta, deadline, deadlineSub);
    main.addEventListener("click", function () {
      selectUniversity(uni.id, true);
    });

    // Edit and delete buttons with icons
    const actions = makeElement("div", "uni-actions");

    const editButton = makeElement("button", "icon-button");
    editButton.title = "Edit";
    editButton.setAttribute("aria-label", "Edit " + uni.name);
    editButton.append(makeIcon("pencil"));
    editButton.addEventListener("click", function () {
      startEditing(uni.id);
    });

    const deleteButton = makeElement("button", "icon-button danger");
    deleteButton.title = "Delete";
    deleteButton.setAttribute("aria-label", "Delete " + uni.name);
    deleteButton.append(makeIcon("trash-2"));
    deleteButton.addEventListener("click", function () {
      deleteUniversity(uni.id);
    });

    actions.append(editButton, deleteButton);
    card.append(main, actions);
    uniList.appendChild(card);
  });

  newestId = null; // only animate a new card once
}

// Delete a university, with a short fade-out animation first
function deleteUniversity(id) {
  const uni = findUniversity(id);

  // confirm() shows a pop-up with OK and Cancel. It returns true for OK.
  if (!confirm("Delete " + uni.name + "? This can't be undone.")) return;

  const card = uniList.querySelector('[data-id="' + id + '"]');
  if (card) card.classList.add("is-leaving");

  // Wait for the animation (260ms) to finish, then really remove it
  setTimeout(function () {
    state.universities = state.universities.filter(function (u) {
      return u.id !== id;
    });
    if (editingId === id) stopEditing();
    if (selectedId === id) selectedId = null;

    saveUniversities();
    redrawEverything();
    showToast(uni.name + " removed", "trash-2");
  }, 260);
}


// =========================================================
// 10. THE DETAILS PANEL
// =========================================================

const detailsPanel = document.getElementById("details-panel");
const panelBody = document.getElementById("panel-body");

document.getElementById("close-panel").addEventListener("click", function () {
  selectedId = null;
  redrawEverything();
});

// Close the panel with the Escape key too
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && selectedId !== null) {
    selectedId = null;
    redrawEverything();
  }
});

// A row with an icon, e.g. [calendar icon] 15 Jan 2027
function makeFact(iconName, text) {
  const row = makeElement("div", "fact");
  row.append(makeIcon(iconName), makeElement("span", "", text));
  return row;
}

// A section with a small heading and some text.
// If the online search ran but found nothing, it says "Not published".
function makePanelSection(title, iconName, text, wasSearched) {
  const section = makeElement("div", "panel-section");
  const heading = makeElement("h4", "eyebrow");
  heading.append(makeIcon(iconName), title);

  let body;
  if (text) {
    body = makeElement("p", "", text);
  } else if (wasSearched) {
    body = makeElement("p", "not-published", "Not published");
  } else {
    body = makeElement("p", "empty-text", "Not added yet");
  }
  section.append(heading, body);
  return section;
}

// Every application date auto-fill found, one per line, e.g.
// "Paris · Round 1 · 18 Nov 2026"
function makeAdmissionsSection(uni) {
  const parts = (uni.applicationDates || []).map(itemText);
  if (uni.rolling) parts.push("Rolling admissions");
  if (uni.intake) parts.push("For " + intakeLabel(uni.intake) + " entry");

  const section = makeElement("div");
  if (parts.length > 0) {
    section.append(makePanelSection("Application dates", "calendar", parts.join("\n")));
  }
  return section;
}

// a link that opens in a new tab (only for normal web addresses)
function makeLink(url, text) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

// A colored box with a bullet list (used for pros and cons)
function makeListBox(className, title, iconName, text) {
  const box = makeElement("div", className);
  const heading = makeElement("h4", "eyebrow");
  heading.append(makeIcon(iconName), title);

  const lines = (text || "").split("\n").filter(function (line) {
    return line.trim() !== "";
  });

  box.append(heading);
  if (lines.length === 0) {
    box.append(makeElement("p", "empty-text", "None added"));
  } else {
    const list = document.createElement("ul");
    lines.forEach(function (line) {
      list.append(makeElement("li", "", line));
    });
    box.append(list);
  }
  return box;
}

function drawDetails() {
  const uni = findUniversity(selectedId);
  detailsPanel.classList.toggle("is-open", Boolean(uni));
  if (!uni) return;

  panelBody.innerHTML = "";

  // Your date chip and where the details came from
  const myDate = getMyDate(uni);
  const myDateText = describeMyDate(myDate);
  const statusRow = makeElement("div", "panel-badges");
  statusRow.append(makeMyDateChip(myDate));
  if (uni.verified) {
    const badge = makeElement("span", "source-badge is-verified");
    badge.append(makeIcon("shield-check"), "Verified from official sources");
    statusRow.append(badge);
  } else if (uni.aiSearched) {
    const badge = makeElement("span", "source-badge is-partial");
    badge.append(makeIcon("info"), "Not verified");
    statusRow.append(badge);
  }

  // Key facts
  const facts = makeElement("div", "panel-facts");
  facts.append(
    makeFact("map-pin", uni.city + ", " + uni.country),
    makeFact("calendar", myDateText.main || "No date yet")
  );
  if (myDateText.sub) facts.append(makeFact("flag", myDateText.sub));

  // link to the official website
  const website = safeUrl(uni.website);
  if (website) {
    const row = makeElement("div", "fact");
    row.append(makeIcon("external-link"), makeLink(website, getDomain(website)));
    facts.append(row);
  }

  // the pages the details came from
  const sourcesSection = makeElement("div", "panel-section");
  const sourceUrls = (uni.sources || []).map(safeUrl).filter(Boolean);
  if (sourceUrls.length > 0) {
    const heading = makeElement("h4", "eyebrow");
    heading.append(makeIcon("link"), "Sources");
    const list = makeElement("ul", "sources");
    sourceUrls.forEach(function (url) {
      const item = document.createElement("li");
      item.append(makeLink(url, url.replace(/^https?:\/\/(www\.)?/, "")));
      list.append(item);
    });
    sourcesSection.append(heading, list);
  }

  // the short description from Wikipedia
  const aboutSection = makeElement("div", "panel-section");
  if (uni.about) {
    const heading = makeElement("h4", "eyebrow");
    heading.append(makeIcon("info"), "About the university (Wikipedia)");
    aboutSection.append(heading, makeElement("p", "", uni.about));
  }

  // Pros and cons side by side
  const prosCons = makeElement("div", "pros-cons");
  prosCons.append(
    makeListBox("pros-box", "Pros", "thumbs-up", uni.pros),
    makeListBox("cons-box", "Cons", "thumbs-down", uni.cons)
  );

  // Edit and delete buttons
  const actions = makeElement("div", "panel-actions");
  const editButton = makeElement("button", "button");
  editButton.append(makeIcon("pencil"), "Edit");
  editButton.addEventListener("click", function () {
    startEditing(uni.id);
  });
  const deleteButton = makeElement("button", "button button-danger");
  deleteButton.append(makeIcon("trash-2"), "Delete");
  deleteButton.addEventListener("click", function () {
    deleteUniversity(uni.id);
  });
  // Star it as your first choice (gold pin on the globe). Only one at a time.
  const starButton = makeElement("button", "button" + (uni.firstChoice ? " is-first-choice" : ""));
  starButton.setAttribute("aria-pressed", String(Boolean(uni.firstChoice)));
  starButton.append(makeIcon("star"), uni.firstChoice ? "First choice" : "Mark as first choice");
  starButton.addEventListener("click", function () {
    const makeFirst = !uni.firstChoice;
    state.universities.forEach(function (other) { delete other.firstChoice; });
    if (makeFirst) uni.firstChoice = true;
    saveUniversities();
    redrawEverything();
  });
  actions.append(starButton, editButton, deleteButton);

  panelBody.append(
    statusRow,
    makeElement("h2", "panel-title", uni.name),
    makeElement("p", "panel-course", uni.course),
    facts,
    makePanelSection("Course description", "book-open", uni.courseDescription, uni.aiSearched),
    makePanelSection("Entry requirements", "award", uni.requirements, uni.aiSearched),
    makePanelSection("How to apply", "file-text", uni.applicationInfo, uni.aiSearched),
    makePanelSection("Important notes", "lightbulb", uni.notes, uni.aiSearched),
    makeAdmissionsSection(uni),
    aboutSection,
    prosCons,
    sourcesSection,
    actions
  );
  detailsPanel.scrollTop = 0;
}

// Select a university: highlight it everywhere and show its details.
// If flyToIt is true, the globe turns to its pin.
function selectUniversity(id, flyToIt) {
  selectedId = id;
  redrawEverything();

  const uni = findUniversity(id);
  if (!uni) return;

  if (globe && flyToIt && Number.isFinite(uni.lat)) {
    globe.pointOfView({ lat: uni.lat, lng: uni.lng, altitude: focusAltitude() }, 1500);
  }

  // On small screens the panel is under the map, so scroll to it
  if (window.innerWidth <= 960 && flyToIt) {
    document.querySelector(".map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}


// =========================================================
// 11. SUMMARY STATS
// =========================================================

function drawStats() {
  document.getElementById("stat-total").textContent = state.universities.length;

  // Count different countries (ignoring capital letters)
  const countries = new Set(state.universities.map(function (uni) {
    return uni.country.toLowerCase();
  }));
  document.getElementById("stat-countries").textContent = countries.size;

  // The soonest of your dates that hasn't passed yet
  const upcoming = sortByDeadline(state.universities).map(function (uni) {
    return { uni: uni, myDate: getMyDate(uni) };
  }).find(function (item) {
    return item.myDate.date && daysUntil(item.myDate.date) >= 0;
  });
  document.getElementById("stat-next").textContent = upcoming
    ? upcoming.uni.name + " · " + upcoming.myDate.label + " · " + getMyDateStatus(upcoming.myDate).label
    : "None yet";
}

// Update the pins, list, panel and stats all at once
function redrawEverything() {
  // The welcome band (index.html) is only for when you have no universities yet
  document.body.classList.toggle("has-universities", state.universities.length > 0);
  drawPins();
  drawList();
  drawDetails();
  drawStats();
  refreshIcons();
}


// The welcome band's buttons: open the right tab and put the cursor in the box
document.querySelectorAll(".welcome-link").forEach(function (button) {
  button.addEventListener("click", function () {
    const box = document.getElementById(button.dataset.go);
    const tab = box.closest(".tab-content");
    document.querySelector('.tab[data-tab="' + tab.id + '"]').click();
    box.scrollIntoView({ behavior: PREFERS_LESS_MOTION ? "auto" : "smooth", block: "center" });
    box.focus({ preventScroll: true });
  });
});
