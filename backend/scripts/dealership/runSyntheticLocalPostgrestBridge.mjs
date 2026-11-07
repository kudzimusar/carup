/**
 * D10 disposable CI-only loopback adapter: @supabase/supabase-js expects
 * /rest/v1/* while directly self-hosted PostgREST serves /*.
 * No fixtures or fake query responses. Every data read/write is forwarded
 * to the REAL native PostgreSQL 17 database through PostgREST.
 * Auth and Realtime remain explicitly unsupported. Storage requests proxy to
 * a separately booted real self-hosted Supabase Storage API writing to its own
 * disposable filesystem volume and PostgreSQL object ledger. It is NOT a mock
 * storage endpoint and it cannot activate real legal/business authority.
 */
import http from 'node:http';
const listen=54321,restPort=3004,storagePort=5000,host='127.0.0.1';
const server=http.createServer((req,res)=>{
  const full=req.url||'';
  if(req.method==='GET'&&full==='/bridge-health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({mode:'NATIVE_POSTGRES_POSTGREST_PASSTHROUGH',
      storage_api_route:'PASSTHROUGH_ONLY',real_browser_only:true}));
    return;
  }
  const isRest=full.startsWith('/rest/v1/');
  const isStorage=full.startsWith('/storage/v1/');
  if(!isRest && !isStorage){
    res.writeHead(404,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'UNSUPPORTED_SUPABASE_ENDPOINT_IN_DISPOSABLE_TEST'}));
    return;
  }
  // Never fabricate Storage responses. The object API, auth, bucket policy and
  // immutable file contents belong to the upstream real Storage API service.
  const upstreamPort=isRest?restPort:storagePort;
  const target=full.slice((isRest?'/rest/v1':'/storage/v1').length);
  const headers={...req.headers,host:host+':'+upstreamPort};
  delete headers.connection;
  const upstream=http.request({
    hostname:host,port:upstreamPort,method:req.method,
    path:target,headers
  },response=>{
    res.writeHead(response.statusCode||502,response.headers);
    response.pipe(res);
  });
  upstream.on('error',error=>{
    if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'REAL_POSTGREST_UNAVAILABLE',detail:error.message}));
  });
  req.pipe(upstream);
});
server.listen(listen,host,()=>{
 console.log('DEALER_REAL_POSTGREST_BRIDGE_READY: localhost:'+listen);
});
process.on('SIGTERM',()=>server.close());
