// v1.9.4 - Chapter Management & Metadata Support
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.9.4";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const footerEl = document.getElementById('admin-footer');

// Import Elements
const epubInput = document.getElementById('epub-file');
const processingUI = document.getElementById('processing-ui');
const chapterListEl = document.getElementById('chapter-list');
const uploadAllBtn = document.getElementById('upload-all-btn');
const downloadImgsBtn = document.getElementById('download-imgs-btn');
const importBookId = document.getElementById('import-book-id');
const cleanNewlinesCb = document.getElementById('clean-newlines');

// Manual Editor Elements
const manualTitle = document.getElementById('manual-chap-title');
const manualNum = document.getElementById('manual-chap-num');
const jsonContent = document.getElementById('json-content');
const updateStagedBtn = document.getElementById('update-staged-btn');
const saveDirectBtn = document.getElementById('save-btn');
const manualDetails = document.getElementById('manual-details');

// State
let stagedChapters = [];
let extractedImages = new JSZip();
let editingIndex = -1;

if(footerEl) footerEl.innerText = `Admin JS: v${ADMIN_VERSION}`;

// --- AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        statusEl.innerText = "Logged in as: " + user.email;
        statusEl.style.borderColor = "#00ff41"; 
        loginSec.classList.add('hidden');
        editorSec.classList.remove('hidden');
    } else {
        statusEl.innerText = "Access Restricted. Please log in.";
        statusEl.style.borderColor = "#ff3333"; 
        loginSec.classList.remove('hidden');
        editorSec.classList.add('hidden');
    }
});

loginBtn.onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (e) { alert("Login Error: " + e.message); }
};

// --- EPUB PARSING ---
epubInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusEl.innerText = "Parsing EPUB...";
    processingUI.classList.remove('hidden');
    chapterListEl.innerHTML = "<div style='padding:10px; color:#999;'>Reading file structure...</div>";
    stagedChapters = [];
    extractedImages = new JSZip();

    try {
        const zip = await JSZip.loadAsync(file);
        
        // 1. Find OPF
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

        // 2. Parse OPF
        const opfContent = await zip.file(opfPath).async("string");
        const opfDoc = new DOMParser().parseFromString(opfContent, "text/xml");
        const manifest = opfDoc.getElementsByTagName("manifest")[0];
        const spine = opfDoc.getElementsByTagName("spine")[0];
        const basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);

        // 3. Map IDs & Images
        const idToHref = {};
        Array.from(manifest.getElementsByTagName("item")).forEach(item => {
            idToHref[item.getAttribute("id")] = item.getAttribute("href");
            const mediaType = item.getAttribute("media-type");
            if (mediaType && mediaType.startsWith("image/")) {
                const imgPath = resolvePath(basePath, item.getAttribute("href"));
                const imgFile = zip.file(imgPath);
                if (imgFile) {
                    const fileName = item.getAttribute("href").split('/').pop();
                    extractedImages.file(fileName, imgFile.async("blob"));
                }
            }
        });

        // 4. Process Spine (Chapters)
        const spineItems = Array.from(spine.getElementsByTagName("itemref"));
        let counter = 1;

        for (let item of spineItems) {
            const href = idToHref[item.getAttribute("idref")];
            if (!href) continue;

            const fullPath = resolvePath(basePath, href);
            const content = await zip.file(fullPath).async("string");
            const doc = new DOMParser().parseFromString(content, "application/xhtml+xml");
            
            // Extract Title if possible (h1, h2, title tag)
            let title = `Chapter ${counter}`;
            const hTag = doc.querySelector('h1, h2, h3, title');
            if(hTag) title = hTag.innerText.trim().substring(0, 50);

            // Extract Content
            const segments = [];
            doc.body.querySelectorAll("p, div.illustration, img").forEach(el => {
                let text = "";
                let image = "";

                if (el.tagName.toLowerCase() === 'img') {
                    image = el.getAttribute("src").split('/').pop();
                } else if (el.querySelector('img')) {
                    image = el.querySelector('img').getAttribute("src").split('/').pop();
                } else {
                    text = el.textContent;
                    // Strict Cleaning Option
                    if (cleanNewlinesCb.checked) {
                        text = text.replace(/[\r\n]+/g, ' '); 
                    }
                    text = text.replace(/\s\s+/g, ' ').trim();
                    
                    if (text.length > 0) {
                        if (!text.startsWith('\t')) text = '\t' + text;
                    }
                }

                if (text || image) segments.push({ text, image });
            });

            if (segments.length > 0) {
                stagedChapters.push({
                    title: title,
                    segments: segments
                });
                counter++;
            }
        }

        renderChapterList();
        statusEl.innerText = `Parsed ${stagedChapters.length} chapters. Review below before uploading.`;
        statusEl.style.borderColor = "#00ff41";

    } catch (e) {
        console.error(e);
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
});

// --- STAGING UI & LOGIC ---
function renderChapterList() {
    chapterListEl.innerHTML = "";
    if(stagedChapters.length === 0) {
        chapterListEl.innerHTML = "<div style='padding:10px; color:#666;'>No chapters loaded.</div>";
        return;
    }

    stagedChapters.forEach((chap, index) => {
        const div = document.createElement('div');
        div.className = 'chapter-item';
        div.innerHTML = `
            <div class="chap-info">
                <div class="chap-title">#${index + 1}: ${chap.title}</div>
                <div class="chap-meta">${chap.segments.length} segments</div>
            </div>
            <div class="chap-actions">
                <button class="edit-btn" data-index="${index}">Edit</button>
                <button class="danger-btn delete-btn" data-index="${index}">Del</button>
            </div>
        `;
        chapterListEl.appendChild(div);
    });

    // Bind Buttons
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
    
    // Scroll to editor
    manualDetails.scrollIntoView({ behavior: 'smooth' });
}

// Update Staged Chapter from Editor
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
        statusEl.innerText = "Chapter updated in staging area.";
    } catch (e) {
        alert("Invalid JSON: " + e.message);
    }
};

// --- UPLOAD ALL ---
uploadAllBtn.onclick = async () => {
    if (stagedChapters.length === 0) return alert("No chapters.");
    const bookId = importBookId.value.trim();
    if (!bookId) return alert("Book ID required.");

    statusEl.innerText = "Starting Upload...";
    const chapterMeta = [];

    for (let i = 0; i < stagedChapters.length; i++) {
        const chapNum = i + 1;
        const chapData = stagedChapters[i];
        
        try {
            // Save Chapter Content
            await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), {
                segments: chapData.segments
            });
            
            // Collect Metadata
            chapterMeta.push({
                id: "chapter_" + chapNum,
                title: chapData.title || `Chapter ${chapNum}`
            });

        } catch (e) {
            console.error(e);
            return alert(`Upload failed at Chapter ${chapNum}: ${e.message}`);
        }
    }

    // Save Book Metadata
    try {
        await setDoc(doc(db, "books", bookId), {
            title: bookId.replace(/_/g, ' '), // Simple fallback title
            totalChapters: stagedChapters.length,
            chapters: chapterMeta
        }, { merge: true });
        
        statusEl.innerText = "Full Book Upload Complete! Metadata Saved.";
        statusEl.style.borderColor = "#00ff41";
    } catch (e) {
        alert("Chapters uploaded, but Metadata failed: " + e.message);
    }
};

// --- IMAGES ---
downloadImgsBtn.onclick = async () => {
    if (Object.keys(extractedImages.files).length === 0) return alert("No images.");
    const content = await extractedImages.generateAsync({type:"blob"});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `${importBookId.value}_images.zip`;
    link.click();
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
