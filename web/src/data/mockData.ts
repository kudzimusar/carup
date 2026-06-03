// CarUp Mock Data System - Zimbabwe-specific automotive data

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: 'USD' | 'ZiG';
  mileage: number;
  transmission: 'Automatic' | 'Manual';
  fuelType: 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
  color: string;
  condition: 'New' | 'Used' | 'Certified Pre-Owned';
  category: 'Sedan' | 'SUV' | 'Hatchback' | 'Pickup' | 'Luxury' | 'Commercial';
  location: string;
  province: string;
  images: string[];
  vin: string;
  engineNumber: string;
  description: string;
  features: string[];
  sellerType: 'Dealer' | 'Individual';
  sellerName: string;
  sellerPhone: string;
  sellerAvatar?: string;
  sellerId: string;
  listingDate: string;
  isFeatured: boolean;
  isVerified: boolean;
  trustScore: number;
  viewCount: number;
  status?: string;
  plate_number?: string;
  normalized_plate_number?: string;
  chassis_number?: string;
  temporary_identification_number?: string;
}

export interface Dealer {
  id: string;
  name: string;
  logo: string;
  location: string;
  province: string;
  phone: string;
  email: string;
  website?: string;
  rating: number;
  reviewCount: number;
  status?: string;
  inventoryCount: number;
  yearsInBusiness: number;
  isVerified: boolean;
  specialties: string[];
  description: string;
}

export interface Garage {
  id: string;
  name: string;
  image: string;
  location: string;
  province: string;
  phone: string;
  email: string;
  rating: number;
  reviewCount: number;
  status?: string;
  services: string[];
  isVerified: boolean;
  specialties: string[];
  openingHours: string;
  description: string;
  mechanics: number;
}

export interface InsuranceProvider {
  id: string;
  name: string;
  logo: string;
  location: string;
  phone: string;
  email: string;
  rating: number;
  policies: string[];
  isVerified: boolean;
  description: string;
}

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  date: string;
  serviceType: string;
  description: string;
  mechanic: string;
  garage: string;
  cost: number;
  currency: string;
  mileage: number;
  parts: PartRecord[];
  status: 'completed' | 'in-progress' | 'scheduled';
}

export interface PartRecord {
  id: string;
  name: string;
  partNumber: string;
  manufacturer: string;
  type: 'OEM' | 'Aftermarket' | 'Used';
  installedDate: string;
  installedBy: string;
  warranty: string;
  cost: number;
}

export interface InsuranceRecord {
  id: string;
  vehicleId: string;
  provider: string;
  policyNumber: string;
  type: 'Comprehensive' | 'Third Party' | 'Third Party Fire & Theft';
  startDate: string;
  expiryDate: string;
  premium: number;
  currency: string;
  status: 'active' | 'expired' | 'pending';
  coverage: string[];
}

export interface VehicleInGarage {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  engineNumber: string;
  registration: string;
  color: string;
  mileage: number;
  image: string;
  trustScore: number;
  condition: string;
  purchaseDate: string;
  purchasePrice: number;
  currentEstimate: number;
  serviceHistory: ServiceRecord[];
  insuranceRecords: InsuranceRecord[];
  partsHistory: PartRecord[];
  documents: VehicleDocument[];
}

export interface VehicleDocument {
  id: string;
  type: 'Logbook' | 'Insurance' | 'Police Clearance' | 'Roadworthy' | 'Service Invoice' | 'Receipt';
  title: string;
  date: string;
  status: 'verified' | 'pending' | 'expired';
  fileUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  timestamp: string;
  read: boolean;
}

// Zimbabwe Locations
export const zimbabweLocations = [
  'Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo',
  'Chinhoyi', 'Bindura', 'Kadoma', 'Kwekwe', 'Victoria Falls',
  'Marondera', 'Norton', 'Chitungwiza', 'Epworth', 'Redcliff'
];

export const zimbabweProvinces = [
  'Harare Metropolitan', 'Bulawayo Metropolitan', 'Manicaland',
  'Mashonaland Central', 'Mashonaland East', 'Mashonaland West',
  'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands'
];

