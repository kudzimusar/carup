import fs from 'fs';

const hookFile = 'src/hooks/useCarUpApi.ts';
let content = fs.readFileSync(hookFile, 'utf8');

const insertion = `
  const unsaveVehicle = useCallback(async (vin: string) => {
    return fetchApi(\`/vehicles/saved/\${vin}\`, { method: 'DELETE' })
  }, [fetchApi])
`;

if (!content.includes('unsaveVehicle')) {
  content = content.replace('const saveVehicle =', insertion + '\n  const saveVehicle =');
  content = content.replace('saveVehicle,', 'unsaveVehicle,\n    saveVehicle,');
  fs.writeFileSync(hookFile, content, 'utf8');
  console.log('Inserted hook successfully.');
}
