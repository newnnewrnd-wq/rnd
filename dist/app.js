import {PHASES,ROLES,numeric,calculate,balanceWater,normalizeRows,getChecks,csvCell,round} from './engine.js';
import {CATALOG,makeRow,makeCustom,presetState} from './data.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,digits=2)=>Number.isFinite(value)?value.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const compact=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:8}):'—';
const massFmt=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:Math.abs(value)>0&&Math.abs(value)<.01?8:state.batchUnit==='kg'?6:4}):'—';
let state=presetState('serum'),dirty=false,editing=null,newDraft=false,pendingConfirmation=null,toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function confirmAction(title,text,action){$('confirmTitle').textContent=title;$('confirmText').textContent=text;pendingConfirmation=action;$('confirmDialog').showModal();}
function syncSetup(){ $('formulaName').value=state.name;$('preset').value=state.preset;$('batchAmount').value=state.batchAmount;$('batchAmount').min=state.batchUnit==='kg'?'0.000001':'0.001';$('batchAmount').max=state.batchUnit==='kg'?'1000000':'1000000000';$('batchUnit').value=state.batchUnit;$('targetPh').value=state.targetPh; }
function renderRows(){
 $('ingredientCount').textContent=state.rows.length;
 $('ingredientRows').innerHTML=state.rows.length?state.rows.map(row=>`<tr data-row="${esc(row.id)}"><td><select class="phase-select phase-${esc(row.phase)}" data-field="phase" aria-label="${esc(row.name)} 투입상">${Object.entries(PHASES).map(([key,p])=>`<option value="${key}" ${key===row.phase?'selected':''}>${key}</option>`).join('')}</select></td><td><button class="ingredient-name" data-action="detail" title="${esc(row.name)} 규격 설정"><strong>${esc(row.name)}${[row.min,row.max,row.phMin,row.phMax].some(v=>v!=='')?'<span class="row-spec-dot" aria-label="규격 설정됨">·</span>':''}</strong><small>${esc(row.inci||'원료 설명을 입력하세요')}</small></button></td><td class="numeric"><input class="numeric-input" type="number" min="0" max="100" step="any" inputmode="decimal" data-field="pct" value="${esc(row.pct)}" aria-label="${esc(row.name)} 배합비 퍼센트"></td><td class="numeric mass-cell" id="mass-${esc(row.id)}">—</td><td class="numeric"><input class="numeric-input assay-input" type="number" min="0" max="100" step="any" inputmode="decimal" data-field="assay" value="${esc(row.assay)}" placeholder="—" aria-label="${esc(row.name)} 유효분 퍼센트"></td><td class="numeric"><input class="numeric-input cost-input" type="number" min="0" max="1000000000000" step="any" inputmode="decimal" data-field="price" value="${esc(row.price)}" placeholder="미입력" aria-label="${esc(row.name)} 킬로그램당 원화 단가"></td><td><button class="icon-button remove-button" data-action="remove" aria-label="${esc(row.name)} 삭제">×</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-row">아직 원료가 없습니다.<br>‘원료 추가’를 눌러 첫 번째 원료를 넣어주세요.</td></tr>';
}
function updateResults(){
 const c=calculate(state),ok=c.valid;
 $('totalPercent').textContent=ok?fmt(c.total):'—';
 $('totalStatus').className=`status-chip ${!ok?'error':c.normalized?'':'warn'}`;
 $('totalStatus').textContent=!ok?'입력 확인':c.normalized?'100% 완료':c.total>100?'배합비 초과':'잔량 있음';
 $('balanceText').textContent=!ok?'입력값을 수정하면 다시 계산됩니다':c.normalized?'목표 배합비에 맞습니다':`${c.total>100?'초과':'미배합 잔량'} ${compact(Math.abs(c.balance))}%`;
 $('actualMass').textContent=ok?massFmt(c.actualKg*(state.batchUnit==='g'?1000:1)):'—';
 $('actualUnit').textContent=state.batchUnit;
 $('massText').textContent=`설정 제조량 ${compact(Number(state.batchAmount))} ${state.batchUnit} 기준`;
 $('batchCost').textContent=ok&&c.priced>0?c.cost>0&&c.cost<1?fmt(c.cost,2):fmt(c.cost,0):'—';
 $('costText').textContent=!ok?'입력값 확인 필요':c.priced===0?'공급 원료의 kg당 단가를 입력하세요':c.priced<c.used?`${c.priced}/${c.used}개 원료 부분합 · 미입력 ${c.used-c.priced}개`:`단가 입력 완료 · 제조비·포장비·손실 제외`;
 $('tableMassUnit').textContent=state.batchUnit;
 $('footPercent').textContent=ok?`${compact(c.total)}%`:'—';
 $('footMass').textContent=ok?massFmt(c.actualKg*(state.batchUnit==='g'?1000:1)):'—';
 $('inputErrors').hidden=ok;
 $('inputErrors').textContent=c.errors.join(' / ');
 $('exportButton').disabled=!ok||state.rows.length===0;
 for(const row of c.rows){const cell=$(`mass-${row.id}`);if(cell)cell.textContent=ok?massFmt(row.mass):'—';}
 renderPhases(c);
 const checks=getChecks(state,c),needs=checks.filter(r=>r.type==='warn'||r.type==='error').length;
 $('checkCount').textContent=needs?`${needs}건 확인 필요`:'검토 안내';
 $('checkList').innerHTML=checks.map(x=>`<div class="check-item ${x.type}"><span class="check-symbol" aria-hidden="true">${x.type==='good'?'✓':x.type==='warn'||x.type==='error'?'!':'i'}</span><div><div class="check-title">${esc(x.title)}</div><p class="check-desc">${esc(x.description)}</p></div></div>`).join('');
 const active=c.rows.filter(r=>r.pct>0&&r.active!==null);
 $('activeGrid').innerHTML=!ok?'<div class="active-empty">입력 오류를 수정하면 유효성분 환산 결과가 표시됩니다.</div>':active.length?active.map(row=>`<div class="active-item"><div class="active-name" title="${esc(row.name)}">${esc(row.name)}</div><div class="active-result">${compact(row.active)}<span>%</span></div><div class="active-equation">${compact(row.pct)}% × ${compact(row.assay)}% · ${compact(row.active*10000)} ppm</div></div>`).join(''):'<div class="active-empty">원료의 유효분(%)을 입력하면 완제품 기준 환산 함량이 표시됩니다.</div>';
 return c;
}
function renderPhases(c){
 let cursor=0;const segments=[];
 for(const [key,p] of Object.entries(PHASES)){const size=c.valid&&c.total>0?c.phases[key]/c.total*100:0;if(size>0){segments.push(`${p.color} ${cursor}% ${cursor+size}%`);cursor+=size;}}
 $('phaseDonut').style.background=segments.length?`conic-gradient(${segments.join(',')})`:'#e8eded';
 $('phaseCenter').textContent=c.valid?compact(round(c.total,2)):'—';
 $('phaseDonut').setAttribute('aria-label',c.valid?Object.entries(PHASES).map(([k,p])=>`${k} ${p.name} ${compact(c.phases[k])}%`).join(', '):'입력값 확인 필요');
 $('phaseLegend').innerHTML=Object.entries(PHASES).map(([key,p])=>`<div class="legend-line"><span class="legend-dot" style="background:${p.color}"></span><span>${key} ${p.name}</span><strong>${c.valid?compact(round(c.phases[key],3)):'—'}%</strong></div>`).join('');
}
function render(){syncSetup();renderRows();updateResults();}
function commitState(next){state=next;dirty=true;render();}

$('ingredientRows').addEventListener('input',event=>{
 const field=event.target.dataset.field,id=event.target.closest('[data-row]')?.dataset.row;
 if(!field||!id)return;const row=state.rows.find(r=>r.id===id);if(!row)return;
 row[field]=event.target.value;dirty=true;
 if(field==='phase')event.target.className=`phase-select phase-${row.phase}`;
 updateResults();
});
$('ingredientRows').addEventListener('click',event=>{
 const button=event.target.closest('button[data-action]');if(!button)return;
 const id=button.closest('[data-row]').dataset.row;
 if(button.dataset.action==='detail'){openDetail(state.rows.find(r=>r.id===id));return;}
 if(button.dataset.action==='remove'){
  const index=state.rows.findIndex(r=>r.id===id),row=state.rows[index];state.rows.splice(index,1);dirty=true;render();toast(`${row.name} 원료를 삭제했습니다.`);
 }
});
$('formulaName').addEventListener('input',event=>{state.name=event.target.value;dirty=true;});
$('batchAmount').addEventListener('input',event=>{state.batchAmount=event.target.value;dirty=true;updateResults();});
$('targetPh').addEventListener('input',event=>{state.targetPh=event.target.value;dirty=true;updateResults();});
$('batchUnit').addEventListener('change',event=>{
 const oldUnit=state.batchUnit,nextUnit=event.target.value,n=numeric(state.batchAmount,oldUnit==='kg'?.000001:.001,oldUnit==='kg'?1e6:1e9);
 if(Number.isFinite(n)){const converted=round(n*(oldUnit==='g'?1/1000:1000),12);state.batchAmount=converted;}
 state.batchUnit=nextUnit;dirty=true;syncSetup();updateResults();
});
$('preset').addEventListener('change',event=>{
 const key=event.target.value;event.target.value=state.preset;
 if(key===state.preset&&!dirty)return;
 const apply=()=>{commitState(presetState(key));toast('계산 예시를 불러왔습니다. 실제 원료 규격에 맞게 수정하세요.');};
 if(state.rows.length)confirmAction('처방을 바꿀까요?','현재 입력값이 선택한 예시로 바뀝니다. 보관하려면 취소 후 처방 CSV를 먼저 내려받으세요.',apply);else apply();
});
$('waterButton').addEventListener('click',()=>{try{commitState({...state,rows:balanceWater(state.rows,()=>makeRow('water'))});toast('정제수 배합비를 조정해 합계를 100%로 맞췄습니다.');}catch(error){toast(error.message);}});
$('normalizeButton').addEventListener('click',()=>{
 let normalized;try{normalized=normalizeRows(state.rows);}catch(error){toast(error.message);return;}
 if(calculate(state).normalized){toast('이미 배합 합계가 100%입니다.');return;}
 confirmAction('모든 원료의 배합비를 환산할까요?','현재 원료 간 비율을 유지하며 총합을 100%로 조정합니다. 기능 성분과 보존 관련 원료의 배합비도 함께 바뀝니다.',()=>{commitState({...state,rows:normalized});toast('전체 배합비를 100%로 환산했습니다.');});
});
$('confirmYes').addEventListener('click',()=>{const action=pendingConfirmation;pendingConfirmation=null;$('confirmDialog').close();action?.();});
$('confirmNo').addEventListener('click',()=>{$('confirmDialog').close();pendingConfirmation=null;});
$('confirmDialog').addEventListener('cancel',()=>{pendingConfirmation=null;});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('helpButton').addEventListener('click',()=>$('helpDialog').showModal());

function renderCatalog(){
 const query=$('catalogSearch').value.trim().toLowerCase();
 const rows=CATALOG.filter(row=>`${row.name} ${row.inci} ${ROLES[row.role]}`.toLowerCase().includes(query));
 $('catalogList').innerHTML=rows.length?rows.map(row=>`<button class="catalog-item" data-key="${esc(row.key)}"><div><strong>${esc(row.name)}<span class="ingredient-role">${esc(ROLES[row.role])}</span></strong><small>${esc(row.inci)}</small></div><span class="add-sign" aria-label="추가">＋</span></button>`).join(''):'<p class="active-empty">검색 결과가 없습니다. 아래에서 원료를 직접 입력할 수 있습니다.</p>';
}
$('addButton').addEventListener('click',()=>{$('catalogSearch').value='';renderCatalog();$('catalogDialog').showModal();$('catalogSearch').focus();});
$('catalogSearch').addEventListener('input',renderCatalog);
$('catalogList').addEventListener('click',event=>{
 const button=event.target.closest('[data-key]');if(!button)return;
 if(state.rows.length>=150){toast('한 처방에는 최대 150개 원료를 입력할 수 있습니다.');return;}
 const row=makeRow(button.dataset.key);state.rows.push(row);dirty=true;$('catalogDialog').close();render();
 document.querySelector(`[data-row="${row.id}"] [data-field="pct"]`)?.focus();toast(`${row.name} 추가 · 배합비를 입력하세요.`);
});
$('customButton').addEventListener('click',()=>{if(state.rows.length>=150){toast('최대 150개 원료까지 입력할 수 있습니다.');return;}$('catalogDialog').close();openDetail(makeCustom(),true);});
function openDetail(row,isNew=false){
 if(!row)return;editing={...row};newDraft=isNew;
 for(const [id,key] of Object.entries({detailName:'name',detailInci:'inci',detailRole:'role',detailAssay:'assay',detailMin:'min',detailMax:'max',detailPhMin:'phMin',detailPhMax:'phMax',detailNote:'note'}))$(id).value=row[key]??'';
 $('detailError').hidden=true;$('detailDialog').showModal();
}
$('detailForm').addEventListener('submit',event=>{
 event.preventDefault();if(!editing)return;
 const changed={...editing};
 for(const [id,key] of Object.entries({detailName:'name',detailInci:'inci',detailRole:'role',detailAssay:'assay',detailMin:'min',detailMax:'max',detailPhMin:'phMin',detailPhMax:'phMax',detailNote:'note'}))changed[key]=$(id).value.trim();
 if(!changed.name){$('detailError').hidden=false;$('detailError').textContent='원료명을 입력하세요.';return;}
 // A renamed Water catalog entry is custom unless its INCI still identifies Water.
 if(changed.key==='water'&&changed.inci.trim().toLowerCase()!=='water')changed.key='custom';
 const check=calculate({...state,batchAmount:1000,batchUnit:'g',targetPh:'',rows:[{...changed,pct:0,price:''}]});
 if(!check.valid){$('detailError').hidden=false;$('detailError').textContent=check.errors.join(' / ');return;}
 const nextRows=newDraft?[...state.rows,changed]:state.rows.map(r=>r.id===changed.id?changed:r);
 commitState({...state,rows:nextRows});$('detailDialog').close();toast('원료 규격을 적용했습니다.');
});
function exportCsv(){
 const c=calculate(state);if(!c.valid||!state.rows.length){toast('입력값을 확인하고 원료를 추가한 뒤 내보내세요.');return;}
 const lines=[['NEW&NEW Formula Lab','배합 시뮬레이션 · 연구용 계산'],['처방명',state.name],['제조량',state.batchAmount,state.batchUnit],['목표 pH',state.targetPh],['배합 총합 (%)',round(c.total)],['실제 합산 투입량 (kg)',round(c.actualKg)],['입력 단가 기준 원료비 (원)',round(c.cost,4),`${c.priced}/${c.used}개 원료 단가 입력`],['주의','계산 예시는 검증된 제조 처방이 아닙니다. 최종 pH, 점도, 안정성, 보존력, 법규 적합성은 별도 확인하세요.'],[],['투입상','원료명','INCI / 설명','역할','배합비 (%)','투입량 (g)','유효분 (%)','완제품 환산 함량 (%)','완제품 환산 함량 (ppm)','단가 (원/kg)','원료비 (원)','사용 하한 (%)','사용 상한 (%)','pH 하한','pH 상한','규격 출처 / 메모']];
 for(const row of c.rows)lines.push([row.phase,row.name,row.inci,ROLES[row.role]??row.role,row.pct,round(row.kg*1000),row.assay,row.active===null?'':round(row.active),row.active===null?'':round(row.active*10000),row.price,row.cost===null?'':round(row.cost,4),row.min,row.max,row.phMin,row.phMax,row.note]);
 lines.push([],['배합 검토','내용']);for(const item of getChecks(state,c))lines.push([item.title,item.description]);
 const csv='\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`${(state.name||'화장품_처방').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').slice(0,80)}_${new Date().toISOString().slice(0,10)}.csv`;
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;toast('처방과 계산 결과를 CSV로 내보냈습니다.');
}
$('exportButton').addEventListener('click',exportCsv);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});

