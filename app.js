import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, arrayUnion, collection, getDocs } 
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
let detailedChartInstance = null;
let pieChartInstance = null;
let pendingArchiveId = null;
let editingTagIndex = null;
let currentNoteUnsubscribe = null;
let noteDebounceTimer = null;
let editingItem = null; 
let editingType = null;
let addType = 'habit'; 
let recurMode = 'recur';

// ==========================================
// SEZIONE 1: HELPERS & UTILITIES
// ==========================================

window.getItemValueAtDate = (item, field, dateStr) => {
    // Sicurezza: se item è nullo, ritorna 0 per evitare crash
    if (!item) return 0;
    
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

window.toggleInputs = () => {}; 

let touchStartX = 0; let touchEndX = 0;
document.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX, false);
document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, false);
function handleSwipe() {
    if (touchEndX < touchStartX - 50) { changeDate(1); vibrate('light'); } 
    if (touchEndX > touchStartX + 50) { changeDate(-1); vibrate('light'); } 
}

window.addEventListener('online', () => document.body.classList.remove('offline'));
window.addEventListener('offline', () => document.body.classList.add('offline'));
window.vibrate = (type) => { if (navigator.vibrate && type === 'light') navigator.vibrate(30); if (navigator.vibrate && type === 'heavy') navigator.vibrate([50, 50]); }
window.showToast = (msg, icon) => { const t = document.getElementById('toast'); document.getElementById('toast-text').innerText = msg; document.getElementById('toast-icon').innerText = icon || "ℹ️"; t.className = "show"; setTimeout(() => { t.className = t.className.replace("show", ""); }, 2500); }

// ==========================================
// SEZIONE 2: INIT & FIREBASE
// ==========================================

applyTheme(currentUser);
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
                    scheduleRenderView(); // Usa il render ottimizzato
                }
                updateMultiChart();
            }
        });
    });
}

// ==========================================
// SEZIONE 3: CORE LOGIC (RENDER & STATUS)
// ==========================================

let _renderRaf = null;
function scheduleRenderView() {
    if(_renderRaf) cancelAnimationFrame(_renderRaf);
    _renderRaf = requestAnimationFrame(() => {
        renderView();
        _renderRaf = null;
    });
}

window.changeDate = (days) => { viewDate.setDate(viewDate.getDate() + days); scheduleRenderView(); }
window.goToDate = (dateStr) => { if(dateStr) { viewDate = new Date(dateStr); scheduleRenderView(); } }
function getDateString(date) { return date.toISOString().split('T')[0]; }

