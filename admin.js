// v1.0.0 - Admin Logic
import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// DATA: Wizard of Oz, Chapter 1
const chapterOneData = {
    title: "The Cyclone",
    chapterIndex: 1,
    segments: [
        {
            id: 1,
            text: "Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles.",
            image: "https://upload.wikimedia.org/wikipedia/commons/8/86/The_Wonderful_Wizard_of_Oz_019.jpg"
        },
        {
            id: 2,
            text: "There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds.",
            image: null
        },
        {
            id: 3,
            text: "Uncle Henry and Aunt Em had a big bed in one corner, and Dorothy a little bed in another corner. There was no garret at all, and no cellar-except a small hole dug in the ground, called a cyclone cellar.",
            image: null
        }
    ]
};

async function checkStatus() {
    const statusSpan = document.getElementById('oz-status');
    const docRef = doc(db, "books", "wizard_of_oz", "chapters", "chapter_1");
    try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            statusSpan.innerText = "Loaded & Ready";
            statusSpan.style.color = "green";
        } else {
            statusSpan.innerText = "Missing / Not Found";
            statusSpan.style.color = "red";
        }
    } catch (e) {
        statusSpan.innerText = "Error (Check Console)";
    }
}

document.getElementById('uploadBtn').addEventListener('click', async () => {
    const out = document.getElementById('console-output');
    out.innerText = "Uploading...";
    
    try {
        await setDoc(doc(db, "books", "wizard_of_oz", "chapters", "chapter_1"), chapterOneData);
        out.innerHTML = "<span style='color:green'>Success! Chapter 1 uploaded.</span>";
        checkStatus();
    } catch (e) {
        out.innerHTML = "<span style='color:red'>Error: " + e.message + "</span>";
        console.error(e);
    }
});

// Run check on load
checkStatus();
