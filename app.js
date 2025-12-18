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

let currentUser = localStorage.getItem('glp_user') || 'flavio';
let globalData = null;
let allUsersData = { flavio: null, simona: null };
let viewDate = new Date(); 
let chartInstance = null;
let detailedChartInstance = null;
let pendingArchiveId = null;
let editingTagIndex = null;
let currentNoteUnsubscribe = null;
let noteDebounceTimer = null;

// --- HELPERS ---
window.getItemValueAtDate = (item, field, dateStr) => {
    // Helper to extract value (reward, penalty, isMulti, etc) at a specific date
    if (!item.changes || item.changes.length === 0) {
        // Fallback for non-numeric fields if they exist on root
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
    // Fallback if no valid change found (use first one or default)
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

// SWIPE
let touchStartX = 0; let touchEndX = 0;
document.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX, false);
document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, false);
function handleSwipe() {
    if (touchEndX < touchStartX - 50) { changeDate(1); vibrate('light'); } 
    if (touchEndX > touchStartX + 50) { changeDate(-1); vibrate('light'); } 
}

window.addEventListener('online', () => document.body.classList.remove('offline'));
window.addEventListener('offline', () => document.body.classList.add('offline'));

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
            await setDoc(ref, {
                score: 0, habits: [], rewards: [], history: [], dailyLogs: {}, tags: [], lastLogin: new Date().toDateString()
            });
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
                if(u === currentUser) { globalData = userData; renderView(); }
                updateMultiChart();
            }
        });
    });
}

window.changeDate = (days) => { viewDate.setDate(viewDate.getDate() + days); renderView(); }
window.goToDate = (dateStr) => { if(dateStr) { viewDate = new Date(dateStr); renderView(); } }
function getDateString(date) { return date.toISOString().split('T')[0]; }

// UI HELPER FOR MODALS
window.toggleMultiInput = (prefix) => {
    const isMulti = document.getElementById(`${prefix}IsMulti`).checked;
    document.getElementById(`${prefix}MinInputGroup`).style.display = isMulti ? 'block' : 'none';
    const rewardLbl = document.getElementById(prefix === 'new' ? 'lblNewReward' : 'lblEditReward');
    rewardLbl.innerText = isMulti ? 'Reward (Max)' : 'Reward';
    
    // Show/Hide description input
    const descInput = document.getElementById(`${prefix}Desc`);
    if(descInput) descInput.style.display = 'block'; // Always show desc now as requested
}

