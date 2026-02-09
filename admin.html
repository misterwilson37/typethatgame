/* =============================================
   SPOT ON! GAMES - Shared Stylesheet v1.0.0
   ============================================= */

/* =============================================
   CSS VARIABLES
   ============================================= */
:root {
    /* Brand Colors */
    --primary: #7BAFD4;          /* Carolina Blue */
    --primary-light: #a8d1f0;
    --primary-dark: #5a9bc4;
    
    /* Feedback Colors */
    --success: #22c55e;
    --success-bg: #166534;
    --error: #ef4444;
    --error-bg: #991b1b;
    --warning: #f59e0b;
    
    /* Dark Theme */
    --bg-dark: #1a1a1a;
    --bg-card: #2a2a2a;
    --bg-input: #333;
    --border: #444;
    --border-light: #555;
    
    /* Text */
    --text-primary: #ffffff;
    --text-secondary: #9ca3af;
    --text-muted: #6b7280;
    
    /* Sizing */
    --game-max-width: 900px;
    --border-radius: 12px;
    --border-radius-sm: 8px;
}

/* =============================================
   RESET & BASE
   ============================================= */
*, *::before, *::after {
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg-dark);
    color: var(--text-primary);
    margin: 0;
    padding: 0;
    min-height: 100vh;
    min-height: 100dvh; /* Dynamic viewport height for mobile */
    overflow-x: hidden;
}

/* =============================================
   GAME CONTAINER - Scale to Fit
   ============================================= */
.game-wrapper {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}

.game-container {
    width: 100%;
    max-width: var(--game-max-width);
    background: var(--bg-card);
    border-radius: var(--border-radius);
    border: 1px solid var(--border);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
}

/* Prevent scroll issues on touch devices - only on canvas */
canvas {
    touch-action: none;
}

/* Allow page scroll */
.game-wrapper {
    touch-action: pan-y;
}

/* =============================================
   SCREENS (Start, Game, GameOver)
   ============================================= */
.screen {
    display: none;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.screen.active {
    display: flex;
}

/* =============================================
   TYPOGRAPHY
   ============================================= */
.game-title {
    font-size: clamp(1.75rem, 5vw, 2.5rem);
    font-weight: 800;
    color: var(--primary);
    text-shadow: 0 0 20px rgba(123, 175, 212, 0.4);
    margin: 0 0 0.5rem 0;
}

.game-subtitle {
    color: var(--text-secondary);
    font-size: clamp(0.9rem, 2.5vw, 1.1rem);
    margin: 0 0 1.5rem 0;
}

.section-title {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
}

/* =============================================
   NAV LINKS
   ============================================= */
.nav-links {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 1rem;
    font-size: 0.875rem;
}

.nav-link {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.2s;
}

.nav-link:hover {
    color: var(--primary);
}

/* =============================================
   BUTTONS
   ============================================= */
.btn {
    font-family: inherit;
    font-weight: 600;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Primary Button */
.btn-primary {
    background: var(--primary);
    color: var(--bg-dark);
    padding: 0.875rem 2rem;
    font-size: 1.1rem;
}

.btn-primary:hover:not(:disabled) {
    box-shadow: 0 0 20px var(--primary);
    transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border);
    padding: 0.625rem 1.25rem;
    font-size: 0.9rem;
}

.btn-secondary:hover:not(:disabled) {
    background: var(--border);
}

/* Choice Buttons (for answer selection) */
.btn-choice {
    background: var(--bg-input);
    color: var(--text-primary);
    border: 2px solid var(--border);
    padding: 0.875rem 1rem;
    font-size: 1rem;
    min-height: 50px; /* Touch target */
}

.btn-choice:hover:not(:disabled) {
    border-color: var(--primary);
    background: rgba(123, 175, 212, 0.1);
}

.btn-choice.selected {
    border-color: var(--primary);
    background: rgba(123, 175, 212, 0.2);
}

.btn-choice.correct {
    border-color: var(--success);
    background: rgba(34, 197, 94, 0.2);
}

.btn-choice.incorrect {
    border-color: var(--error);
    background: rgba(239, 68, 68, 0.2);
}

/* Google Sign-In Button */
.btn-google {
    background: white;
    color: #333;
    padding: 0.625rem 1.25rem;
    font-size: 0.9rem;
    border: 1px solid #ddd;
}

.btn-google:hover:not(:disabled) {
    background: #f5f5f5;
}

/* =============================================
   CHOICE GRID
   ============================================= */
.choice-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    width: 100%;
    max-width: 500px;
    margin: 0 auto;
}

@media (min-width: 600px) {
    .choice-grid.cols-4 {
        grid-template-columns: repeat(4, 1fr);
    }
}

/* =============================================
   CANVAS AREA
   ============================================= */
.canvas-container {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: var(--bg-input);
    border: 2px solid var(--border);
    border-radius: var(--border-radius-sm);
    overflow: hidden;
    margin: 1rem 0;
}

.canvas-container canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

/* Feedback states */
.canvas-container.feedback-correct {
    border-color: var(--success);
    box-shadow: 0 0 20px rgba(34, 197, 94, 0.3);
}

.canvas-container.feedback-incorrect {
    border-color: var(--error);
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
}

/* =============================================
   SCORE & ROUND DISPLAY
   ============================================= */
.game-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0;
    font-size: 0.9rem;
}

.stat-label {
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.stat-value {
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--text-primary);
}

.stat-value.highlight {
    color: var(--primary);
}

/* Feedback text */
.feedback-text {
    font-weight: 600;
    font-size: 1rem;
    min-height: 1.5rem;
}

