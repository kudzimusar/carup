import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  status: string;
  trust_score: number;
  price: number;
  currency: string;
}

export interface VehicleFilters {
  make?: string;
  model?: string;
  minPrice?: number;
  maxPrice?: number;
  drivetrain?: string;
  dutyPaid?: boolean;
  policeVerified?: boolean;
  minTrustScore?: number;
  status?: string;
}

/**
 * useVehicles — Supabase-powered React hook for CarUp OS marketplace
 * Replaces the old Express /api/vehicles call for public reads.
 * Real-time updates supported via Supabase channels.
 */
export function useVehicles(filters: VehicleFilters = {}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchVehicles() {
      setLoading(true);
      setError(null);

      try {
        let query = supabase.from('vehicles').select('*');

        if (filters.make) query = query.eq('make', filters.make);
        if (filters.model) query = query.eq('model', filters.model);
        if (filters.drivetrain) query = query.eq('drivetrain', filters.drivetrain);
        if (filters.status) query = query.eq('status', filters.status);
        if (filters.dutyPaid !== undefined) query = query.eq('duty_paid', filters.dutyPaid);
        if (filters.policeVerified !== undefined) query = query.eq('police_verified', filters.policeVerified);
        if (filters.minPrice !== undefined) query = query.gte('price', filters.minPrice);
        if (filters.maxPrice !== undefined) query = query.lte('price', filters.maxPrice);
        if (filters.minTrustScore !== undefined) query = query.gte('trust_score', filters.minTrustScore);

        query = query.order('trust_score', { ascending: false });

        const { data, error: queryError } = await query;

        if (!cancelled) {
          if (queryError) {
            setError(queryError.message);
          } else {
            setVehicles(data || []);
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchVehicles();

    // Real-time subscription — live marketplace updates
    const channel = supabase
      .channel('vehicles-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicles' },
        () => {
          // Refetch when any vehicle changes
          fetchVehicles();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [
    filters.make,
    filters.model,
    filters.minPrice,
    filters.maxPrice,
    filters.drivetrain,
    filters.dutyPaid,
    filters.policeVerified,
    filters.minTrustScore,
    filters.status,
  ]);

  return { vehicles, loading, error };
}

/**
 * useVehicle — fetch a single vehicle by VIN
 */
export function useVehicle(vin: string) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vin) return;

    async function fetch() {
      setLoading(true);
      const { data, error: queryError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('vin', vin)
        .single();

      if (queryError) setError(queryError.message);
      else setVehicle(data);
      setLoading(false);
    }

    fetch();
  }, [vin]);

  return { vehicle, loading, error };
}
