// v1.9.1.9 - Fixed Paragraph Wrapping & Layout
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.9.1.9";
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
let statsData = { secondsToday: 0, secondsWeek: 0, lastDate: "", weekStart: 0 };

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
            statsData.secondsToday = (data.lastDate === dateStr) ? (data.secondsToday || 0) : 0;
            statsData.secondsWeek = (data.weekStart === weekStart) ? (data.secondsWeek || 0) : 0;
        } else {
            statsData.secondsToday = 0;
            statsData.secondsWeek = 0;
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
    
    // Auto-advance if load starts on space
    if (fullText[currentCharIndex] === ' ') {
        const spaceEl = document.getElementById(`char-${currentCharIndex}`);
        if (spaceEl) spaceEl.classList.add('done-perfect');
        currentCharIndex++;
    }

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
            // Close current word
            if (wordBuffer.hasChildNodes()) container.appendChild(wordBuffer);
            
            // Enter Key Container
            const enterWord = document.createElement('span');
            enterWord.className = 'word';
            const span = document.createElement('span');
            span.className = 'letter enter';
            span.innerText = ''; 
            span.id = `char-${i}`;
            enterWord.appendChild(span);
            container.appendChild(enterWord);
            
            // Visual Break
            container.appendChild(document.createElement('br'));
            
            // Reset Buffer
            wordBuffer = document.createElement('span');
            wordBuffer.className = 'word';
            
        } else if (char === ' ') {
            // Space signifies end of visual word
            const span = document.createElement('span');
            span.className = 'letter space';
            span.innerText = ' ';
            span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            
            container.appendChild(wordBuffer);
            wordBuffer = document.createElement('span');
            wordBuffer.className = 'word';
            
        } else if (char === '\t') {
            const span = document.createElement('span');
            span.className = 'letter tab';
            span.innerText = ''; 
            span.id = `char-${i}`;
            wordBuffer.appendChild(span);
            
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

    if (fullText[currentCharIndex] === ' ') {
        const spaceEl = document.getElementById(`char-${currentCharIndex}`);
        if (spaceEl) spaceEl.classList.add('done-perfect');
        currentCharIndex++;
        highlightCurrentChar();
        centerView();
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
    if (isModalOpen) {
        if (isInputBlocked) return; 

        let effectiveTarget = fullText[currentCharIndex];
        let nextChar = null;
        if (effectiveTarget === ' ' && currentCharIndex + 1 < fullText.length) {
            nextChar = fullText[currentCharIndex + 1];
        }

        const isStartKey = (e.key === "Enter") || (e.key === " ");
        let isMatchKey = (e.key === effectiveTarget) || (nextChar && e.key === nextChar);
        if (effectiveTarget === '\t' && e.key === 'Tab') isMatchKey = true;
        if (effectiveTarget === '\n' && e.key === 'Enter') isMatchKey = true;

        if ((isStartKey || isMatchKey) && modalActionCallback) {
            e.preventDefault();
            modalActionCallback(); 
            if (isMatchKey) handleTyping(e.key); 
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

    const targetChar = fullText[currentCharIndex];
    const currentEl = document.getElementById(`char-${currentCharIndex}`);

    let inputChar = key;
    if (key === "Tab") inputChar = "\t";
    if (key === "Enter") inputChar = "\n";

    if (key === "Backspace") {
        if (currentLetterStatus === 'error') {
            currentLetterStatus = 'fixed';
            currentEl.classList.remove('error-state');
        }
        return;
    }

    if (inputChar === targetChar) {
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
        mistakes++;
        sprintMistakes++;
        if (currentLetterStatus === 'clean') currentLetterStatus = 'error';
        currentEl.classList.add('error-state'); 
        flashKey(key); 
        updateRunningAccuracy(false);
    }
}

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
    if (!seconds) return "0m 0s"; 
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
    
    const todayStr = formatTime(statsData.secondsToday);
    const weekStr = formatTime(statsData.secondsWeek);
    
    const stats = { 
        time: sprintSeconds, 
        wpm: sprintWPM, 
        acc: 100,
        today: todayStr,
        week: weekStr
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
    
    showStatsModal(`Chapter ${currentChapterNum} Complete!`, stats, `Start Chapter ${nextChapter}`, async () => {
        await saveProgress(true); 
        currentChapterNum = nextChapter;
        savedCharIndex = 0;
        currentCharIndex = 0;
        lastSavedIndex = 0;
        await setDoc(doc(db, "users", currentUser.uid, "progress", BOOK_ID), {
            chapter: currentChapterNum,
            charIndex: 0
        }, { merge: true });
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
    isModalOpen = true; 
    isInputBlocked = false; 
    modalActionCallback = startGame;

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
    btn.disabled = false;
    btn.style.display = 'inline-block';
    
    modal.classList.remove('hidden');
}

function showStatsModal(title, stats, btnText, callback) {
    isModalOpen = true; 
    isInputBlocked = true; 
    modalActionCallback = () => { closeModal(); if(callback) callback(); };

    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = title;
    
    const html = `
        <div class="stat-grid" style="display:flex; justify-content:center; gap:20px; margin:20px 0;">
            <div class="stat-box">
                <div style="font-size:1.8em; font-weight:bold;">${stats.wpm}</div>
                <div style="font-size:0.9em; color:#777;">WPM</div>
            </div>
            <div class="stat-box">
                <div style="font-size:1.8em; font-weight:bold;">${stats.acc}%</div>
                <div style="font-size:0.9em; color:#777;">Accuracy</div>
            </div>
            <div class="stat-box">
                <div style="font-size:1.8em; font-weight:bold;">${formatTime(stats.time)}</div>
                <div style="font-size:0.9em; color:#777;">Time</div>
            </div>
        </div>
        <div class="stat-subtext">
            Today: <span class="highlight">${stats.today}</span> | 
            Week: <span class="highlight">${stats.week}</span>
        </div>
    `;
    
    document.getElementById('modal-body').innerHTML = html;
    
    const btn = document.getElementById('action-btn');
    btn.innerText = "Wait..."; 
    btn.onclick = modalActionCallback;
    btn.disabled = true; 
    btn.style.opacity = '0.5'; 
    
    modal.classList.remove('hidden');

    setTimeout(() => {
        isInputBlocked = false;
        if(document.getElementById('action-btn')) {
            const b = document.getElementById('action-btn');
            b.style.opacity = '1';
            b.innerText = btnText; 
            b.disabled = false;
        }
    }, SPRINT_COOLDOWN_MS);
}

function closeModal() {
    isModalOpen = false;
    isInputBlocked = false;
    document.getElementById('modal').classList.add('hidden');
    
    const keyboard = document.getElementById('virtual-keyboard');
    if(keyboard) keyboard.focus();
}

function openMenuModal() {
    if (isGameActive) pauseGameForBreak();
    
    isModalOpen = true;
    isInputBlocked = false;
    modalActionCallback = () => { closeModal(); startGame(); };
    
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').innerText = "Settings";
    
    let chapterOptions = "";
    for(let i=1; i<=5; i++) {
        let sel = (i === currentChapterNum) ? "selected" : "";
        chapterOptions += `<option value="${i}" ${sel}>Chapter ${i}</option>`;
    }

    document.getElementById('modal-body').innerHTML = `
        <div class="menu-section">
            <div class="menu-label">Navigation</div>
            <div style="display:flex; gap:10px;">
                <select id="chapter-nav-select" class="modal-select" style="margin:0; flex-grow:1;">
                    ${chapterOptions}
                </select>
                <button id="go-btn" class="modal-btn" style="width:auto; padding:0 20px;">Go</button>
            </div>
        </div>
        <div class="menu-section">
            <div class="menu-label">Session Control</div>
            ${getDropdownHTML()}
        </div>
    `;
    
    document.getElementById('go-btn').onclick = () => {
        const val = parseInt(document.getElementById('chapter-nav-select').value);
        if(val !== currentChapterNum) {
            handleChapterSwitch(val);
        } else {
            if(confirm(`Restart Chapter ${val} from the beginning?`)) {
                switchChapterHot(val);
            }
        }
    };

    const btn = document.getElementById('action-btn');
    btn.innerText = "Close";
    btn.onclick = () => { closeModal(); if(!isGameActive && savedCharIndex > 0) startGame(); };
    btn.disabled = false;
    
    modal.classList.remove('hidden');
}

function handleChapterSwitch(newChapter) {
    if (newChapter > currentChapterNum) {
        switchChapterHot(newChapter);
    } else {
        if(confirm(`Go back to Chapter ${newChapter}? Unsaved progress in current chapter will be lost.`)) {
            switchChapterHot(newChapter);
        }
    }
}

async function switchChapterHot(newChapter) {
    await setDoc(doc(db, "users", currentUser.uid, "progress", BOOK_ID), {
        chapter: newChapter,
        charIndex: 0
    }, { merge: true });
    
    currentChapterNum = newChapter;
    savedCharIndex = 0;
    currentCharIndex = 0;
    lastSavedIndex = 0;
    
    closeModal();
    textStream.innerHTML = "Switching chapters...";
    loadChapter(newChapter);
}

// --- KEYBOARD UI ---
const rows = [
    ['q','w','e','r','t','y','u','i','o','p','[',']','\\'],
    ['a','s','d','f','g','h','j','k','l',';',"'"],
    ['z','x','c','v','b','n','m',',','.','/']
];
const shiftRows = [
    ['Q','W','E','R','T','Y','U','I','O','P','{','}','|'],
    ['A','S','D','F','G','H','J','K','L',':','"'],
    ['Z','X','C','V','B','N','M','<','>','?']
];

function createKeyboard() {
    keyboardDiv.innerHTML = '';
    
    rows.forEach((rowChars, rIndex) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'kb-row'; 
        
        let leftSpecial = null;
        if (rIndex === 1) leftSpecial = "CAPS";
        if (rIndex === 2) leftSpecial = "SHIFT";
        if (leftSpecial) addSpecialKey(rowDiv, leftSpecial);
        
        rowChars.forEach((char, cIndex) => {
            const key = document.createElement('div');
            key.className = 'key';
            key.innerText = char;
            key.dataset.char = char;
            key.dataset.shift = shiftRows[rIndex][cIndex];
            key.id = `key-${char}`;
            rowDiv.appendChild(key);
        });
        
        let rightSpecial = null;
        if (rIndex === 0) rightSpecial = "BACK";
        if (rIndex === 1) rightSpecial = "ENTER";
        if (rIndex === 2) rightSpecial = "SHIFT";
        if (rightSpecial) addSpecialKey(rowDiv, rightSpecial);
        
        keyboardDiv.appendChild(rowDiv);
    });
    
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kb-row'; 
    const space = document.createElement('div');
    space.className = 'key space'; 
    space.innerText = ""; 
    space.id = "key- ";
    spaceRow.appendChild(space);
    keyboardDiv.appendChild(spaceRow);
}

function addSpecialKey(parent, text) {
    const key = document.createElement('div');
    key.className = 'key wide';
    key.innerText = text;
    key.id = `key-${text}`;
    parent.appendChild(key);
}

function toggleKeyboardCase(isShift) {
    document.querySelectorAll('.key').forEach(k => {
        if (k.dataset.char) {
            k.innerText = isShift ? k.dataset.shift : k.dataset.char;
        }
        if (k.id === 'key-SHIFT') {
            isShift ? k.classList.add('shift-active') : k.classList.remove('shift-active');
        }
    });
}

function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));
    
    let targetId = '';
    let needsShift = false;
    
    if (char === ' ') targetId = 'key- ';
    else if (char === '\t') targetId = 'key-TAB'; 
    else if (char === '\n') targetId = 'key-ENTER'; 
    else {
        const keys = Array.from(document.querySelectorAll('.key'));
        const found = keys.find(k => k.dataset.char === char || k.dataset.shift === char);
        if (found) {
            targetId = found.id;
            if (found.dataset.shift === char) needsShift = true;
        }
    }
    
    const el = document.getElementById(targetId);
    if (el) el.classList.add('target');
    
    toggleKeyboardCase(needsShift);
}

function flashKey(char) {
    let targetId = '';
    if (char === ' ') targetId = 'key- ';
    else if (char === '\t' || char === 'Tab') targetId = 'key-TAB';
    else if (char === '\n' || char === 'Enter') targetId = 'key-ENTER'; 
    else {
        const keys = Array.from(document.querySelectorAll('.key'));
        const found = keys.find(k => k.dataset.char === char || k.dataset.shift === char);
        if (found) targetId = found.id;
    }
    const el = document.getElementById(targetId);
    if (el) {
        el.style.backgroundColor = 'var(--brute-force-color)';
        setTimeout(() => el.style.backgroundColor = '', 200);
    }
}

window.onload = init;
