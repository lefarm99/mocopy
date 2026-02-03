function LeaderboardManager(scriptUrl) {
  this.scriptUrl = scriptUrl;
  this.recentSubmissions = {}; // Track recent submissions by name
}

// Client-side validation
LeaderboardManager.prototype.validateSubmission = function (name, score, turns) {
  // Validate name
  if (!name || name.length < 1) {
    return { valid: false, message: 'Please enter your name!' };
  }
  if (name.length > 20) {
    return { valid: false, message: 'Name too long (max 20 characters)' };
  }

  // Validate score
  if (score <= 0 || !Number.isInteger(score)) {
    return { valid: false, message: 'Invalid score' };
  }

  if (score % 4 !== 0) {
    return { valid: false, message: 'Invalid score (not a valid 2048 score)' };
  }

  if (score > 4000000) {
    return { valid: false, message: 'Score too high - this seems impossible!' };
  }

  var minimumTurns = Math.floor(score / 100); // Very lenient: 100 points per turn
  var maximumTurns = score * 3; // Nobody should take 3x as many turns as their score

  if (turns < minimumTurns) {
    return { valid: false, message: 'Too few turns for this score - impossible!' };
  }

  if (turns > maximumTurns) {
    return { valid: false, message: 'Too many turns - something went wrong!' };
  }

  // Check rate limiting (3 submissions per 5 minutes)
  var now = Date.now();
  var fiveMinutesAgo = now - (5 * 60 * 1000);

  if (!this.recentSubmissions[name]) {
    this.recentSubmissions[name] = [];
  }

  // Clean old submissions
  this.recentSubmissions[name] = this.recentSubmissions[name].filter(function (timestamp) {
    return timestamp > fiveMinutesAgo;
  });

  if (this.recentSubmissions[name].length >= 3) {
    return { valid: false, message: 'Too many submissions. Please wait a few minutes.' };
  }

  return { valid: true };
};

// Submit a score to the leaderboard
LeaderboardManager.prototype.submitScore = function (name, score, turns, gameStart, grid, grids, timeStamps, scoreStamps, callback) {
  var self = this;

  // Validate before submitting
  var validation = this.validateSubmission(name, score, turns);
  if (!validation.valid) {
    setTimeout(function () {
      if (callback) callback(new Error(validation.message), null);
    }, 0);
    return;
  }

  // Track this submission
  if (!this.recentSubmissions[name]) {
    this.recentSubmissions[name] = [];
  }
  this.recentSubmissions[name].push(Date.now());

  console.log(name, score, turns, grid.length, grids.length, timeStamps.length, scoreStamps.length);
  
  request = fetch(this.scriptUrl, {
    method: 'POST',
    mode: 'no-cors', // Required for Google Apps Script
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: name,
      score: score,
      turns: turns,
      gameStart: gameStart,
      grid: grid,
      grids: grids,
      timeStamps: timeStamps,
      scoreStamps: scoreStamps,
    })
  })
    .then(function () {
      console.log(request.response.json);
      // no-cors means we can't read the response
      // If it doesn't throw an error, we assume it worked
      if (callback) callback(null, { status: 'success' });
    })
    .catch(function (error) {
      console.log(request.response.json);
      if (callback) callback(error, null);
    });
};

// Get the leaderboard
LeaderboardManager.prototype.getLeaderboard = function (callback) {
  fetch(this.scriptUrl)
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (callback) callback(null, data.leaderboard);
    })
    .catch(function (error) {
      if (callback) callback(error, null);
    });
};

// Get all scores (not just top 10)
LeaderboardManager.prototype.getAllScores = function (callback) {
  fetch(this.scriptUrl + '?all=true')
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (callback) callback(null, data.allScores);
    })
    .catch(function (error) {
      if (callback) callback(error, null);
    });
};

