function FirebaseLeaderboardManager() {
  this.recentSubmissions = {}; // Track recent submissions by UID
  this.scoresRef = window.database.ref('scores');
  this.userSubmissionsRef = window.database.ref('userSubmissions');
}

// Client-side validation
FirebaseLeaderboardManager.prototype.validateSubmission = function (name, score, turns) {
  // Validate name
  if (!name || name.length < 1) {
    return { valid: false, message: 'Please enter your name!' };
  }
  if (name.length > 20) {
    return { valid: false, message: 'Name too long (max 20 characters)' };
  }

  // Sanitize name
  const sanitizedName = name.replace(/[^\w\s-]/g, '').trim();
  if (sanitizedName.length < 1) {
    return { valid: false, message: 'Invalid name characters' };
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

  return { valid: true, sanitizedName: sanitizedName };
};

// Validate game data integrity
FirebaseLeaderboardManager.prototype.validateGameData = function (score, turns, gameStart, grid, grids, timeStamps, scoreStamps) {
  const now = Date.now();
  const gameStartTime = new Date(gameStart).getTime();

  // Check if game start time is reasonable (not in future, not too old)
  if (gameStartTime > now || now - gameStartTime > 24 * 60 * 60 * 1000) {
    return { valid: false, message: 'Invalid game start time' };
  }

  // Check first move delay
  if (timeStamps && timeStamps.length > 1) {
    const firstMoveDelay = new Date(timeStamps[1]).getTime() - gameStartTime;
    if (firstMoveDelay > 60 * 60 * 1000) { // 60 minutes
      return { valid: false, message: 'Suspicious delay detected' };
    }
  }

  // Validate scoreStamps
  if (!scoreStamps || scoreStamps.length === 0) {
    return { valid: false, message: 'Missing score data' };
  }

  // Check if all scoreStamps are valid powers of 2 (multiplied tiles)
  for (let i = 0; i < scoreStamps.length; i++) {
    const value = scoreStamps[i];
    if (!Number.isInteger(Math.log2(value))) {
      return { valid: false, message: 'Invalid merge detected' };
    }
  }

  // Verify scoreStamps sum matches score
  const scoreStampsSum = scoreStamps.reduce((sum, val) => sum + val, 0);
  if (scoreStampsSum !== score) {
    return { valid: false, message: 'Score mismatch' };
  }

  // Check for impossible consecutive merge patterns
  let maxConsecutive = 1;
  let currentConsecutive = 1;
  for (let i = 1; i < scoreStamps.length; i++) {
    if (scoreStamps[i] === scoreStamps[i - 1]) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
    }
  }
  if (maxConsecutive > 50) {
    return { valid: false, message: 'Impossible merge pattern' };
  }

  // Validate grid data
  if (!grid || !grids || grids.length !== turns) {
    return { valid: false, message: 'Grid data mismatch' };
  }

  // Verify biggest tile count matches scoreStamps
  let biggestTile = 2;
  let expectedCount = 1;
  for (let i = 0; i < scoreStamps.length; i++) {
    if (scoreStamps[i] > biggestTile) {
      biggestTile = scoreStamps[i];
      expectedCount = 1;
    } else if (scoreStamps[i] === biggestTile) {
      expectedCount++;
    }
  }

  let actualCount = 0;
  if (grid && grid.cells) {
    for (let i = 0; i < grid.cells.length; i++) {
      for (let j = 0; j < grid.cells[i].length; j++) {
        if (grid.cells[i][j] && grid.cells[i][j].value === biggestTile) {
          actualCount++;
        }
      }
    }
  }

  if (actualCount !== expectedCount) {
    return { valid: false, message: 'Grid state mismatch' };
  }

  // Validate timestamps
  if (!timeStamps || timeStamps.length - 1 !== turns) {
    return { valid: false, message: 'Timestamp mismatch' };
  }



  // Check for suspicious score/time ratio
  const gameDuration = (now - gameStartTime) / 1000 / 60; // in minutes
  if (gameDuration < 10 && score > 50000) {
    return { valid: false, message: 'Score too high for game duration' };
  }

  return { valid: true };
};

