require("dotenv").config();
const {BigQuery}=require("@google-cloud/bigquery");
const fs=require("fs");
const bq=new BigQuery({projectId:process.env.GCP_PROJECT_ID||"savvy-gtm-analytics",keyFilename:process.env.GOOGLE_APPLICATION_CREDENTIALS});
const R={};
async function q(name,sql){
  process.stderr.write("Running "+name+"...\n");
  try{
    const [rows]=await bq.query({query:sql});
    R[name]=rows;
    process.stderr.write("  -> "+rows.length+" rows\n");
  }catch(e){
    R[name]={error:e.message};
    process.stderr.write("  -> ERR: "+e.message.substring(0,200)+"\n");
  }
}
test line
