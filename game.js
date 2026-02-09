// v2.0.0 - Security Fixes, Landing Page, URL Params
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "2.0.0";
const DEFAULT_BOOK = "wizard_of_oz";
const IDLE_THRESHOLD = 2000; 
const AFK_THRESHOLD = 5000; // 5 Seconds to Auto-Pause
const SPRINT_COOLDOWN_MS = 1500; 
const SPAM_THRESHOLD = 5; 

// ADMIN WHITELIST - same list as index.html, used to show admin link
const ADMIN_EMAILS = [
    "jacob.wilson@sumnerk12.net",
    "jacob.v.wilson@gmail.com",
];

// STATE — URL param takes priority, then localStorage, then default
function getBookIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('book');
}
let currentBookId = getBookIdFromUrl() || localStorage.getItem('currentBookId') || DEFAULT_BOOK;
localStorage.setItem('currentBookId', currentBookId); // sync
let currentUser = null;
let bookData = null;
let bookMetadata = null; 
let fullText = "";
let currentCharIndex = 0;
let savedCharIndex = 0; 
let lastSavedIndex = 0; 
let currentChapterNum = 1;

// Stats
let sessionLimit = 30; 
let sessionValueStr = "30"; 
let statsData = { secondsToday:0, secondsWeek:0, charsToday:0, charsWeek:0, mistakesToday:0, mistakesWeek:0, lastDate:"", weekStart:0 };

// Game Vars
let mistakes = 0; let sprintMistakes = 0; 
let consecutiveMistakes = 0; 
let activeSeconds = 0; let sprintSeconds = 0; 
let sprintCharStart = 0; let timerInterval = null;
let isGameActive = false; let isOvertime = false;
let isModalOpen = false; let isInputBlocked = false; 
let isHardStop = false; 
let modalActionCallback = null;
let lastInputTime = 0; let timeAccumulator = 0;
let wpmHistory = []; let accuracyHistory = [];
let currentLetterStatus = 'clean'; 

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const timerDisplay = document.getElementById('timer-display');
const accDisplay = document.getElementById('acc-display');
const wpmDisplay = document.getElementById('wpm-display');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userNameDisplay = document.getElementById('user-name');

// Security: escape HTML to prevent XSS from Firestore data
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

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
    
    createKeyboard();
    setupAuthListeners();
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            updateAuthUI(true);
            try {
                await loadBookMetadata(); 
                await loadUserProgress(); 
                await loadUserStats();    
            } catch(e) { console.error("Init Error:", e); }
        } else {
            // No anonymous sign-in — just load the book as read-only
            currentUser = null;
            updateAuthUI(false);
            try {
                await loadBookMetadata();
                loadChapter(1);
            } catch(e) { console.error("Init Error:", e); }
        }
    });
}

function setupAuthListeners() {
    loginBtn.addEventListener('click', async () => {
        try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
        catch (e) { alert("Login failed: " + e.message); }
    });
    logoutBtn.addEventListener('click', async () => {
        try { await signOut(auth); location.reload(); } 
        catch (e) { console.error(e); }
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

async function loadBookMetadata() {
    try {
        const docRef = doc(db, "books", currentBookId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            bookMetadata = docSnap.data();
        } else {
            if(currentBookId !== DEFAULT_BOOK) {
                currentBookId = DEFAULT_BOOK;
                localStorage.setItem('currentBookId', DEFAULT_BOOK);
                await loadBookMetadata(); 
            }
        }
    } catch (e) { console.warn("Meta Error:", e); }
}

async function loadUserStats() {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; 
        const weekStart = getWeekStart(today); 
        const docRef = doc(db, "users", currentUser.uid, "stats", "time_tracking");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.lastDate === dateStr) {
                statsData.secondsToday = data.secondsToday || 0;
                statsData.charsToday = data.charsToday || 0;
                statsData.mistakesToday = data.mistakesToday || 0;
            } else {
                statsData.secondsToday = 0; statsData.charsToday = 0; statsData.mistakesToday = 0;
            }
            if (data.weekStart === weekStart) {
                statsData.secondsWeek = data.secondsWeek || 0;
                statsData.charsWeek = data.charsWeek || 0;
                statsData.mistakesWeek = data.mistakesWeek || 0;
            } else {
                statsData.secondsWeek = 0; statsData.charsWeek = 0; statsData.mistakesWeek = 0;
            }
        }
        statsData.lastDate = dateStr;
        statsData.weekStart = weekStart;
    } catch (e) {}
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
        if (!currentUser || currentUser.isAnonymous) {
            // No user — start from beginning, no saved progress
            currentChapterNum = 1;
            savedCharIndex = 0;
            lastSavedIndex = 0;
            loadChapter(1);
            return;
        }
        const docRef = doc(db, "users", currentUser.uid, "progress", currentBookId);
        const docSnap = await getDoc(docRef);
        currentChapterNum = 1;
        savedCharIndex = 0;
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.chapter !== undefined && data.chapter !== null) currentChapterNum = data.chapter;
            if (data.charIndex !== undefined) savedCharIndex = data.charIndex;
        }
        lastSavedIndex = savedCharIndex; 
        loadChapter(currentChapterNum);
    } catch (e) { loadChapter(1); }
}

