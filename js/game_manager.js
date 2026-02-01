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

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

// ════════════════════════════════════════════════════════════════════════════
// AI SIMULATION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

// Evaluate the current board state using heuristics
GameManager.prototype.evaluateBoard = function () {
  var emptyCells = this.grid.availableCells().length;
  var smoothness = this.calculateSmoothness();
  var monotonicity = this.calculateMonotonicity();
  var maxValue = this.getMaxTileValue();
  var cornerBonus = this.calculateCornerBonus();
  
  // Weighted heuristic combination
  return (
    emptyCells * 2.7 +
    smoothness * 0.1 +
    monotonicity * 1.0 +
    Math.log(maxValue) * 1.0 +
    cornerBonus * 0.5
  );
};

// Calculate smoothness (prefer tiles of similar values next to each other)
GameManager.prototype.calculateSmoothness = function () {
  var smoothness = 0;
  var self = this;
  
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      var tile = this.grid.cellContent({ x: x, y: y });
      if (tile) {
        var value = Math.log(tile.value) / Math.log(2);
        
        // Check right neighbor
        if (x < this.size - 1) {
          var rightTile = this.grid.cellContent({ x: x + 1, y: y });
          if (rightTile) {
            var rightValue = Math.log(rightTile.value) / Math.log(2);
            smoothness -= Math.abs(value - rightValue);
          }
        }
        
        // Check down neighbor
        if (y < this.size - 1) {
          var downTile = this.grid.cellContent({ x: x, y: y + 1 });
          if (downTile) {
            var downValue = Math.log(downTile.value) / Math.log(2);
            smoothness -= Math.abs(value - downValue);
          }
        }
      }
    }
  }
  
  return smoothness;
};

// Calculate monotonicity (prefer increasing/decreasing sequences)
GameManager.prototype.calculateMonotonicity = function () {
  var totals = [0, 0, 0, 0]; // up, right, down, left
  
  // Check columns (up/down)
  for (var x = 0; x < this.size; x++) {
    var current = 0;
    var next = current + 1;
    while (next < this.size) {
      while (next < this.size && !this.grid.cellContent({ x: x, y: next })) {
        next++;
      }
      if (next >= this.size) break;
      
      var currentTile = this.grid.cellContent({ x: x, y: current });
      var nextTile = this.grid.cellContent({ x: x, y: next });
      
      if (currentTile && nextTile) {
        var currentValue = Math.log(currentTile.value) / Math.log(2);
        var nextValue = Math.log(nextTile.value) / Math.log(2);
        
        if (currentValue > nextValue) {
          totals[0] += nextValue - currentValue;
        } else if (nextValue > currentValue) {
          totals[2] += currentValue - nextValue;
        }
      }
      
      current = next;
      next++;
    }
  }
  
  // Check rows (left/right)
  for (var y = 0; y < this.size; y++) {
    var current = 0;
    var next = current + 1;
    while (next < this.size) {
      while (next < this.size && !this.grid.cellContent({ x: next, y: y })) {
        next++;
      }
      if (next >= this.size) break;
      
      var currentTile = this.grid.cellContent({ x: current, y: y });
      var nextTile = this.grid.cellContent({ x: next, y: y });
      
      if (currentTile && nextTile) {
        var currentValue = Math.log(currentTile.value) / Math.log(2);
        var nextValue = Math.log(nextTile.value) / Math.log(2);
        
        if (currentValue > nextValue) {
          totals[1] += nextValue - currentValue;
        } else if (nextValue > currentValue) {
          totals[3] += currentValue - nextValue;
        }
      }
      
      current = next;
      next++;
    }
  }
  
  return Math.max(totals[0], totals[2]) + Math.max(totals[1], totals[3]);
};

// Get maximum tile value on the board
GameManager.prototype.getMaxTileValue = function () {
  var max = 0;
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      var tile = this.grid.cellContent({ x: x, y: y });
      if (tile && tile.value > max) {
        max = tile.value;
      }
    }
  }
  return max;
};

