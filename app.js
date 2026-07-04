import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
let currentProfile = null;
let household = null;
let customStores = [];
let items = [];
let receipts = [];
let activeStoreFilter = "all";
let activeStatusFilter = "pending";
let unsubItems = null;
let unsubReceipts = null;

const $ = (id) => document.getElementById(id);
const allStores = () => [...PRESET_STORES, ...customStores];

// ------------------------------------------------------------------
// Screen switching
// ------------------------------------------------------------------
function showScreen(name) {
  ["auth-screen", "onboarding-screen", "app-screen"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== name);
  });
}

function showView(name) {
  ["list", "dashboard"].forEach((v) => {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "dashboard") renderDashboard();
}

// ------------------------------------------------------------------
// Boot / Auth
// ------------------------------------------------------------------
async function boot() {
  // Handle email-link sign-in redirect
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem("emailForSignIn");
    if (!email) email = window.prompt("Confirm your email to finish signing in:");
    try {
      await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem("emailForSignIn");
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) {
      $("auth-msg").textContent = "Sign-in link failed: " + e.message;
    }
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await handleSignedIn(user);
    } else {
      cleanupSubscriptions();
      showScreen("auth-screen");
    }
  });
}

async function handleSignedIn(user) {
  currentUser = user;
  const userSnap = await getDoc(doc(db, "users", user.uid));
  const profile = userSnap.exists() ? userSnap.data() : null;

  if (!profile || !profile.householdId) {
    currentProfile = profile;
    showScreen("onboarding-screen");
    return;
  }

  currentProfile = profile;
  const hhSnap = await getDoc(doc(db, "households", profile.householdId));
  if (!hhSnap.exists()) {
    showScreen("onboarding-screen");
    return;
  }
  household = { id: hhSnap.id, ...hhSnap.data() };

  await loadCustomStores();
  populateSelects();
  renderStoreFilterChips();
  subscribeRealtime();
  renderHouseholdHeader();
  showScreen("app-screen");
  showView("list");
}

$("auth-send-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  if (!email) return;
  $("auth-msg").textContent = "Sending...";
  try {
    const actionCodeSettings = {
      url: window.location.href,
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem("emailForSignIn", email);
    $("auth-msg").textContent = "Check your email for the sign-in link!";
  } catch (e) {
    $("auth-msg").textContent = e.message;
  }
});

$("logout-btn").addEventListener("click", async () => {
  cleanupSubscriptions();
  await signOut(auth);
  window.location.reload();
});

function cleanupSubscriptions() {
  if (unsubItems) unsubItems();
  if (unsubReceipts) unsubReceipts();
  unsubItems = null;
  unsubReceipts = null;
}

// ------------------------------------------------------------------
// Onboarding
// ------------------------------------------------------------------
document.querySelectorAll("#onboard-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#onboard-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    $("onboard-join").classList.toggle("hidden", mode !== "join");
    $("onboard-create").classList.toggle("hidden", mode !== "create");
  });
});

$("onboard-submit-btn").addEventListener("click", async () => {
  const name = $("onboard-name").value.trim();
  if (!name) { $("onboard-msg").textContent = "Please enter your name."; return; }

  const mode = document.querySelector("#onboard-tabs .tab.active").dataset.mode;
  $("onboard-msg").textContent = "Working...";

  try {
    let householdId;
    if (mode === "join") {
      const code = $("onboard-code").value.trim().toUpperCase();
      if (!code) throw new Error("Enter the household code.");
      const codeSnap = await getDoc(doc(db, "joinCodes", code));
      if (!codeSnap.exists()) throw new Error("No household found with that code.");
      householdId = codeSnap.data().householdId;
    } else {
      const hName = $("onboard-household-name").value.trim() || `${name}'s Family`;
      const code = generateJoinCode();
      const hhRef = doc(collection(db, "households"));
      await setDoc(hhRef, { name: hName, joinCode: code, createdAt: serverTimestamp() });
      await setDoc(doc(db, "joinCodes", code), { householdId: hhRef.id });
      householdId = hhRef.id;
    }

    await setDoc(doc(db, "households", householdId, "members", currentUser.uid), {
      displayName: name,
      joinedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "users", currentUser.uid), {
      displayName: name,
      householdId,
    });

    await handleSignedIn(currentUser);
  } catch (e) {
    $("onboard-msg").textContent = e.message || "Something went wrong.";
  }
});

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderHouseholdHeader() {
  $("household-name-label").textContent = household.name;
  $("household-code-label").textContent = household.joinCode;
  const initial = (currentProfile && currentProfile.displayName ? currentProfile.displayName.trim()[0] : "?").toUpperCase();
  $("header-avatar").textContent = initial;
}

