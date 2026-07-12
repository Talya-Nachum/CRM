export type UserRole = 'admin' | 'rep';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Company {
  id: string;
  company_number: string;
  name: string;
  industry: string | null;
  city: string | null;
  full_address: string | null;
  phone_primary: string | null;
  phone_secondary: string | null;
  website: string | null;
  region: string | null;
  notes: string | null;
  campaign_exclusion_tag: string | null;
  user_count: number | null;
  employee_count: number | null;
  revenue: number | null;
  assigned_rep_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  contact_code: string;
  company_id: string;
  full_name: string;
  role_title: string | null;
  gender: 'male' | 'female' | null;
  phone: string | null;
  phone_secretary: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface InteractionHistory {
  id: string;
  company_id: string;
  contact_id: string | null;
  rep_id: string | null;
  interaction_type: string | null;
  status: string | null;
  notes: string | null;
  occurred_at: string;
}
