// logic.js
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// --- STATE MANAGEMENT ---
export const state = {
    currentUser: localStorage.getItem('glp_user') || 'flavio',
    globalData: null,
    allUsersData: { flavio: null, simona: null },
    viewDate: new Date(),
    // Altri stati temporanei
    editingItem: null,
    editingType: null,
    recurMode: 'recur'
};

// Funzione helper per aggiornare la data
export function modifyViewDate(days) {
    state.viewDate.setDate(state.viewDate.getDate() + days);
}
export function setViewDate(dateStr) {
    if(dateStr) state.viewDate = new Date(dateStr);
}
export function getDateString(date) { 
    return date.toISOString().split('T')[0]; 
}

// --- CORE BUSINESS LOGIC ---

// CRUCIALE: Helper per il Time Travel (Preservato intatto)
export function getItemValueAtDate(item, field, dateStr) {
    // Se non c'è storico, ritorna il valore base
    if (!item.changes || item.changes.length === 0) {
        if(field === 'isMulti') return item.isMulti || false;
        if(field === 'description') return item.description || "";
        return parseInt(item[field] || 0);
    }
    // Ordina lo storico
    const sortedChanges = item.changes.slice().sort((a, b) => a.date.localeCompare(b.date));
    let validChange = null;
    
    // Trova l'ultima modifica valida prima o durante la data richiesta
    for (let change of sortedChanges) {
        if (change.date <= dateStr) validChange = change; else break;
    }
    
    if (validChange) {
        if(field === 'isMulti') return validChange.isMulti || false;
        if(field === 'description') return validChange.description || "";
        return parseInt(validChange[field] || 0);
    }
    // Fallback
    if(sortedChanges.length > 0) {
         if(field === 'isMulti') return sortedChanges[0].isMulti || false;
         if(field === 'description') return sortedChanges[0].description || "";
         return parseInt(sortedChanges[0][field] || 0);
    }
    return 0;
}

// Inizializzazione Utenti
export async function checkAndCreateUser(user) {
    const ref = doc(db, "users", user);
    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            await setDoc(ref, { score: 0, habits: [], rewards: [], history: [], dailyLogs: {}, tags: [], lastLogin: new Date().toDateString() });
        }
    } catch (e) { console.error("Err init:", e); }
}

// Listener Data (Nota: renderViewCallback sarà passata dal main/ui)
export function startListeners(renderViewCallback, updateChartCallback) {
    ['flavio', 'simona'].forEach(u => {
        onSnapshot(doc(db, "users", u), (d) => {
            if(d.exists()) {
                const userData = d.data();
                state.allUsersData[u] = userData;
                
                // Aggiorna UI immediata se presente
                const scoreEl = document.getElementById(`score-${u}`);
                if(scoreEl) scoreEl.innerText = userData.score;

                if(u === state.currentUser) { 
                    state.globalData = userData; 
                    if(renderViewCallback) renderViewCallback(); 
                }
                if(updateChartCallback) updateChartCallback();
            }
        });
    });
}