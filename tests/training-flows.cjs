const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
async function withApp(check,seed){
 const server=createServer((req,res)=>{if(req.url.split('?')[0]==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(join(__dirname,'..','index.html')))}else{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(3000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(seed=>{document.querySelector('#welcome')?.remove();document.documentElement.classList.remove('locked');if(seed){S=normalize({...freshState(),...seed});commit();}},seed);await check(page);assert.deepEqual(errors,[])}finally{await browser.close();await new Promise(r=>server.close(r))}
}
test('existing users get six body-part entry points without losing templates or history',()=>withApp(async p=>{
 await p.locator('#tabseg button[data-v="lift"]').click();
 assert.equal(await p.locator('[data-act="lift-group"]').count(),6);
 await p.locator('[data-act="lift-group"][data-g="chest"]').click();
 await p.waitForURL('**/#lift/chest');
 assert.ok(await p.getByRole('heading',{name:'胸部訓練',exact:true}).isVisible());
 assert.equal(await p.locator('[data-group-ex]').count(),10);
 await p.locator('[data-group-ex="bench"]').check();
 await p.locator('[data-act="group-start"]').click();
 assert.equal(await p.evaluate(()=>S.active.items[0].eid),'bench');
 assert.equal(await p.evaluate(()=>S.templates[0].name),'我的舊菜單');
 assert.equal(await p.evaluate(()=>S.lifts.length),1);
},{templates:[{id:'custom',name:'我的舊菜單',en:'CUSTOM',ex:['bench'],col:0}],lifts:[{id:'old',date:'2026-01-01',dur:600,items:[]}]}));
test('run overview and entry are separate pages, browser back preserves input, save creates one record',()=>withApp(async p=>{
 await p.locator('#tabseg button[data-v="run"]').click();
 assert.equal(await p.locator('#rf-km').count(),0);
 await p.locator('[data-act="run-new"]').click();await p.waitForURL('**/#run/new');
 await p.locator('#rf-km').fill('5');await p.locator('[data-rf="m"]').fill('30');
 await p.goBack();await p.waitForURL('**/#run');assert.equal(await p.locator('#rf-km').count(),0);
 await p.goForward();await p.waitForURL('**/#run/new');assert.equal(await p.locator('#rf-km').inputValue(),'5');
 await p.locator('[data-act="run-save"]').click();
 await p.waitForURL('**/#run');assert.equal(await p.evaluate(()=>S.runs.length),1);
 await p.reload();assert.equal(await p.evaluate(()=>S.runs.length),1);
}));
test('score accumulates old training beyond 100, recalculates edits/deletes and excludes future and duplicate IDs',()=>withApp(async p=>{
 const initial=await p.evaluate(()=>fitnessScore().total);assert.ok(initial>100,`expected >100, got ${initial}`);
 await p.evaluate(()=>{S.runs[0].km=20;});const edited=await p.evaluate(()=>fitnessScore().total);assert.ok(edited>initial);
 await p.evaluate(()=>{S.runs.push({...S.runs[0]});});assert.equal(await p.evaluate(()=>fitnessScore().total),edited);
 await p.evaluate(()=>{S.runs=S.runs.filter(r=>r.id!=='run-old');});assert.equal(await p.evaluate(()=>fitnessScore().total),0);
 await p.evaluate(()=>{S.runs=[];commit();});assert.ok(await p.locator('.fit-top').innerText().then(t=>!t.includes('/ 100')));
},{runs:[{id:'run-old',date:'2026-01-01',km:18,sec:7200,type:'easy'},{id:'future',date:'2099-01-01',km:100,sec:10000,type:'easy'}]}));
test('editing from running history opens the form and updates rather than duplicates',()=>withApp(async p=>{
 await p.locator('#tabseg button[data-v="run"]').click();await p.locator('#v-run [data-act="open-entry"]').first().click();await p.locator('[data-act="entry-edit"]').click();
 await p.waitForURL('**/#run/new');assert.equal(await p.locator('#rf-km').inputValue(),'5');
 await p.locator('#rf-km').fill('6');await p.locator('[data-act="run-save"]').click();assert.equal(await p.evaluate(()=>S.runs.length),1);assert.equal(await p.evaluate(()=>S.runs[0].km),6);
},{runs:[{id:'edit-me',date:'2026-01-01',km:5,sec:1800,type:'easy'}]}));
test('run draft survives a refresh without creating a completed activity',()=>withApp(async p=>{
 await p.evaluate(()=>navigate('run/new'));await p.locator('#rf-km').fill('8');await p.locator('[data-rf="m"]').fill('45');await p.reload();assert.equal(await p.locator('#rf-km').inputValue(),'8');assert.equal(await p.evaluate(()=>S.runs.length),0);
}));
test('strength completion counts checked working sets and explains score gain',()=>withApp(async p=>{
 await p.evaluate(()=>{startSession({eids:['bench'],title:'胸部訓練'});S.active.start=Date.now()-1800000;});
 await p.locator('.set-row').nth(0).locator('[data-f="w"]').fill('40');await p.locator('.set-row').nth(0).locator('[data-f="r"]').fill('10');await p.locator('.set-row').nth(0).locator('[data-act="set-done"]').click();
 await p.locator('.set-row').nth(1).locator('[data-f="r"]').fill('8');
 await p.locator('[data-act="finish"]').click();assert.equal(await p.evaluate(()=>S.lifts[0].items[0].sets.length),1);assert.equal(await p.evaluate(()=>fitnessScore().total),15);assert.ok(await p.getByText('本次分數變動').isVisible());
}));
