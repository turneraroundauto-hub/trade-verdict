import { TIMEZONES, LINK_SITES, getTzPref, setTzPref, getLinkSitePref, setLinkSitePref, getCustomTemplate, setCustomTemplate, getCustomMarketTemplate, setCustomMarketTemplate, buildTemplateFromExample, detectTickerInUrl } from './prefs.js?v=10';

// Injected on first open, same pattern as watchlist.js's undo-toast — no
// markup needed in any tier's index.html, so this drops into Free/Starter/
// Pro identically regardless of how their header is laid out.
function ensureModal(){
  var el = document.getElementById('settings-modal');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'settings-modal';
  el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  el.innerHTML =
    '<div style="background:#101c2e;border:1px solid var(--border);border-radius:10px;padding:20px;max-width:340px;width:100%;font-family:monospace;color:var(--white)" onclick="event.stopPropagation()">'
    + '<div style="font-size:13px;font-weight:700;letter-spacing:.06em;margin-bottom:16px">SETTINGS</div>'
    + '<div style="font-size:10px;color:var(--dim);margin-bottom:6px">TIME ZONE</div>'
    + '<select id="settings-tz" style="width:100%;margin-bottom:16px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:12px;padding:8px;border-radius:6px"></select>'
    + '<div style="font-size:10px;color:var(--dim);margin-bottom:6px">TICKER &amp; NEWS LINKS OPEN IN</div>'
    + '<select id="settings-link-site" style="width:100%;margin-bottom:8px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:12px;padding:8px;border-radius:6px"></select>'
    + '<div id="settings-custom-wrap" style="display:none;margin-bottom:18px">'
      + '<div style="font-size:9px;color:var(--dim);margin-bottom:5px">MARKET DATA (TICKER) URL</div>'
      + '<input type="text" id="settings-custom-market-url" placeholder="Paste your favorite stock quote URL" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box">'
      + '<div id="settings-custom-market-status" style="font-size:10px;margin-top:8px;margin-bottom:16px"></div>'
      + '<div style="font-size:9px;color:var(--dim);margin-bottom:5px">NEWS URL</div>'
      + '<input type="text" id="settings-custom-ex-url" placeholder="Paste your favorite market news URL" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box">'
      + '<div id="settings-custom-status" style="font-size:10px;margin-top:8px"></div>'
      + '<div style="font-size:10px;color:var(--amber);margin-top:8px">Blank or invalid = Yahoo Finance is used instead, per field.</div>'
    + '</div>'
    + '<button type="button" id="settings-close-btn" style="width:100%;background:var(--blue);border:none;color:#03101f;font-family:monospace;font-size:12px;font-weight:700;padding:10px;border-radius:6px;cursor:pointer;letter-spacing:.04em">DONE</button>'
    + '</div>';
  document.body.appendChild(el);
  el.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
  var tzSel = document.getElementById('settings-tz');
  Object.keys(TIMEZONES).forEach(function(k){
    var o = document.createElement('option');
    o.value = k; o.textContent = TIMEZONES[k].label;
    tzSel.appendChild(o);
  });
  tzSel.addEventListener('change', function(){ setTzPref(tzSel.value); });
  var linkSel = document.getElementById('settings-link-site');
  Object.keys(LINK_SITES).forEach(function(k){
    var o = document.createElement('option');
    o.value = k; o.textContent = LINK_SITES[k].label;
    linkSel.appendChild(o);
  });
  var customWrap = document.getElementById('settings-custom-wrap');
  var exUrl = document.getElementById('settings-custom-ex-url');
  var customStatus = document.getElementById('settings-custom-status');
  var marketUrl = document.getElementById('settings-custom-market-url');
  var marketStatus = document.getElementById('settings-custom-market-status');

  function refreshCustomVisibility(){
    customWrap.style.display = linkSel.value === 'custom' ? 'block' : 'none';
  }
  linkSel.addEventListener('change', function(){
    setLinkSitePref(linkSel.value);
    refreshCustomVisibility();
  });

  function showCurrentTemplate(){
    var saved = getCustomTemplate();
    customStatus.textContent = saved ? 'Currently: ' + saved : 'No link saved yet — using Yahoo Finance.';
    customStatus.style.color = 'var(--dim)';
  }

  function showCurrentMarketTemplate(){
    var saved = getCustomMarketTemplate();
    marketStatus.textContent = saved ? 'Currently: ' + saved : 'No link saved yet — using Yahoo Finance.';
    marketStatus.style.color = 'var(--dim)';
  }

  // One field per link type: paste a URL, everything else is inferred. A
  // missing http(s):// is filled in automatically rather than rejected, and
  // the ticker is detected from the URL itself (detectTickerInUrl) -- the
  // user never sees or types {TICKER} or the symbol at all. Market data and
  // news route through separate saved templates (see prefs.js) since a
  // favorite quote site and a favorite news site are frequently not the
  // same site.
  exUrl.addEventListener('input', function(){
    var raw = exUrl.value.trim();
    if(!raw){ showCurrentTemplate(); return; }
    var withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    var detected = detectTickerInUrl(withScheme);
    var template = detected ? buildTemplateFromExample(withScheme, detected) : null;
    if(template){
      setCustomTemplate(template);
      customStatus.textContent = 'Saved — news links now use this.';
      customStatus.style.color = 'var(--green)';
    } else {
      customStatus.textContent = 'Couldn\'t find a ticker in that URL — try pasting a single stock\'s page instead.';
      customStatus.style.color = 'var(--red)';
    }
  });

  marketUrl.addEventListener('input', function(){
    var raw = marketUrl.value.trim();
    if(!raw){ showCurrentMarketTemplate(); return; }
    var withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    var detected = detectTickerInUrl(withScheme);
    var template = detected ? buildTemplateFromExample(withScheme, detected) : null;
    if(template){
      setCustomMarketTemplate(template);
      marketStatus.textContent = 'Saved — ticker links now use this.';
      marketStatus.style.color = 'var(--green)';
    } else {
      marketStatus.textContent = 'Couldn\'t find a ticker in that URL — try pasting a single stock\'s page instead.';
      marketStatus.style.color = 'var(--red)';
    }
  });
  return el;
}

export function openSettingsModal(){
  var el = ensureModal();
  document.getElementById('settings-tz').value = getTzPref();
  document.getElementById('settings-link-site').value = getLinkSitePref();

  document.getElementById('settings-custom-ex-url').value = '';
  var saved = getCustomTemplate();
  var statusEl = document.getElementById('settings-custom-status');
  statusEl.textContent = saved ? 'Currently: ' + saved : 'No link saved yet — using Yahoo Finance.';
  statusEl.style.color = 'var(--dim)';

  document.getElementById('settings-custom-market-url').value = '';
  var savedMarket = getCustomMarketTemplate();
  var marketStatusEl = document.getElementById('settings-custom-market-status');
  marketStatusEl.textContent = savedMarket ? 'Currently: ' + savedMarket : 'No link saved yet — using Yahoo Finance.';
  marketStatusEl.style.color = 'var(--dim)';

  document.getElementById('settings-custom-wrap').style.display = getLinkSitePref() === 'custom' ? 'block' : 'none';
  el.style.display = 'flex';
}

export function closeSettingsModal(){
  var el = document.getElementById('settings-modal');
  if(el) el.style.display = 'none';
}

window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
