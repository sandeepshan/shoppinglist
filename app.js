import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  query, orderBy, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------------------------------------------------------
// Preset reference data (hardcoded — no DB round trip needed for these)
// ------------------------------------------------------------------
const PRESET_STORES = [
  { id: "coles", name: "Coles", emoji: "🔴", bg: "#FAECE7", fg: "#712B13", chart: "#D85A30" },
  { id: "woolworths", name: "Woolworths", emoji: "🟢", bg: "#EAF3DE", fg: "#27500A", chart: "#639922" },
  { id: "aldi", name: "Aldi", emoji: "🔷", bg: "#E6F1FB", fg: "#0C447C", chart: "#378ADD" },
  { id: "iga", name: "IGA", emoji: "🟠", bg: "#EEEDFE", fg: "#26215C", chart: "#7F77DD" },
  { id: "indian-shop", name: "Indian Shop", emoji: "🌶️", bg: "#FAEEDA", fg: "#633806", chart: "#EF9F27" },
  { id: "meat-shop", name: "Meat Shop / Butcher", emoji: "🥩", bg: "#FBEAF0", fg: "#72243E", chart: "#D4537E" },
  { id: "costco", name: "Costco", emoji: "🏷️", bg: "#E1F5EE", fg: "#085041", chart: "#1D9E75" },
  { id: "other", name: "Other", emoji: "🛒", bg: "#F1EFE8", fg: "#444441", chart: "#888780" },
];

const CATEGORIES = [
  { id: "produce", name: "Fruits & Vegetables", icon: "ti-apple", bg: "#EAF3DE", fg: "#27500A" },
  { id: "dairy", name: "Dairy & Eggs", icon: "ti-milk", bg: "#E6F1FB", fg: "#0C447C" },
  { id: "meat", name: "Meat & Poultry", icon: "ti-meat", bg: "#FBEAF0", fg: "#72243E" },
  { id: "seafood", name: "Seafood", icon: "ti-fish", bg: "#E1F5EE", fg: "#085041" },
  { id: "bakery", name: "Bakery", icon: "ti-bread", bg: "#FAEEDA", fg: "#633806" },
  { id: "grains", name: "Rice, Grains & Lentils", icon: "ti-grain", bg: "#FAEEDA", fg: "#633806" },
  { id: "pantry", name: "Pantry & Dry Goods", icon: "ti-package", bg: "#F1EFE8", fg: "#444441" },
  { id: "spices", name: "Spices & Condiments", icon: "ti-flame", bg: "#FAECE7", fg: "#712B13" },
  { id: "frozen", name: "Frozen Foods", icon: "ti-snowflake", bg: "#E6F1FB", fg: "#0C447C" },
  { id: "snacks", name: "Snacks", icon: "ti-cookie", bg: "#FAECE7", fg: "#712B13" },
  { id: "beverages", name: "Beverages", icon: "ti-bottle", bg: "#EEEDFE", fg: "#26215C" },
  { id: "household", name: "Household & Cleaning", icon: "ti-spray", bg: "#E1F5EE", fg: "#085041" },
  { id: "personal-care", name: "Personal Care", icon: "ti-droplet", bg: "#FBEAF0", fg: "#72243E" },
  { id: "baby", name: "Baby Care", icon: "ti-baby-carriage", bg: "#EEEDFE", fg: "#26215C" },
  { id: "pet", name: "Pet Supplies", icon: "ti-paw", bg: "#FAEEDA", fg: "#633806" },
  { id: "other", name: "Other", icon: "ti-category", bg: "#F1EFE8", fg: "#444441" },
];

// ------------------------------------------------------------------
// Global state
// ------------------------------------------------------------------
let currentUser = null;
let userName = localStorage.getItem("shoppingListUserName") || "";
let items = [];
let activeStoreFilter = "all";
let activeStatusFilter = "pending";
let currentView = "list";
let unsubItems = null;
let monthlyBudget = null;
let unsubBudget = null;

const $ = (id) => document.getElementById(id);
const allStores = () => PRESET_STORES;

// ------------------------------------------------------------------
// Per-user colored avatars — deterministic color+initial from a name,
// no accounts needed since it's derived purely from the name string.
// ------------------------------------------------------------------
const AVATAR_PALETTE = [
  { bg: "#FAECE7", fg: "#712B13" },
  { bg: "#EAF3DE", fg: "#27500A" },
  { bg: "#E6F1FB", fg: "#0C447C" },
  { bg: "#FBEAF0", fg: "#72243E" },
  { bg: "#FAEEDA", fg: "#633806" },
  { bg: "#EEEDFE", fg: "#26215C" },
  { bg: "#E1F5EE", fg: "#085041" },
];

function hashName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

function avatarPalette(name) {
  const clean = (name || "").trim() || "?";
  return AVATAR_PALETTE[hashName(clean) % AVATAR_PALETTE.length];
}

function avatarInitial(name) {
  const clean = (name || "").trim();
  return clean ? clean[0].toUpperCase() : "?";
}

function avatarHtml(name, size) {
  const pal = avatarPalette(name);
  return `<span class="avatar" style="width:${size}px; height:${size}px; background:${pal.bg}; color:${pal.fg}; font-size:${Math.round(size * 0.48)}px;">${escapeHtml(avatarInitial(name))}</span>`;
}

// ------------------------------------------------------------------
// Dark mode
// ------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = $("theme-toggle-btn").querySelector("i");
  if (icon) icon.className = theme === "dark" ? "ti ti-sun" : "ti ti-moon";
}

function initTheme() {
  const saved = localStorage.getItem("shoppingListTheme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

$("theme-toggle-btn").addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  localStorage.setItem("shoppingListTheme", next);
  applyTheme(next);
});

initTheme();

// ------------------------------------------------------------------
// Offline indicator — the app doesn't cache data for offline use by
// design (to avoid stale-data conflicts with live Firestore), so a
// dropped connection needs to be visible instead of silently stalling.
// ------------------------------------------------------------------
function updateOnlineStatus() {
  $("offline-banner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ------------------------------------------------------------------
// Screen / view switching
// ------------------------------------------------------------------
function showScreen(name) {
  ["name-screen", "app-screen"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== name);
  });
}

function showView(name) {
  currentView = name;
  ["list", "inventory", "spend", "whatsapp"].forEach((v) => {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "inventory") renderInventory();
  if (name === "spend") renderDashboard();
  if (name === "whatsapp") renderWhatsApp();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ------------------------------------------------------------------
// Boot / silent anonymous auth + one-time name prompt
// ------------------------------------------------------------------
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      proceedAfterAuth();
    }
  });
  signInAnonymously(auth).catch((e) => {
    console.error("Anonymous sign-in failed:", e);
  });
}

function proceedAfterAuth() {
  if (!userName) {
    showScreen("name-screen");
  } else {
    startApp();
  }
}

$("name-continue-btn").addEventListener("click", () => {
  const name = $("name-input").value.trim();
  if (!name) return;
  localStorage.setItem("shoppingListUserName", name);
  userName = name;
  startApp();
});

$("change-name-btn").addEventListener("click", () => {
  localStorage.removeItem("shoppingListUserName");
  userName = "";
  $("name-input").value = "";
  showScreen("name-screen");
});

function startApp() {
  $("user-name-label").textContent = userName;
  $("header-avatar").innerHTML = avatarHtml(userName, 18);
  populateSelects();
  renderStoreFilterChips();
  renderSkeleton();
  subscribeItems();
  subscribeBudget();
  subscribeShopper();
  subscribeRecurring();
  subscribeFavorites();
  subscribeStoreBudgets();
  subscribeTemplates();
  showScreen("app-screen");
  showView("list");
}

// ------------------------------------------------------------------
// Per-store budget caps (in addition to the overall monthly budget)
// ------------------------------------------------------------------
let storeBudgetCaps = {};
let unsubStoreBudgets = null;

function subscribeStoreBudgets() {
  if (unsubStoreBudgets) unsubStoreBudgets();
  const ref = doc(db, "meta", "storeBudgets");
  unsubStoreBudgets = onSnapshot(ref, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    storeBudgetCaps = (data && data.caps) || {};
    if (currentView === "spend") renderDashboard();
  });
}