// Show leaderboard modal
LeaderboardManager.prototype.showLeaderboardModal = function (currentScore, turnCount, gameStart, grid, grids, timeStamps, scoreStamps) {
  var self = this;

  var container = document.querySelector('.container');
  if (!container) {
    // Fallback: add to body
    container = document.body;
  }
  // Create modal HTML - simplified, just for score submission
  var modalHTML = `
    <div class="leaderboard-overlay">
      <div class="leaderboard-modal leaderboard-modal-simple">
        <h2>Game Over!</h2>
        <p class="final-score">Your Score: <strong>${currentScore}</strong></p>
        <p class="turn-count">Moves: ${turnCount}</p>
        
        <div class="submit-score-section">
          <h3>Submit to Leaderboard</h3>
          <input type="text" id="player-name" placeholder="Enter your name" maxlength="20" />
          <button id="submit-score-btn">Submit Score</button>
          <p class="submit-message" id="submit-message"></p>
        </div>
        
        <button class="close-modal-btn" id="close-leaderboard">Close</button>
      </div>
    </div>
  `;

  // Add modal to page
  var modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHTML;
  container.appendChild(modalContainer);

  // Prevent WASD/arrow keys from triggering game controls when typing
  var nameInput = document.getElementById('player-name');
  nameInput.addEventListener('keydown', function (e) {
    e.stopPropagation(); // Prevent event from reaching game controls
  });

  nameInput.addEventListener('keyup', function (e) {
    e.stopPropagation(); // Prevent event from reaching game controls
  });

  // Submit on Enter key
  nameInput.addEventListener('keypress', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      document.getElementById('submit-score-btn').click();
    }
  });

  // Submit score button
  document.getElementById('submit-score-btn').addEventListener('click', function () {
    var name = document.getElementById('player-name').value.trim();
    var messageEl = document.getElementById('submit-message');

    if (!name) {
      messageEl.textContent = 'Please enter your name!';
      messageEl.style.color = '#ed5565';
      return;
    }

    messageEl.textContent = 'Submitting...';
    messageEl.style.color = '#776e65';

    self.submitScore(name, currentScore, turnCount, gameStart, grid, grids, timeStamps, scoreStamps, function (error, result) {
      if (error) {
        messageEl.textContent = 'Failed: ' + error.message;
        messageEl.style.color = '#ed5565';
      } else {
        messageEl.textContent = 'Score submitted successfully!';
        messageEl.style.color = '#a0d468';

        // Reload permanent leaderboard
        setTimeout(function () {
          self.updatePermanentLeaderboard();
        }, 1000);

        // Disable input and button
        document.getElementById('player-name').disabled = true;
        document.getElementById('submit-score-btn').disabled = true;
      }
    });
  });

  // Close button
  document.getElementById('close-leaderboard').addEventListener('click', function () {
    modalContainer.remove();
  });

  // Focus on name input
  nameInput.focus();
};

// Load and display leaderboard in the modal
LeaderboardManager.prototype.loadAndDisplayLeaderboard = function () {
  var listEl = document.getElementById('leaderboard-list');

  this.getLeaderboard(function (error, leaderboard) {
    if (error) {
      listEl.innerHTML = '<p class="error">Failed to load leaderboard</p>';
      return;
    }

    if (!leaderboard || leaderboard.length === 0) {
      listEl.innerHTML = '<p>No scores yet. Be the first!</p>';
      return;
    }

    var html = '<ol class="leaderboard-entries">';
    leaderboard.forEach(function (entry) {
      html += `
        <li>
          <span class="player-name">${entry.name}</span>
          <span class="player-score">${entry.score}</span>
        </li>
      `;
    });
    html += '</ol>';

    listEl.innerHTML = html;
  });
};

// Create permanent leaderboard display at bottom of page
LeaderboardManager.prototype.createPermanentLeaderboard = function () {
  var self = this;

  // Create permanent leaderboard HTML
  var leaderboardHTML = `
    <div class="permanent-leaderboard">
      <h3>🏆 Top 10 Leaderboard</h3>
      <div id="permanent-leaderboard-list">Loading...</div>
      <div class="leaderboard-buttons">
        <button id="refresh-leaderboard" class="refresh-btn">Refresh</button>
        <button id="view-all-scores" class="view-all-btn">View All Scores</button>
      </div>
    </div>
  `;

  // Find the container and add to it
  var container = document.querySelector('.container');
  if (!container) {
    // Fallback: add to body
    container = document.body;
  }

  var leaderboardDiv = document.createElement('div');
  leaderboardDiv.innerHTML = leaderboardHTML;
  container.appendChild(leaderboardDiv);

  // Load initial leaderboard
  this.updatePermanentLeaderboard();

  // Refresh button
  document.getElementById('refresh-leaderboard').addEventListener('click', function () {
    self.updatePermanentLeaderboard();
  });

  // View All Scores button
  document.getElementById('view-all-scores').addEventListener('click', function () {
    self.showAllScoresModal();
  });

  // Auto-refresh every 30 seconds
  setInterval(function () {
    self.updatePermanentLeaderboard();
  }, 30000);
};

