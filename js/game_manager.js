function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size = size; // Size of the grid
  this.inputManager = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator = new Actuator;

  this.startTiles = 2;
  this.turnCount = 0; // Track number of moves

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
  // Expose the current game manager for external control (simulator/button)
  window.currentGameManager = this;

  // Hook up simulate button if present
  try {
    var self = this;
    var btn = document.getElementById('simulateButton');
    var input = document.getElementById('desiredScoreInput');
    if (btn && input) {
      btn.addEventListener('click', function () {
        var raw = input.value + '';
        var val = Number(input.value) || 0;
        // If input is empty or invalid, simulate to a default target (current + 2048)
        if (!raw.trim()) val = (self.score || 0) + 2048;
        console.log('Simulate button clicked, target=', val);
        self.simulateToScore(val);
      });
    }
  } catch (e) {
    // ignore DOM errors when running in non-browser environments
  }
}

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid = new Grid(previousState.grid.size,
      previousState.grid.cells); // Reload grid
    this.score = previousState.score;
    this.over = previousState.over;
    this.won = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
    this.turnCount = previousState.turnCount || 0; // Restore turn count
    this.gameStart = previousState.gameStart;
    this.grids = previousState.grids;
    this.timeStamps = previousState.timeStamps;
    this.scoreStamps = previousState.scoreStamps;

  } else {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
    this.turnCount = 0;
    this.gameStart = new Date();
    this.grids = [];
    this.timeStamps = [];
    this.timeStamps.push(this.gameStart);
    this.scoreStamps = [];

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);

  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score: this.score,
    over: this.over,
    won: this.won,
    bestScore: this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });

};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    keepPlaying: this.keepPlaying,
    turnCount: this.turnCount,
    gameStart: this.gameStart,
    grids: this.grids,
    timeStamps: this.timeStamps,
    scoreStamps: this.scoreStamps

  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;
          self.scoreStamps.push(merged.value);


          // The mighty 2048 tile
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    this.turnCount++; // Increment turn counter on valid move
    this.addRandomTile();
    this.grids.push(this.grid);
    this.timeStamps.push(new Date());

    if (!this.movesAvailable()) {
      this.over = true; // Game over!

      // Show leaderboard modal when game is over
      var self = this;
      setTimeout(function () {
        if (window.gameLeaderboard) {
          window.gameLeaderboard.showLeaderboardModal(self.score, self.turnCount, self.gameStart, self.grid, self.grids, self.timeStamps, self.scoreStamps);
        }
      }, 500); // Small delay so user can see final move
    }

    this.actuate();
  }
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0, y: -1 }, // Up
    1: { x: 1, y: 0 },  // Right
    2: { x: 0, y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
    this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell = { x: x + vector.x, y: y + vector.y };

          var other = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};



// Simulate random moves until a target score is reached or safety limit hit
// Add near the top of GameManager (or inside simulateToScore)

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
// ────────────────────────────────────────────────

// Add/replace inside GameManager

// Replace / add this new function in GameManager
// (remove / comment out any previous simulateToScore)

GameManager.prototype.simulateToScore = function (targetScore) {
  if (this.isGameTerminated()) {
    console.warn("Cannot simulate: game is already over");
    return;
  }

  if (this.score >= targetScore) {
    console.log(`Score already sufficient: ${this.score} ≥ ${targetScore}`);
    return;
  }

  console.log(`Fast safe simulation → target ≥ ${targetScore}  (current ${this.score})`);

  const MAX_MOVES = 80000;           // hard safety (should never hit)
  let moves = 0;

  // Very strong simple pattern for 2048: up > left > right > down
  const dirPriority = [0, 3, 1, 2];   // 0=up, 3=left, 1=right, 2=down

  const step = () => {
    // Stop conditions
    if (this.score >= targetScore) {
      console.log(`SUCCESS — reached ${this.score} after ${moves} moves`);
      return;
    }

    if (moves >= MAX_MOVES) {
      console.warn(`Stopped: max moves reached. Score = ${this.score}`);
      return;
    }

    moves++;

    // ── Phase 1: try to make a useful move ────────────────────────────────
    let didMerge = false;
    const scoreBefore = this.score;

    for (let dir of dirPriority) {
      this.move(dir);
      if (this.score > scoreBefore) {
        didMerge = true;
        break;
      }
    }

    // If no merge → accept any non-losing move
    if (!didMerge) {
      for (let dir of dirPriority) {
        const beforeOver = this.over;
        this.move(dir);
        if (!this.over && !this.isGameTerminated()) {
          break;
        }
        this.over = beforeOver; // rollback worst case (rare)
      }
    }

    // ── Phase 2: emergency clear to guarantee we never fill up ─────────────
    this.preventBoardFill();

    // Continue as fast as possible
    setTimeout(step, 0);
    // For slower / watchable version use: setTimeout(step, 8);   // ~120 fps
  };

  setTimeout(step, 0);
};


// Helper: keep at least ~4–6 empty cells at all times by removing blocking tiles
GameManager.prototype.preventBoardFill = function () {
  const minEmpty = 5;               // tune: 4–8 works well
  let emptyCount = this.grid.availableCells().length;

  if (emptyCount >= minEmpty) return;

  // Remove tiles from highest-risk positions first (right column + bottom row)
  const dangerousCells = [];

  // Right column
  const right = this.size - 1;
  for (let y = 0; y < this.size; y++) {
    dangerousCells.push({x: right, y});
  }

  // Bottom row (except the bottom-right corner already included)
  const bottom = this.size - 1;
  for (let x = 0; x < right; x++) {
    dangerousCells.push({x, y: bottom});
  }

  // Shuffle a bit so we don't always clear the same spots
  dangerousCells.sort(() => Math.random() - 0.5);

  let toRemove = minEmpty - emptyCount + 1;   // remove a few extra for safety

  for (let cell of dangerousCells) {
    if (toRemove <= 0) break;
    const tile = this.grid.cellContent(cell);
    if (tile) {
      this.grid.removeTile(tile);
      toRemove--;
      emptyCount++;
    }
  }

  // After forced removals → spawn new tiles (like normal game)
  while (this.grid.cellsAvailable() && Math.random() < 0.7) {   // spawn 0–2 tiles
    this.addRandomTile();
  }

  // Refresh display
  this.actuate();
};