function renderStoreBudgets(monthDoneItems) {
  const el = $("store-budgets-list");
  const spendByStore = {};
  monthDoneItems.forEach((i) => {
    const key = i.storeId || "other";
    spendByStore[key] = (spendByStore[key] || 0) + Number(i.amount || 0);
  });

  const relevantStoreIds = new Set([...Object.keys(storeBudgetCaps), ...Object.keys(spendByStore)]);
  if (relevantStoreIds.size === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `<p class="muted small" style="margin:14px 0 8px;">Per-store budgets</p>` + [...relevantStoreIds].map((storeId) => {
    const store = allStores().find((s) => s.id === storeId);
    const label = store ? store.name : "Other";
    const dotColor = store ? store.fg : "#444441";
    const spend = spendByStore[storeId] || 0;
    const cap = storeBudgetCaps[storeId];

    if (cap == null) {
      return `
        <div class="store-budget-row">
          <span class="store-dot" style="background:${dotColor}"></span>
          <span class="store-budget-label">${escapeHtml(label)}</span>
          <span class="muted small store-budget-spend">$${spend.toFixed(2)} spent</span>
          <button class="link-btn" data-action="set-store-cap" data-store="${storeId}">Set cap</button>
        </div>`;
    }

    const pct = Math.min(100, (spend / cap) * 100);
    const stateClass = spend > cap ? "over" : (pct >= 80 ? "warn" : "");
    return `
      <div class="store-budget-row">
        <span class="store-dot" style="background:${dotColor}"></span>
        <span class="store-budget-label">${escapeHtml(label)}</span>
        <div class="budget-bar-track store-budget-bar-track"><div class="budget-bar-fill ${stateClass}" style="width:${pct}%;"></div></div>
        <span class="muted small store-budget-spend">$${spend.toFixed(2)} / $${cap.toFixed(2)}</span>
        <button class="edit-btn" data-action="set-store-cap" data-store="${storeId}"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>`;
  }).join("");
}

$("store-budgets-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='set-store-cap']");
  if (!btn) return;
  const storeId = btn.dataset.store;
  const store = allStores().find((s) => s.id === storeId);
  const label = store ? store.name : "Other";
  const current = storeBudgetCaps[storeId] != null ? storeBudgetCaps[storeId] : "";
  const next = window.prompt(`Set a monthly budget cap for ${label} ($):`, current);
  if (next === null) return;
  const parsed = parseFloat(next);
  if (!parsed || parsed <= 0) {
    alert("Enter a valid amount.");
    return;
  }
  const updated = { ...storeBudgetCaps, [storeId]: parsed };
  await setDoc(doc(db, "meta", "storeBudgets"), { caps: updated }, { merge: true });
});

// ------------------------------------------------------------------
// Shopping list templates — save the current pending list as a named
// reusable template (e.g. "BBQ list", "Diwali list"), then load it back
// in one tap instead of re-adding everything from scratch.
// ------------------------------------------------------------------
let templates = [];
let unsubTemplates = null;

function subscribeTemplates() {
  if (unsubTemplates) unsubTemplates();
  const templatesQuery = query(collection(db, "templates"), orderBy("createdAt", "desc"));
  unsubTemplates = onSnapshot(templatesQuery, (snap) => {
    templates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTemplates();
  });
}

function renderTemplates() {
  const el = $("templates-list");
  if (templates.length === 0) {
    el.innerHTML = "";
    $("templates-empty").classList.remove("hidden");
    return;
  }
  $("templates-empty").classList.add("hidden");
  el.innerHTML = templates.map((t) => {
    const count = Array.isArray(t.items) ? t.items.length : 0;
    return `
      <div class="template-row">
        <div class="item-main">
          <div class="template-name">${escapeHtml(t.name)}</div>
          <div class="template-count">${count} item${count === 1 ? "" : "s"}</div>
        </div>
        <div class="row">
          <button class="btn primary small" data-action="load-template" data-id="${t.id}">Load</button>
          <button class="delete-btn" data-action="delete-template" data-id="${t.id}" aria-label="Delete template"><i class="ti ti-trash" aria-hidden="true"></i></button>
        </div>
      </div>`;
  }).join("");
}

$("save-template-btn").addEventListener("click", async () => {
  const name = $("template-name-input").value.trim();
  if (!name) {
    alert("Give the template a name first (e.g. \"BBQ list\").");
    return;
  }
  const pendingItems = items.filter((i) => i.status === "pending" && !pendingDeletes.has(i.id));
  if (pendingItems.length === 0) {
    alert("Add some pending items to your list first, then save them as a template.");
    return;
  }
  const templateItems = pendingItems.map((i) => ({
    name: i.name,
    categoryId: i.categoryId || null,
    categoryName: i.categoryName || null,
    categoryIcon: i.categoryIcon || null,
    storeId: i.storeId || null,
    storeName: i.storeName || null,
    storeIcon: i.storeIcon || null,
    quantity: i.quantity || null,
  }));

  await addDoc(collection(db, "templates"), {
    name,
    items: templateItems,
    createdBy: userName,
    createdAt: serverTimestamp(),
  });

  $("template-name-input").value = "";
});

$("templates-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const template = templates.find((t) => t.id === btn.dataset.id);
  if (!template) return;

  if (btn.dataset.action === "delete-template") {
    const confirmed = window.confirm(`Delete the template "${template.name}"? This won't affect your current list.`);
    if (!confirmed) return;
    await deleteDoc(doc(db, "templates", template.id));
    return;
  }

  if (btn.dataset.action === "load-template") {
    const templateItems = Array.isArray(template.items) ? template.items : [];
    if (templateItems.length === 0) return;
    await Promise.all(templateItems.map((ti) => addDoc(collection(db, "items"), {
      name: ti.name,
      categoryId: ti.categoryId || null,
      categoryName: ti.categoryName || null,
      categoryIcon: ti.categoryIcon || null,
      storeId: ti.storeId || null,
      storeName: ti.storeName || null,
      storeIcon: ti.storeIcon || null,
      quantity: ti.quantity || null,
      status: "pending",
      amount: null,
      purchasedBy: null,
      addedBy: userName,
      createdAt: serverTimestamp(),
      doneAt: null,
    })));
  }
});

// ------------------------------------------------------------------
// Shared favorites (Inventory catalog items pinned to the top of
// their category, regardless of purchase frequency)
// ------------------------------------------------------------------
let favoriteNames = new Set();
let unsubFavorites = null;

function subscribeFavorites() {
  if (unsubFavorites) unsubFavorites();
  const favRef = doc(db, "meta", "favorites");
  unsubFavorites = onSnapshot(favRef, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    favoriteNames = new Set((data && data.names) || []);
    if (currentView === "inventory") renderInventory();
  });
}

// ------------------------------------------------------------------
// Shared monthly budget (one doc, visible/editable by everyone)
// ------------------------------------------------------------------
function subscribeBudget() {
  if (unsubBudget) unsubBudget();
  const budgetRef = doc(db, "meta", "budget");
  unsubBudget = onSnapshot(budgetRef, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    monthlyBudget = data && typeof data.monthlyBudget === "number" ? data.monthlyBudget : null;
    if (currentView === "spend") renderDashboard();
  });
}

$("edit-budget-btn").addEventListener("click", async () => {
  const current = monthlyBudget != null ? monthlyBudget : "";
  const next = window.prompt("Set the shared monthly shopping budget ($):", current);
  if (next === null) return;
  const parsed = parseFloat(next);
  if (!parsed || parsed <= 0) {
    alert("Enter a valid amount.");
    return;
  }
  await setDoc(doc(db, "meta", "budget"), { monthlyBudget: parsed }, { merge: true });
});

function renderBudget(monthTotal) {
  const setEl = $("budget-set");
  const unsetEl = $("budget-unset");
  if (monthlyBudget == null) {
    setEl.classList.add("hidden");
    unsetEl.classList.remove("hidden");
    return;
  }
  unsetEl.classList.add("hidden");
  setEl.classList.remove("hidden");

  const pct = Math.min(100, (monthTotal / monthlyBudget) * 100);
  const fill = $("budget-bar-fill");
  fill.style.width = `${pct}%`;
  fill.classList.remove("warn", "over");
  if (monthTotal > monthlyBudget) fill.classList.add("over");
  else if (pct >= 80) fill.classList.add("warn");

  const pctLabel = Math.round((monthTotal / monthlyBudget) * 100);
  $("budget-caption").textContent = `$${monthTotal.toFixed(2)} of $${monthlyBudget.toFixed(2)} spent this month (${pctLabel}%)`;
}

// ------------------------------------------------------------------
// "Today's shopper" — a shared flag anyone can claim, no auto-expiry
// since there's no server-side clock to reset it at midnight.
// ------------------------------------------------------------------
let unsubShopper = null;

function subscribeShopper() {
  if (unsubShopper) unsubShopper();
  const shopperRef = doc(db, "meta", "shopper");
  unsubShopper = onSnapshot(shopperRef, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    renderShopper(data);
  });
}

function renderShopper(data) {
  const statusEl = $("shopper-status");
  const btn = $("assign-shopper-btn");
  if (!data || !data.name) {
    statusEl.innerHTML = "Not assigned yet";
    btn.textContent = "I've got it";
    return;
  }
  const setDate = data.setAt && data.setAt.toDate ? data.setAt.toDate() : null;
  const isToday = setDate && setDate.toDateString() === new Date().toDateString();
  const dateLabel = setDate ? setDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  statusEl.innerHTML = `${avatarHtml(data.name, 16)} ${escapeHtml(data.name)}${isToday ? "" : ` (set ${dateLabel})`}`;
  btn.textContent = data.name === userName ? "That's me" : "Take over";
}

