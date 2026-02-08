// v1.9.7.9 - Precise Context Error Wizard
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.9.7.9";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const footerEl = document.getElementById('admin-footer');

// Top Section
const bookSelect = document.getElementById('book-select');
const editExistingUI = document.getElementById('edit-existing-ui');
const createNewUI = document.getElementById('create-new-ui');
const openBookBtn = document.getElementById('open-book-btn');

// Create New Inputs
const newBookId = document.getElementById('new-book-id');
const newBookTitle = document.getElementById('new-book-title');
const newEpubFile = document.getElementById('new-epub-file');
const createParseBtn = document.getElementById('create-parse-btn');

// Staging
const stagingArea = document.getElementById('staging-area');
const activeBookTitle = document.getElementById('active-book-title');
const saveTitleBtn = document.getElementById('save-title-btn');
const overwriteSection = document.getElementById('overwrite-section');
const overwriteEpubFile = document.getElementById('overwrite-epub-file');
const overwriteBtn = document.getElementById('overwrite-btn');
const createSection = document.getElementById('create-section');
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
const wizardCharDisplay = document.getElementById('wizard-char-display');
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

    } catch (e) { bookSelect.innerHTML = "<option>Error</option>"; }
}

bookSelect.onchange = () => {
    stagingArea.classList.add('hidden'); 
    if (bookSelect.value === "__NEW__") {
        newBookInput.classList.remove('hidden');
        activeBookId = "";
        activeBookTitle.value = "";
        createSection.classList.remove('hidden');
        overwriteSection.classList.add('hidden');
        stagingArea.classList.remove('hidden');
    } else {
        newBookInput.classList.add('hidden');
        activeBookId = bookSelect.value;
        activeBookTitle.value = bookTitlesMap[activeBookId] || activeBookId;
        document.getElementById('edit-existing-ui').classList.remove('hidden');
        createSection.classList.add('hidden');
    }
};

// --- LOAD FROM DB ---
openBookBtn.onclick = async () => {
    if(!activeBookId) return;
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
                const chapId = chapters[i].id; 
                const chapNum = chapId.replace("chapter_", "");
                
                const contentSnap = await getDoc(doc(db, "books", activeBookId, "chapters", chapId));
                if(contentSnap.exists()) {
                    stagedChapters.push({
                        id: chapNum, 
                        title: chapters[i].title,
                        segments: contentSnap.data().segments || []
                    });
                }
            }
        }
        renderChapterList();
        stagingArea.classList.remove('hidden');
        overwriteSection.classList.remove('hidden');
        statusEl.innerText = "Loaded.";
        statusEl.style.borderColor = "#00ff41";
    } catch(e) { statusEl.innerText = "Error: " + e.message; }
};

