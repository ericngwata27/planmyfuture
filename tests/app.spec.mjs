// Core tests for planmyfuture. Run them with: npm test
//
// Each test opens the website in a real (headless) Chrome, clicks around
// like a person would, and checks what's on screen and what was saved.
import { test, expect, openWith, openTab, signInAs, fakeAccount, ESCP, ESADE } from "./helpers.mjs";

// ----- Fake answers for the outside services used when adding a university -----

// Wikidata: "ESCP" is a business school in Paris
async function fakeWikidata(page) {
  await page.route(/wikidata\.org/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    let body;
    if (params.get("action") === "wbsearchentities") {
      body = { search: [{ id: "Q1", label: "ESCP Business School", description: "business school in Paris" }] };
    } else if (params.get("ids") === "Q1") {
      const claim = (value) => [{ rank: "normal", mainsnak: { datavalue: { value } } }];
      body = { entities: { Q1: {
        labels: { en: { value: "ESCP Business School" } },
        claims: {
          P625: claim({ latitude: 48.85, longitude: 2.35 }),
          P856: claim("https://escp.eu"),
          P17: claim({ id: "Q142" }),
          P131: claim({ id: "Q90" }),
        },
        sitelinks: {},
      } } };
    } else {
      body = { entities: { Q142: { labels: { en: { value: "France" } } }, Q90: { labels: { en: { value: "Paris" } } } } };
    }
    return route.fulfill({ json: body });
  });
}

// Claude: an answer with several application dates
async function fakeClaude(page) {
  await page.route(/api\.anthropic\.com/, (route) => route.fulfill({ json: {
    stop_reason: "end_turn",
    content: [{ type: "text", text: [
      "City: Paris",
      "Country: France",
      "Application Deadline: 18 November 2026",
      "Entry Requirements: A-levels or equivalent.",
      "Application Dates: deadline | Turin | Round 1 | 27 October 2026 | https://escp.eu/dates; " +
        "deadline | Paris | Round 1 | 18 November 2026 | https://escp.eu/dates; " +
        "decision | Paris | Round 1 results | 18 December 2026 | https://escp.eu/dates",
      "Rolling Admissions: no",
    ].join("\n") }],
  } }));
}

async function addUniversity(page, name, course) {
  await page.fill("#name", name);
  await page.fill("#course", course);
  await page.click("#submit-button");                       // Find details
  await expect(page.locator("#city")).toHaveValue("Paris");
  // Found details always come with a reminder to check the official website
  await expect(page.locator("#lookup-status")).toContainText("Always confirm deadlines on the official university website.");
  await page.click("#submit-button");                       // Add to map
}

const card = (page, id) => page.locator(`.tl-card[data-id="${id}"]`);

// Open a Timeline card and wait for it to finish sliding open
async function openCard(page, id) {
  await card(page, id).locator(".tl-summary").click();
  await expect(card(page, id).locator(".tl-summary")).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(500);
}


// =========================================================

test("loads without errors and shows the empty state", async ({ page }) => {
  await openWith(page, {});
  await expect(page.locator("#stat-total")).toHaveText("0");
  await expect(page.locator("#empty-list")).toBeVisible();
  await expect(page.locator("#welcome")).toBeVisible();             // first-run welcome
  await page.getByRole("button", { name: "Add a university and course" }).click();
  await expect(page.locator("#name")).toBeFocused();
  await openTab(page, "Timeline");
  await expect(page.locator("#timeline-empty")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("adds a university using Wikidata's details", async ({ page }) => {
  await fakeWikidata(page);
  await openWith(page, {});
  await addUniversity(page, "ESCP", "Bachelor in Management");

  await expect(page.locator("#uni-list .uni-card")).toHaveCount(1);
  await expect(page.locator("#uni-list")).toContainText("ESCP");
  await expect(page.locator("#stat-total")).toHaveText("1");
  await expect(page.locator("#welcome")).toBeHidden();              // gone once you have one
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("future-planner-universities")));
  expect(saved[0]).toMatchObject({ name: "ESCP", city: "Paris", country: "France", lat: 48.85, website: "https://escp.eu/" });
  expect(saved[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);   // a UUID
  expect(page.errors).toEqual([]);
});

test("auto-fill with Claude saves every application date", async ({ page }) => {
  await fakeWikidata(page);
  await fakeClaude(page);
  await openWith(page, { apiKey: "sk-ant-test" });
  await addUniversity(page, "ESCP", "Bachelor in Management");

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("future-planner-universities")));
  expect(saved[0].deadline).toBe("2026-11-18");
  expect(saved[0].applicationDates.map((d) => d.label)).toEqual(["Round 1", "Round 1", "Round 1 results"]);

  // The Timeline shows them once you click Generate Timeline
  await openTab(page, "Timeline");
  const id = saved[0].id;
  await openCard(page, id);
  await card(page, id).getByRole("button", { name: "Generate Timeline" }).click();
  await expect(card(page, id).locator(".tl-date-text")).toContainText(["Turin · Round 1", "Paris · Round 1"]);
  expect(page.errors).toEqual([]);
});