$("assign-shopper-btn").addEventListener("click", async () => {
  await setDoc(doc(db, "meta", "shopper"), { name: userName, setAt: serverTimestamp() }, { merge: true });
});

// ------------------------------------------------------------------
// Recurring items — e.g. "Milk every Sunday". Checked on every app
// load (no server cron on the free plan): if the scheduled weekday
// has arrived this week and it hasn't been auto-added yet, it's
// added to the pending list automatically.
// ------------------------------------------------------------------
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let recurringItems = [];
let unsubRecurring = null;

function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function subscribeRecurring() {
  if (unsubRecurring) unsubRecurring();
  const recurringQuery = query(collection(db, "recurringItems"), orderBy("dayOfWeek"));
  unsubRecurring = onSnapshot(recurringQuery, (snap) => {
    recurringItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRecurringChips();
    checkRecurringDue();
  });
}

function renderRecurringChips() {
  const el = $("recurring-chips");
  if (recurringItems.length === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    $("recurring-empty").classList.remove("hidden");
    return;
  }
  $("recurring-empty").classList.add("hidden");
  el.classList.remove("hidden");
  el.innerHTML = recurringItems.map((r) => (
    `<span class="recurring-chip">${escapeHtml(r.name)} · ${DAY_NAMES[r.dayOfWeek]}s${r.storeName ? ` · ${escapeHtml(r.storeName)}` : ""}
      <button data-action="delete-recurring" data-id="${r.id}" aria-label="Remove"><i class="ti ti-x" aria-hidden="true"></i></button>
    </span>`
  )).join("");
}

$("recurring-chips").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete-recurring']");
  if (!btn) return;
  await deleteDoc(doc(db, "recurringItems", btn.dataset.id));
});

$("recurring-name-input").addEventListener("input", () => {
  const typed = $("recurring-name-input").value.trim().toLowerCase();
  if (!typed) return;
  const match = buildNameStats().get(typed);
  if (!match || !match.storeId) return;
  $("recurring-store-select").value = match.storeId;
});

$("add-recurring-btn").addEventListener("click", async () => {
  const name = $("recurring-name-input").value.trim();
  if (!name) return;
  const dayOfWeek = parseInt($("recurring-day-select").value, 10);
  const match = buildNameStats().get(name.toLowerCase());
  const category = match ? CATEGORIES.find((c) => c.id === match.categoryId) : null;
  const store = allStores().find((s) => s.id === $("recurring-store-select").value);

  await addDoc(collection(db, "recurringItems"), {
    name,
    categoryId: category ? category.id : null,
    categoryName: category ? category.name : null,
    categoryIcon: category ? category.icon : null,
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeIcon: store ? store.emoji : null,
    dayOfWeek,
    lastAddedWeekKey: null,
    addedBy: userName,
    createdAt: serverTimestamp(),
  });

  $("recurring-name-input").value = "";
});

async function checkRecurringDue() {
  const today = new Date();
  const currentWeekKey = getWeekKey(today);
  const todayDow = today.getDay();

  for (const r of recurringItems) {
    if (r.lastAddedWeekKey === currentWeekKey) continue;
    if (todayDow < r.dayOfWeek) continue;

    await addDoc(collection(db, "items"), {
      name: r.name,
      categoryId: r.categoryId || null,
      categoryName: r.categoryName || null,
      categoryIcon: r.categoryIcon || null,
      storeId: r.storeId || null,
      storeName: r.storeName || null,
      storeIcon: r.storeIcon || null,
      quantity: null,
      status: "pending",
      amount: null,
      purchasedBy: null,
      addedBy: "Recurring item",
      createdAt: serverTimestamp(),
      doneAt: null,
    });
    await updateDoc(doc(db, "recurringItems", r.id), { lastAddedWeekKey: currentWeekKey });
  }
}

// ------------------------------------------------------------------
// Skeleton loader (shown briefly while the first Firestore snapshot
// is still in flight, instead of a blank list)
// ------------------------------------------------------------------
function skeletonRowHtml() {
  return `
    <li class="skeleton-row">
      <div class="skeleton-block circle"></div>
      <div class="skeleton-lines">
        <div class="skeleton-block line"></div>
        <div class="skeleton-block line short"></div>
      </div>
    </li>`;
}

function renderSkeleton() {
  $("items-empty").classList.add("hidden");
  $("items-list").innerHTML = skeletonRowHtml().repeat(4);
}

// ------------------------------------------------------------------
// Stores / categories setup (fixed presets, no per-household data)
// ------------------------------------------------------------------
function populateSelects() {
  const catOptions = CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("new-item-category").innerHTML = catOptions;

  const storeOptions = allStores().map((s) => `<option value="${s.id}">${s.emoji || ""} ${s.name}</option>`).join("");
  $("new-item-store").innerHTML = storeOptions;
  $("recurring-store-select").innerHTML = storeOptions;
}

function renderStoreFilterChips() {
  const el = $("store-filter-scroll");
  el.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.className = "store-chip";
  allChip.dataset.store = "all";
  allChip.dataset.bg = "#F1EFE8";
  allChip.dataset.fg = "#444441";
  allChip.textContent = "All";
  el.appendChild(allChip);

  allStores().forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "store-chip";
    chip.dataset.store = s.id;
    chip.dataset.bg = s.bg;
    chip.dataset.fg = s.fg;
    chip.textContent = s.name;
    el.appendChild(chip);
  });

  function applyChipStyles(activeId) {
    el.querySelectorAll(".store-chip").forEach((c) => {
      const isActive = c.dataset.store === activeId;
      c.classList.toggle("active", isActive);
      c.style.background = isActive ? "#26215C" : c.dataset.bg;
      c.style.color = isActive ? "#ffffff" : c.dataset.fg;
    });
  }

  applyChipStyles("all");

  el.querySelectorAll(".store-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeStoreFilter = chip.dataset.store;
      applyChipStyles(activeStoreFilter);
      renderItems();
    });
  });
}

// ------------------------------------------------------------------
// Frequent-item stats — powers quick-add chips + name autocomplete
// ------------------------------------------------------------------
function buildNameStats() {
  // items is ordered createdAt desc, so the first entry seen per name
  // is also the most recently used category/store for that name.
  const stats = new Map();
  items.forEach((it) => {
    const key = (it.name || "").trim().toLowerCase();
    if (!key) return;
    if (!stats.has(key)) {
      stats.set(key, { name: it.name, categoryId: it.categoryId, storeId: it.storeId, count: 0 });
    }
    stats.get(key).count += 1;
  });
  return stats;
}

function renderQuickAddChips() {
  const stats = buildNameStats();
  const activeKeys = new Set(
    items
      .filter((i) => i.status === "pending" && !pendingDeletes.has(i.id))
      .map((i) => (i.name || "").trim().toLowerCase())
  );
  const frequent = [...stats.entries()]
    .filter(([key, v]) => v.count >= 2 && !activeKeys.has(key))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  const el = $("quick-add-scroll");
  if (frequent.length === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = frequent.map(([key, v]) => (
    `<button class="quick-add-chip" data-key="${escapeHtml(key)}"><i class="ti ti-plus" aria-hidden="true"></i> ${escapeHtml(v.name)}</button>`
  )).join("");
}

$("quick-add-scroll").addEventListener("click", async (e) => {
  const btn = e.target.closest(".quick-add-chip");
  if (!btn) return;
  const stats = buildNameStats();
  const v = stats.get(btn.dataset.key);
  if (!v) return;
  const category = CATEGORIES.find((c) => c.id === v.categoryId);
  const store = allStores().find((s) => s.id === v.storeId);
  await addDoc(collection(db, "items"), {
    name: v.name,
    categoryId: category ? category.id : null,
    categoryName: category ? category.name : null,
    categoryIcon: category ? category.icon : null,
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeIcon: store ? store.emoji : null,
    quantity: null,
    status: "pending",
    amount: null,
    purchasedBy: null,
    addedBy: userName,
    createdAt: serverTimestamp(),
    doneAt: null,
  });
});

function renderNameDatalist() {
  const stats = buildNameStats();
  const names = [...new Set([...stats.values()].map((v) => v.name).filter(Boolean))];
  $("item-name-history").innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function renderPurchasedByDatalist() {
  const names = new Set();
  items.forEach((it) => {
    if (it.purchasedBy) names.add(it.purchasedBy);
    if (it.addedBy) names.add(it.addedBy);
  });
  $("purchased-by-history").innerHTML = [...names].map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

$("new-item-name").addEventListener("input", () => {
  const typed = $("new-item-name").value.trim().toLowerCase();
  if (!typed) return;
  const match = buildNameStats().get(typed);
  if (!match) return;
  if (match.categoryId) $("new-item-category").value = match.categoryId;
  if (match.storeId) $("new-item-store").value = match.storeId;
});

// ------------------------------------------------------------------
// Realtime subscription — single shared list, no household scoping
// ------------------------------------------------------------------
function subscribeItems() {
  if (unsubItems) unsubItems();
  const itemsQuery = query(collection(db, "items"), orderBy("createdAt", "desc"));
  unsubItems = onSnapshot(itemsQuery, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderItems();
    renderQuickAddChips();
    renderNameDatalist();
    renderPurchasedByDatalist();
    if (currentView === "inventory") renderInventory();
    if (currentView === "spend") renderDashboard();
    if (currentView === "whatsapp") renderWhatsApp();
  });
}

// ------------------------------------------------------------------
// Voice input — fills the "Add an item" box by speech instead of
// typing, using the browser's built-in Web Speech API (free, no
// backend, no API key). Not supported on every browser (notably
// iOS Safari), so the mic button only appears when the API is
// actually available, rather than showing a button that won't work.
// ------------------------------------------------------------------
function initVoiceInput() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $("voice-add-btn");
  const statusEl = $("voice-status");
  if (!SpeechRecognitionCtor) return; // leave the button hidden

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let listening = false;

  recognition.onresult = (e) => {
    const transcript = (e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "").trim();
    if (transcript) {
      $("new-item-name").value = transcript;
      // Reuse the existing name-autocomplete logic (fills category/store
      // if this item's been added before) by firing the same input event.
      $("new-item-name").dispatchEvent(new Event("input", { bubbles: true }));
      statusEl.textContent = `Heard: "${transcript}"`;
    } else {
      statusEl.textContent = "Didn't catch that — try again.";
    }
    statusEl.classList.remove("hidden");
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      statusEl.textContent = "Microphone permission denied.";
    } else if (e.error === "no-speech") {
      statusEl.textContent = "Didn't hear anything — try again.";
    } else {
      statusEl.textContent = "Voice input didn't work — try typing instead.";
    }
    statusEl.classList.remove("hidden");
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");
  };

  micBtn.classList.remove("hidden");
  micBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    statusEl.classList.add("hidden");
    try {
      recognition.start();
      listening = true;
      micBtn.classList.add("listening");
    } catch (e) {
      // Already-started errors etc. — ignore, button state stays as-is.
    }
  });
}