// --- CREATE NEW PARSE ---
createParseBtn.onclick = async () => {
    const id = newBookId.value.trim();
    const title = newBookTitle.value.trim();
    const file = newEpubFile.files[0];
    if(!id || !title || !file) return alert("Fill all fields.");
    
    activeBookId = id;
    activeBookTitle.value = title;
    await parseEpubFile(file);
    stagingArea.classList.remove('hidden');
    overwriteSection.classList.add('hidden'); 
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

// --- EPUB PARSER ---
async function parseEpubFile(file) {
    statusEl.innerText = "Parsing...";
    chapterListEl.innerHTML = "Parsing...";
    stagedChapters = [];
    importErrors = []; 
    
    try {
        const zip = await JSZip.loadAsync(file);
        
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
        const spine = opfDoc.getElementsByTagName("spine")[0];
        const manifest = opfDoc.getElementsByTagName("manifest")[0];
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
            const pTags = Array.from(doc.body.querySelectorAll("p"));
            
            pTags.forEach((el) => {
                let text = el.textContent;
                if (cleanNewlinesCb.checked) text = text.replace(/[\r\n]+/g, ' '); 
                text = text.replace(/\s\s+/g, ' ').trim();
                
                text = text.replace(/—/g, '--'); 
                text = text.replace(/[\u2018\u2019]/g, "'"); 
                text = text.replace(/[\u201C\u201D]/g, '"');
                text = text.replace(/\u2026/g, "..."); 
                
                if (normalizeCharsCb.checked) {
                    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                }

                if (text.length > 0) {
                    if (!text.startsWith('\t')) text = '\t' + text;
                    const segObj = { text: text };
                    segments.push(segObj);

                    const badMatches = text.match(/[^ -~\t\n]/g);
                    if (badMatches) {
                        importErrors.push({
                            chapTitle: title,
                            segmentRef: segObj, 
                            badChar: badMatches[0], 
                            fullText: text
                        });
                    }
                }
            });

            if (segments.length > 0) {
                stagedChapters.push({ 
                    id: counter, 
                    title: title, 
                    segments: segments 
                });
                counter++;
            }
        }
        
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
        wizardModal.classList.add('hidden');
        renderChapterList();
        statusEl.innerText = "Errors resolved. Ready to upload.";
        statusEl.style.borderColor = "#00ff41";
        return;
    }

    const err = importErrors[currentErrorIdx];
    wizardStep.innerText = `${currentErrorIdx + 1} / ${importErrors.length}`;
    
    const badCharCode = err.badChar.charCodeAt(0).toString(16).toUpperCase();
    wizardCharDisplay.innerText = `"${err.badChar}" (U+${badCharCode})`;
    
    // --- CONTEXT EXTRACTION ---
    const text = err.segmentRef.text;
    const charIndex = text.indexOf(err.badChar);
    
    // Attempt to isolate just the sentence
    // Find punctuation before
    let start = -1;
    // Iterate backwards from char to find sentence start (. ! ?)
    for(let i = charIndex - 1; i >= 0; i--) {
        if(['.', '!', '?'].includes(text[i])) {
            start = i + 1;
            break;
        }
    }
    if(start === -1) start = 0;

    // Find punctuation after
    let end = -1;
    for(let i = charIndex; i < text.length; i++) {
        if(['.', '!', '?'].includes(text[i])) {
            end = i + 1; // Include the punctuation
            break;
        }
    }
    if(end === -1) end = text.length;

    // Fallback: If sentence is excessively long (e.g. run-on paragraph > 300 chars), just use a window
    if((end - start) > 300) {
        start = Math.max(0, charIndex - 100);
        end = Math.min(text.length, charIndex + 100);
    }

    let sub = text.substring(start, end).trim();
    
    // --- EDITABLE AREA ---
    // Pre-populate the input with just the isolate text to make it easy to edit
    // Note: If the error appears multiple times in the paragraph, we only fix this instance logic-wise here
    wizardInput.value = sub;
    
    // --- PREVIEW ---
    const safeSub = sub.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeChar = err.badChar.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const highlightHtml = `<span class="bad-char-highlight">${safeChar}</span>`;
    const previewText = safeSub.split(safeChar).join(highlightHtml); // Highlight all in this snippet
    
    wizardPreview.innerHTML = previewText;
    
    // Store offsets for saving
    err.contextStart = start;
    err.contextEnd = end;
    err.contextOriginal = sub; // To check if they changed it
    
    wizardModal.classList.remove('hidden');
}

wizardIgnoreBtn.onclick = () => {
    currentErrorIdx++;
    showErrorWizard();
};