// RENDER
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
    
    // Safety check for entry structure
    let doneHabits = [];
    if (Array.isArray(entry)) doneHabits = entry;
    else doneHabits = entry.habits || [];

    const failedHabits = entry.failedHabits || [];
    const habitLevels = entry.habitLevels || {}; // New V12: Track Min/Max levels
    const todaysPurchases = Array.isArray(entry) ? [] : (entry.purchases || []);

    const hList = document.getElementById('habitList'); hList.innerHTML = '';
    const upcomingList = document.getElementById('upcomingList'); upcomingList.innerHTML = '';
    
    let dailyTotalPot = 0; let dailyEarned = 0; let dailySpent = 0;
    let visibleCount = 0; let upcomingCount = 0;

    const tagsMap = {};
    (globalData.tags || []).forEach(t => tagsMap[t.id] = t);

    (globalData.habits || []).forEach((h) => {
        const stableId = h.id || h.name.replace(/[^a-zA-Z0-9]/g, '');
        
        if (h.archivedAt && viewStr >= h.archivedAt) return;
        if (h.type === 'single' && h.targetDate !== viewStr) return;

        const isDone = doneHabits.includes(stableId);
        const isFailed = failedHabits.includes(stableId);
        const freq = h.frequency || 1; 
        
        // V12: Fetch historical values
        const currentReward = window.getItemValueAtDate(h, 'reward', viewStr); // This is Max
        const currentRewardMin = window.getItemValueAtDate(h, 'rewardMin', viewStr);
        const currentPenalty = window.getItemValueAtDate(h, 'penalty', viewStr);
        const isMulti = window.getItemValueAtDate(h, 'isMulti', viewStr);
        const description = window.getItemValueAtDate(h, 'description', viewStr);

        let shouldShow = true;
        let daysLeft = 0;
        if (h.type !== 'single' && freq > 1) {
            if (isDone || isFailed) { shouldShow = true; } else {
                if (h.lastDone) {
                    const diffDays = Math.ceil((new Date(viewStr) - new Date(h.lastDone)) / (86400000));
                    if (diffDays < freq && diffDays >= 0) { shouldShow = false; daysLeft = freq - diffDays; }
                }
            }
        }

        if (shouldShow) {
            visibleCount++;
            dailyTotalPot += currentReward; // Potential is always max
            
            if(isDone) {
                // Check level: if multi and level is min, use min reward
                let level = habitLevels[stableId] || 'max'; // Default to max for old data
                if (isMulti && level === 'min') dailyEarned += currentRewardMin;
                else dailyEarned += currentReward;
            }
            if(isFailed) dailySpent += currentPenalty; 

            const tagObj = tagsMap[h.tagId];
            const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
            const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';
            
            let streakHtml = '';
            if (isToday) {
                const s = calculateStreak(stableId);
                if (s > 1) streakHtml = `<span class="streak-badge">🔥 ${s} <span class="streak-text">streak</span></span>`;
            }

            // V12 Button Logic
            let btnClass = '';
            let btnIcon = 'check';
            let btnText = '';
            
            if (isDone) {
                let level = habitLevels[stableId] || 'max';
                if (isMulti && level === 'min') {
                    btnClass = 'min'; // CSS class .btn-status.min
                    btnText = 'MIN';
                    btnIcon = ''; // Hide icon, show text
                } else {
                    btnClass = 'max active'; // CSS class .btn-status.max
                    btnText = isMulti ? 'MAX' : ''; // Only show MAX text if multi, else icon
                    if (isMulti) btnIcon = ''; 
                }
            }

            let descHtml = description ? `<span class="item-desc">${description}</span>` : '';
            let statusClass = isDone ? 'status-done' : (isFailed ? 'status-failed' : '');
            
            hList.innerHTML += `
                <div class="item ${statusClass}" style="${borderStyle}">
                    <div>
                        <div style="display:flex; align-items:center"><h3>${h.name}</h3>${tagHtml}${streakHtml}</div>
                        ${descHtml}
                        <div class="vals">
                            <span class="val-badge plus">+${isMulti ? currentRewardMin + '/' + currentReward : currentReward}</span> / 
                            <span class="val-badge minus">-${currentPenalty}</span>
                        </div>
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon-minimal" onclick="openEditModal('${h.id}', 'habit')"><span class="material-icons-round" style="font-size:18px">edit</span></button>
                        <button class="btn-status failed ${isFailed?'active':''}" onclick="setHabitStatus('${stableId}', 'failed', ${currentPenalty})"><span class="material-icons-round">close</span></button>
                        <button class="btn-status done ${btnClass}" onclick="setHabitStatus('${stableId}', 'next', 0)">
                             ${btnIcon ? `<span class="material-icons-round">${btnIcon}</span>` : btnText}
                        </button>
                    </div>
                </div>`;
        } else {
            upcomingCount++;
            upcomingList.innerHTML += `<div class="item" style="opacity:0.6; border-left:4px solid #555"><div><h3>${h.name}</h3><div class="vals">Tra ${daysLeft} gg</div></div></div>`;
        }
    });
    
    if(visibleCount === 0) hList.innerHTML = '<div style="text-align:center; padding:20px; color:#666">Nessuna attività attiva oggi 🎉</div>';
    
    let purchaseCost = 0;
    const pList = document.getElementById('purchasedList'); pList.innerHTML = '';
    if(todaysPurchases.length === 0) { pList.innerHTML = '<div style="color:#666; font-size:0.9em; text-align:center; padding:10px;">Nessun acquisto</div>'; } 
    else {
        todaysPurchases.forEach((p, idx) => {
            purchaseCost += parseInt(p.cost);
            pList.innerHTML += `<div class="item"><div><h3>${p.name}</h3><div class="vals minus">Pagato: ${p.cost}</div></div><button class="btn-icon-minimal btn-delete" style="color:var(--danger)" onclick="refundPurchase(${idx}, ${p.cost})"><span class="material-icons-round">undo</span></button></div>`;
        });
    }
    
    dailySpent += purchaseCost;
    
    const net = dailyEarned - dailySpent;
    document.getElementById('sum-earn').innerText = `+${dailyEarned}`;
    document.getElementById('sum-spent').innerText = `-${dailySpent}`;
    
    const netEl = document.getElementById('sum-net');
    netEl.innerText = (net > 0 ? '+' : '') + net;
    netEl.className = 'sum-val'; 
    if (net < 0) netEl.classList.add('net-neg');
    else if (net < 10) netEl.classList.add('net-warn');
    else netEl.classList.add('net-pos');

    updateProgressCircle(dailyEarned, dailyTotalPot);

    const sList = document.getElementById('shopList'); sList.innerHTML = '';
    (globalData.rewards || []).forEach((r) => {
        if (r.archivedAt && viewStr >= r.archivedAt) return;
        const currentCost = window.getItemValueAtDate(r, 'cost', viewStr);
        const tagObj = tagsMap[r.tagId];
        const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
        const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';
        const count = countRewardPurchases(r.name);
        const countHtml = count > 0 ? `<span class="shop-count">Acquistato ${count} volte</span>` : '';

        sList.innerHTML += `
            <div class="item" style="${borderStyle}">
                <div><h3>${r.name}</h3>${tagHtml}${countHtml}<div style="margin-top:5px"><span class="shop-price">-${currentCost}</span></div></div>
                <div class="actions-group">
                        <button class="btn-icon-minimal" onclick="openEditModal('${r.id}', 'reward')"><span class="material-icons-round" style="font-size:18px">edit</span></button>
                        <button class="btn-main" style="width:auto; padding:5px 15px; margin:0" onclick="buyReward('${r.name}', ${currentCost})">Compra</button>
                </div>
            </div>`;
    });
}