initVoiceInput();

// ------------------------------------------------------------------
// Add item
// ------------------------------------------------------------------
$("add-item-btn").addEventListener("click", async () => {
  const name = $("new-item-name").value.trim();
  if (!name) return;
  const category = CATEGORIES.find((c) => c.id === $("new-item-category").value);
  const store = allStores().find((s) => s.id === $("new-item-store").value);
  const quantity = $("new-item-qty").value.trim() || null;

  await addDoc(collection(db, "items"), {
    name,
    categoryId: category ? category.id : null,
    categoryName: category ? category.name : null,
    categoryIcon: category ? category.icon : null,
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeIcon: store ? store.emoji : null,
    quantity,
    status: "pending",
    amount: null,
    purchasedBy: null,
    addedBy: userName,
    createdAt: serverTimestamp(),
    doneAt: null,
  });

  $("new-item-name").value = "";
  $("new-item-qty").value = "";
});

document.querySelectorAll("#status-filter .seg").forEach((seg) => {
  seg.addEventListener("click", () => {
    document.querySelectorAll("#status-filter .seg").forEach((s) => s.classList.remove("active"));
    seg.classList.add("active");
    activeStatusFilter = seg.dataset.status;
    renderItems();
  });
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function categoryFor(item) {
  return CATEGORIES.find((c) => c.id === item.categoryId);
}

function storeFor(item) {
  return allStores().find((s) => s.id === item.storeId);
}

// ------------------------------------------------------------------
// List view
// ------------------------------------------------------------------
const editingIds = new Set();

function itemRowHtml(item) {
  if (editingIds.has(item.id)) return editingRowHtml(item);

  const cat = categoryFor(item);
  const store = storeFor(item);
  const catBg = cat ? cat.bg : "#F1EFE8";
  const catFg = cat ? cat.fg : "#444441";
  const catIcon = cat ? cat.icon : "ti-category";
  const done = item.status === "done";

  const tickHtml = done
    ? `<button class="tick-btn checked" data-action="undo" data-id="${item.id}"><i class="ti ti-check" aria-hidden="true"></i></button>`
    : `<button class="tick-btn" data-action="start-edit" data-id="${item.id}"></button>`;

  let metaHtml = `${item.categoryName || ""}${store ? ` <span class="store-dot" style="background:${store.fg}"></span>${store.name}` : ""}`;
  if (done) {
    metaHtml += ` · $${Number(item.amount || 0).toFixed(2)} · Done ${formatDate(item.doneAt)}`;
    if (item.purchasedBy) metaHtml += ` · ${avatarHtml(item.purchasedBy, 15)} ${escapeHtml(item.purchasedBy)}`;
  } else {
    metaHtml += ` · Added ${formatDate(item.createdAt)}`;
    if (item.addedBy) metaHtml += ` by ${avatarHtml(item.addedBy, 15)} ${escapeHtml(item.addedBy)}`;
  }

  const noteHtml = item.note ? `<div class="item-note"><i class="ti ti-note" aria-hidden="true"></i> ${escapeHtml(item.note)}</div>` : "";

  const favBtn = `<button class="fav-btn ${item.favorite ? "active" : ""}" data-action="toggle-favorite" data-id="${item.id}" aria-label="Favorite"><i class="ti ${item.favorite ? "ti-star-filled" : "ti-star"}" aria-hidden="true"></i></button>`;
  const noteBtn = `<button class="edit-btn" data-action="edit-note" data-id="${item.id}" aria-label="Add note"><i class="ti ti-notes" aria-hidden="true"></i></button>`;
  const editBtn = done
    ? `<button class="edit-btn" data-action="edit-amount" data-id="${item.id}"><i class="ti ti-pencil" aria-hidden="true"></i></button>`
    : "";

  return `
    <li class="item-row ${done ? "done" : ""}" data-id="${item.id}">
      ${tickHtml}
      <div class="category-icon" style="background:${catBg}; color:${catFg};"><i class="ti ${catIcon}" aria-hidden="true"></i></div>
      <div class="item-main">
        <div class="item-name">${escapeHtml(item.name)}${item.quantity ? ` <span class="muted small">(${escapeHtml(item.quantity)})</span>` : ""}</div>
        ${noteHtml}
        <div class="item-meta">${metaHtml}</div>
      </div>
      ${favBtn}
      ${editBtn}
      ${noteBtn}
      <button class="delete-btn" data-action="delete" data-id="${item.id}"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </li>`;
}

function editingRowHtml(item) {
  const cat = categoryFor(item);
  const catBg = cat ? cat.bg : "#F1EFE8";
  const catFg = cat ? cat.fg : "#444441";
  const catIcon = cat ? cat.icon : "ti-category";

  return `
    <li class="item-row editing" data-id="${item.id}">
      <div class="category-icon" style="background:${catBg}; color:${catFg};"><i class="ti ${catIcon}" aria-hidden="true"></i></div>
      <div class="item-main">
        <div class="item-name">${escapeHtml(item.name)}${item.quantity ? ` <span class="muted small">(${escapeHtml(item.quantity)})</span>` : ""}</div>
        <div class="edit-fields">
          <input type="number" step="0.01" placeholder="Amount $" class="amount-input" data-id="${item.id}" />
          <input type="text" placeholder="Purchased by" class="purchased-input" list="purchased-by-history" value="${escapeHtml(userName)}" data-id="${item.id}" />
        </div>
      </div>
      <button class="btn primary small" data-action="save-done" data-id="${item.id}"><i class="ti ti-check" aria-hidden="true"></i></button>
      <button class="link-btn" data-action="cancel-edit" data-id="${item.id}">Cancel</button>
    </li>`;
}

let activeSortMode = "category";

function renderItems() {
  let filtered = items.filter((i) => !pendingDeletes.has(i.id));
  if (activeStoreFilter !== "all") filtered = filtered.filter((i) => i.storeId === activeStoreFilter);
  if (activeStatusFilter === "pending") filtered = filtered.filter((i) => i.status === "pending");
  if (activeStatusFilter === "done") filtered = filtered.filter((i) => i.status === "done");

  const list = $("items-list");
  let html = "";

  if (activeSortMode === "category") {
    // Group visually by category, following the CATEGORIES preset order.
    // Favorited items are pinned to the top within each group.
    const groups = new Map();
    filtered.forEach((item) => {
      const key = item.categoryId || "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    groups.forEach((group) => {
      group.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    });

    CATEGORIES.forEach((cat) => {
      const group = groups.get(cat.id);
      if (!group || group.length === 0) return;
      html += `<li class="category-header"><i class="ti ${cat.icon}" aria-hidden="true"></i> ${cat.name}</li>`;
      html += group.map(itemRowHtml).join("");
      groups.delete(cat.id);
    });
    // Any leftover items whose categoryId didn't match a known preset.
    groups.forEach((group) => {
      html += group.map(itemRowHtml).join("");
    });
  } else {
    let sorted = [...filtered];
    if (activeSortMode === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (activeSortMode === "recent") {
      sorted.sort((a, b) => {
        const da = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
        const db_ = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
        return db_ - da;
      });
    } else if (activeSortMode === "price") {
      sorted.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    }
    html = sorted.map(itemRowHtml).join("");
  }

  list.innerHTML = html;
  $("items-empty").classList.toggle("hidden", filtered.length > 0);
}

$("sort-select").addEventListener("change", () => {
  activeSortMode = $("sort-select").value;
  renderItems();
});

$("items-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const itemRef = doc(db, "items", id);
  if (btn.dataset.action === "start-edit") {
    editingIds.add(id);
    renderItems();
  } else if (btn.dataset.action === "cancel-edit") {
    editingIds.delete(id);
    renderItems();
  } else if (btn.dataset.action === "save-done") {
    const amountInput = document.querySelector(`.amount-input[data-id="${id}"]`);
    const purchasedInput = document.querySelector(`.purchased-input[data-id="${id}"]`);
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      alert("Enter a valid amount first.");
      return;
    }
    const purchasedBy = purchasedInput.value.trim() || userName || null;
    await updateDoc(itemRef, { status: "done", amount, purchasedBy, doneAt: serverTimestamp() });
    editingIds.delete(id);
    renderItems();
  } else if (btn.dataset.action === "undo") {
    await updateDoc(itemRef, { status: "pending", amount: null, doneAt: null, purchasedBy: null });
  } else if (btn.dataset.action === "edit-amount") {
    const item = items.find((i) => i.id === id);
    const currentAmount = item && item.amount != null ? item.amount : "";
    const nextAmount = window.prompt("Update the amount for this item:", currentAmount);
    if (nextAmount === null) return;
    const parsedAmount = parseFloat(nextAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    const currentPurchasedBy = item && item.purchasedBy ? item.purchasedBy : "";
    const nextPurchasedBy = window.prompt("Purchased by:", currentPurchasedBy);
    if (nextPurchasedBy === null) return;
    await updateDoc(itemRef, { amount: parsedAmount, purchasedBy: nextPurchasedBy.trim() || null });
  } else if (btn.dataset.action === "toggle-favorite") {
    const item = items.find((i) => i.id === id);
    await updateDoc(itemRef, { favorite: !(item && item.favorite) });
  } else if (btn.dataset.action === "edit-note") {
    const item = items.find((i) => i.id === id);
    const current = item && item.note ? item.note : "";
    const next = window.prompt('Note for this item (e.g. "get the discount brand"):', current);
    if (next === null) return;
    await updateDoc(itemRef, { note: next.trim() || null });
  } else if (btn.dataset.action === "delete") {
    const row = btn.closest(".item-row");
    if (row) {
      row.classList.add("removing");
      setTimeout(() => scheduleDelete(id), 200);
    } else {
      scheduleDelete(id);
    }
  }
});

// ------------------------------------------------------------------
// Undo-on-delete: soft-delete with a brief undo window before the
// document is actually removed from Firestore.
// ------------------------------------------------------------------
const pendingDeletes = new Set();
const deleteTimers = {};

async function finalizeDelete(id) {
  if (!pendingDeletes.has(id)) return;
  pendingDeletes.delete(id);
  clearTimeout(deleteTimers[id]);
  delete deleteTimers[id];
  await deleteDoc(doc(db, "items", id));
}

function scheduleDelete(id) {
  // Only one item is undoable at a time — finalize any earlier pending
  // delete right away so the toast always matches what Undo restores.
  [...pendingDeletes].forEach((otherId) => {
    if (otherId !== id) finalizeDelete(otherId);
  });

  const item = items.find((i) => i.id === id);
  pendingDeletes.add(id);
  renderItems();
  renderQuickAddChips();

  $("undo-toast-text").textContent = item ? `Deleted "${item.name}"` : "Item deleted";
  $("undo-toast").classList.remove("hidden");

  clearTimeout(deleteTimers[id]);
  deleteTimers[id] = setTimeout(() => {
    finalizeDelete(id);
    $("undo-toast").classList.add("hidden");
  }, 5000);
}

$("undo-toast-btn").addEventListener("click", () => {
  pendingDeletes.forEach((id) => clearTimeout(deleteTimers[id]));
  pendingDeletes.clear();
  $("undo-toast").classList.add("hidden");
  renderItems();
  renderQuickAddChips();
});

// ------------------------------------------------------------------
// Inventory tab — curated common household items, one-tap add
// ------------------------------------------------------------------
const INVENTORY_ITEMS = [
  // Produce
  { name: "Bananas", categoryId: "produce" },
  { name: "Apples", categoryId: "produce" },
  { name: "Carrots", categoryId: "produce" },
  { name: "Broccoli", categoryId: "produce" },
  { name: "Tomatoes", categoryId: "produce" },
  { name: "Potatoes", categoryId: "produce" },
  { name: "Onions", categoryId: "produce" },
  { name: "Spinach", categoryId: "produce" },
  { name: "Cucumber", categoryId: "produce" },
  { name: "Capsicum", categoryId: "produce" },
  { name: "Avocado", categoryId: "produce" },
  { name: "Lemons", categoryId: "produce" },
  { name: "Grapes", categoryId: "produce" },
  { name: "Oranges", categoryId: "produce" },
  { name: "Sweet potato", categoryId: "produce" },
  { name: "Mushrooms", categoryId: "produce" },
  // Dairy & Eggs
  { name: "Milk", categoryId: "dairy" },
  { name: "Butter", categoryId: "dairy" },
  { name: "Cheese slices", categoryId: "dairy" },
  { name: "Kids yoghurt pouches", categoryId: "dairy" },
  { name: "Greek yoghurt", categoryId: "dairy" },
  { name: "Eggs", categoryId: "dairy" },
  { name: "Cream", categoryId: "dairy" },
  { name: "Sour cream", categoryId: "dairy" },
  { name: "String cheese", categoryId: "dairy" },
  { name: "Parmesan", categoryId: "dairy" },
  // Meat & Poultry
  { name: "Chicken breast", categoryId: "meat" },
  { name: "Chicken thighs", categoryId: "meat" },
  { name: "Beef mince", categoryId: "meat" },
  { name: "Sausages", categoryId: "meat" },
  { name: "Bacon", categoryId: "meat" },
  { name: "Lamb chops", categoryId: "meat" },
  { name: "Chicken nuggets", categoryId: "meat" },
  { name: "Ham slices", categoryId: "meat" },
  // Seafood
  { name: "Salmon fillets", categoryId: "seafood" },
  { name: "Frozen prawns", categoryId: "seafood" },
  { name: "Tinned tuna", categoryId: "seafood" },
  { name: "Fish fingers", categoryId: "seafood" },
  // Bakery
  { name: "Sandwich bread", categoryId: "bakery" },
  { name: "Wraps", categoryId: "bakery" },
  { name: "Bread rolls", categoryId: "bakery" },
  { name: "Muffins", categoryId: "bakery" },
  { name: "Bagels", categoryId: "bakery" },
  { name: "Croissants", categoryId: "bakery" },
  // Rice, Grains & Lentils
  { name: "Rice", categoryId: "grains" },
  { name: "Pasta", categoryId: "grains" },
  { name: "Noodles", categoryId: "grains" },
  { name: "Rolled oats", categoryId: "grains" },
  { name: "Quinoa", categoryId: "grains" },
  { name: "Lentils", categoryId: "grains" },
  // Pantry & Dry Goods
  { name: "Flour", categoryId: "pantry" },
  { name: "Sugar", categoryId: "pantry" },
  { name: "Cooking oil", categoryId: "pantry" },
  { name: "Canned tomatoes", categoryId: "pantry" },
  { name: "Canned beans", categoryId: "pantry" },
  { name: "Peanut butter", categoryId: "pantry" },
  { name: "Jam", categoryId: "pantry" },
  { name: "Honey", categoryId: "pantry" },
  { name: "Stock cubes", categoryId: "pantry" },
  { name: "Breakfast cereal", categoryId: "pantry" },
  { name: "Kids cereal", categoryId: "pantry" },
  { name: "Pasta sauce", categoryId: "pantry" },
  // Spices & Condiments
  { name: "Salt", categoryId: "spices" },
  { name: "Black pepper", categoryId: "spices" },
  { name: "Garlic", categoryId: "spices" },
  { name: "Ginger", categoryId: "spices" },
  { name: "Turmeric", categoryId: "spices" },
  { name: "Cumin", categoryId: "spices" },
  { name: "Mixed herbs", categoryId: "spices" },
  { name: "Curry powder", categoryId: "spices" },
  { name: "Soy sauce", categoryId: "spices" },
  { name: "Tomato sauce", categoryId: "spices" },
  { name: "Mayonnaise", categoryId: "spices" },
  // Frozen Foods
  { name: "Frozen peas", categoryId: "frozen" },
  { name: "Frozen corn", categoryId: "frozen" },
  { name: "Frozen berries", categoryId: "frozen" },
  { name: "Ice cream", categoryId: "frozen" },
  { name: "Frozen pizza", categoryId: "frozen" },
  { name: "Frozen chips", categoryId: "frozen" },
  { name: "Frozen dumplings", categoryId: "frozen" },
  // Snacks
  { name: "Muesli bars", categoryId: "snacks" },
  { name: "Chips", categoryId: "snacks" },
  { name: "Crackers", categoryId: "snacks" },
  { name: "Popcorn", categoryId: "snacks" },
  { name: "Fruit snacks", categoryId: "snacks" },
  { name: "Biscuits", categoryId: "snacks" },
  { name: "Mixed nuts", categoryId: "snacks" },
  { name: "Dried fruit", categoryId: "snacks" },
  // Beverages
  { name: "Orange juice", categoryId: "beverages" },
  { name: "Apple juice", categoryId: "beverages" },
  { name: "Juice poppers", categoryId: "beverages" },
  { name: "Soft drink", categoryId: "beverages" },
  { name: "Water bottles", categoryId: "beverages" },
  { name: "Coffee", categoryId: "beverages" },
  { name: "Tea bags", categoryId: "beverages" },
  // Household & Cleaning
  { name: "Dishwashing liquid", categoryId: "household" },
  { name: "Laundry detergent", categoryId: "household" },
  { name: "Paper towels", categoryId: "household" },
  { name: "Toilet paper", categoryId: "household" },
  { name: "Bin liners", categoryId: "household" },
  { name: "Cling wrap", categoryId: "household" },
  { name: "Aluminium foil", categoryId: "household" },
  { name: "All-purpose cleaner", categoryId: "household" },
  { name: "Sponges", categoryId: "household" },
  { name: "Tissues", categoryId: "household" },
  // Personal Care
  { name: "Shampoo", categoryId: "personal-care" },
  { name: "Conditioner", categoryId: "personal-care" },
  { name: "Body wash", categoryId: "personal-care" },
  { name: "Toothpaste", categoryId: "personal-care" },
  { name: "Toothbrushes", categoryId: "personal-care" },
  { name: "Deodorant", categoryId: "personal-care" },
  { name: "Hand soap", categoryId: "personal-care" },
  { name: "Sunscreen", categoryId: "personal-care" },
  { name: "Band-aids", categoryId: "personal-care" },
  // Baby / Kids Care (11yo + 3yo household)
  { name: "Pull-up nappies", categoryId: "baby" },
  { name: "Baby wipes", categoryId: "baby" },
  { name: "Toddler milk drink", categoryId: "baby" },
  { name: "Kids multivitamin gummies", categoryId: "baby" },
  { name: "Nappy rash cream", categoryId: "baby" },
  { name: "Kids toothpaste", categoryId: "baby" },
  { name: "Kids toothbrush", categoryId: "baby" },
  { name: "School lunchbox snacks", categoryId: "baby" },
  // Other
  { name: "Batteries", categoryId: "other" },
  { name: "Light globes", categoryId: "other" },
  { name: "Matches / lighter", categoryId: "other" },
  { name: "Ziplock bags", categoryId: "other" },
];

// Custom items the family has actually added 3+ times that aren't already
// in the static catalog — makes Inventory grow with real household habits,
// derived purely from shared item history (no extra Firestore storage).
function buildLearnedInventoryItems() {
  const known = new Set(INVENTORY_ITEMS.map((i) => i.name.toLowerCase()));
  const stats = buildNameStats();
  const learned = [];
  stats.forEach((v, key) => {
    if (v.count >= 3 && !known.has(key)) {
      learned.push({ name: v.name, categoryId: v.categoryId || "other", custom: true });
    }
  });
  return learned;
}

function renderInventory() {
  const search = ($("inventory-search").value || "").trim().toLowerCase();
  const activeNames = new Set(
    items
      .filter((i) => i.status === "pending" && !pendingDeletes.has(i.id))
      .map((i) => (i.name || "").trim().toLowerCase())
  );

  const allInventory = [...INVENTORY_ITEMS, ...buildLearnedInventoryItems()];
  const groups = new Map();
  allInventory.forEach((inv) => {
    if (search && !inv.name.toLowerCase().includes(search)) return;
    if (!groups.has(inv.categoryId)) groups.set(inv.categoryId, []);
    groups.get(inv.categoryId).push(inv);
  });
  // Favorited items are pinned to the top within each category group.
  groups.forEach((group) => {
    group.sort((a, b) => {
      const favA = favoriteNames.has(a.name.toLowerCase()) ? 1 : 0;
      const favB = favoriteNames.has(b.name.toLowerCase()) ? 1 : 0;
      return favB - favA;
    });
  });

  let html = "";
  CATEGORIES.forEach((cat) => {
    const group = groups.get(cat.id);
    if (!group || group.length === 0) return;
    html += `<li class="category-header"><i class="ti ${cat.icon}" aria-hidden="true"></i> ${cat.name}</li>`;
    html += group.map((inv) => {
      const inList = activeNames.has(inv.name.toLowerCase());
      const isFav = favoriteNames.has(inv.name.toLowerCase());
      const customTag = inv.custom ? `<span class="custom-tag">Yours</span>` : "";
      const favBtn = `<button class="fav-btn ${isFav ? "active" : ""}" data-action="toggle-inv-favorite" data-name="${escapeHtml(inv.name)}" aria-label="Favorite"><i class="ti ${isFav ? "ti-star-filled" : "ti-star"}" aria-hidden="true"></i></button>`;
      const action = inList
        ? `<span class="in-list-badge"><i class="ti ti-check" aria-hidden="true"></i> In list</span>`
        : `<button class="btn primary small" data-action="inv-add" data-name="${escapeHtml(inv.name)}" data-category="${cat.id}"><i class="ti ti-plus" aria-hidden="true"></i> Add</button>`;
      return `
        <li class="inventory-row">
          <div class="category-icon" style="background:${cat.bg}; color:${cat.fg};"><i class="ti ${cat.icon}" aria-hidden="true"></i></div>
          <div class="item-main"><div class="item-name">${escapeHtml(inv.name)}${customTag}</div></div>
          ${favBtn}
          ${action}
        </li>`;
    }).join("");
  });

  $("inventory-list").innerHTML = html;
  $("inventory-empty").classList.toggle("hidden", html !== "");
}

$("inventory-search").addEventListener("input", renderInventory);

$("inventory-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.action === "toggle-inv-favorite") {
    const key = btn.dataset.name.trim().toLowerCase();
    const next = new Set(favoriteNames);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    await setDoc(doc(db, "meta", "favorites"), { names: [...next] }, { merge: true });
    return;
  }

  if (btn.dataset.action === "inv-add") {
    const name = btn.dataset.name;
    const category = CATEGORIES.find((c) => c.id === btn.dataset.category);
    await addDoc(collection(db, "items"), {
      name,
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
      categoryIcon: category ? category.icon : null,
      storeId: null,
      storeName: null,
      storeIcon: null,
      quantity: null,
      status: "pending",
      amount: null,
      purchasedBy: null,
      addedBy: userName,
      createdAt: serverTimestamp(),
      doneAt: null,
    });
  }
});

