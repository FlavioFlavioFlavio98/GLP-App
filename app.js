import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const APP_VERSION = "14.6";

const firebaseConfig = {
  apiKey: "AIzaSyA001klzJou17djB76Q-t2eRTKbU9NZoQs",
  authDomain: "gamification-life-project.firebaseapp.com",
  projectId: "gamification-life-project",
  storageBucket: "gamification-life-project.firebasestorage.app",
  messagingSenderId: "925252547674",
  appId: "1:925252547674:web:1316a5d96cb54c0a515463"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUser = localStorage.getItem('glp_user') || 'flavio';
let globalData = null;
let allUsersData = { flavio: null, simona: null };
let viewDate = new Date();

let addType = 'habit';
let recurMode = 'recur';

let multiChart = null;

// ---------- UI HELPERS ----------
window.vibrate = (type) => {
  if (!navigator.vibrate) return;
  if (type === 'light') navigator.vibrate(30);
  if (type === 'heavy') navigator.vibrate([50, 50]);
};

window.showToast = (msg, icon) => {
  const t = document.getElementById('toast');
  document.getElementById('toast-text').innerText = msg;
  document.getElementById('toast-icon').innerText = icon || "ℹ️";
  t.className = "show";
  setTimeout(() => { t.className = t.className.replace("show", ""); }, 2500);
};

function getDateString(date) {
  return date.toISOString().split('T')[0];
}

function setOfflineBadge() {
  if (navigator.onLine) document.body.classList.remove('offline');
  else document.body.classList.add('offline');
}
window.addEventListener('online', setOfflineBadge);
window.addEventListener('offline', setOfflineBadge);
setOfflineBadge();

function applyTheme(userId) {
  const root = document.documentElement;
  if (userId === 'simona') {
    root.style.setProperty('--theme-color', '#d05ce3');
    root.style.setProperty('--theme-glow', 'rgba(208, 92, 227, 0.28)');
    document.getElementById('avatar-initial').innerText = 'S';
    document.getElementById('username-display').innerText = 'Simona';
  } else {
    root.style.setProperty('--theme-color', '#ffca28');
    root.style.setProperty('--theme-glow', 'rgba(255, 202, 40, 0.3)');
    document.getElementById('avatar-initial').innerText = 'F';
    document.getElementById('username-display').innerText = 'Flavio';
  }
  document.getElementById('card-flavio').classList.toggle('active', userId === 'flavio');
  document.getElementById('card-simona').classList.toggle('active', userId === 'simona');
}

window.closeModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
};

// Force update: unregister SW + clear caches + reload
window.forceReload = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn(e);
  }
  location.reload(true);
};

// ---------- INIT ----------
applyTheme(currentUser);
initApp();

async function initApp() {
  await checkAndCreateUser('flavio');
  await checkAndCreateUser('simona');
  startListeners();
}

async function checkAndCreateUser(user) {
  const ref = doc(db, "users", user);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      score: 0,
      habits: [],
      rewards: [],
      dailyLogs: {},
      tags: [],
      history: [],
      lastLogin: new Date().toDateString()
    });
  }
}

function startListeners() {
  ['flavio', 'simona'].forEach(u => {
    onSnapshot(doc(db, "users", u), (d) => {
      if (!d.exists()) return;
      const userData = d.data();
      allUsersData[u] = userData;
      document.getElementById(`score-${u}`).innerText = userData.score ?? 0;
      if (u === currentUser) {
        globalData = userData;
        renderView();
      }
      updateMultiChart();
    }, (err) => {
      console.error("Firestore listener error:", err);
      showToast("Errore Firestore", "⚠️");
    });
  });
}

// ---------- DATE NAV ----------
window.changeDate = (days) => {
  viewDate.setDate(viewDate.getDate() + days);
  renderView();
};
window.goToDate = (dateStr) => {
  if (!dateStr) return;
  viewDate = new Date(dateStr);
  renderView();
};

