import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, updateDoc, getDoc, onSnapshot } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- VARIABILI GLOBALI ---
let currentUser = localStorage.getItem('glp_user') || 'flavio';
let globalData = null;
let allUsersData = { flavio: null, simona: null };
let viewDate = new Date(); 
let chartInstance = null;

// ==========================================
// SEZIONE 1: HELPERS & UTILITIES
// ==========================================

window.getItemValueAtDate = (item, field, dateStr) => {
    if (!item.changes || item.changes.length === 0) {
        if(field === 'isMulti') return item.isMulti || false;
        if(field === 'description') return item.description || "";
        return parseInt(item[field] || 0);
    }
    const sortedChanges = item.changes.slice().sort((a, b) => a.date.localeCompare(b.date));
    let validChange = null;
    for (let change of sortedChanges) {
        if (change.date <= dateStr) validChange = change; else break;
    }
    if (validChange) {
        if(field === 'isMulti') return validChange.isMulti || false;
        if(field === 'description') return validChange.description || "";
        return parseInt(validChange[field] || 0);
    }
    if(sortedChanges.length > 0) {
         if(field === 'isMulti') return sortedChanges[0].isMulti || false;
         if(field === 'description') return sortedChanges[0].description || "";
         return parseInt(sortedChanges[0][field] || 0);
    }
    return 0;
};

function countRewardPurchases(rewardName) {
    if (!globalData || !globalData.dailyLogs) return 0;
    let count = 0;
    Object.values(globalData.dailyLogs).forEach(log => {
        let purchases = Array.isArray(log) ? [] : (log.purchases || []);
        purchases.forEach(p => { if (p.name === rewardName) count++; });
    });
    return count;
}

window.vibrate = (type) => { 
    if (navigator.vibrate && type === 'light') navigator.vibrate(30); 
    if (navigator.vibrate && type === 'heavy') navigator.vibrate([50, 50]); 
};
window.showToast = (msg, icon) => { 
    const t = document.getElementById('toast'); 
    document.getElementById('toast-text').innerText = msg; 
    document.getElementById('toast-icon').innerText = icon || "ℹ️"; 
    t.classList.add("show"); 
    setTimeout(() => { t.classList.remove("show"); }, 2500); 
};
window.switchUser = (u) => {
    localStorage.setItem('glp_user', u);
    location.reload();
};

// ==========================================
// SEZIONE 2: INIT & FIREBASE
// ==========================================

initApp();

async function initApp() {
    await checkAndCreateUser('flavio');
    await checkAndCreateUser('simona');
    startListeners();
}

async function checkAndCreateUser(user) {
    const ref = doc(db, "users", user);
    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            await setDoc(ref, { score: 0, habits: [], rewards: [], history: [], dailyLogs: {}, tags: [], lastLogin: new Date().toDateString() });
        }
    } catch (e) { console.error("Err init:", e); }
}

function startListeners() {
    ['flavio', 'simona'].forEach(u => {
        onSnapshot(doc(db, "users", u), (d) => {
            if(d.exists()) {
                const userData = d.data();
                allUsersData[u] = userData;
                document.getElementById(`score-${u}`).innerText = userData.score;
                if(u === currentUser) { 
                    globalData = userData; 
                    renderView(); 
                }
                updateChart(); // Aggiorna grafico se necessario
            }
        });
    });
}

// ==========================================
// SEZIONE 3: CORE LOGIC (RENDER & STATUS)
// ==========================================

window.changeDate = (days) => { viewDate.setDate(viewDate.getDate() + days); renderView(); }
function getDateString(date) { return date.toISOString().split('T')[0]; }

