// v1.1 - Universal Admin Editor
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const saveBtn = document.getElementById('save-btn');

// 1. Auth Listener
onAuthStateChanged(auth, (user) => {
    if (user) {
        statusEl.innerText = "Logged in as: " + user.email;
        statusEl.style.borderColor = "#00ff41"; // Green indicator
        loginSec.classList.add('hidden');
        editorSec.classList.remove('hidden');
    } else {
        statusEl.innerText = "Access Restricted. Please log in.";
        statusEl.style.borderColor = "#ff3333"; // Red indicator
        loginSec.classList.remove('hidden');
        editorSec.classList.add('hidden');
    }
});

// 2. Login Action
loginBtn.onclick = async () => {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
        alert("Login Error: " + e.message);
    }
};

// 3. Save Chapter Action
saveBtn.onclick = async () => {
    const bookId = document.getElementById('book-id').value.trim();
    const chapNum = document.getElementById('chap-num').value.trim();
    const jsonStr = document.getElementById('json-content').value.trim();

    if (!bookId || !chapNum || !jsonStr) {
        alert("Please fill in all fields.");
        return;
    }

    try {
        // Validate JSON before sending
        const data = JSON.parse(jsonStr);
        
        statusEl.innerText = `Saving Chapter ${chapNum}...`;
        
        // Write to Firestore
        await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), data);
        
        statusEl.innerText = `Success! Chapter ${chapNum} saved to database.`;
        statusEl.style.borderColor = "#00ff41";
        
    } catch (e) {
        console.error(e);
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
        alert("Save Failed. Check console for details.");
    }
};
