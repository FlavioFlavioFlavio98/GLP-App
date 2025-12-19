// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA001klzJou17djB76Q-t2eRTKbU9NZoQs",
    authDomain: "gamification-life-project.firebaseapp.com",
    projectId: "gamification-life-project",
    storageBucket: "gamification-life-project.firebasestorage.app",
    messagingSenderId: "925252547674",
    appId: "1:925252547674:web:1316a5d96cb54c0a515463"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);