// Vehicle Mock Data
export const vehicles: Vehicle[] = [
  {
    id: 'v1',
    make: 'Toyota',
    model: 'Land Cruiser Prado',
    year: 2019,
    price: 48500,
    currency: 'USD',
    mileage: 45000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Black',
    condition: 'Used',
    category: 'SUV',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/suv-prado.jpg'],
    vin: 'JTELU9FJ9K5987234',
    engineNumber: '1KD-456789',
    plate_number: 'AE-1234',
    normalized_plate_number: 'AE1234',
    chassis_number: 'JTELU9FJ9K5987234',
    temporary_identification_number: 'TEMP-1234-ZW',
    description: 'Immaculate condition Toyota Land Cruiser Prado. Full service history, recent timing belt replacement. Perfect for family adventures and long-distance travel.',
    features: ['4WD', 'Leather Seats', 'Sunroof', 'Navigation', 'Reverse Camera', 'Cruise Control', '7 Seats', 'Tow Bar'],
    sellerType: 'Dealer',
    sellerName: 'Premier Auto Zimbabwe',
    sellerPhone: '+263 772 123 456',
    sellerAvatar: '/images/avatars/dealer-1.jpg',
    sellerId: 'd1',
    listingDate: '2026-05-15',
    isFeatured: true,
    isVerified: true,
    trustScore: 94,
    viewCount: 328
  },
  {
    id: 'v2',
    make: 'Toyota',
    model: 'Hilux Double Cab',
    year: 2021,
    price: 42000,
    currency: 'USD',
    mileage: 28000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Silver',
    condition: 'Certified Pre-Owned',
    category: 'Pickup',
    location: 'Bulawayo',
    province: 'Bulawayo Metropolitan',
    images: ['/images/vehicles/pickup-hilux.jpg'],
    vin: 'MR0HA8CDX0M123456',
    engineNumber: '1GD-789012',
    description: 'Nearly new Toyota Hilux with full dealer service history. Canopy included. Perfect work and leisure vehicle.',
    features: ['4WD', 'Canopy', 'Tow Bar', 'Bull Bar', 'Reverse Camera', 'Bluetooth', 'Cruise Control'],
    sellerType: 'Dealer',
    sellerName: 'Bulawayo Motors',
    sellerPhone: '+263 772 234 567',
    sellerId: 'd2',
    listingDate: '2026-05-18',
    isFeatured: true,
    isVerified: true,
    trustScore: 96,
    viewCount: 256
  },
  {
    id: 'v3',
    make: 'Volkswagen',
    model: 'Golf TSI',
    year: 2020,
    price: 18500,
    currency: 'USD',
    mileage: 35000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'White',
    condition: 'Used',
    category: 'Hatchback',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/hatchback-golf.jpg'],
    vin: 'WVWZZZAUZLW908765',
    engineNumber: 'CJX-345678',
    description: 'Well-maintained VW Golf with full service history at CMH. Economical and fun to drive.',
    features: ['Turbo', 'Leather Seats', 'Apple CarPlay', 'Android Auto', 'Park Assist', 'Climate Control'],
    sellerType: 'Individual',
    sellerName: 'Tendai Moyo',
    sellerPhone: '+263 773 345 678',
    sellerAvatar: '/images/avatars/owner-1.jpg',
    sellerId: 'u1',
    listingDate: '2026-05-20',
    isFeatured: false,
    isVerified: true,
    trustScore: 88,
    viewCount: 189
  },
  {
    id: 'v4',
    make: 'BMW',
    model: '320i',
    year: 2022,
    price: 52000,
    currency: 'USD',
    mileage: 18000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'Dark Blue',
    condition: 'Used',
    category: 'Sedan',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/sedan-bmw.jpg'],
    vin: 'WBA8E9G54LNU87654',
    engineNumber: 'B48-654321',
    description: 'Executive BMW 3 Series in excellent condition. Still under motor plan. Premium features throughout.',
    features: ['M Sport Package', 'Harmon Kardon Sound', 'Heads Up Display', 'Wireless Charging', 'Ambient Lighting', 'Sunroof'],
    sellerType: 'Dealer',
    sellerName: 'EuroCars Zimbabwe',
    sellerPhone: '+263 774 456 789',
    sellerId: 'd3',
    listingDate: '2026-05-10',
    isFeatured: true,
    isVerified: true,
    trustScore: 92,
    viewCount: 412
  },
  {
    id: 'v5',
    make: 'Mazda',
    model: 'CX-5',
    year: 2021,
    price: 28500,
    currency: 'USD',
    mileage: 32000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'Red',
    condition: 'Used',
    category: 'SUV',
    location: 'Mutare',
    province: 'Manicaland',
    images: ['/images/vehicles/suv-mazda.jpg'],
    vin: 'JM0KF4WLA1M234567',
    engineNumber: 'PY-987654',
    description: 'Beautiful Soul Red Crystal CX-5 with all the bells and whistles. Single owner, garaged.',
    features: ['AWD', 'Bose Sound', '360 Camera', 'Adaptive Cruise', 'Lane Keep Assist', 'Memory Seats'],
    sellerType: 'Individual',
    sellerName: 'Sarah Chikomo',
    sellerPhone: '+263 775 567 890',
    sellerAvatar: '/images/avatars/owner-2.jpg',
    sellerId: 'u2',
    listingDate: '2026-05-17',
    isFeatured: false,
    isVerified: true,
    trustScore: 90,
    viewCount: 167
  },
  {
    id: 'v6',
    make: 'Mercedes-Benz',
    model: 'C200',
    year: 2023,
    price: 58000,
    currency: 'USD',
    mileage: 12000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'Grey',
    condition: 'Used',
    category: 'Sedan',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/sedan-mercedes.jpg'],
    vin: 'W1KWF8EB9PR123456',
    engineNumber: 'M264-112233',
    description: 'Nearly new C-Class with premium package. Still smells new. All services done at Mercedes-Benz.',
    features: ['AMG Line', 'Panoramic Roof', 'Burmester Sound', 'MBUX', 'Augmented Nav', 'Air Suspension'],
    sellerType: 'Dealer',
    sellerName: 'Premier Auto Zimbabwe',
    sellerPhone: '+263 772 123 456',
    sellerAvatar: '/images/avatars/dealer-1.jpg',
    sellerId: 'd1',
    listingDate: '2026-05-12',
    isFeatured: true,
    isVerified: true,
    trustScore: 97,
    viewCount: 534
  },
  {
    id: 'v7',
    make: 'Nissan',
    model: 'X-Trail',
    year: 2020,
    price: 22000,
    currency: 'USD',
    mileage: 48000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'White',
    condition: 'Used',
    category: 'SUV',
    location: 'Gweru',
    province: 'Midlands',
    images: ['/images/vehicles/suv-xtrail.jpg'],
    vin: 'SJNBFAP11A2345678',
    engineNumber: 'QR25-445566',
    description: 'Reliable family SUV with 7 seats. Full Nissan service history. Ready for immediate use.',
    features: ['7 Seats', 'ProPILOT', 'Around View Monitor', 'Heated Seats', 'Power Tailgate'],
    sellerType: 'Dealer',
    sellerName: 'Midlands Motors',
    sellerPhone: '+263 776 678 901',
    sellerId: 'd4',
    listingDate: '2026-05-19',
    isFeatured: false,
    isVerified: true,
    trustScore: 86,
    viewCount: 143
  },
  {
    id: 'v8',
    make: 'Land Rover',
    model: 'Discovery',
    year: 2018,
    price: 55000,
    currency: 'USD',
    mileage: 62000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Green',
    condition: 'Used',
    category: 'SUV',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/suv-landrover.jpg'],
    vin: 'SALRA2BV4JA234567',
    engineNumber: '306DT-778899',
    description: 'Capable off-road luxury SUV. Full service history, recent air suspension overhaul. Ready for any adventure.',
    features: ['Air Suspension', 'Terrain Response', 'Meridian Sound', '7 Seats', 'Panoramic Roof', 'Tow Pack'],
    sellerType: 'Individual',
    sellerName: 'James Ncube',
    sellerPhone: '+263 777 789 012',
    sellerId: 'u3',
    listingDate: '2026-05-14',
    isFeatured: false,
    isVerified: false,
    trustScore: 78,
    viewCount: 98
  },
  {
    id: 'v9',
    make: 'Honda',
    model: 'Fit',
    year: 2022,
    price: 12000,
    currency: 'USD',
    mileage: 22000,
    transmission: 'Automatic',
    fuelType: 'Petrol',
    color: 'White',
    condition: 'Used',
    category: 'Hatchback',
    location: 'Chinhoyi',
    province: 'Mashonaland West',
    images: ['/images/vehicles/hatchback-honda.jpg'],
    vin: 'JHMGD385XCS123456',
    engineNumber: 'L15B-334455',
    description: 'Fuel-efficient Honda Fit perfect for city driving. Excellent condition, low mileage.',
    features: ['Magic Seats', 'Eco Mode', 'Bluetooth', 'Reverse Camera', 'Keyless Entry'],
    sellerType: 'Individual',
    sellerName: 'Grace Mupfumi',
    sellerPhone: '+263 778 890 123',
    sellerId: 'u4',
    listingDate: '2026-05-21',
    isFeatured: false,
    isVerified: true,
    trustScore: 91,
    viewCount: 76
  },
  {
    id: 'v10',
    make: 'Ford',
    model: 'Ranger Wildtrak',
    year: 2023,
    price: 51000,
    currency: 'USD',
    mileage: 15000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Grey',
    condition: 'Used',
    category: 'Pickup',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/pickup-ford.jpg'],
    vin: 'MNBFXXMT4PF123456',
    engineNumber: 'BK3Q-667788',
    description: 'Top-spec Wildtrak with all options. Roller cover, tow bar, and more. Perfect work-life balance.',
    features: ['4WD', 'Roller Cover', 'Tow Bar', 'SYNC 4', '360 Camera', 'Adaptive Cruise', 'Leather'],
    sellerType: 'Dealer',
    sellerName: 'Ford Zimbabwe',
    sellerPhone: '+263 779 901 234',
    sellerId: 'd5',
    listingDate: '2026-05-16',
    isFeatured: true,
    isVerified: true,
    trustScore: 95,
    viewCount: 289
  },
  {
    id: 'v11',
    make: 'Toyota',
    model: 'Fortuner',
    year: 2022,
    price: 46000,
    currency: 'USD',
    mileage: 25000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Black',
    condition: 'Certified Pre-Owned',
    category: 'SUV',
    location: 'Bulawayo',
    province: 'Bulawayo Metropolitan',
    images: ['/images/vehicles/suv-fortuner.jpg'],
    vin: 'MR0GK8DDX0N234567',
    engineNumber: '1GD-990011',
    description: 'Certified pre-owned Fortuner in pristine condition. Full Toyota service history, warranty remaining.',
    features: ['4WD', '7 Seats', 'Leather', 'Navigation', 'Reverse Camera', 'Cruise Control'],
    sellerType: 'Dealer',
    sellerName: 'Bulawayo Motors',
    sellerPhone: '+263 772 234 567',
    sellerId: 'd2',
    listingDate: '2026-05-13',
    isFeatured: false,
    isVerified: true,
    trustScore: 93,
    viewCount: 198
  },
  {
    id: 'v12',
    make: 'Audi',
    model: 'Q5',
    year: 2021,
    price: 48000,
    currency: 'USD',
    mileage: 30000,
    transmission: 'Automatic',
    fuelType: 'Diesel',
    color: 'Black',
    condition: 'Used',
    category: 'SUV',
    location: 'Harare',
    province: 'Harare Metropolitan',
    images: ['/images/vehicles/suv-luxury.jpg'],
    vin: 'WA1ZZZFY5M1234567',
    engineNumber: 'EA897-223344',
    description: 'Premium German SUV with quattro all-wheel drive. Impeccable condition, fully loaded.',
    features: ['Quattro AWD', 'Virtual Cockpit', 'Bang & Olufsen', 'Panoramic Roof', 'Matrix LED', 'Air Suspension'],
    sellerType: 'Dealer',
    sellerName: 'EuroCars Zimbabwe',
    sellerPhone: '+263 774 456 789',
    sellerId: 'd3',
    listingDate: '2026-05-11',
    isFeatured: true,
    isVerified: true,
    trustScore: 94,
    viewCount: 367
  }
];

