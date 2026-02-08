// v1.9.7.1 - Decimal/Zero Chapter Support
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.9.7.1";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const footerEl = document.getElementById('admin-footer');

// Elements
const bookSelect = document.getElementById('book-select');
const newBookInput = document.getElementById('new-book-input');
const bookTitleInput = document.getElementById('book-title'); 
const saveTitleBtn = document.getElementById('save-title-btn');
const loadDbBtn = document.getElementById('load-db-btn');
const epubInput = document.getElementById('epub-file');
const processingUI = document.getElementById('processing-ui');
const chapterListEl = document.getElementById('chapter-list');
const uploadAllBtn = document.getElementById('upload-all-btn');
const cleanNewlinesCb = document.getElementById('clean-newlines');

// Editor
const manualTitle = document.getElementById('manual-chap-title');
const manualNum = document.getElementById('manual-chap-num');
const jsonContent = document.getElementById('json-content');
const updateStagedBtn = document.getElementById('update-staged-btn');
const saveDirectBtn = document.getElementById('save-btn'); 
const manualDetails = document.getElementById('manual-details');

let stagedChapters = [];
let editingIndex = -1;
let bookTitlesMap = {}; 

// Init Display
if(footerEl) footerEl.innerText = `Admin JS: v${ADMIN_VERSION}`;

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        statusEl.innerText = "Logged in as: " + user.email;
        statusEl.style.borderColor = "#00ff41"; 
        loginSec.classList.add('hidden');
        editorSec.classList.remove('hidden');
        await loadBookList();
    } else {
        statusEl.innerText = "Access Restricted.";
        statusEl.style.borderColor = "#ff3333"; 
        loginSec.classList.remove('hidden');
        editorSec.classList.add('hidden');
    }
});

loginBtn.onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (e) { alert(e.message); }
};

// --- BOOK LIST ---
async function loadBookList() {
    bookSelect.innerHTML = "<option>Loading...</option>";
    bookTitlesMap = {};
    try {
        const querySnapshot = await getDocs(collection(db, "books"));
        bookSelect.innerHTML = "";
        
        querySnapshot.forEach((doc) => {
            const b = doc.data();
            const option = document.createElement("option");
            option.value = doc.id;
            bookTitlesMap[doc.id] = b.title || doc.id;
            option.text = bookTitlesMap[doc.id] + ` (${doc.id})`;
            bookSelect.appendChild(option);
        });

        const createOpt = document.createElement("option");
        createOpt.value = "__NEW__";
        createOpt.text = "➕ Create New Book...";
        createOpt.style.color = "#4B9CD3";
        createOpt.style.fontWeight = "bold";
        bookSelect.appendChild(createOpt);
        
        bookSelect.dispatchEvent(new Event('change'));

    } catch (e) {
        console.error(e);
        bookSelect.innerHTML = "<option>Error loading list</option>";
    }
}

bookSelect.onchange = () => {
    const val = bookSelect.value;
    if (val === "__NEW__") {
        newBookInput.classList.remove('hidden');
        bookTitleInput.value = ""; 
        newBookInput.focus();
    } else {
        newBookInput.classList.add('hidden');
        bookTitleInput.value = bookTitlesMap[val] || val;
    }
};

function getActiveBookId() {
    if (bookSelect.value === "__NEW__") {
        return newBookInput.value.trim();
    }
    return bookSelect.value;
}

// --- SAVE TITLE ONLY ---
saveTitleBtn.onclick = async () => {
    const bookId = getActiveBookId();
    if (!bookId) return alert("Select a book first.");
    const newTitle = bookTitleInput.value.trim();
    if (!newTitle) return alert("Enter a title.");

    try {
        statusEl.innerText = "Saving Title...";
        await setDoc(doc(db, "books", bookId), {
            title: newTitle
        }, { merge: true });
        
        bookTitlesMap[bookId] = newTitle;
        await loadBookList();
        bookSelect.value = bookId;
        
        statusEl.innerText = `Title updated to: ${newTitle}`;
        statusEl.style.borderColor = "#00ff41";
    } catch(e) {
        statusEl.innerText = "Save Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
};

// --- DIRECT SAVE (Single) ---
saveDirectBtn.onclick = async () => {
    const bookId = getActiveBookId();
    const chapNum = manualNum.value.trim();
    const jsonStr = jsonContent.value.trim();
    // Allow 0 as valid chapNum
    if (!bookId || chapNum === "" || !jsonStr) return alert("Fill all fields");

    try {
        const data = JSON.parse(jsonStr);
        statusEl.innerText = `Saving Chapter ${chapNum} to ${bookId}...`;
        await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), data);
        statusEl.innerText = `Success! Chapter ${chapNum} saved directly.`;
        statusEl.style.borderColor = "#00ff41";
    } catch (e) {
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
};