test("clicking a globe pin opens that university's card", async ({ page }) => {
  await openWith(page, { universities: [ESCP] });
  const pin = page.locator(".globe-pin", { hasText: "ESCP Business School" });
  await expect(pin).toHaveCount(1);
  await pin.click({ force: true });          // the globe redraws its pins every frame
  await expect(page.locator("#details-panel")).toHaveClass(/is-open/);
  await expect(page.locator("#panel-body")).toContainText("ESCP Business School");
  expect(page.errors).toEqual([]);
});

test("Timeline cards start closed and open on click", async ({ page }) => {
  await openWith(page, { universities: [ESCP, ESADE], timeline: { 1: { generated: true }, 2: { generated: true } } });
  await openTab(page, "Timeline");
  const summary = card(page, 1).locator(".tl-summary");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("27 Oct 2026");        // the next deadline
  await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(card(page, 1).getByLabel("Application status for ESCP Business School")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("Generate and Clear Timeline add and remove the found dates", async ({ page }) => {
  await openWith(page, { universities: [ESCP] });              // not generated yet
  await openTab(page, "Timeline");
  await openCard(page, 1);
  await expect(card(page, 1)).toContainText("Timeline not generated yet");
  // The deadline typed in the university's form counts even before generating
  await expect(card(page, 1).locator(".tl-summary")).toContainText("27 Oct 2026");

  await card(page, 1).getByRole("button", { name: "Generate Timeline" }).click();
  await expect(card(page, 1).locator(".tl-date-text")).toHaveCount(3);
  await card(page, 1).getByRole("button", { name: "Clear Timeline" }).click();
  await expect(card(page, 1)).toContainText("Timeline not generated yet");
  await expect(card(page, 1).locator(".tl-date-text")).toHaveCount(1);   // just the form's deadline
  expect(page.errors).toEqual([]);
});

test("the slider sets your planned date on every page", async ({ page }) => {
  await openWith(page, { universities: [ESCP], timeline: { 1: { generated: true } } });
  await openTab(page, "Timeline");
  await openCard(page, 1);

  const bar = card(page, 1).locator(".tl-bar-inner");
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const planned = await card(page, 1).locator('input[type="date"][id$="-planned"]').inputValue();
  expect(planned).toMatch(/^2026-1[01]-\d\d$/);
  await expect(card(page, 1).locator(".tl-summary")).not.toContainText("Not set");

  // The Universities page shows your plan too
  await openTab(page, "Universities");
  await expect(page.locator("#uni-list")).toContainText("Planned ·");
  expect(page.errors).toEqual([]);
});

test("status and milestones are saved", async ({ page }) => {
  await openWith(page, { universities: [ESCP], timeline: { 1: { generated: true } } });
  await openTab(page, "Timeline");
  await openCard(page, 1);
  await card(page, 1).getByLabel("Application status for ESCP Business School").selectOption("applying");
  await card(page, 1).getByRole("checkbox", { name: "Final review" }).check();

  await page.reload();
  await openTab(page, "Timeline");
  await expect(card(page, 1).locator(".tl-status-label")).toHaveText("Applying");
  await openCard(page, 1);
  await expect(card(page, 1).getByRole("checkbox", { name: "Final review" })).toBeChecked();
  expect(page.errors).toEqual([]);
});

test("profile text and academic profile are saved", async ({ page }) => {
  await openWith(page, {});
  await openTab(page, "Profile");
  await page.fill("#profile-personal", "I love economics.");
  await page.fill("#profile-start", "2027-09");
  await page.locator("#profile-start").dispatchEvent("change");

  await page.reload();
  await openTab(page, "Profile");
  await expect(page.locator("#profile-personal")).toHaveValue("I love economics.");
  await expect(page.locator("#profile-start")).toHaveValue("2027-09");
  expect(page.errors).toEqual([]);
});

test("calendar export downloads an .ics file with your dates", async ({ page }) => {
  await openWith(page, { universities: [ESCP], timeline: { 1: { generated: true, plannedDate: "2026-11-10" } } });
  await openTab(page, "Timeline");
  const download = page.waitForEvent("download");
  await page.click("#export-all-ics");
  const file = await (await download).path();
  const text = await (await import("node:fs/promises")).readFile(file, "utf8");
  expect(text).toContain("BEGIN:VCALENDAR");
  expect(text).toContain("SUMMARY:Submit: ESCP Business School");
  expect(text).toContain("DTSTART;VALUE=DATE:20261118");
  expect(page.errors).toEqual([]);
});

test("deleting a university removes it everywhere", async ({ page }) => {
  await openWith(page, { universities: [ESCP, ESADE], timeline: { 1: { generated: true } } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Esade" }).click();
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(1);
  await expect(page.locator("#stat-total")).toHaveText("1");
  await openTab(page, "Timeline");
  await expect(page.locator(".tl-card")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("export and import move all your data (but never the API key)", async ({ page }) => {
  await openWith(page, {
    universities: [ESCP],
    timeline: { 1: { generated: true, status: "applying" } },
    apiKey: "sk-ant-secret",
  });
  await openTab(page, "Profile");
  await page.fill("#profile-personal", "I love economics.");

  // Export
  const download = page.waitForEvent("download");
  await page.click("#export-data");
  const file = await (await download).path();
  const text = await (await import("node:fs/promises")).readFile(file, "utf8");
  const data = JSON.parse(text);
  expect(data).toMatchObject({ app: "my-future-planner", version: 1, profile: { personal: "I love economics." } });
  expect(data.universities[0].name).toBe("ESCP Business School");
  expect(data.timeline["1"].status).toBe("applying");
  expect(text).not.toContain("sk-ant-secret");

  // Import it into an empty browser
  await openWith(page, {});
  await openTab(page, "Profile");
  await page.locator("#import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("#profile-personal")).toHaveValue("I love economics.");
  await expect(page.locator("#stat-total")).toHaveText("1");
  await openTab(page, "Timeline");
  await expect(card(page, 1).locator(".tl-status-label")).toHaveText("Applying");

  // A file that isn't ours changes nothing
  await openTab(page, "Profile");
  await page.locator("#import-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello": 1}') });
  await expect(page.locator(".toast.is-warning")).toContainText("isn't a planmyfuture export");
  await expect(page.locator("#stat-total")).toHaveText("1");
  expect(page.errors).toEqual([]);
});

test("the header says when your changes are saved, or can't be", async ({ page }) => {
  await openWith(page, {});
  const status = page.locator("#save-status");
  await expect(status).toHaveAttribute("data-state", "saved");
  await expect(status).toHaveText("Saved");

  // Pretend the browser's storage is full
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); };
  });
  await openTab(page, "Profile");
  await page.fill("#profile-personal", "Hello");
  await expect(status).toHaveAttribute("data-state", "error");
  await expect(status).toHaveText("Not saved");
  await expect(page.locator(".toast.is-warning")).toContainText("didn't save that change");
  expect(page.errors).toEqual([]);
});

// ----- Signing in with email + password (auth.js) -----

const USER = { id: "00000000-0000-4000-8000-000000000001", email: "student@example.com", aud: "authenticated", role: "authenticated" };

// What Supabase answers when sign-in works
const session = () => ({
  access_token: "test-token", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "test-refresh", user: USER,
});

// Supabase's answer to a request (path is e.g. "token", "signup", "recover", "user")
async function fakeAuth(page, path, answer) {
  const calls = [];
  await page.route(new RegExp("supabase\\.co/auth/v1/" + path), (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill(answer);
  });
  return calls;
}

async function openSignIn(page) {
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.locator("#account-dialog")).toBeVisible();
}

test("signing in with email and password loads your account's planner", async ({ page }) => {
  const calls = await fakeAuth(page, "token", { json: session() });
  await fakeAccount(page, accountRow([ESCP]));
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "correct horse");
  await page.locator("#sign-in-password").press("Enter");
  await expect(page.locator("#account-button")).toHaveText("student@example.com");
  await expect(page.locator("#uni-list")).toContainText("ESCP Business School");   // syncing ran
  expect(calls[0]).toMatchObject({ email: "student@example.com", password: "correct horse" });
  expect(page.errors).toEqual([]);
});

test("a wrong password shows a helpful message", async ({ page }) => {
  await fakeAuth(page, "token", { status: 400, json: { error_code: "invalid_credentials", msg: "Invalid login credentials" } });
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "wrong one");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.locator(".toast.is-warning")).toContainText("Wrong email or password");
  await expect(page.locator("#account-button")).toHaveText("Sign in");
  expect(page.errors).toEqual([]);
});

test("creating an account signs you in", async ({ page }) => {
  const calls = await fakeAuth(page, "signup", { json: session() });
  await fakeAccount(page, null);
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "a good password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("#account-button")).toHaveText("student@example.com");
  expect(calls[0]).toMatchObject({ email: "student@example.com", password: "a good password" });
  expect(page.errors).toEqual([]);
});

test("creating an account asks to confirm the email if Supabase requires it", async ({ page }) => {
  await fakeAuth(page, "signup", { json: { ...USER, identities: [{ id: "x" }] } });   // a user, but no session
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "a good password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("#account-dialog")).toContainText("Check your email");
  await expect(page.locator("#account-button")).toHaveText("Sign in");
  expect(page.errors).toEqual([]);
});

test("passwords must be long enough", async ({ page }) => {
  const calls = await fakeAuth(page, "signup", { json: session() });
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".toast.is-warning")).toContainText("at least 8 characters");
  expect(calls).toEqual([]);   // nothing was sent
  expect(page.errors).toEqual([]);
});

