import { FormEvent, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { sendOtp, verifyOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await sendOtp(email);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setStep('code');
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await verifyOtp(email, token);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-brand-600 mb-1 text-center">CRM</h1>
        <p className="text-slate-500 text-sm text-center mb-6">התחברות למערכת</p>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="email">
                כתובת אימייל
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="name@company.co.il"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg py-2 transition disabled:opacity-50"
            >
              {submitting ? 'שולח קוד...' : 'שלחו לי קוד אימות'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-slate-600">שלחנו קוד בן 6 ספרות לכתובת {email}</p>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="token">
                קוד אימות
              </label>
              <input
                id="token"
                type="text"
                inputMode="numeric"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="000000"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg py-2 transition disabled:opacity-50"
            >
              {submitting ? 'מאמת...' : 'התחברות'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="w-full text-sm text-slate-500 hover:text-slate-700"
            >
              חזרה
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
