export type UserRole = 'owner' | 'dealer' | 'mechanic' | 'bank' | 'insurance' | 'government' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatar?: string;
  active_tenant_id?: string | null;
}

export interface Vehicle {
  vin: string;
  make: string;
  model: string;
  generation?: string;
  trim?: string;
  year: number;
  color?: string;
  mileage: number;
  fuel_type?: string;
  drivetrain?: string;
  transmission?: string;
  import_source?: string;
  duty_paid: boolean;
  police_verified: boolean;
  status: 'Available' | 'Reserved' | 'Sold' | 'Archived';
  trust_score: number;
  price: number;
  currency: string;
  created_at?: string;
}

export interface Escrow {
  id: string;
  vin: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  currency: string;
  status: 'Pending' | 'Escrowed' | 'Inspecting' | 'Completed' | 'Disputed' | 'Refunded';
  fee_split_zimra: number;
  fee_split_escrow: number;
  current_stage: number;
  dispute_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  type: 'dealership' | 'garage' | 'insurance' | 'bank' | 'fleet' | 'import' | 'government';
  created_at: string;
  status: 'active' | 'suspended';
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface ServiceRecord {
  id: string;
  vin: string;
  mechanic_id: string;
  part_name: string;
  part_oem?: string;
  action_type: 'Replaced' | 'Repaired' | 'Inspected' | 'Diagnosed';
  description?: string;
  mileage: number;
  signature: string;
  timestamp: string;
}
