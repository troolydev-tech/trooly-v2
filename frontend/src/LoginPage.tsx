import { supabase } from './lib/supabase';

/**
 * Simple centered sign-in screen. One button — Google OAuth. Supabase handles
 * the redirect dance; when the user returns from Google, they land back here
 * with a session, and the AuthContext picks it up automatically.
 */
export function LoginPage() {
  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/campaigns',
      },
    });
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Trooly</p>
        <h1>Sign in to continue</h1>
        <p className="login-sub">Personalised outreach, grounded in real research.</p>

        <button type="button" className="google-btn" onClick={handleGoogleSignIn}>
          <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: '0.6rem' }}>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 34.9 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.5 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.2 5.2c-.4.4 6.6-4.8 6.6-14.9 0-1.3-.1-2.3-.4-3.5z"/>
          </svg>
          Continue with Google
        </button>

        <p className="login-fine-print">
          By continuing, you agree to Trooly's terms of use.
        </p>
      </div>
    </div>
  );
}