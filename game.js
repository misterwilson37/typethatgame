// v2.7.0 - Practice Mode with Gemini AI
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc, getDocs, collection, addDoc, query, orderBy, limit, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

const VERSION = "2.9.0";
const DEFAULT_BOOK = "wizard_of_oz";
const IDLE_THRESHOLD = 2000;
const AFK_THRESHOLD = 5000; // 5 Seconds to Auto-Pause
const SPRINT_COOLDOWN_MS = 1500;
const SPAM_THRESHOLD = 5;

// Hand Guide
let handGuideEnabled = localStorage.getItem('ttb_handGuide') === 'true';
let handGuideRainbow = localStorage.getItem('ttb_handGuideRainbow') !== 'false'; // default true
let handGuideColor = localStorage.getItem('ttb_handGuideColor') || '#4FC3F7';
let fingerMap = {};
const FINGER_COLORS = {
    'left-pinky':   '#FF69B4', // pink
    'left-ring':    '#E53935', // red
    'left-middle':  '#FF9800', // orange
    'left-index':   '#FDD835', // yellow
    'right-index':  '#43A047', // green
    'right-middle': '#1E88E5', // blue
    'right-ring':   '#8E24AA', // purple
    'right-pinky':  '#4FC3F7', // baby blue
    'left-thumb':   '#FDD835', // yellow (same as index)
    'right-thumb':  '#43A047', // green (same as index)
};

function getFingerColor(fingerName) {
    if (handGuideRainbow) return FINGER_COLORS[fingerName] || '#4FC3F7';
    return handGuideColor;
}

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
let furthestChapter = 1;
let furthestCharIndex = 0;
let autoStartNext = false; // skip start modal when advancing chapters
let ggRealCharIndex = -1;  // real position before Game Genie warps
let ggAllowMistakes = false; // bypass mistake limit (session only, not persisted)
let ggBypassIdle = false; // bypass AFK/idle timer (session only)

// Stats
let sessionLimit = 30;
let sessionValueStr = "30";
const savedSession = localStorage.getItem('ttb_sessionLength');
if (savedSession) { sessionValueStr = savedSession; sessionLimit = (savedSession === 'infinity') ? 'infinity' : parseInt(savedSession); }
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
let backspaceOrigin = -1; // tracks where we were when backspacing started
let bookSwitchPending = false;
let anonSprintCount = 0;
let anonTotalSeconds = 0;
let anonPromptShown = false;
let anonLoginInProgress = false; // prevent auth handler from reloading during anon prompt
let modalActionCallback = null;
let lastInputTime = 0; let timeAccumulator = 0;
let wpmHistory = []; let accuracyHistory = [];
let currentLetterStatus = 'clean';

// Streak tracking
let currentStreak = 0;
let bestStreak = 0;
let streakMilestone = 0; // last celebrated milestone

// Most-missed characters (session-wide)
let missedCharsMap = {};

// Sprint history (session-wide)
let sprintHistory = [];

// Completed chapters
let completedChapters = new Set();

// Anonymous session tracking for retroactive save
let anonCharsTyped = 0;
let anonMistakes = 0;

// Leaderboard
let userInitials = '';
let leaderboardOptOut = false;
let leaderboardCache = {}; // { category: [entries], ... }
let leaderboardCacheTime = 0;

// Practice Mode
const functions = getFunctions();
const generatePractice = httpsCallable(functions, 'generatePractice');
let isPracticeMode = false;
let practiceRealBookData = null;    // saved real book state
let practiceRealChapterNum = null;
let practiceRealCharIndex = null;
let practiceRealSavedCharIndex = null;
let practiceRealLastSavedIndex = null;
let practiceRealFurthestChapter = null;
let practiceRealFurthestCharIndex = null;
let practiceProblemChars = [];      // the chars that triggered this practice
let practicePrompt = '';            // the prompt sent to Gemini
let practiceText = '';              // the generated text
let practiceMissedSnapshot = {};   // snapshot of missedCharsMap at practice start
let practiceTypingAccumulator = 0;  // seconds typed since last practice (or session start)
let hasDonePractice = false;        // whether practice has been used this session
const PRACTICE_FIRST_UNLOCK = 150;  // 2.5 min before first practice
const PRACTICE_COOLDOWN = 60;       // 1 min between subsequent practices

// Profanity filter for initials (covers letter substitutions kids try)
const BLOCKED_INITIALS = new Set([
    'ASS','AZZ','A55','BCH','BJ','BJB','BJS','CNT','COC','COK','CUM','CUK',
    'DCK','DIK','DIX','DMN','DNG','DIC','FAG','FAT','FCK','FKU','FUC','FUK','FUQ',
    'GAY','GEI','GEY','GOD','HOR','JEW','JIZ','JZZ','KKK','KIK','KYK',
    'LSD','MFF','NGR','NIG','NGA','NUT','PIS','PMS','POO','PEE','PUS',
    'RAP','SEX','SHT','SLT','STD','SUK','SUC','TIT','THC','TWT','VAG',
    'WTF','WOP','XTC','XXX',
]);

function isInitialsClean(val) {
    const upper = val.toUpperCase();
    if (BLOCKED_INITIALS.has(upper)) return false;
    // Also check with common substitutions reversed (0→O, 1→I, 3→E, 5→S, etc.)
    const normalized = upper
        .replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E')
        .replace(/4/g, 'A').replace(/5/g, 'S').replace(/8/g, 'B');
    if (normalized !== upper && BLOCKED_INITIALS.has(normalized)) return false;
    return true;
}