.feedback-text.correct {
    color: var(--success);
}

.feedback-text.incorrect {
    color: var(--error);
}

/* =============================================
   HOW TO PLAY BOX
   ============================================= */
.how-to-play {
    background: var(--bg-input);
    border-radius: var(--border-radius-sm);
    padding: 1rem;
    margin-bottom: 1.5rem;
    text-align: left;
    max-width: 400px;
}

.how-to-play h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: var(--text-primary);
}

.how-to-play ul {
    margin: 0;
    padding-left: 0;
    list-style: none;
}

.how-to-play li {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-bottom: 0.25rem;
}

/* =============================================
   LEADERBOARD
   ============================================= */
.leaderboard {
    background: var(--bg-input);
    border-radius: var(--border-radius-sm);
    padding: 1rem;
    margin-top: 1rem;
    width: 100%;
    max-width: 350px;
    text-align: left;
}

.leaderboard-title {
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9rem;
}

.leaderboard-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
}

.leaderboard-row:nth-child(odd) {
    background: rgba(255, 255, 255, 0.03);
}

.leaderboard-row.highlight {
    background: rgba(123, 175, 212, 0.15);
    border: 1px solid var(--primary);
}

.leaderboard-rank {
    font-weight: 700;
    width: 24px;
    color: var(--text-muted);
}

.leaderboard-row:nth-child(1) .leaderboard-rank { color: #eab308; }
.leaderboard-row:nth-child(2) .leaderboard-rank { color: #9ca3af; }
.leaderboard-row:nth-child(3) .leaderboard-rank { color: #cd7f32; }

.leaderboard-name {
    font-weight: 600;
    flex: 1;
    margin-left: 0.5rem;
    color: var(--text-primary);
}

.leaderboard-score {
    color: var(--text-secondary);
}

/* =============================================
   USER BADGE
   ============================================= */
.user-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--bg-input);
    padding: 0.5rem 0.75rem;
    border-radius: 50px;
    font-size: 0.85rem;
}

.user-badge img {
    width: 24px;
    height: 24px;
    border-radius: 50%;
}

.user-badge .sign-out {
    color: var(--text-muted);
    cursor: pointer;
    margin-left: 0.25rem;
}

.user-badge .sign-out:hover {
    color: var(--error);
}

/* =============================================
   INITIALS INPUT
   ============================================= */
.initials-input {
    background: var(--bg-input);
    border: 2px solid var(--border);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.25rem;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 4px;
    width: 100px;
    padding: 0.5rem;
    border-radius: var(--border-radius-sm);
}

.initials-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(123, 175, 212, 0.2);
}

/* =============================================
   FINAL SCORE DISPLAY
   ============================================= */
.final-score {
    font-size: 3rem;
    font-weight: 800;
    color: var(--primary);
    text-shadow: 0 0 30px rgba(123, 175, 212, 0.5);
    margin: 0.5rem 0;
}

.final-score-label {
    color: var(--text-secondary);
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 1px;
}

/* =============================================
   NEXT BUTTON (shown after round feedback)
   ============================================= */
.btn-next {
    background: var(--primary);
    color: var(--bg-dark);
    padding: 0.625rem 1.5rem;
    font-size: 1rem;
    margin-top: 0.5rem;
}

.btn-next:hover:not(:disabled) {
    box-shadow: 0 0 15px var(--primary);
}

/* =============================================
   SCORE SUBMIT FORM
   ============================================= */
.score-submit {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin: 1rem 0;
}

/* =============================================
   LOADING STATE
   ============================================= */
.loading-text {
    color: var(--text-muted);
    font-size: 0.9rem;
}

/* =============================================
   IMAGE COUNT INFO
   ============================================= */
.image-count {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin-top: 1rem;
}

/* =============================================
   RESPONSIVE SCALING
   ============================================= */

/* Small screens - ensure everything fits */
@media (max-height: 700px) {
    .game-container {
        padding: 1rem;
    }
    
    .game-title {
        margin-bottom: 0.25rem;
    }
    
    .game-subtitle {
        margin-bottom: 1rem;
    }
    
    .canvas-container {
        margin: 0.75rem 0;
    }
    
    .how-to-play {
        padding: 0.75rem;
        margin-bottom: 1rem;
    }
}

/* Very small screens */
@media (max-height: 600px) {
    .game-wrapper {
        padding: 0.5rem;
    }
    
    .game-container {
        padding: 0.75rem;
        max-height: calc(100vh - 1rem);
        max-height: calc(100dvh - 1rem);
    }
    
    .how-to-play {
        display: none; /* Hide on very small screens during game */
    }
    
    .screen.active .how-to-play {
        display: block; /* But show on start screen */
    }
}

/* Landscape orientation on small devices */
@media (orientation: landscape) and (max-height: 500px) {
    .game-container {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 1rem;
        max-height: none;
        overflow: visible;
    }
    
    .canvas-container {
        flex: 1;
        min-width: 300px;
        aspect-ratio: 4 / 3;
    }
    
    .game-controls {
        flex: 0 0 200px;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
}

/* =============================================
   UTILITY CLASSES
   ============================================= */
.hidden {
    display: none !important;
}

.text-center {
    text-align: center;
}

.mt-1 { margin-top: 0.5rem; }
.mt-2 { margin-top: 1rem; }
.mt-3 { margin-top: 1.5rem; }
.mb-1 { margin-bottom: 0.5rem; }
.mb-2 { margin-bottom: 1rem; }
.mb-3 { margin-bottom: 1.5rem; }

.w-full { width: 100%; }