// Dealer Mock Data
export const dealers: Dealer[] = [
  {
    id: 'd1',
    name: 'Premier Auto Zimbabwe',
    logo: '/images/avatars/dealer-1.jpg',
    location: 'Harare',
    province: 'Harare Metropolitan',
    phone: '+263 772 123 456',
    email: 'sales@premierauto.co.zw',
    website: 'www.premierauto.co.zw',
    rating: 4.8,
    reviewCount: 127,
    inventoryCount: 45,
    yearsInBusiness: 15,
    isVerified: true,
    specialties: ['Luxury Vehicles', 'SUVs', 'Import Services'],
    description: 'Zimbabwe\'s premier luxury and SUV dealership. We specialize in premium vehicles with full certification and warranty.'
  },
  {
    id: 'd2',
    name: 'Bulawayo Motors',
    logo: '/images/avatars/dealer-1.jpg',
    location: 'Bulawayo',
    province: 'Bulawayo Metropolitan',
    phone: '+263 772 234 567',
    email: 'info@bulawayomotors.co.zw',
    rating: 4.6,
    reviewCount: 89,
    inventoryCount: 32,
    yearsInBusiness: 22,
    isVerified: true,
    specialties: ['Toyota', 'Commercial Vehicles', 'Servicing'],
    description: 'Your trusted Toyota and commercial vehicle specialist in Bulawayo. Family-owned for over two decades.'
  },
  {
    id: 'd3',
    name: 'EuroCars Zimbabwe',
    logo: '/images/avatars/dealer-1.jpg',
    location: 'Harare',
    province: 'Harare Metropolitan',
    phone: '+263 774 456 789',
    email: 'sales@eurocars.co.zw',
    website: 'www.eurocars.co.zw',
    rating: 4.7,
    reviewCount: 64,
    inventoryCount: 28,
    yearsInBusiness: 8,
    isVerified: true,
    specialties: ['European Brands', 'BMW', 'Mercedes', 'Audi'],
    description: 'Specialists in European luxury vehicles. Full diagnostic capabilities and certified technicians.'
  },
  {
    id: 'd4',
    name: 'Midlands Motors',
    logo: '/images/avatars/dealer-1.jpg',
    location: 'Gweru',
    province: 'Midlands',
    phone: '+263 776 678 901',
    email: 'sales@midlandsmotors.co.zw',
    rating: 4.4,
    reviewCount: 45,
    inventoryCount: 18,
    yearsInBusiness: 12,
    isVerified: true,
    specialties: ['Family Vehicles', 'Nissan', 'Servicing'],
    description: 'Serving the Midlands with quality family vehicles and professional after-sales service.'
  },
  {
    id: 'd5',
    name: 'Ford Zimbabwe',
    logo: '/images/avatars/dealer-1.jpg',
    location: 'Harare',
    province: 'Harare Metropolitan',
    phone: '+263 779 901 234',
    email: 'sales@fordzimbabwe.co.zw',
    website: 'www.fordzimbabwe.co.zw',
    rating: 4.5,
    reviewCount: 93,
    inventoryCount: 38,
    yearsInBusiness: 18,
    isVerified: true,
    specialties: ['Ford', 'Ranger', 'Commercial', 'Parts'],
    description: 'Official Ford dealership offering the full range of Ford vehicles, parts, and authorized service.'
  }
];

