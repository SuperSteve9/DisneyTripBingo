// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/** ===== 1) PASTE YOUR FIREBASE CONFIG HERE ===== */
  const firebaseConfig = {
    apiKey: "AIzaSyAHBcKgYhk6PX2UzgwanFHyMG89IYdgvnQ",
    authDomain: "disneybingo-37c78.firebaseapp.com",
    projectId: "disneybingo-37c78",
    storageBucket: "disneybingo-37c78.firebasestorage.app",
    messagingSenderId: "980665975830",
    appId: "1:980665975830:web:e40c4471a7795c43a1e137",
    measurementId: "G-7XRSH8VJR9"
  };

/** ===== 2) FAUX HOST CREDENTIALS (CHANGE THESE) =====
 * Anyone who knows these can become "host" (client-side only).
 * This is NOT real security; it’s just a gate for your friend group.
 */
const HOST_NAME = "BINGOHOST";
const HOST_KEY = "letmein123";

/** ===== Firebase init ===== */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/** ===== Global shared board doc ===== */
const gameRef = doc(db, "games", "global");

/** ===== DOM ===== */
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const nameInput = document.getElementById("nameInput");
const hostKeyInput = document.getElementById("hostKeyInput");
const resetBtn = document.getElementById("resetBtn");
const newBoardBtn = document.getElementById("newBoardBtn");

/** ===== Local persistence ===== */
const LS_NAME_KEY = "shared_bingo_name_v2";
const LS_COLOR_KEY = "shared_bingo_color_v2";
const LS_HOSTKEY_KEY = "shared_bingo_hostkey_v2";

nameInput.value = localStorage.getItem(LS_NAME_KEY) || "";
nameInput.addEventListener("input", () => {
  localStorage.setItem(LS_NAME_KEY, nameInput.value.trim());
  refreshHostUI();
});

hostKeyInput.value = localStorage.getItem(LS_HOSTKEY_KEY) || "";
hostKeyInput.addEventListener("input", () => {
  localStorage.setItem(LS_HOSTKEY_KEY, hostKeyInput.value);
  refreshHostUI();
});

/** ===== Color per browser ===== */
function randomColor() {
  const hues = [10, 35, 60, 120, 170, 200, 230, 260, 290, 320];
  const h = hues[Math.floor(Math.random() * hues.length)];
  return `hsl(${h} 85% 70%)`;
}
let myColor = localStorage.getItem(LS_COLOR_KEY);
if (!myColor) {
  myColor = randomColor();
  localStorage.setItem(LS_COLOR_KEY, myColor);
}

/** ===== Host check ===== */
function isHost() {
  const nameOk = (nameInput.value || "").trim() === HOST_NAME;
  const keyOk = (hostKeyInput.value || "").trim() === HOST_KEY;
  return nameOk && keyOk;
}

function getMyName() {
  const v = (nameInput.value || "").trim();
  return v || "Anon";
}

function refreshHostUI() {
  const host = isHost();
  resetBtn.disabled = !host;
  newBoardBtn.disabled = !host;

  // Only set status text if we’re connected; otherwise keep connection messages.
  if (statusEl.dataset.connected === "true") {
    statusEl.textContent = host
      ? "Live • HOST MODE (click squares to edit, reset/new board enabled)"
      : "Live • click squares to mark/unmark";
  }
}

/** ===== Board defaults ===== */
function defaultItems() {
  const arr = [];
  for (let i = 1; i <= 25; i++) arr.push(`Square ${i}`);
  arr[12] = "FREE SPACE";
  return arr;
}

function newRandomBoard() {
  // Shuffle everything except center
  const base = defaultItems().filter((_, i) => i !== 12);
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const items = [];
  let k = 0;
  for (let i = 0; i < 25; i++) {
    if (i === 12) items.push("FREE SPACE");
    else items.push(base[k++]);
  }
  return items;
}

