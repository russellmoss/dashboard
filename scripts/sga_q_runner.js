require('dotenv').config();
const {BigQuery}=require('@google-cloud/bigquery');
const fs=require('fs');
const Q=require('./sga_queries.json');
const bq=new BigQuery({projectId:process.env.GCP_PROJECT_ID||'savvy-gtm-analytics',keyFilename:process.env.GOOGLE_APPLICATION_CREDENTIALS});
const R={};
async function run(name,sql){
  console.error('Running '+name+'...');
  try{
    const [rows]=await bq.query({query:sql});
    R[name]=rows;
    console.error('  -> '+rows.length+' rows');
  }catch(e){
    R[name]={error:e.message};
    console.error('  -> ERR: '+e.message.substring(0,150));
  }
}
async function main(){
  await run('q1_activity_volume',Q.q1);
  await run('q2_sms_behavior',Q.q2);
  await run('q3_time_of_day',Q.q3);
  await run('q4_response_speed',Q.q4);
  await run('q5_call_behavior',Q.q5);
  await run('q6_weekly_playbook',Q.q6);
  await run('q7_sms_intent',Q.q7);
  fs.writeFileSync('sga_query_results.json',JSON.stringify(R,null,2));
  console.log('DONE');
}
main().catch(e=>{console.error(e);process.exit(1);});