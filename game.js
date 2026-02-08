// v1.9.2.2 - Fixed Finish Chapter Stats & Cleanup
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.9.2.2";
const BOOK_ID = "wizard_of_oz"; 
const IDLE_THRESHOLD = 2000; 
const SPRINT_COOLDOWN_MS = 1500; 

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let savedCharIndex = 0; 
let lastSavedIndex = 0; 
let currentChapterNum = 1;

// Settings
let sessionLimit = 30; 
let sessionValueStr = "30"; 

// Time Stats State
let statsData = { 
    secondsToday: 0, secondsWeek: 0, 
    charsToday: 0, charsWeek: 0,
    mistakesToday: 0, mistakesWeek: 0,
    lastDate: "", weekStart: 0 
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
let isInputBlocked = false; 
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
    
    if (!document.getElementById('menu-btn')) {
        const btn = document.createElement('button');
        btn.id = 'menu-btn';
        btn.innerHTML = '&#9881;'; 
        btn.onclick = openMenuModal;
        document.body.appendChild(btn);
    }
    
    storyImg.onerror = function() { imgPanel.style.display = 'none'; };

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
        try { await signInWithPopup(auth, provider); } 
        catch (error) { alert("Login failed: " + error.message); }
    });
    logoutBtn.addEventListener('click', async () => {
        try { await signOut(auth); location.reload(); } 
        catch (error) { console.error("Logout failed", error); }
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

// --- DATA ---
async function loadUserStats() {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; 
        const weekStart = getWeekStart(today); 
        const docRef = doc(db, "users", currentUser.uid, "stats", "time_tracking");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Load or Reset Daily
            if (data.lastDate === dateStr) {
                statsData.secondsToday = data.secondsToday || 0;
                statsData.charsToday = data.charsToday || 0;
                statsData.mistakesToday = data.mistakesToday || 0;
            } else {
                statsData.secondsToday = 0;
                statsData.charsToday = 0;
                statsData.mistakesToday = 0;
            }
            
            // Load or Reset Weekly
            if (data.weekStart === weekStart) {
                statsData.secondsWeek = data.secondsWeek || 0;
                statsData.charsWeek = data.charsWeek || 0;
                statsData.mistakesWeek = data.mistakesWeek || 0;
            } else {
                statsData.secondsWeek = 0;
                statsData.charsWeek = 0;
                statsData.mistakesWeek = 0;
            }
        }
        statsData.lastDate = dateStr;
        statsData.weekStart = weekStart;
    } catch (e) { console.warn("Stats Load Error:", e); }
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
    textStream.innerHTML = `Loading Chapter ${chapterNum}...`;
    try {
        const docRef = doc(db, "books", BOOK_ID, "chapters", "chapter_" + chapterNum);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            bookData = docSnap.data();
            currentChapterNum = chapterNum;
            setupGame();
        } else {
            if(chapterNum > 1) {
                alert(`Chapter ${chapterNum} not found. Returning to start.`);
                currentChapterNum = 1;
                savedCharIndex = 0;
                loadChapter(1);
            } else {
                textStream.innerText = "Chapter 1 not found.";
            }
        }
    } catch (e) {
        textStream.innerHTML = "Error loading chapter.";
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join("\n");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    currentCharIndex = savedCharIndex;
    
    // Auto-advance if starting exactly on skipped chars
    while (currentCharIndex < fullText.length && (fullText[currentCharIndex] === ' ' || fullText[currentCharIndex] === '\n')) {
        const charEl = document.getElementById(`char-${currentCharIndex}`);
        if (charEl) charEl.classList.add('done-perfect');
        currentCharIndex++;
    }

    if (currentCharIndex > 0) {
        for (let i = 0; i < currentCharIndex; i++) {
            const el = document.getElementById(`char-${i}`);
            if (el) {
                el.classList.remove('active');
                if (!el.classList.contains('space') && !el.classList.contains('enter') && !el.classList.contains('tab')) {
                    el.classList.add('done-perfect');
                }
            }
        }
    }

    updateImageDisplay();
    highlightCurrentChar(); 
    centerView(); 
    
    accDisplay.innerText = "---";
    wpmDisplay.innerText = "0";
    timerDisplay.innerText = "00:00";
    
    let btnLabel = "Resume Reading";
    if (savedCharIndex === 0) btnLabel = "Start Reading";

    if (!isGameActive) {
        showStartModal(`Chapter ${currentChapterNum}`, btnLabel);
    }
}

