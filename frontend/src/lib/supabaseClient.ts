import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    'חסרים משתני הסביבה VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - יש להעתיק את .env.example ל-.env.local ולמלא אותם.'
  );
}

// כתובת placeholder תקינה מבחינת פורמט, כדי שהאפליקציה לא תקרוס לפני שהוגדרו משתני הסביבה האמיתיים
export const supabase = createClient(supabaseUrl ?? 'https://placeholder.supabase.co', supabaseAnonKey ?? 'placeholder-anon-key');