async function loadChapter(chapterNum) {
    textStream.innerHTML = `Loading Chapter...`;
    const chapterId = "chapter_" + chapterNum;
    try {
        const docRef = doc(db, "books", currentBookId, "chapters", chapterId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            bookData = docSnap.data();
            currentChapterNum = chapterNum;
            setupGame();
        } else {
            if(chapterNum !== 1 && chapterNum !== "1") {
                alert(`Chapter ${chapterNum} not found. Returning to start.`);
                currentChapterNum = 1;
                savedCharIndex = 0;
                loadChapter(1);
            } else {
                textStream.innerText = "Book content not found.";
            }
        }
    } catch (e) { 
        console.error(e);
        textStream.innerHTML = "Error loading content."; 
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join("\n");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    currentCharIndex = savedCharIndex;
    
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

    highlightCurrentChar(); 
    centerView(); 
    
    accDisplay.innerText = "---"; wpmDisplay.innerText = "0"; timerDisplay.innerText = "00:00";
    
    let btnLabel = "Resume";
    if (savedCharIndex === 0) btnLabel = "Start Reading";
    
    if (!isGameActive) showStartModal(btnLabel);
}

function renderText() {
    textStream.innerHTML = '';
    const container = document.createDocumentFragment();
    let wordBuffer = document.createElement('span');
    wordBuffer.className = 'word';

    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        if (char === '\n') {
            const span = document.createElement('span');
            span.className = 'letter enter'; span.innerHTML = '&nbsp;'; span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            container.appendChild(wordBuffer);
            container.appendChild(document.createElement('br'));
            wordBuffer = document.createElement('span'); wordBuffer.className = 'word';
        } else if (char === ' ') {
            const span = document.createElement('span');
            span.className = 'letter space'; span.innerText = ' '; span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            container.appendChild(wordBuffer);
            wordBuffer = document.createElement('span'); wordBuffer.className = 'word';
        } else if (char === '\t') {
            if (wordBuffer.hasChildNodes()) { container.appendChild(wordBuffer); wordBuffer = document.createElement('span'); wordBuffer.className = 'word'; }
            const tabSpan = document.createElement('span'); tabSpan.className = 'word'; 
            const span = document.createElement('span'); span.className = 'letter tab'; span.innerHTML = '&nbsp;'; span.id = `char-${i}`;
            tabSpan.appendChild(span); container.appendChild(tabSpan);
        } else {
            const span = document.createElement('span'); span.className = 'letter'; span.innerText = char; span.id = `char-${i}`;
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
    
    sprintSeconds = 0; sprintMistakes = 0; sprintCharStart = currentCharIndex; 
    activeSeconds = 0; timeAccumulator = 0; lastInputTime = Date.now(); 
    consecutiveMistakes = 0; 
    wpmHistory = []; accuracyHistory = [];
    
    highlightCurrentChar(); centerView(); closeModal();
    isGameActive = true; isOvertime = false; isHardStop = false;
    accDisplay.innerText = "100%"; wpmDisplay.innerText = "0";
    timerDisplay.style.color = 'white'; timerDisplay.style.opacity = '1';

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 100); 
}

function gameTick() {
    if (!isGameActive) return;
    const now = Date.now();
    
    // AUTO PAUSE FOR INACTIVITY
    if (now - lastInputTime > AFK_THRESHOLD && !isModalOpen) {
        triggerHardStop(fullText[currentCharIndex], true);
        return;
    }

    if (now - lastInputTime < IDLE_THRESHOLD) {
        timeAccumulator += 100;
        timerDisplay.style.opacity = '1';
        if (timeAccumulator >= 1000) {
            activeSeconds++; sprintSeconds++;
            statsData.secondsToday++; statsData.secondsWeek++;
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
        
        // --- HARD STOP / PAUSE LOGIC ---
        if (isHardStop) {
            let targetChar = fullText[currentCharIndex];
            let isMatch = (e.key === targetChar);
            if (targetChar === '\n' && e.key === 'Enter') isMatch = true;
            if (targetChar === '\t' && e.key === 'Tab') isMatch = true;
            
            if (isMatch) {
                resumeGame();
                handleTyping(e.key);
            }
            return;
        }

        // --- SMART START LOGIC ---
        let shouldStart = false;
        let shouldSkip = false;
        
        const targetChar = fullText[currentCharIndex];
        
        if (e.key === targetChar) shouldStart = true;
        if (targetChar === '\n' && e.key === 'Enter') shouldStart = true;
        if (targetChar === '\t' && e.key === 'Tab') shouldStart = true;
        
        if (!shouldStart && (targetChar === ' ' || targetChar === '\n')) {
            const nextCharIndex = currentCharIndex + 1;
            if (nextCharIndex < fullText.length) {
                const nextChar = fullText[nextCharIndex];
                if (e.key === nextChar) { shouldStart = true; shouldSkip = true; }
                else if (nextChar === '\t' && e.key === 'Tab') { shouldStart = true; shouldSkip = true; }
            }
        }

        if (shouldStart && modalActionCallback) {
            e.preventDefault();
            modalActionCallback(); 
            if (shouldSkip) {
                const skippedEl = document.getElementById(`char-${currentCharIndex}`);
                if(skippedEl) skippedEl.classList.add('done-perfect');
                currentCharIndex++;
            }
            handleTyping(e.key);
            return;
        }
        return;
    }
    
    if (e.key === "Escape" && isGameActive) { pauseGameForBreak(); return; }
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

    if (inputChar === targetChar) {
        statsData.charsToday++; statsData.charsWeek++;
        consecutiveMistakes = 0; 

        currentEl.classList.remove('active'); currentEl.classList.remove('error-state');
        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect'); 
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed'); 
        else currentEl.classList.add('done-dirty'); 

        currentCharIndex++; currentLetterStatus = 'clean'; 
        
        if (['.', '!', '?', '\n'].includes(targetChar)) saveProgress();
        else if (['"', "'"].includes(targetChar) && currentCharIndex >= 2) {
            const prevChar = fullText[currentCharIndex - 2];
            if (['.', '!', '?'].includes(prevChar)) saveProgress();
        }

        updateRunningWPM(); updateRunningAccuracy(true);

        if (isOvertime) {
            if (['.', '!', '?', '\n'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex]; 
                if (nextChar !== '"' && nextChar !== "'") { triggerStop(); return; }
            }
        }

        if (currentCharIndex >= fullText.length) { finishChapter(); return; }
        
        highlightCurrentChar(); centerView();
    } else {
        mistakes++; sprintMistakes++;
        consecutiveMistakes++; 
        
        statsData.mistakesToday++; statsData.mistakesWeek++;
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        const errEl = document.getElementById(`char-${currentCharIndex}`);
        if(errEl) errEl.classList.add('error-state'); 
        flashKey(key); updateRunningAccuracy(false);

        if (consecutiveMistakes >= SPAM_THRESHOLD) {
            triggerHardStop(targetChar, false);
        }
    }
}

function triggerStop() {
    updateImageDisplay(); highlightCurrentChar(); centerView(); pauseGameForBreak();
}

function triggerHardStop(targetChar, isAfk) {
    isGameActive = false;
    clearInterval(timerInterval);
    isHardStop = true; 
    
    let friendlyKey = targetChar;
    if (targetChar === ' ') friendlyKey = 'Space';
    if (targetChar === '\n') friendlyKey = 'Enter';
    if (targetChar === '\t') friendlyKey = 'Tab';

    // Capitalization Hint Logic
    let hintHtml = "";
    if (friendlyKey.length === 1 && friendlyKey.match(/[A-Z]/)) {
        hintHtml = `<div class="modal-hint-text">(Requires Shift)</div>`;
    }

    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = isAfk ? "Session Paused (Inactive)" : "Pausing for Accuracy";
    
    let msg = isAfk ? "You've been away for a while." : "Too many errors!";
    
    document.getElementById('modal-body').innerHTML = `
        <div style="font-size: 1.1em; margin: 20px 0;">
            ${msg}<br><br>
            Please type <b style="color: #D32F2F; font-size: 1.5em; border: 1px solid #ccc; padding: 2px 8px; border-radius: 4px;">${friendlyKey}</b> to resume.
            ${hintHtml}
        </div>
    `;
    const btn = document.getElementById('action-btn');
    btn.style.display = 'none'; 
    modal.classList.remove('hidden');
    isModalOpen = true; 
    isInputBlocked = false;
}

function resumeGame() {
    isModalOpen = false;
    isHardStop = false;
    document.getElementById('modal').classList.add('hidden');
    isGameActive = true;
    timerInterval = setInterval(gameTick, 100); 
    consecutiveMistakes = 0;
    lastInputTime = Date.now(); 
    
    const keyboard = document.getElementById('virtual-keyboard'); 
    if(keyboard) keyboard.focus();
}

document.addEventListener('keyup', (e) => { if (e.key === "Shift") toggleKeyboardCase(false); });

// --- VIEW LOGIC ---
function centerView() {
    const currentEl = document.getElementById(`char-${currentCharIndex}`);
    if (!currentEl) return;
    const container = document.getElementById('game-container');
    const offset = (container.clientHeight / 2) - currentEl.offsetTop - 25; 
    textStream.style.transform = `translateY(${offset}px)`;
}

function highlightCurrentChar() {
    document.querySelectorAll('.letter.active').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`char-${currentCharIndex}`);
    if (el) { el.classList.add('active'); highlightKey(fullText[currentCharIndex]); }
}

function updateImageDisplay() {
    const p = document.getElementById('image-panel');
    if(p) p.style.display = 'none';
}

async function saveProgress(force = false) {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        if (currentCharIndex > lastSavedIndex || force) {
            await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
                chapter: currentChapterNum,
                charIndex: currentCharIndex,
                lastUpdated: new Date()
            }, { merge: true });
            lastSavedIndex = currentCharIndex;
        }
        await setDoc(doc(db, "users", currentUser.uid, "stats", "time_tracking"), statsData, { merge: true });
    } catch (e) { console.warn("Save failed:", e); }
}

