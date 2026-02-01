// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  var leaderboard = new LeaderboardManager('https://script.google.com/macros/s/AKfycbw5MCKtkyy5iWIKQbx6AyYy7Gno4HTZjOraOmDVW00lD7AkkAcTSGdfk5F4bRuNndgJ/exec');
  window.gameLeaderboard = leaderboard;
  leaderboard.createPermanentLeaderboard();

});