// Garage Mock Data
export const garages: Garage[] = [
  {
    id: 'g1',
    name: 'AutoTech Pro Garage',
    image: '/images/facilities/garage-1.jpg',
    location: 'Harare',
    province: 'Harare Metropolitan',
    phone: '+263 772 111 222',
    email: 'service@autotechpro.co.zw',
    rating: 4.9,
    reviewCount: 156,
    services: ['General Service', 'Diagnostics', 'Engine Repair', 'Transmission', 'Electrical', 'Panel Beating'],
    isVerified: true,
    specialties: ['European Cars', 'Japanese Cars', 'Hybrid Vehicles'],
    openingHours: 'Mon-Fri: 8AM-5PM, Sat: 8AM-1PM',
    description: 'State-of-the-art facility with the latest diagnostic equipment. Certified mechanics for all major brands.',
    mechanics: 8
  },
  {
    id: 'g2',
    name: 'QuickFix Motors',
    image: '/images/facilities/garage-1.jpg',
    location: 'Bulawayo',
    province: 'Bulawayo Metropolitan',
    phone: '+263 772 333 444',
    email: 'info@quickfixmotors.co.zw',
    rating: 4.6,
    reviewCount: 98,
    services: ['General Service', 'Brakes', 'Suspension', 'AC Service', 'Tyres'],
    isVerified: true,
    specialties: ['Toyota', 'Nissan', 'Mazda'],
    openingHours: 'Mon-Sat: 7:30AM-5:30PM',
    description: 'Fast, reliable service at competitive prices. Specializing in Japanese vehicles.',
    mechanics: 5
  },
  {
    id: 'g3',
    name: 'Elite Auto Care',
    image: '/images/facilities/garage-1.jpg',
    location: 'Harare',
    province: 'Harare Metropolitan',
    phone: '+263 772 555 666',
    email: 'bookings@eliteautocare.co.zw',
    rating: 4.8,
    reviewCount: 112,
    services: ['Full Service', 'Detailing', 'Paint Protection', 'Wheel Alignment', 'Diagnostics'],
    isVerified: true,
    specialties: ['Luxury Vehicles', 'Detailing', 'Restoration'],
    openingHours: 'Mon-Fri: 8AM-6PM, Sat: 9AM-4PM',
    description: 'Premium auto care for luxury and classic vehicles. Concierge service available.',
    mechanics: 6
  }
];

