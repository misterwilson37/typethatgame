// v1.1.0 - Corrections, Dynamic Keyboard, 30s Intervals
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.1.0";
const SESSION_LIMIT = 30; // Seconds before a break

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let mistakes = 0;
let startTime = null;
let activeSeconds = 0;
let sessionSeconds = 0; // Tracks the current 30s block
let lastActivityTime = 0;
let timerInterval = null;
let isGameActive = false;
let currentLetterHasError = false; // Tracks if current letter was missed once

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const storyImg = document.getElementById('story-img');
const imgPanel = document.getElementById('image-panel');

async function init() {
    const footer = document.querySelector('footer');
    if(footer) footer.innerText = `JS: v${VERSION}`;

    createKeyboard();
    signInAnonymously(auth).catch(console.error);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('user-info').innerText = "ID: " + user.uid.slice(0,5);
            loadChapter(1);
        }
    });
}

async function loadChapter(chapterNum) {
    const docRef = doc(db, "books", "wizard_of_oz", "chapters", "chapter_" + chapterNum);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        bookData = docSnap.data();
        setupGame();
    } else {
        textStream.innerHTML = "Error: Chapter not found. <a href='admin.html'>Run Admin Seed</a>";
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join(" ");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    renderText();
    
    // Show start modal
    showModal("Ready to Read?", "You will read in 30-second bursts.", "Start Reading", startGame);
}

function renderText() {
    textStream.innerHTML = '';
    const words = fullText.split(' ');
    let charCount = 0;

    words.forEach(word => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'word';
        for (let char of word) {
            const span = document.createElement('span');
            span.className = 'letter';
            span.innerText = char;
            span.dataset.index = charCount;
            wordSpan.appendChild(span);
            charCount++;
        }
        const spaceSpan = document.createElement('span');
        spaceSpan.className = 'letter';
        spaceSpan.innerHTML = '&nbsp;';
        wordSpan.appendChild(spaceSpan);
        charCount++;
        textStream.appendChild(wordSpan);
    });
}

// --- GAME LOOP ---
function startGame() {
    document.getElementById('modal').classList.add('hidden'); // Hide modal
    isGameActive = true;
    startTime = Date.now();
    lastActivityTime = Date.now();
    sessionSeconds = 0;
    
    focusOnCurrentChar();
    checkForImageUpdate(); // FIX: Check for image immediately on load
    centerView();
    setTimeout(centerView, 100); 

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 1000);
}

function gameTick() {
    if (!isGameActive) return;

    if (Date.now() - lastActivityTime <= 3000) {
        activeSeconds++;
        sessionSeconds++;
        
        const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
        const secs = (activeSeconds % 60).toString().padStart(2, '0');
        document.getElementById('timer-display').innerText = `${mins}:${secs}`;
        
        // 30 SECOND CHECK
        if (sessionSeconds >= SESSION_LIMIT) {
             pauseGameForBreak();
        }

        if (activeSeconds % 10 === 0) saveProgress();
    }

    const timeMins = (Date.now() - startTime) / 60000;
    const wpm = Math.round((currentCharIndex / 5) / timeMins) || 0;
    document.getElementById('wpm-display').innerText = wpm;
}

function pauseGameForBreak() {
    isGameActive = false;
    clearInterval(timerInterval);
    showModal("Great Job!", "You've completed a 30-second reading sprint.", "Continue", startGame);
}

document.addEventListener('keydown', (e) => {
    // SHIFT LOGIC (Global)
    if (e.key === "Shift") toggleKeyboardCase(true);
    
    if (!isGameActive) return;
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    if (e.key === " ") e.preventDefault();

    const targetChar = fullText[currentCharIndex];
    const letterEls = document.querySelectorAll('.letter');
    const currentEl = letterEls[currentCharIndex];

    lastActivityTime = Date.now();

    if (e.key === targetChar) {
        // CORRECT
        currentEl.classList.remove('active');
        currentEl.classList.remove('incorrect');
        
        // Blue vs Black logic
        if (currentLetterHasError) {
            currentEl.classList.add('fixed'); // Was wrong, now right
        } else {
            currentEl.classList.add('correct'); // Perfect
        }

        // Reset for next char
        currentLetterHasError = false;
        currentCharIndex++;
        
        if (currentCharIndex >= fullText.length) {
            finishChapter();
            return;
        }

        letterEls[currentCharIndex].classList.add('active');
        updateAccuracy();
        checkForImageUpdate();
        focusOnCurrentChar();
        centerView();
    } else {
        // MISTAKE
        mistakes++;
        currentLetterHasError = true; // Mark this specific letter as "tainted"
        
        currentEl.classList.add('incorrect');
        flashKey(e.key);
        updateAccuracy();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === "Shift") toggleKeyboardCase(false);
});

// --- UI HELPERS ---
function centerView() {
    const currentEl = document.querySelectorAll('.letter')[currentCharIndex];
    if (!currentEl) return;
    const container = document.getElementById('game-container');
    const offset = (container.offsetHeight / 2) - currentEl.offsetTop - 20;
    textStream.style.transform = `translateY(${offset}px)`;
}