// Give bonus for having max tile in a corner
GameManager.prototype.calculateCornerBonus = function () {
  var maxValue = this.getMaxTileValue();
  var corners = [
    { x: 0, y: 0 },
    { x: 0, y: this.size - 1 },
    { x: this.size - 1, y: 0 },
    { x: this.size - 1, y: this.size - 1 }
  ];
  
  for (var i = 0; i < corners.length; i++) {
    var tile = this.grid.cellContent(corners[i]);
    if (tile && tile.value === maxValue) {
      return 10000;
    }
  }
  return 0;
};

// Clone the current game state
GameManager.prototype.cloneState = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    turnCount: this.turnCount
  };
};

// Restore a game state
GameManager.prototype.restoreState = function (state) {
  this.grid = new Grid(state.grid.size, state.grid.cells);
  this.score = state.score;
  this.over = state.over;
  this.won = state.won;
  this.turnCount = state.turnCount;
};

// Check if a move is valid and returns the resulting evaluation
GameManager.prototype.testMove = function (direction) {
  var originalState = this.cloneState();
  var moved = this.simulateMove(direction);
  var scoreGain = this.score - originalState.score;
  var evaluation = moved ? this.evaluateBoard() : -Infinity;
  
  this.restoreState(originalState);
  
  return {
    valid: moved,
    scoreGain: scoreGain,
    evaluation: evaluation
  };
};

// Simulate a move without updating the display
GameManager.prototype.simulateMove = function (direction) {
  var self = this;
  var cell, tile;
  var vector = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved = false;

  this.prepareTiles();

  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next = self.grid.cellContent(positions.next);

        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);
          tile.updatePosition(positions.next);

          self.score += merged.value;
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true;
        }
      }
    });
  });

  if (moved) {
    this.addRandomTile();
  }

  return moved;
};

// Get the best move using evaluation heuristics
GameManager.prototype.getBestMove = function () {
  var bestMove = -1;
  var bestEvaluation = -Infinity;
  
  for (var direction = 0; direction < 4; direction++) {
    var result = this.testMove(direction);
    
    if (result.valid && result.evaluation > bestEvaluation) {
      bestEvaluation = result.evaluation;
      bestMove = direction;
    }
  }
  
  return bestMove;
};

// Main simulation function - intelligently plays to reach target score
GameManager.prototype.simulateToScore = function (targetScore) {
  var self = this;
  var maxMoves = 20000; // Safety limit
  var moveCount = 0;
  var moveDelay = 10; // Delay between moves in milliseconds for visualization
  
  console.log('🎮 Starting AI simulation to reach score:', targetScore);
  console.log('📊 Current score:', this.score);
  
  function makeNextMove() {
    // Check if target reached
    if (self.score >= targetScore) {
      console.log('🎉 Target score reached!');
      console.log('📈 Final score:', self.score);
      console.log('🔢 Moves taken:', moveCount);
      console.log('🏆 Max tile achieved:', self.getMaxTileValue());
      return;
    }
    
    // Check if game is over
    if (self.isGameTerminated()) {
      console.log('💀 Game over before reaching target.');
      console.log('📈 Final score:', self.score);
      console.log('🎯 Target was:', targetScore);
      console.log('🔢 Moves taken:', moveCount);
      console.log('🏆 Max tile achieved:', self.getMaxTileValue());
      return;
    }
    
    // Safety limit check
    if (moveCount >= maxMoves) {
      console.log('⚠️ Safety limit reached.');
      console.log('📈 Final score:', self.score);
      console.log('🔢 Moves taken:', moveCount);
      return;
    }
    
    // Get the best move using AI heuristics
    var bestMove = self.getBestMove();
    
    if (bestMove === -1) {
      console.log('❌ No valid moves available. Game over.');
      console.log('📈 Final score:', self.score);
      return;
    }
    
    // Make the move
    self.move(bestMove);
    moveCount++;
    
    // Log progress every 10 moves
    if (moveCount % 10 === 0) {
      var progress = Math.min(100, (self.score / targetScore) * 100).toFixed(1);
      console.log('📊 Progress:', progress + '% | Score:', self.score, '| Moves:', moveCount, '| Max Tile:', self.getMaxTileValue());
    }
    
    // Continue with next move
    setTimeout(makeNextMove, moveDelay);
  }
  
  // Start the simulation
  makeNextMove();
};