// Insurance Providers
export const insuranceProviders: InsuranceProvider[] = [
  {
    id: 'i1',
    name: 'NicozDiamond Insurance',
    logo: '/images/avatars/insurance-1.jpg',
    location: 'Harare',
    phone: '+263 242 700 000',
    email: 'motor@nicozdiamond.co.zw',
    rating: 4.5,
    policies: ['Comprehensive', 'Third Party', 'Third Party Fire & Theft'],
    isVerified: true,
    description: 'One of Zimbabwe\'s largest insurers with extensive motor vehicle coverage options.'
  },
  {
    id: 'i2',
    name: 'CABS Insurance',
    logo: '/images/avatars/insurance-1.jpg',
    location: 'Harare',
    phone: '+263 242 883 000',
    email: 'insurance@cabs.co.zw',
    rating: 4.4,
    policies: ['Comprehensive', 'Third Party', 'Commercial Vehicle'],
    isVerified: true,
    description: 'Backed by CABS Bank, offering competitive motor insurance with flexible payment options.'
  },
  {
    id: 'i3',
    name: 'Cell Insurance',
    logo: '/images/avatars/insurance-1.jpg',
    location: 'Bulawayo',
    phone: '+263 292 888 000',
    email: 'info@cellinsurance.co.zw',
    rating: 4.3,
    policies: ['Comprehensive', 'Third Party', 'Fleet Insurance'],
    isVerified: true,
    description: 'Serving Zimbabwe since 1976 with reliable motor vehicle insurance solutions.'
  }
];

