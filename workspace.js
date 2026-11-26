const blockTypes = {
  text: {label:'Текст', heading:'О программе', body:'Описание программы'},
  list: {label:'Список', heading:'Чему вы научитесь', body:'Первый результат\nВторой результат'},
  quote: {label:'Цитата', heading:'Имя автора', body:'Добавьте цитату'},
  image: {label:'Изображение', heading:'Подпись к изображению', url:'', body:''},
  action: {label:'Кнопка', heading:'Записаться', url:'', body:''}
};
let activeBlock = 0;
function option(value, label) {
  const node=put('option',label);
  node.value=value;
  return node;
}
for(const [type,config] of Object.entries(blockTypes)) el('blockType').append(option(type,config.label));
function refreshBuilder(){renderBlocks();renderPreview()}
el('addBlock').onclick=()=>{
  const type=el('blockType').value;
  const {label,...defaults}=blockTypes[type];
  blocks.push({type,...defaults});
  activeBlock=blocks.length-1;
  refreshBuilder();
  el('blocks').querySelector('input').focus();
};
function renderBlocks(){
  const list=el('outline'), fields=el('blocks');
  list.replaceChildren();fields.replaceChildren();
  blocks.forEach((block,index)=>{
    const entry=button((index+1)+'　'+(block.heading||blockTypes[block.type||'text'].label),'outline-item',()=>{
      activeBlock=index;refreshBuilder();
      el('preview').querySelectorAll('section')[index]?.scrollIntoView({block:'nearest'});
    });
    entry.setAttribute('aria-pressed',String(index===activeBlock));
    list.append(entry);
  });
  const block=blocks[activeBlock];
  if(!block)return;
  const type=block.type||'text';
  fields.append(put('strong',blockTypes[type].label));
  function field(key,label,tag){
    const wrap=put('label',label), input=put(tag);
    input.value=block[key]||'';
    input.oninput=()=>{
      block[key]=input.value;
      if(key==='heading')list.children[activeBlock].textContent=(activeBlock+1)+'　'+(input.value||blockTypes[type].label);
    };
    wrap.append(input);fields.append(wrap);
  }
  field('heading',type==='action'?'Надпись на кнопке':type==='quote'?'Автор':'Заголовок','input');
  if(type==='image'||type==='action')field('url',type==='image'?'URL изображения (https)':'Адрес ссылки (https)','input');
  if(type!=='action')field('body',type==='list'?'Пункты, каждый с новой строки':type==='image'?'Альтернативный текст':'Текст','textarea');
  const controls=put('div','','row');
  for(const [step,label] of [[-1,'Выше'],[1,'Ниже']]){
    const next=activeBlock+step,move=button(label,'btn',()=>{
      [blocks[next],blocks[activeBlock]]=[block,blocks[next]];activeBlock=next;refreshBuilder();
    });
    move.disabled=next<0||next>=blocks.length;controls.append(move);
  }
  controls.append(button('Копировать','btn',()=>{blocks.splice(activeBlock+1,0,{...block});activeBlock++;refreshBuilder()}),
    button('Удалить','btn',()=>{blocks.splice(activeBlock,1);activeBlock=Math.max(0,Math.min(activeBlock,blocks.length-1));refreshBuilder()}));
  fields.append(controls);
}
function webUrl(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:''}catch{return ''}
}
function renderPreview(){
  const preview=el('preview'),cover=put('div','','landing-cover');
  cover.append(put('small',bySite(el('site').value)?.name),put('h2',el('name').value||'Название посадочной'),put('p',el('lead').value));
  if(el('cta').value)cover.append(put('b',el('cta').value,'cta'));
  preview.replaceChildren(cover);
  blocks.forEach((block,index)=>{
    const section=put('section','','landing-block '+(block.type||'text'));
    section.classList.toggle('chosen',index===activeBlock);
    section.onclick=()=>{activeBlock=index;renderBlocks();for(const [i,node] of [...preview.querySelectorAll('section')].entries())node.classList.toggle('chosen',i===index)};
    if(block.type==='quote')section.append(put('blockquote',block.body),put('small',block.heading));
    else if(block.type==='image'){
      const url=webUrl(block.url);
      if(url){const img=put('img');img.src=url;img.alt=block.body||'';section.append(img)}
      else section.append(put('p','Укажите URL изображения','image-placeholder'));
      section.append(put('small',block.heading));
    }else if(block.type==='action'){
      const link=put('a',block.heading||'Перейти','landing-link');
      if(webUrl(block.url))link.href=webUrl(block.url);
      link.target='_blank';link.rel='noopener noreferrer';section.append(link);
    }else{
      section.append(put('h3',block.heading));
      if(block.type==='list'){
        const list=put('ul');for(const line of block.body.split('\n').filter(Boolean))list.append(put('li',line));
        section.append(list);
      }else section.append(put('p',block.body));
    }
    preview.append(section);
  });
}

