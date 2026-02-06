// v1.2.6.3 - Syntax Fix & Stable Smart Timer
import { db, auth } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.2.6.3";
const SESSION_LIMIT = 30; 
const IDLE_THRESHOLD = 2000; // 2 seconds

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let mistakes = 0; 
let sprintMistakes = 0; 
let activeSeconds = 0; 
let sprintSeconds = 0; 
let sprintCharStart = 0; 
let timerInterval = null;
let isGameActive = false;
let isOvertime = false;
let isModalOpen = false;
let modalActionCallback = null;

// Smart Timer State
let lastInputTime = 0;
let timeAccumulator = 0; // Tracks milliseconds for precision

let wpmHistory = []; // Stores timestamps of recent keystrokes
let accuracyHistory = []; // Stores 1 (hit) or 0 (miss) for recent keys

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
    console.log("Initializing JS v" + VERSION);
    const footer = document.querySelector('footer');
    if(footer) footer.innerText = `JS: v${VERSION}`;
    
    createKeyboard();
    
    try {
        await signInAnonymously(auth);
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                loadChapter(1);
            }
        });
    } catch (e) {
        console.error("Auth Failed:", e);
        textStream.innerText = "Error loading game. Check console.";
    }
}

async function loadChapter(chapterNum) {
    try {
        const docRef = doc(db, "books", "wizard_of_oz", "chapters", "chapter_" + chapterNum);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            bookData = docSnap.data();
            setupGame();
        } else {
            textStream.innerHTML = "Error: Chapter not found.";
        }
    } catch (e) {
        console.error("Load Chapter Failed:", e);
        textStream.innerHTML = "Error loading chapter.";
    }
}

function setupGame() {
    // Sanitize text
    fullText = bookData.segments.map(s => s.text).join(" ");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    updateImageDisplay();
    
    // Initial Modal (No stats passed)
    showModal("Ready?", null, "Start (ENTER)", startGame);
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
        spaceSpan.className = 'letter space';
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
    
    // Reset Timer Logic
    activeSeconds = 0; 
    timeAccumulator = 0;
    lastInputTime = Date.now(); 
    
    // RESET WPM HISTORY
    wpmHistory = []; 
    accuracyHistory = [];
    wpmDisplay.innerText = "0"; // Start at 0
    
    timerDisplay.style.color = 'white'; 
    timerDisplay.style.opacity = '1';

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 100); 

    highlightCurrentChar();
    centerView();
}

function gameTick() {
    if (!isGameActive) return;

    const now = Date.now();
    
    // SMART TIMER: Only count if last input was within 2 seconds
    if (now - lastInputTime < IDLE_THRESHOLD) {
        timeAccumulator += 100; // Add 100ms
        timerDisplay.style.opacity = '1';

        // Every 1000ms (1 second), update the actual game clocks
        if (timeAccumulator >= 1000) {
            activeSeconds++;
            sprintSeconds++;
            timeAccumulator -= 1000;
            updateTimerUI();
        }
    } else {
        // IDLE MODE
        timerDisplay.style.opacity = '0.5';
    }
}