test("forgot password emails a link", async ({ page }) => {
  const calls = await fakeAuth(page, "recover", { json: {} });
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.getByRole("button", { name: "Forgot password? Email me a link" }).click();
  await expect(page.locator("#account-dialog")).toContainText("Check your email");
  expect(calls[0]).toMatchObject({ email: "student@example.com" });
  expect(page.errors).toEqual([]);
});

test("a signed-in person can set a password", async ({ page }) => {
  const calls = await fakeAuth(page, "user", { json: USER });
  await fakeAccount(page, accountRow([]));
  await signInAs(page, "student@example.com");
  await openWith(page, {});
  await page.locator("#account-button").click();
  await page.fill("#new-password", "my new password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator(".toast").last()).toContainText("Password saved");
  expect(calls.at(-1)).toMatchObject({ password: "my new password" });
  expect(page.errors).toEqual([]);
});

test("a signed-in person sees their email and can sign out", async ({ page }) => {
  await page.route(/supabase\.co\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204, body: "" }));
  await signInAs(page, "student@example.com");
  await openWith(page, {});
  const button = page.locator("#account-button");
  await expect(button).toHaveText("student@example.com");
  await button.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(button).toHaveText("Sign in");
  expect(page.errors).toEqual([]);
});


// ----- Saving to your account (sync.js) -----