function formatTime(seconds) {
    if (!seconds) return "0m 0s"; 
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

function calculateAverageWPM(chars, seconds) {
    if(!seconds || seconds <= 0) return 0;
    const mins = seconds / 60;
    return Math.round((chars / 5) / mins);
}

function calculateAverageAcc(chars, mistakes) {
    if(!chars || chars <= 0) return 100;
    const total = chars + mistakes;
    if(total === 0) return 100;
    return Math.round((chars / total) * 100);
}

function pauseGameForBreak() {
    isGameActive = false; clearInterval(timerInterval); saveProgress(); 
    const charsTyped = currentCharIndex - sprintCharStart;
    const sprintMinutes = sprintSeconds / 60;
    const sprintWPM = (sprintMinutes > 0) ? Math.round((charsTyped / 5) / sprintMinutes) : 0;
    const sprintTotalEntries = charsTyped + sprintMistakes;
    const sprintAcc = (sprintTotalEntries > 0) ? Math.round((charsTyped / sprintTotalEntries) * 100) : 100;

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const stats = { 
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc,
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`
    };
    showStatsModal("Sprint Complete", stats, "Continue", startGame);
}

function finishChapter() {
    isGameActive = false; clearInterval(timerInterval);
    
    let nextChapterId = null;
    if (bookMetadata && bookMetadata.chapters) {
        const currentIdx = bookMetadata.chapters.findIndex(c => c.id == "chapter_" + currentChapterNum);
        if (currentIdx !== -1 && currentIdx + 1 < bookMetadata.chapters.length) {
            const nextChap = bookMetadata.chapters[currentIdx + 1];
            nextChapterId = nextChap.id.replace("chapter_", "");
        }
    }
    
    if (!nextChapterId) {
        if (!isNaN(currentChapterNum)) nextChapterId = parseFloat(currentChapterNum) + 1;
        else nextChapterId = 1;
    }
    
    const charsTyped = currentCharIndex - sprintCharStart;
    const sprintMinutes = sprintSeconds / 60;
    const sprintWPM = (sprintMinutes > 0) ? Math.round((charsTyped / 5) / sprintMinutes) : 0;
    const sprintTotalEntries = charsTyped + sprintMistakes;
    const sprintAcc = (sprintTotalEntries > 0) ? Math.round((charsTyped / sprintTotalEntries) * 100) : 100;

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const stats = {
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc, 
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`
    };
    
    showStatsModal(`Chapter ${currentChapterNum} Complete!`, stats, `Start Next`, async () => {
        await saveProgress(true); 
        currentChapterNum = nextChapterId;
        savedCharIndex = 0; currentCharIndex = 0; lastSavedIndex = 0;
        if (currentUser && !currentUser.isAnonymous) {
            await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
                chapter: currentChapterNum, charIndex: 0
            }, { merge: true });
        }
        loadChapter(nextChapterId);
    });
}

