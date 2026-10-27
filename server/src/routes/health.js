const express=require('express');const{testConnection,isTestMode}=require('../db');const router=express.Router();
router.get('/health',(req,res)=>res.status(200).json({status:'healthy',service:'ullas-api',timestamp:new Date().toISOString(),environment:process.env.NODE_ENV||'development'}));
router.get('/ready',async(req,res)=>{if(isTestMode())return res.json({status:'ready',database:'test-memory-only'});const result=await testConnection();return res.status(result.ok?200:503).json({status:result.ok?'ready':'not_ready',database:result.ok?'connected':'unavailable'});});
module.exports=router;
