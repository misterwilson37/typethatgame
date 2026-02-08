// v1.9.7.6 - Chapter 0 Fix & Untypable Wizard
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.9.7.6";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const footerEl = document.getElementById('admin-footer');

// Top Section
const bookSelect = document.getElementById('book-select');
const openBookBtn = document.getElementById('open-book-btn');

// Staging
const stagingArea = document.getElementById('staging-area');
const newBookInput = document.getElementById('new-book-input');
const activeBookTitle = document.getElementById('active-book-title');
const saveTitleBtn = document.getElementById('save-title-btn');
const overwriteSection = document.getElementById('overwrite-section');
const overwriteEpubFile = document.getElementById('overwrite-epub-file');
const overwriteBtn = document.getElementById('overwrite-btn');
const createSection = document.getElementById('create-section');
const newEpubFile = document.getElementById('new-epub-file');
const createParseBtn = document.getElementById('create-parse-btn');
const chapterListEl = document.getElementById('chapter-list');
const uploadAllBtn = document.getElementById('upload-all-btn');
const cleanNewlinesCb = document.getElementById('clean-newlines');
const normalizeCharsCb = document.getElementById('normalize-chars');

// Manual Editor
const manualTitle = document.getElementById('manual-chap-title');
const manualNum = document.getElementById('manual-chap-num');
const jsonContent = document.getElementById('json-content');
const updateStagedBtn = document.getElementById('update-staged-btn');
const saveDirectBtn = document.getElementById('save-btn');
const manualDetails = document.getElementById('manual-details');

// Modals
const warningModal = document.getElementById('warning-modal');
const confirmOverwriteBtn = document.getElementById('confirm-overwrite-btn');
const cancelOverwriteBtn = document.getElementById('cancel-overwrite-btn');

// Wizard Modals
const wizardModal = document.getElementById('error-wizard-modal');
const wizardStep = document.getElementById('wizard-step');
const wizardPreview = document.getElementById('wizard-preview');
const wizardInput = document.getElementById('wizard-edit-input');
const wizardIgnoreBtn = document.getElementById('wizard-ignore-btn');
const wizardSaveBtn = document.getElementById('wizard-save-btn');
const wizardCancelBtn = document.getElementById('wizard-cancel-btn');

// State
let stagedChapters = [];
let editingIndex = -1;
let bookTitlesMap = {};
let activeBookId = ""; 
let importErrors = [];
let currentErrorIdx = 0;

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
        
        const createOpt = document.createElement("option");
        createOpt.value = "__NEW__";
        createOpt.text = "➕ Create New Book...";
        createOpt.style.color = "#4B9CD3";
        createOpt.style.fontWeight = "bold";
        bookSelect.appendChild(createOpt);

        querySnapshot.forEach((doc) => {
            const b = doc.data();
            const option = document.createElement("option");
            option.value = doc.id;
            bookTitlesMap[doc.id] = b.title || doc.id;
            option.text = bookTitlesMap[doc.id] + ` (${doc.id})`;
            bookSelect.appendChild(option);
        });
        
        if(querySnapshot.size > 0) bookSelect.selectedIndex = 1;
        bookSelect.dispatchEvent(new Event('change'));

    } catch (e) {
        bookSelect.innerHTML = "<option>Error</option>";
    }
}

bookSelect.onchange = () => {
    stagingArea.classList.add('hidden'); 
    if (bookSelect.value === "__NEW__") {
        newBookInput.classList.remove('hidden');
        activeBookId = "";
        activeBookTitle.value = "";
        // Show Create Flow
        createSection.classList.remove('hidden');
        overwriteSection.classList.add('hidden');
        // Show empty staging right away so user can see what happens
        stagingArea.classList.remove('hidden');
    } else {
        newBookInput.classList.add('hidden');
        activeBookId = bookSelect.value;
        activeBookTitle.value = bookTitlesMap[activeBookId] || activeBookId;
        // Show Open Flow
        document.getElementById('edit-existing-ui').classList.remove('hidden');
        createSection.classList.add('hidden');
    }
};

// --- LOAD FROM DB ---
document.getElementById('load-db-btn').onclick = async () => {
    if(!activeBookId && newBookInput.value.trim()) activeBookId = newBookInput.value.trim();
    if(!activeBookId) return alert("Select or enter a book ID");

    statusEl.innerText = `Loading ${activeBookId}...`;
    chapterListEl.innerHTML = "Loading...";
    stagedChapters = [];
    
    try {
        const metaSnap = await getDoc(doc(db, "books", activeBookId));
        if(metaSnap.exists()) {
            const meta = metaSnap.data();
            activeBookTitle.value = meta.title || activeBookId;
            const chapters = meta.chapters || [];
            
            for (let i = 0; i < chapters.length; i++) {
                // Ensure we read ID from metadata, or fallback to sequential
                const chapId = chapters[i].id; 
                // Number is whatever follows "chapter_"
                const chapNum = chapId.replace("chapter_", "");
                
                const contentSnap = await getDoc(doc(db, "books", activeBookId, "chapters", chapId));
                if(contentSnap.exists()) {
                    stagedChapters.push({
                        id: chapNum, // Store specific ID (0, 1.1, etc)
                        title: chapters[i].title,
                        segments: contentSnap.data().segments || []
                    });
                }
            }
        }
        
        renderChapterList();
        stagingArea.classList.remove('hidden');
        overwriteSection.classList.remove('hidden');
        statusEl.innerText = "Loaded from DB.";
        statusEl.style.borderColor = "#00ff41";

    } catch(e) { statusEl.innerText = "Error: " + e.message; }
};