function checkForImageUpdate() {
    // Determine segment based on progress % (Simple approximation for now)
    const progress = currentCharIndex / fullText.length;
    const segmentIndex = Math.floor(progress * bookData.segments.length);
    const segment = bookData.segments[segmentIndex];
    
    if (segment && segment.image) {
        storyImg.src = segment.image;
        imgPanel.style.display = 'block';
    } else {
        imgPanel.style.display = 'none';
    }
}

function updateAccuracy() {
    const total = currentCharIndex + mistakes;
    const acc = total === 0 ? 100 : Math.round((currentCharIndex / total) * 100);
    document.getElementById('acc-display').innerText = acc + "%";
}

async function saveProgress() {
    if (!currentUser) return;
    await setDoc(doc(db, "users", currentUser.uid), {
        activeSeconds: activeSeconds,
        lastUpdated: new Date()
    }, { merge: true });
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    saveProgress();
    showModal("Chapter Complete!", `Total active time: ${activeSeconds}s.`, "Play Again", () => location.reload());
}

function showModal(title, body, btnText, action) {
    // Note: Ensure your index.html has a generic modal structure or create it here
    // Re-using existing modal elements from index.html
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerText = body;
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = action;
    modal.classList.remove('hidden');
}

// --- KEYBOARD ENGINE ---
const keyMap = {
    row1: "`1234567890-=",
    row1_s: "~!@#$%^&*()_+",
    row2: "qwertyuiop[]\\",
    row2_s: "QWERTYUIOP{}|",
    row3: "asdfghjkl;'",
    row3_s: "ASDFGHJKL:\"",
    row4: "zxcvbnm,./",
    row4_s: "ZXCVBNM<>?"
};

function createKeyboard() {
    keyboardDiv.innerHTML = ''; 
    createRow(keyMap.row1, keyMap.row1_s);
    createRow(keyMap.row2, keyMap.row2_s, "TAB");
    createRow(keyMap.row3, keyMap.row3_s, "CAPS", "ENTER");
    createRow(keyMap.row4, keyMap.row4_s, "SHIFT", "SHIFT");
    
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kb-row';
    const space = document.createElement('div');
    space.className = 'key space';
    space.id = 'key- ';
    space.innerText = "SPACE";
    spaceRow.appendChild(space);
    keyboardDiv.appendChild(spaceRow);
}

function createRow(chars, shiftChars, leftSpecial, rightSpecial) {
    const row = document.createElement('div');
    row.className = 'kb-row';
    if (leftSpecial) addSpecialKey(row, leftSpecial);
    
    for (let i = 0; i < chars.length; i++) {
        const k = document.createElement('div');
        k.className = 'key';
        k.dataset.char = chars[i]; // Lowercase
        k.dataset.shift = shiftChars[i]; // Symbol/Upper
        k.id = `key-${chars[i]}`; 
        k.innerText = chars[i]; // Default to Lowercase
        row.appendChild(k);
    }
    if (rightSpecial) addSpecialKey(row, rightSpecial);
    keyboardDiv.appendChild(row);
}

function addSpecialKey(row, text) {
    const k = document.createElement('div');
    k.className = 'key wide';
    k.innerText = text;
    k.id = `key-${text}`;
    row.appendChild(k);
}

function toggleKeyboardCase(isShift) {
    document.querySelectorAll('.key').forEach(k => {
        if(k.dataset.char) {
            k.innerText = isShift ? k.dataset.shift : k.dataset.char;
        }
        if(k.id === 'key-SHIFT') {
            if(isShift) k.classList.add('shift-active');
            else k.classList.remove('shift-active');
        }
    });
}

function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));

    let targetId = '';
    let needsShift = false;

    if (char === ' ') targetId = 'key- ';
    else {
        // Find key by either char or shift-char
        const keyEl = Array.from(document.querySelectorAll('.key')).find(k => 
            k.dataset.char === char || k.dataset.shift === char
        );
        if (keyEl) {
            targetId = keyEl.id;
            if (keyEl.dataset.shift === char) needsShift = true;
        }
    }

    const el = document.getElementById(targetId);
    if (el) el.classList.add('target');
    
    if (needsShift) {
        document.querySelectorAll('#key-SHIFT').forEach(s => s.classList.add('target'));
        toggleKeyboardCase(true); // Visually shift the keyboard for the user
    } else {
        toggleKeyboardCase(false);
    }
}

function focusOnCurrentChar() {
    const char = fullText[currentCharIndex] || ' ';
    highlightKey(char);
}

function flashKey(char) {
    // Simple flash helper
    // Note: A robust implementation maps keys accurately; 
    // for MVP we just try to find the lowercase ID
    let id = `key-${char.toLowerCase()}`;
    const el = document.getElementById(id);
    if (el) {
        el.style.backgroundColor = 'var(--error-color)';
        setTimeout(() => el.style.backgroundColor = '', 200);
    }
}

init();
