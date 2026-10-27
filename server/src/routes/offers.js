const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const router = express.Router(); const offers = new Map();
const schema = z.object({ title:z.string().trim().min(3).max(120), description:z.string().trim().min(10).max(2000), status:z.enum(['draft','published','archived']).default('draft') }).strict();
function mapRow(r){ return { id:r.id,userId:r.user_id,title:r.title,description:r.description,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at }; }
router.get('/offers', async(req,res)=>{ try { const list = isTestMode() ? [...offers.values()].filter(x=>x.status==='published') : (await query("SELECT * FROM offers WHERE status='published' ORDER BY created_at DESC LIMIT 200")).rows.map(mapRow); return res.json({offers:list}); }catch(e){return errorResponse(res,e,'Could not load offers');} });
router.post('/offers',requireAuth,async(req,res)=>{ if(!['professional','admin'].includes(req.user.role))return res.status(403).json({error:'Only professionals and admins can publish offers'}); const p=schema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid offer payload'}); try { if(isTestMode()){ const item={id:id(),userId:req.user.id,...p.data,createdAt:new Date().toISOString()}; offers.set(item.id,item);return res.status(201).json({offer:item});} const r=await query('INSERT INTO offers(id,user_id,title,description,status) VALUES($1,$2,$3,$4,$5) RETURNING *',[id(),req.user.id,p.data.title,p.data.description,p.data.status]);return res.status(201).json({offer:mapRow(r.rows[0])}); }catch(e){return errorResponse(res,e,'Could not create offer');} });
router.put('/offers/:id',requireAuth,async(req,res)=>{ if(!['professional','admin'].includes(req.user.role))return res.status(403).json({error:'Only professionals and admins can manage offers'}); const p=schema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid offer payload'});try{if(isTestMode()){const old=offers.get(req.params.id);if(!old)return res.status(404).json({error:'Offer not found'});if(old.userId!==req.user.id&&req.user.role!=='admin')return res.status(403).json({error:'Not allowed to update this offer'});const item={...old,...p.data,updatedAt:new Date().toISOString()};offers.set(item.id,item);return res.json({offer:item});}const old=await query('SELECT * FROM offers WHERE id=$1',[req.params.id]);if(!old.rowCount)return res.status(404).json({error:'Offer not found'});if(old.rows[0].user_id!==req.user.id&&req.user.role!=='admin')return res.status(403).json({error:'Not allowed to update this offer'});const r=await query('UPDATE offers SET title=$2,description=$3,status=$4,updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,p.data.title,p.data.description,p.data.status]);return res.json({offer:mapRow(r.rows[0])});}catch(e){return errorResponse(res,e,'Could not update offer');}});

router.get('/offers/mine', requireAuth, async (req, res) => {
  try {
    if (isTestMode()) {
      const list = [...offers.values()].filter((item) => item.userId === req.user.id || req.user.role === 'admin');
      return res.json({ offers: list });
    }
    const result = await query(req.user.role === 'admin'
      ? 'SELECT * FROM offers ORDER BY updated_at DESC LIMIT 500'
      : 'SELECT * FROM offers WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 200', req.user.role === 'admin' ? [] : [req.user.id]);
    return res.json({ offers: result.rows.map(mapRow) });
  } catch (error) { return errorResponse(res, error, 'Could not load your offers'); }
});
module.exports={router,offers};
