const express=require('express');
const {AllianceProspects,AllianceWhatsappFollowupJobs,AllianceWhatsappCampaignRecipients}=require('../models');
const {claimAllianceWhatsAppFollowups,sendAllianceWhatsAppFollowup}=require('../services/alliance-whatsapp-campaign-worker');

function createAllianceAutomationRouter({io}){
  const router=express.Router();
  router.get('/whatsapp-followups/due',async(req,res)=>{try{const jobs=await claimAllianceWhatsAppFollowups(req.query.limit,req.headers['x-n8n-execution-id']||`n8n-${Date.now()}`);res.json({jobs,count:jobs.length});}catch(error){console.error('[Alliance n8n due]',error);res.status(500).json({error:error.message});}});
  router.post('/whatsapp-followups/:id/send',async(req,res)=>{try{const result=await sendAllianceWhatsAppFollowup(req.params.id,io);res.json({success:true,...result});}catch(error){console.error('[Alliance n8n send]',error.response?.data||error.message);res.status(error.status||502).json({error:error.response?.data?.error?.message||error.message});}});
  router.post('/prospects/:id/status',async(req,res)=>{try{const status=String(req.body.status||'').trim().toLowerCase();const allowed=['pending','in_process','interested','converted','closed','not_interested','unsubscribed'];if(!allowed.includes(status))return res.status(400).json({error:'Invalid Alliance prospect status.'});const prospect=await AllianceProspects.findOneAndUpdate({id:req.params.id},{$set:{status,updated_at:new Date()}},{new:true,projection:{_id:0,id:1,status:1}}).lean();if(!prospect)return res.status(404).json({error:'Prospect not found.'});if(['converted','closed','not_interested','unsubscribed'].includes(status)){await AllianceWhatsappFollowupJobs.updateMany({prospect_id:req.params.id,status:{$in:['pending','claimed']}},{$set:{status:'cancelled',error_message:`Prospect ${status}.`}});await AllianceWhatsappCampaignRecipients.updateMany({prospect_id:req.params.id,status:'queued'},{$set:{status:'cancelled',error_message:`Prospect ${status}.`}});}res.json({success:true,prospect});}catch(error){res.status(500).json({error:error.message});}});
  return router;
}
module.exports=createAllianceAutomationRouter;