const accountRow = (universities) => ({
  user_id: "00000000-0000-4000-8000-000000000001", universities, timeline: {},
  profile: {}, academic_profile: {}, settings: {}, updated_at: "2026-10-01T10:00:00Z",
});

test("signed in, your account's planner is loaded", async ({ page }) => {
  await fakeAccount(page, accountRow([ESCP]));
  await signInAs(page, "student@example.com");
  await openWith(page, {});
  await expect(page.locator("#uni-list")).toContainText("ESCP Business School");
  await expect(page.locator("#save-status")).toHaveText("Saved to your account");
  expect(page.errors).toEqual([]);
});

test("the first sign-in adds this browser's planner to the account", async ({ page }) => {
  const account = await fakeAccount(page, accountRow([ESCP]));
  await signInAs(page, "student@example.com");
  await openWith(page, { universities: [ESADE] });      // this browser has Esade
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(2);   // both are kept
  await expect.poll(() => account.row.universities.map((uni) => uni.name).sort())
    .toEqual(["ESCP Business School", "Esade"]);
  expect(page.errors).toEqual([]);
});

test("a new account gets this browser's planner", async ({ page }) => {
  const account = await fakeAccount(page, null);
  await openWith(page, { universities: [ESADE] });      // used the site signed out
  expect(account.uploads).toEqual([]);                  // nothing is sent while signed out
  await signInAs(page, "student@example.com");          // then signs in
  await page.reload();
  await expect.poll(() => account.row && account.row.universities.map((uni) => uni.name)).toEqual(["Esade"]);
  expect(page.errors).toEqual([]);
});

test("changes are sent to your account", async ({ page }) => {
  const account = await fakeAccount(page, accountRow([ESCP]));
  await signInAs(page, "student@example.com");
  await openWith(page, {});
  await openTab(page, "Profile");
  await page.fill("#profile-personal", "I love economics.");
  await expect.poll(() => account.row.profile.personal).toBe("I love economics.");
  await expect(page.locator("#save-status")).toHaveText("Saved to your account");
  expect(page.errors).toEqual([]);
});

