// v1.6.0 - Custom Sprint Lengths & Open Mode
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.6.0";
const BOOK_ID = "wizard_of_oz"; 
const IDLE_THRESHOLD = 2000; 

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let savedCharIndex = 0; 
let lastSavedIndex = 0; 
let currentChapterNum = 1;

// Settings
let sessionLimit = 30; // Default 30 seconds, can be 'infinity'

// Time Stats State
let statsData = {
    secondsToday: 0,
    secondsWeek: 0,
    lastDate: "",
    weekStart: 0
};

// Game State
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

// Timer & Speed
let lastInputTime = 0;
let timeAccumulator = 0;
let wpmHistory = [];
let accuracyHistory = [];
let currentLetterStatus = 'clean'; 

// DOM Elements
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const storyImg = document.getElementById('story-img');
const imgPanel = document.getElementById('image-panel');
const timerDisplay = document.getElementById('timer-display');
const accDisplay = document.getElementById('acc-display');
const wpmDisplay = document.getElementById('wpm-display');

// Auth DOM
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userNameDisplay = document.getElementById('user-name');

async function init() {
    console.log("Initializing JS v" + VERSION);
    const footer = document.querySelector('footer');
    if(footer) footer.innerText = `JS: v${VERSION}`;
    
    storyImg.onerror = function() {
        imgPanel.style.display = 'none';
    };

    createKeyboard();
    setupAuthListeners();
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            updateAuthUI(true);
            await Promise.all([loadUserProgress(), loadUserStats()]);
        } else {
            signInAnonymously(auth);
        }
    });
}

function setupAuthListeners() {
    loginBtn.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Login failed", error);
            alert("Login failed: " + error.message);
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            location.reload(); 
        } catch (error) {
            console.error("Logout failed", error);
        }
    });
}

function updateAuthUI(isLoggedIn) {
    if (isLoggedIn && !currentUser.isAnonymous) {
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userNameDisplay.innerText = currentUser.displayName || "Reader";
    } else {
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
    }
}

// --- STATS SYSTEM ---
async function loadUserStats() {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; 
        const weekStart = getWeekStart(today); 

        const docRef = doc(db, "users", currentUser.uid, "stats", "time_tracking");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            statsData.secondsToday = (data.lastDate === dateStr) ? (data.secondsToday || 0) : 0;
            statsData.secondsWeek = (data.weekStart === weekStart) ? (data.secondsWeek || 0) : 0;
        } else {
            statsData.secondsToday = 0;
            statsData.secondsWeek = 0;
        }
        statsData.lastDate = dateStr;
        statsData.weekStart = weekStart;
    } catch (e) {
        console.warn("Stats Load Error:", e);
    }
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); 
    const diff = (day + 1) % 7; 
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d.getTime();
}

async function loadUserProgress() {
    textStream.innerHTML = "Loading progress...";
    try {
        const docRef = doc(db, "users", currentUser.uid, "progress", BOOK_ID);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentChapterNum = data.chapter || 1;
            savedCharIndex = data.charIndex || 0;
        } else {
            currentChapterNum = 1;
            savedCharIndex = 0;
        }
        lastSavedIndex = savedCharIndex; 
        loadChapter(currentChapterNum);
    } catch (e) {
        console.error("Load Progress Error:", e);
        loadChapter(1);
    }
}

async function loadChapter(chapterNum) {
    try {
        const docRef = doc(db, "books", BOOK_ID, "chapters", "chapter_" + chapterNum);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            bookData = docSnap.data();
            setupGame();
        } else {
            textStream.innerText = "Chapter not found.";
        }
    } catch (e) {
        console.error("Load Chapter Failed:", e);
        textStream.innerHTML = "Error loading chapter.";
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join(" ");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    currentCharIndex = savedCharIndex;
    
    if (fullText[currentCharIndex] === ' ') currentCharIndex++;

    if (currentCharIndex > 0) {
        for (let i = 0; i < currentCharIndex; i++) {
            const el = document.getElementById(`char-${i}`);
            if (el) {
                el.classList.remove('active');
                if (!el.classList.contains('space')) el.classList.add('done-perfect');
            }
        }
    }

    updateImageDisplay();
    highlightCurrentChar(); 
    centerView(); 
    
    let btnLabel = "Resume Reading";
    if (currentChapterNum === 1 && savedCharIndex === 0) btnLabel = "Start Reading";

    if (!isGameActive) {
        showStartModal(`Chapter ${currentChapterNum}`, btnLabel, startGame);
    }
}