function getDefaultInitials() {
    if (!currentUser || !currentUser.displayName) return '';
    const parts = currentUser.displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else if (parts.length === 1 && parts[0].length >= 2) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return '';
}

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const timerDisplay = document.getElementById('timer-display');
const accDisplay = document.getElementById('acc-display');
const wpmDisplay = document.getElementById('wpm-display');
const streakDisplay = document.getElementById('streak-display');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const trophyBtn = document.getElementById('trophy-btn');
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

    // Game Genie button (admin only, hidden until auth confirms)
    if (!document.getElementById('genie-btn')) {
        const gg = document.createElement('button');
        gg.id = 'genie-btn';
        gg.className = 'hidden';
        gg.innerHTML = '<span class="gg-flame">🔥</span><span class="gg-fire">G</span><span class="gg-fire gg-fire2">G</span><span class="gg-flame">🔥</span>';
        gg.title = 'Game Genie';
        gg.onclick = openGameGenie;
        document.body.appendChild(gg);
    }

    createKeyboard();
    buildFingerMap();
    createHandGuide();
    setupAuthListeners();
    trophyBtn.onclick = () => openLeaderboard();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            updateAuthUI(true);
            // Show Game Genie for admins
            const ggBtn = document.getElementById('genie-btn');
            if (ggBtn) ggBtn.classList.toggle('hidden', !ADMIN_EMAILS.includes(user.email));
            // Skip full reload if login came from anon prompt (we handle it ourselves)
            if (anonLoginInProgress) return;
            try {
                await loadBookMetadata();
                await loadUserProgress();
                await loadUserStats();
                await loadGoals();
                await loadInitials();
            } catch(e) { console.error("Init Error:", e); }
            trophyBtn.classList.remove('hidden');
        } else {
            // No anonymous sign-in — just load the book as read-only
            currentUser = null;
            updateAuthUI(false);
            const ggBtn = document.getElementById('genie-btn');
            if (ggBtn) ggBtn.classList.add('hidden');
            trophyBtn.classList.add('hidden');
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
            if (data.completedChapters && Array.isArray(data.completedChapters)) {
                completedChapters = new Set(data.completedChapters.map(String));
            }
            // Load furthest tracking
            if (data.furthestChapter !== undefined) furthestChapter = data.furthestChapter;
            else furthestChapter = currentChapterNum;
            if (data.furthestCharIndex !== undefined) furthestCharIndex = data.furthestCharIndex;
            else furthestCharIndex = savedCharIndex;
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

    if (autoStartNext) {
        autoStartNext = false;
        startGame();
    } else if (!isGameActive) {
        showStartModal(btnLabel);
    }
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
        localStorage.setItem('ttb_sessionLength', sessionValueStr);
    }

    sprintSeconds = 0; sprintMistakes = 0; sprintCharStart = currentCharIndex;
    activeSeconds = 0; timeAccumulator = 0; lastInputTime = Date.now();
    consecutiveMistakes = 0; backspaceOrigin = -1;
    currentStreak = 0; streakMilestone = 0;
    updateStreak(false); // reset display
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
    if (now - lastInputTime > AFK_THRESHOLD && !isModalOpen && !ggBypassIdle) {
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

function updateStreak(correct) {
    if (correct) {
        currentStreak++;
        if (currentStreak > bestStreak) bestStreak = currentStreak;
        // Check milestones: 25, 50, 100, 200, 500
        const milestones = [25, 50, 100, 200, 500];
        for (const m of milestones) {
            if (currentStreak === m && m > streakMilestone) {
                streakMilestone = m;
                streakDisplay.classList.add('streak-pop');
                setTimeout(() => streakDisplay.classList.remove('streak-pop'), 300);
                break;
            }
        }
    } else {
        currentStreak = 0;
    }
    // Update display
    streakDisplay.textContent = `🔥 ${currentStreak}`;
    streakDisplay.className = currentStreak >= 100 ? 'streak-fire' :
                              currentStreak >= 50  ? 'streak-hot' :
                              currentStreak >= 25  ? 'streak-warm' : 'streak-cold';
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
        // Skip if user is typing in an input/select (e.g. Game Genie fields)
        const activeTag = e.target && e.target.tagName;
        if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') return;

        let shouldStart = false;
        let shouldSkip = false;

        const targetChar = fullText[currentCharIndex];

        // End of chapter — Enter triggers the modal action (next chapter)
        if (currentCharIndex >= fullText.length && e.key === 'Enter' && modalActionCallback) {
            e.preventDefault();
            const cb = modalActionCallback;
            modalActionCallback = null;
            cb();
            return;
        }

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
            if (backspaceOrigin < 0) backspaceOrigin = currentCharIndex;
            currentEl.classList.remove('error-state');
        } else if (currentCharIndex > sprintCharStart) {
            // Additional backspaces: move back to previous char
            if (backspaceOrigin < 0) backspaceOrigin = currentCharIndex;
            currentCharIndex--;
            currentLetterStatus = 'fixed';
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
        anonCharsTyped++;
        consecutiveMistakes = 0;

        currentEl.classList.remove('active'); currentEl.classList.remove('error-state');
        if (currentLetterStatus === 'clean') currentEl.classList.add('done-perfect');
        else if (currentLetterStatus === 'fixed') currentEl.classList.add('done-fixed');
        else currentEl.classList.add('done-dirty');

        currentCharIndex++;
        // Keep 'fixed' status until we pass the backspace origin point
        if (backspaceOrigin >= 0 && currentCharIndex <= backspaceOrigin) {
            currentLetterStatus = 'fixed';
        } else {
            backspaceOrigin = -1;
            currentLetterStatus = 'clean';
        }

        if (['.', '!', '?', '\n'].includes(targetChar)) saveProgress();
        else if (['"', "'"].includes(targetChar) && currentCharIndex >= 2) {
            const prevChar = fullText[currentCharIndex - 2];
            if (['.', '!', '?'].includes(prevChar)) saveProgress();
        }

        updateRunningWPM(); updateRunningAccuracy(true); updateStreak(true);

        if (currentCharIndex >= fullText.length) { finishChapter(); return; }

        if (isOvertime) {
            // Don't stop near end of chapter — let them finish it
            const remaining = fullText.length - currentCharIndex;
            if (remaining > 200 && ['.', '!', '?', '\n'].includes(targetChar)) {
                const nextChar = fullText[currentCharIndex];
                if (nextChar !== '"' && nextChar !== "'") { triggerStop(); return; }
            }
        }

        flashFingerPressed();
        highlightCurrentChar(); centerView();
    } else {
        mistakes++; sprintMistakes++;
        consecutiveMistakes++;
        anonMistakes++;

        statsData.mistakesToday++; statsData.mistakesWeek++;
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        const errEl = document.getElementById(`char-${currentCharIndex}`);
        if(errEl) errEl.classList.add('error-state');
        flashKey(key); updateRunningAccuracy(false); updateStreak(false);

        // Track missed characters
        const missKey = targetChar === ' ' ? 'Space' : targetChar === '\n' ? 'Enter' : targetChar;
        missedCharsMap[missKey] = (missedCharsMap[missKey] || 0) + 1;

        if (consecutiveMistakes >= SPAM_THRESHOLD && !ggAllowMistakes) {
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
    resetModalFooter();

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

    let statsHtml = '';
    if (isAfk) {
        const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
        const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
        const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
        const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);
        if (statsData.secondsToday > 0 || statsData.secondsWeek > 0) {
            statsHtml = `
                <div class="cumulative-row" style="margin-top:10px;">
                    <span>Today: ${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)</span>
                    <span>Week: ${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)</span>
                </div>
                ${getGoalProgressHTML()}
            `;
        }
    }

    document.getElementById('modal-body').innerHTML = `
        <div style="font-size: 1.1em;">
            ${msg}<br>
            Please type <b style="color: #D32F2F; font-size: 1.5em; border: 1px solid #ccc; padding: 2px 8px; border-radius: 4px;">${friendlyKey}</b> to resume.
            ${hintHtml}
        </div>
        ${statsHtml}
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
    updateHandGuide();
}

function updateImageDisplay() {
    const p = document.getElementById('image-panel');
    if(p) p.style.display = 'none';
}

// Returns true if position A is ahead of position B in the book
function isPositionAhead(chapA, idxA, chapB, idxB) {
    const a = parseInt(chapA) || 0;
    const b = parseInt(chapB) || 0;
    return a > b || (a === b && idxA > idxB);
}

async function saveProgress(force = false) {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        // Don't save book position during practice mode
        if (!isPracticeMode) {
            if (currentCharIndex > lastSavedIndex || force) {
                // Update furthest tracking (only moves forward)
                if (isPositionAhead(currentChapterNum, currentCharIndex, furthestChapter, furthestCharIndex)) {
                    furthestChapter = currentChapterNum;
                    furthestCharIndex = currentCharIndex;
                }
                await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
                    chapter: currentChapterNum,
                    charIndex: currentCharIndex,
                    furthestChapter: furthestChapter,
                    furthestCharIndex: furthestCharIndex,
                    lastUpdated: new Date()
                }, { merge: true });
                lastSavedIndex = currentCharIndex;
            }
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

async function saveCompletedChapters() {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
            completedChapters: Array.from(completedChapters)
        }, { merge: true });
    } catch(e) { console.warn("Save completed chapters failed:", e); }
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

async function pauseGameForBreak() {
    isGameActive = false; clearInterval(timerInterval); saveProgress();
    const charsTyped = currentCharIndex - sprintCharStart;
    const sprintMinutes = sprintSeconds / 60;
    const sprintWPM = (sprintMinutes > 0) ? Math.round((charsTyped / 5) / sprintMinutes) : 0;
    const sprintTotalEntries = charsTyped + sprintMistakes;
    const sprintAcc = (sprintTotalEntries > 0) ? Math.round((charsTyped / sprintTotalEntries) * 100) : 100;

    // Log this session
    logSession(sprintSeconds, charsTyped, sprintMistakes, sprintWPM, sprintAcc);

    // Accumulate typing time for practice unlock
    practiceTypingAccumulator += sprintSeconds;

    // Track anonymous usage
    anonSprintCount++;
    anonTotalSeconds += sprintSeconds;

    // Record sprint in history
    sprintHistory.push({ wpm: sprintWPM, acc: sprintAcc, time: sprintSeconds });

    // Update leaderboard and get placements
    const placements = await updateLeaderboard();

    // Check if anon user should be prompted to log in
    if (checkAnonLoginPrompt()) {
        showAnonLoginPrompt();
        return;
    }

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    const stats = {
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc,
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`,
        placements: placements || []
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

function getMissedCharsHTML() {
    const entries = Object.entries(missedCharsMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (entries.length === 0) return '';
    const pills = entries.map(([ch, count]) => 
        `<span style="display:inline-block; background:#fff0f0; border:1px solid #ffcccc; border-radius:3px; padding:1px 6px; margin:0 2px; font-weight:bold; color:#D32F2F;">${ch} <small style="color:#999;">×${count}</small></span>`
    ).join('');
    const canPractice = currentUser && !currentUser.isAnonymous && !isPracticeMode;
    const practiceThreshold = hasDonePractice ? PRACTICE_COOLDOWN : PRACTICE_FIRST_UNLOCK;
    const practiceReady = practiceTypingAccumulator >= practiceThreshold;
    let practiceBtn = '';
    if (canPractice && practiceReady) {
        practiceBtn = ` <button id="practice-btn" class="practice-btn" title="AI-generated practice focusing on your weak spots">✨ Practice</button>`;
    } else if (canPractice && !practiceReady) {
        const remaining = Math.ceil((practiceThreshold - practiceTypingAccumulator) / 60);
        practiceBtn = ` <span style="font-size:0.85em; color:#aaa;" title="Keep typing to unlock practice mode">✨ Practice unlocks in ~${remaining}m</span>`;
    }
    return `<div style="font-size:0.8em; color:#888; margin:4px 0;">Watch out for: ${pills}${practiceBtn}</div>`;
}

function getPracticeSummaryHTML() {
    if (!practiceText || practiceProblemChars.length === 0) return '';

    // Compute practice-only misses by diffing with snapshot
    const practiceMisses = {};
    Object.entries(missedCharsMap).forEach(([ch, count]) => {
        const prev = practiceMissedSnapshot[ch] || 0;
        if (count > prev) practiceMisses[ch] = count - prev;
    });

    // Count occurrences of each focus char in practice text (case-insensitive)
    const results = practiceProblemChars.map(ch => {
        const lower = ch.toLowerCase();
        const upper = ch.toUpperCase();
        const displayCh = ch === 'Space' ? ' ' : ch === 'Enter' ? '\n' : ch;
        let total = 0;
        for (let i = 0; i < practiceText.length; i++) {
            const c = practiceText[i];
            if (c === displayCh || c === lower || c === upper) total++;
        }
        const missed = practiceMisses[ch] || 0;
        const hit = Math.max(0, total - missed);
        const acc = total > 0 ? Math.round((hit / total) * 100) : 100;
        return { ch, total, hit, missed, acc };
    }).filter(r => r.total > 0);

    if (results.length === 0) return '';

    // Grade each character
    const gradeChar = (acc) => {
        if (acc === 100) return { emoji: '⭐', color: '#FFD700', label: 'Perfect!' };
        if (acc >= 90) return { emoji: '🔥', color: '#FF6600', label: 'Great' };
        if (acc >= 75) return { emoji: '👍', color: '#43A047', label: 'Good' };
        if (acc >= 50) return { emoji: '💪', color: '#1E88E5', label: 'Keep at it' };
        return { emoji: '🎯', color: '#E53935', label: 'Needs work' };
    };

    // Overall practice grade
    const totalAll = results.reduce((s, r) => s + r.total, 0);
    const hitAll = results.reduce((s, r) => s + r.hit, 0);
    const overallAcc = totalAll > 0 ? Math.round((hitAll / totalAll) * 100) : 100;
    const overall = gradeChar(overallAcc);

    const rows = results.map(r => {
        const g = gradeChar(r.acc);
        const display = r.ch === 'Space' ? '␣' : r.ch;
        return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
            <span style="font-weight:bold; font-size:1.1em; width:24px; text-align:center; color:#333;">${escapeHtml(display)}</span>
            <div style="flex:1; height:14px; background:#eee; border-radius:7px; overflow:hidden;">
                <div style="height:100%; width:${r.acc}%; background:${g.color}; border-radius:7px; transition:width 0.3s;"></div>
            </div>
            <span style="font-size:0.85em; min-width:42px; text-align:right; color:${g.color}; font-weight:bold;">${r.acc}%</span>
            <span style="font-size:0.8em;">${g.emoji}</span>
        </div>`;
    }).join('');

    return `<div style="margin:8px 0; padding:8px 12px; background:#f8f8f8; border-radius:6px;">
        <div style="text-align:center; font-size:0.85em; margin-bottom:6px;">
            <span style="font-weight:bold;">Focus Characters</span>
            <span style="margin-left:8px; color:${overall.color}; font-weight:bold;">${overall.emoji} ${overallAcc}% ${overall.label}</span>
        </div>
        ${rows}
    </div>`;
}

function getPlacementsHTML(placements) {
    if (!placements || placements.length === 0) return '';
    const rows = placements.map(p => {
        let trophy, color;
        if (p.rank === 1) { trophy = '🥇'; color = '#FFD700'; }
        else if (p.rank === 2) { trophy = '🥈'; color = '#C0C0C0'; }
        else if (p.rank === 3) { trophy = '🥉'; color = '#CD7F32'; }
        else { trophy = '🏆'; color = '#4B9CD3'; }
        const catName = p.category.label.split(' ').slice(1).join(' ') || p.category.label;
        return `<div class="trophy-row"><span class="trophy-icon">${trophy}</span><span class="trophy-label" style="color:${color};">#${p.rank} ${catName}</span></div>`;
    }).join('');
    return `<div class="trophy-panel"><div class="trophy-header">🏆</div>${rows}</div>`;
}

function getSprintHistoryHTML() {
    if (sprintHistory.length <= 1) return '';
    const rows = sprintHistory.map((s, i) => {
        const label = i === sprintHistory.length - 1 ? '<b>→</b>' : `${i + 1}`;
        return `<span style="color:#999;">${label}</span> ${s.wpm}<small>wpm</small> ${s.acc}<small>%</small>`;
    }).join(' · ');
    return `<div style="font-size:0.75em; color:#777; margin:4px 0; line-height:1.6;">Sprints: ${rows}</div>`;
}

async function finishChapter() {
    isGameActive = false; clearInterval(timerInterval);

    // Practice mode: log session and offer to return
    if (isPracticeMode) {
        const charsTyped = currentCharIndex - sprintCharStart;
        const sprintMinutes = sprintSeconds / 60;
        const sprintWPM = (sprintMinutes > 0) ? Math.round((charsTyped / 5) / sprintMinutes) : 0;
        const sprintTotalEntries = charsTyped + sprintMistakes;
        const sprintAcc = (sprintTotalEntries > 0) ? Math.round((charsTyped / sprintTotalEntries) * 100) : 100;
        logSession(sprintSeconds, charsTyped, sprintMistakes, sprintWPM, sprintAcc);
        await logPracticeSession(sprintWPM, sprintAcc, sprintSeconds, charsTyped, sprintMistakes);

        const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
        const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
        const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
        const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

        // Build practice-specific summary
        const summaryHTML = getPracticeSummaryHTML();

        isModalOpen = true; isInputBlocked = false;
        setModalTitle('');
        document.getElementById('modal-body').innerHTML = `
            <div>
                <div class="stats-title">✨ Practice Complete!</div>
                <div class="stats-inline">
                    <span class="si-val">${sprintWPM} <small>WPM</small></span>
                    <span class="si-dot">·</span>
                    <span class="si-val">${sprintAcc}% <small>Acc</small></span>
                    <span class="si-dot">·</span>
                    <span class="si-val">${formatTime(sprintSeconds)}</span>
                </div>
                ${summaryHTML}
                <div class="cumulative-row">
                    <span>Today: ${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)</span>
                    <span>Week: ${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)</span>
                </div>
                <div class="start-hint" style="margin-top:6px;">Press Enter to return</div>
            </div>
        `;
        resetModalFooter();
        const btn = document.getElementById('action-btn');
        btn.innerText = '📖 Return to Book'; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
        btn.onclick = () => { closeModal(); exitPracticeMode(); };
        modalActionCallback = () => { closeModal(); exitPracticeMode(); };
        showModalPanel();
        return;
    }

    let nextChapterId = null;
    let nextChapterTitle = "";
    if (bookMetadata && bookMetadata.chapters) {
        const currentIdx = bookMetadata.chapters.findIndex(c => c.id == "chapter_" + currentChapterNum);
        if (currentIdx !== -1 && currentIdx + 1 < bookMetadata.chapters.length) {
            const nextChap = bookMetadata.chapters[currentIdx + 1];
            nextChapterId = nextChap.id.replace("chapter_", "");
            nextChapterTitle = nextChap.title || "";
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

    // Accumulate typing time for practice unlock
    practiceTypingAccumulator += sprintSeconds;

    const todayWPM = calculateAverageWPM(statsData.charsToday, statsData.secondsToday);
    const todayAcc = calculateAverageAcc(statsData.charsToday, statsData.mistakesToday);
    const weekWPM = calculateAverageWPM(statsData.charsWeek, statsData.secondsWeek);
    const weekAcc = calculateAverageAcc(statsData.charsWeek, statsData.mistakesWeek);

    let title = `📖 Chapter ${currentChapterNum} Complete!`;

    // Mark chapter as completed
    completedChapters.add(String(currentChapterNum));
    saveCompletedChapters();
    const placements = await updateLeaderboard();

    const stats = {
        time: sprintSeconds, wpm: sprintWPM, acc: sprintAcc,
        today: `${formatTime(statsData.secondsToday)} (${todayWPM} WPM | ${todayAcc}%)`,
        week: `${formatTime(statsData.secondsWeek)} (${weekWPM} WPM | ${weekAcc}%)`,
        placements: placements || []
    };
    if (dailyGoalCelebrated && goals.dailySeconds > 0 && statsData.secondsToday - sprintSeconds < goals.dailySeconds) {
        title = `🎉 Chapter ${currentChapterNum} Complete + Daily Goal!`;
    }
    if (weeklyGoalCelebrated && goals.weeklySeconds > 0 && statsData.secondsWeek - sprintSeconds < goals.weeklySeconds) {
        title = `🎆 Chapter ${currentChapterNum} Complete + Weekly Goal!`;
    }

    // Format the next chapter label for the button
    let nextLabel = `Ch. ${nextChapterId}`;
    if (nextChapterTitle && nextChapterTitle != nextChapterId) {
        if (nextChapterTitle.toLowerCase().startsWith('chapter')) nextLabel = nextChapterTitle;
        else nextLabel = `Ch. ${nextChapterId}: ${nextChapterTitle}`;
    }

    showStatsModal(title, stats, `Next → ${nextLabel}`, async () => {
        advanceToNextChapter();
    }, 'Press Enter to continue', true);
}

async function advanceToNextChapter() {
    let nextChapterId = null;
    if (bookMetadata && bookMetadata.chapters) {
        const currentIdx = bookMetadata.chapters.findIndex(c => c.id == "chapter_" + currentChapterNum);
        if (currentIdx !== -1 && currentIdx + 1 < bookMetadata.chapters.length) {
            nextChapterId = bookMetadata.chapters[currentIdx + 1].id.replace("chapter_", "");
        }
    }
    if (!nextChapterId) {
        if (!isNaN(currentChapterNum)) nextChapterId = parseFloat(currentChapterNum) + 1;
        else nextChapterId = 1;
    }
    await saveProgress(true);
    currentChapterNum = nextChapterId;
    savedCharIndex = 0; currentCharIndex = 0; lastSavedIndex = 0;
    if (currentUser && !currentUser.isAnonymous) {
        await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
            chapter: currentChapterNum, charIndex: 0
        }, { merge: true });
    }
    autoStartNext = true;
    loadChapter(nextChapterId);
}

function getHeaderHTML() {
    if (isPracticeMode) {
        updateBookInfoBar('✨ Practice Mode', 'AI-Generated Exercise');
        return `<div class="modal-header-compact"><span class="mh-book">✨ Practice Mode</span> <span class="mh-sep">—</span> <span class="mh-chap">Targeted Exercise</span></div>`;
    }
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
    resetModalFooter();

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

    // Check if furthest point is ahead — offer jump link
    let jumpHtml = '';
    if (currentUser && !currentUser.isAnonymous && 
        isPositionAhead(furthestChapter, furthestCharIndex, currentChapterNum, currentCharIndex)) {
        let chapLabel = `Ch. ${furthestChapter}`;
        if (bookMetadata && bookMetadata.chapters) {
            const chap = bookMetadata.chapters.find(c => c.id === "chapter_" + furthestChapter);
            if (chap && chap.title && chap.title != furthestChapter) {
                if (chap.title.toLowerCase().startsWith('chapter')) chapLabel = chap.title;
                else chapLabel = `Ch. ${furthestChapter}: ${chap.title}`;
            }
        }
        jumpHtml = `<div style="margin:4px 0;"><a href="#" id="jump-furthest" style="color:var(--carolina-blue); font-size:0.85em;">📚 Jump to furthest point (${escapeHtml(chapLabel)})</a></div>`;
    }

    document.getElementById('modal-body').innerHTML = `
        ${statsSection}
        ${jumpHtml}
        <div class="start-controls">
            ${getDropdownHTML()}
            <div class="start-hint">Type first character to start · ESC to pause</div>
        </div>
    `;

    // Wire jump link
    const jumpLink = document.getElementById('jump-furthest');
    if (jumpLink) {
        jumpLink.onclick = async (e) => {
            e.preventDefault();
            currentChapterNum = furthestChapter;
            savedCharIndex = furthestCharIndex;
            lastSavedIndex = furthestCharIndex;
            closeModal();
            await loadChapter(furthestChapter);
        };
    }

    const btn = document.getElementById('action-btn');
    btn.innerText = btnText; btn.onclick = startGame; btn.disabled = false; btn.style.display = 'inline-block'; btn.style.opacity = '1';
    showModalPanel();
}

function showStatsModal(title, stats, btnText, callback, hint, instant) {
    isModalOpen = true; isInputBlocked = true;
    modalActionCallback = () => { closeModal(); if(callback) callback(); };
    setModalTitle('');

    const trophyHTML = getPlacementsHTML(stats.placements);
    const hasTrophies = trophyHTML.length > 0;

    document.getElementById('modal-body').innerHTML = `
        <div class="${hasTrophies ? 'stats-with-trophies' : ''}">
            <div class="${hasTrophies ? 'stats-main' : ''}">
                <div class="stats-title">${title}</div>
                <div class="stats-inline">
                    <span class="si-val">${stats.wpm} <small>WPM</small></span>
                    <span class="si-dot">·</span>
                    <span class="si-val">${stats.acc}% <small>Acc</small></span>
                    <span class="si-dot">·</span>
                    <span class="si-val">${formatTime(stats.time)}</span>
                    ${bestStreak > 0 ? `<span class="si-dot">·</span><span class="si-val">🔥${bestStreak}</span>` : ''}
                </div>
                <div class="cumulative-row">
                    <span>Today: ${stats.today}</span>
                    <span>Week: ${stats.week}</span>
                </div>
                ${getGoalProgressHTML()}
                ${getSprintHistoryHTML()}
                ${getMissedCharsHTML()}
                ${hint ? `<div class="start-hint" id="modal-hint" style="display:none;">${hint}</div>` : ''}
            </div>
            ${trophyHTML}
        </div>
    `;

    // Add sprint length dropdown to footer alongside button
    const returnLink = isPracticeMode ? `<a href="#" id="practice-return" style="color:var(--carolina-blue); font-size:0.75em;">↩ Return to Book</a>` : '';
    document.getElementById('modal-footer').innerHTML = `
        <div class="modal-footer-row">
            <select id="sprint-select" class="modal-select modal-select-sm">${getSessionOptionsHTML()}</select>
            <button id="action-btn" class="modal-btn">Action</button>
        </div>
        ${returnLink}
    `;

    // Wire practice button if present
    const practiceBtn = document.getElementById('practice-btn');
    if (practiceBtn) {
        practiceBtn.onclick = () => startPracticeMode();
    }
    // Wire return-to-book link
    const returnEl = document.getElementById('practice-return');
    if (returnEl) {
        returnEl.onclick = (e) => { e.preventDefault(); exitPracticeMode(); };
    }
    // Save sprint changes immediately so smart-start (which closes modal first) sees them
    document.getElementById('sprint-select').onchange = (e) => {
        sessionValueStr = e.target.value;
        sessionLimit = (sessionValueStr === 'infinity') ? 'infinity' : parseInt(sessionValueStr);
        localStorage.setItem('ttb_sessionLength', sessionValueStr);
    };

    const btn = document.getElementById('action-btn');
    if (instant) {
        btn.innerText = btnText; btn.onclick = modalActionCallback; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
        isInputBlocked = false;
        const hintEl = document.getElementById('modal-hint');
        if (hintEl) hintEl.style.display = '';
    } else {
        btn.innerText = "Wait..."; btn.onclick = modalActionCallback; btn.disabled = true; btn.style.opacity = '0.5'; btn.style.display = 'inline-block';
        const gen = ++modalGeneration;
        setTimeout(() => {
            if (modalGeneration !== gen) return;
            isInputBlocked = false;
            if(document.getElementById('action-btn')) {
                const b = document.getElementById('action-btn');
                b.style.opacity = '1'; b.innerText = btnText; b.disabled = false;
            }
            const hintEl = document.getElementById('modal-hint');
            if (hintEl) hintEl.style.display = '';
        }, SPRINT_COOLDOWN_MS);
    }
    showModalPanel();
}


function checkAnonLoginPrompt() {
    if (anonPromptShown) return false;
    if (currentUser) return false; // already logged in
    if (anonSprintCount >= 2 || anonTotalSeconds >= 150) {
        anonPromptShown = true;
        return true;
    }
    return false;
}

function showAnonLoginPrompt() {
    isModalOpen = true; isInputBlocked = true;
    modalActionCallback = null;
    setModalTitle('');
    resetModalFooter();

    document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center;">
            <div class="stats-title">Nice work! 👏</div>
            <div style="font-size:0.95em; color:#555; margin: 8px 0;">
                You're making real progress! Sign in to save your work so you can pick up right where you left off next time.
            </div>
        </div>
    `;

    const btn = document.getElementById('action-btn');
    btn.innerText = 'Wait...'; btn.disabled = true; btn.style.opacity = '0.5'; btn.style.display = 'inline-block';
    const signInAction = async () => {
        try {
            anonLoginInProgress = true;
            await signInWithPopup(auth, new GoogleAuthProvider());
        } catch (e) {
            anonLoginInProgress = false;
            // User cancelled login — just continue
            closeModal();
            showStartModal("Continue");
            return;
        }

        // Login succeeded — retroactively save anonymous session time
        if (currentUser && !currentUser.isAnonymous) {
            try {
                // Apply anonymous typing stats to their account
                const today = new Date();
                const dateStr = today.toISOString().split('T')[0];
                const weekStart = getWeekStart(today);

                // Load existing stats first
                const statsRef = doc(db, "users", currentUser.uid, "stats", "time_tracking");
                const statsSnap = await getDoc(statsRef);
                if (statsSnap.exists()) {
                    const data = statsSnap.data();
                    if (data.lastDate === dateStr) {
                        statsData.secondsToday = (data.secondsToday || 0) + statsData.secondsToday;
                        statsData.charsToday = (data.charsToday || 0) + statsData.charsToday;
                        statsData.mistakesToday = (data.mistakesToday || 0) + statsData.mistakesToday;
                    }
                    if (data.weekStart === weekStart) {
                        statsData.secondsWeek = (data.secondsWeek || 0) + statsData.secondsWeek;
                        statsData.charsWeek = (data.charsWeek || 0) + statsData.charsWeek;
                        statsData.mistakesWeek = (data.mistakesWeek || 0) + statsData.mistakesWeek;
                    }
                }
                statsData.lastDate = dateStr;
                statsData.weekStart = weekStart;
                await setDoc(statsRef, statsData, { merge: true });

                // Load goals since auth handler was skipped
                await loadGoals();
                const initialsPromptShown = await loadInitials();
                trophyBtn.classList.remove('hidden');

                // Read their saved progress BEFORE writing anything to it
                const progRef = doc(db, "users", currentUser.uid, "progress", currentBookId);
                const progSnap = await getDoc(progRef);
                let savedChap = null, savedIdx = 0, savedFurthestChap = null, savedFurthestIdx = 0;
                if (progSnap.exists()) {
                    const data = progSnap.data();
                    savedChap = data.chapter || null;
                    savedIdx = data.charIndex || 0;
                    savedFurthestChap = data.furthestChapter || savedChap;
                    savedFurthestIdx = data.furthestCharIndex || savedIdx;
                    if (data.completedChapters && Array.isArray(data.completedChapters)) {
                        completedChapters = new Set(data.completedChapters.map(String));
                    }
                }

                // Update furthest: take the max of saved furthest and current anonymous position
                if (savedFurthestChap !== null) {
                    furthestChapter = savedFurthestChap;
                    furthestCharIndex = savedFurthestIdx;
                }
                if (isPositionAhead(currentChapterNum, currentCharIndex, furthestChapter, furthestCharIndex)) {
                    furthestChapter = currentChapterNum;
                    furthestCharIndex = currentCharIndex;
                }

                // Now save progress — write current position + updated furthest
                await setDoc(progRef, {
                    chapter: currentChapterNum,
                    charIndex: currentCharIndex,
                    furthestChapter: furthestChapter,
                    furthestCharIndex: furthestCharIndex,
                    lastUpdated: new Date()
                }, { merge: true });
            } catch(e) { console.warn("Retroactive save failed:", e); }

            // If initials prompt is showing, let it handle the flow
            if (!userInitials) {
                anonLoginInProgress = false;
                return;
            }

            // Check if furthest point is ahead of current position
            if (isPositionAhead(furthestChapter, furthestCharIndex, currentChapterNum, currentCharIndex)) {
                anonLoginInProgress = false;
                showJumpToProgressPrompt(furthestChapter, furthestCharIndex);
                return;
            }
        }

        anonLoginInProgress = false;
        closeModal();
        showStartModal("Continue");
    };
    btn.onclick = signInAction;

    // Add a skip link below (initially hidden)
    const footer = document.getElementById('modal-footer');
    const skip = document.createElement('div');
    skip.innerHTML = `<a href="#" id="anon-skip" style="color:#999; font-size:0.8rem; margin-top:6px; display:none;">No thanks, keep typing</a>`;
    footer.appendChild(skip);
    document.getElementById('anon-skip').onclick = (e) => {
        e.preventDefault();
        closeModal();
        showStartModal("Continue");
    };

    showModalPanel();

    // 3-second cooldown before allowing dismissal
    const gen = ++modalGeneration;
    setTimeout(() => {
        if (modalGeneration !== gen) return;
        isInputBlocked = false;
        const b = document.getElementById('action-btn');
        if (b) { b.innerText = 'Sign In'; b.disabled = false; b.style.opacity = '1'; }
        const skipEl = document.getElementById('anon-skip');
        if (skipEl) skipEl.style.display = 'inline-block';
        // Set modalActionCallback so smart-start typing skips to continue
        modalActionCallback = () => { closeModal(); showStartModal("Continue"); };
    }, SPRINT_COOLDOWN_MS * 2);
}

function showJumpToProgressPrompt(savedChap, savedIdx) {
    isModalOpen = true; isInputBlocked = false;
    setModalTitle('');
    resetModalFooter();

    // Find chapter title
    let chapLabel = `Chapter ${savedChap}`;
    if (bookMetadata && bookMetadata.chapters) {
        const chap = bookMetadata.chapters.find(c => c.id === "chapter_" + savedChap);
        if (chap && chap.title && chap.title != savedChap) {
            if (chap.title.toLowerCase().startsWith('chapter')) chapLabel = chap.title;
            else chapLabel = `Ch. ${savedChap}: ${chap.title}`;
        }
    }

    document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center;">
            <div class="stats-title">Welcome back! 📚</div>
            <div style="font-size:0.95em; color:#555; margin: 8px 0;">
                You were previously on <b>${escapeHtml(chapLabel)}</b>. Would you like to pick up where you left off?
            </div>
        </div>
    `;

    const btn = document.getElementById('action-btn');
    btn.innerText = `Jump to ${escapeHtml(chapLabel)}`; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
    btn.onclick = async () => {
        currentChapterNum = savedChap;
        savedCharIndex = savedIdx;
        lastSavedIndex = savedIdx;
        closeModal();
        await loadChapter(savedChap);
    };

    // Add stay option
    const footer = document.getElementById('modal-footer');
    const stay = document.createElement('div');
    stay.innerHTML = `<a href="#" id="stay-here" style="color:#999; font-size:0.8rem; margin-top:6px; display:inline-block;">Stay here and keep typing</a>`;
    footer.appendChild(stay);
    document.getElementById('stay-here').onclick = (e) => {
        e.preventDefault();
        closeModal();
        showStartModal("Continue");
    };

    modalActionCallback = () => { closeModal(); showStartModal("Continue"); };
    showModalPanel();
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
    resetModalFooter();
    const keyboard = document.getElementById('virtual-keyboard'); if(keyboard) keyboard.focus();
}

function resetModalFooter() {
    document.getElementById('modal-footer').innerHTML = `<button id="action-btn" class="modal-btn">Action</button>`;
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
    // Quietly pause without showing break modal
    const wasActive = isGameActive;
    if (isGameActive) { isGameActive = false; clearInterval(timerInterval); }
    isModalOpen = true; isInputBlocked = false;
    modalGeneration++;
    modalActionCallback = () => { closeModal(); createHandGuide(); startGame(); };
    resetModalFooter();

    setModalTitle('Settings');

    let chapterOptions = "";
    if (bookMetadata && bookMetadata.chapters) {
        bookMetadata.chapters.forEach((chap) => {
            const num = chap.id.replace("chapter_", "");
            let sel = (num == currentChapterNum) ? "selected" : "";
            const done = completedChapters.has(String(num)) ? "✓ " : "";

            let label = `${done}Ch. ${escapeHtml(num)}`;
            if(chap.title && chap.title != num) {
                if(chap.title.toLowerCase().startsWith('chapter')) label = `${done}${escapeHtml(chap.title)}`;
                else label = `${done}Ch. ${escapeHtml(num)}: ${escapeHtml(chap.title)}`;
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

    const initialsHTML = (currentUser && !currentUser.isAnonymous) ? `
        <div class="menu-col menu-col-initials">
            <div class="menu-label">Initials</div>
            <input id="initials-input" type="text" maxlength="3" value="${escapeHtml(userInitials)}" 
                   class="initials-box-settings">
            <div id="initials-settings-error" style="color:#D32F2F; font-size:0.7em; min-height:1em; margin-top:2px;"></div>
            <label style="display:flex; align-items:center; gap:5px; font-size:0.7em; color:#888; margin-top:4px; cursor:pointer;">
                <input type="checkbox" id="lb-optout" ${leaderboardOptOut ? 'checked' : ''}>
                Hide me from leaderboards
            </label>
        </div>` : '';

    document.getElementById('modal-body').innerHTML = `
        <div class="menu-3col">
            <div class="menu-col">
                <div class="menu-label">Book</div>
                <select id="book-select" class="modal-select">${bookOptions}</select>
                <div class="menu-label" style="margin-top:8px;">Chapter</div>
                <div style="display:flex; gap:6px;">
                    <select id="chapter-nav-select" class="modal-select" style="margin:0; flex-grow:1;">${chapterOptions}</select>
                    <button id="go-btn" class="modal-btn" style="width:auto; padding:0 12px; font-size:13px;">Go</button>
                </div>
            </div>
            <div class="menu-col">
                <div class="menu-label">Sprint</div>
                <select id="sprint-select" class="modal-select">${getSessionOptionsHTML()}</select>
                <div class="menu-label" style="margin-top:8px;">Keyboard</div>
                <select id="layout-select" class="modal-select">
                    <option value="qwerty" ${currentLayout === 'qwerty' ? 'selected' : ''}>QWERTY</option>
                    <option value="dvorak" ${currentLayout === 'dvorak' ? 'selected' : ''}>Dvorak</option>
                </select>
            </div>
            <div class="menu-col menu-col-guide">
                <div class="menu-label">Hand Guide</div>
                <label style="display:flex; align-items:center; gap:5px; font-size:0.8em; color:#ccc; cursor:pointer; margin-top:4px;">
                    <input type="checkbox" id="guide-toggle" ${handGuideEnabled ? 'checked' : ''}>
                    Show fingers
                </label>
                <label style="display:flex; align-items:center; gap:5px; font-size:0.8em; color:#ccc; cursor:pointer; margin-top:4px;">
                    <input type="checkbox" id="guide-rainbow" ${handGuideRainbow ? 'checked' : ''}>
                    🌈 Rainbow
                </label>
                <div id="guide-color-row" style="display:${handGuideRainbow ? 'none' : 'flex'}; align-items:center; gap:5px; margin-top:4px;">
                    <input type="color" id="guide-color" value="${handGuideColor}" 
                        style="width:28px; height:22px; border:1px solid #555; border-radius:3px; cursor:pointer; background:none; padding:0;">
                    <span style="font-size:0.7em; color:#888;">Color</span>
                </div>
            </div>
            ${initialsHTML}
        </div>
    `;

    document.getElementById('layout-select').onchange = (e) => {
        setKeyboardLayout(e.target.value);
    };

    document.getElementById('sprint-select').onchange = (e) => {
        sessionValueStr = e.target.value;
        sessionLimit = (sessionValueStr === 'infinity') ? 'infinity' : parseInt(sessionValueStr);
        localStorage.setItem('ttb_sessionLength', sessionValueStr);
    };

    // Hand guide controls
    document.getElementById('guide-toggle').onchange = (e) => {
        handGuideEnabled = e.target.checked;
        localStorage.setItem('ttb_handGuide', handGuideEnabled);
        const guide = document.getElementById('hand-guide-overlay');
        if (guide) guide.classList.toggle('hidden', !handGuideEnabled);
        if (handGuideEnabled) { createHandGuide(); }
        else { colorKeyboardKeys(); }
    };
    document.getElementById('guide-rainbow').onchange = (e) => {
        handGuideRainbow = e.target.checked;
        localStorage.setItem('ttb_handGuideRainbow', handGuideRainbow);
        const colorRow = document.getElementById('guide-color-row');
        if (colorRow) colorRow.style.display = handGuideRainbow ? 'none' : 'flex';
    };
    document.getElementById('guide-color').oninput = (e) => {
        handGuideColor = e.target.value;
        localStorage.setItem('ttb_handGuideColor', handGuideColor);
    };

    const initialsInput = document.getElementById('initials-input');
    if (initialsInput) {
        initialsInput.onblur = async () => {
            const val = initialsInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3);
            const errEl = document.getElementById('initials-settings-error');
            if (val && !isInitialsClean(val)) {
                if (errEl) errEl.textContent = "Not allowed — try again";
                initialsInput.value = userInitials; // revert
                return;
            }
            if (errEl) errEl.textContent = '';
            if (val && val !== userInitials) {
                userInitials = val;
                initialsInput.value = val;
                await saveInitials(val);
            }
        };
    }

    const optOutBox = document.getElementById('lb-optout');
    if (optOutBox) {
        optOutBox.onchange = async () => {
            leaderboardOptOut = optOutBox.checked;
            await saveInitials(userInitials);
            leaderboardCacheTime = 0; // bust cache
        };
    }

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
            createHandGuide();
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
        numRow:      ['`','1','2','3','4','5','6','7','8','9','0','-','='],
        numShiftRow: ['~','!','@','#','$','%','^','&','*','(',')','_','+'],
        rows:      [['q','w','e','r','t','y','u','i','o','p','[',']','\\'],['a','s','d','f','g','h','j','k','l',';',"'"],['z','x','c','v','b','n','m',',','.','/']],
        shiftRows: [['Q','W','E','R','T','Y','U','I','O','P','{','}','|'],['A','S','D','F','G','H','J','K','L',':','"'],['Z','X','C','V','B','N','M','<','>','?']]
    },
    dvorak: {
        numRow:      ['`','1','2','3','4','5','6','7','8','9','0','[',']'],
        numShiftRow: ['~','!','@','#','$','%','^','&','*','(',')' ,'{','}'],
        rows:      [["'",',','.','p','y','f','g','c','r','l','/','+','\\'],['a','o','e','u','i','d','h','t','n','s','-'],[';','q','j','k','x','b','m','w','v','z']],
        shiftRows: [['"','<','>','P','Y','F','G','C','R','L','?','=','|'],['A','O','E','U','I','D','H','T','N','S','_'],[':', 'Q','J','K','X','B','M','W','V','Z']]
    }
};

let currentLayout = localStorage.getItem('keyboardLayout') || 'qwerty';
let numRow = LAYOUTS[currentLayout].numRow;
let numShiftRow = LAYOUTS[currentLayout].numShiftRow;
let rows = LAYOUTS[currentLayout].rows;
let shiftRows = LAYOUTS[currentLayout].shiftRows;

function setKeyboardLayout(layout) {
    if (!LAYOUTS[layout]) return;
    currentLayout = layout;
    localStorage.setItem('keyboardLayout', layout);
    numRow = LAYOUTS[layout].numRow;
    numShiftRow = LAYOUTS[layout].numShiftRow;
    rows = LAYOUTS[layout].rows;
    shiftRows = LAYOUTS[layout].shiftRows;
    createKeyboard();
    buildFingerMap();
    // Recreate hand guide overlay for new key positions
    const old = document.getElementById('hand-guide-overlay');
    if (old) old.remove();
    createHandGuide();
    highlightCurrentChar();
}

function createKeyboard() {
    keyboardDiv.innerHTML = '';

    // Number row: dual-character keys + BACK
    const numDiv = document.createElement('div'); numDiv.className = 'kb-row';
    numRow.forEach((char, i) => {
        const key = document.createElement('div');
        key.className = 'key key-num';
        key.dataset.char = char;
        key.dataset.shift = numShiftRow[i];
        key.id = `key-${char}`;
        key.innerHTML = `<span class="num-symbol">${escapeHtml(numShiftRow[i])}</span><span class="num-digit">${escapeHtml(char)}</span>`;
        numDiv.appendChild(key);
    });
    addSpecialKey(numDiv, "BACK", null, 53);
    keyboardDiv.appendChild(numDiv);

    // Letter rows
    rows.forEach((rowChars, rIndex) => {
        const rowDiv = document.createElement('div'); rowDiv.className = 'kb-row';
        if (rIndex === 0) addSpecialKey(rowDiv, "TAB", null, 72);
        if (rIndex === 1) addSpecialKey(rowDiv, "CAPS", null, 80);
        if (rIndex === 2) addSpecialKey(rowDiv, "SHIFT", "key-SHIFT-L", 100);
        rowChars.forEach((char, cIndex) => {
            const key = document.createElement('div'); key.className = 'key'; key.innerText = char; key.dataset.char = char; key.dataset.shift = shiftRows[rIndex][cIndex]; key.id = `key-${char}`; rowDiv.appendChild(key);
        });
        if (rIndex === 1) addSpecialKey(rowDiv, "ENTER", null, 80);
        if (rIndex === 2) addSpecialKey(rowDiv, "SHIFT", "key-SHIFT-R", 100);
        keyboardDiv.appendChild(rowDiv);
    });

    // Space row
    const spaceRow = document.createElement('div'); spaceRow.className = 'kb-row';
    const space = document.createElement('div'); space.className = 'key space'; space.innerText = ""; space.id = "key- ";
    spaceRow.appendChild(space); keyboardDiv.appendChild(spaceRow);
}

function addSpecialKey(parent, text, customId, width) {
    const key = document.createElement('div'); key.className = 'key wide'; key.innerText = text;
    key.id = customId || `key-${text}`;
    if (width) key.style.width = width + 'px';
    parent.appendChild(key);
}

function toggleKeyboardCase(isShift) {
    document.querySelectorAll('.key').forEach(k => {
        if (k.classList.contains('key-num')) return; // number keys always show both
        if (k.dataset.char) k.innerText = isShift ? k.dataset.shift : k.dataset.char;
        if (k.id === 'key-SHIFT-L' || k.id === 'key-SHIFT-R') isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active');
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
    if (el) {
        el.style.backgroundColor = 'var(--brute-force-color)';
        setTimeout(() => {
            if (!handGuideEnabled) { el.style.backgroundColor = ''; return; }
            // Special keys without dataset.char
            if (el.id === 'key- ') {
                el.style.backgroundColor = handGuideRainbow ? '#d0d0d0' : handGuideColor + '38';
                return;
            }
            if (el.id === 'key-ENTER' || el.id === 'key-BACK') {
                el.style.backgroundColor = getFingerColor('right-pinky') + '38'; return;
            }
            if (el.id === 'key-TAB') {
                el.style.backgroundColor = getFingerColor('left-pinky') + '38'; return;
            }
            const keyChar = el.dataset.char || '';
            const info = fingerMap[keyChar];
            if (info && info.finger) {
                el.style.backgroundColor = getFingerColor(info.finger) + '38';
            } else { el.style.backgroundColor = ''; }
        }, 200);
    }
}

// ========================
// HAND GUIDE (keyboard overlay - capsule fingers)
// ========================

function getHomeKeys() {
    const r = rows[1]; // home row
    return {
        'left-pinky':  r[0],  'left-ring':   r[1],  'left-middle': r[2],  'left-index':  r[3],
        'right-index': r[6],  'right-middle':r[7],  'right-ring':  r[8],  'right-pinky': r[9],
    };
}

const FINGER_NAMES = ['left-pinky','left-ring','left-middle','left-index',
                      'right-index','right-middle','right-ring','right-pinky'];

function buildFingerMap() {
    fingerMap = {};

    // Number row finger assignments
    const numAssign = ['left-pinky','left-pinky','left-ring','left-middle','left-index','left-index',
                       'right-index','right-index','right-middle','right-ring','right-pinky','right-pinky','right-pinky'];
    numRow.forEach((char, i) => {
        if (i >= numAssign.length) return;
        fingerMap[char] = { finger: numAssign[i], keyChar: char };
        if (numShiftRow[i]) {
            fingerMap[numShiftRow[i]] = { finger: numAssign[i], keyChar: char, shift: true };
        }
    });

    // Letter row finger assignments
    const assignments = [
        // Row 0 (top): up to 13 keys
        ['left-pinky','left-ring','left-middle','left-index','left-index',
         'right-index','right-index','right-middle','right-ring','right-pinky',
         'right-pinky','right-pinky','right-pinky'],
        // Row 1 (home): up to 11 keys
        ['left-pinky','left-ring','left-middle','left-index','left-index',
         'right-index','right-index','right-middle','right-ring','right-pinky','right-pinky'],
        // Row 2 (bottom): up to 10 keys
        ['left-pinky','left-ring','left-middle','left-index','left-index',
         'right-index','right-index','right-middle','right-ring','right-pinky'],
    ];
    rows.forEach((rowChars, rIndex) => {
        const assign = assignments[rIndex];
        if (!assign) return;
        rowChars.forEach((char, cIndex) => {
            if (cIndex >= assign.length) return;
            fingerMap[char] = { finger: assign[cIndex], keyChar: char };
            if (shiftRows[rIndex] && shiftRows[rIndex][cIndex]) {
                fingerMap[shiftRows[rIndex][cIndex]] = { finger: assign[cIndex], keyChar: char, shift: true };
            }
        });
    });
    fingerMap[' '] = { finger: 'thumb', keyChar: ' ' };
    fingerMap['\n'] = { finger: 'right-pinky', keyChar: 'ENTER' };
    fingerMap['\t'] = { finger: 'left-pinky', keyChar: 'TAB' };
}

function getFingerInfo(char) {
    if (fingerMap[char]) return fingerMap[char];
    const lower = char.toLowerCase();
    if (lower !== char && fingerMap[lower]) return { ...fingerMap[lower], shift: true };
    return null;
}

function getKeyCenterInKB(charOrId) {
    const kb = document.getElementById('virtual-keyboard');
    if (!kb) return null;
    let keyEl;
    if (charOrId === ' ') keyEl = document.getElementById('key- ');
    else if (charOrId === 'ENTER') keyEl = document.getElementById('key-ENTER');
    else if (charOrId === 'SHIFT-L') keyEl = document.getElementById('key-SHIFT-L');
    else if (charOrId === 'SHIFT-R') keyEl = document.getElementById('key-SHIFT-R');
    else keyEl = document.getElementById(`key-${charOrId}`);
    if (!keyEl) return null;
    const kbRect = kb.getBoundingClientRect();
    const keyRect = keyEl.getBoundingClientRect();
    // Offset by border so SVG coords align with overlay (which sits inside border)
    return {
        x: keyRect.left - kbRect.left - kb.clientLeft + keyRect.width / 2,
        y: keyRect.top - kbRect.top - kb.clientTop + keyRect.height / 2
    };
}

function createHandGuide() {
    const old = document.getElementById('hand-guide-overlay');
    if (old) old.remove();
    const kb = document.getElementById('virtual-keyboard');
    if (!kb) return;
    kb.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.id = 'hand-guide-overlay';
    if (!handGuideEnabled) overlay.classList.add('hidden');
    overlay.innerHTML = `<svg id="hg-svg" xmlns="http://www.w3.org/2000/svg"></svg>`;
    kb.appendChild(overlay);

    colorKeyboardKeys();
    requestAnimationFrame(() => buildFingerSVG());
}

function colorKeyboardKeys() {
    // Reset all keys
    document.querySelectorAll('.key').forEach(k => { k.style.backgroundColor = ''; });
    if (!handGuideEnabled) return;

    // Color each key based on its finger assignment
    Object.entries(fingerMap).forEach(([char, info]) => {
        if (!info.finger || info.shift || info.finger === 'thumb') return;
        const color = getFingerColor(info.finger);
        if (!color) return;
        let keyEl;
        if (char === ' ') keyEl = document.getElementById('key- ');
        else if (char === '\n') keyEl = document.getElementById('key-ENTER');
        else if (char === '\t') keyEl = document.getElementById('key-TAB');
        else keyEl = document.getElementById(`key-${char}`);
        if (keyEl) keyEl.style.backgroundColor = color + '38';
    });

    // Space bar: grey for rainbow, user color tint for single color
    const spaceEl = document.getElementById('key- ');
    if (spaceEl) {
        if (handGuideRainbow) {
            spaceEl.style.backgroundColor = '#d0d0d0';
        } else {
            spaceEl.style.backgroundColor = handGuideColor + '38';
        }
    }

    // Color special keys by their pinky finger
    const lp = getFingerColor('left-pinky') + '38';
    const rp = getFingerColor('right-pinky') + '38';
    const el = id => document.getElementById(id);
    if (el('key-TAB')) el('key-TAB').style.backgroundColor = lp;
    if (el('key-CAPS')) el('key-CAPS').style.backgroundColor = lp;
    if (el('key-SHIFT-L')) el('key-SHIFT-L').style.backgroundColor = lp;
    if (el('key-SHIFT-R')) el('key-SHIFT-R').style.backgroundColor = rp;
    if (el('key-ENTER')) el('key-ENTER').style.backgroundColor = rp;
    if (el('key-BACK')) el('key-BACK').style.backgroundColor = rp;
}

function buildFingerSVG() {
    const kb = document.getElementById('virtual-keyboard');
    const svg = document.getElementById('hg-svg');
    if (!kb || !svg) return;
    svg.innerHTML = '';
    svg.setAttribute('width', kb.clientWidth);
    svg.setAttribute('height', kb.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${kb.clientWidth} ${kb.clientHeight}`);

    const homeKeys = getHomeKeys();
    const R = 11; // finger circle radius

    // Create each finger group: home circle + reach body + reach tip
    FINGER_NAMES.forEach(name => {
        const pos = getKeyCenterInKB(homeKeys[name]);
        if (!pos) return;
        const fc = getFingerColor(name);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.id = `hg-finger-${name}`;
        g.classList.add('hg-finger-group');
        g.style.setProperty('--fc', fc);

        // Reach body (thick line with round caps = capsule connector)
        const body = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        body.classList.add('hg-body');
        body.setAttribute('x1', pos.x); body.setAttribute('y1', pos.y);
        body.setAttribute('x2', pos.x); body.setAttribute('y2', pos.y);
        body.setAttribute('stroke-width', R * 2);
        body.setAttribute('stroke-linecap', 'round');
        g.appendChild(body);

        // Home circle (base of finger - always visible)
        const home = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        home.classList.add('hg-home');
        home.setAttribute('cx', pos.x); home.setAttribute('cy', pos.y);
        home.setAttribute('r', R);
        g.appendChild(home);

        // Fingertip circle (target end - only visible when reaching)
        const tip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        tip.classList.add('hg-tip');
        tip.setAttribute('cx', pos.x); tip.setAttribute('cy', pos.y);
        tip.setAttribute('r', R);
        g.appendChild(tip);

        svg.appendChild(g);
    });

    updateHandGuide();
}

function updateHandGuide() {
    if (!handGuideEnabled) return;
    const svg = document.getElementById('hg-svg');
    if (!svg || !fullText || currentCharIndex >= fullText.length) return;

    const nextChar = fullText[currentCharIndex];
    const info = getFingerInfo(nextChar);
    const homeKeys = getHomeKeys();

    // Clear space bar highlight
    const spaceKeyReset = document.getElementById('key- ');
    if (spaceKeyReset) spaceKeyReset.classList.remove('space-active');

    // Reset all fingers to resting state
    svg.querySelectorAll('.hg-finger-group').forEach(g => {
        g.classList.remove('hg-active', 'hg-shift-active');
        const body = g.querySelector('.hg-body');
        const home = g.querySelector('.hg-home');
        const tip = g.querySelector('.hg-tip');
        const name = g.id.replace('hg-finger-', '');

        // Reset position to home
        const homePos = getKeyCenterInKB(homeKeys[name]);
        if (!homePos) return;
        if (body) {
            body.setAttribute('x1', homePos.x); body.setAttribute('y1', homePos.y);
            body.setAttribute('x2', homePos.x); body.setAttribute('y2', homePos.y);
        }
        if (tip) { tip.setAttribute('cx', homePos.x); tip.setAttribute('cy', homePos.y); }
    });

    if (!info) return;

    // Space: just highlight the bar (CSS handles thumb circles via ::before/::after)
    if (info.finger === 'thumb') {
        const spaceBar = document.getElementById('key- ');
        if (spaceBar) spaceBar.classList.add('space-active');
        return;
    }

    const fingerName = info.finger;
    const fingerG = document.getElementById(`hg-finger-${fingerName}`);
    if (!fingerG) return;

    // Find home and target positions
    const homeChar = homeKeys[fingerName];
    const homePos = homeChar ? getKeyCenterInKB(homeChar) : null;
    const targetPos = getKeyCenterInKB(info.keyChar);

    if (!homePos || !targetPos) return;

    // Stretch the finger from home to target
    const body = fingerG.querySelector('.hg-body');
    const tip = fingerG.querySelector('.hg-tip');
    if (body) {
        body.setAttribute('x1', homePos.x); body.setAttribute('y1', homePos.y);
        body.setAttribute('x2', targetPos.x); body.setAttribute('y2', targetPos.y);
    }
    if (tip) { tip.setAttribute('cx', targetPos.x); tip.setAttribute('cy', targetPos.y); }
    fingerG.classList.add('hg-active');

    // Shift: stretch opposite pinky to correct shift key
    if (info.shift) {
        const isLeftFinger = fingerName.startsWith('left');
        const shiftHand = isLeftFinger ? 'right' : 'left';
        const shiftKey = isLeftFinger ? 'SHIFT-R' : 'SHIFT-L';
        const shiftFingerG = document.getElementById(`hg-finger-${shiftHand}-pinky`);
        if (shiftFingerG) {
            const shiftHome = homeKeys[`${shiftHand}-pinky`];
            const shiftHomePos = shiftHome ? getKeyCenterInKB(shiftHome) : null;
            const shiftTargetPos = getKeyCenterInKB(shiftKey);
            if (shiftHomePos && shiftTargetPos) {
                const sBody = shiftFingerG.querySelector('.hg-body');
                const sTip = shiftFingerG.querySelector('.hg-tip');
                if (sBody) {
                    sBody.setAttribute('x1', shiftHomePos.x); sBody.setAttribute('y1', shiftHomePos.y);
                    sBody.setAttribute('x2', shiftTargetPos.x); sBody.setAttribute('y2', shiftTargetPos.y);
                }
                if (sTip) { sTip.setAttribute('cx', shiftTargetPos.x); sTip.setAttribute('cy', shiftTargetPos.y); }
            }
            shiftFingerG.classList.add('hg-shift-active');
        }
    }
}

function flashFingerPressed() {
    if (!handGuideEnabled) return;
    const svg = document.getElementById('hg-svg');
    if (!svg) return;
    svg.querySelectorAll('.hg-active').forEach(g => {
        g.classList.add('hg-pressed');
        setTimeout(() => g.classList.remove('hg-pressed'), 120);
    });
    // Flash space bar on press
    const spaceKey = document.getElementById('key- ');
    if (spaceKey && spaceKey.classList.contains('space-active')) {
        spaceKey.classList.add('space-pressed');
        setTimeout(() => spaceKey.classList.remove('space-pressed'), 120);
    }
}

let hgResizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(hgResizeTimer);
    hgResizeTimer = setTimeout(() => {
        const old = document.getElementById('hand-guide-overlay');
        if (old) old.remove();
        createHandGuide();
    }, 200);
});

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

// --- GAME GENIE (Admin Debug Tool) ---
function getSentenceMap() {
    const sentences = [];
    let sentStart = 0;
    for (let i = 0; i < fullText.length; i++) {
        const ch = fullText[i];
        if (ch === '.' || ch === '!' || ch === '?') {
            // Check if next char is space, newline, quote, or end
            const next = fullText[i + 1];
            if (!next || next === ' ' || next === '\n' || next === '"' || next === "'") {
                // Find the real end (include closing quote if present)
                let end = i + 1;
                if (next === '"' || next === "'") end = i + 2;
                sentences.push({ start: sentStart, end: Math.min(end, fullText.length) });
                // Skip whitespace to find next sentence start
                let j = end;
                while (j < fullText.length && (fullText[j] === ' ' || fullText[j] === '\n' || fullText[j] === '\t')) j++;
                sentStart = j;
            }
        } else if (ch === '\n' && i > sentStart) {
            // Paragraph break = sentence boundary
            sentences.push({ start: sentStart, end: i });
            let j = i + 1;
            while (j < fullText.length && (fullText[j] === ' ' || fullText[j] === '\n' || fullText[j] === '\t')) j++;
            sentStart = j;
        }
    }
    // Catch trailing text
    if (sentStart < fullText.length) {
        sentences.push({ start: sentStart, end: fullText.length });
    }
    return sentences;
}

function getCurrentSentence(sentences) {
    for (let i = 0; i < sentences.length; i++) {
        if (currentCharIndex < sentences[i].end) return i;
    }
    return sentences.length - 1;
}

function jumpToSentence(sentences, idx) {
    idx = Math.max(0, Math.min(idx, sentences.length - 1));
    const target = sentences[idx].start;
    
    // Reset game state
    if (isGameActive) { isGameActive = false; clearInterval(timerInterval); }
    
    currentCharIndex = target;
    savedCharIndex = target;
    sprintCharStart = target;
    sprintSeconds = 0; sprintMistakes = 0;
    
    // Re-render and mark everything before current as done
    renderText();
    for (let i = 0; i < currentCharIndex; i++) {
        const el = document.getElementById(`char-${i}`);
        if (el) {
            el.classList.remove('active');
            if (!el.classList.contains('space') && !el.classList.contains('enter') && !el.classList.contains('tab')) {
                el.classList.add('done-perfect');
            }
        }
    }
    highlightCurrentChar();
    centerView();
    saveProgress();
    
    // Show start modal for this position
    showStartModal("Resume");
}

function openGameGenie() {
    if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) return;
    if (isGameActive) { isGameActive = false; clearInterval(timerInterval); }
    
    // Save real position on first open (before any warps)
    if (ggRealCharIndex < 0) ggRealCharIndex = currentCharIndex;
    
    const sentences = getSentenceMap();
    const currentSent = getCurrentSentence(sentences);
    const pct = fullText.length > 0 ? Math.round((currentCharIndex / fullText.length) * 100) : 0;
    const realSent = (() => { for (let i = 0; i < sentences.length; i++) { if (ggRealCharIndex < sentences[i].end) return i; } return sentences.length - 1; })();
    const hasWarped = ggRealCharIndex !== currentCharIndex;
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const estMinutes = Math.round(wordCount / 40); // ~40 WPM typing speed estimate
    const segCount = bookData ? bookData.segments.length : 0;
    const isInfinite = sessionValueStr === 'infinity';
    
    isModalOpen = true; isInputBlocked = false;
    modalGeneration++;
    setModalTitle('🔥 GAME GENIE 🔥');
    
    const ggBtn = 'background:#333; color:#ff6600; border:1px solid #ff6600; padding:4px 8px; cursor:pointer; font-family:inherit; border-radius:3px; font-size:0.8em;';
    
    // Build chapter options
    let chapOpts = '';
    if (bookMetadata && bookMetadata.chapters) {
        bookMetadata.chapters.forEach(chap => {
            const num = chap.id.replace('chapter_', '');
            const sel = (num == currentChapterNum) ? 'selected' : '';
            let label = `Ch. ${num}`;
            if (chap.title && chap.title != num) {
                if (chap.title.toLowerCase().startsWith('chapter')) label = chap.title;
                else label = `Ch. ${num}: ${chap.title}`;
            }
            chapOpts += `<option value="${num}" ${sel}>${escapeHtml(label)}</option>`;
        });
    }
    
    document.getElementById('modal-body').innerHTML = `
        <div style="font-family: 'Courier Prime', monospace; text-align: left; width: 50%; margin: 0 auto; font-size: 0.8em;">
            <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
                <select id="gg-chapter-select" style="flex:1; background:#f8f8f8; border:1px solid #ccc; padding:3px 4px; font-family:inherit; font-size:0.9em; border-radius:3px;">${chapOpts}</select>
                <button id="gg-chapter-go" style="${ggBtn}">Jump Ch.</button>
                <button id="gg-reset-ch" style="${ggBtn}" title="Reset to start of chapter">⟲ Reset</button>
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-bottom:2px; font-size:0.85em; color:#888;">
                <span>Char ${currentCharIndex.toLocaleString()} / ${fullText.length.toLocaleString()} · ${wordCount.toLocaleString()} words · ${segCount} segs · ~${estMinutes}min</span>
                <span>${pct}%</span>
            </div>
            <div id="gg-slider-track" style="height:12px; background:#eee; border-radius:6px; overflow:visible; margin-bottom:6px; cursor:pointer; position:relative;">
                <div id="gg-slider-fill" style="height:100%; width:${pct}%; background: linear-gradient(90deg, #ff6600, #ff0000, #ff6600); border-radius:6px; pointer-events:none;"></div>
                <div id="gg-slider-thumb" style="position:absolute; top:-2px; left:${pct}%; width:16px; height:16px; background:#ff6600; border:2px solid #fff; border-radius:50%; transform:translateX(-50%); cursor:grab; box-shadow:0 0 6px rgba(255,102,0,0.5);"></div>
            </div>
            
            <div style="display:flex; align-items:center; gap:4px; margin-bottom:6px;">
                <button id="gg-start" style="${ggBtn}">Start</button>
                <button id="gg-back10" style="${ggBtn}">-10</button>
                <button id="gg-back1" style="${ggBtn}">-1</button>
                <div style="flex:1; text-align:center; font-weight:bold;">
                    Sentence <span style="color:#ff6600;">${currentSent + 1}</span> / ${sentences.length}
                </div>
                <button id="gg-fwd1" style="${ggBtn}">+1</button>
                <button id="gg-fwd10" style="${ggBtn}">+10</button>
                <button id="gg-end" style="${ggBtn}">End</button>
            </div>
            
            <div style="display:flex; justify-content:center; gap:6px; align-items:center; margin-bottom:6px;">
                <label style="font-size:0.85em;">Warp #</label>
                <input id="gg-jump-input" type="number" min="1" max="${sentences.length}" value="${currentSent + 1}" 
                       style="width:60px; background:#f8f8f8; border:1px solid #ccc; padding:3px 4px; font-family:inherit; font-size:0.85em; border-radius:3px; text-align:center;">
                <button id="gg-jump-btn" style="background:#ff6600; color:#fff; border:none; padding:4px 10px; cursor:pointer; font-family:inherit; font-weight:bold; border-radius:3px; font-size:0.85em;">WARP</button>
                ${hasWarped ? `<button id="gg-return-btn" style="background:#224422; color:#88ff88; border:1px solid #44aa44; padding:4px 8px; cursor:pointer; font-family:inherit; border-radius:3px; font-size:0.75em;" title="Return to sentence ${realSent + 1}">↩ Return</button>` : ''}
            </div>
            
            <div id="gg-preview" style="font-size:0.8em; color:#888; background:#f5f5f5; padding:4px 6px; border-radius:3px; max-height:32px; overflow:hidden; line-height:1.3; margin-bottom:6px;">
                ${escapeHtml(fullText.substring(sentences[currentSent].start, sentences[currentSent].start + 120))}${sentences[currentSent].end - sentences[currentSent].start > 120 ? '...' : ''}
            </div>
            
            <div style="display:flex; justify-content:center; gap:6px; align-items:center;">
                <button id="gg-infinite" style="${isInfinite ? 'background:#ff6600; color:#fff;' : 'background:#333; color:#ff6600;'} border:1px solid #ff6600; padding:4px 12px; cursor:pointer; font-family:inherit; border-radius:3px; font-size:0.85em; font-weight:bold;" title="Toggle infinite session (no sprint timer)">${isInfinite ? '∞ INFINITE ON' : '∞ Infinite Mode'}</button>
            </div>
            
            <div style="margin-top:8px; padding-top:6px; border-top:1px solid #ddd;">
                <div style="display:flex; justify-content:center; gap:10px; align-items:center;">
                    <div>
                        <div style="font-size:0.75em; color:#888; text-align:center; margin-bottom:4px;">Test Text</div>
                        <div style="display:flex; gap:6px;">
                            <button id="gg-test-pangram" style="${ggBtn}" title="&quot;The quick brown fox jumps over the lazy dog!&quot; exclaimed 4 typing teachers.">🦊 Pangram</button>
                            <button id="gg-test-alphabet" style="${ggBtn}" title="abcdefghijklmnopqrstuvwxyz 1234567890">🔤 Alphabet</button>
                        </div>
                    </div>
                    <div style="border-left:1px solid #ddd; padding-left:10px;">
                        <label style="display:flex; align-items:center; gap:4px; font-size:0.75em; color:${ggAllowMistakes ? '#ff6600' : '#888'}; cursor:pointer;">
                            <input type="checkbox" id="gg-allow-mistakes" ${ggAllowMistakes ? 'checked' : ''}>
                            Allow Mistakes
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; font-size:0.75em; color:${ggBypassIdle ? '#ff6600' : '#888'}; cursor:pointer; margin-top:3px;">
                            <input type="checkbox" id="gg-bypass-idle" ${ggBypassIdle ? 'checked' : ''}>
                            Bypass Idle
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    resetModalFooter();
    const btn = document.getElementById('action-btn');
    btn.innerText = 'Close'; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
    const ggClose = () => { ggRealCharIndex = -1; closeModal(); startGame(); };
    btn.onclick = ggClose;
    // Allow smart-start typing to close GG and begin typing
    modalActionCallback = ggClose;
    showModalPanel();
    
    // Wire up
    const s = sentences;
    const cur = currentSent;
    
    document.getElementById('gg-start').onclick = () => { jumpToSentence(s, 0); openGameGenie(); };
    document.getElementById('gg-back10').onclick = () => { jumpToSentence(s, cur - 10); openGameGenie(); };
    document.getElementById('gg-back1').onclick = () => { jumpToSentence(s, cur - 1); openGameGenie(); };
    document.getElementById('gg-fwd1').onclick = () => { jumpToSentence(s, cur + 1); openGameGenie(); };
    document.getElementById('gg-fwd10').onclick = () => { jumpToSentence(s, cur + 10); openGameGenie(); };
    document.getElementById('gg-end').onclick = () => { jumpToSentence(s, s.length - 1); openGameGenie(); };
    
    // Chapter jump
    document.getElementById('gg-chapter-go').onclick = async () => {
        const targetChap = document.getElementById('gg-chapter-select').value;
        if (targetChap == currentChapterNum) return; // same chapter, do nothing
        ggRealCharIndex = -1;
        currentChapterNum = targetChap;
        savedCharIndex = 0; currentCharIndex = 0; lastSavedIndex = 0;
        if (currentUser && !currentUser.isAnonymous) {
            await setDoc(doc(db, "users", currentUser.uid, "progress", currentBookId), {
                chapter: currentChapterNum, charIndex: 0
            }, { merge: true });
        }
        closeModal();
        await loadChapter(targetChap);
        openGameGenie();
    };
    
    // Reset chapter
    document.getElementById('gg-reset-ch').onclick = () => {
        ggRealCharIndex = -1;
        jumpToSentence(s, 0);
        openGameGenie();
    };
    
    // Infinite mode toggle
    document.getElementById('gg-infinite').onclick = () => {
        if (sessionValueStr === 'infinity') {
            sessionValueStr = '30'; sessionLimit = 30;
        } else {
            sessionValueStr = 'infinity'; sessionLimit = 'infinity';
        }
        localStorage.setItem('ttb_sessionLength', sessionValueStr);
        openGameGenie(); // refresh UI
    };
    
    // Test text buttons
    document.getElementById('gg-test-pangram').onclick = () => {
        ggRealCharIndex = -1;
        closeModal();
        startTestText(TEST_TEXT_PANGRAM, 'Pangram');
    };
    document.getElementById('gg-test-alphabet').onclick = () => {
        ggRealCharIndex = -1;
        closeModal();
        startTestText(TEST_TEXT_ALPHABET, 'Alphabet');
    };
    document.getElementById('gg-allow-mistakes').onchange = (e) => {
        ggAllowMistakes = e.target.checked;
    };
    document.getElementById('gg-bypass-idle').onchange = (e) => {
        ggBypassIdle = e.target.checked;
    };
    
    // Return button
    if (document.getElementById('gg-return-btn')) {
        document.getElementById('gg-return-btn').onclick = () => {
            const realIdx = ggRealCharIndex;
            ggRealCharIndex = -1;
            currentCharIndex = realIdx;
            savedCharIndex = realIdx;
            sprintCharStart = realIdx;
            renderText();
            for (let i = 0; i < currentCharIndex; i++) {
                const el = document.getElementById(`char-${i}`);
                if (el) { el.classList.remove('active'); if (!el.classList.contains('space') && !el.classList.contains('enter') && !el.classList.contains('tab')) el.classList.add('done-perfect'); }
            }
            highlightCurrentChar(); centerView(); saveProgress();
            openGameGenie();
        };
    }
    
    // Warp input
    document.getElementById('gg-jump-btn').onclick = () => {
        const target = parseInt(document.getElementById('gg-jump-input').value) - 1;
        if (!isNaN(target)) { jumpToSentence(s, target); openGameGenie(); }
    };
    document.getElementById('gg-jump-input').oninput = () => {
        const target = parseInt(document.getElementById('gg-jump-input').value) - 1;
        if (!isNaN(target) && target >= 0 && target < s.length) {
            const preview = document.getElementById('gg-preview');
            if (preview) {
                preview.textContent = fullText.substring(s[target].start, s[target].start + 120) + (s[target].end - s[target].start > 120 ? '...' : '');
            }
        }
    };
    document.getElementById('gg-jump-input').onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('gg-jump-btn').click(); }
    };
    
    // Draggable slider
    const track = document.getElementById('gg-slider-track');
    const thumb = document.getElementById('gg-slider-thumb');
    const fill = document.getElementById('gg-slider-fill');
    
    function sliderJump(clientX) {
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const targetChar = Math.round(ratio * fullText.length);
        let nearest = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i].start <= targetChar) nearest = i;
            else break;
        }
        const newPct = Math.round((s[nearest].start / fullText.length) * 100);
        thumb.style.left = newPct + '%';
        fill.style.width = newPct + '%';
        return nearest;
    }
    
    let dragging = false;
    let dragTarget = 0;
    
    const onMove = (clientX) => {
        if (!dragging) return;
        dragTarget = sliderJump(clientX);
        const preview = document.getElementById('gg-preview');
        if (preview) preview.textContent = fullText.substring(s[dragTarget].start, s[dragTarget].start + 120) + (s[dragTarget].end - s[dragTarget].start > 120 ? '...' : '');
    };
    
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        thumb.style.cursor = 'grab';
        document.removeEventListener('mousemove', mouseMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', touchMove);
        document.removeEventListener('touchend', onUp);
        jumpToSentence(s, dragTarget);
        openGameGenie();
    };
    
    const mouseMove = (ev) => onMove(ev.clientX);
    const touchMove = (ev) => { ev.preventDefault(); onMove(ev.touches[0].clientX); };
    
    const startDrag = (clientX) => {
        dragging = true;
        thumb.style.cursor = 'grabbing';
        document.addEventListener('mousemove', mouseMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', touchMove, { passive: false });
        document.addEventListener('touchend', onUp);
        onMove(clientX);
    };
    
    thumb.onmousedown = (ev) => { ev.preventDefault(); startDrag(ev.clientX); };
    thumb.ontouchstart = (ev) => { ev.preventDefault(); startDrag(ev.touches[0].clientX); };
    track.onclick = (ev) => {
        const nearest = sliderJump(ev.clientX);
        jumpToSentence(s, nearest);
        openGameGenie();
    };
}

// === LEADERBOARD SYSTEM ===

async function loadInitials() {
    if (!currentUser || currentUser.isAnonymous) return false;
    try {
        const snap = await getDoc(doc(db, "users", currentUser.uid, "profile", "info"));
        if (snap.exists()) {
            const data = snap.data();
            if (data.initials) userInitials = data.initials;
            if (data.leaderboardOptOut !== undefined) leaderboardOptOut = data.leaderboardOptOut;
            if (userInitials) return false;
        }
        // No initials yet — prompt
        showInitialsPrompt();
        return true;
    } catch(e) { console.warn("Load initials failed:", e); return false; }
}

async function saveInitials(initials) {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid, "profile", "info"), { 
            initials, 
            leaderboardOptOut 
        }, { merge: true });
    } catch(e) { console.warn("Save initials failed:", e); }
}

function showInitialsPrompt() {
    isModalOpen = true; isInputBlocked = true;
    modalActionCallback = null;
    setModalTitle('');
    resetModalFooter();

    const prefill = getDefaultInitials();

    document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center;">
            <div class="stats-title">🏆 Enter Your Initials</div>
            <div style="font-size:0.9em; color:#555; margin: 6px 0 12px;">
                These appear on the leaderboard. Three characters max!
            </div>
            <div style="display:flex; justify-content:center; gap:8px;" id="initials-boxes">
                <input class="initials-box" maxlength="1" data-idx="0" value="${prefill[0] || ''}" autocomplete="off" autocapitalize="characters">
                <input class="initials-box" maxlength="1" data-idx="1" value="${prefill[1] || ''}" autocomplete="off" autocapitalize="characters">
                <input class="initials-box" maxlength="1" data-idx="2" autocomplete="off" autocapitalize="characters">
            </div>
            <div id="initials-error" style="color:#D32F2F; font-size:0.8em; margin-top:6px; min-height:1.2em;"></div>
        </div>
    `;

    const btn = document.getElementById('action-btn');
    btn.innerText = 'Save'; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
    btn.onclick = async () => {
        const boxes = document.querySelectorAll('.initials-box');
        const val = Array.from(boxes).map(b => b.value).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (val.length === 0) return;
        if (!isInitialsClean(val)) {
            const errEl = document.getElementById('initials-error');
            if (errEl) errEl.textContent = "Those initials aren't allowed. Try something else!";
            return;
        }
        userInitials = val.substring(0, 3);
        await saveInitials(userInitials);
        closeModal();

        // After first-time initials, check if furthest point is ahead
        if (isPositionAhead(furthestChapter, furthestCharIndex, currentChapterNum, currentCharIndex)) {
            showJumpToProgressPrompt(furthestChapter, furthestCharIndex);
            return;
        }

        showStartModal("Start");
    };
    showModalPanel();

    // Wire up auto-advance
    setTimeout(() => {
        const boxes = document.querySelectorAll('.initials-box');
        boxes.forEach((box, i) => {
            box.oninput = () => {
                box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (box.value && i < 2) boxes[i + 1].focus();
                // Clear error on edit
                const errEl = document.getElementById('initials-error');
                if (errEl) errEl.textContent = '';
            };
            box.onkeydown = (e) => {
                if (e.key === 'Backspace' && !box.value && i > 0) {
                    boxes[i - 1].focus();
                    boxes[i - 1].value = '';
                } else if (e.key === 'Enter') {
                    btn.click();
                }
            };
        });
        // Focus the first empty box (after prefill)
        const firstEmpty = Array.from(boxes).findIndex(b => !b.value);
        (firstEmpty >= 0 ? boxes[firstEmpty] : boxes[2]).focus();
        isInputBlocked = false;
    }, 100);
}

async function updateLeaderboard() {
    if (!currentUser || currentUser.isAnonymous || !userInitials) return [];
    try {
        const today = new Date().toISOString().split('T')[0];
        const weekStart = getWeekStart(new Date());
        
        // Read existing leaderboard entry
        const lbRef = doc(db, "leaderboard", currentUser.uid);
        const lbSnap = await getDoc(lbRef);
        const existing = lbSnap.exists() ? lbSnap.data() : {};
        
        // Reset daily/weekly if dates don't match
        const existingBestWPM = existing.bestWPM || 0;
        const existingBestAcc = existing.bestAccuracy || 0;
        const existingBestStreak = existing.bestStreak || 0;
        const existingChapters = existing.chaptersCompleted || 0;
        const existingTimeWeek = (existing.weekStart === weekStart) ? (existing.totalSecondsWeek || 0) : 0;
        
        // Compute current bests
        const lastSprintWPM = sprintHistory.length > 0 ? sprintHistory[sprintHistory.length - 1].wpm : 0;
        const lastSprintAcc = sprintHistory.length > 0 ? sprintHistory[sprintHistory.length - 1].acc : 0;
        
        const entry = {
            initials: userInitials,
            displayName: currentUser.displayName || '',
            leaderboardOptOut: leaderboardOptOut,
            bestWPM: Math.max(existingBestWPM, lastSprintWPM),
            bestAccuracy: Math.max(existingBestAcc, lastSprintAcc),
            bestStreak: Math.max(existingBestStreak, bestStreak),
            chaptersCompleted: Math.max(existingChapters, completedChapters.size),
            totalSecondsWeek: existingTimeWeek + sprintSeconds,
            weekStart: weekStart,
            lastUpdated: new Date()
        };
        
        await setDoc(lbRef, entry, { merge: true });

        // Now fetch all entries to compute placements
        leaderboardCacheTime = 0; // bust cache
        const allData = await fetchLeaderboard();
        const placements = [];
        for (const cat of LB_CATEGORIES) {
            const list = allData[cat.key] || [];
            const idx = list.findIndex(e => e.uid === currentUser.uid);
            if (idx >= 0 && idx < 10) {
                placements.push({ category: cat, rank: idx + 1 });
            }
        }
        return placements;
    } catch(e) { console.warn("Leaderboard update failed:", e); return []; }
}

const LB_CATEGORIES = [
    { key: 'bestWPM', label: '⚡ Speed', unit: 'WPM' },
    { key: 'bestAccuracy', label: '🎯 Accuracy', unit: '%' },
    { key: 'bestStreak', label: '🔥 Streak', unit: '' },
    { key: 'chaptersCompleted', label: '📚 Chapters', unit: '' },
    { key: 'totalSecondsWeek', label: '⏱️ Weekly', unit: '', format: 'time' }
];

async function fetchLeaderboard() {
    // Cache for 30 seconds
    if (Date.now() - leaderboardCacheTime < 30000 && Object.keys(leaderboardCache).length > 0) {
        return leaderboardCache;
    }
    try {
        const snap = await getDocs(collection(db, "leaderboard"));
        const entries = [];
        snap.forEach(d => {
            const data = d.data();
            data.uid = d.id;
            // Reset weekly if stale
            const weekStart = getWeekStart(new Date());
            if (data.weekStart !== weekStart) data.totalSecondsWeek = 0;
            entries.push(data);
        });
        
        const result = {};
        for (const cat of LB_CATEGORIES) {
            const sorted = [...entries]
                .filter(e => (e[cat.key] || 0) > 0 && !e.leaderboardOptOut)
                .sort((a, b) => (b[cat.key] || 0) - (a[cat.key] || 0))
                .slice(0, 10);
            result[cat.key] = sorted;
        }
        leaderboardCache = result;
        leaderboardCacheTime = Date.now();
        return result;
    } catch(e) { console.warn("Fetch leaderboard failed:", e); return {}; }
}

async function openLeaderboard(activeTab) {
    if (isGameActive) { isGameActive = false; clearInterval(timerInterval); }
    isModalOpen = true; isInputBlocked = false;
    modalGeneration++;
    setModalTitle('🏆 Leaderboard');
    resetModalFooter();
    
    document.getElementById('modal-body').innerHTML = `<div style="text-align:center; color:#888; padding:20px;">Loading...</div>`;
    showModalPanel();
    
    const btn = document.getElementById('action-btn');
    btn.innerText = 'Close'; btn.disabled = false; btn.style.opacity = '1'; btn.style.display = 'inline-block';
    btn.onclick = () => { closeModal(); showStartModal("Resume"); };
    modalActionCallback = () => { closeModal(); showStartModal("Resume"); };
    
    const data = await fetchLeaderboard();
    const activeCat = activeTab || LB_CATEGORIES[0].key;
    
    // Build tabs
    const tabs = LB_CATEGORIES.map(cat => {
        const active = cat.key === activeCat ? 'lb-tab-active' : '';
        return `<button class="lb-tab ${active}" data-cat="${cat.key}">${cat.label}</button>`;
    }).join('');
    
    // Build active list
    const entries = data[activeCat] || [];
    let listHTML = '';
    if (entries.length === 0) {
        listHTML = '<div style="color:#999; padding:12px;">No entries yet. Keep typing!</div>';
    } else {
        const cat = LB_CATEGORIES.find(c => c.key === activeCat);
        listHTML = entries.map((entry, i) => {
            const isMe = currentUser && entry.uid === currentUser.uid;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:#999; width:1.5em; display:inline-block; text-align:right;">${i + 1}</span>`;
            let val = entry[activeCat] || 0;
            if (cat.format === 'time') val = formatTime(val);
            else val = val + (cat.unit || '');
            return `<div class="lb-entry ${isMe ? 'lb-me' : ''}">${medal} <span class="lb-initials">${escapeHtml(entry.initials || '???')}</span> <span class="lb-val">${val}</span></div>`;
        }).join('');
    }
    
    document.getElementById('modal-body').innerHTML = `
        <div class="lb-container">
            <div class="lb-tabs">${tabs}</div>
            <div class="lb-list">${listHTML}</div>
        </div>
    `;
    
    // Wire tab clicks
    document.querySelectorAll('.lb-tab').forEach(tab => {
        tab.onclick = () => openLeaderboard(tab.dataset.cat);
    });
}