function renderView() {
    if(!globalData) return;
    const todayStr = getDateString(new Date());
    const viewStr = getDateString(viewDate);
    
    const displayEl = document.getElementById('dateDisplay');
    let isToday = (viewStr === todayStr);
    if (isToday) displayEl.innerText = "OGGI";
    else if (viewStr === getDateString(new Date(Date.now() - 86400000))) displayEl.innerText = "IERI";
    else displayEl.innerText = `${viewDate.getDate()}/${viewDate.getMonth()+1}`;
    
    document.getElementById('datePicker').value = viewStr;
    setupNoteListener(viewStr);

    const dailyLogs = globalData.dailyLogs || {};
    const entry = dailyLogs[viewStr] || {};
    
    let doneHabits = Array.isArray(entry) ? entry : (entry.habits || []);
    const failedHabits = entry.failedHabits || [];
    const habitLevels = entry.habitLevels || {}; 
    const todaysPurchases = Array.isArray(entry) ? [] : (entry.purchases || []);

    const hList = document.getElementById('habitList');
    const ifList = document.getElementById('ifList');
    
    // Performance: Creiamo stringhe HTML invece di appendere al DOM ogni volta
    let hListHtml = '';
    let ifListHtml = '';
    
    let dailyTotalPot = 0; let dailyEarned = 0; let dailySpent = 0;
    let visibleCount = 0; let ifCount = 0;

    const tagsMap = {};
    (globalData.tags || []).forEach(t => tagsMap[t.id] = t);

    (globalData.habits || []).forEach((h) => {
        try {
            // FIX CRITICO: Supporto per ID vecchi (fallback su name)
            const stableId = h.id || h.name.replace(/[^a-zA-Z0-9]/g, '');
            
            if (h.archivedAt && viewStr >= h.archivedAt) return;
            if (h.type === 'single' && h.targetDate !== viewStr) return;

            const isDone = doneHabits.includes(stableId);
            const isFailed = failedHabits.includes(stableId);
            const freq = h.frequency || 1; 
            
            const currentReward = window.getItemValueAtDate(h, 'reward', viewStr);
            const currentRewardMin = window.getItemValueAtDate(h, 'rewardMin', viewStr);
            const currentPenalty = window.getItemValueAtDate(h, 'penalty', viewStr);
            const isMulti = window.getItemValueAtDate(h, 'isMulti', viewStr);
            const description = window.getItemValueAtDate(h, 'description', viewStr);

            // Gestione IF habits
            let isIfHabit = (h.type === 'if');

            let shouldShow = true;
            
            // Logica ricorrenza (solo se non è IF e non è single)
            if (!isIfHabit && h.type !== 'single' && freq > 1) {
                if (isDone || isFailed) { shouldShow = true; } else {
                    if (h.lastDone) {
                        const diffDays = Math.ceil((new Date(viewStr) - new Date(h.lastDone)) / (86400000));
                        if (diffDays < freq && diffDays >= 0) { shouldShow = false; }
                    }
                }
            }

            if (shouldShow) {
                if (!isIfHabit) {
                    visibleCount++;
                    dailyTotalPot += currentReward; 
                } else {
                    ifCount++;
                }
                
                if(isDone) {
                    let level = habitLevels[stableId] || 'max'; 
                    if (isMulti && level === 'min') dailyEarned += currentRewardMin;
                    else dailyEarned += currentReward;
                }
                if(isFailed) dailySpent += currentPenalty; 

                const tagObj = tagsMap[h.tagId];
                const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
                const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';
                
                let streakHtml = '';
                if (isToday && !isIfHabit) {
                    const s = calculateStreak(stableId);
                    if (s > 1) streakHtml = `<span class="streak-badge">🔥 ${s} <span class="streak-text">streak</span></span>`;
                }

                let btnClass = ''; let btnIcon = 'check'; let btnText = '';
                if (isDone) {
                    let level = habitLevels[stableId] || 'max';
                    if (isMulti && level === 'min') { btnClass = 'min'; btnText = 'MIN'; btnIcon = ''; } 
                    else { btnClass = 'max active'; btnText = isMulti ? 'MAX' : ''; if (isMulti) btnIcon = ''; }
                }

                let descHtml = description ? `<span class="item-desc">${description}</span>` : '';
                let statusClass = isDone ? 'status-done' : (isFailed ? 'status-failed' : '');
                
                const failBtn = isIfHabit 
                    ? '' 
                    : `<button class="btn-status failed ${isFailed?'active':''}" onclick="setHabitStatus('${stableId}', 'failed', ${currentPenalty})"><span class="material-icons-round">close</span></button>`;

                const itemHtml = `
                    <div class="item ${statusClass}" style="${borderStyle}">
                        <div>
                            <div style="display:flex; align-items:center"><h3>${h.name}</h3>${tagHtml}${streakHtml}</div>
                            ${descHtml}
                            <div class="vals">
                                <span class="val-badge plus">+${isMulti ? currentRewardMin + '/' + currentReward : currentReward}</span> ${isIfHabit ? '' : `/ <span class="val-badge minus">-${currentPenalty}</span>`}
                            </div>
                        </div>
                        <div class="actions-group">
                            <button class="btn-icon-minimal" onclick="openEditModal('${h.id}', 'habit')"><span class="material-icons-round" style="font-size:18px">edit</span></button>
                            ${failBtn}
                            <button class="btn-status done ${btnClass}" onclick="setHabitStatus('${stableId}', 'next', 0)">
                                ${btnIcon ? `<span class="material-icons-round">${btnIcon}</span>` : btnText}
                            </button>
                        </div>
                    </div>`;
                
                if(isIfHabit) ifListHtml += itemHtml;
                else hListHtml += itemHtml;
            } 
        } catch(err) {
            console.error("Errore render abitudine:", h, err);
        }
    });
    
    // Scrittura finale nel DOM
    if(visibleCount === 0) hListHtml = '<div style="text-align:center; padding:20px; color:#666">Nessuna attività attiva oggi 🎉</div>';
    hList.innerHTML = hListHtml;

    if(ifCount === 0) ifListHtml = '<div style="text-align:center; padding:10px; color:#666; font-size:0.9em">Nessun bonus oggi</div>';
    ifList.innerHTML = ifListHtml;
    
    // Acquisti
    let purchaseCost = 0;
    const pList = document.getElementById('purchasedList'); 
    let pListHtml = '';

    if(todaysPurchases.length === 0) { pListHtml = '<div style="color:#666; font-size:0.9em; text-align:center; padding:10px;">Nessun acquisto</div>'; } 
    else {
        todaysPurchases.forEach((p, idx) => {
            purchaseCost += parseInt(p.cost);
            pListHtml += `<div class="item"><div><h3>${p.name}</h3><div class="vals minus">Pagato: ${p.cost}</div></div><button class="btn-icon-minimal btn-delete" style="color:var(--danger)" onclick="refundPurchase(${idx}, ${p.cost})"><span class="material-icons-round">undo</span></button></div>`;
        });
    }
    pList.innerHTML = pListHtml;
    
    dailySpent += purchaseCost;
    const net = dailyEarned - dailySpent;
    document.getElementById('sum-earn').innerText = `+${dailyEarned}`;
    document.getElementById('sum-spent').innerText = `-${dailySpent}`;
    
    const netEl = document.getElementById('sum-net');
    netEl.innerText = (net > 0 ? '+' : '') + net;
    netEl.className = 'sum-val'; 
    if (net < 0) netEl.classList.add('net-neg'); else if (net < 10) netEl.classList.add('net-warn'); else netEl.classList.add('net-pos');

    updateProgressCircle(dailyEarned, dailyTotalPot);

    // Renderizza il Negozio (Accordion)
// --- INIZIO DIAGNOSTICA NEGOZIO (Copia da qui) ---
    const sList = document.getElementById('shopList');
    let sListHtml = '';

    // 1. Controllo se l'array esiste
    if (!globalData.rewards) {
        sListHtml = '<div style="padding:15px; background:darkred; color:white; border-radius:8px;">ERRORE CRITICO: Il campo "rewards" non esiste nel database per questo utente.</div>';
    } 
    // 2. Controllo se è vuoto
    else if (globalData.rewards.length === 0) {
        sListHtml = '<div style="padding:15px; background:#333; color:orange; border-radius:8px;">IL DATABASE È CONNESSO MA LA LISTA PREMI È VUOTA [ ]</div>';
    } 
    // 3. Se ci sono dati, li stampo in modo SEMPLIFICATO (senza filtri date/archiviazione)
    else {
        sListHtml += `<div style="padding:5px; font-size:0.7em; color:#666; text-align:center">DEBUG: Trovati ${globalData.rewards.length} elementi grezzi</div>`;
        
        globalData.rewards.forEach((r, idx) => {
            try {
                // Recupero manuale e sicuro dei dati per evitare crash
                let nome = r.name || "SENZA NOME";
                // Cerchiamo il costo: o campo diretto o nell'ultimo change
                let costo = r.cost; 
                if (r.changes && r.changes.length > 0) {
                    costo = r.changes[r.changes.length - 1].cost;
                }
                costo = costo || 0; // Se null diventa 0

                sListHtml += `
                <div class="item" style="border-left: 4px solid #fff;">
                    <div>
                        <h3>${nome}</h3> 
                        <span style="font-size:0.7em; color:#aaa">ID: ${r.id}</span>
                        <div style="font-weight:bold; color:var(--danger)">Costo: ${costo}</div>
                    </div>
                    <div class="actions-group">
                        <button class="btn-main" style="padding:5px 15px; width:auto;" onclick="buyReward('${nome}', ${costo})">Compra</button>
                        <button class="btn-icon-minimal" onclick="openEditModal('${r.id}', 'reward')">✏️</button>
                    </div>
                </div>`;
            } catch (err) {
                sListHtml += `<div style="color:red; padding:5px;">Elemento #${idx} corrotto: ${err.message}</div>`;
            }
        });
    }

    sList.innerHTML = sListHtml;
    // --- FINE DIAGNOSTICA ---    
}