function renderView() {
    if(!globalData) return;
    const todayStr = getDateString(new Date());
    const viewStr = getDateString(viewDate);
    
    // UI Data
    const displayEl = document.getElementById('dateDisplay');
    if (viewStr === todayStr) displayEl.innerText = "OGGI";
    else if (viewStr === getDateString(new Date(Date.now() - 86400000))) displayEl.innerText = "IERI";
    else displayEl.innerText = `${viewDate.getDate()}/${viewDate.getMonth()+1}`;
    
    // Recupera Log
    const dailyLogs = globalData.dailyLogs || {};
    let entry = dailyLogs[viewStr];
    // Normalizzazione dati vecchi (array vs oggetto)
    if (!entry) entry = { habits: [], failedHabits: [], habitLevels: {}, purchases: [] };
    if (Array.isArray(entry)) entry = { habits: entry, failedHabits: [], habitLevels: {}, purchases: [] };

    let doneHabits = entry.habits || [];
    const failedHabits = entry.failedHabits || [];
    const habitLevels = entry.habitLevels || {}; 
    
    let hListHtml = '';
    let ifListHtml = '';
    let dailyTotalPot = 0; let dailyEarned = 0;
    
    const tagsMap = {};
    (globalData.tags || []).forEach(t => tagsMap[t.id] = t);

    // 1. RENDER ABITUDINI
    (globalData.habits || []).forEach((h) => {
        const stableId = h.id || h.name.replace(/[^a-zA-Z0-9]/g, '');
        
        // Filtri (Archiviate, Single, etc)
        if (h.archivedAt && viewStr >= h.archivedAt) return;
        if (h.type === 'single' && h.targetDate !== viewStr) return;

        const isDone = doneHabits.includes(stableId);
        const isFailed = failedHabits.includes(stableId);
        
        const currentReward = window.getItemValueAtDate(h, 'reward', viewStr);
        const currentRewardMin = window.getItemValueAtDate(h, 'rewardMin', viewStr);
        const currentPenalty = window.getItemValueAtDate(h, 'penalty', viewStr);
        const isMulti = window.getItemValueAtDate(h, 'isMulti', viewStr);
        const description = window.getItemValueAtDate(h, 'description', viewStr);
        let isIfHabit = (h.type === 'if');

        // Calcolo Punti
        if (!isIfHabit) dailyTotalPot += currentReward;
        if(isDone) {
            let level = habitLevels[stableId] || 'max';
            if (isMulti && level === 'min') dailyEarned += currentRewardMin; else dailyEarned += currentReward;
        }

        // Calcolo UI Bottoni
        let btnClass = ''; let btnIcon = 'check'; let btnText = '';
        if (isDone) {
            let level = habitLevels[stableId] || 'max';
            if (isMulti && level === 'min') {
                btnClass = 'min'; btnText = 'MIN'; btnIcon = ''; // FIX STILE MIN
            } else {
                btnClass = 'max active'; btnText = isMulti ? 'MAX' : '';
                if (isMulti) btnIcon = '';
            }
        }
        
        let statusClass = isDone ? 'status-done' : (isFailed ? 'status-failed' : '');
        const tagObj = tagsMap[h.tagId];
        const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
        const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';

        const itemHtml = `
        <div class="item ${statusClass}" style="${borderStyle}">
            <div>
                <div style="display:flex; align-items:center; gap:5px;">
                    <span class="item-title">${h.name}</span>
                    ${tagHtml}
                </div>
                ${description ? `<span class="item-desc">${description}</span>` : ''}
                <div class="item-info">
                   <span style="color:var(--success)">+${currentReward}</span>
                   ${isMulti ? `<span style="color:#29b6f6">/+${currentRewardMin}</span>` : ''}
                </div>
            </div>
            <div class="actions">
                 ${!isIfHabit ? `<button class="btn-status failed ${isFailed?'active':''}" onclick="setHabitStatus('${stableId}', 'failed', ${currentPenalty})"><span class="material-icons-round">close</span></button>` : ''}
                 <button class="btn-status done ${isDone?btnClass:''}" onclick="setHabitStatus('${stableId}', 'next', 0)">
                    ${btnIcon ? `<span class="material-icons-round">${btnIcon}</span>` : `<span style="font-weight:bold; font-size:0.8em">${btnText}</span>`}
                 </button>
            </div>
        </div>`;

        if (isIfHabit) ifListHtml += itemHtml; else hListHtml += itemHtml;
    });

    document.getElementById('habitList').innerHTML = hListHtml || '<div style="text-align:center; padding:20px; color:#666;">Nessuna abitudine per oggi</div>';
    document.getElementById('ifList').innerHTML = ifListHtml;
    
    // Aggiornamento Progress Ring
    const percent = dailyTotalPot > 0 ? Math.min(100, Math.round((dailyEarned / dailyTotalPot) * 100)) : 0;
    const offset = 263 - (263 * percent) / 100;
    document.getElementById('prog-circle').style.strokeDashoffset = offset;
    document.getElementById('prog-text').innerText = percent + "%";

    // --- FIX NEGOZIO: Renderizza sempre i premi ---
    const shopContainer = document.getElementById('shopList');
    if (shopContainer && globalData.rewards) {
        let shopHtml = '';
        globalData.rewards.forEach(r => {
            const cost = window.getItemValueAtDate(r, 'cost', viewStr);
            const count = countRewardPurchases(r.name);
            shopHtml += `
            <div class="shop-item">
                <div>
                    <div style="font-weight:bold;">${r.name}</div>
                    <div style="font-size:0.8em; color:#888;">Costo: ${cost} | Presi: ${count}</div>
                </div>
                <button class="btn-buy" onclick="buyReward('${r.id}', ${cost}, '${r.name}')">
                    Compralo (-${cost})
                </button>
            </div>`;
        });
        shopContainer.innerHTML = shopHtml || '<div style="padding:10px; text-align:center;">Nessun premio</div>';
        
        // Se il pannello è già aperto, ricalcola l'altezza
        const panel = document.getElementById('shopPanel');
        if (panel && panel.style.maxHeight && panel.style.maxHeight !== '0px') {
            panel.style.maxHeight = panel.scrollHeight + "px";
        }
    }
}

