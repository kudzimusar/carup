/**
 * Trust-gated Escrow routes — Workstream F / Issue #164 Phase 6.
 * Buyer/seller/listing terms/eligibility/idempotency are all server-derived.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getSession, listSessionsForVin, transitionEscrow, ingestEscrowWebhook } from '../services/escrow/escrowTrustService.js';
import { buildMarketplaceEscrowGateContext, requestMarketplaceEscrow, toPublicMarketplaceEscrowSession } from '../services/transaction/marketplaceTransactionAuthority.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';
const router=express.Router();
function actorFrom(req){return{id:req.userContext?.id||req.userContext?.userId||null,role:req.userContext?.effectiveRole||req.userContext?.role||null};}
async function serverGateContextFor(vin){return buildMarketplaceEscrowGateContext(await getTrustDecision(vin));}
router.post('/api/vehicles/:vin/escrow',authorizeRole(['buyer','owner','dealer','admin']),async(req,res,next)=>{try{const session=await requestMarketplaceEscrow(req.params.vin,{actor:actorFrom(req)});res.status(201).json({session});}catch(err){next(err);}});
router.get('/api/vehicles/:vin/escrow',authorizeRole(['buyer','owner','dealer','admin','reviewer']),async(req,res,next)=>{try{const sessions=await listSessionsForVin(req.params.vin,actorFrom(req));res.json({sessions:sessions.map(toPublicMarketplaceEscrowSession)});}catch(err){next(err);}});
router.get('/api/escrow/:id',authorizeRole(['buyer','owner','dealer','admin','reviewer']),async(req,res,next)=>{try{const session=await getSession(req.params.id,actorFrom(req));if(!session)return res.status(404).json({error:'escrow session not found'});const publicSession=toPublicMarketplaceEscrowSession(session);publicSession.events=(session.events||[]).map(event=>({from_status:event.from_status||null,to_status:event.to_status||null,reason:event.reason||null,created_at:event.created_at||null}));res.json({session:publicSession});}catch(err){next(err);}});
router.patch('/api/escrow/:id/transition',authorizeRole(['buyer','owner','dealer','admin','reviewer']),async(req,res,next)=>{try{const actor=actorFrom(req);const current=await getSession(req.params.id,actor);if(!current)return res.status(404).json({error:'escrow session not found'});const gateContext=await serverGateContextFor(current.vin);const session=await transitionEscrow(req.params.id,req.body?.to_status,{actor,reason:req.body?.reason,gateContext});res.json({session:toPublicMarketplaceEscrowSession(session)});}catch(err){next(err);}});
router.post('/api/escrow/webhook',express.json({verify:(req,_res,buf)=>{req.rawBody=buf.toString();}}),async(req,res,next)=>{try{const result=await ingestEscrowWebhook({payloadString:req.rawBody||JSON.stringify(req.body||{}),signature:req.headers['x-signature'],timestamp:req.headers['x-timestamp'],idempotencyKey:req.headers['idempotency-key'],body:req.body});res.status(result.applied?200:(result.signature_valid?202:401)).json(result);}catch(err){next(err);}});
export default router;
