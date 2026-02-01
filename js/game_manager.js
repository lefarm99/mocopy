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

GameManager.prototype.simulateToScore = function (targetScore) {
  if (this.isGameTerminated()) {
    console.log("Game already over, stopping simulation");
    return;
  }

  if (this.score >= targetScore) {
    console.log("Already reached target:", this.score);
    return;
  }

  console.log(`Fast simulation started → target ${targetScore}, current ${this.score}`);

  const MAX_MOVES = 40000;           // very high safety limit
  let moveCounter = 0;

  // Strong simple pattern: up > left > right > down
  // (up-left bias is one of the best fixed orders for 2048)
  const directions = [0, 3, 1, 2];   // up, left, right, down

  const step = () => {
    if (this.score >= targetScore) {
      console.log(`Target reached! Score = ${this.score} after ${moveCounter} moves`);
      return;
    }

    if (this.isGameTerminated()) {
      console.log(`Game over. Final score: ${this.score}`);
      return;
    }

    if (moveCounter >= MAX_MOVES) {
      console.log(`Reached max moves (${MAX_MOVES}). Score: ${this.score}`);
      return;
    }

    moveCounter++;

    // 1. Try to make a real move using preferred order
    let moved = false;
    const scoreBefore = this.score;

    for (let dir of directions) {
      this.move(dir);
      if (this.score > scoreBefore) {   // merge happened → good progress
        moved = true;
        break;
      }
    }

    // If no merge happened, still accept any move that changed the board
    if (!moved) {
      for (let dir of directions) {
        this.move(dir);
        if (!this.isGameTerminated()) {
          moved = true;
          break;
        }
      }
    }

    // 2. After every attempted move → brutally clear the RIGHT column
    //    (this is the "never get stuck" hack)
    this.clearRightColumn();

    // Continue immediately (as fast as possible)
    setTimeout(step, 0);
  };

  // Kick off the loop
  setTimeout(step, 0);
};

// Helper: remove EVERY tile in the rightmost column
// (column index = this.size - 1)
GameManager.prototype.clearRightColumn = function () {
  const rightCol = this.size - 1;
  let removedAny = false;

  for (let y = 0; y < this.size; y++) {
    const cell = { x: rightCol, y: y };
    const tile = this.grid.cellContent(cell);
    if (tile) {
      this.grid.removeTile(tile);
      removedAny = true;
    }
  }

  // If we removed anything → add one random tile (like after normal move)
  // This keeps the game flowing and mimics "new tile spawn" pressure
  if (removedAny && this.grid.cellsAvailable()) {
    this.addRandomTile();
  }

  // Update screen
  this.actuate();
};