// Update the permanent leaderboard display
LeaderboardManager.prototype.updatePermanentLeaderboard = function () {
  var listEl = document.getElementById('permanent-leaderboard-list');

  this.getLeaderboard(function (error, leaderboard) {
    if (error) {
      listEl.innerHTML = '<p class="error">Failed to load</p>';
      return;
    }

    if (!leaderboard || leaderboard.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No scores yet!</p>';
      return;
    }

    var html = '<ol class="permanent-leaderboard-entries">';
    leaderboard.forEach(function (entry, index) {
      var medal = '';
      if (index === 0) medal = '🥇';
      else if (index === 1) medal = '🥈';
      else if (index === 2) medal = '🥉';

      // Format the timestamp
      var formattedDate = '';
      if (entry.timestamp) {
        var date = new Date(entry.timestamp);
        formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      html += `
        <li>
          <span class="rank">${medal}</span>
          <span class="player-name">${entry.name}</span>
          <span class="player-score">${entry.score}</span>
          <span class="player-timestamp">${formattedDate}</span>
        </li>
      `;
    });
    html += '</ol>';

    listEl.innerHTML = html;
  });
};

// Show all scores modal with pagination and filtering
LeaderboardManager.prototype.showAllScoresModal = function () {
  var self = this;
  var currentPage = 1;
  var itemsPerPage = 20;
  var allScores = [];
  var sortMode = 'score'; // 'score' or 'recent'

  // Create modal HTML
  var modalHTML = `
    <div class="leaderboard-overlay">
      <div class="leaderboard-modal all-scores-modal">
        <h2>All Scores</h2>
        
        <div class="filter-controls">
          <button class="filter-btn active" data-sort="score">Highest Score</button>
          <button class="filter-btn" data-sort="recent">Most Recent</button>
        </div>
        
        <div id="all-scores-list" class="all-scores-list">
          Loading...
        </div>
        
        <div class="pagination-controls" id="pagination-controls">
          <button id="prev-page" class="page-btn" disabled>Previous</button>
          <span id="page-info">Page 1</span>
          <button id="next-page" class="page-btn">Next</button>
        </div>
        
        <button class="close-modal-btn" id="close-all-scores">Close</button>
      </div>
    </div>
  `;

  // Add modal to page
  var modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHTML;
  document.body.appendChild(modalContainer);

  // Load all scores
  function loadScores() {
    document.getElementById('all-scores-list').innerHTML = '<p class="loading">Loading...</p>';

    self.getAllScores(function (error, scores) {
      if (error) {
        document.getElementById('all-scores-list').innerHTML = '<p class="error">Failed to load scores</p>';
        return;
      }

      allScores = scores || [];
      renderScores();
    });
  }

  // Render scores based on current page and sort mode
  function renderScores() {
    var sortedScores = allScores.slice();

    // Remove duplicates - keep only best score per person
    var bestScores = {};
    sortedScores.forEach(function (entry) {
      var name = entry.name.toLowerCase();
      if (!bestScores[name] || entry.score > bestScores[name].score) {
        bestScores[name] = entry;
      }
    });

    // Convert back to array
    var uniqueScores = Object.values(bestScores);

    // Sort based on mode
    if (sortMode === 'score') {
      uniqueScores.sort(function (a, b) { return b.score - a.score; });
    } else {
      uniqueScores.sort(function (a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
    }

    // Calculate pagination
    var totalPages = Math.ceil(uniqueScores.length / itemsPerPage);
    var startIndex = (currentPage - 1) * itemsPerPage;
    var endIndex = startIndex + itemsPerPage;
    var pageScores = uniqueScores.slice(startIndex, endIndex);

    // Render list
    var html = '<ol class="all-scores-entries" start="' + (startIndex + 1) + '">';
    pageScores.forEach(function (entry) {
      var formattedDate = '';
      if (entry.timestamp) {
        var date = new Date(entry.timestamp);
        formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      html += `
        <li>
          <span class="player-info">
            <span class="player-name">${entry.name}</span>
            <span class="player-timestamp">${formattedDate}</span>
          </span>
          <span class="player-score">${entry.score}</span>
        </li>
      `;
    });
    html += '</ol>';

    document.getElementById('all-scores-list').innerHTML = html;

    // Update pagination controls
    document.getElementById('page-info').textContent = 'Page ' + currentPage + ' of ' + totalPages;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === totalPages;
  }

  // Filter button handlers
  var filterBtns = modalContainer.querySelectorAll('.filter-btn');
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      sortMode = btn.getAttribute('data-sort');
      currentPage = 1;
      renderScores();
    });
  });

  // Pagination handlers
  document.getElementById('prev-page').addEventListener('click', function () {
    if (currentPage > 1) {
      currentPage--;
      renderScores();
    }
  });

  document.getElementById('next-page').addEventListener('click', function () {
    var totalPages = Math.ceil(allScores.length / itemsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderScores();
    }
  });

  // Close button
  document.getElementById('close-all-scores').addEventListener('click', function () {
    modalContainer.remove();
  });

  // Load initial data
  loadScores();
};
