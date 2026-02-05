const firebaseConfig = {
  apiKey: "AIzaSyBEUEKrOEBm3RjxIPdk25zNfkqZHYXMCWA",
  authDomain: "getmo-79b09.firebaseapp.com",
  databaseURL: "https://getmo-79b09-default-rtdb.firebaseio.com",
  projectId: "getmo-79b09",
  storageBucket: "getmo-79b09.firebasestorage.app",
  messagingSenderId: "567309235300",
  appId: "1:567309235300:web:5259a832d651d3362b5b71",
  measurementId: "G-R3DCF9PDEB"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get references to Firebase services - make them global
window.database = firebase.database();
window.auth = firebase.auth();

// Track Firebase ready state
window.firebaseReady = false;
window.firebaseUser = null;

// Google Sign-In Provider
window.googleProvider = new firebase.auth.GoogleAuthProvider();

// Check if user is already signed in
window.auth.onAuthStateChanged(function (user) {
  if (user) {
    // User is signed in
    window.firebaseUser = user;
    window.firebaseReady = true;
    console.log("User signed in:", user.isAnonymous ? "Anonymous" : user.email);

    // Trigger custom event when Firebase is ready
    window.dispatchEvent(new Event('firebaseReady'));

    // Update UI to show user status
    updateAuthUI(user);
  } else {
    // No user signed in - sign in anonymously as fallback
    window.auth.signInAnonymously()
      .then(function () {
        console.log("Signed in anonymously");
      })
      .catch(function (error) {
        console.error("Firebase auth error:", error);
      });
  }
});

// Update UI based on auth state
function updateAuthUI(user) {
  const authContainer = document.getElementById('auth-container');
  if (!authContainer) return;

  if (user.isAnonymous) {
    // Show sign-in button for anonymous users
    authContainer.innerHTML = `
      <button id="google-signin-btn" class="auth-button">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
        Sign in with Google
      </button>
    `;

    document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
  } else {
    // Show user info for signed-in users
    const displayName = user.displayName || user.email;
    const photoURL = user.photoURL || 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/anonymous.png';

    authContainer.innerHTML = `
      <div class="user-info">
        <img src="${photoURL}" alt="Profile" class="user-photo" />
        <span class="user-name">${displayName}</span>
        <button id="signout-btn" class="signout-button">Sign Out</button>
      </div>
    `;

    document.getElementById('signout-btn').addEventListener('click', signOut);
  }
}

// Sign in with Google
function signInWithGoogle() {
  // Check if user has anonymous data to preserve
  const currentUser = window.auth.currentUser;

  if (currentUser && currentUser.isAnonymous) {
    // Link anonymous account with Google account to preserve data
    currentUser.linkWithPopup(window.googleProvider)
      .then(function (result) {
        console.log("Anonymous account linked with Google:", result.user.email);
        window.firebaseUser = result.user;
        updateAuthUI(result.user);
      })
      .catch(function (error) {
        console.error("Error linking accounts:", error);

        // If linking fails (user already exists), just sign in normally
        if (error.code === 'auth/credential-already-in-use') {
          window.auth.signInWithPopup(window.googleProvider)
            .then(function (result) {
              console.log("Signed in with Google:", result.user.email);
              window.firebaseUser = result.user;
              updateAuthUI(result.user);
            })
            .catch(function (error) {
              console.error("Google sign-in error:", error);
              alert("Failed to sign in with Google. Please try again.");
            });
        } else {
          alert("Failed to link accounts. Please try again.");
        }
      });
  } else {
    // No anonymous account, just sign in
    window.auth.signInWithPopup(window.googleProvider)
      .then(function (result) {
        console.log("Signed in with Google:", result.user.email);
        window.firebaseUser = result.user;
        updateAuthUI(result.user);
      })
      .catch(function (error) {
        console.error("Google sign-in error:", error);
        alert("Failed to sign in with Google. Please try again.");
      });
  }
}

// Sign out
function signOut() {
  window.auth.signOut()
    .then(function () {
      console.log("Signed out successfully");
      // Will automatically sign in anonymously via onAuthStateChanged
    })
    .catch(function (error) {
      console.error("Sign out error:", error);
    });
}