function getHeaderHTML() {
    let bookTitle = (bookMetadata && bookMetadata.title) ? escapeHtml(bookMetadata.title) : escapeHtml(currentBookId.replace(/_/g, ' '));
    
    let displayChapTitle = `Chapter ${escapeHtml(String(currentChapterNum))}`;
    
    if (bookMetadata && bookMetadata.chapters) {
        const c = bookMetadata.chapters.find(ch => ch.id == "chapter_" + currentChapterNum);
        if (c && c.title) {
            if(c.title != currentChapterNum) {
                if(c.title.toLowerCase().startsWith('chapter')) {
                    displayChapTitle = escapeHtml(c.title);
                } else {
                    displayChapTitle = `Chapter ${escapeHtml(String(currentChapterNum))} | ${escapeHtml(c.title)}`;
                }
            }
        }
    }
    
    return `<div class="modal-book-title">${bookTitle}</div><div class="modal-chap-info">${displayChapTitle}</div>`;
}

function showStartModal(btnText) {
    isModalOpen = true; isInputBlocked = false; 
    modalActionCallback = startGame;
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').style.display = 'none'; 
    
    const html = `
        ${getHeaderHTML()}
        ${getDropdownHTML()}
        <p style="font-size:0.8rem; color:#777; margin-top: 15px;">
            Type the first character to start.<br>
            (You can skip Space or Enter at the start, but Tabs are required.)<br>
            Press <b>ESC</b> anytime to pause.
        </p>
    `;
    document.getElementById('modal-body').innerHTML = html;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText; btn.onclick = startGame; btn.disabled = false; btn.style.display = 'inline-block';
    modal.classList.remove('hidden');
}