test("signing out removes the planner from this browser", async ({ page }) => {
  await page.route(/supabase\.co\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204, body: "" }));
  await fakeAccount(page, accountRow([ESCP]));
  await signInAs(page, "student@example.com");
  await openWith(page, {});
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(1);
  await page.locator("#account-button").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem("future-planner-universities"));
  expect(JSON.parse(saved)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("on a new device, your Timeline comes from the account unchanged", async ({ page }) => {
  // A university whose timeline was never generated, opened on a fresh browser
  const row = { ...accountRow([ESCP]), timeline: { 1: { status: "applying" } } };
  await fakeAccount(page, row);
  await signInAs(page, "student@example.com");
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("future-planner-timeline-version"));
  await page.reload();
  await openTab(page, "Timeline");
  await card(page, 1).locator(".tl-summary").click();
  await expect(card(page, 1)).toContainText("Timeline not generated yet");
  expect(page.errors).toEqual([]);
});

test("if your account can't be reached, the header says Not synced", async ({ page }) => {
  await page.route(/supabase\.co\/rest\/v1\//, (route) => route.fulfill({ status: 503, json: { message: "down" } }));
  await signInAs(page, "student@example.com");
  await openWith(page, { universities: [ESCP] });
  await expect(page.locator("#save-status")).toHaveText("Not synced", { timeout: 10000 });   // gives up after 6 s
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(1);   // this browser's copy still works
  expect(page.errors).toEqual([]);
});

// ----- Legal pages (privacy.html, terms.html, imprint.html) -----

test("the footer links to the privacy policy, terms and imprint", async ({ page }) => {
  await openWith(page, {});
  const pages = [
    ["Privacy / Datenschutz", "/privacy.html", ["Datenschutzerklärung", "Privacy Policy"]],
    ["Terms / Nutzungsbedingungen", "/terms.html", ["Nutzungsbedingungen", "Terms of Use"]],
    ["Imprint / Impressum", "/imprint.html", ["Impressum", "Imprint"]],
  ];
  for (const [link, path, headings] of pages) {
    await page.goto("/");
    await page.locator(".footer-links").getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(new RegExp(path.replace(".", "\\.") + "$"));
    await expect(page.locator("h1")).toHaveText(headings);   // German first, then English
  }
  expect(page.errors).toEqual([]);
});

test("the privacy policy covers the required GDPR points", async ({ page }) => {
  await page.goto("/privacy.html");
  const english = page.locator("#en");
  for (const text of ["Art. 6(1)(b)", "Art. 6(1)(f)", "Supabase", "GitHub", "Wikimedia", "OpenStreetMap", "Anthropic",
    "Standard Contractual Clauses", "How long data is kept", "local storage", "Art. 15", "Art. 21",
    "Right to complain", "16 and over", "automated decision-making", "Last updated"]) {
    await expect(english).toContainText(text);
  }
  await expect(page.locator("#de")).toContainText("Art. 6 Abs. 1 lit. b DSGVO");
});

test("the sign-in window links to the terms and privacy policy", async ({ page }) => {
  await openWith(page, {});
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.locator("#account-dialog").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "privacy.html");
  await expect(page.locator("#account-dialog").getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "terms.html");
});

// ----- The sign-in window: eye button, closing, password, deleting -----

test("the eye button shows and hides passwords", async ({ page }) => {
  await openWith(page, {});
  await openSignIn(page);
  const box = page.locator("#sign-in-password");
  await box.fill("secret password");
  await expect(box).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(box).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(box).toHaveAttribute("type", "password");
  expect(page.errors).toEqual([]);
});

test("clicking outside the sign-in window doesn't close it; the close button does", async ({ page }) => {
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.mouse.click(10, 10);                               // the dark area around it
  await expect(page.locator("#account-dialog")).toBeVisible();
  await expect(page.locator("#sign-in-email")).toHaveValue("student@example.com");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#account-dialog")).toBeHidden();
});

