// v1.2.3 - Space Logic, Stats, & Overtime Fix
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.2.3";
const SESSION_LIMIT = 30; // Seconds

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let mistakes = 0; // Total
let sprintMistakes = 0; // Current sprint
let activeSeconds = 0; // Total
let sprintSeconds = 0; // Current sprint
let sprintCharStart = 0; // Where this sprint started
let timerInterval = null;
let isGameActive = false;
let isOvertime = false;
let isModalOpen = false;
let modalActionCallback = null;

// Letter Status
let currentLetterStatus = 'clean'; 

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const storyImg = document.getElementById('story-img');
const imgPanel = document.getElementById('image-panel');
const timerDisplay = document.getElementById('timer-display');
const accDisplay = document.getElementById('acc-display');
const wpmDisplay = document.getElementById('wpm-display');

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
    // Use a custom object for the initial stats to show zeroes
    showModal("Ready to Read?", { time: 0, wpm: 0, acc: 100 }, "Start (Space)", startGame);
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
        spaceSpan.className = 'letter space'; // Added 'space' class
        spaceSpan.innerText = ' '; 
        spaceSpan.id = `char-${charCount}`;
        wordSpan.appendChild(spaceSpan);
        charCount++;
        textStream.appendChild(wordSpan);
    });
}

function startGame() {
    closeModal();
    isGameActive = true;
    isOvertime = false;
    
    // Reset Sprint Stats
    sprintSeconds = 0;
    sprintMistakes = 0;
    sprintCharStart = currentCharIndex;
    
    timerDisplay.style.color = 'white'; 
    
    // Safety clear
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 1000);

    highlightCurrentChar();
    centerView();
}