// My Garage (User's Vehicles)
export const myGarage: VehicleInGarage[] = [
  {
    id: 'vg1',
    make: 'Toyota',
    model: 'Corolla Quest',
    year: 2019,
    vin: 'AHTFB3GJ5K1234567',
    engineNumber: '2NR-123456',
    registration: 'ABC 1234',
    color: 'Silver',
    mileage: 67800,
    image: '/images/vehicles/sedan-bmw.jpg',
    trustScore: 87,
    condition: 'Good',
    purchaseDate: '2022-03-15',
    purchasePrice: 14500,
    currentEstimate: 11800,
    serviceHistory: [
      {
        id: 's1',
        vehicleId: 'vg1',
        date: '2026-04-20',
        serviceType: 'Full Service',
        description: 'Oil change, filter replacement, brake inspection, tyre rotation',
        mechanic: 'John Mukwena',
        garage: 'AutoTech Pro Garage',
        cost: 280,
        currency: 'USD',
        mileage: 67000,
        parts: [
          { id: 'p1', name: 'Engine Oil (Synthetic)', partNumber: 'TOY-5W30-4L', manufacturer: 'Toyota', type: 'OEM', installedDate: '2026-04-20', installedBy: 'AutoTech Pro Garage', warranty: '6 months', cost: 85 },
          { id: 'p2', name: 'Oil Filter', partNumber: '90915-YZZE1', manufacturer: 'Toyota', type: 'OEM', installedDate: '2026-04-20', installedBy: 'AutoTech Pro Garage', warranty: '6 months', cost: 25 },
          { id: 'p3', name: 'Air Filter', partNumber: '17801-0T020', manufacturer: 'Toyota', type: 'OEM', installedDate: '2026-04-20', installedBy: 'AutoTech Pro Garage', warranty: '6 months', cost: 35 }
        ],
        status: 'completed'
      },
      {
        id: 's2',
        vehicleId: 'vg1',
        date: '2026-01-15',
        serviceType: 'Brake Service',
        description: 'Replaced front brake pads and discs, brake fluid flush',
        mechanic: 'Tendai Mutasa',
        garage: 'QuickFix Motors',
        cost: 195,
        currency: 'USD',
        mileage: 62500,
        parts: [
          { id: 'p4', name: 'Front Brake Pads', partNumber: 'BP-TYT-001', manufacturer: 'Bosch', type: 'OEM', installedDate: '2026-01-15', installedBy: 'QuickFix Motors', warranty: '12 months', cost: 65 },
          { id: 'p5', name: 'Front Brake Discs (Pair)', partNumber: 'BD-TYT-001', manufacturer: 'Bosch', type: 'OEM', installedDate: '2026-01-15', installedBy: 'QuickFix Motors', warranty: '12 months', cost: 95 }
        ],
        status: 'completed'
      },
      {
        id: 's3',
        vehicleId: 'vg1',
        date: '2025-08-10',
        serviceType: 'General Service',
        description: 'Oil change, air filter, spark plugs, coolant top-up',
        mechanic: 'John Mukwena',
        garage: 'AutoTech Pro Garage',
        cost: 220,
        currency: 'USD',
        mileage: 54000,
        parts: [
          { id: 'p6', name: 'Spark Plugs (Set)', partNumber: '90919-01253', manufacturer: 'Denso', type: 'OEM', installedDate: '2025-08-10', installedBy: 'AutoTech Pro Garage', warranty: '12 months', cost: 45 },
          { id: 'p7', name: 'Engine Oil', partNumber: 'TOY-5W30-4L', manufacturer: 'Toyota', type: 'OEM', installedDate: '2025-08-10', installedBy: 'AutoTech Pro Garage', warranty: '6 months', cost: 80 }
        ],
        status: 'completed'
      }
    ],
    insuranceRecords: [
      {
        id: 'ir1',
        vehicleId: 'vg1',
        provider: 'NicozDiamond Insurance',
        policyNumber: 'NDI-MOT-2026-45678',
        type: 'Comprehensive',
        startDate: '2026-01-01',
        expiryDate: '2026-12-31',
        premium: 680,
        currency: 'USD',
        status: 'active',
        coverage: ['Accident Damage', 'Theft', 'Fire', 'Third Party Liability', 'Windscreen', 'Roadside Assistance']
      },
      {
        id: 'ir2',
        vehicleId: 'vg1',
        provider: 'NicozDiamond Insurance',
        policyNumber: 'NDI-MOT-2025-34567',
        type: 'Comprehensive',
        startDate: '2025-01-01',
        expiryDate: '2025-12-31',
        premium: 620,
        currency: 'USD',
        status: 'expired',
        coverage: ['Accident Damage', 'Theft', 'Fire', 'Third Party Liability']
      }
    ],
    partsHistory: [
      { id: 'p1', name: 'Engine Oil (Synthetic)', partNumber: 'TOY-5W30-4L', manufacturer: 'Toyota', type: 'OEM', installedDate: '2026-04-20', installedBy: 'AutoTech Pro Garage', warranty: '6 months', cost: 85 },
      { id: 'p4', name: 'Front Brake Pads', partNumber: 'BP-TYT-001', manufacturer: 'Bosch', type: 'OEM', installedDate: '2026-01-15', installedBy: 'QuickFix Motors', warranty: '12 months', cost: 65 },
      { id: 'p5', name: 'Front Brake Discs (Pair)', partNumber: 'BD-TYT-001', manufacturer: 'Bosch', type: 'OEM', installedDate: '2026-01-15', installedBy: 'QuickFix Motors', warranty: '12 months', cost: 95 },
      { id: 'p6', name: 'Spark Plugs (Set)', partNumber: '90919-01253', manufacturer: 'Denso', type: 'OEM', installedDate: '2025-08-10', installedBy: 'AutoTech Pro Garage', warranty: '12 months', cost: 45 },
      { id: 'p8', name: 'Battery (12V)', partNumber: 'NS60LS', manufacturer: 'Willard', type: 'Aftermarket', installedDate: '2025-03-22', installedBy: 'AutoTech Pro Garage', warranty: '24 months', cost: 120 },
      { id: 'p9', name: 'Tyres (Set of 4)', partNumber: '195/65R15', manufacturer: 'Michelin', type: 'OEM', installedDate: '2024-11-15', installedBy: 'QuickFix Motors', warranty: '12 months', cost: 380 }
    ],
    documents: [
      { id: 'doc1', type: 'Logbook', title: 'Vehicle Registration Book', date: '2022-03-15', status: 'verified' },
      { id: 'doc2', type: 'Insurance', title: 'Insurance Policy 2026', date: '2026-01-01', status: 'verified' },
      { id: 'doc3', type: 'Roadworthy', title: 'VID Roadworthy Certificate', date: '2025-12-10', status: 'verified' },
      { id: 'doc4', type: 'Police Clearance', title: 'Police Clearance Certificate', date: '2025-06-20', status: 'expired' },
      { id: 'doc5', type: 'Service Invoice', title: 'Service Invoice - April 2026', date: '2026-04-20', status: 'verified' }
    ]
  },
  {
    id: 'vg2',
    make: 'Nissan',
    model: 'NP300',
    year: 2020,
    vin: 'MNTBB3DJ8L7654321',
    engineNumber: 'YD25-654321',
    registration: 'DEF 5678',
    color: 'White',
    mileage: 45200,
    image: '/images/vehicles/pickup-hilux.jpg',
    trustScore: 92,
    condition: 'Excellent',
    purchaseDate: '2023-06-01',
    purchasePrice: 28000,
    currentEstimate: 24500,
    serviceHistory: [
      {
        id: 's4',
        vehicleId: 'vg2',
        date: '2026-03-10',
        serviceType: 'Full Service',
        description: 'Major service including timing chain inspection, all filters, fluids',
        mechanic: 'Simba Ndlovu',
        garage: 'Elite Auto Care',
        cost: 420,
        currency: 'USD',
        mileage: 44000,
        parts: [
          { id: 'p10', name: 'Timing Chain Kit', partNumber: 'TCK-NSN-001', manufacturer: 'Nissan', type: 'OEM', installedDate: '2026-03-10', installedBy: 'Elite Auto Care', warranty: '24 months', cost: 185 },
          { id: 'p11', name: 'Fuel Filter', partNumber: '16400-ES60A', manufacturer: 'Nissan', type: 'OEM', installedDate: '2026-03-10', installedBy: 'Elite Auto Care', warranty: '12 months', cost: 45 }
        ],
        status: 'completed'
      }
    ],
    insuranceRecords: [
      {
        id: 'ir3',
        vehicleId: 'vg2',
        provider: 'CABS Insurance',
        policyNumber: 'CABS-MOT-2026-78901',
        type: 'Comprehensive',
        startDate: '2026-06-01',
        expiryDate: '2027-05-31',
        premium: 920,
        currency: 'USD',
        status: 'active',
        coverage: ['Accident Damage', 'Theft', 'Fire', 'Third Party Liability', 'Off-road Coverage', 'Load Protection']
      }
    ],
    partsHistory: [
      { id: 'p10', name: 'Timing Chain Kit', partNumber: 'TCK-NSN-001', manufacturer: 'Nissan', type: 'OEM', installedDate: '2026-03-10', installedBy: 'Elite Auto Care', warranty: '24 months', cost: 185 },
      { id: 'p11', name: 'Fuel Filter', partNumber: '16400-ES60A', manufacturer: 'Nissan', type: 'OEM', installedDate: '2026-03-10', installedBy: 'Elite Auto Care', warranty: '12 months', cost: 45 },
      { id: 'p12', name: 'Clutch Kit', partNumber: 'CK-NSN-001', manufacturer: 'Exedy', type: 'OEM', installedDate: '2025-09-15', installedBy: 'AutoTech Pro Garage', warranty: '12 months', cost: 320 }
    ],
    documents: [
      { id: 'doc6', type: 'Logbook', title: 'Vehicle Registration Book', date: '2023-06-01', status: 'verified' },
      { id: 'doc7', type: 'Insurance', title: 'CABS Insurance Policy', date: '2026-06-01', status: 'verified' },
      { id: 'doc8', type: 'Roadworthy', title: 'VID Roadworthy Certificate', date: '2026-02-20', status: 'verified' }
    ]
  }
];

