// v1.8.1 - Layout Stability & Vertical Centering
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.8.1";
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
let statsData = { secondsToday: 0, secondsWeek: 0, lastDate: "", weekStart: 0 };

// Game State
let mistakes = 0; let sprintMistakes = 0; let activeSeconds = 0; let sprintSeconds = 0; let sprintCharStart = 0; 
let timerInterval = null; let isGameActive = false; let isOvertime = false; let isModalOpen = false; 
let isInputBlocked = false; let modalActionCallback = null;

// Timer & Speed
let lastInputTime = 0; let timeAccumulator = 0; let wpmHistory = []; let accuracyHistory = []; 

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
        btn.innerHTML = '&#9776;'; // Menu Icon
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
        try { await signInWithPopup(auth, provider); } catch (error) { alert("Login failed: " + error.message); }
    });
    logoutBtn.addEventListener('click', async () => {
        try { await signOut(auth); location.reload(); } catch (error) { console.error("Logout failed", error); }
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
            currentChapterNum = 1; savedCharIndex = 0;
        }
        lastSavedIndex = savedCharIndex; 
        loadChapter(currentChapterNum);
    } catch (e) { console.error("Load Progress Error:", e); loadChapter(1); }
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
                alert(`Chapter ${chapterNum} is not available yet! Returning to Chapter 1.`);
                currentChapterNum = 1; savedCharIndex = 0;
                loadChapter(1);
            } else {
                textStream.innerText = "Chapter 1 not found. Please upload it.";
            }
        }
    } catch (e) { textStream.innerHTML = "Error loading chapter."; }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join(" ");
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    currentCharIndex = savedCharIndex;
    
    // Auto-advance if landing on a space
    if (fullText[currentCharIndex] === ' ') currentCharIndex++;

    // Mark previous text as done
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
    let title = `Chapter ${currentChapterNum}`;
    
    if (savedCharIndex === 0) {
        btnLabel = "Start Reading";
    }

    if (!isGameActive) showStartModal(title, btnLabel);
}

// --- ENGINE ---
function renderText() {
    textStream.innerHTML = '';
    const frag = document.createDocumentFragment();
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
        frag.appendChild(wordSpan);
    });
    textStream.appendChild(frag);
}

function startGame() {
    const select = document.getElementById('sprint-select');
    if (select) {
        sessionValueStr = select.value;
        sessionLimit = (sessionValueStr === 'infinity') ? 'infinity' : parseInt(sessionValueStr);
    }
    closeModal();
    isGameActive = true;
    isOvertime = false;
    
    sprintSeconds = 0; sprintMistakes = 0; sprintCharStart = currentCharIndex; 
    activeSeconds = 0; timeAccumulator = 0; lastInputTime = Date.now(); 
    wpmHistory = []; accuracyHistory = [];
    accDisplay.innerText = "100%"; wpmDisplay.innerText = "0";
    timerDisplay.style.color = 'white'; timerDisplay.style.opacity = '1';

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
            activeSeconds++; sprintSeconds++; statsData.secondsToday++; statsData.secondsWeek++;
            timeAccumulator -= 1000;
            updateTimerUI();
        }
    } else {
        timerDisplay.style.opacity = '0.5';
        wpmDisplay.innerText = "0"; wpmHistory = []; 
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
        if (timeDiffMin > 0) wpmDisplay.innerText = Math.round((chars / 5) / timeDiffMin);
    }
}

function updateRunningAccuracy(isCorrect) {
    accuracyHistory.push(isCorrect ? 1 : 0);
    if (accuracyHistory.length > 50) accuracyHistory.shift();
    const correctCount = accuracyHistory.filter(val => val === 1).length;
    const total = accuracyHistory.length;
    if (total > 0) accDisplay.innerText = Math.round((correctCount / total) * 100) + "%";
}