function showAnalytics(show){
  el('contentMain').hidden=show;el('analyticsMain').hidden=!show;
  el('nav').hidden=show;el('schoolLabel').hidden=show;
  el('analyticsTab').setAttribute('aria-pressed',String(show));
  el('contentTab').setAttribute('aria-pressed',String(!show));
  el('crumb').textContent=show?'Аналитика / Обзор':'Контент / '+(bySite(selected)?.name||'Все сайты');
  if(show)drawReport();
}
el('contentTab').onclick=()=>showAnalytics(false);
el('analyticsTab').onclick=()=>showAnalytics(true);
const columns=['date','site','channel','spend','impressions','clicks','leads'];
const measures=columns.slice(3);
function demoRows(){
  const result=[];
  const channels=['Яндекс Директ','VK Реклама','Telegram Ads','Посевы'];
  for(let day=0;day<30;day++){
    const date=new Date();date.setDate(date.getDate()-29+day);
    const iso=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    sites.forEach((site,s)=>channels.forEach((channel,c)=>{
      const wave=1+0.32*Math.sin(day*.49+s*.63+c);
      const clicks=Math.round((164-c*32+s*4)*wave);
      result.push({date:iso,site:site.id,channel,clicks,spend:clicks*(23+c*9),impressions:clicks*(31+c*13),leads:Math.round(clicks/(13+c*4))});
    }));
  }
  return result;
}
const reportKey='uu-ad-report-v1';
let imported;
try{imported=JSON.parse(localStorage.getItem(reportKey))}catch{}
let data=imported?.rows||demoRows();
function setupReport(){
  const dates=data.map(row=>row.date).sort();
  el('dateFrom').value=dates[0];el('dateTo').value=dates[dates.length-1];
  el('biSchool').replaceChildren(option('','Все школы'),...sites.map(s=>option(s.id,s.name)));
  el('channel').replaceChildren(option('','Все источники'),...[...new Set(data.map(r=>r.channel))].sort().map(c=>option(c,c)));
  const showingImport=Boolean(imported && data===imported.rows);
  el('resetBi').hidden=!imported;
  el('resetBi').textContent=showingImport?'Показать демоданные':'Вернуться к своим данным';
  el('dataStatus').textContent=showingImport?'Данные из файла · '+imported.name:'Демонстрационные данные · последние 30 дней';
  drawReport();
}
const format=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
function drawReport(){
  const from=el('dateFrom').value,to=el('dateTo').value,school=el('biSchool').value,channel=el('channel').value;
  const rows=data.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!school||r.site===school)&&(!channel||r.channel===channel));
  const channels=new Map(),days=new Map(),totals={spend:0,impressions:0,clicks:0,leads:0},metric=el('metric').value;
  for(const row of rows){
    if(!channels.has(row.channel))channels.set(row.channel,{spend:0,impressions:0,clicks:0,leads:0});
    for(const key of measures){channels.get(row.channel)[key]+=row[key];totals[key]+=row[key]}
    days.set(row.date,(days.get(row.date)||0)+row[metric]);
  }
  const n=v=>format.format(v),rub=v=>n(v)+' ₽',cpa=r=>r.leads?rub(r.spend/r.leads):'—';
  el('kpis').replaceChildren(...[['Расход',rub(totals.spend)],['Клики',n(totals.clicks)],['Заявки',n(totals.leads)],['Цена заявки',cpa(totals)]].map(([label,value])=>{
    const card=put('div','','bi-kpi');card.append(put('span',label),put('strong',value));return card;
  }));
  const trend=el('trend');trend.replaceChildren();
  if(!rows.length)trend.append(put('p','За выбранный период и фильтры данных нет.'));
  else{
    const series=[...days].sort(([a],[b])=>a.localeCompare(b)),max=series.reduce((m,d)=>Math.max(m,d[1]),0),chart=put('div','','bars');
    for(const [date,val] of series){
      const bar=put('div','','bar');bar.style.height=Math.max(1,100*val/(max||1))+'%';bar.title=date+' · '+n(val);chart.append(bar);
    }
    const axis=put('div','','axis');axis.append(put('span',series[0][0]),put('span','Максимум · '+n(max)),put('span',series[series.length-1][0]));
    trend.append(chart,axis);
  }
  el('breakdown').replaceChildren(...[...channels].sort((a,b)=>b[1].spend-a[1].spend).map(([name,row])=>{
    const tr=put('tr');for(const v of [name,rub(row.spend),n(row.impressions),n(row.clicks),row.impressions?n(100*row.clicks/row.impressions)+'%':'—',n(row.leads),cpa(row)])tr.append(put('td',v));return tr;
  }));
}
for(const id of ['dateFrom','dateTo','biSchool','channel','metric'])el(id).onchange=drawReport;
function parseReport(text){
  const input=text.replace(/^\uFEFF/,'').trim(),sep=input.split(/\r?\n/,1)[0].includes(';')?';':',';
  const table=[];let record=[],field='',quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){
      if(quoted&&input[i+1]==='"'){field+='"';i++}else quoted=!quoted;
    }else if(!quoted&&(c===sep||c==='\n')){
      record.push(field.trim());field='';
      if(c==='\n'){table.push(record);record=[]}
    }else field+=c;
  }
  record.push(field.trim());table.push(record);
  if(quoted||table.shift()?.join(',')!==columns.join(','))throw Error('Проверьте заголовки столбцов по примеру CSV.');
  const rows=table.filter(r=>r.some(Boolean)).map((cells,i)=>{
    const [date,site,channel,...values]=cells,nums=values.map(Number);
    if(cells.length!==7||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!bySite(site)||!channel||values.some(v=>!v)||nums.some(v=>!Number.isFinite(v)||v<0)||nums.slice(1).some(v=>!Number.isSafeInteger(v)))throw Error('Проверьте дату, код школы и показатели в строке '+(i+2)+'.');
    return {date,site,channel,...Object.fromEntries(measures.map((key,j)=>[key,nums[j]]))};
  });
  if(!rows.length)throw Error('В файле нет строк с показателями.');
  return rows;
}
el('upload').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const next={name:file.name,rows:parseReport(await file.text())};
    localStorage.setItem(reportKey,JSON.stringify(next));imported=next;data=next.rows;el('importError').textContent='';setupReport();
  }catch(error){el('importError').textContent=error.message}
  event.target.value='';
};
el('resetBi').onclick=()=>{data=data===imported?.rows?demoRows():imported.rows;el('importError').textContent='';setupReport()};
el('sample').onclick=()=>{
  const rows=demoRows().slice(0,sites.length*4);
  const csv=[columns.join(','),...rows.map(r=>columns.map(k=>r[k]).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const link=put('a');link.href=url;link.download='uu-ad-report.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
setupReport();
