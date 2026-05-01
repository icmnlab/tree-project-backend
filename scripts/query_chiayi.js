require('dotenv').config({path:require('path').resolve(__dirname,'..','.env')});
const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const r=await p.query("SELECT * FROM project_areas WHERE city LIKE '%嘉義%' OR area_name LIKE '%嘉義%' OR area_name LIKE '%布袋%' ORDER BY id");
  console.log('--AREAS--');
  console.log(JSON.stringify(r.rows,null,2));
  const r2=await p.query("SELECT project_location, count(*)::int AS c FROM tree_survey WHERE project_location LIKE '%嘉義%' OR project_location LIKE '%布袋%' GROUP BY project_location");
  console.log('--TREE--');
  console.log(JSON.stringify(r2.rows,null,2));
  const r3=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='projects' ORDER BY ordinal_position");
  console.log('--PROJECTS COLUMNS--');
  console.log(r3.rows.map(r=>r.column_name).join(','));
  const r4=await p.query("SELECT * FROM projects WHERE project_code LIKE '%布袋%' OR project_code LIKE '%嘉義%' ORDER BY id LIMIT 20");
  console.log('--PROJECTS--');
  console.log(JSON.stringify(r4.rows,null,2));
  await p.end();
})();