window.setHabitStatus = async (habitId, action, value) => {
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let dailyLogs = globalData.dailyLogs || {};
    let entry = dailyLogs[dateStr] || { habits: [], failedHabits: [], habitLevels: {}, purchases: [] };
    
    if (Array.isArray(entry)) entry = { habits: entry, failedHabits: [], habitLevels: {}, purchases: [] };
    if (!entry.failedHabits) entry.failedHabits = [];
    if (!entry.habits) entry.habits = [];
    if (!entry.habitLevels) entry.habitLevels = {};

    let currentHabits = entry.habits;
    let currentFailed = entry.failedHabits;
    let currentLevels = entry.habitLevels;
    
    let habitsArr = globalData.habits;
    let habitIndex = habitsArr.findIndex(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === habitId);
    const habitObj = habitsArr[habitIndex];
    
    const isMulti = window.getItemValueAtDate(habitObj, 'isMulti', dateStr);
    const rewardMax = window.getItemValueAtDate(habitObj, 'reward', dateStr);
    const rewardMin = window.getItemValueAtDate(habitObj, 'rewardMin', dateStr);
    const penalty = window.getItemValueAtDate(habitObj, 'penalty', dateStr);

    const wasDone = currentHabits.includes(habitId);
    const wasLevel = currentLevels[habitId] || 'max';

    if (wasDone) {
        if (isMulti && wasLevel === 'min') globalData.score -= rewardMin;
        else globalData.score -= rewardMax;
        currentHabits = currentHabits.filter(id => id !== habitId);
        delete currentLevels[habitId];
    }
    if (currentFailed.includes(habitId)) {
        globalData.score += penalty;
        currentFailed = currentFailed.filter(id => id !== habitId);
    }

    let actionType = 'neutral';
    if (action === 'failed') {
        currentFailed.push(habitId);
        globalData.score -= penalty;
        actionType = 'failed';
    } else if (action === 'next') {
        if (!wasDone) {
            currentHabits.push(habitId);
            if (isMulti) { currentLevels[habitId] = 'min'; globalData.score += rewardMin; } 
            else { currentLevels[habitId] = 'max'; globalData.score += rewardMax; actionType = 'done'; }
        } else {
            if (isMulti && wasLevel === 'min') {
                currentHabits.push(habitId); currentLevels[habitId] = 'max'; globalData.score += rewardMax; actionType = 'done';
            }
        }
        if (habitIndex >= 0 && currentHabits.includes(habitId)) habitsArr[habitIndex].lastDone = dateStr; 
    }

    dailyLogs[dateStr] = { habits: currentHabits, failedHabits: currentFailed, habitLevels: currentLevels, purchases: entry.purchases || [] };
    await updateDoc(ref, { score: globalData.score, dailyLogs: dailyLogs, habits: habitsArr });
    logHistory(currentUser, globalData.score);
    vibrate('light');
    if(actionType === 'done') {
        if(dateStr === getDateString(new Date())) confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 }, colors: [currentUser=='flavio'?'#ffca28':'#d05ce3'] });
        showToast("Completata!", "✅");
    } else if (actionType === 'failed') showToast("Segnata come fallita", "❌");
};

window.buyReward = async (name, cost) => {
    if(globalData.score < cost) { 
        if(!confirm(`Attenzione: Saldo insufficiente (${globalData.score}). Andrai in negativo. Continuare?`)) return;
    } else {
        if(!confirm(`Comprare ${name} per ${cost}?`)) return;
    }
    
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let entry = globalData.dailyLogs?.[dateStr] || {};
    let currentPurchases = Array.isArray(entry) ? [] : (entry.purchases || []);
    
    currentPurchases.push({ name, cost, time: Date.now() });
    let newScore = globalData.score - parseInt(cost);
    let newEntry = { habits: entry.habits || [], failedHabits: entry.failedHabits || [], habitLevels: entry.habitLevels || {}, purchases: currentPurchases };
    let dailyLogs = globalData.dailyLogs || {};
    dailyLogs[dateStr] = newEntry;
    
    await updateDoc(ref, { score: newScore, dailyLogs: dailyLogs });
    logHistory(currentUser, newScore);
    vibrate('heavy'); confetti({ shapes: ['circle'], colors: ['#4caf50'] }); showToast("Acquisto effettuato!", "🛍️");
};

window.refundPurchase = async (idx, cost) => {
    if(!confirm("Annullare acquisto e rimborsare punti?")) return;
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let entry = globalData.dailyLogs[dateStr];
    entry.purchases.splice(idx, 1);
    let newScore = globalData.score + parseInt(cost);
    await updateDoc(ref, { score: newScore, dailyLogs: globalData.dailyLogs });
    logHistory(currentUser, newScore);
    vibrate('light'); showToast("Rimborsato!", "↩️");
};

