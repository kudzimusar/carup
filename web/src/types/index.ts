import type { 
  AuthUser as SharedAuthUser, 
  Vehicle as SharedVehicle,
  Escrow as SharedEscrow,
  Notification as SharedNotification
} from '@shared/types';
// 1. User
export interface User extends SharedAuthUser {
  status?: 'active' | 'suspended';
  created_at?: string;
  joined?: string;
}

export interface Vehicle extends Omit<SharedVehicle, 'status'> {
  id?: string;
  location?: string;
  image_url?: string;
  images?: string[];
  condition?: string;
  category?: string;
  viewCount?: number;
  trustScore?: number;
  isVerified?: boolean;
  insurance_records?: InsuranceRecord[];
  service_history?: ServiceRecord[];
  service_records?: ServiceRecord[];
  escrows?: Escrow[];
  documents?: { id: string; title: string; date: string; status: string }[];
  parts?: Part[];
  status?: 'Available' | 'Reserved' | 'Sold' | 'Archived' | 'pending' | 'approved' | 'banned' | string;
  tenant?: {
    name: string;
    phone: string;
    logo_url: string | null;
  } | null;
  features?: string[];
  sellerName?: string;
  sellerPhone?: string;
  sellerAvatar?: string | null;
  sellerType?: 'Dealership' | 'Private Owner' | string;
  province?: string;
  listingDate?: string;
  engineNumber?: string;
  fuelType?: string;
  description?: string;
  tenant_id?: string;
  sellerId?: string;
  isFeatured?: boolean;
}

// 3. WorkOrder
export interface WorkOrder {
  id: string;
  vehicle: string; // VIN
  vin?: string;
  customer: string;
  customer_name?: string;
  service: string;
  issue_description?: string;
  status: 'pending' | 'in-progress' | 'completed';
  date: string;
  created_at: string;
  cost: number;
  total_cost?: number;
  mechanic: string;
  mechanic_id?: string;
  tenant_id?: string;
  mileage?: number;
  parts?: any;
  notes?: string;
}

// 4. Part
export interface Part {
  id: string;
  name: string;
  sku: string;
  stock: number;
  type?: 'OEM' | 'Aftermarket' | 'Used' | string;
  stock_level?: number;
  minStock?: number;
  min_stock?: number;
  supplier?: string;
  price: number;
  unit_price?: number;
  installedDate?: string;
  installedBy?: string;
  warranty?: string;
  cost?: number;
  blockchainHash?: string;
  manufacturer?: string;
}

// 5. Claim
export interface Claim {
  id: string;
  policyholder: string;
  amount: number;
  vehicle: string;
  type: string;
  policy: string;
  date: string;
  assigned: string;
  status: 'pending' | 'under-review' | 'approved' | 'rejected';
}

// 6. RegistryVerification
export interface RegistryVerification {
  id: string;
  vin: string;
  make: string;
  model: string;
  registration: string;
  owner: string;
  type: string;
  status: 'pending' | 'verified' | 'rejected' | 'approved';
  date: string;
  created_at: string;
  vehicles?: {
    make: string;
    model: string;
    year: number;
  };
}

// 7. InsurancePolicy
export interface InsurancePolicy {
  policyNumber: string;
  policy_number?: string;
  provider: string;
  status: 'active' | 'expired' | 'pending';
  cost: number;
  coverage_details?: string;
  startDate: string;
  endDate: string;
  created_at?: string;
}

// 8. AuditLog
export interface AuditLog {
  event: string;
  mileage: string;
  hash: string;
  time: string;
}

// Additional domain interfaces for context stability
export interface AuthCredentials {
  email: string;
  token: string;
}

export interface DealerInventoryItem extends Vehicle {
  viewCount: number;
  trustScore: number;
  isVerified: boolean;
  images: string[];
}

// 9. FraudAlert
export interface FraudAlert {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  status: 'open' | 'under-investigation' | 'resolved';
  description: string;
  vehicle: string;
  policyholder: string;
  date?: string;
}

// 10. ComplianceReport
export interface ComplianceReport {
  id: string;
  title: string;
  status: 'generated' | 'pending';
  type: string;
  date: string;
  size?: string;
}

// 11. Lead
export interface Lead {
  id: string | number;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  status: 'new' | 'contacted' | 'negotiating' | 'closed';
  source: string;
  date: string;
  notes: string;
  buyer_name?: string;
  buyer_phone?: string;
  vin?: string;
  created_at?: string;
  message?: string;
}

// 12. Promotion
export interface Promotion {
  id: string | number;
  title: string;
  type: string;
  value: string;
  status: 'active' | 'scheduled' | 'expired';
  views: number;
  clicks: number;
  startDate: string;
  endDate: string;
  discount_amount?: number;
  start_date?: string;
  end_date?: string;
}

// 13. InsuranceRecord
export interface InsuranceRecord {
  id: string;
  provider: string;
  policyNumber?: string;
  policy_number?: string;
  type: string;
  startDate?: string;
  start_date?: string;
  expiryDate?: string;
  expiry_date?: string;
  premium: number;
  currency?: string;
  status: 'active' | 'expired' | 'pending' | string;
  coverage: string[];
}

// 14. ServiceRecord
export interface ServiceRecord extends WorkOrder {
  parts?: Part[];
}

// 15. Escrow
export interface Escrow extends SharedEscrow {}

// 16. Notification
export interface Notification extends SharedNotification {
  timestamp?: string;
}

// 17. VehiclePassport
export interface VehiclePassport {
  vehicle: Vehicle;
  timeline?: {
    id: string;
    event_source: 'service' | 'registry' | 'escrow' | string;
    label: string;
    timestamp: string;
    details?: {
      notes?: string;
      mileage?: number;
      cost?: number;
      [key: string]: any;
    };
  }[];
  trustReport?: {
    trustScore: number;
  };
  chainVerification?: {
    verified: boolean;
    integrity?: string;
  };
}

// 18. FinanceApplication
export interface FinanceApplication {
  id: string | number;
  user_name: string;
  year: number;
  make: string;
  model: string;
  requested_amount: number;
  monthly_payment: number;
  apr: number;
  trust_score: number;
  status: string;
  vin?: string;
  vehicle_id?: string;
  created_at?: string;
}

// 19. TelemetryData
export interface TelemetryData {
  vin: string;
  vehicle?: string;
  make?: string;
  model?: string;
  location?: string;
  status: string;
  speed?: string;
  lat: number;
  lng: number;
  active?: boolean;
}

// 20. ServerHealthModel
export interface ServerHealthModel {
  name: string;
  status: string;
  accuracy: number;
}

// 21. ApiMutationResponse
export interface ApiMutationResponse {
  success?: boolean;
  message?: string;
  id?: string;
  url?: string;
  path?: string;
  [key: string]: unknown;
}