function formulaReadback(){const calc=calculate(state);return {name:state.name,batchAmount:state.batchAmount,batchUnit:state.batchUnit,targetPh:state.targetPh,valid:calc.valid,errors:calc.errors,totalPercent:calc.valid?round(calc.total):null,batchCost:calc.valid&&calc.priced?calc.cost:null,priceCoverage:{entered:calc.priced,used:calc.used},rows:calc.rows.map(r=>({id:r.id,name:r.name,inci:r.inci,phase:r.phase,percent:Number.isFinite(r.pct)?r.pct:null,assay:r.assay,pricePerKg:r.price,grams:Number.isFinite(r.kg)?r.kg*1000:null,activePercent:r.active})),checks:getChecks(state,calc)};}
function setFormulaInputs(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('입력은 객체여야 합니다.');
 const keys=['name','batchAmount','batchUnit','targetPh','ingredients'];if(Object.keys(input).some(k=>!keys.includes(k)))throw new Error('지원하지 않는 필드입니다.');
 const next={...state,rows:state.rows.map(r=>({...r}))};
 if('name'in input){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw new Error('처방명은 1~100자여야 합니다.');next.name=input.name;}
 if('batchAmount'in input){if(typeof input.batchAmount!=='number')throw new Error('제조량은 숫자여야 합니다.');next.batchAmount=input.batchAmount;}
 if('batchUnit'in input){if(!['g','kg'].includes(input.batchUnit))throw new Error('단위는 g 또는 kg여야 합니다.');next.batchUnit=input.batchUnit;}
 if('targetPh'in input){if(input.targetPh!==null&&typeof input.targetPh!=='number')throw new Error('pH는 숫자 또는 null이어야 합니다.');next.targetPh=input.targetPh??'';}
 if('ingredients'in input){
  if(!Array.isArray(input.ingredients)||input.ingredients.length>150)throw new Error('원료 변경은 150개 이하의 배열이어야 합니다.');
  const ids=new Set();for(const update of input.ingredients){
   if(!update||typeof update!=='object'||Array.isArray(update)||Object.keys(update).some(k=>!['id','percent','assay','pricePerKg','phase'].includes(k)))throw new Error('원료 변경 형식이 올바르지 않습니다.');
   if(typeof update.id!=='string'||ids.has(update.id))throw new Error('중복되거나 잘못된 원료 ID입니다.');ids.add(update.id);
   const row=next.rows.find(r=>r.id===update.id);if(!row)throw new Error('원료 ID를 찾을 수 없습니다.');
   for(const [key,field] of Object.entries({percent:'pct',assay:'assay',pricePerKg:'price'})){if(key in update){if(typeof update[key]!=='number'&&!(key!=='percent'&&update[key]===null))throw new Error('원료 수치는 숫자로 입력하세요.');row[field]=update[key]??'';}}
   if('phase'in update){if(!Object.hasOwn(PHASES,update.phase))throw new Error('투입상은 A, B, C, D 중 하나여야 합니다.');row.phase=update.phase;}
  }
 }
 const calc=calculate(next);if(!calc.valid)throw new Error(calc.errors.join(' / '));commitState(next);return formulaReadback();
}
function registerAgentTools(){
 const context=document.modelContext;if(!context?.registerTool)return;
 const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const defs=[{name:'get_formula_state',title:'현재 배합 읽기',description:'현재 화면의 배합비, 투입량, 단가 입력 범위 및 검토 항목을 읽습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>formulaReadback()},{name:'set_formula_inputs',title:'배합 입력값 수정',description:'현재 화면의 제조량, 목표 pH 또는 기존 원료 입력값을 일괄 수정합니다. 원료 ID는 get_formula_state에서 확인합니다. 배합비는 자동 정규화하지 않습니다. 단위만 변경하면 제조량 숫자는 유지됩니다.',inputSchema:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:100},batchAmount:{type:'number',minimum:.001,maximum:1e9},batchUnit:{type:'string',enum:['g','kg']},targetPh:{type:['number','null'],minimum:0,maximum:14},ingredients:{type:'array',maxItems:150,items:{type:'object',properties:{id:{type:'string'},percent:{type:'number',minimum:0,maximum:100},assay:{type:['number','null'],minimum:0,maximum:100},pricePerKg:{type:['number','null'],minimum:0,maximum:1e12},phase:{type:'string',enum:['A','B','C','D']}},required:['id'],additionalProperties:false}}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:setFormulaInputs}];
 for(const def of defs){try{void Promise.resolve(context.registerTool(def,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
render();registerAgentTools();
