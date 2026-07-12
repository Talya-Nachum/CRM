import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import type { Company } from '../types/database';

const PAGE_SIZE = 50;

export default function Companies() {
  const { session } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCompanyNumber, setNewCompanyNumber] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  async function loadCompanies(query: string) {
    setLoading(true);
    setError(null);
    let request = supabase.from('companies').select('*').order('name').limit(PAGE_SIZE);
    if (query.trim()) {
      request = request.or(`name.ilike.%${query}%,company_number.ilike.%${query}%`);
    }
    const { data, error } = await request;
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCompanies((data ?? []) as Company[]);
  }

  useEffect(() => {
    loadCompanies('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    loadCompanies(search);
  }

  async function handleAddCompany(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    const { error } = await supabase.from('companies').insert({
      company_number: newCompanyNumber.trim(),
      name: newCompanyName.trim(),
      assigned_rep_id: session?.user.id,
    });
    if (error) {
      setAddError(error.message);
      return;
    }
    setNewCompanyNumber('');
    setNewCompanyName('');
    setShowAddForm(false);
    loadCompanies(search);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">חברות</h1>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          {showAddForm ? 'ביטול' : '+ חברה חדשה'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddCompany} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-slate-500 mb-1">ח"פ</label>
            <input
              required
              value={newCompanyNumber}
              onChange={(e) => setNewCompanyNumber(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">שם חברה</label>
            <input
              required
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg px-4 py-2">
            שמירה
          </button>
          {addError && <p className="text-sm text-red-600 w-full">{addError}</p>}
        </form>
      )}

      <form onSubmit={handleSearchSubmit} className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם חברה או ח&quot;פ..."
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg px-4 py-2">
          חיפוש
        </button>
      </form>

      {error && <p className="text-red-600 text-sm mb-4">שגיאה: {error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">שם חברה</th>
              <th className="px-4 py-3 font-medium">ח"פ</th>
              <th className="px-4 py-3 font-medium">ענף</th>
              <th className="px-4 py-3 font-medium">עיר</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/companies/${company.id}`} className="text-brand-600 font-medium hover:underline">
                    {company.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{company.company_number}</td>
                <td className="px-4 py-3 text-slate-500">{company.industry ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{company.city ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && companies.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">לא נמצאו חברות</p>
        )}
        {loading && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
      </div>
    </div>
  );
}