// ------------------------------------------------------------------
// Stores / categories setup
// ------------------------------------------------------------------
async function loadCustomStores() {
  const snap = await getDocs(collection(db, "households", household.id, "stores"));
  customStores = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function populateSelects() {
  const catOptions = CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("new-item-category").innerHTML = catOptions;

  const storeOptions = allStores().map((s) => `<option value="${s.id}">${s.emoji || ""} ${s.name}</option>`).join("");
  $("new-item-store").innerHTML = storeOptions;
  $("receipt-store").innerHTML = storeOptions;
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
    chip.dataset.bg = s.bg || "#F1EFE8";
    chip.dataset.fg = s.fg || "#444441";
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
// Realtime subscriptions
// ------------------------------------------------------------------
function subscribeRealtime() {
  cleanupSubscriptions();

  const itemsQuery = query(collection(db, "households", household.id, "items"), orderBy("createdAt", "desc"));
  unsubItems = onSnapshot(itemsQuery, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderItems();
  });

  const receiptsQuery = query(collection(db, "households", household.id, "receipts"), orderBy("purchasedAt", "desc"));
  unsubReceipts = onSnapshot(receiptsQuery, (snap) => {
    receipts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!$("view-dashboard").classList.contains("hidden")) renderDashboard();
  });
}