// --- FIX PERFORMANCE: Optimistic UI Update ---
window.setHabitStatus = function(habitId, type, val) {
    if (!globalData) return;
    const dateStr = getDateString(viewDate);
    
    // 1. Prepara struttura dati se non esiste
    let logs = globalData.dailyLogs || {};
    let entry = logs[dateStr];
    if (!entry || Array.isArray(entry)) {
        entry = { habits: Array.isArray(entry)?entry:[], failedHabits: [], habitLevels: {}, purchases: [] };
        logs[dateStr] = entry;
        globalData.dailyLogs = logs;
    }

    // 2. Logica Toggle (Multi Level)
    if (type === 'failed') {
        const failIdx = entry.failedHabits.indexOf(habitId);
        if (failIdx === -1) entry.failedHabits.push(habitId);
        else entry.failedHabits.splice(failIdx, 1);
    } else {
        // Logica Check/Next
        const hIndex = entry.habits.indexOf(habitId);
        const hObj = (globalData.habits||[]).find(h => (h.id||h.name.replace(/[^a-zA-Z0-9]/g, '')) === habitId);
        const isMulti = window.getItemValueAtDate(hObj, 'isMulti', dateStr);
        
        if (hIndex === -1) {
            // Step 1: Da Vuoto a MAX
            entry.habits.push(habitId);
            entry.habitLevels[habitId] = 'max';
            vibrate('light');
        } else {
            const currentLevel = entry.habitLevels[habitId] || 'max';
            if (isMulti && currentLevel === 'max') {
                 // Step 2: Da MAX a MIN (Solo se multi)
                 entry.habitLevels[habitId] = 'min';
                 vibrate('light');
            } else {
                 // Step 3: Rimuovi
                 entry.habits.splice(hIndex, 1);
                 delete entry.habitLevels[habitId];
                 vibrate('heavy');
            }
        }
    }

    // 3. RENDER IMMEDIATO (Non aspettiamo Firebase)
    renderView();

    // 4. Sync Background
    const userRef = doc(db, "users", currentUser);
    updateDoc(userRef, { [`dailyLogs.${dateStr}`]: entry }).catch(e => {
        console.error("Sync Error", e);
        showToast("Errore salvataggio!", "❌");
    });
};

window.buyReward = function(id, cost, name) {
    const dateStr = getDateString(viewDate);
    let logs = globalData.dailyLogs || {};
    let entry = logs[dateStr];
    if (!entry || Array.isArray(entry)) {
        entry = { habits: Array.isArray(entry)?entry:[], failedHabits: [], habitLevels: {}, purchases: [] };
        logs[dateStr] = entry;
    }
    
    // Aggiungi acquisto
    if(!entry.purchases) entry.purchases = [];
    entry.purchases.push({ id, cost, name, date: new Date().toISOString() });
    
    // Optimistic Render
    renderView();
    showToast(`Comprato ${name}!`, "🛒");
    
    // Sync
    updateDoc(doc(db, "users", currentUser), { [`dailyLogs.${dateStr}`]: entry });
};

// --- FIX NEGOZIO: Funzione Toggle ---
window.toggleShop = function() {
    const panel = document.getElementById('shopPanel');
    const btn = document.querySelector('.accordion');
    
    if (btn) btn.classList.toggle("active-accordion");
    
    if (panel.style.maxHeight && panel.style.maxHeight !== "0px") {
        panel.style.maxHeight = null;
    } else {
        panel.style.maxHeight = panel.scrollHeight + "px";
    }
};

function updateChart() {
    // Placeholder semplice per evitare errori se chart.js manca
    // (Qui potresti rimettere la logica del tuo grafico se ti serve)
}