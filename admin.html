// v1.0.2 - Admin with FULL Chapter 1
import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// FULL DATA: Wizard of Oz, Chapter 1
// I have combined the text into larger chunks for better typing flow.
const chapterOneData = {
    title: "The Cyclone",
    chapterIndex: 1,
    segments: [
        {
            id: 1,
            text: "Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles. There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds. Uncle Henry and Aunt Em had a big bed in one corner, and Dorothy a little bed in another corner. There was no garret at all, and no cellar-except a small hole dug in the ground, called a cyclone cellar, where the family could go in case one of those great whirlwinds arose, mighty enough to crush any building in its path. It was reached by a trap door in the middle of the floor, from which a ladder led down into the small, dark hole.",
            image: "https://upload.wikimedia.org/wikipedia/commons/8/86/The_Wonderful_Wizard_of_Oz_019.jpg"
        },
        {
            id: 2,
            text: "When Dorothy stood in the doorway and looked around, she could see nothing but the great gray prairie on every side. Not a tree nor a house broke the broad sweep of flat country that reached to the edge of the sky in all directions. The sun had baked the plowed land into a gray mass, with little cracks running through it. Even the grass was not green, for the sun had burned the tops of the long blades until they were the same gray color to be seen everywhere. Once the house had been painted, but the sun blistered the paint and the rains washed it away, and now the house was as dull and gray as everything else.",
            image: null
        },
        {
            id: 3,
            text: "When Aunt Em came there to live she was a young, pretty wife. The sun and wind had changed her, too. They had taken the sparkle from her eyes and left them a sober gray; they had taken the red from her cheeks and lips, and they were gray also. She was thin and gaunt, and never smiled now. When Dorothy, who was an orphan, first came to her, Aunt Em had been so startled by the child's laughter that she would scream and press her hand upon her heart whenever Dorothy's merry voice reached her ears; and she still looked at the little girl with wonder that she could find anything to laugh at.",
            image: null
        },
        {
            id: 4,
            text: "Uncle Henry never laughed. He worked hard from morning till night and did not know what joy was. He was gray also, from his long beard to his rough boots, and he looked stern and solemn, and rarely spoke. It was Toto that made Dorothy laugh, and saved her from growing as gray as her other surroundings. Toto was not gray; he was a little black dog, with long silky hair and small black eyes that twinkled merrily on either side of his funny, wee nose. Toto played all day long, and Dorothy played with him, and loved him dearly.",
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/W_W_Denslow_-_The_Wonderful_Wizard_of_Oz_-_The_cyclone_-_022.jpg/800px-W_W_Denslow_-_The_Wonderful_Wizard_of_Oz_-_The_cyclone_-_022.jpg"
        },
        {
            id: 5,
            text: "Today, however, they were not playing. Uncle Henry sat upon the doorstep and looked anxiously at the sky, which was even grayer than usual. Dorothy stood in the door with Toto in her arms, and looked at the sky too. Aunt Em was washing the dishes. From the far north they heard a low wail of the wind, and Uncle Henry and Dorothy could see where the long grass bowed in waves before the coming storm. There now came a sharp whistling in the air from the south, and as they turned their eyes that way they saw ripples in the grass coming from that direction also.",
            image: null
        },
        {
            id: 6,
            text: "\"Quick, Dorothy!\" screamed Aunt Em. \"Run for the cellar!\" Toto jumped out of Dorothy's arms and hid under the bed, and the girl started to get him. Aunt Em, badly frightened, threw open the trap door in the floor and climbed down the ladder into the small, dark hole. Dorothy caught Toto at last and started to follow her aunt. When she was halfway across the room there came a great shriek from the wind, and the house shook so hard that she lost her footing and sat down suddenly upon the floor.",
            image: null
        },
        {
            id: 7,
            text: "Then a strange thing happened. The house whirled around two or three times and rose slowly through the air. Dorothy felt as if she were going up in a balloon. The north and south winds met where the house stood, and made it the exact center of the cyclone. In the middle of a cyclone the air is generally still, but the great pressure of the wind on every side of the house raised it up higher and higher, until it was at the very top of the cyclone; and there it remained and was carried miles and miles away as easily as you could carry a feather.",
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/W_W_Denslow_-_The_Wonderful_Wizard_of_Oz_-_The_cyclone_-_025.jpg/800px-W_W_Denslow_-_The_Wonderful_Wizard_of_Oz_-_The_cyclone_-_025.jpg"
        },
        {
            id: 8,
            text: "It was very dark, and the wind howled horribly around her, but Dorothy found she was riding quite easily. After the first few whirls around, and one other time when the house tipped badly, she felt as if she were being rocked gently, like a baby in a cradle. Toto did not like it. He ran about the room, now here, now there, barking loudly; but Dorothy sat quite still on the floor and waited to see what would happen.",
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
    out.innerText = "Uploading Full Chapter...";
    
    try {
        await setDoc(doc(db, "books", "wizard_of_oz", "chapters", "chapter_1"), chapterOneData);
        out.innerHTML = "<span style='color:green'>Success! Full Chapter 1 uploaded.</span>";
        checkStatus();
    } catch (e) {
        out.innerHTML = "<span style='color:red'>Error: " + e.message + "</span>";
        console.error(e);
    }
});

checkStatus();
