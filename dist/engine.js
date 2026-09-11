export const PHASES = {A:{name:'수상',color:'#2d8b8a'},B:{name:'유상',color:'#e6ab56'},C:{name:'후첨',color:'#aaa4db'},D:{name:'기타',color:'#acbac1'}};
export const ROLES = {solvent:'용제',humectant:'보습제',active:'기능 성분',oil:'유분',emulsifier:'유화제',surfactant:'계면활성제',thickener:'점증제',preservative:'보존 관련',chelator:'킬레이트제',adjuster:'pH 조절제',other:'기타'};
export function numeric(value, min = 0, max = Infinity, optional = false) {
  if (value === '' || value === null || value === undefined) return optional ? null : NaN;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && value.trim() === '') return optional ? null : NaN;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}
export const round = (value, digits = 8) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
export function calculate(state) {
  const errors=[];
  const amount=numeric(state.batchAmount,state.batchUnit==='kg'?0.000001:0.001,state.batchUnit==='kg'?1e6:1e9);
  if(!Number.isFinite(amount)) errors.push('제조량은 0.001 g~1,000,000 kg 범위의 숫자로 입력하세요.');
  const validUnit=['g','kg'].includes(state.batchUnit);
  if(!validUnit) errors.push('제조량 단위가 올바르지 않습니다.');
  const batchKg=amount/(state.batchUnit==='g'?1000:1);
  const ph=numeric(state.targetPh,0,14,true);
  if(Number.isNaN(ph)) errors.push('목표 pH는 0~14의 숫자로 입력하거나 비워두세요.');
  let total=0,cost=0,priced=0,used=0,assayCount=0;
  const phases={A:0,B:0,C:0,D:0};
  const rows=state.rows.map(row=>{
    const pct=numeric(row.pct,0,100),assay=numeric(row.assay,0,100,true),price=numeric(row.price,0,1e12,true);
    const min=numeric(row.min,0,100,true),max=numeric(row.max,0,100,true),phMin=numeric(row.phMin,0,14,true),phMax=numeric(row.phMax,0,14,true);
    const validPct=Number.isFinite(pct),validAssay=!Number.isNaN(assay),validPrice=!Number.isNaN(price);
    if(!validPct) errors.push(`${row.name}: 배합비는 0~100%로 입력하세요.`);
    if(!validAssay) errors.push(`${row.name}: 유효분은 0~100%로 입력하세요.`);
    if(!validPrice) errors.push(`${row.name}: 단가는 0 이상 1조 이하로 입력하세요.`);
    if([min,max,phMin,phMax].some(Number.isNaN)||(min!==null&&max!==null&&min>max)||(phMin!==null&&phMax!==null&&phMin>phMax)) errors.push(`${row.name}: 규격 범위를 확인하세요.`);
    if(!PHASES[row.phase]) errors.push(`${row.name}: 투입상이 올바르지 않습니다.`);
    const kg=validPct&&Number.isFinite(batchKg)&&validUnit?batchKg*pct/100:NaN;
    if(validPct){total+=pct;if(PHASES[row.phase]) phases[row.phase]+=pct;if(pct>0){used++;if(price!==null&&validPrice)priced++;if(assay!==null&&validAssay)assayCount++;}}
    const rowCost=price!==null&&validPrice&&Number.isFinite(kg)?price*kg:null;
    if(rowCost!==null)cost+=rowCost;
    return {...row,pct,assay,price,min,max,phMin,phMax,kg,mass:kg*(state.batchUnit==='g'?1000:1),active:validPct&&validAssay&&assay!==null?pct*assay/100:null,cost:rowCost};
  });
  const valid=errors.length===0;
  const normalized=Math.abs(total-100)<1e-7;
  return {valid,errors,rows,total,ph,phases,batchKg,actualKg:batchKg*total/100,cost,priced,used,assayCount,normalized,balance:100-total};
}
export function balanceWater(rows, makeWater) {
  if(rows.some(r=>!Number.isFinite(numeric(r.pct,0,100)))) throw new Error('먼저 배합비 입력 오류를 수정하세요.');
  const result=rows.map(r=>({...r}));
  let index=result.findIndex(r=>r.key==='water');
  if(index<0){result.push(makeWater());index=result.length-1;}
  const other=result.reduce((sum,r,i)=>sum+(i===index?0:Number(r.pct)),0);
  if(other>100+1e-8) throw new Error('정제수 외 원료가 100%를 초과합니다. 다른 원료의 배합비를 먼저 줄여주세요.');
  result[index].pct=round(Math.max(0,100-other));
  return result;
}
export function normalizeRows(rows) {
  if(!rows.length||rows.some(r=>!Number.isFinite(numeric(r.pct,0,100)))) throw new Error('유효한 배합비를 입력한 뒤 환산하세요.');
  const total=rows.reduce((sum,r)=>sum+Number(r.pct),0);
  if(total<=0)throw new Error('배합비 합계가 0%여서 환산할 수 없습니다.');
  const result=rows.map(r=>({...r,pct:round(Number(r.pct)/total*100)}));
  const largest=result.reduce((best,r,i)=>r.pct>result[best].pct?i:best,0);
  result[largest].pct=round(result[largest].pct+100-result.reduce((sum,r)=>sum+r.pct,0));
  return result;
}
export function getChecks(state, calc) {
  const out=[];
  const add=(type,title,description)=>out.push({type,title,description});
  if(!calc.valid){add('error','입력값 확인 필요','오류가 있는 동안 계산 결과와 규격 검토를 확정할 수 없습니다.');return out;}
  if(!calc.rows.length){add('info','원료를 추가해 주세요','원료와 배합비를 입력하면 계산을 시작합니다.');return out;}
  if(calc.normalized)add('good','배합 합계 100%','설정 제조량과 원료 투입량 합계가 일치합니다.');
  else add('warn',calc.total>100?'배합비 초과':'배합비 부족',`현재 ${round(calc.total,6)}%. ${calc.total>100?'초과':'잔량'} ${round(Math.abs(calc.balance),6)}%를 조정하세요.`);
  const used=calc.rows.filter(r=>r.pct>0);
  let phChecked=0,usageChecked=0,lower=0,upper=14;
  for(const row of used){
    if(row.min!==null||row.max!==null){usageChecked++;if((row.min!==null&&row.pct<row.min)||(row.max!==null&&row.pct>row.max))add('warn',`${row.name} · 사용 범위 이탈`,`입력 기준 ${row.min??0}~${row.max??100}%, 현재 ${row.pct}%. 공급사 규격 및 제품 조건을 확인하세요.`);}
    if(row.phMin!==null||row.phMax!==null){phChecked++;lower=Math.max(lower,row.phMin??0);upper=Math.min(upper,row.phMax??14);if(calc.ph!==null&&((row.phMin!==null&&calc.ph<row.phMin)||(row.phMax!==null&&calc.ph>row.phMax)))add('warn',`${row.name} · pH 범위 이탈`,`입력한 원료 적용 범위는 pH ${row.phMin??0}~${row.phMax??14}, 목표는 ${calc.ph}입니다.`);}
  }
  if(lower>upper)add('warn','원료 pH 범위가 겹치지 않습니다','설정된 원료 규격을 동시에 충족하는 pH 구간이 없습니다. 원료 또는 규격을 검토하세요.');
  else if(phChecked>0)add('info',`입력 규격의 공통 pH ${lower}~${upper}`,`${phChecked}개 원료의 입력 범위만 비교한 결과입니다. 최종 pH 예측값은 아닙니다.`);
  if(phChecked===0)add('info','pH 규격을 입력해 주세요',calc.ph===null?'목표 pH와 원료별 적용 범위를 입력하면 비교할 수 있습니다.':`목표 pH ${calc.ph}. 원료명을 눌러 적용 pH 범위를 설정하면 이탈 여부를 확인합니다.`);
  else if(calc.ph===null)add('info','목표 pH 미입력','목표 pH를 입력하면 각 원료 규격과 비교합니다.');
  if(usageChecked<used.length)add('info','사용 범위 미설정',`${used.length-usageChecked}개 원료의 사용 범위를 검토하지 못했습니다. 규격 설정에서 사내 또는 공급사 기준을 입력하세요.`);
  const hasWater=used.some(r=>r.key==='water'),hasOil=used.some(r=>r.role==='oil');
  if(hasWater&&hasOil)add('info','수상·유상 혼합 검토','유화·가용화·분산 방식과 용해 조건을 확인하세요. 투입상 비율만으로 상용성이나 분리 여부를 판정하지 않습니다.');
  if(hasWater)add('info','보존력 확인','보존 관련 원료의 유무·함량만으로 보존력을 보증할 수 없습니다. 완제품 시험으로 확인하세요.');
  const duplicates=used.filter((r,i)=>used.findIndex(x=>x.inci.trim().toLowerCase()===r.inci.trim().toLowerCase())!==i&&r.inci.trim());
  if(duplicates.length)add('info','동일 INCI 항목이 있습니다','공급 원료가 다를 수 있어 자동 합산하지 않았습니다. 중복 입력인지 확인하세요.');
  return out;
}
export function csvCell(value){const text=String(value??'');const safe=/^[\s]*[=+@-]/.test(text)?"'"+text:text;return '"'+safe.replaceAll('"','""')+'"';}
