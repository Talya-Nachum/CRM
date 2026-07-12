-- שלב 1: תשתית בסיס - טבלאות, הרשאות (RLS) לפי תפקיד, וחיבור משתמשים.
-- הרצה: Supabase Dashboard -> SQL Editor -> להדביק את כל הקובץ -> Run.

-- ========================================
-- פרופילי משתמשים ותפקידים (Admin / נציגה)
-- ========================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'rep' check (role in ('admin', 'rep')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- כל משתמש רואה את כל הפרופילים (כדי לדעת מי הנציגות בצוות, לתפריטי שיוך וכו')
create policy "profiles_select_all" on profiles for select
  to authenticated using (true);

-- משתמש יכול לעדכן רק את עצמו; רק אדמין יכול לשנות תפקיד (role) של אחרים
create policy "profiles_update_self" on profiles for update
  to authenticated using (auth.uid() = id);

-- פונקציית עזר: האם המשתמש הנוכחי הוא Admin
create function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- יצירת פרופיל אוטומטית כשמשתמש חדש נרשם (ברירת מחדל: נציגה)
create function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'rep');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ========================================
-- טריגר עזר כללי לעדכון updated_at
-- ========================================

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ========================================
-- קמפיינים (שלד בסיסי - יורחב בשלב 2)
-- ========================================

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table campaigns enable row level security;

create policy "campaigns_select_all" on campaigns for select
  to authenticated using (true);

create policy "campaigns_write_admin" on campaigns for all
  to authenticated using (is_admin()) with check (is_admin());

-- ========================================
-- חברות (הישות המרכזית, מפתח = ח"פ)
-- ========================================

create table companies (
  id uuid primary key default gen_random_uuid(),
  company_number text not null unique,        -- ח"פ
  name text not null,                          -- שם חברה
  industry text,                                -- ענף
  city text,                                    -- עיר
  full_address text,                            -- כתובת מלאה
  phone_primary text,                           -- טלפון ראשי
  phone_secondary text,                         -- טלפון נוסף
  website text,                                 -- אתר אינטרנט
  region text,                                  -- אזור גאוגרפי
  notes text,                                   -- הערות
  campaign_exclusion_tag text,                  -- תג להחרגת קמפיינים
  user_count integer,                           -- מספר משתמשים
  employee_count integer,                       -- מספר עובדים
  revenue numeric,                              -- מחזור חברה
  assigned_rep_id uuid references profiles(id), -- נציגה אחראית
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

alter table companies enable row level security;

-- כל נציגה רואה את כל החברות (היסטוריית צוות מלאה)
create policy "companies_select_all" on companies for select
  to authenticated using (true);

-- עריכה/הוספה/מחיקה: רק Admin, או נציגה על חברה ששויכה אליה
create policy "companies_write_owner_or_admin" on companies for all
  to authenticated
  using (is_admin() or assigned_rep_id = auth.uid())
  with check (is_admin() or assigned_rep_id = auth.uid());

create index companies_company_number_idx on companies (company_number);
create index companies_assigned_rep_idx on companies (assigned_rep_id);

-- ========================================
-- אנשי קשר (משויכים לחברה)
-- ========================================

create table contacts (
  id uuid primary key default gen_random_uuid(),
  contact_code text not null unique,   -- קוד איש קשר ייחודי
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,             -- שם איש קשר
  role_title text,                     -- תפקיד
  gender text check (gender in ('male', 'female')),
  phone text,                          -- טלפון
  phone_secretary text,                -- טלפון מזכירה
  mobile text,                         -- טלפון נייד
  email text,                          -- אימייל
  address text,                        -- כתובת
  city text,                           -- עיר
  notes text,                          -- הערות
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table contacts enable row level security;

create policy "contacts_select_all" on contacts for select
  to authenticated using (true);

-- עריכה מותרת רק אם הנציגה אחראית על החברה שאליה איש הקשר משויך (או Admin)
create policy "contacts_write_owner_or_admin" on contacts for all
  to authenticated
  using (
    is_admin() or exists (
      select 1 from companies
      where companies.id = contacts.company_id
      and companies.assigned_rep_id = auth.uid()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from companies
      where companies.id = contacts.company_id
      and companies.assigned_rep_id = auth.uid()
    )
  );

create index contacts_company_id_idx on contacts (company_id);

-- ========================================
-- היסטוריית התקשרויות (תיעוד כל פנייה לחברה)
-- ========================================

create table interaction_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id),
  rep_id uuid references profiles(id),
  interaction_type text,   -- שיחה / מייל / וואטסאפ / פגישה / אחר
  status text,             -- סטטוס (כולל סטטוסים של "פגישה")
  notes text,
  occurred_at timestamptz not null default now()
);

alter table interaction_history enable row level security;

create policy "interactions_select_all" on interaction_history for select
  to authenticated using (true);

create policy "interactions_write_owner_or_admin" on interaction_history for all
  to authenticated
  using (
    is_admin() or exists (
      select 1 from companies
      where companies.id = interaction_history.company_id
      and companies.assigned_rep_id = auth.uid()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from companies
      where companies.id = interaction_history.company_id
      and companies.assigned_rep_id = auth.uid()
    )
  );

create index interaction_history_company_id_idx on interaction_history (company_id);