window.updateDetailedChart = (days) => {
    if(!allUsersData || !allUsersData.flavio || !allUsersData.simona) { console.log("Dati non pronti"); return; }
    document.querySelectorAll('.switch-opt').forEach(el => el.classList.remove('active'));
    document.getElementById(`filter${days}`).classList.add('active');
    const ctx = document.getElementById('detailedChart').getContext('2d');
    const labels = []; const dates = [];
    for(let i=days-1; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const str = d.toISOString().split('T')[0];
        dates.push(str); labels.push(`${d.getDate()}/${d.getMonth()+1}`);
    }
    const getPoints = (userData) => {
        if(!userData || !userData.dailyLogs) return new Array(days).fill(0);
        return dates.map(date => {
            const entry = userData.dailyLogs[date] || {};
            let doneArr = Array.isArray(entry) ? entry : (entry.habits || []);
            let failedArr = entry.failedHabits || [];
            let levels = entry.habitLevels || {};
            let purchases = entry.purchases || [];
            let net = 0;
            doneArr.forEach(hId => {
                const h = userData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
                if(h) {
                    const isM = window.getItemValueAtDate(h, 'isMulti', date);
                    const rMin = window.getItemValueAtDate(h, 'rewardMin', date);
                    const rMax = window.getItemValueAtDate(h, 'reward', date);
                    let lvl = levels[hId] || 'max';
                    if (isM && lvl === 'min') net += rMin; else net += rMax;
                }
            });
            failedArr.forEach(hId => {
                const h = userData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
                if(h) net -= window.getItemValueAtDate(h, 'penalty', date);
            });
            let spent = purchases.reduce((acc, p) => acc + parseInt(p.cost), 0);
            return net - spent;
        });
    };
    const flavioPoints = getPoints(allUsersData.flavio);
    const simonaPoints = getPoints(allUsersData.simona);
    if(detailedChartInstance) detailedChartInstance.destroy();
    detailedChartInstance = new Chart(ctx, {
        type: 'line', 
        data: { labels: labels, datasets: [ { label: 'Flavio', data: flavioPoints, borderColor: '#ffca28', backgroundColor: 'rgba(255, 202, 40, 0.1)', borderWidth:2, pointRadius: 5 }, { label: 'Simona', data: simonaPoints, borderColor: '#d05ce3', backgroundColor: 'rgba(208, 92, 227, 0.1)', borderWidth:2, pointRadius: 5 } ] },
        options: { 
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, 
            scales: { y: { grid: { color: '#333' } }, x: { grid: { color: '#333' } } },
            onClick: async (e, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const dateStr = dates[index];
                    const niceDate = labels[index] + "/" + new Date().getFullYear();
                    const fVal = flavioPoints[index];
                    const sVal = simonaPoints[index];
                    document.getElementById('nodeInfo').style.display = 'block';
                    document.getElementById('nodeDate').innerText = niceDate;
                    document.getElementById('nodeValFlavio').innerText = (fVal>0?'+':'')+fVal;
                    document.getElementById('nodeValSimona').innerText = (sVal>0?'+':'')+sVal;
                    document.getElementById('nodeNote').innerText = "Caricamento nota...";
                    try {
                        const snap = await getDoc(doc(db, "shared_notes", dateStr));
                        if (snap.exists()) { document.getElementById('nodeNote').innerText = snap.data().text || "Nessuna nota scritta."; } 
                        else { document.getElementById('nodeNote').innerText = "Nessuna nota scritta."; }
                    } catch(err) { document.getElementById('nodeNote').innerText = "Errore caricamento nota."; }
                }
            }
        }
    });
}
window.openAnalytics = () => { if(!allUsersData || !allUsersData.flavio || !allUsersData.simona) { showToast("Caricamento dati...", "⏳"); return; } document.getElementById('analyticsModal').style.display = 'flex'; updateDetailedChart(30); }

