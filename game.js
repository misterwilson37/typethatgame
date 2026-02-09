// v1.9.3.9 - Landing Screen & Book Selection First
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    signInAnonymously, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.9.3.9";
const DEFAULT_BOOK = "wizard_of_oz";
const IDLE_THRESHOLD = 2000; 
const AFK_THRESHOLD = 5000; 
const SPRINT_COOLDOWN_MS = 1500; 
const SPAM_THRESHOLD = 5; 

// STATE
let currentBookId = localStorage.getItem('currentBookId') || DEFAULT_BOOK;
let currentUser = null;
let bookData = null;
let bookMetadata = null; 
let availableBooks = []; // Cache for landing
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
    
    // 1. Fetch Books immediately for the Landing Screen
    await fetchAvailableBooks();

    // 2. Show Landing Screen (Modal)
    showLandingModal();

    // 3. Listen for Auth Changes (Updates UI, doesn't auto-start game anymore)
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        updateAuthUI(!!user);
        
        // If modal is open, update it to reflect login state
        if (isModalOpen && document.getElementById('landing-ui')) {
            updateLandingUI();
        }
    });
}

async function fetchAvailableBooks() {
    try {
        availableBooks = [];
        const querySnapshot = await getDocs(collection(db, "books"));
        querySnapshot.forEach((doc) => {
            const b = doc.data();
            availableBooks.push({
                id: doc.id,
                title: b.title || doc.id
            });
        });
        // Sort?
        availableBooks.sort((a,b) => a.title.localeCompare(b.title));
    } catch(e) { console.warn("Book fetch error:", e); }
}

// --- LANDING SCREEN LOGIC ---
function showLandingModal() {
    isModalOpen = true; 
    isInputBlocked = true; // Block typing while choosing
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').style.display = 'block';
    document.getElementById('modal-title').innerText = "Welcome";
    
    // Build HTML
    let bookOptions = availableBooks.map(b => 
        `<option value="${b.id}" ${b.id === currentBookId ? 'selected' : ''}>${b.title}</option>`
    ).join('');

    const html = `
        <div id="landing-ui" style="text-align: center;">
            <label style="color:#888; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; display:block;">Select a Book</label>
            <select id="landing-book-select" class="modal-select" style="margin-bottom: 25px; font-size: 1.1rem;">
                ${bookOptions}
            </select>
            
            <div id="landing-auth-container">
                </div>
        </div>
    `;
    
    document.getElementById('modal-body').innerHTML = html;
    
    // Bind Change Event
    document.getElementById('landing-book-select').onchange = (e) => {
        currentBookId = e.target.value;
        localStorage.setItem('currentBookId', currentBookId);
    };

    // Initial UI State
    updateLandingUI();
    
    // Hide default Action Btn (we use custom buttons)
    const btn = document.getElementById('action-btn');
    btn.style.display = 'none';
    modal.classList.remove('hidden');
}

function updateLandingUI() {
    const container = document.getElementById('landing-auth-container');
    if (!container) return;

    if (currentUser) {
        // Logged In View
        container.innerHTML = `
            <div style="margin-bottom: 15px; color: #4B9CD3;">Signed in as ${currentUser.email || "User"}</div>
            <button id="landing-start-btn" class="landing-btn primary">Start Reading</button>
            <div style="margin-top:15px; font-size:0.8em;">
                <a href="#" id="landing-switch-account" style="color:#666;">Switch Account</a>
            </div>
        `;
        document.getElementById('landing-start-btn').onclick = startSession;
        document.getElementById('landing-switch-account').onclick = async () => {
            await signOut(auth);
            // UI updates automatically via onAuthStateChanged
        };
    } else {
        // Guest View
        container.innerHTML = `
            <button id="landing-login-btn" class="landing-btn primary" style="margin-bottom: 10px;">Log In (Google)</button>
            <div style="margin-bottom: 10px; color: #666;">- OR -</div>
            <button id="landing-guest-btn" class="landing-btn secondary">Continue as Guest</button>
        `;
        
        document.getElementById('landing-login-btn').onclick = async () => {
            try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
            catch (e) { alert(e.message); }
        };
        
        document.getElementById('landing-guest-btn').onclick = async () => {
            try { 
                await signInAnonymously(auth);
                // Auth listener will trigger updateLandingUI, user clicks Start
            } catch(e) { alert(e.message); }
        };
    }
}

async function startSession() {
    closeModal();
    // Load Sequence
    try {
        await loadBookMetadata(); 
        await loadUserProgress(); 
        await loadUserStats();    
    } catch(e) { console.error("Init Error:", e); }
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

    let hintHtml = "";
    if (friendlyKey.length === 1 && friendlyKey.match(/[A-Z]/)) {
        hintHtml = `<div class="modal-hint-text">(Requires Shift)</div>`;
    }

    const modal = document.getElementById('modal');
    document.getElementById('modal-title').style.display = 'block';
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
    if (!currentUser) return;
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

function calculateAverageWPM(chars