test("the sign-in window starts empty each time it opens", async ({ page }) => {
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "half typed");
  await page.getByRole("button", { name: "Show password" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await openSignIn(page);
  await expect(page.locator("#sign-in-email")).toHaveValue("");
  await expect(page.locator("#sign-in-password")).toHaveValue("");
  await expect(page.locator("#sign-in-password")).toHaveAttribute("type", "password");
});

test("accounts that have a password see Change password, not Set a password", async ({ page }) => {
  await fakeAccount(page, accountRow([]));
  await signInAs(page, "student@example.com", { has_password: true });
  await openWith(page, {});
  await page.locator("#account-button").click();
  await expect(page.locator("#account-dialog")).toContainText("Signed in as student@example.com");
  await expect(page.getByText("Set a password")).toBeHidden();
  await expect(page.locator("#set-password-form")).toBeHidden();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator("#new-password")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("signing in with a password notes that the account has one", async ({ page }) => {
  const userCalls = await fakeAuth(page, "user", { json: { ...USER, user_metadata: { has_password: true } } });
  await fakeAuth(page, "token", { json: session() });   // a user without the note yet
  await fakeAccount(page, accountRow([]));
  await openWith(page, {});
  await openSignIn(page);
  await page.fill("#sign-in-email", "student@example.com");
  await page.fill("#sign-in-password", "correct horse");
  await page.locator("#sign-in-password").press("Enter");
  await expect.poll(() => userCalls.some((body) => body && body.data && body.data.has_password === true)).toBe(true);
  expect(page.errors).toEqual([]);
});

test("Delete my account deletes the account and clears this browser", async ({ page }) => {
  await fakeAuth(page, "logout", { status: 204, body: "" });
  let deleted = false;
  await page.route(/supabase\.co\/rest\/v1\/rpc\/delete_my_account/, (route) => {
    deleted = true;
    return route.fulfill({ status: 204, body: "" });
  });
  await fakeAccount(page, accountRow([ESCP]));
  await signInAs(page, "student@example.com", { has_password: true });
  await openWith(page, { apiKey: "sk-ant-mine" });
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(1);

  await page.locator("#account-button").click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.locator("#delete-confirm")).toContainText("can't be undone");   // asks first
  expect(deleted).toBe(false);
  await page.getByRole("button", { name: "Delete forever" }).click();

  await expect(page.locator(".toast").last()).toContainText("Your account and all its data were deleted.");
  expect(deleted).toBe(true);
  await expect(page.locator("#account-button")).toHaveText("Sign in");
  await expect(page.locator("#uni-list .uni-card")).toHaveCount(0);
  const saved = await page.evaluate(() => Object.keys(localStorage));
  expect(saved.filter((key) => key.startsWith("sb-") || key === "future-planner-claude-key")).toEqual([]);
  expect(page.errors).toEqual([]);
});

// ----- Privacy: nothing is loaded from other servers -----

test("the site loads fonts, libraries and pictures only from itself", async ({ page }) => {
  const loaded = [];
  page.on("response", (response) => {
    if (response.ok()) loaded.push(new URL(response.url()).pathname);
  });
  await openWith(page, { universities: [ESCP] });
  await page.locator("#globe-settings-button").click();
  await page.locator('[data-globe-setting="borders"]').check();     // loads the country shapes
  await page.locator('[data-globe-setting="glow"]').check();        // loads three.js's glow effect
  for (const tab of ["Timeline", "Profile", "Universities"]) await openTab(page, tab);
  await page.waitForTimeout(1500);

  expect(page.outsideRequests).toEqual([]);                          // no Google Fonts, unpkg, jsDelivr…
  expect(await page.evaluate(() => document.fonts.check('700 16px "Manrope"') && document.fonts.check('16px "Figtree"'))).toBe(true);
  expect(loaded).toEqual(expect.arrayContaining([
    "/fonts/manrope-latin.woff2", "/fonts/figtree-latin.woff2",
    "/vendor/globe.gl/globe.gl.min.js", "/vendor/lucide/lucide.min.js", "/vendor/supabase/supabase.js",
    "/textures/earth-night.jpg", "/vendor/globe.gl/countries.geojson",
    "/vendor/three/build/three.module.min.js", "/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js",
  ]));
  expect(page.errors).toEqual([]);
});


// ----- The auto-fill experiment (?autofill=A / ?autofill=B) -----

const PROFILE = { intendedStartDate: "2027-09", currentGradeLevel: "Year 13 (Grade 12)", schoolSystem: "Abitur", countryOfResidence: "Germany" };

// Today's answer format (what the normal search and version A ask for)
const ANSWER_A = { stop_reason: "end_turn", model: "claude-opus-5-5",
  usage: { input_tokens: 800, output_tokens: 150, server_tool_use: { web_search_requests: 2 } },
  content: [{ type: "text", text: [
    "City: Paris",
    "Country: France",
    "Application Deadline: 18 November 2026",
    "Application Dates: deadline | Paris | Round 1 | 18 November 2026 | https://escp.eu/dates",
    "Rolling Admissions: no",
  ].join("\n") }] };

// Version B: the search pauses once ("pause_turn"), then answers with
// tests, enrolment dates, who each date applies to and the admissions cycle
const ANSWERS_B = [
  { stop_reason: "pause_turn", model: "claude-opus-5-5",
    usage: { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } },
    content: [{ type: "text", text: "Reading the admissions pages." }] },
  { stop_reason: "end_turn", model: "claude-opus-5-5",
    usage: { input_tokens: 2000, output_tokens: 500, server_tool_use: { web_search_requests: 2, web_fetch_requests: 2 } },
    content: [
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://escp.eu/dates" } },
      { type: "web_search_tool_result", content: [{ url: "https://esat-tmua.ac.uk/about-the-tests/tara/" }] },
      { type: "text", text: [
        "City: Paris",
        "Country: France",
        "Admissions Cycle: Using 2027/28 admissions cycle (September 2027 entry).",
        "Application Deadline: 18 November 2026",
        "Important Notes: Interviews are online.",
        "Application Dates:",
        "opens | - | Applications open | 1 September 2026 | all | https://escp.eu/apply",
        "test | - | TARA registration deadline | 28 September 2026 | all | https://esat-tmua.ac.uk/about-the-tests/tara/",
        "deadline | Paris | Round 1 | 18 November 2026 | all | https://escp.eu/dates",
        "deadline | - | Final deadline | 15 January 2027 | international applicants | https://escp.eu/international",
        "enrolment | - | Deposit deadline | 1 May 2027 | all | https://escp.eu/enrol",
        "Rolling Admissions: no",
      ].join("\n") },
    ] },
];

// Answer Claude's requests and keep what the site sent. Version B's
// requests get the B answers, everything else gets ANSWER_A.
async function recordClaude(page) {
  const sent = [];
  let bReplies = 0;
  await page.route(/api\.anthropic\.com/, (route) => {
    const body = JSON.parse(route.request().postData());
    sent.push(body);
    const isB = body.tools.some((tool) => tool.name === "web_fetch");
    return route.fulfill({ json: isB ? ANSWERS_B[Math.min(bReplies++, ANSWERS_B.length - 1)] : ANSWER_A });
  });
  return sent;
}

async function findDetails(page) {
  await page.fill("#name", "ESCP");
  await page.fill("#course", "Bachelor in Management");
  await page.click("#submit-button");
  await expect(page.locator("#city")).toHaveValue("Paris");
}

const savedSearchKeys = (page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("future-planner-search-cache") || "{}")));