// --- INPUT HANDLING ---
document.addEventListener('keydown', (e) => {
    if (isInputBlocked || !isGameActive) return;
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') return;

    if (e.key === 'Escape') { pauseGameForBreak(); return; }

    const targetChar = fullText[currentCharIndex];
    lastInputTime = Date.now();
    updateTimerUI();

    let isCorrect = (e.key === targetChar);
    
    const charEl = document.getElementById(`char-${currentCharIndex}`);
    if (charEl) {
        if (isCorrect) {
            charEl.classList.remove('active', 'error-state');
            charEl.classList.add('done-perfect');
            currentCharIndex++;
            updateRunningWPM();
            updateRunningAccuracy(true);
            highlightCurrentChar();
            centerView();
            updateImageDisplay();
            
            // Check End of Chapter
            if (currentCharIndex >= fullText.length) {
                finishChapter();
            }
        } else {
            mistakes++; sprintMistakes++;
            charEl.classList.add('error-state');
            updateRunningAccuracy(false);
            flashKey(targetChar); 
        }
    }
});

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

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    
    const nextChapter = currentChapterNum + 1;
    
    // Calculate Final Stats
    const stats = {
        time: sprintSeconds,
        wpm: 0, // Calculate properly if needed
        acc: 100,
        today: formatTime(statsData.secondsToday),
        week: formatTime(statsData.secondsWeek)
    };
    
    // Show Modal
    showStatsModal(`Chapter ${currentChapterNum} Complete!`, stats, `Start Chapter ${nextChapter}`, async () => {
        // RESET Logic for Next Chapter
        currentChapterNum = nextChapter;
        savedCharIndex = 0;
        currentCharIndex = 0;
        lastSavedIndex = 0;
        
        // Save to DB immediately so refresh works
        await saveProgress(true); // force save
        
        // Load
        loadChapter(nextChapter);
    });
}

// --- VIEW & KEYBOARD ---
function centerView() {
    const activeEl = document.getElementById(`char-${currentCharIndex}`);
    if (activeEl) {
        // Simple offset strategy compatible with flexbox centering
        const containerWidth = textStream.parentElement.offsetWidth;
        const offset = activeEl.offsetLeft - (containerWidth * 0.1); 
        textStream.style.transform = `translateX(-${Math.max(0, offset)}px)`;
    }
}

function highlightCurrentChar() {
    document.querySelectorAll('.letter.active').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`char-${currentCharIndex}`);
    if (el) {
        el.classList.add('active');
        highlightKey(fullText[currentCharIndex]);
    }
}

function createKeyboard() {
    const layout = [
        "1234567890-=",
        "QWERTYUIOP[]\\",
        "ASDFGHJKL;'",
        "ZXCVBNM,./"
    ];
    const shiftLayout = [
        "!@#$%^&*()_+",
        "QWERTYUIOP{}|",
        "ASDFGHJKL:\"",
        "ZXCVBNM<>?"
    ];

    keyboardDiv.innerHTML = ''; 
    layout.forEach((rowStr, rIndex) => {
        const row = document.createElement('div');
        row.className = 'kb-row';
        for (let i = 0; i < rowStr.length; i++) {
            const k = document.createElement('div');
            k.className = 'key';
            k.dataset.char = rowStr[i].toLowerCase();
            k.dataset.shift = shiftLayout[rIndex][i];
            k.innerText = rowStr[i]; 
            k.id = `key-${rowStr[i]}`; 
            if (rowStr[i] === '\\') k.id = 'key-backslash';
            if (rowStr[i] === '"') k.id = 'key-quote';
            row.appendChild(k);
        }
        keyboardDiv.appendChild(row);
    });
    
    // Spacebar
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kb-row';
    const space = document.createElement('div');
    space.className = 'key space';
    space.id = 'key- ';
    spaceRow.appendChild(space);
    keyboardDiv.appendChild(spaceRow);
}

function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target', 'shift-active'));
    
    if (!char) return;

    let targetId = '';
    let needsShift = false;

    if (char === ' ') {
        targetId = 'key- ';
    } else {
        const allKeys = document.querySelectorAll('.key');
        for (let k of allKeys) {
            if (k.dataset.char === char.toLowerCase() && !isShiftChar(char)) {
                 targetId = k.id;
                 break;
            }
            if (k.dataset.shift === char) {
                targetId = k.id;
                needsShift = true;
                break;
            }
            // Fallback for uppercase letters that aren't special symbols
            if (k.dataset.char === char.toLowerCase() && char === char.toUpperCase() && char.match(/[A-Z]/)) {
                targetId = k.id;
                needsShift = true;
                break;
            }
        }
    }

    const el = document.getElementById(targetId);
    if (el) {
        el.classList.add('target');
        if (needsShift) {
             // Visual indication for shift, maybe highlight Shift keys?
             // specific implementation omitted for brevity, but class exists
        }
    }
}

function isShiftChar(char) {
    return "~!@#$%^&*()_+{}|:\"<>?".includes(char);
}

function flashKey(char) {
    const el = document.getElementById(`key-${char.toUpperCase()}`); 
    if(el) {
        el.style.backgroundColor = '#ffcccc';
        setTimeout(() => el.style.backgroundColor = '', 200);
    }
}

function updateImageDisplay() {
    if(!bookData || !bookData.segments) return;
    const currentSegment = bookData.segments.find(seg => {
        // Approximate which segment we are in (simplified logic)
        // Ideally, segments should track their start index.
        // For now, let's just show the image of the first segment for testing
        return seg.image; 
    });
    if(currentSegment && currentSegment.image) {
        storyImg.src = currentSegment.image;
        imgPanel.style.display = 'block';
    }
}

