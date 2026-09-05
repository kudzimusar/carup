/**
 * Seller Journey 1.0 / S0 — deterministic staging legacy taxonomy mapping.
 *
 * This script NEVER rewrites the historical raw vehicle/import values. It only attaches canonical
 * taxonomy IDs/version/resolution where the global taxonomy can resolve them. Fixture vehicles are
 * excluded using the existing Marketplace fixture contract. Unknown values remain unresolved.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getFixtureExclusion } from '../services/marketplace/marketplaceClassificationRules.js';
import { normalizeVehicleTaxonomyInput } from '../services/taxonomy/vehicleTaxonomyService.js';

const STAGING_REF='eoyenigwevnxwwhyhaer';
const RECEIPT_PATH='seller-s0-taxonomy-backfill-receipt.json';
const TAXONOMY_VERSION='carup-global-vehicle-taxonomy@1.0.0';

function fail(message){throw new Error(message)}
function tlsConfig(){
  const supplied=process.env.DIASPORA_STAGING_CA_CERT;
  if(supplied?.includes('BEGIN CERTIFICATE')) return {rejectUnauthorized:true,ca:supplied};
  try{
    const bundled=readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt',import.meta.url)),'utf8');
    if(bundled.includes('BEGIN CERTIFICATE')) return {rejectUnauthorized:true,ca:bundled};
  }catch{}
  return {rejectUnauthorized:true};
}

function counter(){
  return {
    total:0, fixture_skipped:0, updated:0,
    make_mapped:0, model_mapped:0, year_valid:0, color_mapped:0,
    fuel_mapped:0, transmission_mapped:0, drivetrain_mapped:0,
    make_unresolved:0, model_unresolved:0, color_unresolved:0,
  };
}
const isMapped=r=>r?.state==='canonical'||r?.state==='alias_match';
const url=process.env.DIASPORA_STAGING_DATABASE_URL;
if(!url) fail('DIASPORA_STAGING_DATABASE_URL is not configured');
if(!url.includes(STAGING_REF)) fail('database URL is not approved CarUp staging');

const receipt={
  programme:'Seller Journey 1.0',
  phase:'S0',
  operation:'deterministic_legacy_taxonomy_backfill',
  staging_ref:STAGING_REF,
  candidate_sha:process.env.CANDIDATE_SHA||process.env.GITHUB_SHA||null,
  taxonomy_version:TAXONOMY_VERSION,
  generated_at:new Date().toISOString(),
};

const client=new pg.Client({connectionString:url,ssl:tlsConfig(),statement_timeout:120000});
try{
  await client.connect();
  const vehicleCols=await client.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='vehicles'");
  const vehicleColumnSet=new Set(vehicleCols.rows.map(r=>r.column_name));
  if(!vehicleColumnSet.has('color_taxon_id')) fail('color_taxon_id is absent; apply S0 migrations before backfill');

  const vehicles=await client.query(`
    select vin,owner_id,tenant_id,make,model,generation,trim,year,color,fuel_type,transmission,drivetrain,
           taxonomy_version,make_taxon_id,model_taxon_id,color_taxon_id,fuel_taxon_id,transmission_taxon_id,drivetrain_taxon_id
      from vehicles
     order by vin`);
  const vc=counter();
  await client.query('BEGIN');
  try{
    for(const row of vehicles.rows){
      vc.total+=1;
      if(getFixtureExclusion(row)){
        vc.fixture_skipped+=1;
        continue;
      }
      const t=normalizeVehicleTaxonomyInput(row);
      if(isMapped(t.make)) vc.make_mapped+=1; else if(t.make.state==='unrecognized') vc.make_unresolved+=1;
      if(isMapped(t.model)) vc.model_mapped+=1; else if(t.model.state==='unrecognized') vc.model_unresolved+=1;
      if(t.year.state==='canonical') vc.year_valid+=1;
      if(isMapped(t.color)) vc.color_mapped+=1; else if(t.color.state==='unrecognized') vc.color_unresolved+=1;
      if(isMapped(t.fuel)) vc.fuel_mapped+=1;
      if(isMapped(t.transmission)) vc.transmission_mapped+=1;
      if(isMapped(t.drivetrain)) vc.drivetrain_mapped+=1;

      const resolution={
        make:t.make.state,model:t.model.state,year:t.year.state,color:t.color.state,
        fuel_type:t.fuel.state,transmission:t.transmission.state,drivetrain:t.drivetrain.state,
        body_style:t.body_style.state,seller_condition:t.seller_condition.state,
      };
      const sourceValues={
        make:row.make??null,model:row.model??null,generation:row.generation??null,trim:row.trim??null,
        year:row.year??null,color:row.color??null,fuel_type:row.fuel_type??null,
        transmission:row.transmission??null,drivetrain:row.drivetrain??null,
      };
      await client.query(`
        update vehicles
           set make_taxon_id=$2, model_taxon_id=$3, color_taxon_id=$4,
               fuel_taxon_id=$5, transmission_taxon_id=$6, drivetrain_taxon_id=$7,
               taxonomy_version=$8, taxonomy_resolution=$9::jsonb,
               taxonomy_source_values=$10::jsonb, taxonomized_at=now()
         where vin=$1`,[
        row.vin,t.make.canonical_id,t.model.canonical_id,t.color.canonical_id,
        t.fuel.canonical_id,t.transmission.canonical_id,t.drivetrain.canonical_id,
        t.taxonomy_version,JSON.stringify(resolution),JSON.stringify(sourceValues),
      ]);
      vc.updated+=1;
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }

  const importsExist=await client.query("select to_regclass('public.diaspora_import_orders')::text v");
  const ic={total:0,updated:0,make_mapped:0,model_mapped:0,year_valid:0,make_unresolved:0,model_unresolved:0};
  if(importsExist.rows[0]?.v){
    const imports=await client.query(`
      select id,requested_make,requested_model,requested_year_min,requested_year_max
        from diaspora_import_orders
       where deleted_at is null
       order by id`);
    await client.query('BEGIN');
    try{
      for(const row of imports.rows){
        ic.total+=1;
        const t=normalizeVehicleTaxonomyInput({make:row.requested_make,model:row.requested_model,year:row.requested_year_min});
        if(isMapped(t.make)) ic.make_mapped+=1; else if(t.make.state==='unrecognized') ic.make_unresolved+=1;
        if(isMapped(t.model)) ic.model_mapped+=1; else if(t.model.state==='unrecognized') ic.model_unresolved+=1;
        if(t.year.state==='canonical') ic.year_valid+=1;
        await client.query(`
          update diaspora_import_orders
             set requested_make_taxon_id=$2, requested_model_taxon_id=$3,
                 taxonomy_version=$4, taxonomy_resolution=$5::jsonb,
                 taxonomy_source_values=$6::jsonb, taxonomized_at=now()
           where id=$1`,[
          row.id,t.make.canonical_id,t.model.canonical_id,t.taxonomy_version,
          JSON.stringify({make:t.make.state,model:t.model.state,year:t.year.state}),
          JSON.stringify({make:row.requested_make??null,model:row.requested_model??null,year_min:row.requested_year_min??null,year_max:row.requested_year_max??null}),
        ]);
        ic.updated+=1;
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const versionCount=await client.query(
    "select count(*)::int v from vehicles where taxonomy_version=$1",[TAXONOMY_VERSION]);
  const fixtureCount=vc.fixture_skipped;
  receipt.status='PASS';
  receipt.vehicles={...vc,versioned_rows:versionCount.rows[0]?.v??0};
  receipt.imports=ic;
  receipt.invariants={
    raw_vehicle_values_rewritten:false,
    fixture_rows_skipped:fixtureCount,
    unknown_values_preserved:true,
    exact_or_approved_alias_only:true,
  };
  writeFileSync(RECEIPT_PATH,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({status:'PASS',vehicles:receipt.vehicles,imports:receipt.imports}));
}catch(error){
  receipt.status='FAIL';
  receipt.error=error.message;
  writeFileSync(RECEIPT_PATH,JSON.stringify(receipt,null,2));
  console.error(`::error::${error.message}`);
  process.exitCode=1;
}finally{
  await client.end().catch(()=>{});
}