// ---------- NOTES (simple, stored in dailyLogs[date].note) ----------
let noteDebounceTimer = null;
window.handleNoteInput = (val) => {
  if (!globalData) return;
  const dateStr = getDateString(viewDate);
  document.getElementById('noteStatus').innerText = "Salvataggio...";
  clearTimeout(noteDebounceTimer);
  noteDebounceTimer = setTimeout(() => saveNote(dateStr, val), 500);
};

async function saveNote(dateStr, note) {
  await mutateCurrentUserDoc((data) => {
    const dailyLogs = data.dailyLogs || {};
    const entry = normalizeEntry(dailyLogs[dateStr]);
    entry.note = note || "";
    dailyLogs[dateStr] = entry;
    data.dailyLogs = dailyLogs;
  });
  document.getElementById('noteStatus').innerText = "";
}

function normalizeEntry(raw) {
  if (Array.isArray(raw)) {
    return { habits: raw.slice(), failedHabits: [], purchases: [], habitLevels: {}, note: "" };
  }
  if (!raw) return { habits: [], failedHabits: [], purchases: [], habitLevels: {}, note: "" };
  return {
    habits: Array.isArray(raw.habits) ? raw.habits.slice() : [],
    failedHabits: Array.isArray(raw.failedHabits) ? raw.failedHabits.slice() : [],
    purchases: Array.isArray(raw.purchases) ? raw.purchases.slice() : [],
    habitLevels: raw.habitLevels ? { ...raw.habitLevels } : {},
    note: raw.note || ""
  };
}

function getStableId(item) {
  return item.id || (item.name || "").replace(/[^a-zA-Z0-9]/g, '');
}

function getHabitReward(h, dateStr, level) {
  const max = parseInt(h.reward || 0);
  const min = parseInt(h.rewardMin || 0);
  if (h.isMulti && level === 'min') return min;
  return max;
}