// Gutu AI Chat Messages
export const gutuWelcomeMessages: ChatMessage[] = [
  {
    id: 'gw1',
    role: 'assistant',
    content: 'Mhoroi! I am Gutu AI, your CarUp automotive assistant. I can help you with:\n\n- Vehicle valuations and pricing insights\n- Document scanning and verification\n- Maintenance predictions and reminders\n- Fraud detection alerts\n- Marketplace recommendations\n- Insurance and compliance guidance\n\nHow can I assist you today?',
    timestamp: '2026-05-22T08:00:00Z'
  }
];

// Notifications
export const notifications: Notification[] = [
  {
    id: 'n1',
    title: 'Service Due',
    message: 'Your Toyota Corolla Quest is due for service in 500km. Book an appointment with your preferred garage.',
    type: 'warning',
    timestamp: '2026-05-21T10:30:00Z',
    read: false
  },
  {
    id: 'n2',
    title: 'Insurance Expiring Soon',
    message: 'Your NicozDiamond policy expires in 30 days. Renew now to avoid coverage gaps.',
    type: 'warning',
    timestamp: '2026-05-20T14:15:00Z',
    read: false
  },
  {
    id: 'n3',
    title: 'New Feature Available',
    message: 'PartSentry 2.0 is now live! Track your vehicle parts with blockchain verification.',
    type: 'info',
    timestamp: '2026-05-18T09:00:00Z',
    read: true
  },
  {
    id: 'n4',
    title: 'Price Drop Alert',
    message: 'A Toyota Hilux you saved has dropped in price by $2,000. Check it out!',
    type: 'success',
    timestamp: '2026-05-17T16:45:00Z',
    read: false
  },
  {
    id: 'n5',
    title: 'Document Verified',
    message: 'Your logbook verification is complete. Trust Score increased by 3 points.',
    type: 'success',
    timestamp: '2026-05-15T11:20:00Z',
    read: true
  }
];

