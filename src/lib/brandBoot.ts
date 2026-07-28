import { BRAND_CSS_VARS } from './brand'

// Inline, paint-blocking boot script: re-applies the device's last-seen brand
// (localStorage brandCache:last) BEFORE first paint, so a branded firm's user
// never sees a flash of the default theme on reload. BrandProvider remains the
// authority — it re-applies/corrects right after hydration. The var mapping is
// embedded from BRAND_CSS_VARS so the two can never drift; the sanitization
// mirrors sanitizePracticeBrand (hex-only) and the light-surface income/expense
// derive mirrors mergeBrand.
export const BRAND_BOOT_SCRIPT = `(function(){try{
var raw=localStorage.getItem('brandCache:last');if(!raw)return;
var p=JSON.parse(raw);var b=(p&&typeof p==='object'&&'brand'in p)?p.brand:p;if(!b||typeof b!=='object')return;
var HEX=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
var MAP=${JSON.stringify(BRAND_CSS_VARS)};
var c=b.colors||{};var r=document.documentElement;var has=false;
function lum(x){var h=x.replace('#','');var f=h.length<=4?h.slice(0,3).split('').map(function(y){return y+y}).join(''):h.slice(0,6);
return 0.2126*parseInt(f.slice(0,2),16)/255+0.7152*parseInt(f.slice(2,4),16)/255+0.0722*parseInt(f.slice(4,6),16)/255}
for(var k in MAP){var v=c[k];if(typeof v==='string'&&HEX.test(v)){has=true;for(var i=0;i<MAP[k].length;i++)r.style.setProperty(MAP[k][i],v)}}
if(has&&typeof c.surface==='string'&&HEX.test(c.surface)&&lum(c.surface)>0.45){
if(!(typeof c.income==='string'&&HEX.test(c.income)))r.style.setProperty('--income','#138E4F');
if(!(typeof c.expense==='string'&&HEX.test(c.expense)))r.style.setProperty('--expense','#B53C3C');}
if(has&&typeof c.gold==='string'&&HEX.test(c.gold)){var fg=lum(c.gold)>0.5?'#0F0F0F':'#FFFFFF';
r.style.setProperty('--primary-foreground',fg);r.style.setProperty('--accent-foreground',fg);}
var wm=(typeof b.wordmarkColor==='string'&&HEX.test(b.wordmarkColor))?b.wordmarkColor:((has&&typeof c.gold==='string'&&HEX.test(c.gold))?c.gold:null);
if(wm)r.style.setProperty('--wordmark',wm);
if(typeof b.nameEn==='string'&&b.nameEn)document.title=b.nameEn;
else if(typeof b.nameHe==='string'&&b.nameHe)document.title=b.nameHe;
window.__BRAND_BOOT__=b;
}catch(e){}})()`

// Second half, injected at the END of <body>: the markup's brand NAMES are
// server-rendered with the deployment default, so they would flash before React
// hydrates. This rewrites every [data-brand] element from the cached brand
// while the document is still parsing — i.e. before first paint.
export const BRAND_TEXT_SCRIPT = `(function(){try{
var b=window.__BRAND_BOOT__;if(!b)return;
var he=(typeof b.nameHe==='string'&&b.nameHe)?b.nameHe:null;
var en=(typeof b.nameEn==='string'&&b.nameEn)?b.nameEn:he;
var map={nameHe:he,nameEn:en,tagline:(typeof b.tagline==='string'&&b.tagline)?b.tagline:null,
wordmarkShort:(typeof b.wordmarkShort==='string'&&b.wordmarkShort)?b.wordmarkShort:(en?en.slice(0,12):null)};
var els=document.querySelectorAll('[data-brand]');
for(var i=0;i<els.length;i++){var v=map[els[i].getAttribute('data-brand')];if(v)els[i].textContent=v}
}catch(e){}})()`