function showStatsModal(title, stats, btnText, callback) {
    isModalOpen = true; isInputBlocked = true; 
    modalActionCallback = () => { closeModal(); if(callback) callback(); };
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').style.display = 'none'; 
    
    const html = `
        ${getHeaderHTML()}
        <div style="font-size:1.2em; font-weight:bold; color:#4B9CD3; margin-bottom:15px;">${title}</div>
        <div class="stat-grid" style="display:flex; justify-content:center; gap:20px; margin:20px 0;">
            <div class="stat-box"><div style="font-size:1.8em; font-weight:bold;">${stats.wpm}</div><div style="font-size:0.9em; color:#777;">WPM</div></div>
            <div class="stat-box"><div style="font-size:1.8em; font-weight:bold;">${stats.acc}%</div><div style="font-size:0.9em; color:#777;">Accuracy</div></div>
            <div class="stat-box"><div style="font-size:1.8em; font-weight:bold;">${formatTime(stats.time)}</div><div style="font-size:0.9em; color:#777;">Time</div></div>
        </div>
        <div class="stat-subtext">Today: <span class="highlight">${stats.today}</span><br>Week: <span class="highlight">${stats.week}</span></div>
    `;
    
    document.getElementById('modal-body').innerHTML = html;
    const btn = document.getElementById('action-btn');
    btn.innerText = "Wait..."; btn.onclick = modalActionCallback; btn.disabled = true; btn.style.opacity = '0.5'; 
    modal.classList.remove('hidden');
    setTimeout(() => {
        isInputBlocked = false;
        if(document.getElementById('action-btn')) {
            const b = document.getElementById('action-btn');
            b.style.opacity = '1'; b.innerText = btnText; b.disabled = false;
        }
    }, SPRINT_COOLDOWN_MS);
}

