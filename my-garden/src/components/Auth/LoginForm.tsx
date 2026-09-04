// src/components/Auth/LoginForm.tsx

import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface LoginFormProps {
  onAuthSuccess?: () => void;
}

type Mode = 'login' | 'signup' | 'forgot';

export function LoginForm({ onAuthSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('login');
  const [resetSent, setResetSent] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const { login, signup, requestPasswordReset, loading, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'forgot') {
      setSendingReset(true);
      try {
        await requestPasswordReset(email);
        setResetSent(true);
      } catch {
        // Error is handled by useAuth and displayed below
      } finally {
        setSendingReset(false);
      }
      return;
    }
    try {
      if (mode === 'signup') {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      onAuthSuccess?.();
    } catch (err) {
      // Error is handled by useAuth and displayed below
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setResetSent(false);
    setPassword('');
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold text-center text-green-700 mb-2">
          🌱 Garden App
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Grow, track, and care for your plants
        </p>

        {mode === 'forgot' && resetSent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              If an account exists for <strong>{email}</strong>, a password reset link is on its
              way. Check your email (and spam folder) and open it on this device.
            </div>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-2 px-4 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
            >
              Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs font-medium text-green-600 hover:text-green-700"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={mode === 'forgot' ? sendingReset : loading}
              className="w-full py-2 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {mode === 'forgot'
                ? sendingReset
                  ? 'Sending...'
                  : 'Send reset link'
                : loading
                  ? 'Loading...'
                  : mode === 'signup'
                    ? 'Sign Up'
                    : 'Log In'}
            </button>

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Back to log in
              </button>
            )}
          </form>
        )}

        {mode !== 'forgot' && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
              className="text-sm text-green-600 hover:text-green-700 font-medium"
            >
              {mode === 'signup' ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
