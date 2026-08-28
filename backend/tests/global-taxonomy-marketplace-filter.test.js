import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summaryMatchesBodyStyleFacet,
  summaryMatchesFuelFacet,
  summaryMatchesMakeFacet,
  summaryMatchesModelFacet,
  summaryMatchesTransmissionFacet,
} from '../services/marketplace/listingSummaryService.js';

const listing={make:'Volkswagen',model:'Polo',fuel_type:'Petrol',transmission:'DCT',body_style:'Hatchback'};
test('Marketplace facets resolve global taxonomy aliases',()=>{
  assert.equal(summaryMatchesMakeFacet(listing,'VW'),true);
  assert.equal(summaryMatchesModelFacet({ ...listing, make:'Honda',model:'Fit'},'Jazz','Honda'),true);
  assert.equal(summaryMatchesFuelFacet(listing,'Gasoline'),true);
  assert.equal(summaryMatchesTransmissionFacet(listing,'DSG'),true);
  assert.equal(summaryMatchesBodyStyleFacet({...listing,body_style:'Wagon'},'Estate'),true);
});
test('unrelated taxonomy values do not match',()=>{
  assert.equal(summaryMatchesMakeFacet(listing,'Toyota'),false);
  assert.equal(summaryMatchesFuelFacet(listing,'Diesel'),false);
  assert.equal(summaryMatchesBodyStyleFacet(listing,'Pickup'),false);
});