window.openStats = () => {
    if (!globalData || !globalData.dailyLogs) return;
    let totalNet = 0; let daysCount = 0;
    let maxNet = -Infinity; let bestDay = '-';
    let minNet = Infinity; let worstDay = '-';
    let habitCounts = {}; let rewardCounts = {};
    let tagScores = {}; 
    const tagsMap = {}; (globalData.tags || []).forEach(t => tagsMap[t.id] = t);
    let dowStats = {0:{sum:0, count:0}, 1:{sum:0, count:0}, 2:{sum:0, count:0}, 3:{sum:0, count:0}, 4:{sum:0, count:0}, 5:{sum:0, count:0}, 6:{sum:0, count:0}};

    const dates = Object.keys(globalData.dailyLogs).sort();
    dates.forEach(date => {
        daysCount++;
        const entry = globalData.dailyLogs[date];
        let doneArr = [], failedArr = [], purchases = [];
        let levels = entry.habitLevels || {};
        if (Array.isArray(entry)) { doneArr = entry; } 
        else { doneArr = entry.habits || []; failedArr = entry.failedHabits || []; purchases = entry.purchases || []; }

        let dayEarn = 0; let daySpent = 0;
        doneArr.forEach(hId => {
            const h = globalData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
            if(h) {
                habitCounts[h.name] = (habitCounts[h.name] || 0) + 1;
                const isM = window.getItemValueAtDate(h, 'isMulti', date);
                const rMin = window.getItemValueAtDate(h, 'rewardMin', date);
                const rMax = window.getItemValueAtDate(h, 'reward', date);
                let lvl = levels[hId] || 'max';
                let points = (isM && lvl === 'min') ? rMin : rMax;
                dayEarn += points;
                const tId = h.tagId || 'uncategorized';
                tagScores[tId] = (tagScores[tId] || 0) + points;
            }
        });
        failedArr.forEach(hId => {
            const h = globalData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
            if(h) daySpent += window.getItemValueAtDate(h, 'penalty', date);
        });
        purchases.forEach(p => { rewardCounts[p.name] = (rewardCounts[p.name] || 0) + 1; daySpent += parseInt(p.cost); });

        let dayNet = dayEarn - daySpent;
        totalNet += dayNet;
        if (dayNet > maxNet) { maxNet = dayNet; bestDay = date; }
        if (dayNet < minNet) { minNet = dayNet; worstDay = date; }
        const dObj = new Date(date);
        const dayOfWeek = dObj.getDay(); 
        dowStats[dayOfWeek].sum += dayNet;
        dowStats[dayOfWeek].count++;
    });

    if(pieChartInstance) pieChartInstance.destroy();
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    let pieLabels = []; let pieData = []; let pieColors = [];
    Object.keys(tagScores).forEach(tId => {
        if(tId === 'uncategorized') { pieLabels.push('Senza Categoria'); pieColors.push('#666666'); } 
        else { const tObj = tagsMap[tId]; if(tObj) { pieLabels.push(tObj.name); pieColors.push(tObj.color); } }
        pieData.push(tagScores[tId]);
    });

    pieChartInstance = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: pieColors, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    const daysName = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    let bestDow = -1; let maxDowAvg = -Infinity; let worstDow = -1; let minDowAvg = Infinity;
    for(let i=0; i<7; i++) {
        if(dowStats[i].count > 0) {
            let avg = dowStats[i].sum / dowStats[i].count;
            if(avg > maxDowAvg) { maxDowAvg = avg; bestDow = i; }
            if(avg < minDowAvg) { minDowAvg = avg; worstDow = i; }
        }
    }

    const avg = daysCount > 0 ? (totalNet / daysCount).toFixed(1) : 0;
    let bestHabit = Object.keys(habitCounts).reduce((a, b) => habitCounts[a] > habitCounts[b] ? a : b, '-');
    let favReward = Object.keys(rewardCounts).reduce((a, b) => rewardCounts[a] > rewardCounts[b] ? a : b, '-');

    const html = `
        <div class="stat-card"><span class="stat-val">${avg}</span><span class="stat-label">Media Netta</span></div>
        <div class="stat-card"><span class="stat-val">${daysCount}</span><span class="stat-label">Giorni Attivi</span></div>
        <div class="stat-card" style="border-color:var(--success)"><span class="stat-val" style="color:var(--success)">${bestDow>=0 ? daysName[bestDow] : '-'}</span><span class="stat-label">Giorno Top (Med: ${maxDowAvg.toFixed(0)})</span></div>
        <div class="stat-card" style="border-color:var(--danger)"><span class="stat-val" style="color:var(--danger)">${worstDow>=0 ? daysName[worstDow] : '-'}</span><span class="stat-label">Giorno Flop (Med: ${minDowAvg.toFixed(0)})</span></div>
        <div class="stat-card" style="border-color:var(--theme-color); opacity:0.8"><span class="stat-val" style="color:var(--theme-color); font-size:1em">+${maxNet === -Infinity ? 0 : maxNet} (${bestDay.split('-').reverse().join('/')})</span><span class="stat-label">Record Assoluto</span></div>
        <div class="stat-card" style="grid-column: span 2"><span class="stat-val" style="font-size:1.1em">${bestHabit}</span><span class="stat-label">Abitudine Costante</span></div>
        <div class="stat-card" style="grid-column: span 2"><span class="stat-val" style="font-size:1.1em">${favReward}</span><span class="stat-label">Premio Preferito</span></div>
    `;
    document.getElementById('statsContent').innerHTML = html;
    document.getElementById('statsModal').style.display = 'flex';
}

window.toggleMultiInput = (prefix) => {
    const isMulti = document.getElementById(`${prefix}IsMulti`).checked;
    document.getElementById(`${prefix}MinInputGroup`).style.display = isMulti ? 'block' : 'none';
    const rewardLbl = document.getElementById(prefix === 'new' ? 'lblNewReward' : 'lblEditReward');
    rewardLbl.innerText = isMulti ? 'Reward (Max)' : 'Reward';
    const descInput = document.getElementById(`${prefix}Desc`);
    if(descInput) descInput.style.display = 'block'; 
}

