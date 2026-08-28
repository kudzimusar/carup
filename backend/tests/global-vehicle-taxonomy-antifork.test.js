import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const read=path=>fs.readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('global taxonomy authority is not forked by primary consumers',()=>{
  const guest=read('web/src/pages/GuestSell.tsx');
  const seller=read('web/src/pages/dashboard/owner/SellVehicle.tsx');
  const marketplace=read('web/src/pages/Marketplace.tsx');
  const mobile=read('mobile/app/(tabs)/marketplace.tsx');
  const verify=read('web/src/pages/VehicleSearch.tsx');
  const imports=read('web/src/pages/diaspora/DiasporaTrade.tsx');

  assert.doesNotMatch(guest,/const\s+FUELS\s*=|const\s+TRANSMISSIONS\s*=/);
  assert.doesNotMatch(seller,/year:\s*['"]2020['"]/);
  assert.doesNotMatch(marketplace,/const\s+fuelTypes\s*=\s*\[['"]All['"],\s*['"]Petrol['"]/);
  assert.doesNotMatch(mobile,/const\s+MAKE_FILTERS\s*=/);
  assert.match(verify,/VEHICLE_MAKES/);
  assert.match(imports,/VEHICLE_MAKES/);
  assert.match(imports,/modelsForMake/);
});

test('global catalog is the source used by backend and web/mobile adapters',()=>{
  const backend=read('backend/services/taxonomy/vehicleTaxonomyService.js');
  const web=read('web/src/data/vehicleTaxonomy.ts');
  const mobile=read('mobile/app/(tabs)/marketplace.tsx');
  assert.match(backend,/shared\/taxonomy\/vehicle\/catalog\.json/);
  assert.match(web,/@shared\/taxonomy\/vehicle/);
  assert.match(mobile,/@shared\/taxonomy\/vehicle/);
});