// ------------------------------------------------------------------
// List items
// ------------------------------------------------------------------
$("add-item-btn").addEventListener("click", async () => {
  const name = $("new-item-name").value.trim();
  if (!name) return;
  const category = CATEGORIES.find((c) => c.id === $("new-item-category").value);
  const store = allStores().find((s) => s.id === $("new-item-store").value);
  const quantity = $("new-item-qty").value.trim() || null;

  await addDoc(collection(db, "households", household.id, "items"), {
    name,
    categoryId: category ? category.id : null,
    categoryName: category ? category.name : null,
    categoryIcon: category ? category.icon : null,
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeIcon: store ? store.emoji : null,
    quantity,
    status: "pending",
    addedBy: currentUser.uid,
    addedByName: currentProfile.displayName,
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

function renderItems() {
  let filtered = items;
  if (activeStoreFilter !== "all") filtered = filtered.filter((i) => i.storeId === activeStoreFilter);
  if (activeStatusFilter !== "all") filtered = filtered.filter((i) => i.status === activeStatusFilter);

  const list = $("items-list");
  list.innerHTML = filtered.map((item) => {
    const done = item.status === "done";
    const cat = CATEGORIES.find((c) => c.id === item.categoryId);
    const store = allStores().find((s) => s.id === item.storeId);
    const catBg = cat ? cat.bg : "#F1EFE8";
    const catFg = cat ? cat.fg : "#444441";
    const catIcon = cat ? cat.icon : "ti-category";
    return `
      <li class="item-row ${done ? "done" : ""}" data-id="${item.id}">
        <button class="tick-btn ${done ? "checked" : ""}" data-action="toggle" data-id="${item.id}"><i class="ti ti-check" aria-hidden="true"></i></button>
        <div class="category-icon" style="background:${catBg}; color:${catFg};"><i class="ti ${catIcon}" aria-hidden="true"></i></div>
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.name)}${item.quantity ? ` <span class="muted small">(${escapeHtml(item.quantity)})</span>` : ""}</div>
          <div class="item-meta">${item.categoryName || ""}${store ? ` <span class="store-dot" style="background:${store.fg}"></span>${store.name}` : ""}</div>
        </div>
        <button class="delete-btn" data-action="delete" data-id="${item.id}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </li>`;
  }).join("");

  $("items-empty").classList.toggle("hidden", filtered.length > 0);
}

$("items-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const itemRef = doc(db, "households", household.id, "items", id);
  if (btn.dataset.action === "toggle") {
    const item = items.find((i) => i.id === id);
    const newStatus = item.status === "done" ? "pending" : "done";
    await updateDoc(itemRef, {
      status: newStatus,
      doneAt: newStatus === "done" ? serverTimestamp() : null,
    });
  } else if (btn.dataset.action === "delete") {
    await deleteDoc(itemRef);
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ------------------------------------------------------------------
// WhatsApp nudge
// ------------------------------------------------------------------
function buildWhatsAppMessage() {
  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return `🛒 *${household.name}* shopping list is all done! 🎉`;

  const byStore = {};
  pending.forEach((item) => {
    const label = item.storeName ? `${item.storeIcon || ""} ${item.storeName}`.trim() : "Unassigned";
    if (!byStore[label]) byStore[label] = [];
    byStore[label].push(`- ${item.name}${item.quantity ? ` (${item.quantity})` : ""}`);
  });

  let msg = `🛒 *${household.name} — Shopping List*\n`;
  for (const [store, lines] of Object.entries(byStore)) {
    msg += `\n*${store}*\n${lines.join("\n")}\n`;
  }
  msg += `\nSent via Family Shopping List app`;
  return msg;
}

$("whatsapp-nudge-btn").addEventListener("click", () => {
  const phone = $("whatsapp-phone").value.trim().replace(/[^\d+]/g, "");
  const text = encodeURIComponent(buildWhatsAppMessage());
  const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, "_blank");
});

$("whatsapp-phone").addEventListener("change", () => {
  window.localStorage.setItem("whatsappNudgePhone", $("whatsapp-phone").value.trim());
});
const savedPhone = window.localStorage.getItem("whatsappNudgePhone");
if (savedPhone) $("whatsapp-phone").value = savedPhone;

// ------------------------------------------------------------------
// Receipts + OCR
// ------------------------------------------------------------------
$("receipt-date").valueAsDate = new Date();
let pendingReceiptFile = null;

$("receipt-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingReceiptFile = file;

  const statusEl = $("receipt-ocr-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Reading receipt with OCR...";

  try {
    const { data: { text } } = await Tesseract.recognize(file, "eng");
    const total = extractTotalFromText(text);
    statusEl.textContent = total
      ? `Detected total: $${total.toFixed(2)} (double check before saving)`
      : "Couldn't auto-detect a total — please enter it manually.";
    $("receipt-total").value = total ? total.toFixed(2) : "";
  } catch (err) {
    statusEl.textContent = "OCR failed — enter the total manually.";
  }

  $("receipt-confirm").classList.remove("hidden");
});

function extractTotalFromText(text) {
  const lines = text.split("\n");
  const keywordRegex = /(total|amount due|balance due|grand total)/i;
  const numberRegex = /\$?\s?(\d{1,4}\.\d{2})/;

  for (const line of lines) {
    if (keywordRegex.test(line)) {
      const m = line.match(numberRegex);
      if (m) return parseFloat(m[1]);
    }
  }
  const allMatches = [...text.matchAll(/\$?\s?(\d{1,4}\.\d{2})/g)].map((m) => parseFloat(m[1]));
  if (allMatches.length) return Math.max(...allMatches);
  return null;
}

$("receipt-save-btn").addEventListener("click", async () => {
  const store = allStores().find((s) => s.id === $("receipt-store").value);
  const total = parseFloat($("receipt-total").value);
  const purchasedAt = $("receipt-date").value;
  if (!pendingReceiptFile || !total) {
    alert("Please choose a photo and confirm the total amount.");
    return;
  }

  const path = `receipts/${household.id}/${crypto.randomUUID()}-${pendingReceiptFile.name}`;
  try {
    await uploadBytes(ref(storage, path), pendingReceiptFile);
  } catch (e) {
    alert("Upload failed: " + e.message);
    return;
  }

  await addDoc(collection(db, "households", household.id, "receipts"), {
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeIcon: store ? store.emoji : null,
    imagePath: path,
    totalAmount: total,
    uploadedBy: currentUser.uid,
    purchasedAt,
    createdAt: serverTimestamp(),
  });

  pendingReceiptFile = null;
  $("receipt-file").value = "";
  $("receipt-total").value = "";
  $("receipt-confirm").classList.add("hidden");
  $("receipt-ocr-status").classList.add("hidden");
});

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
let chartByStore = null;
let chartOverTime = null;

function renderDashboard() {
  const now = new Date();
  const monthReceipts = receipts.filter((r) => {
    const d = new Date(r.purchasedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const monthTotal = monthReceipts.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
  $("stat-month-total").textContent = `$${monthTotal.toFixed(2)}`;
  $("stat-receipt-count").textContent = receipts.length;

  const byStore = {};
  receipts.forEach((r) => {
    const label = r.storeName || "Other";
    byStore[label] = (byStore[label] || 0) + Number(r.totalAmount || 0);
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

  const months = [];
  const monthTotals = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("default", { month: "short" });
    const total = receipts
      .filter((r) => {
        const rd = new Date(r.purchasedAt);
        return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth();
      })
      .reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
    months.push(label);
    monthTotals.push(total);
  }

  const ctxTime = $("chart-over-time").getContext("2d");
  if (chartOverTime) chartOverTime.destroy();
  chartOverTime = new Chart(ctxTime, {
    type: "line",
    data: {
      labels: months,
      datasets: [{ label: "Monthly spend ($)", data: monthTotals, borderColor: "#1D9E75", backgroundColor: "#E1F5EE", fill: true, tension: 0.3 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  $("receipts-list").innerHTML = receipts.slice(0, 15).map((r) => {
    const match = allStores().find((s) => s.id === r.storeId);
    const bg = match ? match.bg : "#F1EFE8";
    const fg = match ? match.fg : "#444441";
    return `<li class="receipt-row" style="background:${bg}; color:${fg};"><span>${r.storeName || "Other"} — ${r.purchasedAt}</span><strong>$${Number(r.totalAmount).toFixed(2)}</strong></li>`;
  }).join("");
}

// ------------------------------------------------------------------
// Bottom nav
// ------------------------------------------------------------------
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

boot();
