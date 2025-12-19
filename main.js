// main.js
import { state, checkAndCreateUser, startListeners, modifyViewDate, setViewDate, getItemValueAtDate } from "./logic.js";
import { renderView, showToast } from "./ui.js";

// 1. Setup Iniziale
function applyTheme(user) {
    document.documentElement.style.setProperty('--theme-color', user === 'simona' ? '#d05ce3' : '#ffca28');
    document.documentElement.style.setProperty('--theme-glow', user === 'simona' ? 'rgba(208, 92, 227, 0.3)' : 'rgba(255, 202, 40, 0.3)');
    const avatar = document.getElementById('avatar-initial');
    if(avatar) {
        avatar.innerText = user.charAt(0).toUpperCase();
        document.getElementById('username-display').innerText = user.charAt(0).toUpperCase() + user.slice(1);
    }
}

async function initApp() {
    applyTheme(state.currentUser);
    await checkAndCreateUser('flavio');
    await checkAndCreateUser('simona');
    // Passiamo renderView come callback così logic.js può aggiornare la UI quando i dati cambiano
    startListeners(renderView, null); 
}

// 2. Esposizione Globale (Per far funzionare onclick nell'HTML)
window.changeDate = (days) => { 
    modifyViewDate(days); 
    renderView(); 
};

window.goToDate = (dateStr) => { 
    setViewDate(dateStr); 
    renderView(); 
};

window.showToast = showToast; // Espone il toast

window.openEditModal = (id, type) => {
    // Logica modale...
    console.log("Apertura modale per", id);
};

window.setHabitStatus = (id, status, cost) => {
    // Chiama logica di update su Firebase (da implementare in logic.js ed esportare)
    console.log("Cambio status", id, status);
    // await updateHabitStatus(...)
    // renderView();
};

window.switchUser = (user) => {
    if(user === state.currentUser) return;
    localStorage.setItem('glp_user', user);
    location.reload(); // Modo semplice per ricaricare tutto col nuovo utente
};

// Start
initApp();