import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
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
  { id: "grains", name: "Rice, Grains & Lentils", icon: "ti-wheat", bg: "#FAEEDA", fg: "#633806" },
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

const $ = (id) => document.getElementById(id);
const allStores = () => PRESET_STORES;

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
// Screen / view switching
// ------------------------------------------------------------------
function showScreen(name) {
  ["name-screen", "app-screen"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== name);
  });
}

function showView(name) {
  currentView = name;
  ["list", "confirm", "spend", "whatsapp"].forEach((v) => {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "confirm") renderConfirm();
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
  populateSelects();
  renderStoreFilterChips();
  renderSkeleton();
  subscribeItems();
  showScreen("app-screen");
  showView("list");
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
// Realtime subscription — single shared list, no household scoping
// ------------------------------------------------------------------
function subscribeItems() {
  if (unsubItems) unsubItems();
  const itemsQuery = query(collection(db, "items"), orderBy("createdAt", "desc"));
  unsubItems = onSnapshot(itemsQuery, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderItems();
    renderConfirmBadge();
    if (currentView === "confirm") renderConfirm();
    if (currentView === "spend") renderDashboard();
    if (currentView === "whatsapp") renderWhatsApp();
  });
}

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
function itemRowHtml(item) {
  const cat = categoryFor(item);
  const store = storeFor(item);
  const catBg = cat ? cat.bg : "#F1EFE8";
  const catFg = cat ? cat.fg : "#444441";
  const catIcon = cat ? cat.icon : "ti-category";
  const done = item.status === "done";
  const awaiting = item.status === "awaiting_amount";

  let tickHtml;
  if (awaiting) {
    tickHtml = `<div class="tick-btn locked"><i class="ti ti-clock" aria-hidden="true"></i></div>`;
  } else if (done) {
    tickHtml = `<button class="tick-btn checked" data-action="undo" data-id="${item.id}"><i class="ti ti-check" aria-hidden="true"></i></button>`;
  } else {
    tickHtml = `<button class="tick-btn" data-action="toggle" data-id="${item.id}"></button>`;
  }

  let metaHtml = `${item.categoryName || ""}${store ? ` <span class="store-dot" style="background:${store.fg}"></span>${store.name}` : ""}`;
  if (done) {
    metaHtml += ` · $${Number(item.amount || 0).toFixed(2)} · Done ${formatDate(item.doneAt)}`;
  } else if (awaiting) {
    metaHtml += ` · Awaiting price`;
  } else {
    metaHtml += ` · Added ${formatDate(item.createdAt)}`;
  }

  const editBtn = done
    ? `<button class="edit-btn" data-action="edit-amount" data-id="${item.id}"><i class="ti ti-pencil" aria-hidden="true"></i></button>`
    : "";

  return `
    <li class="item-row ${done ? "done" : ""} ${awaiting ? "awaiting" : ""}" data-id="${item.id}">
      ${tickHtml}
      <div class="category-icon" style="background:${catBg}; color:${catFg};"><i class="ti ${catIcon}" aria-hidden="true"></i></div>
      <div class="item-main">
        <div class="item-name">${escapeHtml(item.name)}${item.quantity ? ` <span class="muted small">(${escapeHtml(item.quantity)})</span>` : ""}</div>
        <div class="item-meta">${metaHtml}</div>
      </div>
      ${editBtn}
      <button class="delete-btn" data-action="delete" data-id="${item.id}"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </li>`;
}

function renderItems() {
  let filtered = items.filter((i) => !pendingDeletes.has(i.id));
  filtered = filtered.filter((i) => i.status !== "awaiting_amount" || activeStatusFilter === "all");
  if (activeStoreFilter !== "all") filtered = filtered.filter((i) => i.storeId === activeStoreFilter);
  if (activeStatusFilter === "pending") filtered = filtered.filter((i) => i.status === "pending");
  if (activeStatusFilter === "done") filtered = filtered.filter((i) => i.status === "done");

  const list = $("items-list");

  // Group visually by category, following the CATEGORIES preset order.
  const groups = new Map();
  filtered.forEach((item) => {
    const key = item.categoryId || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  let html = "";
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

  list.innerHTML = html;
  $("items-empty").classList.toggle("hidden", filtered.length > 0);
}

$("items-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const itemRef = doc(db, "items", id);
  if (btn.dataset.action === "toggle") {
    await updateDoc(itemRef, { status: "awaiting_amount" });
  } else if (btn.dataset.action === "undo") {
    await updateDoc(itemRef, { status: "pending", amount: null, doneAt: null });
  } else if (btn.dataset.action === "edit-amount") {
    const item = items.find((i) => i.id === id);
    const current = item && item.amount != null ? item.amount : "";
    const next = window.prompt("Update the amount for this item:", current);
    if (next === null) return;
    const parsed = parseFloat(next);
    if (!parsed || parsed <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    await updateDoc(itemRef, { amount: parsed });
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
  renderConfirmBadge();

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
  renderConfirmBadge();
});

// ------------------------------------------------------------------
// Confirm amounts view
// ------------------------------------------------------------------
function renderConfirmBadge() {
  const count = items.filter((i) => i.status === "awaiting_amount" && !pendingDeletes.has(i.id)).length;
  const badge = $("confirm-badge");
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

function renderConfirm() {
  const awaiting = items.filter((i) => i.status === "awaiting_amount" && !pendingDeletes.has(i.id));
  const list = $("confirm-list");
  list.innerHTML = awaiting.map((item) => {
    const cat = categoryFor(item);
    const store = storeFor(item);
    return `
      <li class="item-row awaiting" data-id="${item.id}">
        <div class="category-icon" style="background:${cat ? cat.bg : "#F1EFE8"}; color:${cat ? cat.fg : "#444441"};"><i class="ti ${cat ? cat.icon : "ti-category"}" aria-hidden="true"></i></div>
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.name)}${item.quantity ? ` <span class="muted small">(${escapeHtml(item.quantity)})</span>` : ""}</div>
          <div class="item-meta">${item.categoryName || ""}${store ? ` · ${store.name}` : ""}</div>
        </div>
        <input type="number" step="0.01" placeholder="0.00" class="amount-input" data-id="${item.id}" />
        <button class="btn primary small" data-action="confirm" data-id="${item.id}">Confirm</button>
        <button class="link-btn" data-action="back" data-id="${item.id}">Back</button>
      </li>`;
  }).join("");

  $("confirm-empty").classList.toggle("hidden", awaiting.length > 0);
}

$("confirm-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const itemRef = doc(db, "items", id);
  if (btn.dataset.action === "confirm") {
    const input = document.querySelector(`.amount-input[data-id="${id}"]`);
    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) {
      alert("Enter a valid amount first.");
      return;
    }
    await updateDoc(itemRef, { status: "done", amount, doneAt: serverTimestamp() });
  } else if (btn.dataset.action === "back") {
    await updateDoc(itemRef, { status: "pending" });
  }
});

// ------------------------------------------------------------------
// Spend / dashboard view
// ------------------------------------------------------------------
let chartByStore = null;
let chartByCategory = null;

function renderDashboard() {
  const doneItems = items.filter((i) => i.status === "done" && !pendingDeletes.has(i.id));
  const now = new Date();

  const monthTotal = doneItems
    .filter((i) => {
      const d = i.doneAt && i.doneAt.toDate ? i.doneAt.toDate() : null;
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const allTimeTotal = doneItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);

  $("stat-pending").textContent = items.filter((i) => i.status === "pending").length;
  $("stat-awaiting").textContent = items.filter((i) => i.status === "awaiting_amount").length;
  $("stat-month-total").textContent = `$${monthTotal.toFixed(2)}`;
  $("stat-all-total").textContent = `$${allTimeTotal.toFixed(2)}`;

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
    return `<li class="receipt-row" style="background:${store ? store.bg : "#F1EFE8"}; color:${store ? store.fg : "#444441"};"><span>${escapeHtml(i.name)} — ${i.storeName || "Other"} · ${formatDate(i.doneAt)}</span><strong>$${Number(i.amount || 0).toFixed(2)}</strong></li>`;
  }).join("");
  $("recent-done-empty").classList.toggle("hidden", recent.length > 0);
}

// ------------------------------------------------------------------
// WhatsApp nudge (copy-paste draft, no deep link)
// ------------------------------------------------------------------
function buildWhatsAppMessage() {
  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return `🛒 Shopping list is all done! 🎉`;

  const byStore = {};
  pending.forEach((item) => {
    const label = item.storeName ? `${item.storeIcon || ""} ${item.storeName}`.trim() : "Unassigned";
    if (!byStore[label]) byStore[label] = [];
    byStore[label].push(`- ${item.name}${item.quantity ? ` (${item.quantity})` : ""}`);
  });

  let msg = `🛒 *Shopping List*\n`;
  for (const [store, lines] of Object.entries(byStore)) {
    msg += `\n*${store}*\n${lines.join("\n")}\n`;
  }
  msg += `\nSent via Family Shopping List app`;
  return msg;
}

function renderWhatsApp() {
  $("whatsapp-message").value = buildWhatsAppMessage();
  $("copy-status").textContent = "";
}

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
