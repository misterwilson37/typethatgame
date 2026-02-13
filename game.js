// v2.4.6 - Caps Lock warning
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc, getDocs, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "2.4.7";
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

// Goals
let goals = { dailySeconds: 0, weeklySeconds: 0 };
let dailyGoalCelebrated = false;
let weeklyGoalCelebrated = false;

// Game Vars
let mistakes = 0; let sprintMistakes = 0;
let consecutiveMistakes = 0;
let activeSeconds = 0; let sprintSeconds = 0;
let sprintCharStart = 0; let timerInterval = null;
let isGameActive = false; let isOvertime = false;
let isModalOpen = false; let isInputBlocked = false;
let modalGeneration = 0;
let isHardStop = false;
let bookSwitchPending = false;
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
                await loadGoals();
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

async function loadGoals() {
    try {
        const goalsSnap = await getDoc(doc(db, "settings", "goals"));
        if (goalsSnap.exists()) {
            const data = goalsSnap.data();
            goals.dailySeconds = data.dailySeconds || 0;
            goals.weeklySeconds = data.weeklySeconds || 0;
            console.log(`Goals loaded: daily=${goals.dailySeconds}s (${Math.round(goals.dailySeconds/60)}m), weekly=${goals.weeklySeconds}s (${Math.round(goals.weeklySeconds/60)}m)`);
        } else {
            console.log("No goals document found at settings/goals");
        }
        // If user already exceeded goals coming in, mark as celebrated so we don't fire again
        if (goals.dailySeconds > 0 && statsData.secondsToday >= goals.dailySeconds) {
            dailyGoalCelebrated = true;
            console.log(`Daily goal already met (${statsData.secondsToday}s >= ${goals.dailySeconds}s)`);
        }
        if (goals.weeklySeconds > 0 && statsData.secondsWeek >= goals.weeklySeconds) {
            weeklyGoalCelebrated = true;
            console.log(`Weekly goal already met (${statsData.secondsWeek}s >= ${goals.weeklySeconds}s)`);
        }
    } catch (e) {
        console.error("Goals load FAILED — check Firestore rules for 'settings' collection:", e);
    }
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
            getHeaderHTML(); // update book info bar
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

            // Midnight rollover check
            const todayStr = new Date().toISOString().split('T')[0];
            if (statsData.lastDate && statsData.lastDate !== todayStr) {
                console.log(`Day rolled over: ${statsData.lastDate} → ${todayStr}. Resetting daily stats.`);
                statsData.secondsToday = 0;
                statsData.charsToday = 0;
                statsData.mistakesToday = 0;
                statsData.lastDate = todayStr;
                dailyGoalCelebrated = false; // eligible for today's goal
                // Check week rollover too
                const weekStart = getWeekStart(new Date());
                if (statsData.weekStart !== weekStart) {
                    statsData.secondsWeek = 0;
                    statsData.charsWeek = 0;
                    statsData.mistakesWeek = 0;
                    statsData.weekStart = weekStart;
                    weeklyGoalCelebrated = false;
                }
            }

            statsData.secondsToday++; statsData.secondsWeek++;
            timeAccumulator -= 1000;
            updateTimerUI();

            // Goal celebrations
            if (goals.dailySeconds > 0 && !dailyGoalCelebrated && statsData.secondsToday >= goals.dailySeconds) {
                dailyGoalCelebrated = true;
                launchConfetti();
            }
            if (goals.weeklySeconds > 0 && !weeklyGoalCelebrated && statsData.secondsWeek >= goals.weeklySeconds) {
                weeklyGoalCelebrated = true;
                launchFireworks();
            }
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
    // Caps Lock detection
    if (e.getModifierState && e.key !== 'CapsLock') {
        const capsOn = e.getModifierState('CapsLock');
        document.getElementById('caps-warning').classList.toggle('hidden', !capsOn);
    } else if (e.key === 'CapsLock') {
        // CapsLock key itself — state flips AFTER the event in some browsers,
        // so we toggle based on current state
        const capsWarning = document.getElementById('caps-warning');
        const wasOn = e.getModifierState('CapsLock');
        // If it was on, pressing CapsLock turns it off, and vice versa
        capsWarning.classList.toggle('hidden', wasOn);
    }

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
            // First backspace: clear the error on current char
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        } else if (currentCharIndex > sprintCharStart) {
            // Additional backspaces: move back to previous char
            currentCharIndex--;
            currentLetterStatus = 'fixed'; // will show as fixed when retyped
            const prevEl = document.getElementById(`char-${currentCharIndex}`);
            if (prevEl) {
                prevEl.classList.remove('done-perfect', 'done-fixed', 'done-dirty');
                prevEl.classList.add('active');
            }
            // Un-highlight the char we just left
            if (currentEl) currentEl.classList.remove('active');
            highlightCurrentChar(); centerView();
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

        if (currentCharIndex >= fullText.length) { finishChapter(); return; }

        if (isOvertime) {
            if (['.', '!', '?', '\n'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex];
                if (nextChar !== '"' && nextChar !== "'") { triggerStop(); return; }
            }
        }

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

    let hintHtml = "";
    if (friendlyKey.length === 1 && friendlyKey.match(/[A-Z]/)) {
        hintHtml = `<div class="modal-hint-text">(Requires Shift)</div>`;
    }

    setModalTitle(isAfk ? "Session Paused (Inactive)" : "Pausing for Accuracy");

    let msg = isAfk ? "You've been away for a while." : "Too many errors!";

    document.getElementById('modal-body').innerHTML = `
        <div style="font-size: 1.1em;">
            ${msg}<br>
            Please type <b style="color: #D32F2F; font-size: 1.5em; border: 1px solid #ccc; padding: 2px 8px; border-radius: 4px;">${friendlyKey}</b> to resume.
            ${hintHtml}
        </div>
    `;
    const btn = document.getElementById('action-btn');
    btn.style.display = 'none';
    showModalPanel();
    isModalOpen = true;
    isInputBlocked = false;
}

