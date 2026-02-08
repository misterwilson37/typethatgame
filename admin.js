// v1.9.3 - EPUB Batch Import & Image Extraction
import { db, auth } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const ADMIN_VERSION = "1.9.3";

// DOM Elements
const statusEl = document.getElementById('status');
const loginSec = document.getElementById('login-section');
const editorSec = document.getElementById('editor-section');
const loginBtn = document.getElementById('login-btn');
const saveBtn = document.getElementById('save-btn');
const footerEl = document.getElementById('admin-footer');

// EPUB Elements
const epubInput = document.getElementById('epub-file');
const processingUI = document.getElementById('processing-ui');
const chapterListEl = document.getElementById('chapter-list');
const uploadAllBtn = document.getElementById('upload-all-btn');
const downloadImgsBtn = document.getElementById('download-imgs-btn');
const importBookId = document.getElementById('import-book-id');

// Init
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

// --- MANUAL SAVE ---
saveBtn.onclick = async () => {
    const bookId = document.getElementById('manual-book-id').value.trim();
    const chapNum = document.getElementById('manual-chap-num').value.trim();
    const jsonStr = document.getElementById('json-content').value.trim();

    if (!bookId || !chapNum || !jsonStr) return alert("Fill all fields");

    try {
        const data = cleanData(JSON.parse(jsonStr));
        document.getElementById('json-content').value = JSON.stringify(data, null, 2);
        
        statusEl.innerText = `Saving Chapter ${chapNum}...`;
        await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chapNum), data);
        statusEl.innerText = `Success! Chapter ${chapNum} saved.`;
        statusEl.style.borderColor = "#00ff41";
    } catch (e) {
        statusEl.innerText = "Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
};

// --- EPUB IMPORT LOGIC ---
let processedChapters = [];
let extractedImages = new JSZip(); // Store images for download

epubInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusEl.innerText = "Parsing EPUB...";
    processingUI.classList.remove('hidden');
    chapterListEl.innerHTML = "Reading file...";
    processedChapters = [];
    extractedImages = new JSZip();

    try {
        const zip = await JSZip.loadAsync(file);
        
        // 1. Find OPF File (Metadata)
        let opfPath = null;
        // Check standard paths or search
        const files = Object.keys(zip.files);
        const containerInfo = await zip.file("META-INF/container.xml")?.async("string");
        
        if (containerInfo) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(containerInfo, "text/xml");
            opfPath = doc.querySelector("rootfile").getAttribute("full-path");
        } else {
            // Fallback search
            opfPath = files.find(f => f.endsWith(".opf"));
        }

        if (!opfPath) throw new Error("No OPF file found in EPUB.");

        // 2. Parse OPF
        const opfContent = await zip.file(opfPath).async("string");
        const parser = new DOMParser();
        const opfDoc = parser.parseFromString(opfContent, "text/xml");
        const manifest = opfDoc.getElementsByTagName("manifest")[0];
        const spine = opfDoc.getElementsByTagName("spine")[0];
        
        // Base path for relative files
        const basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);

        // 3. Map ID to Href
        const idToHref = {};
        Array.from(manifest.getElementsByTagName("item")).forEach(item => {
            idToHref[item.getAttribute("id")] = item.getAttribute("href");
            // While we are here, grab images
            const mediaType = item.getAttribute("media-type");
            if (mediaType && mediaType.startsWith("image/")) {
                const imgPath = resolvePath(basePath, item.getAttribute("href"));
                const imgFile = zip.file(imgPath);
                if (imgFile) {
                    // Save to our image zip with a flat name for easier usage
                    const fileName = item.getAttribute("href").split('/').pop();
                    extractedImages.file(fileName, imgFile.async("blob"));
                }
            }
        });

        // 4. Iterate Spine (Reading Order)
        const spineItems = Array.from(spine.getElementsByTagName("itemref"));
        chapterListEl.innerHTML = "";
        
        let chapterCounter = 1;

        for (let item of spineItems) {
            const id = item.getAttribute("idref");
            const href = idToHref[id];
            if (!href) continue;

            const fullPath = resolvePath(basePath, href);
            const content = await zip.file(fullPath).async("string");
            
            // 5. Parse Chapter HTML
            const doc = new DOMParser().parseFromString(content, "application/xhtml+xml");
            
            // Extract segments
            const segments = [];
            
            // Strategy: Look for <p> and <img>
            // Common Gutenberg structure is simple
            const elements = doc.body.querySelectorAll("p, div.illustration, img");
            
            elements.forEach(el => {
                let text = "";
                let image = "";

                if (el.tagName.toLowerCase() === 'img') {
                    image = el.getAttribute("src").split('/').pop(); // Just filename
                } else if (el.querySelector('img')) {
                    // Illustration div
                    const img = el.querySelector('img');
                    image = img.getAttribute("src").split('/').pop();
                } else {
                    // Paragraph text
                    text = el.textContent.trim();
                    text = text.replace(/\s\s+/g, ' '); // Clean double spaces
                    if (text.length > 0) {
                        text = '\t' + text; // Force Indent
                    }
                }

                if (text || image) {
                    segments.push({ text, image });
                }
            });

            // If meaningful content found, register chapter
            if (segments.length > 2) { // Filter out empty wrappers
                processedChapters.push({
                    num: chapterCounter,
                    data: { segments }
                });
                
                // Add to UI List
                const div = document.createElement('div');
                div.className = 'chapter-item';
                div.id = `chap-ui-${chapterCounter}`;
                div.innerText = `Chapter ${chapterCounter}: ${fullPath} (${segments.length} segments)`;
                chapterListEl.appendChild(div);
                
                chapterCounter++;
            }
        }

        statusEl.innerText = `Parsed ${processedChapters.length} chapters. Ready to upload.`;
        statusEl.style.borderColor = "#00ff41";

    } catch (e) {
        console.error(e);
        statusEl.innerText = "EPUB Error: " + e.message;
        statusEl.style.borderColor = "#ff3333";
    }
});

// --- BATCH UPLOAD ---
uploadAllBtn.onclick = async () => {
    if (processedChapters.length === 0) return alert("No chapters parsed.");
    const bookId = importBookId.value.trim();
    if (!bookId) return alert("Enter Book ID");

    statusEl.innerText = "Starting Batch Upload...";
    
    for (let chap of processedChapters) {
        try {
            const ui = document.getElementById(`chap-ui-${chap.num}`);
            ui.innerText += " ... Uploading";
            
            await setDoc(doc(db, "books", bookId, "chapters", "chapter_" + chap.num), chap.data);
            
            ui.classList.add('uploaded');
            ui.innerText = ui.innerText.replace(" ... Uploading", " [OK]");
        } catch (e) {
            console.error(e);
            document.getElementById(`chap-ui-${chap.num}`).classList.add('error');
        }
    }
    statusEl.innerText = "Batch Upload Complete.";
};

// --- DOWNLOAD IMAGES ---
downloadImgsBtn.onclick = async () => {
    if (Object.keys(extractedImages.files).length === 0) return alert("No images found in EPUB.");
    
    const content = await extractedImages.generateAsync({type:"blob"});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `${importBookId.value}_images.zip`;
    link.click();
};

// Helpers
function resolvePath(base, relative) {
    // Simple path resolver for flat structure
    // If relative has no '../', just append
    // Real path resolution is complex, but Gutenberg is usually flat inside OEBPS
    if(base === "") return relative;
    return base + relative;
}

function cleanData(data) {
    if (data.segments) {
        data.segments.forEach(seg => {
            if (seg.text) {
                seg.text = seg.text.replace(/\s\s+/g, ' ').trim();
                if (!seg.text.startsWith('\t')) seg.text = '\t' + seg.text;
            }
        });
    }
    return data;
}