function safeNum(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- RENDER ----------
function renderView() {
  if (!globalData) return;

  const todayStr = getDateString(new Date());
  const viewStr = getDateString(viewDate);
  const displayEl = document.getElementById('dateDisplay');

  const isToday = (viewStr === todayStr);
  if (isToday) displayEl.innerText = "OGGI";
  else {
    const yesterdayStr = getDateString(new Date(Date.now() - 86400000));
    if (viewStr === yesterdayStr) displayEl.innerText = "IERI";
    else displayEl.innerText = `${viewDate.getDate()}/${viewDate.getMonth() + 1}`;
  }

  document.getElementById('datePicker').value = viewStr;

  const dailyLogs = globalData.dailyLogs || {};
  const entry = normalizeEntry(dailyLogs[viewStr]);

  document.getElementById('dailyNoteArea').value = entry.note || "";
  document.getElementById('noteStatus').innerText = "";

  const doneHabits = entry.habits || [];
  const failedHabits = entry.failedHabits || [];
  const habitLevels = entry.habitLevels || {};
  const todaysPurchases = entry.purchases || [];

  const habits = Array.isArray(globalData.habits) ? globalData.habits : [];
  const rewards = Array.isArray(globalData.rewards) ? globalData.rewards : [];

  // Build HTML strings (fast)
  let hHtml = '';
  let ifHtml = '';

  let dailyEarned = 0;
  let dailySpent = 0;
  let visibleCount = 0;

  for (const h of habits) {
    const id = getStableId(h);
    const type = h.type || 'recur';
    if (h.archivedAt && viewStr >= h.archivedAt) continue;
    if (type === 'single' && h.targetDate && h.targetDate !== viewStr) continue;

    const isIf = (type === 'if');
    const isDone = doneHabits.includes(id);
    const isFailed = failedHabits.includes(id);
    const level = habitLevels[id] || 'max';
    const isMulti = !!h.isMulti;
    const rewardMax = safeNum(h.reward);
    const rewardMin = safeNum(h.rewardMin);
    const penalty = safeNum(h.penalty);

    if (isDone) {
      dailyEarned += getHabitReward(h, viewStr, isMulti ? level : 'max');
    }
    if (isFailed) {
      dailySpent += penalty;
    }

    const desc = h.description ? `<div class="item-sub">${h.description}</div>` : '';
    const pill = isMulti ? `<span class="item-sub">Max:+${rewardMax} | Min:+${rewardMin} | Fail:-${penalty}</span>` : `<span class="item-sub">+${rewardMax} | Fail:-${penalty}</span>`;

    const btnMaxClass = isDone && (!isMulti || level === 'max') ? 'active' : '';
    const btnMinClass = isDone && isMulti && level === 'min' ? 'min active' : (isMulti ? 'min' : '');
    const btnFailClass = isFailed ? 'active' : '';

    const buttons = `
      <button class="btn-status done ${btnMaxClass}" onclick="toggleHabit('${id}','max')">MAX</button>
      ${isMulti ? `<button class="btn-status done ${btnMinClass}" onclick="toggleHabit('${id}','min')">MIN</button>` : ''}
      <button class="btn-status failed ${btnFailClass}" onclick="toggleHabit('${id}','fail')">FAIL</button>
    `;

    const row = `
      <div class="item">
        <div class="item-left">
          <div class="item-title">${h.name || 'Abitudine'}</div>
          ${desc}
          <div class="item-sub">${pill}</div>
        </div>
        <div class="item-right">
          ${buttons}
        </div>
      </div>
    `;

    if (isIf) ifHtml += row;
    else {
      hHtml += row;
      visibleCount++;
    }
  }

  document.getElementById('habitList').innerHTML = hHtml || `<div class="empty">Nessuna abitudine.</div>`;
  document.getElementById('ifList').innerHTML = ifHtml || `<div class="empty">Nessuna abitudine If.</div>`;

  // Purchases
  if (!todaysPurchases.length) {
    document.getElementById('purchasedList').innerHTML = `<div class="empty">Nessun acquisto oggi</div>`;
  } else {
    document.getElementById('purchasedList').innerHTML = todaysPurchases.map((p, i) => {
      dailySpent += safeNum(p.cost);
      const dt = p.ts ? new Date(p.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      return `
        <div class="item">
          <div class="item-left">
            <div class="item-title">${p.name || 'Acquisto'}</div>
            <div class="item-sub">${dt}</div>
          </div>
          <div class="item-right">
            <span class="shop-price">-${safeNum(p.cost)}</span>
            <button class="btn-status" onclick="refundPurchase('${viewStr}',${i})">UNDO</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Shop (render ALWAYS, so accordion won't be empty)
  const shopHtml = rewards.map(r => {
    const id = getStableId(r);
    const cost = safeNum(r.cost);
    const count = countRewardPurchases(id);
    return `
      <div class="item">
        <div class="item-left">
          <div class="item-title">${r.name || 'Premio'}</div>
          <div class="item-sub"><span class="shop-price">-${cost}</span> <span class="shop-count">Acquisti: ${count}</span></div>
        </div>
        <div class="item-right">
          <button class="btn-status done active" onclick="buyReward('${id}')">BUY</button>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('shopList').innerHTML = shopHtml || `<div class="empty">Nessun premio.</div>`;

  // Summary + progress circle
  document.getElementById('sum-earn').innerText = dailyEarned;
  document.getElementById('sum-spent').innerText = dailySpent;
  const net = dailyEarned - dailySpent;
  const netEl = document.getElementById('sum-net');
  netEl.innerText = net;
  netEl.className = 'sum-val ' + (net > 0 ? 'net-pos' : (net < 0 ? 'net-neg' : 'net-warn'));

  const pot = Math.max(dailyEarned + dailySpent, 0);
  const pct = pot === 0 ? 0 : Math.round((dailyEarned / pot) * 100);
  updateProgressCircle(pct);
}

function updateProgressCircle(pct) {
  const circle = document.getElementById('prog-circle');
  const text = document.getElementById('prog-text');
  const total = 263;
  const offset = total - (pct / 100) * total;
  circle.style.strokeDashoffset = String(offset);
  text.innerText = `${pct}%`;
}

function countRewardPurchases(rewardId) {
  if (!globalData || !globalData.dailyLogs) return 0;
  let count = 0;
  Object.entries(globalData.dailyLogs).forEach(([date, raw]) => {
    const entry = normalizeEntry(raw);
    entry.purchases.forEach(p => {
      const id = p.rewardId || (p.name || "").replace(/[^a-zA-Z0-9]/g,'');
      if (id === rewardId) count++;
    });
  });
  return count;
}

// ---------- CHART ----------
function updateMultiChart() {
  const ctx = document.getElementById('multiChart');
  if (!ctx) return;

  const points = buildLastNDays(14);
  const labels = points.map(p => p.label);
  const dataF = points.map(p => p.flavio);
  const dataS = points.map(p => p.simona);

  if (multiChart) {
    multiChart.data.labels = labels;
    multiChart.data.datasets[0].data = dataF;
    multiChart.data.datasets[1].data = dataS;
    multiChart.update('none');
    return;
  }

  multiChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Flavio', data: dataF, tension: 0.35 },
        { label: 'Simona', data: dataS, tension: 0.35 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7 } },
        y: { beginAtZero: false }
      }
    }
  });
}

