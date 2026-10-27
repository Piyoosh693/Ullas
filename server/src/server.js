require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const app=require('./app');
const {validateEnv}=require('./config');
const {testConnection,closePool}=require('./db');
const {dispatchOutboxBatch}=require('./email');
async function main(){
  const config=validateEnv(process.env);
  // Migrations run as an explicit release/pre-deploy step, not on every web-service restart.
  const readiness = await testConnection();
  if (!readiness.ok) throw new Error(`Database is not ready; run migrations before starting the API (${readiness.reason || 'required schema is missing'}).`);
  const server=app.listen(config.port,()=>console.log(`Ullas API listening on port ${config.port}`));
  const dispatcher=setInterval(()=>dispatchOutboxBatch(20).catch(e=>console.error('Outbox retry failed',{code:e.code || 'OUTBOX_RETRY_ERROR', ...(process.env.NODE_ENV === 'production' ? {} : { message:e.message })})),60_000);
  dispatcher.unref();
  const shutdown=async()=>{clearInterval(dispatcher);server.close(async()=>{await closePool();process.exit(0);});setTimeout(()=>process.exit(1),10_000).unref();};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
main().catch((error)=>{console.error('Ullas startup failed:',error.message);process.exit(1);});
