import fs from 'fs';

const serverFile = 'backend/server.js';
let content = fs.readFileSync(serverFile, 'utf8');

const insertion = fs.readFileSync('backend/scripts/phase5_endpoints.js', 'utf8');

if (!content.includes('PHASE 5: OWNER OS')) {
  content = content.replace('app.listen(PORT, () => {', insertion + '\napp.listen(PORT, () => {');
  fs.writeFileSync(serverFile, content, 'utf8');
  console.log('Inserted successfully.');
} else {
  console.log('Already inserted.');
}
