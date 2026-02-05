// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  
  // Function to initialize leaderboard
  function initializeLeaderboard() {
    var leaderboard = new FirebaseLeaderboardManager();
    window.gameLeaderboard = leaderboard;
    leaderboard.createPermanentLeaderboard();
  }
  
  // Wait for Firebase to be ready before creating leaderboard
  if (window.firebaseReady) {
    // Firebase is already ready
    initializeLeaderboard();
  } else {
    // Wait for Firebase ready event
    window.addEventListener('firebaseReady', function() {
      initializeLeaderboard();
    });
  }
});