// --- LOAD FROM DB ---
loadDbBtn.onclick = async () => {
    const bookId = getActiveBookId();
    if(!bookId) return alert("Select or enter a Book ID");
    
    statusEl.innerText = `Loading ${bookId} from database...`;
    chapterListEl.innerHTML = "Loading...";
    processingUI.classList.remove('hidden');
    stagedChapters = [];

    try {
        const metaSnap = await getDoc(doc(db, "books", bookId));
        if(!metaSnap.exists()) throw new Error("Book not found.");
        
        const meta = metaSnap.data();
        const chapters = meta.chapters || [];
        
        if(meta.title) bookTitleInput.value = meta.title;
        
        statusEl.innerText = `Found ${chapters.length} chapters. Fetching content...`;

        for (let i = 0; i < chapters.length; i++) {
            const chapId = chapters[i].id; 
            const chapTitle = chapters[i].title;
            const contentSnap = await getDoc(doc(db, "books", bookId, "chapters", chapId));
            if(contentSnap.exists()) {
                stagedChapters.push({
                    title: chapTitle,
                    segments: contentSnap.data().segments || []
                });
            }
        }
        renderChapterList();
        statusEl.innerText = `Loaded ${stagedChapters.length} chapters from DB.`;
        statusEl.style.borderColor = "#00ff41";
    } catch (e) {
        console.error(e);
        statusEl.innerText = "Load Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
};

// --- EPUB PARSING ---
epubInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusEl.innerText = "Parsing EPUB...";
    processingUI.classList.remove('hidden');
    chapterListEl.innerHTML = "Parsing...";
    stagedChapters = [];

    try {
        const zip = await JSZip.loadAsync(file);
        
        let opfPath = null;
        const files = Object.keys(zip.files);
        const containerInfo = await zip.file("META-INF/container.xml")?.async("string");
        if (containerInfo) {
            const doc = new DOMParser().parseFromString(containerInfo, "text/xml");
            opfPath = doc.querySelector("rootfile").getAttribute("full-path");
        } else {
            opfPath = files.find(f => f.endsWith(".opf"));
        }
        if (!opfPath) throw new Error("No OPF file found.");

        const opfContent = await zip.file(opfPath).async("string");
        const opfDoc = new DOMParser().parseFromString(opfContent, "text/xml");
        const manifest = opfDoc.getElementsByTagName("manifest")[0];
        const spine = opfDoc.getElementsByTagName("spine")[0];
        const basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);

        const idToHref = {};
        Array.from(manifest.getElementsByTagName("item")).forEach(item => {
            idToHref[item.getAttribute("id")] = item.getAttribute("href");
        });

        const spineItems = Array.from(spine.getElementsByTagName("itemref"));
        let counter = 1;

        for (let item of spineItems) {
            const href = idToHref[item.getAttribute("idref")];
            if (!href) continue;

            const fullPath = resolvePath(basePath, href);
            const content = await zip.file(fullPath).async("string");
            const doc = new DOMParser().parseFromString(content, "application/xhtml+xml");
            
            let title = `Chapter ${counter}`;
            const hTag = doc.body.querySelector('h1, h2, h3');
            if(hTag) title = hTag.innerText.trim().substring(0, 60);

            const segments = [];
            doc.body.querySelectorAll("p").forEach(el => {
                let text = el.textContent;
                if (cleanNewlinesCb.checked) text = text.replace(/[\r\n]+/g, ' '); 
                text = text.replace(/\s\s+/g, ' ').trim();
                
                if (text.length > 0) {
                    if (!text.startsWith('\t')) text = '\t' + text;
                    segments.push({ text: text });
                }
            });

            if (segments.length > 0) {
                stagedChapters.push({ title: title, segments: segments });
                counter++;
            }
        }

        renderChapterList();
        statusEl.innerText = `Parsed ${stagedChapters.length} chapters.`;
        statusEl.style.borderColor = "#00ff41";

    } catch (e) {
        console.error(e);
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
});

