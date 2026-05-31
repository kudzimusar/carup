const fs = require('fs');

let serverFile = fs.readFileSync('backend/server.js', 'utf8');

const newEndpoint = `
app.post('/api/compliance/registry/:id/update', authorizeRole(['government', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from('registry_verifications')
      .update({ status, notes, verified_by: req.userContext.userId, verification_date: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

`;

serverFile = serverFile.replace("app.get('/api/admin/health'", newEndpoint + "app.get('/api/admin/health'");
fs.writeFileSync('backend/server.js', serverFile);
console.log('patched');
