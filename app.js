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
let pendingArchiveId = null;

// --- HELPERS ---
window.getItemValueAtDate = (item, field, dateStr) => {
    if (!item.changes || item.changes.length === 0) return parseInt(item[field] || 0);
    const sortedChanges = item.changes.slice().sort((a, b) => a.date.localeCompare(b.date));
    let validChange = null;
    for (let change of sortedChanges) {
        if (change.date <= dateStr) validChange = change; else break;
    }
    if (validChange) return parseInt(validChange[field] || 0);
    return sortedChanges.length > 0 ? parseInt(sortedChanges[0][field] || 0) : 0;
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

// INIT
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

// NAVIGATION
window.changeDate = (days) => { viewDate.setDate(viewDate.getDate() + days); renderView(); }
window.goToDate = (dateStr) => { 
    if(!dateStr) return;
    viewDate = new Date(dateStr); 
    renderView(); 
}
function getDateString(date) { return date.toISOString().split('T')[0]; }

// RENDER
function renderView() {
    if(!globalData) return;
    const todayStr = getDateString(new Date());
    const viewStr = getDateString(viewDate);
    
    // UI Date Updates
    const displayEl = document.getElementById('dateDisplay');
    let isToday = (viewStr === todayStr);
    if (isToday) displayEl.innerText = "OGGI";
    else if (viewStr === getDateString(new Date(Date.now() - 86400000))) displayEl.innerText = "IERI";
    else displayEl.innerText = `${viewDate.getDate()}/${viewDate.getMonth()+1}`;
    
    document.getElementById('datePicker').value = viewStr;

    const dailyLogs = globalData.dailyLogs || {};
    const entry = dailyLogs[viewStr] || {};
    
    const doneHabits = Array.isArray(entry) ? entry : (entry.habits || []);
    const failedHabits = entry.failedHabits || [];
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
        
        const currentReward = window.getItemValueAtDate(h, 'reward', viewStr);
        const currentPenalty = window.getItemValueAtDate(h, 'penalty', viewStr);

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
            dailyTotalPot += currentReward;
            if(isDone) dailyEarned += currentReward;
            if(isFailed) dailySpent += currentPenalty; 

            const tagObj = tagsMap[h.tagId];
            const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
            const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';
            let statusClass = isDone ? 'status-done' : (isFailed ? 'status-failed' : '');
            
            hList.innerHTML += `
                <div class="item ${statusClass}" style="${borderStyle}">
                    <div>
                        <div style="display:flex; align-items:center"><h3>${h.name}</h3>${tagHtml}</div>
                        <div class="vals"><span class="plus">+${currentReward}</span> / <span class="minus">-${currentPenalty}</span></div>
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon-minimal" onclick="openEditModal('${h.id}', 'habit')"><span class="material-icons-round" style="font-size:18px">edit</span></button>
                        <button class="btn-status failed ${isFailed?'active':''}" onclick="setHabitStatus('${stableId}', 'failed', ${currentPenalty})"><span class="material-icons-round">close</span></button>
                        <button class="btn-status done ${isDone?'active':''}" onclick="setHabitStatus('${stableId}', 'done', ${currentReward})"><span class="material-icons-round">check</span></button>
                    </div>
                </div>`;
        } else {
            upcomingCount++;
            upcomingList.innerHTML += `<div class="item" style="opacity:0.6; border-left:4px solid #555"><div><h3>${h.name}</h3><div class="vals">Tra ${daysLeft} gg</div></div></div>`;
        }
    });
    
    if(visibleCount === 0) hList.innerHTML = '<div style="text-align:center; padding:20px; color:#666">Nessuna attività attiva oggi 🎉</div>';
    
    // Purchases
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
    
    // Update Summary
    document.getElementById('sum-earn').innerText = `+${dailyEarned}`;
    document.getElementById('sum-spent').innerText = `-${dailySpent}`;
    const net = dailyEarned - dailySpent;
    document.getElementById('sum-net').innerText = (net > 0 ? '+' : '') + net;

    updateProgressCircle(dailyEarned, dailyTotalPot);

    // Rewards
    const sList = document.getElementById('shopList'); sList.innerHTML = '';
    (globalData.rewards || []).forEach((r) => {
        if (r.archivedAt && viewStr >= r.archivedAt) return;
        const currentCost = window.getItemValueAtDate(r, 'cost', viewStr);
        const tagObj = tagsMap[r.tagId];
        const borderStyle = tagObj ? `border-left-color: ${tagObj.color}` : '';
        const tagHtml = tagObj ? `<span class="tag-pill" style="background:${tagObj.color}">${tagObj.name}</span>` : '';
        const count = countRewardPurchases(r.name);
        const countHtml = count > 0 ? `<span class="count-badge">x${count}</span>` : '';

        sList.innerHTML += `
            <div class="item" style="${borderStyle}">
                <div><h3>${r.name}</h3>${tagHtml}${countHtml}<div class="vals minus">Costo: ${currentCost}</div></div>
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

window.toggleAccordion = (id) => { document.getElementById(id).classList.toggle('show'); }

// --- BUSINESS LOGIC ---
window.setHabitStatus = async (habitId, newStatus, value) => {
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let dailyLogs = globalData.dailyLogs || {};
    let entry = dailyLogs[dateStr] || { habits: [], failedHabits: [], purchases: [] };
    
    if (Array.isArray(entry)) entry = { habits: entry, failedHabits: [], purchases: [] };
    if (!entry.failedHabits) entry.failedHabits = [];
    if (!entry.habits) entry.habits = [];

    let currentHabits = entry.habits;
    let currentFailed = entry.failedHabits;
    let scoreDelta = 0;
    let actionType = 'neutral';

    let habitsArr = globalData.habits;
    let habitIndex = habitsArr.findIndex(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === habitId);
    const habitObj = habitsArr[habitIndex];

    if (currentHabits.includes(habitId)) {
        const r = window.getItemValueAtDate(habitObj, 'reward', dateStr);
        scoreDelta -= r;
        currentHabits = currentHabits.filter(id => id !== habitId);
    }
    if (currentFailed.includes(habitId)) {
        const p = window.getItemValueAtDate(habitObj, 'penalty', dateStr);
        scoreDelta += p;
        currentFailed = currentFailed.filter(id => id !== habitId);
    }

    if (newStatus === 'done') {
        const wasDone = (dailyLogs[dateStr]?.habits || []).includes(habitId);
        if (!wasDone) {
            currentHabits.push(habitId);
            scoreDelta += parseInt(value);
            actionType = 'done';
            if (habitIndex >= 0) habitsArr[habitIndex].lastDone = dateStr; 
        }
    } else if (newStatus === 'failed') {
        const wasFailed = (dailyLogs[dateStr]?.failedHabits || []).includes(habitId);
        if (!wasFailed) {
            currentFailed.push(habitId);
            scoreDelta -= parseInt(value);
            actionType = 'failed';
        }
    }

    let newScore = globalData.score + scoreDelta;
    dailyLogs[dateStr] = { habits: currentHabits, failedHabits: currentFailed, purchases: entry.purchases || [] };
    
    await updateDoc(ref, { score: newScore, dailyLogs: dailyLogs, habits: habitsArr });
    logHistory(currentUser, newScore);
    vibrate('light');
    
    if(actionType === 'done') {
        if(dateStr === getDateString(new Date())) confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 }, colors: [currentUser=='flavio'?'#ffca28':'#d05ce3'] });
        showToast("Completata!", "✅");
    } else if (actionType === 'failed') showToast("Segnata come fallita", "❌");
};

window.buyReward = async (name, cost) => {
    if(globalData.score < cost) { vibrate('heavy'); showToast("Punti insufficienti!", "❌"); return; }
    if(!confirm(`Comprare ${name} per ${cost}?`)) return;
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let dailyLogs = globalData.dailyLogs || {};
    let entry = dailyLogs[dateStr] || { habits:[], failedHabits:[], purchases:[] };
    if(Array.isArray(entry)) entry = { habits:entry, failedHabits:[], purchases:[] };
    
    let currentPurchases = entry.purchases || [];
    currentPurchases.push({ name: name, cost: cost, time: Date.now() });
    
    let newScore = globalData.score - parseInt(cost);
    dailyLogs[dateStr] = { ...entry, purchases: currentPurchases };
    
    await updateDoc(ref, { score: newScore, dailyLogs: dailyLogs });
    logHistory(currentUser, newScore);
    vibrate('heavy');
    confetti({ shapes: ['circle'], colors: ['#4caf50'] });
    showToast("Acquisto effettuato!", "🛍️");
};

window.refundPurchase = async (idx, cost) => {
    if(!confirm("Annullare acquisto e rimborsare punti?")) return;
    const dateStr = getDateString(viewDate);
    const ref = doc(db, "users", currentUser);
    let dailyLogs = globalData.dailyLogs; 
    let entry = dailyLogs[dateStr];
    entry.purchases.splice(idx, 1);
    let newScore = globalData.score + parseInt(cost);
    await updateDoc(ref, { score: newScore, dailyLogs: dailyLogs });
    logHistory(currentUser, newScore);
    vibrate('light');
    showToast("Rimborsato!", "↩️");
};

let editingItem = null; let editingType = null; 

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
        document.getElementById('editLabel1').innerText = "Reward (+)";
        document.getElementById('editLabel2').innerText = "Penalty (-)";
        document.getElementById('editValGroup2').style.display = 'block';
        document.getElementById('editVal1').value = editingItem.reward;
        document.getElementById('editVal2').value = editingItem.penalty;
    } else {
        document.getElementById('editLabel1').innerText = "Costo";
        document.getElementById('editValGroup2').style.display = 'none'; 
        document.getElementById('editVal1').value = editingItem.cost;
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
            let prev = changes[index - 1];
            let diffText = '';
            if (type === 'habit') {
                if (prev.reward !== change.reward) diffText += `Reward: ${prev.reward}→<b>${change.reward}</b>. `;
                if (prev.penalty !== change.penalty) diffText += `Penalty: ${prev.penalty}→<b>${change.penalty}</b>. `;
            } else {
                if (prev.cost !== change.cost) diffText = `Costo: ${prev.cost}→<b>${change.cost}</b>`;
            }
            if (!diffText) diffText = "Solo Nota/Tag/Nome";
            text = diffText;
        }
        html += `<div class="history-item"><div class="history-date">${dateFmt}</div><div>${text}</div>${noteHtml}</div>`;
    });
    container.innerHTML = html;
}

window.saveEdit = async () => {
    if(!editingItem) return;
    const newName = document.getElementById('editName').value;
    const val1 = parseInt(document.getElementById('editVal1').value) || 0;
    const val2 = parseInt(document.getElementById('editVal2').value) || 0;
    const editDate = document.getElementById('editDate').value; 
    const editNote = document.getElementById('editNote').value;
    const newTag = document.getElementById('editTag').value;

    if(!editDate) { alert("Data obbligatoria"); return; }

    editingItem.name = newName;
    editingItem.tagId = newTag;

    let newChangeEntry = { date: editDate };
    if (editNote.trim() !== "") newChangeEntry.note = editNote;
    if (editingType === 'habit') { newChangeEntry.reward = val1; newChangeEntry.penalty = val2; } 
    else { newChangeEntry.cost = val1; }

    if (!editingItem.changes) {
        let initialEntry = { date: '2020-01-01', note: 'Creazione Iniziale' }; 
        if (editingType === 'habit') { initialEntry.reward = editingItem.reward; initialEntry.penalty = editingItem.penalty; } 
        else { initialEntry.cost = editingItem.cost; }
        editingItem.changes = [initialEntry];
    }
    editingItem.changes = editingItem.changes.filter(c => c.date !== editDate);
    editingItem.changes.push(newChangeEntry);
    editingItem.changes.sort((a, b) => a.date.localeCompare(b.date));

    const latest = editingItem.changes[editingItem.changes.length - 1];
    if (editingType === 'habit') { editingItem.reward = latest.reward; editingItem.penalty = latest.penalty; } 
    else { editingItem.cost = latest.cost; }

    const ref = doc(db, "users", currentUser);
    if(editingType === 'habit') await updateDoc(ref, { habits: globalData.habits });
    else await updateDoc(ref, { rewards: globalData.rewards });
    
    document.getElementById('editModal').style.display = 'none';
    editingItem = null;
    renderView(); 
    showToast("Salvato!", "✏️");
}

window.openTagManager = () => {
    const list = document.getElementById('tagsList');
    list.innerHTML = '';
    (globalData.tags || []).forEach((t, idx) => {
        list.innerHTML += `
        <div class="tag-row">
            <div><span class="color-dot" style="background:${t.color}"></span>${t.name}</div>
            <button class="btn-icon-minimal btn-delete" onclick="deleteTag(${idx})"><span class="material-icons-round">delete</span></button>
        </div>`;
    });
    document.getElementById('tagModal').style.display = 'flex';
}

window.createTag = async () => {
    const name = document.getElementById('newTagName').value;
    const color = document.getElementById('newTagColor').value;
    if(!name) return;
    const ref = doc(db, "users", currentUser);
    await updateDoc(ref, { tags: arrayUnion({ id: Date.now().toString(), name, color }) });
    document.getElementById('newTagName').value = '';
    openTagManager(); // refresh list
}

window.deleteTag = async (idx) => {
    if(!confirm("Eliminare tag?")) return;
    const tags = globalData.tags;
    tags.splice(idx, 1);
    await updateDoc(doc(db, "users", currentUser), { tags });
    openTagManager();
}

let addType = 'habit'; let recurMode = 'recur';
window.setAddType = (t) => {
    addType = t;
    document.querySelectorAll('.switch-opt').forEach(el => el.classList.remove('active'));
    document.getElementById(t==='habit'?'typeHabit':'typeReward').classList.add('active');
    if(recurMode === 'recur') document.getElementById('modeRecur').classList.add('active');
    else document.getElementById('modeSingle').classList.add('active'); 
    
    document.getElementById('habitInputs').style.display = t==='habit'?'block':'none'; 
    document.getElementById('rewardInputs').style.display = t==='reward'?'block':'none';
    const sel = document.getElementById('newTag'); sel.innerHTML = '<option value="">Nessun Tag</option>';
    (globalData.tags || []).forEach(t => { sel.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
}
window.setRecurMode = (m) => {
    recurMode = m;
    document.getElementById('modeRecur').classList.remove('active');
    document.getElementById('modeSingle').classList.remove('active');
    document.getElementById(m==='recur'?'modeRecur':'modeSingle').classList.add('active');
    document.getElementById('recurInput').style.display = m==='recur'?'block':'none';
    document.getElementById('dateInput').style.display = m==='single'?'block':'none';
    if(m==='single') document.getElementById('newTargetDate').value = new Date().toISOString().split('T')[0];
}

window.addItem = async () => {
    let name = document.getElementById('newName').value;
    const tag = document.getElementById('newTag').value;
    if(!name) { vibrate('heavy'); return; }
    const id = Date.now().toString(); 
    const ref = doc(db, "users", currentUser);
    
    try {
        if(addType === 'habit') {
            const r = document.getElementById('newReward').value || 0;
            const p = document.getElementById('newPenalty').value || 0;
            const freq = document.getElementById('newFrequency').value || 1;
            const targetDate = document.getElementById('newTargetDate').value;
            
            let newHabit = { id, name, reward:r, penalty:p, tagId: tag, type: recurMode };
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

window.archiveFromEdit = () => {
    if(!editingItem) return;
    archiveItem(editingType === 'habit' ? 'habits' : 'rewards', editingItem.id);
    document.getElementById('editModal').style.display = 'none';
}

window.archiveItem = (list, id) => {
    pendingArchiveId = { list, id };
    document.getElementById('archiveDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('archiveModal').style.display = 'flex';
}

window.confirmArchive = async () => {
    if(!pendingArchiveId) return;
    const date = document.getElementById('archiveDate').value;
    const { list, id } = pendingArchiveId;
    const ref = doc(db, "users", currentUser);
    
    const arr = globalData[list];
    const idx = arr.findIndex(i => i.id === id);
    if (idx > -1) {
        arr[idx].archivedAt = date;
        await updateDoc(ref, { [list]: arr });
        showToast("Archiviato", "📦");
    }
    document.getElementById('archiveModal').style.display = 'none';
}

window.toggleInputs = () => {}; 

window.exportData = async () => {
    vibrate('light'); showToast("Preparazione backup...", "⏳");
    try {
        const usersCol = collection(db, 'users');
        const userSnapshot = await getDocs(usersCol);
        let backupData = {};
        userSnapshot.forEach(doc => { backupData[doc.id] = doc.data(); });
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        const date = new Date().toISOString().slice(0,10);
        downloadAnchorNode.setAttribute("download", `GLP_Backup_${date}.json`);
        document.body.appendChild(downloadAnchorNode); 
        downloadAnchorNode.click(); downloadAnchorNode.remove(); showToast("Backup scaricato!", "✅");
    } catch (e) { console.error(e); showToast("Errore backup", "❌"); }
};

window.importData = (files) => {
    if (files.length === 0) return;
    const file = files[0]; const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const backupData = JSON.parse(e.target.result);
            if (!confirm("Sovrascrivere tutto?")) { document.getElementById('importFile').value = ''; return; }
            showToast("Ripristino...", "⏳");
            for (const userId in backupData) {
                    if (backupData.hasOwnProperty(userId)) await setDoc(doc(db, "users", userId), backupData[userId]);
            }
            showToast("Fatto!", "✅"); setTimeout(() => location.reload(), 1500);
        } catch (err) { console.error(err); showToast("Backup non valido", "❌"); }
        document.getElementById('importFile').value = ''; 
    };
    reader.readAsText(file);
};

window.vibrate = (type) => { if (navigator.vibrate && type === 'light') navigator.vibrate(30); if (navigator.vibrate && type === 'heavy') navigator.vibrate([50, 50]); }
window.showToast = (msg, icon) => { const t = document.getElementById('toast'); document.getElementById('toast-text').innerText = msg; document.getElementById('toast-icon').innerText = icon || "ℹ️"; t.className = "show"; setTimeout(() => { t.className = t.className.replace("show", ""); }, 2500); }
window.hardReset = async () => { const code = prompt("Scrivi RESET:"); if(code === "RESET") { await deleteDoc(doc(db, "users", currentUser)); location.reload(); } };

function applyTheme(user) {
    const root = document.documentElement;
    if (user === 'flavio') { root.style.setProperty('--theme-color', '#ffca28'); root.style.setProperty('--theme-glow', 'rgba(255, 202, 40, 0.3)'); document.getElementById('avatar-initial').innerText = 'F'; document.getElementById('username-display').innerText = 'Flavio'; } 
    else { root.style.setProperty('--theme-color', '#d05ce3'); root.style.setProperty('--theme-glow', 'rgba(208, 92, 227, 0.3)'); document.getElementById('avatar-initial').innerText = 'S'; document.getElementById('username-display').innerText = 'Simona'; }
    document.getElementById('card-flavio').classList.remove('active'); document.getElementById('card-simona').classList.remove('active'); document.getElementById(`card-${user}`).classList.add('active');
}
window.switchUser = (u) => { if(currentUser === u) return; currentUser = u; localStorage.setItem('glp_user', u); applyTheme(u); vibrate('light'); location.reload(); }

async function logHistory(user, score) {
    const ref = doc(db, "users", user);
    const hist = globalData.history || [];
    hist.push({date: new Date().toISOString(), score});
    if(hist.length > 500) hist.shift();
    await updateDoc(ref, { history: hist });
}

function updateMultiChart() {
    const ctx = document.getElementById('progressChart').getContext('2d');
    const labels = []; const dates = [];
    for(let i=14; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
        labels.push(`${d.getDate()}/${d.getMonth()+1}`);
    }

    const getDailyNetPoints = (userData) => {
        if(!userData || !userData.dailyLogs) return new Array(15).fill(0);
        return dates.map(date => {
            const entry = userData.dailyLogs[date];
            if(!entry) return 0;
            
            let doneArr = [], failedArr = [], purchases = [];
            if (Array.isArray(entry)) { doneArr = entry; } 
            else { doneArr = entry.habits || []; failedArr = entry.failedHabits || []; purchases = entry.purchases || []; }
            
            let net = 0;
            doneArr.forEach(hId => {
                const hObj = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
                if(hObj) net += window.getItemValueAtDate(hObj, 'reward', date);
            });
            failedArr.forEach(hId => {
                const hObj = userData.habits.find(h => (h.id || h.name.replace(/[^a-zA-Z0-9]/g, '')) === hId);
                if(hObj) net -= window.getItemValueAtDate(hObj, 'penalty', date);
            });
            let spent = purchases.reduce((acc, p) => acc + parseInt(p.cost), 0);
            return net - spent;
        });
    };

    const flavioPoints = getDailyNetPoints(allUsersData.flavio);
    const simonaPoints = getDailyNetPoints(allUsersData.simona);

    if(chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line', 
        data: { labels, datasets: [
            { label: 'Flavio', data: flavioPoints, borderColor: '#ffca28', backgroundColor: 'rgba(255, 202, 40, 0.1)', fill:true, tension: 0.4, pointRadius: 4 },
            { label: 'Simona', data: simonaPoints, borderColor: '#d05ce3', backgroundColor: 'rgba(208, 92, 227, 0.1)', fill:true, tension: 0.4, pointRadius: 4 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#888' } } }, scales: { y: { grid: { color: '#333' }, ticks: { color: '#888' }, beginAtZero: true }, x: { grid: { display: false }, ticks: { color: '#888', maxTicksLimit: 8 } } } }
    });
}