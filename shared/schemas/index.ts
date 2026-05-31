import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
});

export const RegisterSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters' }),
  email: z.string().email({ message: 'Invalid email address' }),
  phone: z.string().optional(),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
  role: z.enum(['owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'admin']),
});

export const KYCSchema = z.object({
  fullName: z.string().min(2, { message: 'Full legal name is required' }),
  idNumber: z.string().min(5, { message: 'National ID number is required' }),
  address: z.string().min(5, { message: 'Physical address is required' }),
  idPhoto: z.string().min(1, { message: 'Identification document photo is required' }),
  selfie: z.string().min(1, { message: 'KYC validation selfie is required' }),
});

export const ListingSchema = z.object({
  vin: z.string().min(17, { message: 'VIN must be exactly 17 characters' }).max(17),
  make: z.string().min(1, { message: 'Make is required' }),
  model: z.string().min(1, { message: 'Model is required' }),
  year: z.number().min(1900).max(new Date().getFullYear() + 1),
  color: z.string().optional(),
  mileage: z.number().nonnegative({ message: 'Mileage cannot be negative' }),
  fuel_type: z.string().optional(),
  transmission: z.string().optional(),
  condition: z.string().optional(),
  category: z.string().optional(),
  price: z.number().positive({ message: 'Price must be positive' }),
  currency: z.enum(['USD', 'ZiG', 'ZAR', 'BWP']).default('USD'),
  description: z.string().optional(),
  location: z.string().optional(),
  images: z.array(z.string()).optional(),
});

export const RepairLogSchema = z.object({
  vin: z.string().min(17).max(17),
  mechanicId: z.string().min(1),
  partName: z.string().min(1, { message: 'Part name is required' }),
  partOem: z.string().optional(),
  actionType: z.enum(['Replaced', 'Repaired', 'Inspected', 'Diagnosed']),
  description: z.string().optional(),
  mileage: z.number().nonnegative(),
});