// --- CREATE NEW PARSE ---
createParseBtn.onclick = async () => {
    const id = newBookInput.value.trim();
    if(!id) return alert("Enter Book ID");
    activeBookId = id;
    
    const file = newEpubFile.files[0];
    if(!file) return alert("Select EPUB");
    
    await parseEpubFile(file);
    // Note: Staging area already visible
};

// --- OVERWRITE ---
overwriteBtn.onclick = () => {
    if(!overwriteEpubFile.files[0]) return alert("Select file");
    warningModal.classList.remove('hidden');
};
cancelOverwriteBtn.onclick = () => warningModal.classList.add('hidden');
confirmOverwriteBtn.onclick = async () => {
    warningModal.classList.add('hidden');
    await parseEpubFile(overwriteEpubFile.files[0]);
};

// --- EPUB PARSER WITH ERROR QUEUE ---
async function parseEpubFile(file) {
    statusEl.innerText = "Parsing...";
    stagedChapters = [];
    importErrors = []; // Reset errors
    
    try {
        const zip = await JSZip.loadAsync(file);
        
        // Find OPF
        let opfPath = null;
        const files = Object.keys(zip.files);
        const containerInfo = await zip.file("META-INF/container.xml")?.async("string");
        if (containerInfo) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(containerInfo, "text/xml");
            opfPath = doc.querySelector("rootfile").getAttribute("full-path");
        } else {
            opfPath = files.find(f => f.endsWith(".opf"));
        }
        if (!opfPath) throw new Error("No OPF file found.");

        const opfContent = await zip.file(opfPath).async("string");
        const parser = new DOMParser();
        const opfDoc = parser.parseFromString(opfContent, "text/xml");
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

            const fullPath = (basePath === "") ? href : basePath + href;
            const content = await zip.file(fullPath).async("string");
            const doc = parser.parseFromString(content, "application/xhtml+xml");
            
            let title = `Chapter ${counter}`;
            const hTag = doc.body.querySelector('h1, h2, h3');
            if(hTag) title = hTag.innerText.trim().substring(0, 60);

            const segments = [];
            
            // Convert to Array to use forEach
            const pTags = Array.from(doc.body.querySelectorAll("p"));
            
            pTags.forEach((el, segIdx) => {
                let text = el.textContent;
                if (cleanNewlinesCb.checked) text = text.replace(/[\r\n]+/g, ' '); 
                text = text.replace(/\s\s+/g, ' ').trim();
                
                // --- AUTO FIXES ---
                text = text.replace(/—/g, '--'); 
                text = text.replace(/[\u2018\u2019]/g, "'"); 
                text = text.replace(/[\u201C\u201D]/g, '"');
                text = text.replace(/\u2026/g, "..."); 
                
                if (normalizeCharsCb.checked) {
                    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                }

                if (text.length > 0) {
                    if (!text.startsWith('\t')) text = '\t' + text;
                    
                    // Create segment object
                    const segObj = { text: text };
                    segments.push(segObj);

                    // --- DETECT UNTYPABLE ---
                    const badMatches = text.match(/[^ -~\t\n]/g);
                    if (badMatches) {
                        // Add to error queue
                        importErrors.push({
                            chapTitle: title,
                            segmentRef: segObj, // Reference to object in array
                            badChar: badMatches[0], // First bad char found
                            fullText: text
                        });
                    }
                }
            });

            if (segments.length > 0) {
                stagedChapters.push({ 
                    id: counter, // Default ID
                    title: title, 
                    segments: segments 
                });
                counter++;
            }
        }

        // --- CHECK ERRORS ---
        if (importErrors.length > 0) {
            currentErrorIdx = 0;
            showErrorWizard();
        } else {
            renderChapterList();
            statusEl.innerText = `Parsed ${stagedChapters.length} chapters.`;
            statusEl.style.borderColor = "#00ff41";
        }

    } catch (e) {
        console.error(e);
        statusEl.innerText = "Parse Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
}

// --- WIZARD LOGIC ---
function showErrorWizard() {
    if (currentErrorIdx >= importErrors.length) {
        // Done
        wizardModal.classList.add('hidden');
        renderChapterList();
        statusEl.innerText = "Errors resolved. Ready to upload.";
        statusEl.style.borderColor = "#00ff41";
        return;
    }

    const err = importErrors[currentErrorIdx];
    wizardStep.innerText = `${currentErrorIdx + 1} / ${importErrors.length}`;
    
    // Highlight bad char in preview
    const safeText = err.segmentRef.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const charSafe = err.badChar.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // Simple highlight replace (first occurrence)
    const highlighted = safeText.replace(charSafe, `<span class="bad-char-highlight">${charSafe}</span>`);
    
    wizardPreview.innerHTML = `<b>${err.chapTitle}</b><br><br>${highlighted}`;
    wizardInput.value = err.segmentRef.text;
    
    wizardModal.classList.remove('hidden');
}

