// v1.3 - Admin Editor with Strict Cleaning & Footer
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.3";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const saveBtn = document.getElementById('save-btn');
const footerEl = document.getElementById('admin-footer');

// Init
if(footerEl) footerEl.innerText = `Admin JS: v${ADMIN_VERSION}`;

// 1. Auth Listener
onAuthStateChanged(auth, (user) => {
    if (user) {
        statusEl.innerText = "Logged in as: " + user.email;
        statusEl.style.borderColor = "#00ff41"; 
        loginSec.classList.add('hidden');
        editorSec.classList.remove('hidden');
    } else {
        statusEl.innerText = "Access Restricted. Please log in.";
        statusEl.style.borderColor = "#ff3333"; 
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

// 3. Save Chapter Action (WITH CLEANING)
saveBtn.onclick = async () => {
    const bookId = document.getElementById('book-id').value.trim();
    const chapNum = document.getElementById('chap-num').value.trim();
    const jsonStr = document.getElementById('json-content').value.trim();

    if (!bookId || !chapNum || !jsonStr) {
        alert("Please fill in all fields.");
        return;
    }

    try {
        // Validate & Clean JSON
        const data = JSON.parse(jsonStr);
        
        if (data.segments && Array.isArray(data.segments)) {
            data.segments.forEach(seg => {
                if (seg.text) {
                    // 1. Remove double spaces
                    seg.text = seg.text.replace(/\s\s+/g, ' ');
                    
                    // 2. Trim whitespace
                    seg.text = seg.text.trim();
                    
                    // 3. Ensure Tab at start (for indent)
                    if (!seg.text.startsWith('\t')) {
                        seg.text = '\t' + seg.text;
                    }
                }
            });
            
            // Update the text area to show the cleaned version
            document.getElementById('json-content').value = JSON.stringify(data, null, 2);
        }
        
        statusEl.innerText = `Saving Chapter ${chapNum}...`;
        
        // Write to Firestore
        await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), data);
        
        statusEl.innerText = `Success! Chapter ${chapNum} saved (Cleaned & Formatted).`;
        statusEl.style.borderColor = "#00ff41";
        
    } catch (e) {
        console.error(e);
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
};