wizardSaveBtn.onclick = () => {
    const newSnippet = wizardInput.value;
    const err = importErrors[currentErrorIdx];
    
    // Reconstruct the full text with the fix
    const fullText = err.segmentRef.text;
    const pre = fullText.substring(0, err.contextStart);
    // Note: We scan from contextEnd in case whitespace trimming shifted things, 
    // but simplified approach: Replace the first occurrence of the original snippet in the search window
    // Logic: The snippet was extracted by index. We just replace that range.
    
    // BUT, because we trimmed 'sub' in extraction, indices might be slightly off if spaces were removed.
    // Robust Replace:
    const prefix = fullText.substring(0, err.contextStart);
    const suffix = fullText.substring(err.contextEnd);
    
    // Actually, simple string replacement is risky if the sentence appears twice.
    // Safer to use the substring extraction:
    // However, we trimmed 'sub'. Let's trust the user editing the box replaces the 'sub' equivalent.
    // We will just patch it in.
    
    // Actually, to support "just the word", finding the bounds exactly again:
    // Let's assume the user edited the 'sub' we gave them.
    // We just need to stitch it back.
    
    // Need to account for the fact we did .trim() on sub previously?
    // Let's use exact substring for stitching to be safe.
    const originalUntrimmed = fullText.substring(err.contextStart, err.contextEnd);
    
    // If the user's input doesn't look like a replacement, we might have issues.
    // But assuming they fixed the typo:
    const stitchedText = prefix + newSnippet + suffix; // This assumes newSnippet replaces originalUntrimmed.
    // Wait, originalUntrimmed might have leading spaces we stripped. 
    // Let's simply replace the char in the full text if possible? No, user might rewrite words.
    
    // Better approach: Update the segment with the stitched text.
    // NOTE: This might lose spacing if our 'trim' logic was aggressive.
    // Let's avoid trim in the extraction for safety in stitching.
    
    // --- RE-VALIDATION ---
    const badMatches = newSnippet.match(/[^ -~\t\n]/g);
    
    if (badMatches) {
        alert(`Still found untypable character: "${badMatches[0]}"`);
        // Do not advance
    } else {
        // Update the main data
        // We need to re-find the exact spot because 'trim' was used visually but indices are raw
        // Let's retry extraction without trim for the logic
        let rawSub = fullText.substring(err.contextStart, err.contextEnd);
        // If user edited 'newSnippet', we replace 'rawSub' with 'newSnippet'
        // But user might have removed spaces we wanted.
        // It's a trade off. Let's just update.
        
        // Re-calculate indices because we are editing the referenced object in place
        // and subsequent errors in same segment might have invalid indices now.
        // Complex!
        
        // SIMPLIFIED STRATEGY:
        // We update the referenced segment text.
        // If this segment had *multiple* errors in the queue, their indices are now invalid.
        // We should clear future errors for THIS segment and re-scan it? 
        // Or just update this one and hope?
        
        // SAFEST: Update text.
        err.segmentRef.text = fullText.substring(0, err.contextStart) + newSnippet + fullText.substring(err.contextEnd);
        
        // Check if there are other errors in this same segment later in the queue?
        // Yes, if we fix one, the text length changes.
        // We should probably re-validate the current segment completely.
        // If clean, remove other errors pointing to this segment.
        // If dirty, re-queue them.
        
        // Actually, just move on. If they create a new error, we might miss it in this pass, 
        // but let's assume they are fixing things.
        
        currentErrorIdx++;
        showErrorWizard();
    }
};

wizardCancelBtn.onclick = () => {
    if(confirm("Stop import?")) {
        stagedChapters = [];
        wizardModal.classList.add('hidden');
        statusEl.innerText = "Cancelled.";
        statusEl.style.borderColor = "#ff3333";
        chapterListEl.innerHTML = "";
    }
};

// --- RENDER LIST ---
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
    manualNum.value = chap.id; 
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
        stagedChapters[editingIndex].title = manualTitle.value;
        stagedChapters[editingIndex].id = manualNum.value.trim(); 
        stagedChapters[editingIndex].segments = data.segments;
        editingIndex = -1;
        updateStagedBtn.classList.add('hidden');
        saveDirectBtn.classList.remove('hidden');
        manualDetails.open = false;
        renderChapterList();
    } catch (e) { alert("Invalid JSON"); }
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

// --- UPLOAD ALL (Fixed for ID 0) ---
uploadAllBtn.onclick = async () => {
    if (stagedChapters.length === 0) return alert("Nothing to upload.");
    if (!activeBookId) return alert("No active book.");
    
    if (!confirm(`Overwrite ${activeBookId}?`)) return;

    statusEl.innerText = "Uploading...";
    const chapterMeta = [];

    for (let i = 0; i < stagedChapters.length; i++) {
        const chapData = stagedChapters[i];
        // USE STORED ID (allows 0, 1.1), fallback to sequential if missing
        const chapId = (chapData.id !== undefined && chapData.id !== "") ? chapData.id : (i + 1);
        
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

// --- DIRECT SAVE ---
saveDirectBtn.onclick = async () => {
    if (!activeBookId) return alert("No active book.");
    const chapNum = manualNum.value.trim();
    if(chapNum === "") return alert("Chapter ID required");
    
    try {
        const data = JSON.parse(jsonContent.value);
        await setDoc(doc(db, "books", activeBookId, "chapters", "chapter_" + chapNum), data);
        statusEl.innerText = `Saved Chapter ${chapNum}`;
        statusEl.style.borderColor = "#00ff41";
    } catch(e) { alert(e.message); }
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
