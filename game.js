// v1.0.1 - Game Engine
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// STATE
let currentUser = null;
let bookData = null;
let fullText = "";
let currentCharIndex = 0;
let mistakes = 0;
let startTime = null;
let activeSeconds = 0;
let lastActivityTime = 0;
let timerInterval = null;
let isGameActive = false;

// DOM
const textStream = document.getElementById('text-stream');
const keyboardDiv = document.getElementById('virtual-keyboard');
const storyImg = document.getElementById('story-img');
const imgPanel = document.getElementById('image-panel');

async function init() {
    createKeyboard();
    signInAnonymously(auth).catch(console.error);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('user-info').innerText = "ID: " + user.uid.slice(0,5);
            loadChapter(1);
        }
    });
}

async function loadChapter(chapterNum) {
    const docRef = doc(db, "books", "wizard_of_oz", "chapters", "chapter_" + chapterNum);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        bookData = docSnap.data();
        setupGame();
    } else {
        textStream.innerHTML = "Error: Chapter not found. <a href='admin.html'>Run Admin Seed</a>";
    }
}

function setupGame() {
    fullText = bookData.segments.map(s => s.text).join(" ");
    // Simplify quotes for ease of typing
    fullText = fullText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    
    renderText();
    startGame();
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
            span.dataset.index = charCount;
            wordSpan.appendChild(span);
            charCount++;
        }
        // Space
        const spaceSpan = document.createElement('span');
        spaceSpan.className = 'letter';
        spaceSpan.innerHTML = '&nbsp;';
        wordSpan.appendChild(spaceSpan);
        charCount++;

        textStream.appendChild(wordSpan);
    });
}

function startGame() {
    isGameActive = true;
    startTime = Date.now();
    lastActivityTime = Date.now();
    
    focusOnCurrentChar();
    
    // --- New in 1.0.1 ---
    // Force the view to center on the cursor immediately
    setTimeout(centerView, 50); 
    // We use a tiny timeout to let the browser 'paint' the text first 
    // so we can calculate the position correctly.
    // ---------------------

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 1000);
}

function gameTick() {
    if (!isGameActive) return;

    // 3 Second Heartbeat Rule
    if (Date.now() - lastActivityTime <= 3000) {
        activeSeconds++;
        const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
        const secs = (activeSeconds % 60).toString().padStart(2, '0');
        document.getElementById('timer-display').innerText = `${mins}:${secs}`;
        
        if (activeSeconds % 10 === 0) saveProgress();
    }

    // WPM
    const timeMins = (Date.now() - startTime) / 60000;
    const wpm = Math.round((currentCharIndex / 5) / timeMins) || 0;
    document.getElementById('wpm-display').innerText = wpm;
}

// TYPING LISTENER
document.addEventListener('keydown', (e) => {
    if (!isGameActive) return;
    if (e.key.length > 1 && e.key !== "Backspace") return;
    if (e.key === " ") e.preventDefault();

    const targetChar = fullText[currentCharIndex];
    const letterEls = document.querySelectorAll('.letter');
    const currentEl = letterEls[currentCharIndex];

    lastActivityTime = Date.now();

    if (e.key === targetChar) {
        // CORRECT
        currentEl.classList.add('correct');
        currentEl.classList.remove('active');
        currentCharIndex++;
        
        if (currentCharIndex >= fullText.length) {
            finishChapter();
            return;
        }

        letterEls[currentCharIndex].classList.add('active');
        updateAccuracy();
        checkForImageUpdate();
        highlightKey(fullText[currentCharIndex]);
        centerView();

    } else {
        // MISTAKE
        mistakes++;
        currentEl.classList.add('incorrect');
        flashKey(e.key.toUpperCase(), 'red');
        updateAccuracy();
    }
});

function centerView() {
    const currentEl = document.querySelectorAll('.letter')[currentCharIndex];
    if (!currentEl) return;
    const containerCenter = document.getElementById('game-container').offsetHeight / 2;
    textStream.style.transform = `translateY(${containerCenter - currentEl.offsetTop - 20}px)`;
}

function checkForImageUpdate() {
    const progress = currentCharIndex / fullText.length;
    const segmentIndex = Math.floor(progress * bookData.segments.length);
    const segment = bookData.segments[segmentIndex];
    
    if (segment && segment.image) {
        storyImg.src = segment.image;
        imgPanel.style.display = 'block';
    } else {
        imgPanel.style.display = 'none';
    }
}

function updateAccuracy() {
    const total = currentCharIndex + mistakes;
    const acc = total === 0 ? 100 : Math.round((currentCharIndex / total) * 100);
    document.getElementById('acc-display').innerText = acc + "%";
}

async function saveProgress() {
    if (!currentUser) return;
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, {
        activeSeconds: activeSeconds,
        lastUpdated: new Date()
    }, { merge: true });
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    saveProgress();
    alert("Chapter Complete! Great work.");
    location.reload();
}

// KEYBOARD UI
function createKeyboard() {
    const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    rows.forEach(rowStr => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'kb-row';
        for (let char of rowStr) {
            const k = document.createElement('div');
            k.className = 'key';
            k.id = 'key-' + char;
            k.innerText = char;
            rowDiv.appendChild(k);
        }
        keyboardDiv.appendChild(rowDiv);
    });
    // Space
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kb-row';
    const space = document.createElement('div');
    space.className = 'key space';
    space.id = 'key-SPACE';
    space.innerText = "SPACE";
    spaceRow.appendChild(space);
    keyboardDiv.appendChild(spaceRow);
}

function highlightKey(char) {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target'));
    let keyId = 'key-' + char.toUpperCase();
    if (char === ' ') keyId = 'key-SPACE';
    const el = document.getElementById(keyId);
    if (el) el.classList.add('target');
}

function flashKey(char, color) {
    let keyId = 'key-' + char.toUpperCase();
    if (char === ' ') keyId = 'key-SPACE';
    const el = document.getElementById(keyId);
    if (el) {
        const old = el.style.backgroundColor;
        el.style.backgroundColor = color;
        setTimeout(() => el.style.backgroundColor = old, 200);
    }
}

function focusOnCurrentChar() {
    const firstChar = fullText[currentCharIndex] || ' ';
    highlightKey(firstChar);
}

init();
