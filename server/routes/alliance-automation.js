const express=require('express');
const db=require('../db/connection');
const {claimAllianceWhatsAppFollowups,sendAllianceWhatsAppFollowup}=require('../services/alliance-whatsapp-campaign-worker');

function createAllianceAutomationRouter({io}){
  const router=express.Router();
  router.get('/whatsapp-followups/due',async(req,res)=>{try{const jobs=await claimAllianceWhatsAppFollowups(req.query.limit,req.headers['x-n8n-execution-id']||`n8n-${Date.now()}`);res.json({jobs,count:jobs.length});}catch(error){console.error('[Alliance n8n due]',error);res.status(500).json({error:error.message});}});
  router.post('/whatsapp-followups/:id/send',async(req,res)=>{try{const result=await sendAllianceWhatsAppFollowup(req.params.id,io);res.json({success:true,...result});}catch(error){console.error('[Alliance n8n send]',error.response?.data||error.message);res.status(error.status||502).json({error:error.response?.data?.error?.message||error.message});}});
  router.post('/prospects/:id/status',async(req,res)=>{try{const status=String(req.body.status||'').trim().toLowerCase();const allowed=['pending','in_process','interested','converted','closed','not_interested','unsubscribed'];if(!allowed.includes(status))return res.status(400).json({error:'Invalid Alliance prospect status.'});const result=await db.query(`UPDATE alliance_prospects SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status`,[status,req.params.id]);if(!result.rowCount)return res.status(404).json({error:'Prospect not found.'});if(['converted','closed','not_interested','unsubscribed'].includes(status)){await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='cancelled',error_message=$1 WHERE prospect_id=$2 AND status IN ('pending','claimed')`,[`Prospect ${status}.`,req.params.id]);await db.query(`UPDATE alliance_whatsapp_campaign_recipients SET status='cancelled',error_message=$1 WHERE prospect_id=$2 AND status='queued'`,[`Prospect ${status}.`,req.params.id]);}res.json({success:true,prospect:result.rows[0]});}catch(error){res.status(500).json({error:error.message});}});
  return router;
}
module.exports=createAllianceAutomationRouter;