// --- UI & EDITING ---
function renderChapterList() {
    chapterListEl.innerHTML = "";
    if(stagedChapters.length === 0) {
        chapterListEl.innerHTML = "<div style='padding:10px; color:#666;'>Empty.</div>";
        return;
    }

    stagedChapters.forEach((chap, index) => {
        const div = document.createElement('div');
        div.className = 'chapter-item';
        div.id = `ui-chap-${index}`;
        div.innerHTML = `
            <div class="chap-info">
                <div class="chap-title">#${index + 1}: ${chap.title}</div>
                <div class="chap-meta">${chap.segments.length} segments <span class="chap-status"></span></div>
            </div>
            <div class="chap-actions">
                <button class="edit-btn" data-index="${index}">Edit</button>
                <button class="danger-btn delete-btn" data-index="${index}">Del</button>
            </div>
        `;
        chapterListEl.appendChild(div);
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.dataset.index);
            stagedChapters.splice(idx, 1);
            renderChapterList();
        };
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.dataset.index);
            editChapter(idx);
        };
    });
}

function editChapter(index) {
    editingIndex = index;
    const chap = stagedChapters[index];
    manualTitle.value = chap.title;
    manualNum.value = index + 1;
    jsonContent.value = JSON.stringify({ segments: chap.segments }, null, 2);
    updateStagedBtn.classList.remove('hidden');
    saveDirectBtn.classList.add('hidden');
    manualDetails.open = true;
    manualDetails.scrollIntoView({ behavior: 'smooth' });
}

updateStagedBtn.onclick = () => {
    if (editingIndex < 0 || editingIndex >= stagedChapters.length) return;
    try {
        const data = JSON.parse(jsonContent.value);
        stagedChapters[editingIndex].title = manualTitle.value;
        stagedChapters[editingIndex].segments = data.segments;
        
        editingIndex = -1;
        updateStagedBtn.classList.add('hidden');
        saveDirectBtn.classList.remove('hidden');
        manualDetails.open = false;
        
        renderChapterList();
        statusEl.innerText = "Updated staged chapter.";
    } catch (e) { alert("Invalid JSON"); }
};

// --- UPLOAD ALL ---
uploadAllBtn.onclick = async () => {
    if (stagedChapters.length === 0) return alert("Nothing to upload.");
    const bookId = getActiveBookId();
    if (!bookId) return alert("Select or enter a Book ID.");
    
    let displayTitle = bookTitleInput.value.trim();
    if (!displayTitle) {
        displayTitle = bookId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!confirm(`Overwrite book "${bookId}" (Title: ${displayTitle}) with ${stagedChapters.length} chapters? This cannot be undone.`)) return;

    statusEl.innerText = "Uploading...";
    const chapterMeta = [];

    for (let i = 0; i < stagedChapters.length; i++) {
        const chapNum = i + 1; // You might want to allow custom numbering here too? 
        // For batch upload, sequential is standard, but manual editing via UI allows numbering.
        
        const chapData = stagedChapters[i];
        const uiStatus = document.querySelector(`#ui-chap-${i} .chap-status`);
        
        try {
            if(uiStatus) uiStatus.innerText = "...";
            
            await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), {
                segments: chapData.segments
            });
            
            chapterMeta.push({
                id: "chapter_" + chapNum,
                title: chapData.title
            });

            if(uiStatus) {
                uiStatus.innerText = "✔ OK";
                uiStatus.className = "chap-status ok";
            }
            
            const row = document.getElementById(`ui-chap-${i}`);
            if(row) row.classList.add('uploaded');

        } catch (e) {
            console.error(e);
            if(uiStatus) {
                uiStatus.innerText = "FAIL";
                uiStatus.style.color = "red";
            }
            return alert(`Upload failed at Chapter ${chapNum}`);
        }
    }

    try {
        await setDoc(doc(db, "books", bookId), {
            title: displayTitle,
            totalChapters: stagedChapters.length,
            chapters: chapterMeta
        }, { merge: true });
        
        statusEl.innerText = "Upload Complete!";
        statusEl.style.borderColor = "#00ff41";
        await loadBookList();
    } catch (e) { alert("Metadata Save Failed: " + e.message); }
};

function resolvePath(base, relative) {
    if(base === "") return relative;
    const stack = base.split("/");
    const parts = relative.split("/");
    stack.pop(); 
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === ".") continue;
        if (parts[i] === "..") stack.pop();
        else stack.push(parts[i]);
    }
    return stack.join("/");
}
