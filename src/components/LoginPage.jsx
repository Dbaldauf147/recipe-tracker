import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import styles from './LoginPage.module.css';

const FEATURES = [
  { icon: '🍽', title: 'Weekly Meal Planning', text: 'Drag-and-drop meals onto your weekly calendar' },
  { icon: '🥗', title: 'Nutrition Tracking', text: 'Set daily goals and track every macro and micro' },
  { icon: '🛒', title: 'Smart Shopping Lists', text: 'Auto-generated, grouped by grocery aisle' },
  { icon: '📲', title: 'Recipe Import', text: 'Grab recipes from any URL, TikTok, or Instagram' },
];

export function LoginPage() {
  const { signInWithGoogle, signInWithFacebook, signInWithApple, signUpWithEmail, signInWithEmail, resetPassword, continueAsGuest, authError } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showGuestWarning, setShowGuestWarning] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (showForgot) {
      const ok = await resetPassword(email);
      if (ok) setResetSent(true);
      return;
    }
    await signInWithEmail(email, password);
  }

  return (
    <div className={styles.page}>
      <div className={styles.logoBadge}>Prep Day</div>

      {/* Left: branding + features */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            Your meals,{' '}
            <span className={styles.heroTitleAccent}>planned.</span>
          </h1>
          <p className={styles.heroTagline}>
            Prep Day helps you plan meals, track nutrition, and shop smarter — all in one place.
          </p>
          <ul className={styles.featureList}>
            {FEATURES.map((f, i) => (
              <li key={i} className={styles.featureItem}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <div className={styles.featureContent}>
                  <span className={styles.featureTitle}>{f.title}</span>
                  <span className={styles.featureText}>{f.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right: sign-in card */}
      <div className={styles.formSide}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>
            {showForgot ? 'Reset Password' : 'Sign in'}
          </h2>
          {authError && !showSignUpModal && <p className={styles.error}>{authError}</p>}
          {resetSent && <p className={styles.success}>Password reset email sent! Check your inbox.</p>}
          <form className={styles.form} onSubmit={handleSubmit}>
            <input
              className={styles.input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              name="email"
            />
            {!showForgot && (
              <div className={styles.passwordWrap}>
                <input
                  className={styles.input}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  name="password"
                />
                <button
                  type="button"
                  className={styles.showPasswordBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            )}
            <button className={styles.submitBtn} type="submit">
              {showForgot ? 'Send Reset Email' : 'Sign in'}
            </button>
          </form>
          {!showForgot && !isSignUp && (
            <p className={styles.forgotLink}>
              <a href="#" onClick={(e) => { e.preventDefault(); setShowForgot(true); setResetSent(false); }}>
                Forgot password?
              </a>
            </p>
          )}
          <p className={styles.toggleLink}>
            {showForgot ? (
              <a href="#" onClick={(e) => { e.preventDefault(); setShowForgot(false); setResetSent(false); }}>
                Back to sign in
              </a>
            ) : (
              <>
                {"Don't have an account?"}{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setShowSignUpModal(true); }}>
                  Sign up
                </a>
              </>
            )}
          </p>
          <div className={styles.divider}><span>or</span></div>
          <div className={styles.socialBtns}>
            <button className={styles.googleBtn} onClick={signInWithGoogle}>
              <svg className={styles.socialIcon} viewBox="0 0 24 24" width="20" height="20">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
            <button className={styles.appleBtn} onClick={signInWithApple}>
              <svg className={styles.socialIcon} viewBox="0 0 24 24" width="20" height="20">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" fill="#fff"/>
              </svg>
              Sign in with Apple
            </button>
            <button className={styles.facebookBtn} onClick={signInWithFacebook}>
              <svg className={styles.socialIcon} viewBox="0 0 24 24" width="20" height="20">
                <path d="M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#fff"/>
              </svg>
              Sign in with Facebook
            </button>
          </div>
          <button className={styles.guestBtn} onClick={() => setShowGuestWarning(true)}>
            Continue without signing in
          </button>
        </div>
      </div>

      {showSignUpModal && (
        <div className={styles.overlay} onClick={() => setShowSignUpModal(false)}>
          <div className={styles.signUpModal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.signUpModalClose} onClick={() => setShowSignUpModal(false)}>&times;</button>
            <h2 className={styles.signUpModalTitle}>Create an account</h2>
            <p className={styles.signUpModalSubtitle}>Start planning meals and tracking nutrition</p>
            {authError && <p className={styles.error}>{authError}</p>}
            <form className={styles.form} onSubmit={async (e) => {
              e.preventDefault();
              await signUpWithEmail(email, password, name);
            }}>
              <input
                className={styles.input}
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <input
                className={styles.input}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <input
                className={styles.input}
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button className={styles.submitBtn} type="submit">
                Create Account
              </button>
            </form>
            <p className={styles.toggleLink}>
              Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setShowSignUpModal(false); }}>
                Sign in
              </a>
            </p>
          </div>
        </div>
      )}

      {showGuestWarning && (
        <div className={styles.overlay} onClick={() => setShowGuestWarning(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalWarning}>Your recipes and data will not be saved if you don't sign in.</p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setShowGuestWarning(false)}>
                Go back
              </button>
              <button className={styles.modalConfirm} onClick={continueAsGuest}>
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
