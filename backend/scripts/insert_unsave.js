import fs from 'fs';

const serverFile = 'backend/server.js';
let content = fs.readFileSync(serverFile, 'utf8');

const insertion = `
// DELETE /api/vehicles/saved/:vin - Remove a saved vehicle
app.delete('/api/vehicles/saved/:vin', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { vin } = req.params
    const { error } = await supabase
      .from('saved_vehicles')
      .delete()
      .eq('user_id', req.userContext.id)
      .eq('vin', vin)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    console.error('Error removing saved vehicle:', error)
    res.status(500).json({ error: error.message })
  }
})
`;

if (!content.includes('app.delete(\'/api/vehicles/saved/:vin\'')) {
  content = content.replace('// GET /api/service-history/me', insertion + '\n// GET /api/service-history/me');
  fs.writeFileSync(serverFile, content, 'utf8');
  console.log('Inserted successfully.');
}