async function saveProgress() {
    if (!currentUser) return;

    try {
        if (currentCharIndex > lastSavedIndex) {
            await setDoc(doc(db, "users", currentUser.uid, "progress", BOOK_ID), {
                chapter: currentChapterNum,
                charIndex: currentCharIndex,
                lastUpdated: new Date()
            }, { merge: true });
            lastSavedIndex = currentCharIndex;
        }

        await setDoc(doc(db, "users", currentUser.uid, "stats", "time_tracking"), {
            secondsToday: statsData.secondsToday,
            secondsWeek: statsData.secondsWeek,
            lastDate: statsData.lastDate,
            weekStart: statsData.weekStart
        }, { merge: true });
        
        console.log("Saved.");
    } catch (e) {
        console.warn("Save failed:", e);
    }
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
    // 1. Get Session Limit from Dropdown
    const select = document.getElementById('sprint-select');
    if (select) {
        const val = select.value;
        sessionLimit = (val === 'infinity') ? 'infinity' : parseInt(val);
    }

    closeModal();
    isGameActive = true;
    isOvertime = false;
    
    sprintSeconds = 0;
    sprintMistakes = 0;
    sprintCharStart = currentCharIndex; 
    
    activeSeconds = 0; 
    timeAccumulator = 0;
    lastInputTime = Date.now(); 
    
    wpmHistory = []; 
    accuracyHistory = [];
    accDisplay.innerText = "100%";
    wpmDisplay.innerText = "0";
    
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
    if (now - lastInputTime < IDLE_THRESHOLD) {
        timeAccumulator += 100;
        timerDisplay.style.opacity = '1';
        if (timeAccumulator >= 1000) {
            activeSeconds++;
            sprintSeconds++;
            statsData.secondsToday++;
            statsData.secondsWeek++;
            timeAccumulator -= 1000;
            updateTimerUI();
        }
    } else {
        timerDisplay.style.opacity = '0.5';
        wpmDisplay.innerText = "0"; 
        wpmHistory = []; 
    }
}