function updateProgressCircle(earned, total) {
    const circle = document.getElementById('prog-circle');
    const text = document.getElementById('prog-text');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI; 
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    let percent = total === 0 ? 0 : (earned / total) * 100;
    let visualPct = Math.max(0, Math.min(100, percent));
    const offset = circumference - (visualPct / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    text.innerText = Math.round(percent) + "%";
}

// --- V12 STATUS LOGIC (CYCLE) ---
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
    
    // Find Habit Definition for this date
    let habitsArr = globalData.habits;
    let habitIndex = habitsArr.findIndex(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === habitId);
    const habitObj = habitsArr[habitIndex];
    
    const isMulti = window.getItemValueAtDate(habitObj, 'isMulti', dateStr);
    const rewardMax = window.getItemValueAtDate(habitObj, 'reward', dateStr);
    const rewardMin = window.getItemValueAtDate(habitObj, 'rewardMin', dateStr);
    const penalty = window.getItemValueAtDate(habitObj, 'penalty', dateStr);

    // 1. Revert Current State Score
    if (currentHabits.includes(habitId)) {
        let level = currentLevels[habitId] || 'max';
        if (isMulti && level === 'min') globalData.score -= rewardMin;
        else globalData.score -= rewardMax;
        
        currentHabits = currentHabits.filter(id => id !== habitId);
        delete currentLevels[habitId];
    }
    if (currentFailed.includes(habitId)) {
        globalData.score += penalty;
        currentFailed = currentFailed.filter(id => id !== habitId);
    }

    // 2. Determine New State
    let actionType = 'neutral';
    
    if (action === 'failed') {
        // Force Fail
        currentFailed.push(habitId);
        globalData.score -= penalty;
        actionType = 'failed';
    } else if (action === 'next') {
        // Cycle Logic
        // Was nothing? -> Min (if multi) OR Max (if single)
        // Was Min? -> Max
        // Was Max? -> Nothing
        
        // We already cleared previous state above, so we just need to know what it WAS to decide next
        const wasDone = (dailyLogs[dateStr]?.habits || []).includes(habitId);
        const wasLevel = (dailyLogs[dateStr]?.habitLevels || {})[habitId] || 'max';

        if (!wasDone) {
            // Nothing -> Min (or Max if not multi)
            currentHabits.push(habitId);
            if (isMulti) {
                currentLevels[habitId] = 'min';
                globalData.score += rewardMin;
            } else {
                currentLevels[habitId] = 'max';
                globalData.score += rewardMax;
                actionType = 'done';
            }
        } else {
            // Was Done
            if (isMulti && wasLevel === 'min') {
                // Min -> Max
                currentHabits.push(habitId);
                currentLevels[habitId] = 'max';
                globalData.score += rewardMax;
                actionType = 'done';
            } else {
                // Max -> Nothing (Already handled by Revert step)
            }
        }
        
        if (habitIndex >= 0 && currentHabits.includes(habitId)) habitsArr[habitIndex].lastDone = dateStr; 
    }

    dailyLogs[dateStr] = { 
        habits: currentHabits, 
        failedHabits: currentFailed, 
        habitLevels: currentLevels, 
        purchases: entry.purchases || [] 
    };
    
    await updateDoc(ref, { score: globalData.score, dailyLogs: dailyLogs, habits: habitsArr });
    logHistory(currentUser, globalData.score);
    vibrate('light');
    
    if(actionType === 'done') {
        if(dateStr === getDateString(new Date())) confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 }, colors: [currentUser=='flavio'?'#ffca28':'#d05ce3'] });
        showToast("Completata!", "✅");
    } else if (actionType === 'failed') showToast("Segnata come fallita", "❌");
};

