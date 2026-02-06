// v1.0.0 - Shared Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCV3RVWUwTLKoi_ze-FNCiam4lhggHKHR8",
  authDomain: "typethatbook.firebaseapp.com",
  projectId: "typethatbook",
  storageBucket: "typethatbook.firebasestorage.app",
  messagingSenderId: "213085805139",
  appId: "1:213085805139:web:b7ffdc2b2eab12344a04a6"
};

// Initialize and export
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
