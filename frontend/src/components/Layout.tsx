import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/', label: 'דשבורד', end: true },
  { to: '/companies', label: 'חברות' },
];

export default function Layout() {
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 bg-brand-600 text-white flex flex-col">
        <div className="px-6 py-5 text-xl font-bold border-b border-white/10">CRM</div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-white/15' : 'hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10 text-sm">
          <div className="font-medium">{profile?.full_name ?? '...'}</div>
          <div className="text-white/60 text-xs mb-2">
            {profile?.role === 'admin' ? 'מנהלת מערכת' : 'נציגה'}
          </div>
          <button onClick={() => signOut()} className="text-white/80 hover:text-white text-xs underline">
            התנתקות
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