// ------------------------------------------------------------------
// Spend / dashboard view
// ------------------------------------------------------------------
let chartByStore = null;
let chartByCategory = null;
let chartTrend = null;

function renderDashboard() {
  const doneItems = items.filter((i) => i.status === "done" && !pendingDeletes.has(i.id));
  const now = new Date();

  const monthDoneItems = doneItems.filter((i) => {
    const d = i.doneAt && i.doneAt.toDate ? i.doneAt.toDate() : null;
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const monthTotal = monthDoneItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const allTimeTotal = doneItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const doneThisMonth = monthDoneItems.length;

  $("stat-pending").textContent = items.filter((i) => i.status === "pending").length;
  $("stat-done-month").textContent = doneThisMonth;
  $("stat-month-total").textContent = `$${monthTotal.toFixed(2)}`;
  $("stat-all-total").textContent = `$${allTimeTotal.toFixed(2)}`;

  renderBudget(monthTotal);
  renderStoreBudgets(monthDoneItems);
  renderMonthlySummaryBanner(doneItems);
  renderWeeklySummaryBanner(doneItems);

  // Spend over time (last 6 months)
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendMonths.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString(undefined, { month: "short" }) });
  }
  const trendTotals = trendMonths.map(({ year, month }) => doneItems
    .filter((i) => {
      const d = i.doneAt && i.doneAt.toDate ? i.doneAt.toDate() : null;
      return d && d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, i) => sum + Number(i.amount || 0), 0));

  const ctxTrend = $("chart-trend").getContext("2d");
  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: trendMonths.map((m) => m.label),
      datasets: [{
        label: "Spend ($)",
        data: trendTotals,
        borderColor: "#534AB7",
        backgroundColor: "rgba(83,74,183,0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  // Spend by store
  const byStore = {};
  doneItems.forEach((i) => {
    const label = i.storeName || "Other";
    byStore[label] = (byStore[label] || 0) + Number(i.amount || 0);
  });
  const storeColors = Object.keys(byStore).map((label) => {
    const match = allStores().find((s) => s.name === label);
    return match ? match.chart : "#888780";
  });

  const ctxStore = $("chart-by-store").getContext("2d");
  if (chartByStore) chartByStore.destroy();
  chartByStore = new Chart(ctxStore, {
    type: "bar",
    data: {
      labels: Object.keys(byStore),
      datasets: [{ label: "Spend by store ($)", data: Object.values(byStore), backgroundColor: storeColors, borderRadius: 6 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  // Spend by category
  const byCategory = {};
  doneItems.forEach((i) => {
    const label = i.categoryName || "Other";
    byCategory[label] = (byCategory[label] || 0) + Number(i.amount || 0);
  });
  const categoryColors = Object.keys(byCategory).map((label) => {
    const match = CATEGORIES.find((c) => c.name === label);
    return match ? match.fg : "#888780";
  });

  const ctxCategory = $("chart-by-category").getContext("2d");
  if (chartByCategory) chartByCategory.destroy();
  chartByCategory = new Chart(ctxCategory, {
    type: "bar",
    data: {
      labels: Object.keys(byCategory),
      datasets: [{ label: "Spend by category ($)", data: Object.values(byCategory), backgroundColor: categoryColors, borderRadius: 6 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  // Recently bought
  const recent = [...doneItems]
    .sort((a, b) => {
      const da = a.doneAt && a.doneAt.toDate ? a.doneAt.toDate().getTime() : 0;
      const db_ = b.doneAt && b.doneAt.toDate ? b.doneAt.toDate().getTime() : 0;
      return db_ - da;
    })
    .slice(0, 15);

  $("recent-done-list").innerHTML = recent.map((i) => {
    const store = storeFor(i);
    const byLine = i.purchasedBy ? ` · ${avatarHtml(i.purchasedBy, 15)} ${escapeHtml(i.purchasedBy)}` : "";
    return `<li class="receipt-row" style="background:${store ? store.bg : "#F1EFE8"}; color:${store ? store.fg : "#444441"};"><span>${escapeHtml(i.name)} — ${i.storeName || "Other"} · ${formatDate(i.doneAt)}${byLine}</span><strong>$${Number(i.amount || 0).toFixed(2)}</strong></li>`;
  }).join("");
  $("recent-done-empty").classList.toggle("hidden", recent.length > 0);

  renderHistorySearch();
}

// ------------------------------------------------------------------
// Search across full purchase history (not just the recent-15 cap) —
// "when did we last buy printer ink and how much was it."
// ------------------------------------------------------------------
function renderHistorySearch() {
  const searchTerm = ($("history-search-input").value || "").trim().toLowerCase();
  const resultsEl = $("history-search-results");
  const emptyEl = $("history-search-empty");

  if (!searchTerm) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    return;
  }

  const matches = items
    .filter((i) => i.status === "done" && (i.name || "").toLowerCase().includes(searchTerm))
    .sort((a, b) => {
      const da = a.doneAt && a.doneAt.toDate ? a.doneAt.toDate().getTime() : 0;
      const db_ = b.doneAt && b.doneAt.toDate ? b.doneAt.toDate().getTime() : 0;
      return db_ - da;
    })
    .slice(0, 30);

  if (matches.length === 0) {
    resultsEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  resultsEl.innerHTML = matches.map((i) => {
    const store = storeFor(i);
    const byLine = i.purchasedBy ? ` · ${avatarHtml(i.purchasedBy, 15)} ${escapeHtml(i.purchasedBy)}` : "";
    return `<li class="receipt-row" style="background:${store ? store.bg : "#F1EFE8"}; color:${store ? store.fg : "#444441"};"><span>${escapeHtml(i.name)} — ${i.storeName || "Other"} · ${formatDate(i.doneAt)}${byLine}</span><strong>$${Number(i.amount || 0).toFixed(2)}</strong></li>`;
  }).join("");
}

$("history-search-input").addEventListener("input", renderHistorySearch);

// ------------------------------------------------------------------
// CSV export of spend history
// ------------------------------------------------------------------
function csvEscape(val) {
  const str = String(val == null ? "" : val);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportSpendCsv() {
  const doneItems = items.filter((i) => i.status === "done");
  const header = ["Name", "Category", "Store", "Amount", "Purchased By", "Date"];
  const rows = doneItems.map((i) => [
    i.name || "",
    i.categoryName || "",
    i.storeName || "",
    Number(i.amount || 0).toFixed(2),
    i.purchasedBy || "",
    i.doneAt && i.doneAt.toDate ? i.doneAt.toDate().toISOString().slice(0, 10) : "",
  ]);
  const csvLines = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shopping-spend-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

$("export-csv-btn").addEventListener("click", exportSpendCsv);

// ------------------------------------------------------------------
// Clear spend history — deletes every "done" item permanently. Handy
// after exporting a CSV, to start the dashboard fresh (e.g. a new year).
// ------------------------------------------------------------------
$("clear-history-btn").addEventListener("click", async () => {
  const doneItems = items.filter((i) => i.status === "done");
  if (doneItems.length === 0) {
    alert("No recorded purchases to clear.");
    return;
  }
  const confirmed = window.confirm(
    `This will permanently delete all ${doneItems.length} recorded purchases (spend charts, trend, and recent-bought history). This can't be undone — export a CSV first if you want a copy. Continue?`
  );
  if (!confirmed) return;
  await Promise.all(doneItems.map((i) => deleteDoc(doc(db, "items", i.id))));
});

// ------------------------------------------------------------------
// Monthly spend summary — auto-surfaced once a new calendar month
// starts, ready to copy into WhatsApp/email. True unattended sending
// isn't possible on a free, no-backend setup, so this gets it drafted
// and one tap from being sent instead.
// ------------------------------------------------------------------
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthlySummaryMessage(doneItems, year, month, monthLabel) {
  const monthItems = doneItems.filter((i) => {
    const d = i.doneAt && i.doneAt.toDate ? i.doneAt.toDate() : null;
    return d && d.getFullYear() === year && d.getMonth() === month;
  });
  const total = monthItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const byStore = {};
  monthItems.forEach((i) => {
    const label = i.storeName || "Other";
    byStore[label] = (byStore[label] || 0) + Number(i.amount || 0);
  });
  const topStores = Object.entries(byStore).sort((a, b) => b[1] - a[1]).slice(0, 3);

  let msg = `📊 ${monthLabel} shopping summary\n\n`;
  msg += `Total spent: $${total.toFixed(2)}\n`;
  msg += `Items bought: ${monthItems.length}\n`;
  if (topStores.length > 0) {
    msg += `\nTop stores:\n`;
    topStores.forEach(([label, amt]) => {
      msg += `• ${label} — $${amt.toFixed(2)}\n`;
    });
  }
  msg += `\nSent via Family Shopping List app`;
  return { message: msg, total, count: monthItems.length };
}

function renderMonthlySummaryBanner(doneItems) {
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prevMonthDate);
  const lastSeen = localStorage.getItem("shoppingListLastSummaryMonth");
  const monthLabel = prevMonthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const summary = buildMonthlySummaryMessage(doneItems, prevMonthDate.getFullYear(), prevMonthDate.getMonth(), monthLabel);
  const banner = $("monthly-summary-banner");

  if (lastSeen === prevKey || summary.count === 0) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  banner.dataset.summaryText = summary.message;
  banner.dataset.summaryKey = prevKey;
  $("summary-month-label").textContent = monthLabel;
  $("summary-total-label").textContent = `$${summary.total.toFixed(2)} across ${summary.count} items`;
}

$("copy-summary-btn").addEventListener("click", async () => {
  const banner = $("monthly-summary-banner");
  const text = banner.dataset.summaryText || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Clipboard API unavailable — fall back silently, banner stays visible.
  }
  localStorage.setItem("shoppingListLastSummaryMonth", banner.dataset.summaryKey || "");
  banner.classList.add("hidden");
});

$("dismiss-summary-btn").addEventListener("click", () => {
  const banner = $("monthly-summary-banner");
  localStorage.setItem("shoppingListLastSummaryMonth", banner.dataset.summaryKey || "");
  banner.classList.add("hidden");
});

// ------------------------------------------------------------------
// Weekly spend digest — same idea as the monthly summary, but for
// families who want a tighter, week-by-week check-in.
// ------------------------------------------------------------------
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function buildWeeklySummaryMessage(doneItems, weekStart, weekEnd, weekLabel) {
  const weekItems = doneItems.filter((i) => {
    const d = i.doneAt && i.doneAt.toDate ? i.doneAt.toDate() : null;
    return d && d >= weekStart && d < weekEnd;
  });
  const total = weekItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);

  let msg = `📅 ${weekLabel} spend check-in\n\n`;
  msg += `Total spent: $${total.toFixed(2)}\n`;
  msg += `Items bought: ${weekItems.length}\n`;
  msg += `\nSent via Family Shopping List app`;
  return { message: msg, total, count: weekItems.length };
}

function renderWeeklySummaryBanner(doneItems) {
  const now = new Date();
  const currentWeekStart = startOfWeek(now);
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = currentWeekStart;
  const prevWeekKey = prevWeekStart.toISOString().slice(0, 10);

  const lastSeen = localStorage.getItem("shoppingListLastWeeklySummaryWeek");
  const weekEndDisplay = new Date(prevWeekEnd.getTime() - 86400000);
  const weekLabel = `${prevWeekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${weekEndDisplay.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const summary = buildWeeklySummaryMessage(doneItems, prevWeekStart, prevWeekEnd, weekLabel);
  const banner = $("weekly-summary-banner");

  if (lastSeen === prevWeekKey || summary.count === 0) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  banner.dataset.summaryText = summary.message;
  banner.dataset.summaryKey = prevWeekKey;
  $("weekly-summary-total-label").textContent = `${weekLabel}: $${summary.total.toFixed(2)} across ${summary.count} items`;
}

$("copy-weekly-summary-btn").addEventListener("click", async () => {
  const banner = $("weekly-summary-banner");
  const text = banner.dataset.summaryText || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Clipboard API unavailable — fall back silently, banner stays visible.
  }
  localStorage.setItem("shoppingListLastWeeklySummaryWeek", banner.dataset.summaryKey || "");
  banner.classList.add("hidden");
});

$("dismiss-weekly-summary-btn").addEventListener("click", () => {
  const banner = $("weekly-summary-banner");
  localStorage.setItem("shoppingListLastWeeklySummaryWeek", banner.dataset.summaryKey || "");
  banner.classList.add("hidden");
});

// ------------------------------------------------------------------
// WhatsApp nudge (copy-paste draft, no deep link) — with a scenario
// picker (Standard / Urgent / Weekly big shop / Quick trip) that
// changes the drafted message's tone, plus a colorful chat-bubble
// preview grouped by store instead of a plain textarea.
// ------------------------------------------------------------------
const WHATSAPP_SCENARIOS = {
  standard: {
    greeting: (today, count, itemWord, storeCount, storeWord) =>
      `Hi! 👋 Today's shopping list (${today}) — ${count} ${itemWord} across ${storeCount} ${storeWord}:`,
    closing: "Can you grab these today? Thank you! 🛒",
    empty: (today) => `Hey! 👋 Nothing left on today's shopping list (${today}) — we're all done! 🎉`,
  },
  urgent: {
    greeting: (today, count, itemWord, storeCount, storeWord) =>
      `🚨 Need these ASAP if you can swing by today (${today}) — ${count} ${itemWord} across ${storeCount} ${storeWord}:`,
    closing: "Sorry for the short notice — really appreciate it! 🙏",
    empty: (today) => `🚨 Just checking — nothing urgent on the list right now (${today}), all clear! 🎉`,
  },
  weekly: {
    greeting: (today, count, itemWord, storeCount, storeWord) =>
      `🛒 Weekly shop time! Full list for this week (${today}) — ${count} ${itemWord} across ${storeCount} ${storeWord}:`,
    closing: "Might take a bit longer than usual with the full list — thanks for taking this on! 🧡",
    empty: (today) => `🛒 Weekly shop check (${today}) — nothing on the list this week, we're all stocked up! 🎉`,
  },
  quick: {
    greeting: (today) => `⚡ Quick trip needed — just a few bits today (${today}):`,
    closing: "Shouldn't take long, thank you!",
    empty: (today) => `⚡ Quick check (${today}) — nothing needed right now, all good! 🎉`,
  },
};

let activeWhatsAppScenario = "standard";

function buildWhatsAppMessage(scenario) {
  const pending = items.filter((i) => i.status === "pending");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const config = WHATSAPP_SCENARIOS[scenario] || WHATSAPP_SCENARIOS.standard;

  if (pending.length === 0) {
    return config.empty(today);
  }

  const byStore = {};
  pending.forEach((item) => {
    const label = item.storeName ? `${item.storeIcon || ""} ${item.storeName}`.trim() : "Unassigned";
    if (!byStore[label]) byStore[label] = [];
    byStore[label].push(`• ${item.name}${item.quantity ? ` (${item.quantity})` : ""}`);
  });

  const storeCount = Object.keys(byStore).length;
  const itemWord = pending.length === 1 ? "item" : "items";
  const storeWord = storeCount === 1 ? "store" : "stores";

  let msg = `${config.greeting(today, pending.length, itemWord, storeCount, storeWord)}\n`;
  for (const [store, lines] of Object.entries(byStore)) {
    msg += `\n*${store}*\n${lines.join("\n")}\n`;
  }
  msg += `\n${config.closing}`;
  return msg;
}

function renderWhatsAppPreview(scenario) {
  const pending = items.filter((i) => i.status === "pending" && !pendingDeletes.has(i.id));
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const config = WHATSAPP_SCENARIOS[scenario] || WHATSAPP_SCENARIOS.standard;
  const preview = $("whatsapp-preview");

  if (pending.length === 0) {
    preview.innerHTML = `<p style="margin:0;">${escapeHtml(config.empty(today))}</p>`;
    return;
  }

  const byStore = new Map();
  pending.forEach((item) => {
    const label = item.storeName || "Unassigned";
    if (!byStore.has(label)) byStore.set(label, { entries: [], store: storeFor(item) });
    byStore.get(label).entries.push(item);
  });

  const storeCount = byStore.size;
  const itemWord = pending.length === 1 ? "item" : "items";
  const storeWord = storeCount === 1 ? "store" : "stores";

  let html = `<p class="whatsapp-preview-greeting">${escapeHtml(config.greeting(today, pending.length, itemWord, storeCount, storeWord))}</p>`;
  byStore.forEach((info, label) => {
    const bg = info.store ? info.store.bg : "#F1EFE8";
    const fg = info.store ? info.store.fg : "#444441";
    html += `<div class="whatsapp-preview-store">
      <span class="whatsapp-preview-store-label" style="background:${bg}; color:${fg};">${escapeHtml(label)}</span>
      <ul class="whatsapp-preview-items">
        ${info.entries.map((i) => `<li>${escapeHtml(i.name)}${i.quantity ? ` <span class="muted small">(${escapeHtml(i.quantity)})</span>` : ""}</li>`).join("")}
      </ul>
    </div>`;
  });
  html += `<p class="whatsapp-preview-closing">${escapeHtml(config.closing)}</p>`;
  preview.innerHTML = html;
}

function renderWhatsApp() {
  const pending = items.filter((i) => i.status === "pending" && !pendingDeletes.has(i.id));

  const byStoreCounts = {};
  pending.forEach((i) => {
    const label = i.storeName ? `${i.storeIcon || ""} ${i.storeName}`.trim() : "Unassigned";
    if (!byStoreCounts[label]) byStoreCounts[label] = { count: 0, store: storeFor(i) };
    byStoreCounts[label].count += 1;
  });
  const storeCount = Object.keys(byStoreCounts).length;

  $("whatsapp-item-count").textContent = pending.length;
  $("whatsapp-store-count").textContent = storeCount;
  $("whatsapp-timestamp").textContent = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const pal = avatarPalette(userName);
  const avatarEl = $("whatsapp-avatar");
  avatarEl.style.background = pal.bg;
  avatarEl.style.color = pal.fg;
  avatarEl.innerHTML = "";
  avatarEl.textContent = avatarInitial(userName);

  $("whatsapp-store-breakdown").innerHTML = Object.entries(byStoreCounts).map(([label, info]) => {
    const bg = info.store ? info.store.bg : "#F1EFE8";
    const fg = info.store ? info.store.fg : "#444441";
    return `<div class="whatsapp-store-pill" style="background:${bg}; color:${fg};">${escapeHtml(label)} · ${info.count}</div>`;
  }).join("");

  $("whatsapp-message").value = buildWhatsAppMessage(activeWhatsAppScenario);
  renderWhatsAppPreview(activeWhatsAppScenario);
  $("copy-status").textContent = "";
}

document.querySelectorAll("#whatsapp-scenario-picker .whatsapp-scenario-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    activeWhatsAppScenario = chip.dataset.scenario;
    document.querySelectorAll("#whatsapp-scenario-picker .whatsapp-scenario-chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderWhatsApp();
  });
});

$("copy-whatsapp-btn").addEventListener("click", async () => {
  const text = $("whatsapp-message").value;
  try {
    await navigator.clipboard.writeText(text);
    $("copy-status").textContent = "Copied! Paste it into WhatsApp.";
  } catch (e) {
    const textarea = $("whatsapp-message");
    textarea.select();
    document.execCommand("copy");
    $("copy-status").textContent = "Copied! Paste it into WhatsApp.";
  }
});

boot();