// ========================
// PRACTICE MODE
// ========================

// Test Text constants (used via Game Genie)
const TEST_TEXT_PANGRAM = '"The quick brown fox jumps over the lazy dog!" exclaimed 4 typing teachers.';
const TEST_TEXT_ALPHABET = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890';

function startTestText(text, label) {
    if (isPracticeMode) return;

    // Save real book state (reuse practice mode machinery)
    practiceRealBookData = bookData;
    practiceRealChapterNum = currentChapterNum;
    practiceRealCharIndex = currentCharIndex;
    practiceRealSavedCharIndex = savedCharIndex;
    practiceRealLastSavedIndex = lastSavedIndex;
    practiceRealFurthestChapter = furthestChapter;
    practiceRealFurthestCharIndex = furthestCharIndex;

    // Enter practice mode with test text
    isPracticeMode = true;
    practiceText = text;
    practiceMissedSnapshot = { ...missedCharsMap };
    bookData = { segments: [{ text: text }] };
    savedCharIndex = 0;
    currentCharIndex = 0;
    lastSavedIndex = 0;
    sprintSeconds = 0;
    sprintMistakes = 0;
    sprintCharStart = 0;

    setupGame();
    getHeaderHTML();

    const bar = document.getElementById('book-info-bar');
    if (bar) bar.classList.add('practice-active');

    closeModal();

    isModalOpen = true; isInputBlocked = false;
    modalActionCallback = startGame;
    setModalTitle('');
    resetModalFooter();
    document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center;">
            <div class="stats-title">🔥 Test Text: ${escapeHtml(label)}</div>
            <div style="font-size:0.8em; color:#888; margin:6px 0; font-family:'Courier Prime',monospace;">${escapeHtml(text)}</div>
            <div class="start-hint" style="margin-top:8px;">Type first character to start · ESC to pause</div>
        </div>
    `;
    const startBtn = document.getElementById('action-btn');
    startBtn.innerText = 'Start Typing'; startBtn.onclick = startGame;
    startBtn.disabled = false; startBtn.style.display = 'inline-block'; startBtn.style.opacity = '1';
    showModalPanel();
}

async function startPracticeMode() {
    if (isPracticeMode) return;
    
    // Get the problem characters from the current session
    const entries = Object.entries(missedCharsMap).sort((a,b) => b[1] - a[1]).slice(0, 8);
    if (entries.length === 0) return;
    practiceProblemChars = entries.map(([ch]) => ch);
    
    // Get a text snippet for style reference (first 500 chars of current chapter)
    const textSnippet = (fullText || '').substring(0, 500);
    
    // Get book/chapter info
    let chapterTitle = '';
    if (bookMetadata && bookMetadata.chapters) {
        const c = bookMetadata.chapters.find(ch => ch.id === "chapter_" + currentChapterNum);
        if (c && c.title) chapterTitle = c.title;
    }
    const bookTitle = (bookMetadata && bookMetadata.title) || currentBookId.replace(/_/g, ' ');

    // Show loading state
    closeModal();
    isModalOpen = true; isInputBlocked = true;
    setModalTitle('');
    resetModalFooter();
    document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center; padding:20px;">
            <div class="stats-title">✨ Generating Practice...</div>
            <div style="font-size:0.85em; color:#888; margin-top:8px;">
                Creating a paragraph focused on: ${practiceProblemChars.map(c => `<b style="color:#D32F2F;">${escapeHtml(c)}</b>`).join(', ')}
            </div>
            <div style="margin-top:12px; color:#aaa;">This may take a few seconds...</div>
        </div>
    `;
    const btn = document.getElementById('action-btn');
    btn.style.display = 'none';
    showModalPanel();

    try {
        const result = await generatePractice({
            problemChars: practiceProblemChars,
            bookTitle: bookTitle,
            chapterTitle: chapterTitle,
            textSnippet: textSnippet
        });

        practiceText = result.data.text;
        practicePrompt = result.data.prompt || '';
        const remaining = result.data.remaining;

        // Save real book state
        practiceRealBookData = bookData;
        practiceRealChapterNum = currentChapterNum;
        practiceRealCharIndex = currentCharIndex;
        practiceRealSavedCharIndex = savedCharIndex;
        practiceRealLastSavedIndex = lastSavedIndex;
        practiceRealFurthestChapter = furthestChapter;
        practiceRealFurthestCharIndex = furthestCharIndex;

        // Enter practice mode
        isPracticeMode = true;
        hasDonePractice = true;
        practiceTypingAccumulator = 0;
        practiceMissedSnapshot = { ...missedCharsMap };
        
        // Inject practice text as a fake chapter
        bookData = { segments: [{ text: practiceText }] };
        savedCharIndex = 0;
        currentCharIndex = 0;
        lastSavedIndex = 0;

        // Reset sprint tracking for practice
        sprintSeconds = 0;
        sprintMistakes = 0;
        sprintCharStart = 0;

        // Set up the display
        setupGame();
        getHeaderHTML();
        
        // Add practice visual indicator
        const bar = document.getElementById('book-info-bar');
        if (bar) bar.classList.add('practice-active');
        
        closeModal();
        
        // Show practice start modal
        isModalOpen = true; isInputBlocked = false;
        modalActionCallback = startGame;
        setModalTitle('');
        resetModalFooter();
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center;">
                <div class="stats-title">✨ Practice Ready!</div>
                <div style="font-size:0.85em; color:#888; margin:6px 0;">
                    Focused on: ${practiceProblemChars.map(c => `<b style="color:#D32F2F;">${escapeHtml(c)}</b>`).join(', ')}
                </div>
                ${remaining !== undefined ? `<div style="font-size:0.75em; color:#aaa;">${remaining} practice session${remaining !== 1 ? 's' : ''} remaining today</div>` : ''}
                <div class="start-hint" style="margin-top:8px;">Type first character to start · ESC to pause</div>
            </div>
        `;
        const startBtn = document.getElementById('action-btn');
        startBtn.innerText = 'Start Practice'; startBtn.onclick = startGame;
        startBtn.disabled = false; startBtn.style.display = 'inline-block'; startBtn.style.opacity = '1';
        showModalPanel();

    } catch (e) {
        console.error("Practice generation failed:", e);
        let errorMsg = 'Something went wrong. Please try again.';
        if (e.code === 'functions/resource-exhausted') {
            errorMsg = e.message || "You've used all your practice sessions for today.";
        } else if (e.code === 'functions/unauthenticated') {
            errorMsg = 'You must be signed in to use practice mode.';
        }
        
        // Show error then go back to break modal
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center; padding:12px;">
                <div class="stats-title">⚠️ Practice Unavailable</div>
                <div style="font-size:0.9em; color:#888; margin-top:8px;">${escapeHtml(errorMsg)}</div>
            </div>
        `;
        const errBtn = document.getElementById('action-btn');
        errBtn.innerText = 'OK'; errBtn.disabled = false; errBtn.style.opacity = '1'; errBtn.style.display = 'inline-block';
        errBtn.onclick = () => { closeModal(); showStartModal("Continue"); };
        modalActionCallback = () => { closeModal(); showStartModal("Continue"); };
    }
}

