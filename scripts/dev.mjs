import http from 'node:http';
import {spawnSync, spawn} from 'node:child_process';
import {createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.PORT||4173);
const template=resolve(process.env.BAMBU_TEMPLATE||join(root,'assets','h2d-empty.3mf'));
const jobs=join(root,'.tmp','jobs');mkdirSync(jobs,{recursive:true});
const build=spawnSync('python3',[join(root,'build.py')],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);

function json(res,status,value){const body=Buffer.from(JSON.stringify(value,null,2));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':body.length});res.end(body);}
function safeJob(id){return /^[a-f0-9-]{36}$/.test(id);}
function file(res,path,type='application/octet-stream',download){if(!existsSync(path)){json(res,404,{error:'Not found'});return;}const headers={'content-type':type};if(download)headers['content-disposition']=`attachment; filename="${download}"`;res.writeHead(200,headers);createReadStream(path).pipe(res);}
function readBody(req,limit=8*1024*1024){return new Promise((resolveBody,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(Error('Request too large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>resolveBody(Buffer.concat(chunks)));req.on('error',reject);});}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{ok:true,template:existsSync(template),templatePath:template,python:'python3',generation:'regional-patterns'});
    if(req.method==='POST'&&url.pathname==='/api/3mf'){
      if(!existsSync(template))return json(res,503,{error:`Missing H2D template: ${template}. Set BAMBU_TEMPLATE or place assets/h2d-empty.3mf.`});
      const recipe=JSON.parse((await readBody(req)).toString('utf8'));const id=randomUUID();const recipePath=join(jobs,id+'.recipe.json'),outPath=join(jobs,id+'.3mf');writeFileSync(recipePath,JSON.stringify(recipe,null,2));
      const proc=spawnSync('python3',[join(root,'scripts','generate_3mf.py'),'generate','--template',template,'--recipe',recipePath,'--output',outPath],{encoding:'utf8',maxBuffer:8*1024*1024});
      if(proc.status!==0){let detail=proc.stderr.trim()||proc.stdout.trim()||'Generator failed';try{detail=JSON.parse(detail).error||detail}catch{}return json(res,422,{error:detail});}
      const report=JSON.parse(proc.stdout);const hp=report.panel.hp||'custom';const pattern=(report.pattern.id||'pattern').replace(/[^a-z0-9-]+/gi,'-');const filename=`zudo-blank-${hp}hp-${pattern}.3mf`;
      return json(res,200,{id,filename,downloadUrl:`/api/3mf/${id}/download`,report});
    }
    const m=url.pathname.match(/^\/api\/3mf\/([a-f0-9-]{36})\/download$/);if(req.method==='GET'&&m&&safeJob(m[1]))return file(res,join(jobs,m[1]+'.3mf'),'model/3mf',`zudo-bambu-blank-${m[1].slice(0,8)}.3mf`);
    if(req.method==='GET'&&url.pathname==='/vendor/three.module.js')return file(res,join(root,'node_modules','three','build','three.module.js'),'text/javascript; charset=utf-8');
    if(req.method==='GET'&&url.pathname==='/vendor/OrbitControls.js'){const path=join(root,'node_modules','three','examples','jsm','controls','OrbitControls.js');if(!existsSync(path))return json(res,503,{error:'Run npm install first.'});let body=readFileSync(path,'utf8').replace(`from 'three';`,`from '/vendor/three.module.js';`);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});return res.end(body);}
    if(req.method==='GET'&&url.pathname.startsWith('/src/')){const rel=url.pathname.slice(5);if(!/^[a-z0-9._-]+$/i.test(rel))return json(res,400,{error:'Bad source path'});return file(res,join(root,'web','src',rel),'text/javascript; charset=utf-8');}
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html'))return file(res,join(root,'dist','index.html'),'text/html; charset=utf-8');
    return json(res,404,{error:'Not found'});
  }catch(error){json(res,500,{error:error.message});}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Zudo Bambu Blanks: http://127.0.0.1:${port}`);console.log(`Template: ${template}`);});