wizardIgnoreBtn.onclick = () => {
    currentErrorIdx++;
    showErrorWizard();
};

wizardSaveBtn.onclick = () => {
    // Update the referenced object directly
    importErrors[currentErrorIdx].segmentRef.text = wizardInput.value;
    currentErrorIdx++;
    showErrorWizard();
};

wizardCancelBtn.onclick = () => {
    if(confirm("Stop import? All progress will be lost.")) {
        stagedChapters = [];
        wizardModal.classList.add('hidden');
        statusEl.innerText = "Import Cancelled.";
        statusEl.style.borderColor = "#ff3333";
        chapterListEl.innerHTML = "";
    }
};

// --- RENDER LIST (Uses stored ID) ---
function renderChapterList() {
    chapterListEl.innerHTML = "";
    stagedChapters.forEach((chap, index) => {
        const div = document.createElement('div');
        div.className = 'chapter-item';
        div.id = `ui-chap-${index}`;
        div.innerHTML = `
            <div class="chap-info">
                <div class="chap-title">ID: ${chap.id} | ${chap.title}</div>
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
            stagedChapters.splice(parseInt(e.target.dataset.index), 1);
            renderChapterList();
        };
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.onclick = (e) => editChapter(parseInt(e.target.dataset.index));
    });
}

function editChapter(index) {
    editingIndex = index;
    const chap = stagedChapters[index];
    manualTitle.value = chap.title;
    manualNum.value = chap.id; // Load stored ID
    jsonContent.value = JSON.stringify({ segments: chap.segments }, null, 2);
    
    updateStagedBtn.classList.remove('hidden');
    saveDirectBtn.classList.add('hidden');
    manualDetails.open = true;
    manualDetails.scrollIntoView({ behavior: 'smooth' });
}

updateStagedBtn.onclick = () => {
    if (editingIndex < 0) return;
    try {
        const data = JSON.parse(jsonContent.value);
        // Update stored ID and Title
        stagedChapters[editingIndex].title = manualTitle.value;
        stagedChapters[editingIndex].id = manualNum.value.trim(); // Save custom ID
        stagedChapters[editingIndex].segments = data.segments;
        
        editingIndex = -1;
        updateStagedBtn.classList.add('hidden');
        saveDirectBtn.classList.remove('hidden');
        manualDetails.open = false;
        renderChapterList();
    } catch (e) { alert("Invalid JSON"); }
};

// --- UPLOAD ALL (Respects custom IDs) ---
uploadAllBtn.onclick = async () => {
    if (stagedChapters.length === 0) return alert("Nothing to upload.");
    if (!activeBookId) return alert("No active book.");
    
    if (!confirm(`Overwrite ${activeBookId}?`)) return;

    statusEl.innerText = "Uploading...";
    const chapterMeta = [];

    for (let i = 0; i < stagedChapters.length; i++) {
        const chapData = stagedChapters[i];
        // USE THE ID stored in the object, not the index
        const chapId = chapData.id; 
        
        const uiStatus = document.querySelector(`#ui-chap-${i} .chap-status`);
        
        try {
            if(uiStatus) uiStatus.innerText = "...";
            await setDoc(doc(db, "books", activeBookId, "chapters", "chapter_" + chapId), {
                segments: chapData.segments
            });
            chapterMeta.push({ id: "chapter_" + chapId, title: chapData.title });
            if(uiStatus) { uiStatus.innerText = "✔ OK"; uiStatus.className = "chap-status ok"; }
            const row = document.getElementById(`ui-chap-${i}`);
            if(row) row.classList.add('uploaded');
        } catch (e) {
            console.error(e);
            if(uiStatus) { uiStatus.innerText = "FAIL"; uiStatus.style.color = "red"; }
            return alert(`Upload failed at ID ${chapId}`);
        }
    }

    try {
        await setDoc(doc(db, "books", activeBookId), {
            title: activeBookTitle.value.trim() || activeBookId,
            totalChapters: stagedChapters.length,
            chapters: chapterMeta
        }, { merge: true });
        
        statusEl.innerText = "Upload Complete!";
        statusEl.style.borderColor = "#00ff41";
        await loadBookList();
    } catch (e) { alert("Metadata Save Failed: " + e.message); }
};

// --- SAVE TITLE ONLY ---
saveTitleBtn.onclick = async () => {
    if (!activeBookId) return alert("No active book.");
    const newTitle = activeBookTitle.value.trim();
    if (!newTitle) return alert("Title required.");

    try {
        await setDoc(doc(db, "books", activeBookId), { title: newTitle }, { merge: true });
        bookTitlesMap[activeBookId] = newTitle;
        statusEl.innerText = "Title Updated.";
        statusEl.style.borderColor = "#00ff41";
    } catch(e) { alert(e.message); }
};
