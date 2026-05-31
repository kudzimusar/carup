// shared/api/client.ts
/**
 * Central API client used by both web and mobile.
 * It injects authentication headers and tenant identification.
 */
export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  tenantResolver?: (context?: any) => Promise<string | null>;
  onUnauthorized?: () => void;
};

export type ApiClient = {
  get<T = any>(path: string, init?: RequestInit): Promise<T>;
  post<T = any>(path: string, body: any, init?: RequestInit): Promise<T>;
  put<T = any>(path: string, body: any, init?: RequestInit): Promise<T>;
  delete<T = any>(path: string, init?: RequestInit): Promise<T>;
};

export const createApiClient = ({ baseUrl, getAccessToken, tenantResolver, onUnauthorized }: ApiClientOptions): ApiClient => {
  const buildHeaders = async () => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (tenantResolver) {
      const tenantId = await tenantResolver();
      if (tenantId) headers['X-Tenant-Id'] = tenantId;
    }
    return headers;
  };

  const request = async <T>(method: string, path: string, body?: any, init?: RequestInit): Promise<T> => {
    const url = `${baseUrl.replace(/\/*$/, '')}/${path.replace(/^\/*/, '')}`;
    const headers = await buildHeaders();
    const cfg: RequestInit = {
      method,
      headers,
      ...init,
    };
    if (body !== undefined) {
      cfg.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const resp = await fetch(url, cfg);
    if (resp.status === 401 && onUnauthorized) onUnauthorized();
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`API ${method} ${path} failed: ${resp.status} ${txt}`);
    }
    return (await resp.json()) as T;
  };

  return {
    get: (p, i) => request('GET', p, undefined, i),
    post: (p, b, i) => request('POST', p, b, i),
    put: (p, b, i) => request('PUT', p, b, i),
    delete: (p, i) => request('DELETE', p, undefined, i),
  };
};

  baseUrl: string;
  getToken: () => string | null;
  getUserId: () => string | null;
  getRole: () => string | null;
  getTenantId: () => string | null;
}

export class CarUpApiClient {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    // Inject active auth contexts dynamically
    const token = this.config.getToken();
    const userId = this.config.getUserId();
    const role = this.config.getRole();
    const tenantId = this.config.getTenantId();

    if (token) headers['x-session-token'] = token;
    if (userId) headers['x-user-id'] = userId;
    if (role) headers['x-stakeholder-role'] = role;
    if (tenantId) headers['x-tenant-id'] = tenantId;

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // --- AUTH PORTALS ---
  async switchRole(userId: string, role: string, tenantId?: string) {
    return this.request<{ success: boolean; token: string; user: any }>('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ userId, role, tenantId }),
    });
  }

  // --- MARKETPLACE & VEHICLES ---
  async fetchVehicles(filters?: any) {
    const query = filters
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return this.request<any[]>(`/vehicles${query}`);
  }

  async fetchVehicleDetails(vin: string) {
    return this.request<any>(`/vehicles/${vin}/details`);
  }

  async fetchVehiclePassport(vin: string) {
    return this.request<any>(`/vehicles/${vin}/passport`);
  }

  async listInventory() {
    return this.request<any[]>('/vehicles/inventory');
  }

  async addVehicleListing(data: any) {
    return this.request<{ success: boolean; vin: string; message: string }>('/vehicles/add', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // --- SAFEPAY ESCROWS ---
  async createEscrow(vin: string, sellerId: string, amount: number, currency = 'USD') {
    return this.request<any>('/safepay/create', {
      method: 'POST',
      body: JSON.stringify({ vin, sellerId, amount, currency }),
    });
  }

  async fetchEscrows() {
    return this.request<any[]>('/safepay/list');
  }

  async updateEscrow(id: string, status: string, details?: any) {
    return this.request<any>(`/safepay/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status, details }),
    });
  }

  // --- PARTSENTRY REPAIR LOGS ---
  async addRepairLog(data: { vin: string; mechanicId: string; partName: string; partOem?: string; actionType: string; description?: string; mileage: number }) {
    return this.request<any>('/partsentry/add', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async fetchRepairHistory(vin: string) {
    return this.request<any[]>(`/partsentry/${vin}`);
  }

  // --- AI AND ANALYSIS SCANS ---
  async runOcrScan(docType: string, base64Data: string) {
    return this.request<{ success: boolean; extractedData: any }>('/api/ai/ocr', {
      method: 'POST',
      body: JSON.stringify({ docType, base64Data }),
    });
  }

  async runFraudScan(vin: string, price: number, listingTitle: string) {
    return this.request<any>('/ai/fraud-scan', {
      method: 'POST',
      body: JSON.stringify({ vin, price, listingTitle }),
    });
  }

  async runRiskAssessment(vin: string, mileage: number, basePrice: number) {
    return this.request<any>('/ai/risk-assessment', {
      method: 'POST',
      body: JSON.stringify({ vin, mileage, basePrice }),
    });
  }
}
export default CarUpApiClient;