// --- MODALS ---
function showStartModal(title, btnText) {
    isModalOpen = true; isInputBlocked = true;
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    
    const html = `
        <div class="stat-subtext">
            Session Goal: 
            <select id="sprint-select" class="modal-select">
                <option value="30" ${sessionValueStr==="30"?"selected":""}>30 Seconds</option>
                <option value="60" ${sessionValueStr==="60"?"selected":""}>1 Minute</option>
                <option value="300" ${sessionValueStr==="300"?"selected":""}>5 Minutes</option>
                <option value="infinity" ${sessionValueStr==="infinity"?"selected":""}>No Limit</option>
            </select>
        </div>
    `;
    document.getElementById('modal-body').innerHTML = html;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = startGame;
    
    modal.classList.remove('hidden');
}

function showStatsModal(title, stats, btnText, callback) {
    isModalOpen = true; isInputBlocked = true;
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    
    const html = `
        <div class="stat-row">
            <div class="stat-item"><span>${stats.time}s</span>Active</div>
            <div class="stat-item"><span>${stats.acc}%</span>Accuracy</div>
        </div>
        <div class="stat-subtext">
            Today: <span class="highlight">${stats.today}</span> | 
            Week: <span class="highlight">${stats.week}</span>
        </div>
    `;
    document.getElementById('modal-body').innerHTML = html;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = btnText;
    btn.onclick = () => { closeModal(); if(callback) callback(); };
    
    modal.classList.remove('hidden');
}

function openMenuModal() {
    if (isGameActive) { isGameActive = false; clearInterval(timerInterval); saveProgress(); }
    isModalOpen = true; isInputBlocked = true;
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = "Menu & Settings";
    
    let chapterOptions = "";
    // List chapters 1-5 for now
    for(let i=1; i<=5; i++) {
        let sel = (i === currentChapterNum) ? "selected" : "";
        chapterOptions += `<option value="${i}" ${sel}>Chapter ${i}</option>`;
    }

    const html = `
        <div class="menu-section">
            <span class="menu-label">Navigation</span>
            <div style="display:flex; gap:10px;">
                <select id="chapter-nav-select" class="modal-select" style="margin:0; flex-grow:1;">${chapterOptions}</select>
                <button id="go-btn" class="modal-btn" style="width:auto; padding:0 20px; margin-top:0;">Go</button>
            </div>
        </div>
        <div class="menu-section">
            <span class="menu-label">Danger Zone</span>
            <button id="restart-chapter-btn" class="modal-btn danger-btn">Restart Chapter</button>
            <button id="reset-book-btn" class="modal-btn danger-btn">Reset Book</button>
        </div>
        <button id="close-menu-btn" class="modal-btn secondary-btn">Close Menu</button>
    `;
    
    document.getElementById('modal-body').innerHTML = html;
    
    document.getElementById('go-btn').onclick = () => {
        const val = parseInt(document.getElementById('chapter-nav-select').value);
        if(val !== currentChapterNum) {
            if (val < currentChapterNum) {
                confirmAction("Go back? Unsaved progress in this chapter will be lost.", () => switchChapter(val));
            } else {
                // Moving forward is always allowed without warning
                switchChapter(val);
            }
        }
    };
    
    document.getElementById('restart-chapter-btn').onclick = () => {
        confirmAction("Restart this chapter?", () => switchChapter(currentChapterNum, true));
    };
    document.getElementById('reset-book-btn').onclick = () => {
        confirmAction("Reset entire book?", () => switchChapter(1, true));
    };
    document.getElementById('close-menu-btn').onclick = () => {
        closeModal();
        if(!isGameActive) showStartModal(`Chapter ${currentChapterNum}`, "Resume");
    };
    
    modal.classList.remove('hidden');
    // Hide main action btn in menu mode
    document.getElementById('action-btn').classList.add('hidden');
}

async function switchChapter(newChapNum, resetIndex = false) {
    currentChapterNum = newChapNum;
    savedCharIndex = 0; // Always start fresh on manual switch unless we build sophisticated bookmarking
    
    // Save new location
    await setDoc(doc(db, "users", currentUser.uid, "progress", BOOK_ID), {
        chapter: currentChapterNum,
        charIndex: 0 
    }, { merge: true });
    
    location.reload();
}

function confirmAction(msg, action) {
    if(confirm(msg)) action();
}

function closeModal() {
    isModalOpen = false; isInputBlocked = false;
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('action-btn').classList.remove('hidden');
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

window.onload = init;