function resumeGame() {
    isModalOpen = false;
    isHardStop = false;
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('virtual-keyboard').classList.remove('hidden');
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

        // Daily log for admin reporting
        const today = new Date().toISOString().split('T')[0];
        const logId = `${currentUser.uid}_${today}`;
        await setDoc(doc(db, "typing_logs", logId), {
            uid: currentUser.uid,
            email: currentUser.email || "",
            displayName: currentUser.displayName || "Anonymous",
            date: today,
            seconds: statsData.secondsToday || 0,
            chars: statsData.charsToday || 0,
            mistakes: statsData.mistakesToday || 0,
            lastUpdated: new Date()
        }, { merge: true });
    } catch (e) { console.warn("Save failed:", e); }
}

async function logSession(seconds, chars, mistakes, wpm, accuracy) {
    if (!currentUser || currentUser.isAnonymous) return;
    if (seconds < 5) return; // skip trivially short sessions
    try {
        await addDoc(collection(db, "typing_sessions"), {
            uid: currentUser.uid,
            email: currentUser.email || "",
            displayName: currentUser.displayName || "Anonymous",
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date(),
            seconds: seconds,
            chars: chars,
            mistakes: mistakes,
            wpm: wpm,
            accuracy: accuracy,
            bookId: currentBookId,
            chapter: currentChapterNum
        });
    } catch (e) { console.warn("Session log failed:", e); }
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

    // Log this session
    logSession(sprintSeconds, charsTyped, sprintMistakes, sprintWPM, sprintAcc);

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const stats = {
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc,
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`
    };

    let title = "Sprint Complete";
    if (dailyGoalCelebrated && goals.dailySeconds > 0 && statsData.secondsToday - sprintSeconds < goals.dailySeconds) {
        title = "🎉 Daily Goal Reached!";
    }
    if (weeklyGoalCelebrated && goals.weeklySeconds > 0 && statsData.secondsWeek - sprintSeconds < goals.weeklySeconds) {
        title = "🎆 Weekly Goal Reached!";
    }

    showStatsModal(title, stats, "Continue", startGame);
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

    // Log this session
    logSession(sprintSeconds, charsTyped, sprintMistakes, sprintWPM, sprintAcc);

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const stats = {
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc,
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`
    };

    let title = `Chapter ${currentChapterNum} Complete!`;
    if (dailyGoalCelebrated && goals.dailySeconds > 0 && statsData.secondsToday - sprintSeconds < goals.dailySeconds) {
        title = `🎉 Chapter ${currentChapterNum} Complete + Daily Goal!`;
    }
    if (weeklyGoalCelebrated && goals.weeklySeconds > 0 && statsData.secondsWeek - sprintSeconds < goals.weeklySeconds) {
        title = `🎆 Chapter ${currentChapterNum} Complete + Weekly Goal!`;
    }

    showStatsModal(title, stats, `Start Next`, async () => {
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

    let displayChapTitle = `Ch. ${escapeHtml(String(currentChapterNum))}`;

    if (bookMetadata && bookMetadata.chapters) {
        const c = bookMetadata.chapters.find(ch => ch.id == "chapter_" + currentChapterNum);
        if (c && c.title) {
            if(c.title != currentChapterNum) {
                if(c.title.toLowerCase().startsWith('chapter')) {
                    displayChapTitle = escapeHtml(c.title);
                } else {
                    displayChapTitle = `Ch. ${escapeHtml(String(currentChapterNum))}: ${escapeHtml(c.title)}`;
                }
            }
        }
    }

    updateBookInfoBar(bookTitle, displayChapTitle);
    return `<div class="modal-header-compact"><span class="mh-book">${bookTitle}</span> <span class="mh-sep">—</span> <span class="mh-chap">${displayChapTitle}</span></div>`;
}

function updateBookInfoBar(bookTitle, chapTitle) {
    const bar = document.getElementById('book-info-bar');
    if (!bar) return;
    if (!bookTitle) { bar.innerHTML = ''; return; }
    bar.innerHTML = `<span class="bib-title">${bookTitle}</span><span class="bib-sep">—</span><span class="bib-chap">${chapTitle || ''}</span>`;
}

function showStartModal(btnText) {
    isModalOpen = true; isInputBlocked = false;
    modalActionCallback = startGame;
    setModalTitle('');

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const hasStats = statsData.secondsToday > 0 || statsData.secondsWeek > 0;
    const statsSection = hasStats ? `
        <div class="cumulative-row">
            <span>Today: ${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)</span>
            <span>Week: ${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)</span>
        </div>
        ${getGoalProgressHTML()}
    ` : (goals.dailySeconds > 0 || goals.weeklySeconds > 0) ? getGoalProgressHTML() : '';

    document.getElementById('modal-body').innerHTML = `
        ${statsSection}
        <div class="start-controls">
            ${getDropdownHTML()}
            <div class="start-hint">Type first character to start · ESC to pause</div>
        </div>
    `;

    const btn = document.getElementById('action-btn');
    btn.innerText = btnText; btn.onclick = startGame; btn.disabled = false; btn.style.display = 'inline-block'; btn.style.opacity = '1';
    showModalPanel();
}

function showStatsModal(title, stats, btnText, callback) {
    isModalOpen = true; isInputBlocked = true;
    modalActionCallback = () => { closeModal(); if(callback) callback(); };
    setModalTitle('');

    document.getElementById('modal-body').innerHTML = `
        <div class="stats-title">${title}</div>
        <div class="stats-inline">
            <span class="si-val">${stats.wpm} <small>WPM</small></span>
            <span class="si-dot">·</span>
            <span class="si-val">${stats.acc}% <small>Acc</small></span>
            <span class="si-dot">·</span>
            <span class="si-val">${formatTime(stats.time)}</span>
        </div>
        <div class="cumulative-row">
            <span>Today: ${stats.today}</span>
            <span>Week: ${stats.week}</span>
        </div>
        ${getGoalProgressHTML()}
    `;

    const btn = document.getElementById('action-btn');
    btn.innerText = "Wait..."; btn.onclick = modalActionCallback; btn.disabled = true; btn.style.opacity = '0.5'; btn.style.display = 'inline-block';
    showModalPanel();
    const gen = ++modalGeneration;
    setTimeout(() => {
        if (modalGeneration !== gen) return; // modal was replaced
        isInputBlocked = false;
        if(document.getElementById('action-btn')) {
            const b = document.getElementById('action-btn');
            b.style.opacity = '1'; b.innerText = btnText; b.disabled = false;
        }
    }, SPRINT_COOLDOWN_MS);
}


function getGoalProgressHTML() {
    if (goals.dailySeconds <= 0 && goals.weeklySeconds <= 0) return '';
    
    let html = '<div class="goal-progress-row">';
    
    if (goals.dailySeconds > 0) {
        const dailyPct = Math.min(100, Math.round((statsData.secondsToday / goals.dailySeconds) * 100));
        const met = statsData.secondsToday >= goals.dailySeconds;
        html += `<div class="goal-item">
            <span class="goal-label">🎉 Daily</span>
            <div class="goal-bar"><div class="goal-fill" style="width:${dailyPct}%; background:${met ? '#22c55e' : '#4B9CD3'};"></div></div>
            <span class="goal-pct" style="color:${met ? '#22c55e' : '#888'};">${dailyPct}%${met ? ' ✓' : ''}</span>
        </div>`;
    }
    
    if (goals.weeklySeconds > 0) {
        const weeklyPct = Math.min(100, Math.round((statsData.secondsWeek / goals.weeklySeconds) * 100));
        const met = statsData.secondsWeek >= goals.weeklySeconds;
        html += `<div class="goal-item">
            <span class="goal-label">🎆 Weekly</span>
            <div class="goal-bar"><div class="goal-fill" style="width:${weeklyPct}%; background:${met ? '#FFD700' : '#4B9CD3'};"></div></div>
            <span class="goal-pct" style="color:${met ? '#FFD700' : '#888'};">${weeklyPct}%${met ? ' ✓' : ''}</span>
        </div>`;
    }
    
    html += '</div>';
    return html;
}

function getSessionOptionsHTML() {
    const options = [{val: "30", label: "30 Seconds"}, {val: "60", label: "1 Minute"}, {val: "120", label: "2 Minutes"}, {val: "300", label: "5 Minutes"}, {val: "infinity", label: "Open Ended (∞)"}];
    return options.map(opt => `<option value="${opt.val}" ${sessionValueStr === opt.val ? 'selected' : ''}>${opt.label}</option>`).join('');
}

function getDropdownHTML() {
    return `<div style="text-align:center;"><label for="sprint-select" style="color:#777; font-size:0.8rem; display:block; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Session Length</label><select id="sprint-select" class="modal-select">${getSessionOptionsHTML()}</select></div>`;
}

function closeModal() {
    isModalOpen = false; isInputBlocked = false; 
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('virtual-keyboard').classList.remove('hidden');
    const keyboard = document.getElementById('virtual-keyboard'); if(keyboard) keyboard.focus();
}

function showModalPanel() {
    document.getElementById('virtual-keyboard').classList.add('hidden');
    document.getElementById('modal').classList.remove('hidden');
}

function setModalTitle(text) {
    const bar = document.getElementById('modal-title-bar');
    document.getElementById('modal-title').innerText = text;
    if (text) bar.classList.remove('no-title');
    else bar.classList.add('no-title');
}

async function openMenuModal() {
    if (isGameActive) pauseGameForBreak();
    isModalOpen = true; isInputBlocked = false;
    modalGeneration++;
    modalActionCallback = () => { closeModal(); startGame(); };

    setModalTitle('Settings');

    let chapterOptions = "";
    if (bookMetadata && bookMetadata.chapters) {
        bookMetadata.chapters.forEach((chap) => {
            const num = chap.id.replace("chapter_", "");
            let sel = (num == currentChapterNum) ? "selected" : "";

            let label = `Ch. ${escapeHtml(num)}`;
            if(chap.title && chap.title != num) {
                if(chap.title.toLowerCase().startsWith('chapter')) label = escapeHtml(chap.title);
                else label = `Ch. ${escapeHtml(num)}: ${escapeHtml(chap.title)}`;
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
        <div class="menu-grid">
            <div class="menu-section">
                <div class="menu-label">Book</div>
                <select id="book-select" class="modal-select">${bookOptions}</select>
            </div>
            <div class="menu-section">
                <div class="menu-label">Chapter</div>
                <div style="display:flex; gap:8px;">
                    <select id="chapter-nav-select" class="modal-select" style="margin:0; flex-grow:1;">${chapterOptions}</select>
                    <button id="go-btn" class="modal-btn" style="width:auto; padding:0 16px; font-size:14px;">Go</button>
                </div>
            </div>
            <div class="menu-section">
                <div class="menu-label">Session Length</div>
                <select id="sprint-select" class="modal-select">${getSessionOptionsHTML()}</select>
            </div>
            <div class="menu-section">
                <div class="menu-label">Keyboard</div>
                <select id="layout-select" class="modal-select">
                    <option value="qwerty" ${currentLayout === 'qwerty' ? 'selected' : ''}>QWERTY</option>
                    <option value="dvorak" ${currentLayout === 'dvorak' ? 'selected' : ''}>Dvorak</option>
                </select>
            </div>
        </div>
    `;

    document.getElementById('layout-select').onchange = (e) => {
        setKeyboardLayout(e.target.value);
    };

    document.getElementById('book-select').onchange = async (e) => {
        const newBookId = e.target.value;
        if (newBookId === currentBookId) return;

        // Save current book's progress first
        await saveProgress(true);

        // Switch to new book
        currentBookId = newBookId;
        localStorage.setItem('currentBookId', currentBookId);
        const newUrl = `game.html?book=${encodeURIComponent(currentBookId)}`;
        window.history.replaceState(null, '', newUrl);

        // Load new book's metadata
        await loadBookMetadata();

        // Peek at saved progress (without loading chapter)
        let resumeChapter = 1;
        let resumeChar = 0;
        if (currentUser && !currentUser.isAnonymous) {
            try {
                const progSnap = await getDoc(doc(db, "users", currentUser.uid, "progress", currentBookId));
                if (progSnap.exists()) {
                    const data = progSnap.data();
                    if (data.chapter !== undefined && data.chapter !== null) resumeChapter = data.chapter;
                    if (data.charIndex !== undefined) resumeChar = data.charIndex;
                }
            } catch (e) { console.warn("Progress peek error:", e); }
        }

        // Rebuild chapter dropdown with new book's chapters
        let newChapterOptions = "";
        if (bookMetadata && bookMetadata.chapters) {
            bookMetadata.chapters.forEach((chap) => {
                const num = chap.id.replace("chapter_", "");
                let sel = (num == resumeChapter) ? "selected" : "";
                let label = `Chapter ${escapeHtml(num)}`;
                if (chap.title && chap.title != num) {
                    if (chap.title.toLowerCase().startsWith('chapter')) label = escapeHtml(chap.title);
                    else label = `Chapter ${escapeHtml(num)}: ${escapeHtml(chap.title)}`;
                }
                newChapterOptions += `<option value="${escapeHtml(num)}" ${sel}>${label}</option>`;
            });
        }

        const chapSelect = document.getElementById('chapter-nav-select');
        if (chapSelect) chapSelect.innerHTML = newChapterOptions;

        // Update state but don't load chapter yet — user hits Go
        currentChapterNum = resumeChapter;
        savedCharIndex = resumeChar;
        lastSavedIndex = resumeChar;
        currentCharIndex = 0;

        textStream.innerHTML = `<span style="color:#888;">Switched to <b>${escapeHtml(bookMetadata.title || currentBookId)}</b>. Pick a chapter and hit Go.</span>`;
        bookSwitchPending = true;
        isInputBlocked = true;
    };

    document.getElementById('go-btn').onclick = () => {
        const val = document.getElementById('chapter-nav-select').value;
        if (bookSwitchPending) {
            // After a book switch, just load the chapter — no restart prompt
            bookSwitchPending = false;
            // If they picked a different chapter than their saved one, reset position
            if (val != currentChapterNum) {
                savedCharIndex = 0;
            }
            currentChapterNum = val;
            currentCharIndex = 0;
            lastSavedIndex = 0;
            closeModal();
            textStream.innerHTML = "Loading...";
            loadChapter(val);
        } else if (val != currentChapterNum) {
            handleChapterSwitch(val);
        } else {
            if(confirm(`Restart Chapter ${val}?`)) switchChapterHot(val);
        }
    };

    const btn = document.getElementById('action-btn');
    btn.innerText = "Close";
    btn.onclick = () => {
        if (bookSwitchPending) {
            // They switched books but didn't hit Go — load the chapter first
            bookSwitchPending = false;
            const val = document.getElementById('chapter-nav-select').value;
            currentChapterNum = val;
            currentCharIndex = 0;
            lastSavedIndex = 0;
            closeModal();
            loadChapter(val);
        } else {
            closeModal();
            if (!isGameActive) startGame();
        }
    };
    btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
    showModalPanel();
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

// --- KEYBOARD LAYOUTS ---
const LAYOUTS = {
    qwerty: {
        rows:      [['q','w','e','r','t','y','u','i','o','p','[',']','\\'],['a','s','d','f','g','h','j','k','l',';',"'"],['z','x','c','v','b','n','m',',','.','/']],
        shiftRows: [['Q','W','E','R','T','Y','U','I','O','P','{','}','|'],['A','S','D','F','G','H','J','K','L',':','"'],['Z','X','C','V','B','N','M','<','>','?']]
    },
    dvorak: {
        rows:      [["'",',','.','p','y','f','g','c','r','l','/','+','\\'],['a','o','e','u','i','d','h','t','n','s','-'],[';','q','j','k','x','b','m','w','v','z']],
        shiftRows: [['"','<','>','P','Y','F','G','C','R','L','?','=','|'],['A','O','E','U','I','D','H','T','N','S','_'],[':', 'Q','J','K','X','B','M','W','V','Z']]
    }
};

let currentLayout = localStorage.getItem('keyboardLayout') || 'qwerty';
let rows = LAYOUTS[currentLayout].rows;
let shiftRows = LAYOUTS[currentLayout].shiftRows;

function setKeyboardLayout(layout) {
    if (!LAYOUTS[layout]) return;
    currentLayout = layout;
    localStorage.setItem('keyboardLayout', layout);
    rows = LAYOUTS[layout].rows;
    shiftRows = LAYOUTS[layout].shiftRows;
    createKeyboard();
    highlightCurrentChar();
}

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

// --- CELEBRATIONS ---
function createCelebrationCanvas() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    return canvas;
}

function launchConfetti() {
    const canvas = createCelebrationCanvas();
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const colors = ['#4B9CD3','#FFD700','#FF6B6B','#22c55e','#FF69B4','#FFA500','#9B59B6','#00CED1'];
    const pieces = [];

    for (let i = 0; i < 150; i++) {
        pieces.push({
            x: W * 0.5 + (Math.random() - 0.5) * W * 0.6,
            y: -20 - Math.random() * 100,
            w: 6 + Math.random() * 6,
            h: 10 + Math.random() * 8,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.15,
            vx: (Math.random() - 0.5) * 4,
            vy: 2 + Math.random() * 3,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.03 + Math.random() * 0.05
        });
    }

    // Show toast
    showGoalToast("🎉 Daily Goal Reached!", "#22c55e");

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, W, H);
        let alive = false;
        pieces.forEach(p => {
            p.x += p.vx + Math.sin(p.wobble) * 0.5;
            p.y += p.vy;
            p.vy += 0.04; // gravity
            p.rotation += p.rotSpeed;
            p.wobble += p.wobbleSpeed;
            p.vx *= 0.99;
            if (p.y < H + 50) {
                alive = true;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = Math.max(0, 1 - (frame / 200));
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }
        });
        frame++;
        if (alive && frame < 250) requestAnimationFrame(animate);
        else canvas.remove();
    }
    requestAnimationFrame(animate);
}

function launchFireworks() {
    const canvas = createCelebrationCanvas();
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const shells = [];
    const particles = [];
    const colors = ['#4B9CD3','#FFD700','#FF6B6B','#22c55e','#FF69B4','#FFA500','#9B59B6','#00CED1','#fff'];

    // Launch 5 shells staggered
    for (let i = 0; i < 5; i++) {
        setTimeout(() => {
            shells.push({
                x: W * (0.2 + Math.random() * 0.6),
                y: H,
                vy: -(8 + Math.random() * 4),
                targetY: H * (0.15 + Math.random() * 0.35),
                color: colors[Math.floor(Math.random() * colors.length)],
                exploded: false
            });
        }, i * 400);
    }

    showGoalToast("🎆 Weekly Goal Reached!", "#FFD700");

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, W, H);

        // Update shells
        shells.forEach(s => {
            if (s.exploded) return;
            s.y += s.vy;
            s.vy += 0.12;
            // Trail
            ctx.beginPath();
            ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            // Explode
            if (s.y <= s.targetY || s.vy >= 0) {
                s.exploded = true;
                const count = 60 + Math.floor(Math.random() * 40);
                const burstColor = s.color;
                for (let i = 0; i < count; i++) {
                    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
                    const speed = 2 + Math.random() * 4;
                    particles.push({
                        x: s.x, y: s.y,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        color: Math.random() > 0.3 ? burstColor : colors[Math.floor(Math.random() * colors.length)],
                        life: 1.0,
                        decay: 0.008 + Math.random() * 0.012,
                        size: 1.5 + Math.random() * 2
                    });
                }
            }
        });

        // Update particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.04;
            p.vx *= 0.98;
            p.life -= p.decay;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        frame++;
        const allExploded = shells.length >= 5 && shells.every(s => s.exploded);
        if (frame < 400 && !(allExploded && particles.length === 0)) {
            requestAnimationFrame(animate);
        } else {
            canvas.remove();
        }
    }
    requestAnimationFrame(animate);
}

function showGoalToast(message, color) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
        background: ${color}; color: #000; font-family: 'Courier Prime', monospace;
        font-weight: 700; font-size: 1.2rem; padding: 14px 28px;
        border-radius: 8px; z-index: 10000; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        animation: toastIn 0.4s ease-out;
    `;
    // Add keyframes if not already present
    if (!document.getElementById('toast-keyframes')) {
        const style = document.createElement('style');
        style.id = 'toast-keyframes';
        style.textContent = `
            @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            @keyframes toastOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-20px); } }
        `;
        document.head.appendChild(style);
    }
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.5s ease-in forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

window.onload = init;
