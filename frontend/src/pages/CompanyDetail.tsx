import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import type { Company, Contact, InteractionHistory } from '../types/database';

const FIELD_LABELS: { key: keyof Company; label: string }[] = [
  { key: 'industry', label: 'ענף' },
  { key: 'city', label: 'עיר' },
  { key: 'full_address', label: 'כתובת מלאה' },
  { key: 'phone_primary', label: 'טלפון ראשי' },
  { key: 'phone_secondary', label: 'טלפון נוסף' },
  { key: 'website', label: 'אתר אינטרנט' },
  { key: 'region', label: 'אזור גאוגרפי' },
  { key: 'employee_count', label: 'מספר עובדים' },
  { key: 'user_count', label: 'מספר משתמשים' },
  { key: 'revenue', label: 'מחזור חברה' },
  { key: 'campaign_exclusion_tag', label: 'תג החרגת קמפיינים' },
];

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [history, setHistory] = useState<InteractionHistory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      const [{ data: companyData, error: companyErr }, { data: contactsData }, { data: historyData }] = await Promise.all([
        supabase.from('companies').select('*').eq('id', id).single(),
        supabase.from('contacts').select('*').eq('company_id', id).order('full_name'),
        supabase.from('interaction_history').select('*').eq('company_id', id).order('occurred_at', { ascending: false }),
      ]);

      if (companyErr) {
        setError(companyErr.message);
        return;
      }
      setCompany(companyData as Company);
      setContacts((contactsData ?? []) as Contact[]);
      setHistory((historyData ?? []) as InteractionHistory[]);
    }
    load();
  }, [id]);

  if (error) return <p className="text-red-600 text-sm">שגיאה: {error}</p>;
  if (!company) return <p className="text-slate-400 text-sm">טוען...</p>;

  return (
    <div>
      <Link to="/companies" className="text-sm text-brand-600 hover:underline">
        ← חזרה לרשימת חברות
      </Link>

      <div className="mt-3 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <p className="text-slate-500 text-sm">ח"פ {company.company_number}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold mb-4">פרטי חברה</h2>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            {FIELD_LABELS.map(({ key, label }) => (
              <div key={key}>
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-medium">{(company[key] as string | number | null) ?? '—'}</dd>
              </div>
            ))}
          </dl>
          {company.notes && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <dt className="text-slate-400 text-sm mb-1">הערות</dt>
              <dd className="text-sm">{company.notes}</dd>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold mb-4">אנשי קשר ({contacts.length})</h2>
          <ul className="space-y-3">
            {contacts.map((contact) => (
              <li key={contact.id} className="border border-slate-100 rounded-lg p-3">
                <div className="font-medium text-sm">{contact.full_name}</div>
                {contact.role_title && <div className="text-xs text-slate-500">{contact.role_title}</div>}
                {contact.phone && <div className="text-xs text-slate-500">{contact.phone}</div>}
                {contact.email && <div className="text-xs text-slate-500">{contact.email}</div>}
              </li>
            ))}
            {contacts.length === 0 && <p className="text-slate-400 text-sm">אין עדיין אנשי קשר</p>}
          </ul>
        </section>
      </div>

      <section className="mt-6 bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold mb-4">היסטוריית התקשרויות</h2>
        <ul className="space-y-2">
          {history.map((item) => (
            <li key={item.id} className="text-sm border-b border-slate-100 pb-2 last:border-0">
              <span className="text-slate-400">{new Date(item.occurred_at).toLocaleDateString('he-IL')}</span>{' '}
              <span className="font-medium">{item.interaction_type ?? 'פעילות'}</span>
              {item.status && <span className="text-slate-500"> - {item.status}</span>}
              {item.notes && <p className="text-slate-500 mt-0.5">{item.notes}</p>}
            </li>
          ))}
          {history.length === 0 && <p className="text-slate-400 text-sm">אין עדיין תיעוד פניות</p>}
        </ul>
      </section>
    </div>
  );
}
