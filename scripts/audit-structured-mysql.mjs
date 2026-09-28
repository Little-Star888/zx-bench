import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const name = `zxbench-so-mysql-${process.pid}`;
const image = 'mysql:8.4.11';
const password = 'zxbench-audit';
const docker = (args,input,timeout=15000) => execFileSync('docker',args,{
  input,encoding:'utf8',timeout,maxBuffer:2*1024*1024,windowsHide:true,
  stdio:['pipe','pipe','pipe'],
});
const mysql = (database,sql) => docker(['exec','-i','-e',`MYSQL_PWD=${password}`,name,
  'mysql','--batch','--raw','--skip-column-names','-uroot',
  ...(database ? ['-D',database] : [])],sql,20000).trim();
const errorText = error => String(error.stderr || error.message).trim().slice(0,600);
const extract = source => {
  const fenced = /```sql\s*\n([\s\S]*?)\n```/i.exec(source);
  const sql = (fenced?.[1] ?? source).trim();
  if (/(?:^|\n)\s*(?:\\|source\b|system\b|tee\b|pager\b)/i.test(sql))
    throw new Error('mysql client command rejected');
  return sql;
};
const fixture = `
CREATE TABLE customers(id BIGINT PRIMARY KEY,name VARCHAR(100));
CREATE TABLE products(id BIGINT PRIMARY KEY,name VARCHAR(100),price DECIMAL(12,2),stock INT);
CREATE TABLE orders(id BIGINT AUTO_INCREMENT PRIMARY KEY,customer_id BIGINT,
  total_amount DECIMAL(12,2),status VARCHAR(30),created_at DATETIME);
CREATE TABLE order_items(id BIGINT AUTO_INCREMENT PRIMARY KEY,order_id BIGINT,
  product_id BIGINT,quantity INT,unit_price DECIMAL(12,2),price DECIMAL(12,2),
  subtotal DECIMAL(12,2),line_total DECIMAL(12,2),created_at DATETIME);
INSERT INTO customers VALUES(1,'one');
INSERT INTO products VALUES(1,'one',10.00,5),(2,'two',7.00,3);`;
const snapshot = `SELECT JSON_OBJECT(
  'orders',(SELECT COUNT(*) FROM orders),'items',(SELECT COUNT(*) FROM order_items),
  'stock1',(SELECT stock FROM products WHERE id=1),
  'stock2',(SELECT stock FROM products WHERE id=2),
  'total',(SELECT COALESCE(SUM(total_amount),0) FROM orders));`;
const db = new DatabaseSync('apps/data/zxbench.db',{readOnly:true});
const query = db.prepare(`SELECT r.evalRunId,r.modelOutput FROM ScenarioResult r
  JOIN EvalRun e ON e.id=r.evalRunId WHERE e.status='completed'
  AND r.scenarioId=? AND r.modelOutput IS NOT NULL
  ORDER BY e.createdAt DESC LIMIT 6`);
const ddlRows = query.all('SO-CN-015');
const procRows = query.all('SO-CN-017');
db.close();
const ddl = [], procedures = [];
try {
  docker(['run','--rm','-d','--name',name,'--pull','never','--network','none',
    '--cpus','2','--memory','1g','--pids-limit','200',
    '-e',`MYSQL_ROOT_PASSWORD=${password}`,image,
    '--character-set-server=utf8mb4','--collation-server=utf8mb4_unicode_ci']);
  let ready = false;
  for (let i=0;i<60;i++) {
    try { mysql(null,'SELECT 1;'); ready=true; break; }
    catch { await new Promise(resolve=>setTimeout(resolve,500)); }
  }
  if (!ready) throw new Error('MySQL did not become ready');
  for (const [index,row] of ddlRows.entries()) {
    const database = `ddl_${index}`;
    const item = {runId:row.evalRunId,compiled:false,error:null,tables:[]};
    try {
      mysql(null,`CREATE DATABASE ${database};`);
      mysql(database,extract(row.modelOutput));
      item.compiled = true;
      item.tables = mysql(database,`SELECT table_name,engine,table_collation
        FROM information_schema.tables WHERE table_schema='${database}' ORDER BY table_name;`)
        .split(/\r?\n/).filter(Boolean).map(line=>line.split('\t'));
    } catch(error) { item.error=errorText(error); }
    ddl.push(item);
  }
  for (const [index,row] of procRows.entries()) {
    const item = {runId:row.evalRunId,compiled:false,successValid:false,
      rollbackValid:false,error:null,success:null,rollback:null};
    let sql;
    try { sql=extract(row.modelOutput); }
    catch(error) { item.error=errorText(error); procedures.push(item); continue; }
    const proc = /CREATE\s+PROCEDURE\s+`?([A-Za-z_][\w]*)`?\s*\(/i.exec(sql)?.[1];
    item.procedure=proc ?? null;
    if (!proc) { item.error='CREATE PROCEDURE not found'; procedures.push(item); continue; }
    for (const [world,shortage] of [false,true].entries()) {
      const database = `proc_${index}_${world}`;
      try {
        mysql(null,`CREATE DATABASE ${database};`);
        mysql(database,fixture);
        mysql(database,sql);
        item.compiled = true;
        const key = /\$\.item_id\b/.test(sql) ? 'item_id' : 'product_id';
        const payload = JSON.stringify([{[key]:1,quantity:2},{[key]:2,quantity:shortage?9:1}]);
        const call = `CALL ${proc}(1,'${payload}',@order_id,@total); SELECT @order_id,@total;`;
        try { item[shortage?'rollbackCall':'successCall']=mysql(database,call); }
        catch(error) { item[shortage?'rollbackError':'successError']=errorText(error); }
        item[shortage?'rollback':'success']=JSON.parse(mysql(database,snapshot));
      } catch(error) { item.error=errorText(error); break; }
    }
    const success=item.success, rollback=item.rollback;
    item.successValid=Boolean(success && success.orders===1 && success.items===2 &&
      success.stock1===3 && success.stock2===2 && Number(success.total)===27 &&
      !item.successError);
    item.rollbackValid=Boolean(rollback && rollback.orders===0 && rollback.items===0 &&
      rollback.stock1===5 && rollback.stock2===3 && Number(rollback.total)===0);
    procedures.push(item);
  }
} finally {
  try { docker(['stop',name],undefined,15000); } catch { /* container stopped */ }
}
writeFileSync('data/pilots/structured-mysql-audit.json',JSON.stringify({
  mysqlVersion:'8.4.11',ddl:{id:'SO-CN-015',results:ddl},
  procedure:{id:'SO-CN-017',fixture:'two products; successful order and insufficient-stock rollback',results:procedures},
},null,2)+'\n');
console.log(JSON.stringify({ddl:ddl.map(x=>({compiled:x.compiled,tables:x.tables.length,error:x.error})),
  procedures:procedures.map(x=>({compiled:x.compiled,successValid:x.successValid,
    rollbackValid:x.rollbackValid,error:x.error}))}));