/** ===== Ensure Firestore doc exists ===== */
async function ensureDocExists() {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);

    // Only initialize once (when missing)
    if (!snap.exists()) {
      tx.set(gameRef, {
        items: defaultItems(),
        marks: {},
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // Optional: repair if the doc exists but items are missing/bad
    const data = snap.data();
    const itemsOk = Array.isArray(data.items) && data.items.length === 25;
    if (!itemsOk) {
      tx.update(gameRef, {
        items: defaultItems(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** ===== Render ===== */
function render(state) {
  const items = state?.items || defaultItems();
  const marks = state?.marks || {};

  boardEl.innerHTML = "";

  for (let idx = 0; idx < 25; idx++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.idx = String(idx);

    const head = document.createElement("div");
    head.className = "cellIndex";
    head.textContent = `#${idx + 1}`;

    const text = document.createElement("div");
    text.className = "cellText";
    text.textContent = items[idx] ?? "";

    const marksWrap = document.createElement("div");
    marksWrap.className = "marks";

    const cellMarks = marks[String(idx)] || {};
    const entries = Object.values(cellMarks);

    // sort by timestamp
    entries.sort((a, b) => (a?.at || 0) - (b?.at || 0));

    for (const m of entries) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = m?.name || "Anon";
      chip.style.background = m?.color || "#ddd";
      marksWrap.appendChild(chip);
    }

    cell.appendChild(head);
    cell.appendChild(text);
    cell.appendChild(marksWrap);

    cell.addEventListener("click", async () => {
      if (isHost()) {
        await editCellText(idx, items[idx] ?? "");
      } else {
        await toggleMark(idx);
      }
    });

    boardEl.appendChild(cell);
  }
}

/** ===== Toggle mark (normal users) ===== */
async function toggleMark(cellIndex) {
  const user = auth.currentUser;
  if (!user) return;

  const uid = user.uid;
  const name = getMyName();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const marks = data.marks || {};
    const key = String(cellIndex);
    const cellMarks = marks[key] || {};

    if (cellMarks[uid]) {
      delete cellMarks[uid];
    } else {
      cellMarks[uid] = { name, color: myColor, at: Date.now() };
    }

    if (Object.keys(cellMarks).length === 0) delete marks[key];
    else marks[key] = cellMarks;

    tx.update(gameRef, { marks, updatedAt: serverTimestamp() });
  });
}

/** ===== Host: edit cell text ===== */
async function editCellText(cellIndex, currentText) {
  const user = auth.currentUser;
  if (!user) return;
  if (!isHost()) return;

  const next = prompt(`Edit square #${cellIndex + 1} text:`, currentText);
  if (next === null) return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const items = Array.isArray(data.items) ? [...data.items] : defaultItems();
    items[cellIndex] = next.trim();

    tx.update(gameRef, { items, updatedAt: serverTimestamp() });
  });
}

/** ===== Host-only buttons ===== */
resetBtn.addEventListener("click", async () => {
  if (!isHost()) return;
  const user = auth.currentUser;
  if (!user) return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;
    tx.update(gameRef, { marks: {}, updatedAt: serverTimestamp() });
  });
});

newBoardBtn.addEventListener("click", async () => {
  if (!isHost()) return;
  const user = auth.currentUser;
  if (!user) return;

  const items = newRandomBoard();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) {
      tx.set(gameRef, { items, marks: {}, updatedAt: serverTimestamp() });
      return;
    }
    tx.update(gameRef, { items, marks: {}, updatedAt: serverTimestamp() });
  });
});

/** ===== Boot ===== */
statusEl.textContent = "Signing in…";
statusEl.dataset.connected = "false";

refreshHostUI();

signInAnonymously(auth).catch((e) => {
  statusEl.textContent = `Auth error: ${e?.message || e}`;
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  statusEl.textContent = "Connected. Loading…";

  await ensureDocExists();

  onSnapshot(
    gameRef,
    (snap) => {
      const data = snap.data();
      statusEl.dataset.connected = "true";
      render(data);
      refreshHostUI();
    },
    (err) => {
      statusEl.textContent = `Snapshot error: ${err?.message || err}`;
    }
  );
});
