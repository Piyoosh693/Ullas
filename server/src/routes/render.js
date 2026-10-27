const express=require('express');const{testConnection,isTestMode}=require('../db');const router=express.Router();
router.get('/render/status',async(req,res)=>{
  if(isTestMode())return res.json({service:'ullas-api',deploymentTarget:'render',database:{ok:false,status:'test-mode'}});
  const result=await testConnection();
  // This endpoint is public; never expose connection errors, missing table names, or migration details.
  return res.status(result.ok?200:503).json({service:'ullas-api',deploymentTarget:'render',database:{ok:result.ok,status:result.ok?'ready':'not_ready'}});
});
module.exports=router;