// Check rate limiting using Firebase
FirebaseLeaderboardManager.prototype.checkRateLimit = function (callback) {
  const user = window.auth.currentUser;
  if (!user) {
    callback(new Error('Authentication required'), null);
    return;
  }

  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const userSubmissionsQuery = this.userSubmissionsRef
    .child(user.uid)
    .orderByChild('timestamp')
    .startAt(fiveMinutesAgo);

  userSubmissionsQuery.once('value', function (snapshot) {
    const recentCount = snapshot.numChildren();
    if (recentCount >= 3) {
      callback(new Error('Too many submissions. Please wait a few minutes.'), null);
    } else {
      callback(null, true);
    }
  }, function (error) {
    callback(error, null);
  });
};

// Submit a score to Firebase
FirebaseLeaderboardManager.prototype.submitScore = function (name, score, turns, gameStart, grid, grids, timeStamps, scoreStamps, callback) {
  const self = this;
  const user = window.auth.currentUser;

  if (!user) {
    setTimeout(function () {
      callback(new Error('Authentication required. Please refresh the page.'), null);
    }, 0);
    return;
  }

  // Validate submission
  const nameValidation = this.validateSubmission(name, score, turns);
  if (!nameValidation.valid) {
    setTimeout(function () {
      callback(new Error(nameValidation.message), null);
    }, 0);
    return;
  }

  // Validate game data
  const gameValidation = this.validateGameData(score, turns, gameStart, grid, grids, timeStamps, scoreStamps);
  if (!gameValidation.valid) {
    setTimeout(function () {
      callback(new Error(gameValidation.message), null);
    }, 0);
    return;
  }

  // Check rate limiting
  this.checkRateLimit(function (error, allowed) {
    if (error || !allowed) {
      callback(error || new Error('Rate limit exceeded'), null);
      return;
    }

    const timestamp = Date.now();
    const scoreData = {
      name: nameValidation.sanitizedName,
      score: score,
      turns: turns,
      timestamp: timestamp,
      gameStart: new Date(gameStart).getTime(),
      uid: user.uid,
      // Store user info if they're signed in with Google
      verified: !user.isAnonymous, // True if signed in with Google
      email: user.email || null,
      photoURL: user.photoURL || null,
      // Store validation data (but not full grids to save space)
      validation: {
        biggestTile: Math.max(...scoreStamps),
        totalMerges: scoreStamps.length,
        gameDuration: timestamp - new Date(gameStart).getTime()
      }
    };

    // Generate a unique key for this score
    const newScoreRef = self.scoresRef.push();

    // Use a transaction to ensure data consistency
    newScoreRef.set(scoreData, function (error) {
      if (error) {
        callback(error, null);
      } else {
        // Record this submission for rate limiting
        self.userSubmissionsRef.child(user.uid).push({
          timestamp: timestamp,
          score: score
        });

        // Clean up old rate limit records (older than 5 minutes)
        const fiveMinutesAgo = timestamp - (5 * 60 * 1000);
        self.userSubmissionsRef.child(user.uid)
          .orderByChild('timestamp')
          .endAt(fiveMinutesAgo)
          .once('value', function (snapshot) {
            snapshot.forEach(function (child) {
              child.ref.remove();
            });
          });

        callback(null, { status: 'success', key: newScoreRef.key });
      }
    });
  });
};

// Get the leaderboard (top 10 unique players)
FirebaseLeaderboardManager.prototype.getLeaderboard = function (callback) {
  // Get top 100 scores to ensure we have enough to filter duplicates
  this.scoresRef
    .orderByChild('score')
    .limitToLast(100)
    .once('value', function (snapshot) {
      const scores = [];
      snapshot.forEach(function (child) {
        scores.push(child.val());
      });

      // Reverse to get highest first
      scores.reverse();

      // Keep only best score per player (case-insensitive)
      const bestScores = {};
      scores.forEach(function (entry) {
        const nameLower = entry.name.toLowerCase();
        if (!bestScores[nameLower] || entry.score > bestScores[nameLower].score) {
          bestScores[nameLower] = entry;
        }
      });

      // Convert to array and get top 10
      const leaderboard = Object.values(bestScores)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      callback(null, leaderboard);
    }, function (error) {
      callback(error, null);
    });
};

// Get all scores (with pagination support)
FirebaseLeaderboardManager.prototype.getAllScores = function (callback) {
  this.scoresRef
    .orderByChild('score')
    .once('value', function (snapshot) {
      const scores = [];
      snapshot.forEach(function (child) {
        scores.push(child.val());
      });

      // Reverse to get highest first
      scores.reverse();

      callback(null, scores);
    }, function (error) {
      callback(error, null);
    });
};

