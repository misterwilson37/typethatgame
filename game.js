// v1.2.1 - Overtime Mode (Finish Sentence)
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.2.1";
const SESSION_LIMIT = 30; 

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let mistakes = 0;
let activeSeconds = 0;
let sessionSeconds = 0;
let timerInterval = null;
let isGameActive = false;
let isOvertime = false; // New Flag

// Logic Flags
let currentLetterStatus = 'clean'; 

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const storyImg = document.getElementById('story-img');
const imgPanel = document.getElementById('image-panel');
const timerDisplay = document.getElementById('timer-display');

async function init() {
    const footer = document.querySelector('footer');
    if(footer) footer.innerText = `JS: v${VERSION}`;
    createKeyboard();
    signInAnonymously(auth).catch(console.error);
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
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
        textStream.innerHTML = "Error: Chapter not found.";
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join(" ");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    renderText();
    updateImageDisplay();
    showModal("Ready?", "30-second bursts. Finish your sentence when time is up!", "Start", startGame);
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
            span.id = `char-${charCount}`;
            span.dataset.index = charCount;
            wordSpan.appendChild(span);
            charCount++;
        }
        const spaceSpan = document.createElement('span');
        spaceSpan.className = 'letter';
        spaceSpan.innerText = ' '; 
        spaceSpan.id = `char-${charCount}`;
        wordSpan.appendChild(spaceSpan);
        charCount++;
        textStream.appendChild(wordSpan);
    });
}

function startGame() {
    document.getElementById('modal').classList.add('hidden');
    isGameActive = true;
    isOvertime = false;
    sessionSeconds = 0;
    
    // Reset Timer Visuals
    timerDisplay.style.color = 'white'; 
    
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 1000);

    highlightCurrentChar();
    centerView();
}

function gameTick() {
    if (!isGameActive) return;

    activeSeconds++;
    sessionSeconds++;

    const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
    const secs = (activeSeconds % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;

    // WPM
    const wpm = Math.round((currentCharIndex / 5) / (activeSeconds / 60)) || 0;
    document.getElementById('wpm-display').innerText = wpm;

    // Check for Overtime
    if (sessionSeconds >= SESSION_LIMIT) {
        isOvertime = true;
        timerDisplay.style.color = '#FFA500'; // Turn Orange
    }
}

function pauseGameForBreak() {
    isGameActive = false;
    clearInterval(timerInterval);
    showModal("Time's Up!", "Take a breath.", "Continue", startGame);
}

// --- CORE TYPING LOGIC ---
document.addEventListener('keydown', (e) => {
    if (e.key === "Shift") toggleKeyboardCase(true);
    if (!isGameActive) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    if (e.key === " ") e.preventDefault(); 

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    // 1. BACKSPACE LOGIC
    if (e.key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    // 2. CORRECT KEY LOGIC
    if (e.key === targetChar) {
        currentEl.classList.remove('active');
        currentEl.classList.remove('error-state');

        // Apply Color
        if (currentLetterStatus === 'clean') {
            currentEl.classList.add('done-perfect'); 
        } else if (currentLetterStatus === 'fixed') {
            currentEl.classList.add('done-fixed'); 
        } else {
            currentEl.classList.add('done-dirty'); 
        }

        currentCharIndex++;
        currentLetterStatus = 'clean'; 

        // CHECK OVERTIME STOP
        // If we are in overtime AND we just typed a sentence ender
        if (isOvertime && ['.', '!', '?'].includes(targetChar)) {
            // Update UI one last time before pausing so the user sees the character
            highlightCurrentChar();
            centerView();
            pauseGameForBreak();
            return;
        }

        if (currentCharIndex >= fullText.length) {
            finishChapter();
            return;
        }

        highlightCurrentChar();
        centerView();
        updateImageDisplay();
    } 
    // 3. WRONG KEY LOGIC
    else {
        mistakes++;
        if (currentLetterStatus === 'clean') {
            currentLetterStatus = 'error';
        }
        currentEl.classList.add('error-state'); 
        flashKey(e.key);
    }
    
    updateAccuracy();
});

document.addEventListener('keyup', (e) => {
    if (e.key === "Shift") toggleKeyboardCase(false);
});

// --- CENTERING ENGINE ---
function centerView() {
    const currentEl = document.getElementById(`char-${currentCharIndex}`);
    if (!currentEl) return;

    const container = document.getElementById('game-container');
    const containerHeight = container.clientHeight; 
    const letterTop = currentEl.offsetTop; 
    const offset = (containerHeight / 2) - letterTop - 20;

    textStream.style.transform = `translateY(${offset}px)`;
}

function highlightCurrentChar() {
    const el = document.getElementById(`char-${currentCharIndex}`);
    if (el) {
        el.classList.add('active');
        const char = fullText[currentCharIndex];
        highlightKey(char);
    }
}

function updateImageDisplay() {
    const progress = currentCharIndex / fullText.length;
    const segmentIndex = Math.floor(progress * bookData.segments.length);
    const segment = bookData.segments[segmentIndex];
    if (segment && segment.image) {
        storyImg.src = segment.image;
        imgPanel.style.display = 'block';
    } 
}

function updateAccuracy() {
    const total = currentCharIndex + mistakes;
    const acc = total === 0 ? 100 : Math.round((currentCharIndex / total) * 100);
    document.getElementById('acc-display').innerText = acc + "%";
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    showModal("Chapter Complete!", `Time: ${activeSeconds}s`, "Again", () => location.reload());
}

function showModal(title, body, btnText, action) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerText = body;
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = action;
    modal.classList.remove('hidden');
}

// --- KEYBOARD ---
const keyMap = {
    row1: "`1234567890-=", row1_s: "~!@#$%^&*()_+",
    row2: "qwertyuiop[]\\", row2_s: "QWERTYUIOP{}|",
    row3: "asdfghjkl;'", row3_s: "ASDFGHJKL:\"",
    row4: "zxcvbnm,./", row4_s: "ZXCVBNM<>?"
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
    space.className = 'key space'; space.id = 'key- '; space.innerText = "SPACE";
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
        k.dataset.char = chars[i]; k.dataset.shift = shiftChars[i];
        k.id = `key-${chars[i]}`; k.innerText = chars[i]; 
        row.appendChild(k);
    }
    if (rightSpecial) addSpecialKey(row, rightSpecial);
    keyboardDiv.appendChild(row);
}
function addSpecialKey(row, text) {
    const k = document.createElement('div'); k.className = 'key wide'; k.innerText = text; k.id = `key-${text}`; row.appendChild(k);
}
function toggleKeyboardCase(isShift) {
    document.querySelectorAll('.key').forEach(k => {
        if(k.dataset.char) k.innerText = isShift ? k.dataset.shift : k.dataset.char;
        if(k.id === 'key-SHIFT') isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active');
    });
}
function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));
    let targetId = ''; let needsShift = false;
    if (char === ' ') targetId = 'key- ';
    else {
        const keyEl = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.char === char || k.dataset.shift === char);
        if (keyEl) { targetId = keyEl.id; if (keyEl.dataset.shift === char) needsShift = true; }
    }
    const el = document.getElementById(targetId);
    if (el) el.classList.add('target');
    needsShift ? toggleKeyboardCase(true) : toggleKeyboardCase(false);
}
function flashKey(char) {
    let id = `key-${char.toLowerCase()}`;
    const el = document.getElementById(id);
    if (el) { el.style.backgroundColor = 'var(--brute-force-color)'; setTimeout(() => el.style.backgroundColor = '', 200); }
}

init();