test("without ?autofill the search is unchanged; A matches it; A, B and normal never share saved searches", async ({ page }) => {
  await fakeWikidata(page);
  const sent = await recordClaude(page);
  await openWith(page, { apiKey: "sk-ant-test", academicProfile: PROFILE });

  // The normal site: today's request, and no experiment panel
  await findDetails(page);
  expect(sent).toHaveLength(1);
  const normal = sent[0];
  expect(normal.max_tokens).toBe(8000);
  expect(normal.output_config).toEqual({ effort: "low" });
  expect(normal.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: ["escp.eu"] }]);
  expect(normal.system).toMatch(/^You are an academic data extractor\./);
  expect(normal.system).toContain("Stop reading after 3 pages.");
  expect(normal.messages[0].content).toContain("Current grade level: Year 13 (Grade 12)");
  await expect(page.locator(".experiment-result")).toHaveCount(0);
  expect(await savedSearchKeys(page)).toEqual(["escp|bachelor in management|2027-09|year 13 (grade 12)|abitur|germany"]);   // today's key

  // Version A: exactly the same request, but its own saved search
  await page.goto("/?autofill=A");
  await findDetails(page);
  expect(sent).toHaveLength(2);                                     // the normal saved search wasn't used
  expect(sent[1]).toEqual(normal);
  await expect(page.locator(".experiment-result")).toContainText("Auto-fill experiment: version A");
  await expect(page.locator(".experiment-usage")).toContainText("Searches performed: 2");

  // Version B: a different request, and its own saved search too
  await page.goto("/?autofill=B");
  await findDetails(page);
  expect(sent).toHaveLength(4);                                     // two requests (it paused once)
  expect(sent[2].tools.map((tool) => tool.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
  const keys = await savedSearchKeys(page);
  expect(keys.filter((key) => key.startsWith("a|"))).toHaveLength(1);
  expect(keys.filter((key) => key.startsWith("b|"))).toHaveLength(1);
  expect(keys.find((key) => key.startsWith("b|"))).not.toContain("year 13");   // grade level doesn't split B's saved searches

  // Back to A: its own saved search, never B's dates
  await page.goto("/?autofill=A");
  await findDetails(page);
  expect(sent).toHaveLength(4);
  await expect(page.locator(".experiment-result")).toContainText("saved run");
  await expect(page.locator(".experiment-dates li")).toHaveCount(1);
  await expect(page.locator(".experiment-dates")).not.toContainText("TARA");

  // And the normal site uses its own saved search, with no panel
  await page.goto("/");
  await findDetails(page);
  expect(sent).toHaveLength(4);
  await expect(page.locator(".experiment-result")).toHaveCount(0);
  await expect(page.locator("#notes")).toHaveValue("");
  expect(page.errors).toEqual([]);
});