// Listen for real-time leaderboard updates
FirebaseLeaderboardManager.prototype.onLeaderboardUpdate = function (callback) {
  this.scoresRef.on('child_added', function () {
    // Fetch updated leaderboard when new score is added
    callback();
  });
};

// Show leaderboard modal with Google Sign-In option
FirebaseLeaderboardManager.prototype.showLeaderboardModal = function (currentScore, turnCount, gameStart, grid, grids, timeStamps, scoreStamps) {
  var self = this;
  var user = window.auth.currentUser;

  var container = document.querySelector('.container');
  if (!container) {
    container = document.body;
  }

  // Check if user is signed in with Google
  var isGoogleUser = user && !user.isAnonymous;
  var suggestedName = isGoogleUser ? (user.displayName || user.email.split('@')[0]) : '';

  var googleSignInSection = '';
  if (!isGoogleUser) {
    googleSignInSection = `
      <div class="google-signin-section">
        <p class="signin-prompt">Want a verified checkmark? ✓</p>
        <button id="modal-google-signin" class="google-signin-button">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
          Sign in with Google
        </button>
        <p class="signin-note">Your score will be saved with verification</p>
      </div>
      <div class="divider"><span>OR</span></div>
    `;
  }

  var modalHTML = `
    <div class="leaderboard-overlay">
      <div class="leaderboard-modal leaderboard-modal-simple">
        <h2>Game Over!</h2>
        <p class="final-score">Your Score: <strong>${currentScore}</strong></p>
        <p class="turn-count">Moves: ${turnCount}</p>
        
        ${googleSignInSection}
        
        <div class="submit-score-section">
          <h3>Submit to Leaderboard</h3>
          <input type="text" id="player-name" placeholder="Enter your name" maxlength="20" value="${suggestedName}" />
          <button id="submit-score-btn">Submit Score${isGoogleUser ? ' (Verified ✓)' : ''}</button>
          <p class="submit-message" id="submit-message"></p>
        </div>
        
        <button class="close-modal-btn" id="close-leaderboard">Close</button>
      </div>
    </div>
  `;

  var modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHTML;
  container.appendChild(modalContainer);

  // Google Sign-In button handler
  if (!isGoogleUser) {
    var googleSignInBtn = document.getElementById('modal-google-signin');
    if (googleSignInBtn) {
      googleSignInBtn.addEventListener('click', function () {
        var messageEl = document.getElementById('submit-message');
        messageEl.textContent = 'Signing in with Google...';
        messageEl.style.color = '#776e65';

        signInWithGoogle(); // Defined in firebase_config.js

        // Wait for auth state change, then update the form (not the whole modal)
        var unsubscribe = window.auth.onAuthStateChanged(function (newUser) {
          if (newUser && !newUser.isAnonymous) {
            // Update just the form, not recreate the modal
            var nameInput = document.getElementById('player-name');
            var submitBtn = document.getElementById('submit-score-btn');
            var googleSection = document.querySelector('.google-signin-section');
            var divider = document.querySelector('.divider');

            // Remove Google sign-in section and divider
            if (googleSection) googleSection.remove();
            if (divider) divider.remove();

            // Update name input with Google account name
            if (nameInput) {
              nameInput.value = newUser.displayName || newUser.email.split('@')[0];
            }

            // Update submit button text
            if (submitBtn) {
              submitBtn.textContent = 'Submit Score (Verified ✓)';
            }

            // Update message
            messageEl.textContent = 'Signed in with Google! ✓';
            messageEl.style.color = '#a0d468';

            unsubscribe(); // Stop listening
          }
        });
      });
    }
  }

  var nameInput = document.getElementById('player-name');
  nameInput.addEventListener('keydown', function (e) {
    e.stopPropagation();
  });

  nameInput.addEventListener('keyup', function (e) {
    e.stopPropagation();
  });

  nameInput.addEventListener('keypress', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      document.getElementById('submit-score-btn').click();
    }
  });

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
        var verifiedText = (window.auth.currentUser && !window.auth.currentUser.isAnonymous) ? ' (Verified ✓)' : '';
        messageEl.textContent = 'Score submitted successfully!' + verifiedText;
        messageEl.style.color = '#a0d468';

        setTimeout(function () {
          self.updatePermanentLeaderboard();
        }, 500);

        document.getElementById('player-name').disabled = true;
        document.getElementById('submit-score-btn').disabled = true;
      }
    });
  });

  document.getElementById('close-leaderboard').addEventListener('click', function () {
    modalContainer.remove();
  });

  nameInput.focus();
};