function getDropdownHTML() {
    const options = [{val: "30", label: "30 Seconds"}, {val: "60", label: "1 Minute"}, {val: "120", label: "2 Minutes"}, {val: "300", label: "5 Minutes"}, {val: "infinity", label: "Open Ended (∞)"}];
    let optionsHtml = options.map(opt => `<option value="${opt.val}" ${sessionValueStr === opt.val ? 'selected' : ''}>${opt.label}</option>`).join('');
    return `<div style="margin-bottom: 20px; text-align:center;"><label for="sprint-select" style="color:#777; font-size:0.8rem; display:block; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Session Length</label><select id="sprint-select" class="modal-select">${optionsHtml}</select></div>`;
}

function closeModal() {
    isModalOpen = false; isInputBlocked = false; document.getElementById('modal').classList.add('hidden');
    const keyboard = document.getElementById('virtual-keyboard'); if(keyboard) keyboard.focus();
}

async function openMenuModal() {
    if (isGameActive) pauseGameForBreak();
    isModalOpen = true; isInputBlocked = false; 
    modalActionCallback = () => { closeModal(); startGame(); };
    
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').style.display = 'block'; 
    document.getElementById('modal-title').innerText = "Settings";
    
    let chapterOptions = "";
    if (bookMetadata && bookMetadata.chapters) {
        bookMetadata.chapters.forEach((chap) => {
            const num = chap.id.replace("chapter_", "");
            let sel = (num == currentChapterNum) ? "selected" : "";
            
            let label = `Chapter ${escapeHtml(num)}`;
            if(chap.title && chap.title != num) {
                if(chap.title.toLowerCase().startsWith('chapter')) label = escapeHtml(chap.title);
                else label = `Chapter ${escapeHtml(num)}: ${escapeHtml(chap.title)}`;
            }
            chapterOptions += `<option value="${escapeHtml(num)}" ${sel}>${label}</option>`;
        });
    }

    let bookOptions = "";
    try {
        const querySnapshot = await getDocs(collection(db, "books"));
        querySnapshot.forEach((doc) => {
            const b = doc.data();
            const id = doc.id;
            const title = escapeHtml(b.title || id);
            const sel = (id === currentBookId) ? "selected" : "";
            bookOptions += `<option value="${escapeHtml(id)}" ${sel}>${title}</option>`;
        });
    } catch(e) { console.warn(e); }

    document.getElementById('modal-body').innerHTML = `
        <div class="menu-section">
            <div class="menu-label">Current Book</div>
            <select id="book-select" class="modal-select">${bookOptions}</select>
        </div>
        <div class="menu-section">
            <div class="menu-label">Chapter</div>
            <div style="display:flex; gap:10px;">
                <select id="chapter-nav-select" class="modal-select" style="margin:0; flex-grow:1;">${chapterOptions}</select>
                <button id="go-btn" class="modal-btn" style="width:auto; padding:0 20px;">Go</button>
            </div>
        </div>
        <div class="menu-section">
            <div class="menu-label">Session</div>
            ${getDropdownHTML()}
        </div>
    `;
    
    document.getElementById('book-select').onchange = (e) => {
        if(confirm("Switch book? Progress saved.")) {
            currentBookId = e.target.value;
            localStorage.setItem('currentBookId', currentBookId);
            loadBookMetadata().then(() => {
                loadUserProgress(); 
                closeModal();
            });
        }
    };

    document.getElementById('go-btn').onclick = () => {
        const val = document.getElementById('chapter-nav-select').value;
        if(val != currentChapterNum) {
            handleChapterSwitch(val);
        } else {
            if(confirm(`Restart Chapter ${val}?`)) switchChapterHot(val);
        }
    };

    const btn = document.getElementById('action-btn');
    btn.innerText = "Close";
    btn.onclick = () => { closeModal(); if(!isGameActive && savedCharIndex > 0) startGame(); };
    btn.disabled = false;
    modal.classList.remove('hidden');
}

