// v1.9.1 - Vertical Layout, No-Reload Navigation & Fixed Stats
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.9.1";
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
let sessionLimit = 30; 
let sessionValueStr = "30"; 

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
    
    // Inject Menu Button
    if (!document.getElementById('menu-btn')) {
        const btn = document.createElement('button');
        btn.id = 'menu-btn';
        btn.innerHTML = '&#9881;'; // Gear Icon
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
            statsData.secondsToday = (data.lastDate === dateStr) ? (data.secondsToday || 0) : 0;
            statsData.secondsWeek = (data.weekStart === weekStart) ? (data.secondsWeek || 0) : 0;
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
    
    // Reset HUD
    accDisplay.innerText = "---";
    wpmDisplay.innerText = "0";
    timerDisplay.innerText = "00:00";
    
    let btnLabel = "Resume Reading";
    if (savedCharIndex === 0) btnLabel = "Start Reading";

    if (!isGameActive) {
        showStartModal(`Chapter ${currentChapterNum}`, btnLabel);
    }
}

// --- ENGINE (VERTICAL) ---
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
    const select = document.getElementById('sprint-select');
    if (select) {
        sessionValueStr = select.value;
        sessionLimit = (sessionValueStr === 'infinity') ? 'infinity' : parseInt(sessionValueStr);
    }

    if (fullText[currentCharIndex] === ' ') {
        const spaceEl = document.getElementById(`char-${currentCharIndex}`);
        if (spaceEl) spaceEl.classList.add('done-perfect');
        currentCharIndex++;
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
    // Modal Navigation (Enter key support for Dropdowns and Buttons)
    if (isModalOpen) {
        if (isInputBlocked) return;
        
        if (e.key === "Enter") { 
            e.preventDefault(); 
            if (modalActionCallback) modalActionCallback();
        }
        return;
    }
    
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
        
        if (['.', '!', '?'].includes(targetChar)) saveProgress();
        else if (['"', "'"].includes(targetChar) && currentCharIndex >= 2) {
            const prevChar = fullText[currentCharIndex - 2];
            if (['.', '!', '?'].includes(prevChar)) saveProgress();
        }

        updateRunningWPM();
        updateRunningAccuracy(true);

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
    if (el) {
        el.classList.add('active');
        highlightKey(fullText[currentCharIndex]);
    }
}

function updateImageDisplay() {
    if(!bookData || !bookData.segments) return;
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

async function saveProgress(force = false) {
    if (!currentUser) return;
    try {
        if (currentCharIndex > lastSavedIndex || force) {
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
    } catch (e) { console.warn("Save failed:", e); }
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
    
    const stats = { 
        time: sprintSeconds, 
        wpm: sprintWPM, 
        acc: 100,
        today: formatTime(statsData.secondsToday),
        week: formatTime(statsData.secondsWeek)
    };
    
    showStatsModal("Sprint Complete", stats, "Continue", startGame);
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    
    const nextChapter = currentChapterNum + 1;
    
    const stats = {
        time: sprintSeconds,
        wpm: 0, 
        acc: 100,
        today: formatTime(statsData.secondsToday),
        week: formatTime(statsData.secondsWeek)
    };
    
    // Auto-advance logic without Reload
    showStatsModal(`Chapter ${currentChapterNum} Complete!`, stats, `Start Chapter ${nextChapter}`, async () => {
        // Hot-load next chapter
        await saveProgress(true); // force save current completion
        
        // Reset state for next chapter
        currentChapterNum = nextChapter;
        savedCharIndex = 0;
        currentCharIndex = 0;
        lastSavedIndex = 0;
        
        // Save new position
        await setDoc(doc(db, "users", currentUser.uid, "progress", BOOK_ID), {
            chapter: currentChapterNum,
            charIndex: 0
        }, { merge: true });

        // Load content immediately
        loadChapter(nextChapter);
    });
}

// --- MODALS & MENUS ---

function getDropdownHTML() {
    const options = [
        {val: "30", label: "30 Seconds"},
        {val: "60", label: "1 Minute"},
        {val: "120", label: "2 Minutes"},
        {val: "300", label: "5 Minutes"},
        {val: "infinity", label: "Open Ended (∞)"},
    ];
    let optionsHtml = options.map(opt => `<option value="${opt.val}" ${sessionValueStr === opt.val ? 'selected' : ''}>${opt.label}</option>`).join('');
    
    return `
        <div style="margin-bottom: 20px; text-align:center;">
            <label for="sprint-select" style="color:#777; font-size:0.8rem; display:block; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Session Length</label>
            <select id="sprint-select" class="modal-select">${optionsHtml}</select>
        </div>`;
}

function showStartModal(title, btnText) {
    isModalOpen = true; isInputBlocked = true;
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    
    const html = `
        ${getDropdownHTML()}
        <p style="font-size:0.8rem; color:#777; margin-top: 15px;">
            Type the first letter or press <b>ENTER</b> to start.<br>
            Press <b>ESC</b> anytime to pause.
        </p>
    `;
    document.getElementById('modal-body').innerHTML = html;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = startGame;
    btn.style.display = 'inline-block';
    
    modal.classList.remove('hidden');
}

function showStatsModal(title, stats, btnText, callback) {
    isModalOpen = true; isInputBlocked = true;
    const modal