function buildLastNDays(n) {
  const out = [];
  const start = new Date();
  start.setDate(start.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = getDateString(d);
    out.push({
      key,
      label: `${d.getDate()}/${d.getMonth()+1}`,
      flavio: allUsersData.flavio?.score ?? 0,
      simona: allUsersData.simona?.score ?? 0
    });
  }
  return out;
}

// ---------- MUTATIONS (TRANSACTION) ----------
async function mutateCurrentUserDoc(mutator) {
  const ref = doc(db, "users", currentUser);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    // Make a shallow clone to mutate safely
    const next = {
      ...data,
      habits: Array.isArray(data.habits) ? data.habits.slice() : [],
      rewards: Array.isArray(data.rewards) ? data.rewards.slice() : [],
      dailyLogs: data.dailyLogs ? { ...data.dailyLogs } : {},
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      history: Array.isArray(data.history) ? data.history.slice() : [],
      score: safeNum(data.score)
    };
    mutator(next);
    tx.set(ref, next, { merge: true });
  });
}

// ---------- ACTIONS ----------
const inFlight = new Set();

window.toggleHabit = async (habitId, mode) => {
  if (!globalData) return;
  const dateStr = getDateString(viewDate);
  const key = `${currentUser}:${dateStr}:${habitId}:${mode}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  try {
    // Optimistic UI: update local data first
    applyLocalToggleHabit(habitId, mode, dateStr);
    renderView();

    await mutateCurrentUserDoc((data) => {
      const dailyLogs = data.dailyLogs || {};
      const entry = normalizeEntry(dailyLogs[dateStr]);

      const habits = Array.isArray(data.habits) ? data.habits : [];
      const h = habits.find(x => getStableId(x) === habitId);
      if (!h) return;

      const isMulti = !!h.isMulti;
      const rewardMax = safeNum(h.reward);
      const rewardMin = safeNum(h.rewardMin);
      const penalty = safeNum(h.penalty);

      const done = new Set(entry.habits);
      const failed = new Set(entry.failedHabits);
      const levels = entry.habitLevels || {};

      const wasDone = done.has(habitId);
      const wasFailed = failed.has(habitId);
      const prevLevel = levels[habitId] || 'max';

      let delta = 0;

      if (mode === 'max') {
        if (wasDone && (!isMulti || prevLevel === 'max')) {
          // uncheck
          done.delete(habitId);
          delete levels[habitId];
          delta -= rewardMax;
        } else {
          // set done max
          if (wasDone) {
            // was min -> switch to max
            delta += (rewardMax - rewardMin);
          } else {
            delta += rewardMax;
          }
          done.add(habitId);
          if (isMulti) levels[habitId] = 'max';
          // if it was failed, remove fail and refund penalty
          if (wasFailed) {
            failed.delete(habitId);
            delta += penalty;
          }
        }
      }

      if (mode === 'min') {
        if (!isMulti) return;
        if (wasDone && prevLevel === 'min') {
          // uncheck min
          done.delete(habitId);
          delete levels[habitId];
          delta -= rewardMin;
        } else {
          // set done min
          if (wasDone) {
            // was max -> switch to min
            delta -= (rewardMax - rewardMin);
          } else {
            delta += rewardMin;
          }
          done.add(habitId);
          levels[habitId] = 'min';
          if (wasFailed) {
            failed.delete(habitId);
            delta += penalty;
          }
        }
      }

      if (mode === 'fail') {
        if (wasFailed) {
          failed.delete(habitId);
          delta += penalty;
        } else {
          failed.add(habitId);
          delta -= penalty;
          // if done, remove done and remove reward
          if (wasDone) {
            const reward = (isMulti && prevLevel === 'min') ? rewardMin : rewardMax;
            done.delete(habitId);
            delete levels[habitId];
            delta -= reward;
          }
        }
      }

      entry.habits = Array.from(done);
      entry.failedHabits = Array.from(failed);
      entry.habitLevels = levels;

      dailyLogs[dateStr] = entry;
      data.dailyLogs = dailyLogs;

      data.score = safeNum(data.score) + delta;
    });

    vibrate('light');
  } catch (e) {
    console.error(e);
    showToast("Errore salvataggio", "⚠️");
  } finally {
    inFlight.delete(key);
  }
};

function applyLocalToggleHabit(habitId, mode, dateStr) {
  if (!globalData) return;
  const dailyLogs = globalData.dailyLogs || {};
  const entry = normalizeEntry(dailyLogs[dateStr]);
  const done = new Set(entry.habits);
  const failed = new Set(entry.failedHabits);
  const levels = entry.habitLevels || {};

  // Just update UI state; score will update after snapshot
  if (mode === 'max') {
    if (done.has(habitId) && (levels[habitId] || 'max') === 'max') {
      done.delete(habitId);
      delete levels[habitId];
    } else {
      done.add(habitId);
      levels[habitId] = 'max';
      failed.delete(habitId);
    }
  }
  if (mode === 'min') {
    if (done.has(habitId) && (levels[habitId] || 'max') === 'min') {
      done.delete(habitId);
      delete levels[habitId];
    } else {
      done.add(habitId);
      levels[habitId] = 'min';
      failed.delete(habitId);
    }
  }
  if (mode === 'fail') {
    if (failed.has(habitId)) failed.delete(habitId);
    else {
      failed.add(habitId);
      done.delete(habitId);
      delete levels[habitId];
    }
  }

  entry.habits = Array.from(done);
  entry.failedHabits = Array.from(failed);
  entry.habitLevels = levels;
  dailyLogs[dateStr] = entry;
  globalData.dailyLogs = dailyLogs;
}

window.buyReward = async (rewardId) => {
  const dateStr = getDateString(viewDate);
  const key = `${currentUser}:${dateStr}:buy:${rewardId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  try {
    await mutateCurrentUserDoc((data) => {
      const rewards = Array.isArray(data.rewards) ? data.rewards : [];
      const r = rewards.find(x => getStableId(x) === rewardId);
      if (!r) return;

      const cost = safeNum(r.cost);
      const dailyLogs = data.dailyLogs || {};
      const entry = normalizeEntry(dailyLogs[dateStr]);

      entry.purchases.push({
        rewardId,
        name: r.name || 'Premio',
        cost,
        ts: Date.now()
      });
      dailyLogs[dateStr] = entry;
      data.dailyLogs = dailyLogs;
      data.score = safeNum(data.score) - cost;
    });
    showToast("Acquisto registrato", "🛍️");
    if (window.confetti) {
      window.confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    }
    vibrate('heavy');
  } catch (e) {
    console.error(e);
    showToast("Errore acquisto", "⚠️");
  } finally {
    inFlight.delete(key);
  }
};

window.refundPurchase = async (dateStr, idx) => {
  const key = `${currentUser}:${dateStr}:refund:${idx}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  try {
    await mutateCurrentUserDoc((data) => {
      const dailyLogs = data.dailyLogs || {};
      const entry = normalizeEntry(dailyLogs[dateStr]);
      if (!entry.purchases[idx]) return;

      const p = entry.purchases[idx];
      entry.purchases.splice(idx, 1);

      dailyLogs[dateStr] = entry;
      data.dailyLogs = dailyLogs;

      data.score = safeNum(data.score) + safeNum(p.cost);
    });
    showToast("Rimborsato", "↩️");
  } catch (e) {
    console.error(e);
    showToast("Errore rimborso", "⚠️");
  } finally {
    inFlight.delete(key);
  }
};

// ---------- ADD MODAL ----------
window.setAddType = (t) => {
  addType = t;
  document.getElementById('typeHabit').classList.toggle('active', t === 'habit');
  document.getElementById('typeReward').classList.toggle('active', t === 'reward');
  document.getElementById('habitInputs').style.display = (t === 'habit') ? 'block' : 'none';
  document.getElementById('rewardInputs').style.display = (t === 'reward') ? 'block' : 'none';
};

window.setRecurMode = (m) => {
  recurMode = m;
  document.getElementById('modeRecur').classList.toggle('active', m === 'recur');
  document.getElementById('modeSingle').classList.toggle('active', m === 'single');
  document.getElementById('modeIf').classList.toggle('active', m === 'if');
  document.getElementById('dateInput').style.display = (m === 'single') ? 'block' : 'none';
};

window.toggleMultiInput = (prefix) => {
  const cb = document.getElementById(`${prefix}IsMulti`);
  const group = document.getElementById(`${prefix}RewardMin`) ? document.getElementById(`${prefix}MinInputGroup`) : document.getElementById('newMinInputGroup');
  const on = cb && cb.checked;
  if (group) group.style.display = on ? 'block' : 'none';
};

window.addItem = async () => {
  const name = (document.getElementById('newName').value || '').trim();
  const desc = (document.getElementById('newDesc').value || '').trim();
  if (!name) {
    showToast("Inserisci un nome", "✏️");
    return;
  }

  try {
    if (addType === 'habit') {
      const reward = safeNum(document.getElementById('newReward').value);
      const penalty = safeNum(document.getElementById('newPenalty').value);
      const isMulti = document.getElementById('newIsMulti').checked;
      const rewardMin = isMulti ? safeNum(document.getElementById('newRewardMin').value) : 0;

      const type = (recurMode === 'if') ? 'if' : (recurMode === 'single' ? 'single' : 'recur');
      const targetDate = (type === 'single') ? (document.getElementById('newTargetDate').value || getDateString(new Date())) : null;

      const item = {
        id: `h_${Date.now()}`,
        name,
        description: desc,
        reward,
        rewardMin,
        penalty,
        isMulti,
        type,
        targetDate
      };

      await mutateCurrentUserDoc((data) => {
        data.habits = Array.isArray(data.habits) ? data.habits : [];
        data.habits.push(item);
      });
      showToast("Abitudine salvata", "✅");
    } else {
      const cost = safeNum(document.getElementById('newCost').value);
      const item = {
        id: `r_${Date.now()}`,
        name,
        description: desc,
        cost
      };
      await mutateCurrentUserDoc((data) => {
        data.rewards = Array.isArray(data.rewards) ? data.rewards : [];
        data.rewards.push(item);
      });
      showToast("Premio salvato", "🛍️");
    }

    // reset + close
    document.getElementById('newName').value = '';
    document.getElementById('newDesc').value = '';
    document.getElementById('newReward').value = '';
    document.getElementById('newPenalty').value = '';
    document.getElementById('newRewardMin').value = '';
    document.getElementById('newCost').value = '';
    document.getElementById('newIsMulti').checked = false;
    toggleMultiInput('new');
    closeModal('addModal');
  } catch (e) {
    console.error(e);
    showToast("Errore salvataggio", "⚠️");
  }
};

// ---------- USER SWITCH ----------
window.switchUser = (u) => {
  if (u !== 'flavio' && u !== 'simona') return;
  currentUser = u;
  localStorage.setItem('glp_user', u);
  applyTheme(u);
  globalData = allUsersData[u];
  renderView();
};

// Initial setAddType UI
setAddType('habit');
setRecurMode('recur');