function updateTimerUI() {
    const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
    const secs = (activeSeconds % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;
    
    // Logic for turning timer Orange
    if (sessionLimit !== 'infinity' && sprintSeconds >= sessionLimit) {
        isOvertime = true;
        timerDisplay.style.color = '#FFA500'; 
    }
}

function updateRunningWPM() {
    const now = Date.now();
    wpmHistory.push(now);
    if (wpmHistory.length > 20) wpmHistory.shift();
    if (wpmHistory.length > 1) {
        const timeDiffMs = now - wpmHistory[0];
        const timeDiffMin = timeDiffMs / 60000;
        const chars = wpmHistory.length - 1; 
        if (timeDiffMin > 0) {
            const wpm = Math.round((chars / 5) / timeDiffMin);
            wpmDisplay.innerText = wpm;
        }
    }
}

function updateRunningAccuracy(isCorrect) {
    accuracyHistory.push(isCorrect ? 1 : 0);
    if (accuracyHistory.length > 50) accuracyHistory.shift();
    const correctCount = accuracyHistory.filter(val => val === 1).length;
    const total = accuracyHistory.length;
    if (total > 0) {
        accDisplay.innerText = Math.round((correctCount / total) * 100) + "%";
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

function pauseGameForBreak() {
    isGameActive = false;
    clearInterval(timerInterval); 
    saveProgress(); 

    const charsTyped = currentCharIndex - sprintCharStart;
    const minutes = sprintSeconds / 60;
    const sprintWPM = (minutes > 0) ? Math.round((charsTyped / 5) / minutes) : 0;
    const totalSprintKeystrokes = charsTyped + sprintMistakes;
    const sprintAcc = (totalSprintKeystrokes > 0) ? Math.round((charsTyped / totalSprintKeystrokes) * 100) : 100;

    const stats = { 
        time: sprintSeconds, 
        wpm: sprintWPM, 
        acc: sprintAcc,
        today: formatTime(statsData.secondsToday),
        week: formatTime(statsData.secondsWeek)
    };
    
    showEndModal("Sprint Complete", stats, "Continue (ENTER)", startGame);
}

document.addEventListener('keydown', (e) => {
    if (isModalOpen) {
        if (e.key === "Enter") { e.preventDefault(); if (modalActionCallback) modalActionCallback(); }
        return;
    }
    
    // --- ESCAPE KEY PAUSE ---
    if (e.key === "Escape" && isGameActive) {
        pauseGameForBreak();
        return;
    }

    if (e.key === "Shift") toggleKeyboardCase(true);
    if (!isGameActive) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    if (e.key === " ") e.preventDefault(); 

    lastInputTime = Date.now();
    timerDisplay.style.opacity = '1';

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    if (e.key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    if (e.key === targetChar) {
        currentEl.classList.remove('active');
        currentEl.classList.remove('error-state');
        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect'); 
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed'); 
        else currentEl.classList.add('done-dirty'); 

        currentCharIndex++;
        currentLetterStatus = 'clean'; 
        
        // Save Checks
        if (['.', '!', '?'].includes(targetChar)) saveProgress();
        else if (['"', "'"].includes(targetChar) && currentCharIndex >= 2) {
            const prevChar = fullText[currentCharIndex - 2];
            if (['.', '!', '?'].includes(prevChar)) saveProgress();
        }

        updateRunningWPM();
        updateRunningAccuracy(true);

        // --- OVERTIME LOGIC (Only if not Infinite) ---
        if (isOvertime) {
            if (['.', '!', '?'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex]; 
                if (nextChar !== '"' && nextChar !== "'") { triggerStop(); return; }
            }
            if (['"', "'"].includes(targetChar)) {
                 const prevChar = fullText[currentCharIndex - 2]; 
                 if (['.', '!', '?'].includes(prevChar)) { triggerStop(); return; }
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
    else {
        mistakes++;
        sprintMistakes++;
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        currentEl.classList.add('error-state'); 
        flashKey(e.key);
        updateRunningAccuracy(false);
    }
});

function triggerStop() {
    updateImageDisplay();
    highlightCurrentChar();
    centerView();
    pauseGameForBreak();
}

document.addEventListener('keyup', (e) => { if (e.key === "Shift") toggleKeyboardCase(false); });

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
        const currentSrc = storyImg.getAttribute('src');
        if (currentSrc !== segment.image) {
            storyImg.src = segment.image;
            imgPanel.style.display = 'block';
        }
    } else {
        imgPanel.style.display = 'none';
    }
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    saveProgress();
    
    // Check if we need to load next chapter (not implemented yet, but placeholder)
    const stats = { 
        time: sprintSeconds, 
        wpm: parseInt(wpmDisplay.innerText), 
        acc: parseInt(accDisplay.innerText),
        today: formatTime(statsData.secondsToday),
        week: formatTime(statsData.secondsWeek)
    };
    showEndModal("Chapter Complete!", stats, "Play Again", () => location.reload());
}

// --- MODAL VARIATIONS ---

// 1. Start Modal (Has Dropdown)
function showStartModal(title, btnText, action) {
    const modal = document.getElementById('modal');
    isModalOpen = true;
    modalActionCallback = action;
    
    document.getElementById('modal-title').innerText = title;
    
    // Inject Dropdown
    document.getElementById('modal-body').innerHTML = `
        <div style="margin-bottom: 20px;">
            <label for="sprint-select" style="color:#aaa; font-size:0.9rem; display:block; margin-bottom:5px;">Session Length</label>
            <select id="sprint-select" style="background:#333; color:white; border:1px solid #555; padding:8px; border-radius:5px; width:100%; font-family:inherit;">
                <option value="30">30 Seconds</option>
                <option value="60">1 Minute</option>
                <option value="120">2 Minutes</option>
                <option value="300">5 Minutes</option>
                <option value="infinity">Open Ended (∞)</option>
            </select>
        </div>
        <p style="font-size:0.8rem; color:#777;">Press <b>ESC</b> anytime to pause.</p>
    `;

    const btn = document.getElementById('action-btn');
    if(btn) { btn.innerText = btnText; btn.onclick = action; }
    modal.classList.remove('hidden');
}

// 2. End Modal (Has Stats, No Dropdown)
function showEndModal(title, stats, btnText, action) {
    const modal = document.getElementById('modal');
    isModalOpen = true;
    modalActionCallback = action;
    document.getElementById('modal-title').innerText = title;
    
    let bodyHtml = `
            <div class="stat-row">
                <div class="stat-item"><span>${stats.time}s</span>Sprint</div>
                <div class="stat-item"><span>${stats.wpm}</span>WPM</div>
                <div class="stat-item"><span>${stats.acc}%</span>Acc</div>
            </div>
            <div style="margin-top:20px; font-size: 0.9em; color:#555;">
                <p>Today: <b>${stats.today}</b> | This Week: <b>${stats.week}</b></p>
            </div>`;
            
    document.getElementById('modal-body').innerHTML = bodyHtml;
    
    const btn = document.getElementById('action-btn');
    if(btn) { btn.innerText = btnText; btn.onclick = action; }
    modal.classList.remove('hidden');
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
    isModalOpen = false;
    modalActionCallback = null;
    lastInputTime = Date.now();
    timerDisplay.style.opacity = '1';
}

const keyMap = { row1: "`1234567890-=", row1_s: "~!@#$%^&*()_+", row2: "qwertyuiop[]\\", row2_s: "QWERTYUIOP{}|", row3: "asdfghjkl;'", row3_s: "ASDFGHJKL:\"", row4: "zxcvbnm,./", row4_s: "ZXCVBNM<>?" };
function createKeyboard() { keyboardDiv.innerHTML = ''; createRow(keyMap.row1, keyMap.row1_s); createRow(keyMap.row2, keyMap.row2_s, "TAB"); createRow(keyMap.row3, keyMap.row3_s, "CAPS", "ENTER"); createRow(keyMap.row4, keyMap.row4_s, "SHIFT", "SHIFT"); const spaceRow = document.createElement('div'); spaceRow.className = 'kb-row'; const space = document.createElement('div'); space.className = 'key space'; space.id = 'key- '; space.innerText = "SPACE"; spaceRow.appendChild(space); keyboardDiv.appendChild(spaceRow); }
function createRow(chars, shiftChars, leftSpecial, rightSpecial) { const row = document.createElement('div'); row.className = 'kb-row'; if (leftSpecial) addSpecialKey(row, leftSpecial); for (let i = 0; i < chars.length; i++) { const k = document.createElement('div'); k.className = 'key'; k.dataset.char = chars[i]; k.dataset.shift = shiftChars[i]; k.id = `key-${chars[i]}`; k.innerText = chars[i]; row.appendChild(k); } if (rightSpecial) addSpecialKey(row, rightSpecial); keyboardDiv.appendChild(row); }
function addSpecialKey(row, text) { const k = document.createElement('div'); k.className = 'key wide'; k.innerText = text; k.id = `key-${text}`; row.appendChild(k); }
function toggleKeyboardCase(isShift) { document.querySelectorAll('.key').forEach(k => { if(k.dataset.char) k.innerText = isShift ? k.dataset.shift : k.dataset.char; if(k.id === 'key-SHIFT') isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active'); }); }
function highlightKey(char) { document.querySelectorAll('.key').forEach(k => k.classList.remove('target')); let targetId = ''; let needsShift = false; if (char === ' ') targetId = 'key- '; else { const keyEl = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.char === char || k.dataset.shift === char); if (keyEl) { targetId = keyEl.id; if (keyEl.dataset.shift === char) needsShift = true; } } const el = document.getElementById(targetId); if (el) el.classList.add('target'); needsShift ? toggleKeyboardCase(true) : toggleKeyboardCase(false); }
function flashKey(char) { let id = `key-${char.toLowerCase()}`; const el = document.getElementById(id); if (el) { el.style.backgroundColor = 'var(--brute-force-color)'; setTimeout(() => el.style.backgroundColor = '', 200); } }

init();
