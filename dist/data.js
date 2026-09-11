const item=(key,name,inci,role,phase='A')=>({key,name,inci,role,phase});
export const CATALOG=[
item('water','정제수','Water','solvent'),item('glycerin','글리세린','Glycerin','humectant'),item('bg','부틸렌글라이콜','Butylene Glycol','humectant'),item('dpg','다이프로필렌글라이콜','Dipropylene Glycol','solvent'),item('propanediol','프로판다이올','Propanediol','humectant'),
item('panthenol','판테놀','Panthenol','active','C'),item('niacinamide','나이아신아마이드','Niacinamide','active','C'),item('txa','트라넥사믹애씨드','Tranexamic Acid','active','C'),item('ascorbic','아스코빅애씨드','Ascorbic Acid','active','C'),item('ethylascorbic','에칠아스코빌에텔','3-O-Ethyl Ascorbic Acid','active','C'),item('ferulic','페룰릭애씨드','Ferulic Acid','active','C'),item('allantoin','알란토인','Allantoin','active'),item('ha','소듐하이알루로네이트','Sodium Hyaluronate','humectant','C'),item('betaine','베타인','Betaine','humectant'),item('ectoin','엑토인','Ectoin','active','C'),item('adenosine','아데노신','Adenosine','active','C'),item('caffeine','카페인','Caffeine','active'),item('sa','살리실릭애씨드','Salicylic Acid','active','C'),
item('cct','카프릴릭/카프릭트라이글리세라이드','Caprylic/Capric Triglyceride','oil','B'),item('squalane','스쿠알란','Squalane','oil','B'),item('teh','트라이에틸헥사노인','Triethylhexanoin','oil','B'),item('ehp','에틸헥실팔미테이트','Ethylhexyl Palmitate','oil','B'),item('dimethicone','다이메티콘','Dimethicone','oil','B'),item('tocopherol','토코페롤','Tocopherol','active','C'),
item('gs','글리세릴스테아레이트','Glyceryl Stearate','emulsifier','B'),item('pg10s','폴리글리세릴-10스테아레이트','Polyglyceryl-10 Stearate','emulsifier','B'),item('pg10l','폴리글리세릴-10라우레이트','Polyglyceryl-10 Laurate','emulsifier','C'),item('cetearyl','세테아릴알코올','Cetearyl Alcohol','thickener','B'),
item('aos','올레핀설포네이트 원료','Sodium C14-16 Olefin Sulfonate','surfactant'),item('capb','코카미도프로필베타인 원료','Cocamidopropyl Betaine','surfactant'),item('decyl','데실글루코사이드 원료','Decyl Glucoside','surfactant'),item('sci','소듐코코일이세티오네이트','Sodium Cocoyl Isethionate','surfactant'),
item('carbomer','카보머','Carbomer','thickener'),item('hec','하이드록시에틸셀룰로오스','Hydroxyethylcellulose','thickener'),item('xanthan','잔탄검','Xanthan Gum','thickener'),item('salt','소듐클로라이드','Sodium Chloride','other','C'),item('hex','1,2-헥산다이올','1,2-Hexanediol','preservative','C'),item('phenoxy','페녹시에탄올','Phenoxyethanol','preservative','C'),item('ehg','에틸헥실글리세린','Ethylhexylglycerin','preservative','C'),item('edta','다이소듐이디티에이','Disodium EDTA','chelator'),item('citric','시트릭애씨드','Citric Acid','adjuster','C'),item('arginine','알지닌','Arginine','adjuster','C'),item('naoh','소듐하이드록사이드 용액','Sodium Hydroxide','adjuster','C')];
export function makeRow(key,pct=0,assay='',price=''){
 const raw=CATALOG.find(r=>r.key===key);
 if(!raw)throw new Error('등록된 원료를 찾을 수 없습니다.');
 return {...raw,id:crypto.randomUUID(),pct,assay,price,min:'',max:'',phMin:'',phMax:'',note:''};
}
export function makeCustom(){return {id:crypto.randomUUID(),key:'custom',name:'새 원료',inci:'',role:'other',phase:'D',pct:0,assay:'',price:'',min:'',max:'',phMin:'',phMax:'',note:''};}
export function presetState(key){
 const bases={serum:{name:'배리어 수분 세럼',ph:5.5,items:[['water',87.25],['glycerin',5],['bg',3],['panthenol',2,100],['niacinamide',2,100],['ha',.1,100],['hex',.6],['edta',.05]]},cream:{name:'O/W 크림 · 계산 예시',ph:5.5,items:[['water',77.9],['glycerin',5],['cct',8],['squalane',3],['pg10s',2],['cetearyl',2],['panthenol',1,100],['phenoxy',.8],['xanthan',.2],['tocopherol',.1,100]]},cleanser:{name:'계면활성제 클렌저 · 계산 예시',ph:'',items:[['water',62.5],['glycerin',3],['aos',20,35],['capb',10,30],['decyl',3,50],['salt',.5],['hex',1]]},blank:{name:'새 처방',ph:'',items:[]}};
 if(!bases[key])throw new Error('예시 처방을 찾을 수 없습니다.');
 const p=bases[key];return {name:p.name,preset:key,batchAmount:1000,batchUnit:'g',targetPh:p.ph,rows:p.items.map(([k,p,a])=>makeRow(k,p,a??''))};
}
