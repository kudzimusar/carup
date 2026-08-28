import { describe, expect, it } from 'vitest'
import {
  BODY_STYLES,
  FUEL_TYPES,
  TRANSMISSIONS,
  VEHICLE_COLORS,
  VEHICLE_MAKES,
  VEHICLE_TAXONOMY,
  VEHICLE_TAXONOMY_VERSION,
  canonicalMake,
  canonicalModel,
  modelsForMake,
  taxonomySearchTerms,
} from './vehicleTaxonomy'

describe('CarUp vehicle taxonomy v1', () => {
  it('is dense, deterministic and unique at make/model level', () => {
    expect(VEHICLE_TAXONOMY_VERSION).toBe('carup-global-vehicle-taxonomy@1.0.0')
    expect(VEHICLE_MAKES.length).toBeGreaterThan(30)
    expect(new Set(VEHICLE_MAKES.map(make => make.toLowerCase())).size).toBe(VEHICLE_MAKES.length)

    for (const make of VEHICLE_TAXONOMY) {
      expect(make.make.trim()).not.toBe('')
      expect(make.models.length).toBeGreaterThan(0)
      const models = make.models.map(model => model.name.toLowerCase())
      expect(new Set(models).size).toBe(models.length)
    }
  })

  it('canonicalizes common import-market aliases without rejecting unknown makes', () => {
    expect(canonicalMake('vw')).toBe('Volkswagen')
    expect(canonicalMake('Mercedes')).toBe('Mercedes-Benz')
    expect(canonicalMake('Citroen')).toBe('Citroën')
    expect(canonicalMake('Unknown Coachworks')).toBe('Unknown Coachworks')
  })

  it('canonicalizes model aliases inside the selected make', () => {
    expect(canonicalModel('Honda', 'Jazz')).toBe('Fit')
    expect(canonicalModel('Toyota', 'Yaris')).toBe('Vitz')
    expect(canonicalModel('Mazda', 'Mazda3')).toBe('Axela')
    expect(canonicalModel('Nissan', 'Micra')).toBe('March')
  })

  it('offers Zimbabwe-relevant vehicle and fitment vocabulary', () => {
    expect(modelsForMake('Toyota').map(model => model.name)).toContain('Hilux')
    expect(modelsForMake('Isuzu').map(model => model.name)).toContain('D-Max')
    expect(BODY_STYLES).toEqual(expect.arrayContaining(['Pickup', 'SUV', 'Truck', 'Minibus']))
    expect(VEHICLE_COLORS).toEqual(expect.arrayContaining(['White', 'Silver', 'Black', 'Other']))
    expect(FUEL_TYPES).toEqual(expect.arrayContaining(['Petrol', 'Plug-in Hybrid', 'Electric']))
    expect(TRANSMISSIONS).toEqual(expect.arrayContaining(['Automatic', 'Manual', 'CVT', 'DCT']))
    expect(taxonomySearchTerms('Volkswagen', 'Polo')).toEqual(expect.arrayContaining(['Volkswagen', 'VW', 'Polo']))
  })
})