function exitPracticeMode() {
    if (!isPracticeMode) return;
    
    // Restore real book state
    isPracticeMode = false;
    bookData = practiceRealBookData;
    currentChapterNum = practiceRealChapterNum;
    savedCharIndex = practiceRealCharIndex;
    currentCharIndex = practiceRealCharIndex;
    lastSavedIndex = practiceRealLastSavedIndex;
    furthestChapter = practiceRealFurthestChapter;
    furthestCharIndex = practiceRealFurthestCharIndex;

    // Clear practice state
    practiceRealBookData = null;
    practiceRealChapterNum = null;
    practiceRealCharIndex = null;
    practiceRealSavedCharIndex = null;
    practiceRealLastSavedIndex = null;
    practiceRealFurthestChapter = null;
    practiceRealFurthestCharIndex = null;
    practiceText = '';
    practicePrompt = '';
    practiceProblemChars = [];
    practiceMissedSnapshot = {};

    // Remove practice visual indicator
    const bar = document.getElementById('book-info-bar');
    if (bar) bar.classList.remove('practice-active');

    // Rebuild fullText to check if we were at chapter end
    setupGame();
    getHeaderHTML();
    closeModal();

    // If restored position is at/past chapter end, advance to next chapter
    if (currentCharIndex >= fullText.length) {
        autoStartNext = true;
        advanceToNextChapter();
        return;
    }
}

async function logPracticeSession(wpm, acc, seconds, chars, mistakes) {
    if (!currentUser || currentUser.isAnonymous) return;
    try {
        await addDoc(collection(db, "practice_sessions"), {
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || 'Anonymous',
            timestamp: new Date(),
            date: new Date().toISOString().split('T')[0],
            bookId: currentBookId,
            chapter: practiceRealChapterNum,
            problemChars: practiceProblemChars,
            prompt: practicePrompt,
            generatedText: practiceText,
            wpm: wpm,
            accuracy: acc,
            seconds: seconds,
            chars: chars,
            mistakes: mistakes,
            // Capture which chars were still problematic during practice
            practiceErrors: Object.entries(missedCharsMap)
                .filter(([ch]) => practiceProblemChars.includes(ch))
                .map(([ch, count]) => ({ char: ch, errors: count }))
        });
    } catch(e) { console.warn("Practice session log failed:", e); }
}

window.onload = init;
