const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const DAILY_LIMIT = 5;

exports.generatePractice = onCall(
  {
    secrets: [geminiApiKey],
    maxInstances: 5,       // prevent runaway scaling
    timeoutSeconds: 30,
  },
  async (request) => {
    // 1. Auth check
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;

    // 2. Rate limit: 5 per user per day
    const today = new Date().toISOString().split("T")[0];
    const limitRef = db.collection("practice_limits").doc(uid);
    const limitSnap = await limitRef.get();
    let count = 0;
    if (limitSnap.exists) {
      const data = limitSnap.data();
      if (data.date === today) count = data.count || 0;
    }
    if (count >= DAILY_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `You've used all ${DAILY_LIMIT} practice sessions for today. Try again tomorrow!`
      );
    }

    // 3. Validate input
    const { problemChars, bookTitle, chapterTitle, textSnippet } = request.data;
    if (!problemChars || !Array.isArray(problemChars) || problemChars.length === 0) {
      throw new HttpsError("invalid-argument", "No problem characters provided.");
    }

    // Sanitize inputs (prevent prompt injection)
    const safeChars = problemChars.slice(0, 8).map(c => String(c).substring(0, 10));
    const safeTitle = String(bookTitle || "a book").substring(0, 200);
    const safeChapter = String(chapterTitle || "").substring(0, 200);
    const safeSnippet = String(textSnippet || "").substring(0, 500);

    // 4. Build prompt
    const charList = safeChars.map(c => {
      if (c === " " || c === "Space") return "the space bar";
      if (c === "\n" || c === "Enter") return "line breaks / the Enter key";
      return `the "${c}" character`;
    }).join(", ");

    const prompt = `Write a single paragraph of 100-150 words for a typing practice exercise for middle school students. Requirements:
- Write in a style and tone similar to "${safeTitle}"${safeChapter ? ` (currently in a chapter called "${safeChapter}")` : ""}
- The paragraph should naturally and frequently use ${charList}
- Make it engaging, fun, and age-appropriate for 11-14 year olds
- Use only standard English letters, numbers, and punctuation (periods, commas, semicolons, apostrophes, quotes, question marks, exclamation points)
- Do NOT use special characters, emojis, or unusual formatting
- Write ONLY the paragraph text with no introduction, title, or explanation

${safeSnippet ? `Here is a brief excerpt from the book for style reference:\n"${safeSnippet}"` : ""}

Remember: write ONLY the practice paragraph, nothing else.`;

    // 5. Call Gemini API
    const apiKey = geminiApiKey.value();
    let generatedText;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 500,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errBody = await response.text();
        console.error("Gemini API error:", response.status, errBody);
        throw new HttpsError("internal", "Practice text generation failed. Try again.");
      }

      const result = await response.json();
      generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!generatedText) {
        throw new HttpsError("internal", "No text was generated. Try again.");
      }

      // Clean up: normalize quotes and trim
      generatedText = generatedText
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2014/g, "--")
        .replace(/\u2013/g, "-")
        .trim();
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error("Gemini call failed:", e);
      throw new HttpsError("internal", "Could not generate practice text. Try again.");
    }

    // 6. Increment rate limit
    await limitRef.set({ date: today, count: count + 1 }, { merge: true });

    // 7. Return
    return {
      text: generatedText,
      prompt: prompt,
      remaining: DAILY_LIMIT - count - 1,
    };
  }
);