// --- ENGINE (FIXED RENDERER) ---
function renderText() {
    textStream.innerHTML = '';
    const container = document.createDocumentFragment();
    let wordBuffer = document.createElement('span');
    wordBuffer.className = 'word';

    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        
        if (char === '\n') {
            const span = document.createElement('span');
            span.className = 'letter enter';
            span.innerHTML = '&nbsp;'; 
            span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            
            container.appendChild(wordBuffer);
            container.appendChild(document.createElement('br'));
            wordBuffer = document.createElement('span');
            wordBuffer.className = 'word';
            
        } else if (char === ' ') {
            const span = document.createElement('span');
            span.className = 'letter space';
            span.innerText = ' ';
            span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            
            container.appendChild(wordBuffer);
            wordBuffer = document.createElement('span');
            wordBuffer.className = 'word';
            
        } else if (char === '\t') {
            if (wordBuffer.hasChildNodes()) {
                container.appendChild(wordBuffer);
                wordBuffer = document.createElement('span');
                wordBuffer.className = 'word';
            }
            const tabSpan = document.createElement('span');
            tabSpan.className = 'word'; 
            const span = document.createElement('span');
            span.className = 'letter tab';
            span.innerHTML = '&nbsp;'; 
            span.id = `char-${i}`;
            tabSpan.appendChild(span);
            container.appendChild(tabSpan);
            
        } else {
            const span = document.createElement('span');
            span.className = 'letter';
            span.innerText = char;
            span.id = `char-${i}`;
            wordBuffer.appendChild(span);
        }
    }
    if (wordBuffer.hasChildNodes()) container.appendChild(wordBuffer);
    textStream.appendChild(container);
}

function startGame() {
    const select = document.getElementById('sprint-select');
    if (select) {
        sessionValueStr = select.value;
        sessionLimit = (sessionValueStr === 'infinity') ? 'infinity' : parseInt(sessionValueStr);
    }

    // Skip logic ONLY at start
    while (currentCharIndex < fullText.length && (fullText[currentCharIndex] === ' ' || fullText[currentCharIndex] === '\n')) {
        const charEl = document.getElementById(`char-${currentCharIndex}`);
        if (charEl) charEl.classList.add('done-perfect');
        currentCharIndex++;
    }
    
    sprintSeconds = 0;
    sprintMistakes = 0;
    sprintCharStart = currentCharIndex; 
    activeSeconds = 0; 
    timeAccumulator = 0;
    lastInputTime = Date.now(); 
    wpmHistory = []; 
    accuracyHistory = [];
    
    highlightCurrentChar();
    centerView();
    closeModal();
    
    isGameActive = true;
    isOvertime = false;
    accDisplay.innerText = "100%";
    wpmDisplay.innerText = "0";
    timerDisplay.style.color = 'white'; 
    timerDisplay.style.opacity = '1';

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 100); 
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
    if (total > 0) accDisplay.innerText = Math.round((correctCount / total) * 100) + "%";
}

document.addEventListener('keydown', (e) => {
    if (isModalOpen) {
        if (isInputBlocked) return; 
        const isStartKey = (e.key === "Enter") || (e.key === " ");
        if (isStartKey && modalActionCallback) {
            e.preventDefault();
            modalActionCallback(); 
            return;
        }
        return;
    }
    
    if (e.key === "Escape" && isGameActive) {
        pauseGameForBreak();
        return;
    }

    if (e.key === "Shift") toggleKeyboardCase(true);
    if (!isGameActive) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return; 
    if (e.key === " " || e.key === "Tab" || e.key === "Enter") e.preventDefault();

    handleTyping(e.key);
});

function handleTyping(key) {
    lastInputTime = Date.now();
    timerDisplay.style.opacity = '1';

    let inputChar = key;
    if (key === "Tab") inputChar = "\t";
    if (key === "Enter") inputChar = "\n";

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    if (key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    // STRICT MATCHING
    if (inputChar === targetChar) {
        // Track Stats
        statsData.charsToday++;
        statsData.charsWeek++;

        currentEl.classList.remove('active');
        currentEl.classList.remove('error-state');
        
        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect'); 
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed'); 
        else currentEl.classList.add('done-dirty'); 

        currentCharIndex++;
        currentLetterStatus = 'clean'; 
        
        if (['.', '!', '?', '\n'].includes(targetChar)) saveProgress();
        else if (['"', "'"].includes(targetChar) && currentCharIndex >= 2) {
            const prevChar = fullText[currentCharIndex - 2];
            if (['.', '!', '?'].includes(prevChar)) saveProgress();
        }

        updateRunningWPM();
        updateRunningAccuracy(true);

        if (isOvertime) {
            if (['.', '!', '?', '\n'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex]; 
                if (nextChar !== '"' && nextChar !== "'") { triggerStop(); return; }
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
        // Mistake
        mistakes++;
        sprintMistakes++;
        statsData.mistakesToday++;
        statsData.mistakesWeek++;

        if (currentLetterStatus === 'clean
