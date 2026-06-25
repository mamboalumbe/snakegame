       /* ================================================================
                                          SNAKE GAME
                                          ----------------------------------------------------------------
                                          A single-file, no-backend implementation. Everything (game logic,
                                          rendering, and the persistent leaderboard) runs entirely in the
                                          browser, so this works as a static page on GitHub Pages with no
                                          server or database required.

                                          PERSISTENCE
                                          High scores are saved using the browser's localStorage, which
                                          stores data on the player's own device permanently (until they
                                          clear their browser data). This means:
                                            - No backend, database, or network request is needed.
                                            - Leaderboard entries are LOCAL to each player's browser, not
                                              shared across devices or visitors. If you want a leaderboard
                                              that's shared between everyone visiting the site, you would
                                              need to add a real backend (e.g. Firebase, Supabase, or a
                                              small API) — that's a separate, bigger project.

                                          FILE STRUCTURE (all in this one .html file)
                                            1. <style>  - all visual styling, theming via CSS variables
                                            2. <body>   - the HTML structure (board, overlay, controls)
                                            3. <script> - this section: game state, rendering, storage,
                                                           input handling
                                          ================================================================ */

       (function() {
           // ----------------------------------------------------------------
           // DOM REFERENCES
           // Grab every element we'll need to read from or write to once,
           // up front, so the rest of the code can refer to short names.
           // ----------------------------------------------------------------
           const canvas = document.getElementById('board');
           const ctx = canvas.getContext('2d');
           const scoreEl = document.getElementById('score');
           const bestEl = document.getElementById('best');
           const topScoreBanner = document.getElementById('top-score-banner');
           const overlay = document.getElementById('overlay');
           const overlayTitle = document.getElementById('overlay-title');
           const overlayText = document.getElementById('overlay-text');
           const overlayBtn = document.getElementById('overlay-btn');
           const nameField = document.getElementById('name-field');
           const nameInput = document.getElementById('player-name');
           const leaderboardEl = document.getElementById('leaderboard');
           const leaderboardListEl = document.getElementById('leaderboard-list');

           // ----------------------------------------------------------------
           // CONFIGURATION CONSTANTS
           // Tweak these to change game feel without touching game logic.
           // ----------------------------------------------------------------
           const GRID = 20; // board is GRID x GRID cells
           const CELL = canvas.width / GRID; // pixel size of each cell
           const STARTING_LENGTH = 2; // snake length at game start

           // BASE_SPEED_MS is how many milliseconds pass between each move
           // ("tick") of the snake. A LARGER number = SLOWER snake.
           // This was increased from the original 110ms to 170ms per the
           // request to slow the pace down.
           const BASE_SPEED_MS = 160;

           // As the score increases, the game speeds up slightly to keep it
           // challenging. SPEED_STEP_MS is how much faster (in ms) the tick
           // interval gets per point scored, and MIN_SPEED_MS is the fastest
           // the game is allowed to get, no matter how high the score climbs.
           const SPEED_STEP_MS = 2;
           const MIN_SPEED_MS = 90;

           const MAX_LEADERBOARD_ENTRIES = 7; // how many names/scores to keep
           const STORAGE_KEY = 'snake-leaderboard-v1'; // localStorage key

           // ----------------------------------------------------------------
           // GAME STATE
           // All mutable state for the current game lives in these variables.
           // They get reset every time a new game starts (see resetState()).
           // ----------------------------------------------------------------
           let snake; // array of {x, y} cells, snake[0] is the head
           let dir; // current direction of travel, e.g. {x: 1, y: 0}
           let nextDir; // queued direction from the next keypress
           let food; // {x, y} position of the current food cell
           let score; // current game's score
           let loopId; // handle returned by setTimeout, used to cancel the loop
           let running; // true while a game is actively in progress
           let paused; // true while the game is paused mid-run

           // ----------------------------------------------------------------
           // LEADERBOARD STORAGE (localStorage)
           // Stored as a JSON array of { name, score } objects, sorted by
           // score descending, capped at MAX_LEADERBOARD_ENTRIES. Wrapped in
           // try/catch because some browsers block localStorage entirely
           // (e.g. private browsing in certain configurations) — in that case
           // we just fail quietly and the leaderboard simply won't persist.
           // ----------------------------------------------------------------
           function loadLeaderboard() {
               try {
                   const raw = localStorage.getItem(STORAGE_KEY);
                   const parsed = raw ? JSON.parse(raw) : [];
                   return Array.isArray(parsed) ? parsed : [];
               } catch (e) {
                   return [];
               }
           }

           function saveLeaderboard(list) {
               try {
                   localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
               } catch (e) {
                   // localStorage unavailable — leaderboard just won't persist.
               }
           }

           // Adds a new score to the leaderboard (if it's good enough to make
           // the cut), re-sorts, trims to the max length, and saves.
           function submitScore(name, finalScore) {
               const list = loadLeaderboard();
               list.push({
                   name: name || 'ANONYMOUS',
                   score: finalScore
               });
               list.sort((a, b) => b.score - a.score);
               const trimmed = list.slice(0, MAX_LEADERBOARD_ENTRIES);
               saveLeaderboard(trimmed);
               return trimmed;
           }

           // Renders the leaderboard <ol> and the top banner above the board.
           function renderLeaderboard() {
               const list = loadLeaderboard();

               // Top banner: highlight the single highest score and its owner.
               if (list.length > 0) {
                   const top = list[0];
                   topScoreBanner.innerHTML =
                       '<span class="trophy">&#127942;</span> High Score: ' +
                       escapeHtml(top.name) + ' &mdash; ' + top.score;
               } else {
                   topScoreBanner.innerHTML = '';
               }

               // Full list inside the overlay.
               leaderboardListEl.innerHTML = '';
               if (list.length === 0) {
                   leaderboardEl.querySelector('h3').style.display = 'none';
                   const empty = document.createElement('li');
                   empty.className = 'empty';
                   empty.textContent = 'No scores yet — be the first!';
                   leaderboardListEl.appendChild(empty);
                   return;
               }
               leaderboardEl.querySelector('h3').style.display = '';

               list.forEach((entry, i) => {
                   const li = document.createElement('li');
                   li.innerHTML =
                       '<span class="rank">#' + (i + 1) + '</span>' +
                       '<span class="lb-name">' + escapeHtml(entry.name) + '</span>' +
                       '<span class="lb-score">' + entry.score + '</span>';
                   leaderboardListEl.appendChild(li);
               });
           }

           // Minimal HTML-escaping so a player typing "<b>" as their name
           // can't inject markup into the page.
           function escapeHtml(str) {
               return String(str)
                   .replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;');
           }

           // "Your Best" (per-browser personal best, separate from the
           // shared-on-this-device leaderboard list) — kept simple as a
           // single number, same approach as the leaderboard storage.
           function loadPersonalBest() {
               try {
                   return Number(localStorage.getItem('snake-personal-best')) || 0;
               } catch (e) {
                   return 0;
               }
           }

           function savePersonalBest(value) {
               try {
                   localStorage.setItem('snake-personal-best', value);
               } catch (e) { /* ignore */ }
           }

           // ----------------------------------------------------------------
           // GAME SETUP
           // ----------------------------------------------------------------

           // Resets all game state for a brand new run. Called every time
           // "Start Game" is pressed.
           function resetState() {
               const startX = Math.floor(GRID / 2);
               const startY = Math.floor(GRID / 2);
               snake = [];
               for (let i = 0; i < STARTING_LENGTH; i++) {
                   snake.push({
                       x: startX - i,
                       y: startY
                   });
               }
               dir = {
                   x: 1,
                   y: 0
               };
               nextDir = {
                   x: 1,
                   y: 0
               };
               score = 0;
               paused = false;
               scoreEl.textContent = score;
               placeFood();
           }

           // Picks a random empty cell for the next food item. Keeps
           // re-rolling if it happens to land on the snake's own body.
           function placeFood() {
               let valid = false;
               let candidate;
               while (!valid) {
                   candidate = {
                       x: Math.floor(Math.random() * GRID),
                       y: Math.floor(Math.random() * GRID)
                   };
                   valid = !snake.some(seg => seg.x === candidate.x && seg.y === candidate.y);
               }
               food = candidate;
           }

           // ----------------------------------------------------------------
           // RENDERING
           // Pure drawing code — reads state, draws to canvas, no mutation.
           // ----------------------------------------------------------------
           function draw() {
               ctx.clearRect(0, 0, canvas.width, canvas.height);

               const foodColor = getComputedStyle(document.documentElement).getPropertyValue('--food').trim();
               const headColor = getComputedStyle(document.documentElement).getPropertyValue('--snake-head').trim();
               const bodyColor = getComputedStyle(document.documentElement).getPropertyValue('--snake-body').trim();

               // food
               ctx.fillStyle = foodColor;
               roundRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4, 4);
               ctx.fill();

               // snake (head drawn in a brighter color than the body segments)
               snake.forEach((seg, i) => {
                   ctx.fillStyle = i === 0 ? headColor : bodyColor;
                   roundRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2, 3);
                   ctx.fill();
               });
           }

           // Draws a rounded-corner rectangle path (canvas has no built-in
           // roundRect support in every browser, so we draw it manually).
           function roundRect(x, y, w, h, r) {
               ctx.beginPath();
               ctx.moveTo(x + r, y);
               ctx.arcTo(x + w, y, x + w, y + h, r);
               ctx.arcTo(x + w, y + h, x, y + h, r);
               ctx.arcTo(x, y + h, x, y, r);
               ctx.arcTo(x, y, x + w, y, r);
               ctx.closePath();
           }

           // ----------------------------------------------------------------
           // GAME LOOP
           // ----------------------------------------------------------------

           // Advances the game by exactly one grid cell. This is the core
           // game-rule function: move, check collisions, eat food, redraw.
           function step() {
               if (paused) return;

               dir = nextDir;
               const head = snake[0];
               const newHead = {
                   x: head.x + dir.x,
                   y: head.y + dir.y
               };

               // wall collision
               if (newHead.x < 0 || newHead.x >= GRID || newHead.y < 0 || newHead.y >= GRID) {
                   return gameOver();
               }

               // self collision
               if (snake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
                   return gameOver();
               }

               snake.unshift(newHead);

               if (newHead.x === food.x && newHead.y === food.y) {
                   score++;
                   scoreEl.textContent = score;
                   placeFood();
               } else {
                   // didn't eat — remove tail so the snake doesn't grow
                   snake.pop();
               }

               draw();
           }

           // Returns the current tick interval in ms, given the score.
           // Speeds up gradually but never below MIN_SPEED_MS.
           function currentSpeed() {
               return Math.max(MIN_SPEED_MS, BASE_SPEED_MS - score * SPEED_STEP_MS);
           }

           // Schedules the next tick. Re-reads currentSpeed() every time so
           // the game smoothly speeds up as the score grows.
           function loop() {
               step();
               if (running) {
                   loopId = setTimeout(loop, currentSpeed());
               }
           }

           // Called when the snake hits a wall or itself.
           function gameOver() {
               running = false;
               clearTimeout(loopId);

               // Save to the personal best counter (per-browser, no name attached)
               const personalBest = loadPersonalBest();
               if (score > personalBest) {
                   savePersonalBest(score);
                   bestEl.textContent = score;
               }

               // Submit this run's name + score to the leaderboard, then
               // refresh both the on-screen list and the top banner.
               const playerName = (nameInput.value || '').trim().slice(0, 12).toUpperCase() || 'ANONYMOUS';
               submitScore(playerName, score);
               renderLeaderboard();

               overlayTitle.textContent = 'Game Over';
               overlayText.textContent = 'Score: ' + score + '. Press Restart to try again.';
               overlayBtn.textContent = 'Restart';
               nameField.style.display = ''; // allow changing name before next run
               overlay.classList.add('show');
           }

           // Begins a brand new game: resets state, hides overlay, starts loop.
           function startGame() {
               resetState();
               running = true;
               overlay.classList.remove('show');
               draw();
               clearTimeout(loopId);
               loop();
           }

           // Toggles paused state and shows/hides the pause overlay.
           function togglePause() {
               if (!running) return;
               paused = !paused;
               if (paused) {
                   overlayTitle.textContent = 'Paused';
                   overlayText.textContent = 'Press Space or tap Resume to continue.';
                   overlayBtn.textContent = 'Resume';
                   nameField.style.display = 'none'; // don't show name field mid-game
                   overlay.classList.add('show');
               } else {
                   overlay.classList.remove('show');
                   loop();
               }
           }

           // ----------------------------------------------------------------
           // INPUT HANDLING
           // ----------------------------------------------------------------

           // Translates a direction name into a {x, y} delta and queues it,
           // refusing reversals that would make the snake instantly collide
           // with its own neck.
           function setDirection(name) {
               const map = {
                   up: {
                       x: 0,
                       y: -1
                   },
                   down: {
                       x: 0,
                       y: 1
                   },
                   left: {
                       x: -1,
                       y: 0
                   },
                   right: {
                       x: 1,
                       y: 0
                   }
               };
               const newDir = map[name];
               if (!newDir) return;
               if (newDir.x === -dir.x && newDir.y === -dir.y) return;
               nextDir = newDir;
           }

           const KEY_MAP = {
               ArrowUp: 'up',
               w: 'up',
               W: 'up',
               ArrowDown: 'down',
               s: 'down',
               S: 'down',
               ArrowLeft: 'left',
               a: 'left',
               A: 'left',
               ArrowRight: 'right',
               d: 'right',
               D: 'right'
           };

           document.addEventListener('keydown', (e) => {
               // Don't hijack keystrokes while the player is typing their name.
               if (document.activeElement === nameInput && e.code !== 'Escape') return;

               if (e.code === 'Space') {
                   e.preventDefault();
                   if (running) togglePause();
                   return;
               }
               const dirName = KEY_MAP[e.key];
               if (dirName) {
                   e.preventDefault();
                   setDirection(dirName);
               }
           });

           document.querySelectorAll('.controls-mobile button').forEach(btn => {
               btn.addEventListener('click', () => setDirection(btn.dataset.dir));
           });

           // Single button that does double duty as "Start", "Resume", and
           // "Restart" depending on its current label/context.
           overlayBtn.addEventListener('click', () => {
               if (overlayBtn.textContent === 'Resume') {
                   togglePause();
               } else {
                   startGame();
               }
           });

           // Basic swipe support for touch devices.
           let touchStart = null;
           canvas.addEventListener('touchstart', (e) => {
               touchStart = {
                   x: e.touches[0].clientX,
                   y: e.touches[0].clientY
               };
           }, {
               passive: true
           });

           canvas.addEventListener('touchend', (e) => {
               if (!touchStart) return;
               const dx = e.changedTouches[0].clientX - touchStart.x;
               const dy = e.changedTouches[0].clientY - touchStart.y;
               if (Math.abs(dx) > Math.abs(dy)) {
                   setDirection(dx > 0 ? 'right' : 'left');
               } else {
                   setDirection(dy > 0 ? 'down' : 'up');
               }
               touchStart = null;
           }, {
               passive: true
           });

           // ----------------------------------------------------------------
           // INITIAL PAGE LOAD
           // ----------------------------------------------------------------
           bestEl.textContent = loadPersonalBest();
           renderLeaderboard();
           resetState();
           draw();
       })();