function updateTimerUI() {
    const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
    const secs = (activeSeconds % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;

    // REMOVED WPM CALCULATION FROM HERE
    // It is now handled by updateRunningWPM() on keypress

    if (sprintSeconds >= SESSION_LIMIT) {
        isOvertime = true;
        timerDisplay.style.color = '#FFA500'; 
    }
}

function pauseGameForBreak() {
    isGameActive = false;
    clearInterval(timerInterval); 
    
    // Calculate Stats
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
    
    showModal("Sprint Complete", stats, "Continue (ENTER)", startGame);
}

// --- INPUT ---
document.addEventListener('keydown', (e) => {
    // 1. MODAL CONTROL
    if (isModalOpen) {
        if (e.key === "Enter") {
            e.preventDefault();
            if (modalActionCallback) modalActionCallback();
        }
        return;
    }

    if (e.key === "Shift") toggleKeyboardCase(true);
    if (!isGameActive) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    if (e.key === " ") e.preventDefault(); 

    // UPDATE IDLE TIMESTAMP
    lastInputTime = Date.now();
    timerDisplay.style.opacity = '1';

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    // 2. BACKSPACE
    if (e.key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    // 3. CORRECT
    if (e.key === targetChar) {
        currentEl.classList.remove('active');
        currentEl.classList.remove('error-state');

        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect'); 
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed'); 
        else currentEl.classList.add('done-dirty'); 

        currentCharIndex++;
        currentLetterStatus = 'clean'; 

        updateRunningWPM();
        updateRunningAccuracy(true);
        
        // 4. STOP LOGIC (Quotes aware)
        if (isOvertime) {
            // Case A: Typed Punctuation (. ! ?)
            if (['.', '!', '?'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex];
                // If next is NOT a quote, stop.
                if (nextChar !== '"' && nextChar !== "'") {
                    triggerStop();
                    return;
                }
            }
            // Case B: Typed Closing Quote (" ')
            if (['"', "'"].includes(targetChar)) {
                 const prevChar = fullText[currentCharIndex - 2]; // -2 because index moved
                 if (['.', '!', '?'].includes(prevChar)) {
                    triggerStop();
                    return;
                 }
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
    // 5. MISTAKE
    else {
        mistakes++;
        sprintMistakes++; // Keep tracking these for the final report!
        
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        currentEl.classList.add('error-state'); 
        flashKey(e.key);
        
        updateRunningAccuracy(false); // <--- NEW: Record a Miss (0)
    }
});

function triggerStop() {
    updateImageDisplay();
    highlightCurrentChar();
    centerView();
    pauseGameForBreak();
}

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

function updateRunningWPM() {
    const now = Date.now();
    wpmHistory.push(now);

    // Increased buffer to 20 for smoother average
    if (wpmHistory.length > 20) {
        wpmHistory.shift();
    }

    // We need at least 2 keystrokes to measure a time difference
    if (wpmHistory.length > 1) {
        const timeDiffMs = now - wpmHistory[0];
        const timeDiffMin = timeDiffMs / 60000;
        
        // FIX: The Fencepost Error
        // We have 'length' timestamps, but that measures 'length - 1' intervals.
        // If we typed 20 chars, the timer measures the duration of the last 19 transitions.
        const chars = wpmHistory.length - 1; 
        
        // Prevent division by zero or negative time
        if (timeDiffMin > 0) {
            const wpm = Math.round((chars / 5) / timeDiffMin);
            wpmDisplay.innerText = wpm;
        }
    }
}

function updateRunningAccuracy(isCorrect) {
    // 1 = Correct, 0 = Mistake
    accuracyHistory.push(isCorrect ? 1 : 0);

    // Keep last 50 keystrokes
    if (accuracyHistory.length > 50) {
        accuracyHistory.shift();
    }

    const correctCount = accuracyHistory.filter(val => val === 1).length;
    const total = accuracyHistory.length;
    
    if (total > 0) {
        const acc = Math.round((correctCount / total) * 100);
        accDisplay.innerText = acc + "%";
    } else {
        accDisplay.innerText = "100%";
    }
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    
    // Calculate global accuracy for the final report
    const totalKeystrokes = currentCharIndex + mistakes;
    const finalAcc = totalKeystrokes === 0 ? 100 : Math.round((currentCharIndex / totalKeystrokes) * 100);

    showModal("Chapter Complete!", { 
        time: activeSeconds, 
        wpm: parseInt(wpmDisplay.innerText), // Ending speed
        acc: finalAcc                        // Total Session Accuracy
    }, "Play Again (ENTER)", () => location.reload());
}

// --- MODAL ---
function showModal(title, stats, btnText, action) {
    const modal = document.getElementById('modal');
    isModalOpen = true;
    modalActionCallback = action;
    
    document.getElementById('modal-title').innerText = title;
    
    let bodyHtml = '';
    if (stats) {
        bodyHtml = `
            <div class="stat-row">
                <div class="stat-item"><span>${stats.time}s</span>Sprint Time</div>
                <div class="stat-item"><span>${stats.wpm}</span>Sprint WPM</div>
                <div class="stat-item"><span>${stats.acc}%</span>Accuracy</div>
            </div>
        `;
    }
    document.getElementById('modal-body').innerHTML = bodyHtml;
    
    const btn = document.getElementById('action-btn');
    if(btn) {
        btn.innerText = btnText;
        btn.onclick = action;
    }
    
    modal.classList.remove('hidden');
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
    isModalOpen = false;
    modalActionCallback = null;
    
    // Reset Idle on Close so timer works immediately
    lastInputTime = Date.now();
    timerDisplay.style.opacity = '1';
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
