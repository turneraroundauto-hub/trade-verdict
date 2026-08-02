let API_URL = '';
let authH = function(){ return {}; };
let addSecret = function(url){ return url; };
const tickerCache = {};

export function initTickerCache(config){
  API_URL = config.API_URL;
  authH = config.authH;
  addSecret = config.addSecret;
}

export async function fetchTickerData(symbol,force){
  if(tickerCache[symbol]&&!force)return tickerCache[symbol];
  try{
    var res=await fetch(addSecret(API_URL+'/ticker/'+symbol),{headers:authH()});
    var data=await res.json();
    tickerCache[symbol]=data;return data;
  }catch(e){return null}
}