// Market Analytics Data
export const marketAnalytics = {
  priceTrends: [
    { month: 'Jan', sedans: 18500, suvs: 42000, pickups: 38500 },
    { month: 'Feb', sedans: 18200, suvs: 42500, pickups: 39000 },
    { month: 'Mar', sedans: 18800, suvs: 43000, pickups: 39500 },
    { month: 'Apr', sedans: 19000, suvs: 43500, pickups: 40000 },
    { month: 'May', sedans: 19500, suvs: 44000, pickups: 41000 },
  ],
  categoryDistribution: [
    { name: 'SUVs', value: 35, count: 420 },
    { name: 'Sedans', value: 25, count: 300 },
    { name: 'Pickups', value: 20, count: 240 },
    { name: 'Hatchbacks', value: 15, count: 180 },
    { name: 'Luxury', value: 5, count: 60 },
  ],
  topSearches: [
    'Toyota Hilux', 'Toyota Prado', 'VW Golf', 'BMW 3 Series', 'Ford Ranger',
    'Mazda CX-5', 'Mercedes C-Class', 'Nissan X-Trail', 'Toyota Fortuner', 'Honda Fit'
  ],
  locationDistribution: [
    { location: 'Harare', count: 580 },
    { location: 'Bulawayo', count: 220 },
    { location: 'Mutare', count: 85 },
    { location: 'Gweru', count: 65 },
    { location: 'Masvingo', count: 50 },
  ]
};

// Stats for Dashboards
export const dashboardStats = {
  owner: {
    totalVehicles: 2,
    totalValue: 36300,
    pendingServices: 1,
    activeInsurance: 2,
    trustScore: 90,
    documentsPending: 1
  },
  dealer: {
    totalInventory: 45,
    totalLeads: 128,
    monthlySales: 12,
    revenue: 486000,
    avgDaysOnLot: 18,
    customerRating: 4.8
  },
  mechanic: {
    activeWorkOrders: 8,
    completedThisMonth: 34,
    pendingParts: 3,
    customerSatisfaction: 4.9,
    monthlyRevenue: 12400,
    returningCustomers: 67
  },
  insurance: {
    activePolicies: 2340,
    pendingClaims: 12,
    fraudAlerts: 3,
    monthlyPremiums: 892000,
    claimApproval: 94,
    riskScore: 2.1
  }
};

// Subscription Plans
export const subscriptionPlans = [
  {
    name: 'Basic',
    price: 0,
    currency: 'USD',
    period: 'month',
    description: 'Essential vehicle tracking and marketplace access',
    features: [
      '1 Vehicle Profile',
      'Basic Service History',
      'Marketplace Browsing',
      'Document Storage (5 docs)',
      'Email Support'
    ],
    notIncluded: [
      'AI Valuation',
      'Insurance Integration',
      'PartSentry Tracking',
      'Priority Support'
    ],
    cta: 'Get Started Free',
    popular: false
  },
  {
    name: 'Premium',
    price: 9.99,
    currency: 'USD',
    period: 'month',
    description: 'Full vehicle intelligence and marketplace features',
    features: [
      '5 Vehicle Profiles',
      'Full Service History',
      'AI Valuation & Insights',
      'Insurance Integration',
      'PartSentry Tracking',
      'Document Storage (Unlimited)',
      'Priority Support',
      'Fraud Alerts',
      'Marketplace Listing Discounts'
    ],
    notIncluded: [],
    cta: 'Start Premium Trial',
    popular: true
  },
  {
    name: 'Business',
    price: 29.99,
    currency: 'USD',
    period: 'month',
    description: 'For dealers, garages, and fleet operators',
    features: [
      'Unlimited Vehicle Profiles',
      'Full Service History',
      'AI Valuation & Insights',
      'Insurance Integration',
      'PartSentry Tracking',
      'Document Storage (Unlimited)',
      '24/7 Priority Support',
      'Advanced Analytics',
      'API Access',
      'White-label Options',
      'Team Collaboration'
    ],
    notIncluded: [],
    cta: 'Contact Sales',
    popular: false
  }
];

// Currency conversion helper
export const currencyRates = {
  USD: 1,
  ZiG: 25.5,
  ZAR: 18.2,
  BWP: 13.5
};

export function convertCurrency(amount: number, from: 'USD' | 'ZiG' | 'ZAR' | 'BWP', to: 'USD' | 'ZiG' | 'ZAR' | 'BWP'): number {
  const inUSD = amount / currencyRates[from];
  return inUSD * currencyRates[to];
}

export function formatPrice(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: '$', ZiG: 'ZiG ', ZAR: 'R', BWP: 'P' };
  return `${symbols[currency] || ''}${amount.toLocaleString()}`;
}