window.setAddType = (t) => {
    addType = t;
    document.querySelectorAll('.switch-opt').forEach(el => el.classList.remove('active'));
    document.getElementById(t==='habit'?'typeHabit':'typeReward').classList.add('active');
    if(recurMode === 'recur') document.getElementById('modeRecur').classList.add('active'); 
    else if(recurMode === 'single') document.getElementById('modeSingle').classList.add('active');
    else document.getElementById('modeIf').classList.add('active'); 

    document.getElementById('habitInputs').style.display = t==='habit'?'block':'none'; 
    document.getElementById('rewardInputs').style.display = t==='reward'?'block':'none';
    const sel = document.getElementById('newTag'); sel.innerHTML = '<option value="">Nessun Tag</option>';
    (globalData.tags || []).forEach(t => { sel.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
}

window.setRecurMode = (m) => {
    recurMode = m;
    // Reset classi
    document.getElementById('modeRecur').classList.remove('active'); 
    document.getElementById('modeSingle').classList.remove('active');
    document.getElementById('modeIf').classList.remove('active');
    
    // Attiva classe corretta
    if(m==='recur') document.getElementById('modeRecur').classList.add('active');
    else if(m==='single') document.getElementById('modeSingle').classList.add('active');
    else document.getElementById('modeIf').classList.add('active'); // IF

    // Gestione visibilità input
    const recurInput = document.getElementById('recurInput');
    const dateInput = document.getElementById('dateInput');
    const penaltyInput = document.getElementById('groupNewPenalty');

    if(m === 'recur') {
        recurInput.style.display = 'block';
        dateInput.style.display = 'none';
        penaltyInput.style.visibility = 'visible';
    } else if (m === 'single') {
        recurInput.style.display = 'none';
        dateInput.style.display = 'block';
        penaltyInput.style.visibility = 'visible';
        document.getElementById('newTargetDate').value = new Date().toISOString().split('T')[0];
    } else { // IF MODE
        recurInput.style.display = 'none';
        dateInput.style.display = 'none';
        penaltyInput.style.visibility = 'hidden'; // Nascondi penalità
    }
}

window.openEditModal = (id, type) => {
    editingType = type;
    const list = type === 'habit' ? globalData.habits : globalData.rewards;
    editingItem = list.find(i => i.id === id);
    if(!editingItem) return;
    document.getElementById('editName').value = editingItem.name; document.getElementById('editNote').value = ''; document.getElementById('editDate').value = new Date().toISOString().split('T')[0];
    const tagSel = document.getElementById('editTag'); tagSel.innerHTML = '<option value="">Nessun Tag</option>';
    (globalData.tags || []).forEach(t => { const opt = document.createElement('option'); opt.value = t.id; opt.innerText = t.name; tagSel.appendChild(opt); });
    tagSel.value = editingItem.tagId || "";
    if (type === 'habit') {
        document.getElementById('editHabitFields').style.display = 'block'; document.getElementById('editRewardFields').style.display = 'none';
        const isMulti = editingItem.isMulti || false; document.getElementById('editIsMulti').checked = isMulti; toggleMultiInput('edit'); 
        document.getElementById('editVal1').value = editingItem.reward; document.getElementById('editVal2').value = editingItem.penalty; document.getElementById('editRewardMin').value = editingItem.rewardMin || 0; document.getElementById('editDesc').value = editingItem.description || "";
    } else {
        document.getElementById('editHabitFields').style.display = 'none'; document.getElementById('editRewardFields').style.display = 'block'; document.getElementById('editCost').value = editingItem.cost; document.getElementById('editDesc').value = "";
    }
    renderEditHistory(editingItem, type);
    document.getElementById('editModal').style.display = 'flex';
}

function renderEditHistory(item, type) {
    const container = document.getElementById('editHistoryLog'); container.innerHTML = '';
    let changes = item.changes ? item.changes.slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
    if (changes.length === 0) { container.innerHTML = '<div class="history-item"><div class="history-date">In origine</div>Creata con valore corrente.</div>'; return; }
    let html = '';
    changes.forEach((change, index) => {
        let dateFmt = change.date.split('-').reverse().join('/'); let noteHtml = change.note ? `<div class="history-note">${change.note}</div>` : ''; let text = '';
        if (index === 0) {
            if (type === 'habit') { let val = `Max: ${change.reward}`; if (change.isMulti) val += ` | Min: ${change.rewardMin}`; val += ` | Pen: ${change.penalty}`; text = `Valori iniziali: <b>${val}</b>`; } 
            else { text = `Costo iniziale: <b>${change.cost}</b>`; }
        } else {
            let prev = changes[index - 1]; let diffs = [];
            if (type === 'habit') {
                if ((prev.reward||0) !== (change.reward||0)) diffs.push(`Max: ${prev.reward||0}→<b>${change.reward||0}</b>`);
                if ((prev.rewardMin||0) !== (change.rewardMin||0)) diffs.push(`Min: ${prev.rewardMin||0}→<b>${change.rewardMin||0}</b>`);
                if ((prev.penalty||0) !== (change.penalty||0)) diffs.push(`Pen: ${prev.penalty||0}→<b>${change.penalty||0}</b>`);
                if (!!prev.isMulti !== !!change.isMulti) diffs.push(`Multi: ${prev.isMulti?'Sì':'No'}→<b>${change.isMulti?'Sì':'No'}</b>`);
            } else { if ((prev.cost||0) !== (change.cost||0)) diffs.push(`Costo: ${prev.cost||0}→<b>${change.cost||0}</b>`); }
            if (diffs.length > 0) text = diffs.join(' | '); else text = "Modifica dettagli (Nome/Tag/Desc)";
        }
        html += `<div class="history-item"><div class="history-date">${dateFmt}</div><div>${text}</div>${noteHtml}</div>`;
    });
    container.innerHTML = html;
}

window.saveEdit = async () => {
    if(!editingItem) return;
    const newName = document.getElementById('editName').value; const editDate = document.getElementById('editDate').value; const editNote = document.getElementById('editNote').value; const newTag = document.getElementById('editTag').value; const newDesc = document.getElementById('editDesc').value;
    if(!editDate) { alert("Data obbligatoria"); return; }
    editingItem.name = newName; editingItem.tagId = newTag;
    let newChangeEntry = { date: editDate }; if (editNote.trim() !== "") newChangeEntry.note = editNote;
    if (editingType === 'habit') { 
        const val1 = parseInt(document.getElementById('editVal1').value) || 0; const val2 = parseInt(document.getElementById('editVal2').value) || 0; const rewardMin = parseInt(document.getElementById('editRewardMin').value) || 0; const isMulti = document.getElementById('editIsMulti').checked;
        newChangeEntry.reward = val1; newChangeEntry.penalty = val2; newChangeEntry.isMulti = isMulti; newChangeEntry.rewardMin = rewardMin; newChangeEntry.description = newDesc;
        editingItem.reward = val1; editingItem.penalty = val2; editingItem.isMulti = isMulti; editingItem.rewardMin = rewardMin; editingItem.description = newDesc;
    } else { const cost = parseInt(document.getElementById('editCost').value) || 0; newChangeEntry.cost = cost; editingItem.cost = cost; }
    if (!editingItem.changes) {
        let initialEntry = { date: '2020-01-01', note: 'Creazione Iniziale' }; 
        if (editingType === 'habit') { initialEntry.reward = editingItem.reward; initialEntry.penalty = editingItem.penalty; initialEntry.isMulti = editingItem.isMulti || false; initialEntry.rewardMin = editingItem.rewardMin || 0; initialEntry.description = editingItem.description || ""; } 
        else { initialEntry.cost = editingItem.cost; }
        editingItem.changes = [initialEntry];
    }
    editingItem.changes = editingItem.changes.filter(c => c.date !== editDate); editingItem.changes.push(newChangeEntry); editingItem.changes.sort((a, b) => a.date.localeCompare(b.date));
    const ref = doc(db, "users", currentUser);
    if(editingType === 'habit') await updateDoc(ref, { habits: globalData.habits }); else await updateDoc(ref, { rewards: globalData.rewards });
    document.getElementById('editModal').style.display = 'none'; editingItem = null; scheduleRenderView(); showToast("Salvato!", "✏️");
}

window.addItem = async () => {
    let name = document.getElementById('newName').value; const tag = document.getElementById('newTag').value; if(!name) { vibrate('heavy'); return; }
    const id = Date.now().toString(); const ref = doc(db, "users", currentUser);
    try {
        if(addType === 'habit') {
            const r = parseInt(document.getElementById('newReward').value) || 0; 
            const p = parseInt(document.getElementById('newPenalty').value) || 0; 
            const freq = document.getElementById('newFrequency').value || 1; 
            const targetDate = document.getElementById('newTargetDate').value; 
            const isMulti = document.getElementById('newIsMulti').checked; 
            const rewardMin = parseInt(document.getElementById('newRewardMin').value) || 0; 
            const desc = document.getElementById('newDesc').value || "";
            
            // V14: Gestione IF
            let finalPenalty = p;
            let finalFreq = freq;
            if(recurMode === 'if') {
                finalPenalty = 0; // Penalità zero forzata
                finalFreq = 1;    // Frequenza giornaliera (virtuale)
            }

            let newHabit = { 
                id, name, 
                reward:r, 
                penalty: finalPenalty, 
                tagId: tag, type: recurMode, 
                isMulti: isMulti, rewardMin: rewardMin, description: desc 
            };

            if (recurMode === 'recur') newHabit.frequency = parseInt(finalFreq); 
            else if (recurMode === 'single') newHabit.targetDate = targetDate;
            
            await updateDoc(ref, { habits: arrayUnion(newHabit) });
        } else { const c = document.getElementById('newCost').value || 0; await updateDoc(ref, { rewards: arrayUnion({id, name, cost:c, tagId: tag}) }); }
        document.getElementById('addModal').style.display='none'; document.getElementById('newName').value=''; vibrate('light'); showToast("Salvato!", "💾");
    } catch(e) { console.error(e); }
};

function setupNoteListener(dateStr) {
    if (currentNoteUnsubscribe) { currentNoteUnsubscribe(); currentNoteUnsubscribe = null; }
    const textArea = document.getElementById('dailyNoteArea'); textArea.value = ""; document.getElementById('noteStatus').innerText = "Caricamento...";
    const noteRef = doc(db, "shared_notes", dateStr);
    currentNoteUnsubscribe = onSnapshot(noteRef, (docSnap) => {
        if (docSnap.exists()) { if (document.activeElement !== textArea) textArea.value = docSnap.data().text || ""; document.getElementById('noteStatus').innerText = "Sincronizzato"; } 
        else { if (document.activeElement !== textArea) textArea.value = ""; document.getElementById('noteStatus').innerText = "Nessuna nota"; }
    });
}
window.handleNoteInput = (val) => {
    document.getElementById('noteStatus').innerText = "Salvataggio..."; clearTimeout(noteDebounceTimer);
    noteDebounceTimer = setTimeout(async () => { const dateStr = getDateString(viewDate); const noteRef = doc(db, "shared_notes", dateStr); await setDoc(noteRef, { text: val }, { merge: true }); document.getElementById('noteStatus').innerText = "Salvato"; }, 1000);
}
function calculateStreak(habitId) {
    let streak = 0; let d = new Date(); let str = getDateString(d); let entry = globalData.dailyLogs?.[str]; let doneArr = [];
    if (Array.isArray(entry)) doneArr = entry; else doneArr = entry?.habits || [];
    if (doneArr.includes(habitId)) streak++;
    while (true) {
        d.setDate(d.getDate() - 1); str = getDateString(d); entry = globalData.dailyLogs?.[str]; doneArr = [];
        if (Array.isArray(entry)) doneArr = entry; else doneArr = entry?.habits || [];
        if (doneArr.includes(habitId)) streak++; else break;
    }
    return streak;
}

window.openTagManager = () => { editingTagIndex = null; document.getElementById('newTagName').value = ''; document.getElementById('btnSaveTag').innerText = "Crea Tag"; renderTagsList(); document.getElementById('tagModal').style.display = 'flex'; }
function renderTagsList() { const list = document.getElementById('tagsList'); list.innerHTML = ''; (globalData.tags || []).forEach((t, idx) => { list.innerHTML += `<div class="tag-row"><div><span class="color-dot" style="background:${t.color}"></span>${t.name}</div><div><button class="btn-icon-minimal" onclick="editTag(${idx})"><span class="material-icons-round">edit</span></button><button class="btn-icon-minimal btn-delete" onclick="deleteTag(${idx})"><span class="material-icons-round">delete</span></button></div></div>`; }); }
window.editTag = (idx) => { const t = globalData.tags[idx]; document.getElementById('newTagName').value = t.name; document.getElementById('newTagColor').value = t.color; editingTagIndex = idx; document.getElementById('btnSaveTag').innerText = "Aggiorna Tag"; }
window.saveTagManager = async () => { const name = document.getElementById('newTagName').value; const color = document.getElementById('newTagColor').value; if(!name) return; let tags = globalData.tags || []; if (editingTagIndex !== null) { tags[editingTagIndex].name = name; tags[editingTagIndex].color = color; } else { tags.push({ id: Date.now().toString(), name, color }); } const ref = doc(db, "users", currentUser); await updateDoc(ref, { tags: tags }); document.getElementById('newTagName').value = ''; editingTagIndex = null; document.getElementById('btnSaveTag').innerText = "Crea Tag"; renderTagsList(); showToast("Tag salvato", "🏷️"); }
window.deleteTag = async (idx) => { if(!confirm("Eliminare tag?")) return; const tags = globalData.tags; tags.splice(idx, 1); await updateDoc(doc(db, "users", currentUser), { tags }); renderTagsList(); }
window.archiveFromEdit = () => { if(!editingItem) return; archiveItem(editingType === 'habit' ? 'habits' : 'rewards', editingItem.id); document.getElementById('editModal').style.display = 'none'; }
window.archiveItem = (list, id) => { pendingArchiveId = { list, id }; document.getElementById('archiveDate').value = new Date().toISOString().split('T')[0]; document.getElementById('archiveModal').style.display = 'flex'; }
window.confirmArchive = async () => { if(!pendingArchiveId) return; const date = document.getElementById('archiveDate').value; const { list, id } = pendingArchiveId; const ref = doc(db, "users", currentUser); const arr = globalData[list]; const idx = arr.findIndex(i => i.id === id); if (idx > -1) { arr[idx].archivedAt = date; await updateDoc(ref, { [list]: arr }); showToast("Archiviato", "📦"); } document.getElementById('archiveModal').style.display = 'none'; }
window.exportData = async () => { vibrate('light'); showToast("Backup...", "⏳"); try { const usersCol = collection(db, 'users'); const userSnapshot = await getDocs(usersCol); let backupData = {}; userSnapshot.forEach(doc => { backupData[doc.id] = doc.data(); }); const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData)); const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr); const date = new Date().toISOString().slice(0,10); downloadAnchorNode.setAttribute("download", `GLP_Backup_${date}.json`); document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove(); showToast("Fatto!", "✅"); } catch (e) { console.error(e); showToast("Errore", "❌"); } };
window.importData = (files) => { if (files.length === 0) return; const file = files[0]; const reader = new FileReader(); reader.onload = async (e) => { try { const backupData = JSON.parse(e.target.result); if (!confirm("Sovrascrivere?")) { document.getElementById('importFile').value = ''; return; } showToast("Ripristino...", "⏳"); for (const userId in backupData) { if (backupData.hasOwnProperty(userId)) await setDoc(doc(db, "users", userId), backupData[userId]); } showToast("Fatto!", "✅"); setTimeout(() => location.reload(), 1500); } catch (err) { console.error(err); showToast("File non valido", "❌"); } document.getElementById('importFile').value = ''; }; reader.readAsText(file); };
window.hardReset = async () => { const code = prompt("Scrivi RESET:"); if(code === "RESET") { await deleteDoc(doc(db, "users", currentUser)); location.reload(); } };
function applyTheme(user) { const root = document.documentElement; if (user === 'flavio') { root.style.setProperty('--theme-color', '#ffca28'); root.style.setProperty('--theme-glow', 'rgba(255, 202, 40, 0.3)'); document.getElementById('avatar-initial').innerText = 'F'; document.getElementById('username-display').innerText = 'Flavio'; } else { root.style.setProperty('--theme-color', '#d05ce3'); root.style.setProperty('--theme-glow', 'rgba(208, 92, 227, 0.3)'); document.getElementById('avatar-initial').innerText = 'S'; document.getElementById('username-display').innerText = 'Simona'; } document.getElementById('card-flavio').classList.remove('active'); document.getElementById('card-simona').classList.remove('active'); document.getElementById(`card-${user}`).classList.add('active'); }
window.switchUser = (u) => { if(currentUser === u) return; currentUser = u; localStorage.setItem('glp_user', u); applyTheme(u); vibrate('light'); location.reload(); }
async function logHistory(user, score) { const ref = doc(db, "users", user); const hist = globalData.history || []; hist.push({date: new Date().toISOString(), score}); if(hist.length > 500) hist.shift(); await updateDoc(ref, { history: hist }); }
function updateMultiChart() { 
    const ctx = document.getElementById('progressChart').getContext('2d'); const labels = []; const dates = []; 
    for(let i=14; i>=0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); labels.push(`${d.getDate()}/${d.getMonth()+1}`); } 
    const getDailyNetPoints = (userData) => { 
        if(!userData || !userData.dailyLogs) return new Array(15).fill(0); 
        return dates.map(date => { 
            const entry = userData.dailyLogs[date]; if(!entry) return 0; let doneArr = [], failedArr = [], purchases = []; 
            if (Array.isArray(entry)) { doneArr = entry; } else { doneArr = entry.habits || []; failedArr = entry.failedHabits || []; purchases = entry.purchases || []; } 
            let net = 0; doneArr.forEach(hId => { const h = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) { const isM = window.getItemValueAtDate(h, 'isMulti', date); const rMin = window.getItemValueAtDate(h, 'rewardMin', date); const rMax = window.getItemValueAtDate(h, 'reward', date); let lvl = (entry.habitLevels || {})[hId] || 'max'; if(isM && lvl === 'min') net += rMin; else net += rMax; } }); failedArr.forEach(hId => { const h = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) net -= window.getItemValueAtDate(h, 'penalty', date); }); let spent = purchases.reduce((acc, p) => acc + parseInt(p.cost), 0); return net - spent; 
        }); 
    }; 
    const flavioPoints = getDailyNetPoints(allUsersData.flavio); const simonaPoints = getDailyNetPoints(allUsersData.simona); 
    if(chartInstance) chartInstance.destroy(); chartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [ { label: 'Flavio', data: flavioPoints, borderColor: '#ffca28', backgroundColor: 'rgba(255, 202, 40, 0.1)', fill:true, tension: 0.4, pointRadius: 4 }, { label: 'Simona', data: simonaPoints, borderColor: '#d05ce3', backgroundColor: 'rgba(208, 92, 227, 0.1)', fill:true, tension: 0.4, pointRadius: 4 } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#888' } } }, scales: { y: { grid: { color: '#333' }, ticks: { color: '#888' }, beginAtZero: true }, x: { grid: { display: false }, ticks: { color: '#888', maxTicksLimit: 8 } } } } }); 
}