test("?autofill=B searches more thoroughly, labels every date and shows what the search cost", async ({ page }) => {
  await fakeWikidata(page);
  const sent = await recordClaude(page);
  await openWith(page, { apiKey: "sk-ant-test", academicProfile: PROFILE }, "/?autofill=B");
  await findDetails(page);

  // The request: bigger budget, more searches, web fetch, official sites only
  expect(sent).toHaveLength(2);
  const request = sent[0];
  expect(request.max_tokens).toBe(16000);
  expect(request.output_config).toEqual({ effort: "medium" });
  const [search, fetchTool] = request.tools;
  expect(search).toMatchObject({ type: "web_search_20260209", max_uses: 10 });
  expect(fetchTool).toMatchObject({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 20000 });
  for (const tool of request.tools) {
    expect(tool.allowed_domains).toEqual(expect.arrayContaining(["escp.eu", "ucas.com", "cao.ie", "collegeboard.org", "esat-tmua.ac.uk"]));
  }
  expect(request.system).toContain("Never infer a date. Never estimate a deadline. Never derive deadlines from prior years.");
  expect(request.system).toContain("Do not stop once you have found the application deadline.");
  expect(request.system).not.toContain("3000 characters");
  const question = request.messages[0].content;
  expect(question).toContain("Requested intake: September 2027 entry (2027/28 admissions cycle");
  expect(question).toContain("Qualification: Abitur");
  expect(question).not.toContain("grade level");

  // The "carry on" request sends back the paused reply
  expect(sent[1].messages).toHaveLength(2);
  expect(sent[1].messages[1]).toEqual({ role: "assistant", content: ANSWERS_B[0].content });

  // What it used, added up from both replies (cost: tokens + $0.01 per search)
  const usage = page.locator(".experiment-usage");
  await expect(usage).toContainText("Total runtime:");
  await expect(usage).toContainText("Searches performed: 5");
  await expect(usage).toContainText("Pages fetched: 3");
  await expect(usage).toContainText("Input tokens: 3,000");
  await expect(usage).toContainText("Output tokens: 700");
  await expect(usage).toContainText("Estimated API cost: $0.076 (claude-opus-5-5, 2 requests)");

  // Every date, with who it's for, and passed ones labelled
  const dates = page.locator(".experiment-dates li");
  await expect(dates).toHaveCount(5);
  await expect(dates.filter({ hasText: "TARA registration deadline" })).toContainText("Status: Passed");
  await expect(dates.filter({ hasText: "Final deadline" })).toContainText("international applicants");
  await expect(dates.filter({ hasText: "Final deadline" })).toContainText("Status: Upcoming");
  await expect(page.locator(".experiment-cycle")).toHaveText("Using 2027/28 admissions cycle (September 2027 entry).");
  await expect(page.locator("#notes")).toHaveValue(/^Using 2027\/28 admissions cycle/);
  await expect(page.locator(".source-badge")).toContainText("Verified from official sources");   // escp.eu + the TARA site

  // The rows copied for the Excel sheet
  const rows = (await page.evaluate(() => experimentRows(lookup, null))).split("\n").map((row) => row.split("\t"));
  expect(rows).toHaveLength(6);
  expect(rows[0].slice(0, 12)).toEqual(["Version", "Run at", "University", "Course", "Admissions cycle", "Type", "Campus", "Name", "Applies to", "Date", "Status", "Source"]);
  expect(rows[2]).toEqual(expect.arrayContaining(["B", "Test", "TARA registration deadline", "2026-09-28", "Passed", "5", "3", "3000", "700", "0.0760"]));

  // Added to the map, the new types and "applies to" are saved
  await page.click("#submit-button");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("future-planner-universities")));
  expect(saved[0].applicationDates).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "test", label: "TARA registration deadline", date: "2026-09-28" }),
    expect.objectContaining({ type: "deadline", label: "Final deadline", appliesTo: "international applicants" }),
    expect.objectContaining({ type: "enrolment", label: "Deposit deadline" }),
  ]));
  expect(saved[0].applicationDates.find((d) => d.label === "Round 1")).not.toHaveProperty("appliesTo");
  expect(page.errors).toEqual([]);
});