// Create permanent leaderboard display
FirebaseLeaderboardManager.prototype.createPermanentLeaderboard = function () {
  var self = this;

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

  var container = document.querySelector('.container');
  if (!container) {
    container = document.body;
  }

  var leaderboardDiv = document.createElement('div');
  leaderboardDiv.innerHTML = leaderboardHTML;
  container.appendChild(leaderboardDiv);

  this.updatePermanentLeaderboard();

  document.getElementById('refresh-leaderboard').addEventListener('click', function () {
    self.updatePermanentLeaderboard();
  });

  document.getElementById('view-all-scores').addEventListener('click', function () {
    self.showAllScoresModal();
  });

  // Listen for real-time updates
  this.onLeaderboardUpdate(function () {
    self.updatePermanentLeaderboard();
  });
};

// Update permanent leaderboard display
FirebaseLeaderboardManager.prototype.updatePermanentLeaderboard = function () {
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

      var formattedDate = '';
      if (entry.timestamp) {
        var date = new Date(entry.timestamp);
        formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      // Add verified badge for Google users
      var verifiedBadge = entry.verified ? ' <span class="verified-badge" title="Verified with Google">✓</span>' : '';

      html += `
        <li>
          <span class="rank">${medal}</span>
          <span class="player-name">${entry.name}${verifiedBadge}</span>
          <span class="player-score">${entry.score}</span>
          <span class="player-timestamp">${formattedDate}</span>
        </li>
      `;
    });
    html += '</ol>';

    listEl.innerHTML = html;
  });
};

// Show all scores modal
FirebaseLeaderboardManager.prototype.showAllScoresModal = function () {
  var self = this;
  var currentPage = 1;
  var itemsPerPage = 20;
  var allScores = [];
  var sortMode = 'score';

  var modalHTML = `
    <div class="leaderboard-overlay">
      <div class="leaderboard-modal all-scores-modal">
        <h2>All Scores</h2>
        
        <div class="filter-controls">
          <button class="filter-btn active" data-sort="score">Highest Score</button>
          <button class="filter-btn" data-sort="recent">Most Recent</button>
          <button class="filter-btn" data-sort="verified">Verified Only</button>
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

  var modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHTML;
  document.body.appendChild(modalContainer);

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

  function renderScores() {
    var sortedScores = allScores.slice();

    var bestScores = {};
    sortedScores.forEach(function (entry) {
      var name = entry.name.toLowerCase();
      if (!bestScores[name] || entry.score > bestScores[name].score) {
        bestScores[name] = entry;
      }
    });

    var uniqueScores = Object.values(bestScores);

    // Filter verified if needed
    if (sortMode === 'verified') {
      uniqueScores = uniqueScores.filter(function (entry) {
        return entry.verified === true;
      });
    }

    if (sortMode === 'score' || sortMode === 'verified') {
      uniqueScores.sort(function (a, b) { return b.score - a.score; });
    } else {
      uniqueScores.sort(function (a, b) {
        return b.timestamp - a.timestamp;
      });
    }

    var totalPages = Math.ceil(uniqueScores.length / itemsPerPage);
    var startIndex = (currentPage - 1) * itemsPerPage;
    var endIndex = startIndex + itemsPerPage;
    var pageScores = uniqueScores.slice(startIndex, endIndex);

    var html = '<ol class="all-scores-entries" start="' + (startIndex + 1) + '">';
    pageScores.forEach(function (entry) {
      var formattedDate = '';
      if (entry.timestamp) {
        var date = new Date(entry.timestamp);
        formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      var verifiedBadge = entry.verified ? ' <span class="verified-badge" title="Verified with Google">✓</span>' : '';

      html += `
        <li>
          <span class="player-info">
            <span class="player-name">${entry.name}${verifiedBadge}</span>
            <span class="player-timestamp">${formattedDate}</span>
          </span>
          <span class="player-score">${entry.score}</span>
        </li>
      `;
    });
    html += '</ol>';

    document.getElementById('all-scores-list').innerHTML = html;

    document.getElementById('page-info').textContent = 'Page ' + currentPage + ' of ' + (totalPages || 1);
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === totalPages || totalPages === 0;
  }

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

  document.getElementById('close-all-scores').addEventListener('click', function () {
    modalContainer.remove();
  });

  loadScores();
};