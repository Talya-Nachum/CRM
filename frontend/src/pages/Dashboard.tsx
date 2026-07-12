import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

interface Stats {
  totalCompanies: number;
  myCompanies: number;
  totalContacts: number;
}

export default function Dashboard() {
  const { profile, session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      const [{ count: totalCompanies, error: err1 }, { count: myCompanies, error: err2 }, { count: totalContacts, error: err3 }] =
        await Promise.all([
          supabase.from('companies').select('*', { count: 'exact', head: true }),
          supabase
            .from('companies')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_rep_id', session?.user.id ?? ''),
          supabase.from('contacts').select('*', { count: 'exact', head: true }),
        ]);

      const firstError = err1 ?? err2 ?? err3;
      if (firstError) {
        setError(firstError.message);
        return;
      }

      setStats({
        totalCompanies: totalCompanies ?? 0,
        myCompanies: myCompanies ?? 0,
        totalContacts: totalContacts ?? 0,
      });
    }
    if (session) loadStats();
  }, [session]);

  const cards = [
    { label: 'סה"כ חברות במערכת', value: stats?.totalCompanies, color: 'bg-brand-500' },
    { label: 'חברות שלי', value: stats?.myCompanies, color: 'bg-emerald-500' },
    { label: 'סה"כ אנשי קשר', value: stats?.totalContacts, color: 'bg-amber-500' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">שלום, {profile?.full_name ?? ''} 👋</h1>
      <p className="text-slate-500 mb-6">סקירה כללית של המערכת</p>

      {error && <p className="text-red-600 text-sm mb-4">שגיאה בטעינת נתונים: {error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl overflow-hidden shadow-sm border border-slate-200 bg-white">
            <div className={`h-1.5 ${card.color}`} />
            <div className="p-5">
              <div className="text-3xl font-bold">{card.value ?? '—'}</div>
              <div className="text-slate-500 text-sm mt-1">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-6 text-slate-400 text-sm">
        כאן יופיעו בהמשך: יומן/משימות, גרפי יעד יומי וחודשי, סידור עבודה שבועי (שלב 2).
      </div>
    </div>
  );
}