function gameTick() {
    if (!isGameActive) return;

    activeSeconds++;
    sprintSeconds++;

    // Format Total Time
    const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
    const secs = (activeSeconds % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;

    // Live WPM (Total Average)
    const wpm = Math.round((currentCharIndex / 5) / (activeSeconds / 60)) || 0;
    wpmDisplay.innerText = wpm;

    // Overtime Check
    if (sprintSeconds >= SESSION_LIMIT) {
        isOvertime = true;
        timerDisplay.style.color = '#FFA500'; // Orange
    }
}

function pauseGameForBreak() {
    isGameActive = false;
    clearInterval(timerInterval); // STOP THE CLOCK
    
    // Calculate Sprint Stats
    const charsTyped = currentCharIndex - sprintCharStart;
    const minutes = sprintSeconds / 60;
    const sprintWPM = (minutes > 0) ? Math.round((charsTyped / 5) / minutes) : 0;
    
    const totalSprintKeystrokes = charsTyped + sprintMistakes;
    const sprintAcc = (totalSprintKeystrokes > 0) 
        ? Math.round((charsTyped / totalSprintKeystrokes) * 100) 
        : 100;

    const stats = {
        time: sprintSeconds,
        wpm: sprintWPM,
        acc: sprintAcc
    };
    
    showModal("Sprint Complete", stats, "Continue (Space)", startGame);
}

// --- INPUT ---
document.addEventListener('keydown', (e) => {
    // MODAL CONTROL
    if (isModalOpen) {
        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (modalActionCallback) modalActionCallback();
        }
        return;
    }

    if (e.key === "Shift") toggleKeyboardCase(true);
    if (!isGameActive) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    if (e.key === " ") e.preventDefault(); 

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    // BACKSPACE
    if (e.key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    // CORRECT
    if (e.key === targetChar) {
        currentEl.classList.remove('active');
        currentEl.classList.remove('error-state');

        // Color Logic
        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect'); 
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed'); // Blue
        else currentEl.classList.add('done-dirty'); // Red

        currentCharIndex++;
        currentLetterStatus = 'clean'; 

        // OVERTIME STOP LOGIC
        if (isOvertime) {
            // Check if the character we JUST typed was punctuation
            if (['.', '!', '?'].includes(targetChar)) {
                updateImageDisplay();
                highlightCurrentChar();
                centerView();
                pauseGameForBreak();
                return;
            }
        }

        if (currentCharIndex >= fullText.length) {
            finishChapter();
            return;
        }

        highlightCurrentChar();
        centerView();
        updateImageDisplay();
    } 
    // MISTAKE
    else {
        mistakes++;
        sprintMistakes++;
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        currentEl.classList.add('error-state'); 
        flashKey(e.key);
    }
    
    updateAccuracy();
});

document.addEventListener('keyup', (e) => {
    if (e.key === "Shift") toggleKeyboardCase(false);
});

// --- CENTERING ---
function centerView() {
    const currentEl = document.getElementById(`char-${currentCharIndex}`);
    if (!currentEl) return;
    const container = document.getElementById('game-container');
    const offset = (container.clientHeight / 2) - currentEl.offsetTop - 25; 
    textStream.style.transform = `translateY(${offset}px)`;
}

function highlightCurrentChar() {
    const el = document.getElementById(`char-${currentCharIndex}`);
    if (el) {
        el.classList.add('active');
        highlightKey(fullText[currentCharIndex]);
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
    accDisplay.innerText = acc + "%";
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    showModal("Chapter Complete!", { time: activeSeconds, wpm: parseInt(wpmDisplay.innerText), acc: parseInt(accDisplay.innerText) }, "Play Again", () => location.reload());
}

// --- MODAL ---
function showModal(title, stats, btnText, action) {
    const modal = document.getElementById('modal');
    isModalOpen = true;
    modalActionCallback = action;
    
    document.getElementById('modal-title').innerText = title;
    
    // Construct Stats HTML
    let bodyHtml = '';
    if (stats) {
        bodyHtml = `
            <div class="stat-row">
                <div class="stat-item"><span>${stats.time}s</span>Time</div>
                <div class="stat-item"><span>${stats.wpm}</span>WPM</div>
                <div class="stat-item"><span>${stats.acc}%</span>Acc</div>
            </div>
        `;
    }
    document.getElementById('modal-body').innerHTML = bodyHtml;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = action;
    
    modal.classList.remove('hidden');
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
    isModalOpen = false;
    modalActionCallback = null;
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
    const row = document.createElement('div'); row.className = 'kb-row';
    if (leftSpecial) addSpecialKey(row, leftSpecial);
    for (let i = 0; i < chars.length; i++) {
        const k = document.createElement('div'); k.className = 'key';
        k.dataset.char = chars[i]; k.dataset.shift = shiftChars[i];
        k.id = `key-${chars[i]}`; k.innerText = chars[i]; row.appendChild(k);
    }
    if (rightSpecial) addSpecialKey(row, rightSpecial);
    keyboardDiv.appendChild(row);
}
function addSpecialKey(row, text) { const k = document.createElement('div'); k.className = 'key wide'; k.innerText = text; k.id = `key-${text}`; row.appendChild(k); }
function toggleKeyboardCase(isShift) { document.querySelectorAll('.key').forEach(k => { if(k.dataset.char) k.innerText = isShift ? k.dataset.shift : k.dataset.char; if(k.id === 'key-SHIFT') isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active'); }); }
function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));
    let targetId = ''; let needsShift = false;
    if (char === ' ') targetId = 'key- ';
    else { const keyEl = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.char === char || k.dataset.shift === char); if (keyEl) { targetId = keyEl.id; if (keyEl.dataset.shift === char) needsShift = true; } }
    const el = document.getElementById(targetId); if (el) el.classList.add('target');
    needsShift ? toggleKeyboardCase(true) : toggleKeyboardCase(false);
}
function flashKey(char) { let id = `key-${char.toLowerCase()}`; const el = document.getElementById(id); if (el) { el.style.backgroundColor = 'var(--brute-force-color)'; setTimeout(() => el.style.backgroundColor = '', 200); } }

init();
