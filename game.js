// v1.0.2 - Full Keyboard & Versioning
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VERSION = "1.0.2";

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

// --- INIT ---
async function init() {
    // 1. Set Version in Footer
    const footer = document.querySelector('footer');
    if(footer) footer.innerText = `JS: v${VERSION}`;

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

// --- DATA ---
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
    // Fancy quote normalization
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
        const spaceSpan = document.createElement('span');
        spaceSpan.className = 'letter';
        spaceSpan.innerHTML = '&nbsp;';
        wordSpan.appendChild(spaceSpan);
        charCount++;

        textStream.appendChild(wordSpan);
    });
}

// --- GAME LOOP ---
function startGame() {
    isGameActive = true;
    startTime = Date.now();
    lastActivityTime = Date.now();
    
    focusOnCurrentChar();

    // CENTERING FIX:
    // We force a center view immediately, then again after a short delay
    // to ensure the browser has finished 'painting' the new text.
    centerView();
    setTimeout(centerView, 100); 

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(gameTick, 1000);
}

function gameTick() {
    if (!isGameActive) return;

    if (Date.now() - lastActivityTime <= 3000) {
        activeSeconds++;
        const mins = Math.floor(activeSeconds / 60).toString().padStart(2, '0');
        const secs = (activeSeconds % 60).toString().padStart(2, '0');
        document.getElementById('timer-display').innerText = `${mins}:${secs}`;
        
        if (activeSeconds % 10 === 0) saveProgress();
    }

    const timeMins = (Date.now() - startTime) / 60000;
    const wpm = Math.round((currentCharIndex / 5) / timeMins) || 0;
    document.getElementById('wpm-display').innerText = wpm;
}

document.addEventListener('keydown', (e) => {
    if (!isGameActive) return;
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    if (e.key === " ") e.preventDefault(); // Stop scrolling

    const targetChar = fullText[currentCharIndex];
    const letterEls = document.querySelectorAll('.letter');
    const currentEl = letterEls[currentCharIndex];

    lastActivityTime = Date.now();

    if (e.key === targetChar) {
        // Correct
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
        focusOnCurrentChar(); // Updates keyboard highlight
        centerView();
    } else {
        // Mistake
        mistakes++;
        currentEl.classList.add('incorrect');
        flashKey(e.key);
        updateAccuracy();
    }
});

function centerView() {
    const currentEl = document.querySelectorAll('.letter')[currentCharIndex];
    if (!currentEl) return;
    
    // Calculate the center of the game container
    const container = document.getElementById('game-container');
    const containerCenter = container.offsetHeight / 2;
    
    // Move text so the current letter is at the center line
    // We add an offset (-20px) to make it look visually balanced
    const offset = containerCenter - currentEl.offsetTop - 20;
    textStream.style.transform = `translateY(${offset}px)`;
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
    await setDoc(doc(db, "users", currentUser.uid), {
        activeSeconds: activeSeconds,
        lastUpdated: new Date()
    }, { merge: true });
}

function finishChapter() {
    isGameActive = false;
    clearInterval(timerInterval);
    saveProgress();
    alert(`Section Complete!\nYou typed actively for ${activeSeconds} seconds.`);
    location.reload();
}

// --- NEW KEYBOARD ENGINE ---
const keyMap = {
    row1: "`1234567890-=",
    row1_s: "~!@#$%^&*()_+",
    row2: "qwertyuiop[]\\",
    row2_s: "QWERTYUIOP{}|",
    row3: "asdfghjkl;'",
    row3_s: "ASDFGHJKL:\"",
    row4: "zxcvbnm,./",
    row4_s: "ZXCVBNM<>?"
};

function createKeyboard() {
    keyboardDiv.innerHTML = ''; // Clear existing
    
    // Row 1 (Numbers)
    createRow(keyMap.row1, keyMap.row1_s);
    // Row 2
    createRow(keyMap.row2, keyMap.row2_s, "TAB");
    // Row 3
    createRow(keyMap.row3, keyMap.row3_s, "CAPS", "ENTER");
    // Row 4
    createRow(keyMap.row4, keyMap.row4_s, "SHIFT", "SHIFT");
    // Space Row
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kb-row';
    const space = document.createElement('div');
    space.className = 'key space';
    space.id = 'key- ';
    space.innerText = "SPACE";
    spaceRow.appendChild(space);
    keyboardDiv.appendChild(spaceRow);
}

function createRow(chars, shiftChars, leftSpecial, rightSpecial) {
    const row = document.createElement('div');
    row.className = 'kb-row';
    
    if (leftSpecial) addSpecialKey(row, leftSpecial);
    
    for (let i = 0; i < chars.length; i++) {
        const k = document.createElement('div');
        k.className = 'key';
        k.dataset.char = chars[i]; // Lowercase/Normal
        k.dataset.shift = shiftChars[i]; // Shift variant
        k.id = `key-${chars[i]}`; // ID based on normal char
        k.innerText = chars[i].toUpperCase();
        row.appendChild(k);
    }
    
    if (rightSpecial) addSpecialKey(row, rightSpecial);
    keyboardDiv.appendChild(row);
}

function addSpecialKey(row, text) {
    const k = document.createElement('div');
    k.className = 'key wide';
    k.innerText = text;
    k.id = `key-${text}`;
    row.appendChild(k);
}

function focusOnCurrentChar() {
    const char = fullText[currentCharIndex] || ' ';
    highlightKey(char);
}

function highlightKey(char) {
    // Clear all highlighting
    document.querySelectorAll('.key').forEach(k => {
        k.classList.remove('target');
        k.classList.remove('shift-active');
    });

    let targetId = '';
    let needsShift = false;

    if (char === ' ') {
        targetId = 'key- ';
    } else {
        // Find the key in our dataset
        const keyEl = Array.from(document.querySelectorAll('.key')).find(k => 
            k.dataset.char === char || k.dataset.shift === char
        );
        
        if (keyEl) {
            targetId = keyEl.id;
            // Does it need shift?
            if (keyEl.dataset.shift === char) {
                needsShift = true;
            }
        }
    }

    // Apply Highlight
    const el = document.getElementById(targetId);
    if (el) el.classList.add('target');
    
    if (needsShift) {
        // Highlight both Shifts
        const shifts = document.querySelectorAll('#key-SHIFT');
        shifts.forEach(s => s.classList.add('target'));
    }
}

function flashKey(char) {
    // Simple flash - assumes user hit the key corresponding to the char
    // (Complex mapping omitted for brevity, just flashing standard keys)
    let id = `key-${char.toLowerCase()}`;
    const el = document.getElementById(id);
    if (el) {
        el.style.backgroundColor = 'var(--error-color)';
        setTimeout(() => el.style.backgroundColor = '', 200);
    }
}

init();