function handleChapterSwitch(newChapter) {
    if (newChapter != currentChapterNum) switchChapterHot(newChapter);
    else if(confirm(`Go back to Chapter ${newChapter}?`)) switchChapterHot(newChapter);
}

async function switchChapterHot(newChapter) {
    if (currentUser && !currentUser.isAnonymous) {
        await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
            chapter: newChapter, charIndex: 0
        }, { merge: true });
    }
    currentChapterNum = newChapter; savedCharIndex = 0; currentCharIndex = 0; lastSavedIndex = 0;
    closeModal(); textStream.innerHTML = "Switching..."; loadChapter(newChapter);
}

const rows = [['q','w','e','r','t','y','u','i','o','p','[',']','\\'],['a','s','d','f','g','h','j','k','l',';',"'"],['z','x','c','v','b','n','m',',','.','/']];
const shiftRows = [['Q','W','E','R','T','Y','U','I','O','P','{','}','|'],['A','S','D','F','G','H','J','K','L',':','"'],['Z','X','C','V','B','N','M','<','>','?']];

function createKeyboard() {
    keyboardDiv.innerHTML = '';
    rows.forEach((rowChars, rIndex) => {
        const rowDiv = document.createElement('div'); rowDiv.className = 'kb-row'; 
        if (rIndex === 1) addSpecialKey(rowDiv, "CAPS"); if (rIndex === 2) addSpecialKey(rowDiv, "SHIFT");
        rowChars.forEach((char, cIndex) => {
            const key = document.createElement('div'); key.className = 'key'; key.innerText = char; key.dataset.char = char; key.dataset.shift = shiftRows[rIndex][cIndex]; key.id = `key-${char}`; rowDiv.appendChild(key);
        });
        if (rIndex === 0) addSpecialKey(rowDiv, "BACK"); if (rIndex === 1) addSpecialKey(rowDiv, "ENTER"); if (rIndex === 2) addSpecialKey(rowDiv, "SHIFT");
        keyboardDiv.appendChild(rowDiv);
    });
    const spaceRow = document.createElement('div'); spaceRow.className = 'kb-row'; 
    const space = document.createElement('div'); space.className = 'key space'; space.innerText = ""; space.id = "key- ";
    spaceRow.appendChild(space); keyboardDiv.appendChild(spaceRow);
}

function addSpecialKey(parent, text) {
    const key = document.createElement('div'); key.className = 'key wide'; key.innerText = text; key.id = `key-${text}`; parent.appendChild(key);
}

function toggleKeyboardCase(isShift) {
    document.querySelectorAll('.key').forEach(k => {
        if (k.dataset.char) k.innerText = isShift ? k.dataset.shift : k.dataset.char;
        if (k.id === 'key-SHIFT') isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active');
    });
}

function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));
    let targetId = ''; let needsShift = false;
    if (char === ' ') targetId = 'key- '; else if (char === '\t') targetId = 'key-TAB'; else if (char === '\n') targetId = 'key-ENTER'; 
    else {
        const keys = Array.from(document.querySelectorAll('.key'));
        const found = keys.find(k => k.dataset.char === char || k.dataset.shift === char);
        if (found) { targetId = found.id; if (found.dataset.shift === char) needsShift = true; }
    }
    const el = document.getElementById(targetId); if (el) el.classList.add('target');
    toggleKeyboardCase(needsShift);
}

function flashKey(char) {
    let targetId = '';
    if (char === ' ') targetId = 'key- '; else if (char === '\t' || char === 'Tab') targetId = 'key-TAB'; else if (char === '\\n' || char === 'Enter') targetId = 'key-ENTER'; 
    else {
        const keys = Array.from(document.querySelectorAll('.key'));
        const found = keys.find(k => k.dataset.char === char || k.dataset.shift === char);
        if (found) targetId = found.id;
    }
    const el = document.getElementById(targetId);
    if (el) { el.style.backgroundColor = 'var(--brute-force-color)'; setTimeout(() => el.style.backgroundColor = '', 200); }
}

window.onload = init;