// --- REST OF APP (Buy, Refund, Notes, Streaks, Analytics) ---
window.buyReward = async (name, cost) => {
    if(globalData.score < cost) { vibrate('heavy'); showToast("Punti insufficienti!", "❌"); return; }
    if(!confirm(`Comprare ${name} per ${cost}?`)) return;
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let entry = globalData.dailyLogs?.[dateStr] || {};
    let currentPurchases = Array.isArray(entry) ? [] : (entry.purchases || []);
    
    currentPurchases.push({ name, cost, time: Date.now() });
    let newScore = globalData.score - parseInt(cost);
    
    // Preserve other fields
    let newEntry = { 
        habits: entry.habits || [], 
        failedHabits: entry.failedHabits || [], 
        habitLevels: entry.habitLevels || {}, 
        purchases: currentPurchases 
    };

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

// --- V12 MODALS (EDIT/ADD) ---
window.openEditModal = (id, type) => {
    editingType = type;
    const list = type === 'habit' ? globalData.habits : globalData.rewards;
    editingItem = list.find(i => i.id === id);
    if(!editingItem) return;

    document.getElementById('editName').value = editingItem.name;
    document.getElementById('editNote').value = '';
    document.getElementById('editDate').value = new Date().toISOString().split('T')[0];
    
    const tagSel = document.getElementById('editTag');
    tagSel.innerHTML = '<option value="">Nessun Tag</option>';
    (globalData.tags || []).forEach(t => {
        const opt = document.createElement('option'); opt.value = t.id; opt.innerText = t.name;
        tagSel.appendChild(opt);
    });
    tagSel.value = editingItem.tagId || "";

    if (type === 'habit') {
        document.getElementById('editHabitFields').style.display = 'block';
        document.getElementById('editRewardFields').style.display = 'none';
        
        // V12: Load current IsMulti status
        const isMulti = editingItem.isMulti || false;
        document.getElementById('editIsMulti').checked = isMulti;
        toggleMultiInput('edit'); // Trigger UI update
        
        document.getElementById('editVal1').value = editingItem.reward;
        document.getElementById('editVal2').value = editingItem.penalty;
        document.getElementById('editRewardMin').value = editingItem.rewardMin || 0;
        document.getElementById('editDesc').value = editingItem.description || "";
    } else {
        document.getElementById('editHabitFields').style.display = 'none';
        document.getElementById('editRewardFields').style.display = 'block';
        document.getElementById('editCost').value = editingItem.cost;
        document.getElementById('editDesc').value = ""; // Rewards don't use desc yet
    }

    renderEditHistory(editingItem, type);
    document.getElementById('editModal').style.display = 'flex';
}

function renderEditHistory(item, type) {
    const container = document.getElementById('editHistoryLog');
    container.innerHTML = '';
    let changes = item.changes ? item.changes.slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
    if (changes.length === 0) { container.innerHTML = '<div class="history-item"><div class="history-date">In origine</div>Creata con valore corrente.</div>'; return; }
    
    let html = '';
    changes.forEach((change, index) => {
        let dateFmt = change.date.split('-').reverse().join('/'); 
        let noteHtml = change.note ? `<div class="history-note">${change.note}</div>` : '';
        let text = '';
        if (index === 0) {
            let val = type === 'habit' ? `+${change.reward} / -${change.penalty}` : `${change.cost}`;
            text = `Valore iniziale: <b>${val}</b>`;
        } else {
            if (type === 'habit') {
               text = `Modifica valori (es. Multi: ${change.isMulti})`; 
            } else {
               text = `Costo: ${change.cost}`;
            }
        }
        html += `<div class="history-item"><div class="history-date">${dateFmt}</div><div>${text}</div>${noteHtml}</div>`;
    });
    container.innerHTML = html;
}

window.saveEdit = async () => {
    if(!editingItem) return;
    const newName = document.getElementById('editName').value;
    const editDate = document.getElementById('editDate').value; 
    const editNote = document.getElementById('editNote').value;
    const newTag = document.getElementById('editTag').value;
    const newDesc = document.getElementById('editDesc').value;

    if(!editDate) { alert("Data obbligatoria"); return; }

    editingItem.name = newName;
    editingItem.tagId = newTag;
    
    // Base change entry
    let newChangeEntry = { date: editDate };
    if (editNote.trim() !== "") newChangeEntry.note = editNote;

    if (editingType === 'habit') { 
        const val1 = parseInt(document.getElementById('editVal1').value) || 0;
        const val2 = parseInt(document.getElementById('editVal2').value) || 0;
        const rewardMin = parseInt(document.getElementById('editRewardMin').value) || 0;
        const isMulti = document.getElementById('editIsMulti').checked;

        // V12: Save all fields to change history to preserve time travel
        newChangeEntry.reward = val1; 
        newChangeEntry.penalty = val2;
        newChangeEntry.isMulti = isMulti;
        newChangeEntry.rewardMin = rewardMin;
        newChangeEntry.description = newDesc;
        
        // Update root item for future reference
        editingItem.reward = val1; 
        editingItem.penalty = val2;
        editingItem.isMulti = isMulti;
        editingItem.rewardMin = rewardMin;
        editingItem.description = newDesc;
    } else { 
        const cost = parseInt(document.getElementById('editCost').value) || 0;
        newChangeEntry.cost = cost; 
        editingItem.cost = cost;
    }

    if (!editingItem.changes) {
        // Init history if missing
        let initialEntry = { date: '2020-01-01', note: 'Creazione Iniziale' }; 
        if (editingType === 'habit') { 
            initialEntry.reward = editingItem.reward; 
            initialEntry.penalty = editingItem.penalty; 
            initialEntry.isMulti = editingItem.isMulti || false;
            initialEntry.rewardMin = editingItem.rewardMin || 0;
            initialEntry.description = editingItem.description || "";
        } else { 
            initialEntry.cost = editingItem.cost; 
        }
        editingItem.changes = [initialEntry];
    }
    
    // Remove existing change for same date if exists
    editingItem.changes = editingItem.changes.filter(c => c.date !== editDate);
    editingItem.changes.push(newChangeEntry);
    editingItem.changes.sort((a, b) => a.date.localeCompare(b.date));

    const ref = doc(db, "users", currentUser);
    if(editingType === 'habit') await updateDoc(ref, { habits: globalData.habits });
    else await updateDoc(ref, { rewards: globalData.rewards });
    
    document.getElementById('editModal').style.display = 'none';
    editingItem = null;
    renderView(); showToast("Salvato!", "✏️");
}

window.addItem = async () => {
    let name = document.getElementById('newName').value;
    const tag = document.getElementById('newTag').value;
    if(!name) { vibrate('heavy'); return; }
    const id = Date.now().toString(); 
    const ref = doc(db, "users", currentUser);
    
    try {
        if(addType === 'habit') {
            const r = parseInt(document.getElementById('newReward').value) || 0;
            const p = parseInt(document.getElementById('newPenalty').value) || 0;
            const freq = document.getElementById('newFrequency').value || 1;
            const targetDate = document.getElementById('newTargetDate').value;
            const isMulti = document.getElementById('newIsMulti').checked;
            const rewardMin = parseInt(document.getElementById('newRewardMin').value) || 0;
            const desc = document.getElementById('newDesc').value || "";
            
            let newHabit = { 
                id, name, reward:r, penalty:p, tagId: tag, type: recurMode,
                isMulti: isMulti, rewardMin: rewardMin, description: desc 
            };
            if (recurMode === 'recur') newHabit.frequency = parseInt(freq);
            else newHabit.targetDate = targetDate; 

            await updateDoc(ref, { habits: arrayUnion(newHabit) });
        } else {
            const c = document.getElementById('newCost').value || 0;
            await updateDoc(ref, { rewards: arrayUnion({id, name, cost:c, tagId: tag}) });
        }
        document.getElementById('addModal').style.display='none'; document.getElementById('newName').value=''; vibrate('light'); showToast("Salvato!", "💾");
    } catch(e) { console.error(e); }
};

// --- REMAINDER OF HELPERS (Notes, Stats, etc) ---
function setupNoteListener(dateStr) {
    if (currentNoteUnsubscribe) { currentNoteUnsubscribe(); currentNoteUnsubscribe = null; }
    const textArea = document.getElementById('dailyNoteArea');
    textArea.value = "";
    document.getElementById('noteStatus').innerText = "Caricamento...";
    const noteRef = doc(db, "shared_notes", dateStr);
    currentNoteUnsubscribe = onSnapshot(noteRef, (docSnap) => {
        if (docSnap.exists()) {
            if (document.activeElement !== textArea) textArea.value = docSnap.data().text || "";
            document.getElementById('noteStatus').innerText = "Sincronizzato";
        } else {
            if (document.activeElement !== textArea) textArea.value = "";
            document.getElementById('noteStatus').innerText = "Nessuna nota";
        }
    });
}
window.handleNoteInput = (val) => {
    document.getElementById('noteStatus').innerText = "Salvataggio...";
    clearTimeout(noteDebounceTimer);
    noteDebounceTimer = setTimeout(async () => {
        const dateStr = getDateString(viewDate);
        const noteRef = doc(db, "shared_notes", dateStr);
        await setDoc(noteRef, { text: val }, { merge: true });
        document.getElementById('noteStatus').innerText = "Salvato";
    }, 1000);
}
function calculateStreak(habitId) {
    let streak = 0;
    let d = new Date(); 
    let str = getDateString(d);
    let entry = globalData.dailyLogs?.[str];
    let doneArr = [];
    if (Array.isArray(entry)) doneArr = entry; else doneArr = entry?.habits || [];
    if (doneArr.includes(habitId)) streak++;
    while (true) {
        d.setDate(d.getDate() - 1);
        str = getDateString(d);
        entry = globalData.dailyLogs?.[str];
        doneArr = [];
        if (Array.isArray(entry)) doneArr = entry; else doneArr = entry?.habits || [];
        if (doneArr.includes(habitId)) streak++; else break;
    }
    return streak;
}

// ... (Functions like updateDetailedChart, openStats, Tag Manager, Archive remain the same as V11, omitted for brevity but part of full file) ...
// Ensure you copy the V11 Analytics/Tag/Stats logic here if overriding file completely.
// For the sake of this answer, I assume the rest of the functions from V11 are present.

// V11+ Chart Logic Patch: Ensure charts use `getItemValueAtDate` and check levels!
window.updateDetailedChart = (days) => {
    // ... (UI Logic) ...
    const ctx = document.getElementById('detailedChart').getContext('2d');
    const labels = []; const dates = [];
    for(let i=days-1; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const str = d.toISOString().split('T')[0];
        dates.push(str);
        labels.push(`${d.getDate()}/${d.getMonth()+1}`);
    }
    const getPoints = (userData) => {
        if(!userData || !userData.dailyLogs) return new Array(days).fill(0);
        return dates.map(date => {
            const entry = userData.dailyLogs[date] || {};
            // Safe access
            let doneArr = Array.isArray(entry) ? entry : (entry.habits || []);
            let failedArr = entry.failedHabits || [];
            let levels = entry.habitLevels || {};
            let purchases = entry.purchases || [];
            
            let net = 0;
            doneArr.forEach(hId => {
                const h = userData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
                if(h) {
                    // V12 Logic for Chart
                    const rMax = window.getItemValueAtDate(h, 'reward', date);
                    const rMin = window.getItemValueAtDate(h, 'rewardMin', date);
                    const isM = window.getItemValueAtDate(h, 'isMulti', date);
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
    // ... (Chart Rendering same as V11) ...
     const flavioPoints = getPoints(allUsersData.flavio);
    const simonaPoints = getPoints(allUsersData.simona);
    if(detailedChartInstance) detailedChartInstance.destroy();
    detailedChartInstance = new Chart(ctx, {
        type: 'line', 
        data: { labels: labels, datasets: [ { label: 'Flavio', data: flavioPoints, borderColor: '#ffca28', backgroundColor: 'rgba(255, 202, 40, 0.1)', borderWidth:2, pointRadius: 5 }, { label: 'Simona', data: simonaPoints, borderColor: '#d05ce3', backgroundColor: 'rgba(208, 92, 227, 0.1)', borderWidth:2, pointRadius: 5 } ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { grid: { color: '#333' } }, x: { grid: { color: '#333' } } } }
    });
}

// ... Re-include window.openAnalytics, window.openStats etc from previous version here ...
window.openAnalytics = () => { document.getElementById('analyticsModal').style.display = 'flex'; updateDetailedChart(30); }
window.openTagManager = () => { editingTagIndex = null; document.getElementById('newTagName').value = ''; document.getElementById('btnSaveTag').innerText = "Crea Tag"; renderTagsList(); document.getElementById('tagModal').style.display = 'flex'; }
// ... (Tag functions) ...
function renderTagsList() { const list = document.getElementById('tagsList'); list.innerHTML = ''; (globalData.tags || []).forEach((t, idx) => { list.innerHTML += `<div class="tag-row"><div><span class="color-dot" style="background:${t.color}"></span>${t.name}</div><div><button class="btn-icon-minimal" onclick="editTag(${idx})"><span class="material-icons-round">edit</span></button><button class="btn-icon-minimal btn-delete" onclick="deleteTag(${idx})"><span class="material-icons-round">delete</span></button></div></div>`; }); }
window.editTag = (idx) => { const t = globalData.tags[idx]; document.getElementById('newTagName').value = t.name; document.getElementById('newTagColor').value = t.color; editingTagIndex = idx; document.getElementById('btnSaveTag').innerText = "Aggiorna Tag"; }
window.saveTagManager = async () => { const name = document.getElementById('newTagName').value; const color = document.getElementById('newTagColor').value; if(!name) return; let tags = globalData.tags || []; if (editingTagIndex !== null) { tags[editingTagIndex].name = name; tags[editingTagIndex].color = color; } else { tags.push({ id: Date.now().toString(), name, color }); } const ref = doc(db, "users", currentUser); await updateDoc(ref, { tags: tags }); document.getElementById('newTagName').value = ''; editingTagIndex = null; document.getElementById('btnSaveTag').innerText = "Crea Tag"; renderTagsList(); showToast("Tag salvato", "🏷️"); }
window.deleteTag = async (idx) => { if(!confirm("Eliminare tag?")) return; const tags = globalData.tags; tags.splice(idx, 1); await updateDoc(doc(db, "users", currentUser), { tags }); renderTagsList(); }
window.archiveFromEdit = () => { if(!editingItem) return; archiveItem(editingType === 'habit' ? 'habits' : 'rewards', editingItem.id); document.getElementById('editModal').style.display = 'none'; }
window.archiveItem = (list, id) => { pendingArchiveId = { list, id }; document.getElementById('archiveDate').value = new Date().toISOString().split('T')[0]; document.getElementById('archiveModal').style.display = 'flex'; }
window.confirmArchive = async () => { if(!pendingArchiveId) return; const date = document.getElementById('archiveDate').value; const { list, id } = pendingArchiveId; const ref = doc(db, "users", currentUser); const arr = globalData[list]; const idx = arr.findIndex(i => i.id === id); if (idx > -1) { arr[idx].archivedAt = date; await updateDoc(ref, { [list]: arr }); showToast("Archiviato", "📦"); } document.getElementById('archiveModal').style.display = 'none'; }
window.toggleInputs = () => {}; 
window.openStats = () => { if (!globalData || !globalData.dailyLogs) return; let totalNet = 0; let daysCount = 0; let maxNet = -Infinity; let bestDay = '-'; let minNet = Infinity; let worstDay = '-'; let habitCounts = {}; let rewardCounts = {}; const dates = Object.keys(globalData.dailyLogs).sort(); dates.forEach(date => { daysCount++; const entry = globalData.dailyLogs[date]; let doneArr = [], failedArr = [], purchases = []; if (Array.isArray(entry)) { doneArr = entry; } else { doneArr = entry.habits || []; failedArr = entry.failedHabits || []; purchases = entry.purchases || []; } doneArr.forEach(hId => { const h = globalData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) habitCounts[h.name] = (habitCounts[h.name] || 0) + 1; }); purchases.forEach(p => { rewardCounts[p.name] = (rewardCounts[p.name] || 0) + 1; }); let dayEarn = 0; let daySpent = 0; doneArr.forEach(hId => { const h = globalData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) dayEarn += window.getItemValueAtDate(h, 'reward', date); }); failedArr.forEach(hId => { const h = globalData.habits.find(x => (x.id || x.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) daySpent += window.getItemValueAtDate(h, 'penalty', date); }); let pCost = purchases.reduce((acc, p) => acc + parseInt(p.cost), 0); daySpent += pCost; let dayNet = dayEarn - daySpent; totalNet += dayNet; if (dayNet > maxNet) { maxNet = dayNet; bestDay = date; } if (dayNet < minNet) { minNet = dayNet; worstDay = date; } }); const avg = daysCount > 0 ? (totalNet / daysCount).toFixed(1) : 0; let bestHabit = Object.keys(habitCounts).reduce((a, b) => habitCounts[a] > habitCounts[b] ? a : b, '-'); let favReward = Object.keys(rewardCounts).reduce((a, b) => rewardCounts[a] > rewardCounts[b] ? a : b, '-'); const html = `<div class="stat-card"><span class="stat-val">${avg}</span><span class="stat-label">Media Netta</span></div><div class="stat-card"><span class="stat-val">${daysCount}</span><span class="stat-label">Giorni Attivi</span></div><div class="stat-card" style="border-color:var(--success)"><span class="stat-val" style="color:var(--success)">+${maxNet === -Infinity ? 0 : maxNet}</span><span class="stat-label">Best Day</span><span class="stat-sub">${bestDay.split('-').reverse().join('/')}</span></div><div class="stat-card" style="border-color:var(--danger)"><span class="stat-val" style="color:var(--danger)">${minNet === Infinity ? 0 : minNet}</span><span class="stat-label">Worst Day</span><span class="stat-sub">${worstDay.split('-').reverse().join('/')}</span></div><div class="stat-card" style="grid-column: span 2"><span class="stat-val" style="font-size:1.1em">${bestHabit}</span><span class="stat-label">Abitudine Costante</span></div><div class="stat-card" style="grid-column: span 2"><span class="stat-val" style="font-size:1.1em">${favReward}</span><span class="stat-label">Premio Preferito</span></div>`; document.getElementById('statsContent').innerHTML = html; document.getElementById('statsModal').style.display = 'flex'; }
window.exportData = async () => { vibrate('light'); showToast("Backup...", "⏳"); try { const usersCol = collection(db, 'users'); const userSnapshot = await getDocs(usersCol); let backupData = {}; userSnapshot.forEach(doc => { backupData[doc.id] = doc.data(); }); const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData)); const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr); const date = new Date().toISOString().slice(0,10); downloadAnchorNode.setAttribute("download", `GLP_Backup_${date}.json`); document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove(); showToast("Fatto!", "✅"); } catch (e) { console.error(e); showToast("Errore", "❌"); } };
window.importData = (files) => { if (files.length === 0) return; const file = files[0]; const reader = new FileReader(); reader.onload = async (e) => { try { const backupData = JSON.parse(e.target.result); if (!confirm("Sovrascrivere?")) { document.getElementById('importFile').value = ''; return; } showToast("Ripristino...", "⏳"); for (const userId in backupData) { if (backupData.hasOwnProperty(userId)) await setDoc(doc(db, "users", userId), backupData[userId]); } showToast("Fatto!", "✅"); setTimeout(() => location.reload(), 1500); } catch (err) { console.error(err); showToast("File non valido", "❌"); } document.getElementById('importFile').value = ''; }; reader.readAsText(file); };
window.vibrate = (type) => { if (navigator.vibrate && type === 'light') navigator.vibrate(30); if (navigator.vibrate && type === 'heavy') navigator.vibrate([50, 50]); }
window.showToast = (msg, icon) => { const t = document.getElementById('toast'); document.getElementById('toast-text').innerText = msg; document.getElementById('toast-icon').innerText = icon || "ℹ️"; t.className = "show"; setTimeout(() => { t.className = t.className.replace("show", ""); }, 2500); }
window.hardReset = async () => { const code = prompt("Scrivi RESET:"); if(code === "RESET") { await deleteDoc(doc(db, "users", currentUser)); location.reload(); } };
function applyTheme(user) { const root = document.documentElement; if (user === 'flavio') { root.style.setProperty('--theme-color', '#ffca28'); root.style.setProperty('--theme-glow', 'rgba(255, 202, 40, 0.3)'); document.getElementById('avatar-initial').innerText = 'F'; document.getElementById('username-display').innerText = 'Flavio'; } else { root.style.setProperty('--theme-color', '#d05ce3'); root.style.setProperty('--theme-glow', 'rgba(208, 92, 227, 0.3)'); document.getElementById('avatar-initial').innerText = 'S'; document.getElementById('username-display').innerText = 'Simona'; } document.getElementById('card-flavio').classList.remove('active'); document.getElementById('card-simona').classList.remove('active'); document.getElementById(`card-${user}`).classList.add('active'); }
window.switchUser = (u) => { if(currentUser === u) return; currentUser = u; localStorage.setItem('glp_user', u); applyTheme(u); vibrate('light'); location.reload(); }
async function logHistory(user, score) { const ref = doc(db, "users", user); const hist = globalData.history || []; hist.push({date: new Date().toISOString(), score}); if(hist.length > 500) hist.shift(); await updateDoc(ref, { history: hist }); }
function updateMultiChart() { /* Keep basic chart from V11 */ const ctx = document.getElementById('progressChart').getContext('2d'); const labels = []; const dates = []; for(let i=14; i>=0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); labels.push(`${d.getDate()}/${d.getMonth()+1}`); } const getDailyNetPoints = (userData) => { if(!userData || !userData.dailyLogs) return new Array(15).fill(0); return dates.map(date => { const entry = userData.dailyLogs[date]; if(!entry) return 0; let doneArr = [], failedArr = [], purchases = []; if (Array.isArray(entry)) { doneArr = entry; } else { doneArr = entry.habits || []; failedArr = entry.failedHabits || []; purchases = entry.purchases || []; } let net = 0; doneArr.forEach(hId => { const h = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) { const isM = window.getItemValueAtDate(h, 'isMulti', date); const rMin = window.getItemValueAtDate(h, 'rewardMin', date); const rMax = window.getItemValueAtDate(h, 'reward', date); let lvl = (entry.habitLevels || {})[hId] || 'max'; if(isM && lvl === 'min') net += rMin; else net += rMax; } }); failedArr.forEach(hId => { const h = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId); if(h) net -= window.getItemValueAtDate(h, 'penalty', date); }); let spent = purchases.reduce((acc, p) => acc + parseInt(p.cost), 0); return net - spent; }); }; const flavioPoints = getDailyNetPoints(allUsersData.flavio); const simonaPoints = getDailyNetPoints(allUsersData.simona); if(chartInstance) chartInstance.destroy(); chartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [ { label: 'Flavio', data: flavioPoints, borderColor: '#ffca28', backgroundColor: 'rgba(255, 202, 40, 0.1)', fill:true, tension: 0.4, pointRadius: 4 }, { label: 'Simona', data: simonaPoints, borderColor: '#d05ce3', backgroundColor: 'rgba(208, 92, 227, 0.1)', fill:true, tension: 0.4, pointRadius: 4 } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#888' } } }, scales: { y: { grid: { color: '#333' }, ticks: { color: '#888' }, beginAtZero: true }, x: { grid: { display: false }, ticks: { color: '#888', maxTicksLimit: 8 } } } } }); }