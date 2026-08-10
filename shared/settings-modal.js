import { TIMEZONES, LINK_SITES, getTzPref, setTzPref, getLinkSitePref, setLinkSitePref, getCustomTemplate, setCustomTemplate, isValidCustomTemplate, buildTemplateFromExample } from './prefs.js?v=3';

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
      + '<div style="font-size:10px;color:var(--dim);line-height:1.6;margin-bottom:8px">'
        + '1. Open any one stock\'s page on the site you want.<br>'
        + '2. Type that stock\'s ticker and paste its URL below — the link pattern is figured out for you.'
      + '</div>'
      + '<input type="text" id="settings-custom-ex-ticker" placeholder="Ticker shown on that page, e.g. AAPL" style="width:100%;margin-bottom:8px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box">'
      + '<input type="text" id="settings-custom-ex-url" placeholder="That stock\'s page URL" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box">'
      + '<div id="settings-custom-status" style="font-size:10px;margin-top:8px"></div>'
      + '<button type="button" id="settings-custom-advanced-toggle" style="background:none;border:none;color:var(--dim);font-family:monospace;font-size:10px;text-decoration:underline;cursor:pointer;padding:0;margin-top:10px">Edit the link pattern directly instead</button>'
      + '<div id="settings-custom-advanced" style="display:none;margin-top:8px">'
        + '<input type="text" id="settings-custom-template" placeholder="https://example.com/quote/{TICKER}" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box">'
        + '<div style="font-size:10px;color:var(--dim);margin-top:6px">Use <span style="color:var(--white)">{TICKER}</span> or <span style="color:var(--white)">{ticker}</span> where the symbol goes.</div>'
      + '</div>'
      + '<div style="font-size:10px;color:var(--amber);margin-top:8px">Blank or invalid = Yahoo Finance is used instead.</div>'
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
  var exTicker = document.getElementById('settings-custom-ex-ticker');
  var exUrl = document.getElementById('settings-custom-ex-url');
  var customStatus = document.getElementById('settings-custom-status');
  var advancedToggle = document.getElementById('settings-custom-advanced-toggle');
  var advancedWrap = document.getElementById('settings-custom-advanced');
  var customInput = document.getElementById('settings-custom-template');

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

  // Auto-detects the ticker inside the pasted URL and saves the resulting
  // template — the user never has to see or type {TICKER} themselves
  // unless they open Advanced.
  function tryAutoDetect(){
    var t = exTicker.value.trim();
    var u = exUrl.value.trim();
    if(!t || !u){ showCurrentTemplate(); return; }
    var template = buildTemplateFromExample(u, t);
    if(template){
      setCustomTemplate(template);
      customInput.value = template;
      customStatus.textContent = 'Saved — found it: ' + template;
      customStatus.style.color = 'var(--green)';
    } else {
      customStatus.textContent = 'Couldn\'t find "' + t + '" in that URL — check it matches exactly, or use "Edit the link pattern directly" below.';
      customStatus.style.color = 'var(--red)';
    }
  }
  exTicker.addEventListener('input', tryAutoDetect);
  exUrl.addEventListener('input', tryAutoDetect);

  advancedToggle.addEventListener('click', function(){
    var open = advancedWrap.style.display === 'block';
    advancedWrap.style.display = open ? 'none' : 'block';
    advancedToggle.textContent = open ? 'Edit the link pattern directly instead' : 'Hide the link pattern editor';
  });
  customInput.addEventListener('input', function(){
    var v = customInput.value.trim();
    if(!v){ showCurrentTemplate(); return; }
    if(isValidCustomTemplate(v)){
      setCustomTemplate(v);
      customStatus.textContent = 'Saved — links now use this.';
      customStatus.style.color = 'var(--green)';
    } else {
      customStatus.textContent = 'Needs http(s):// and a {TICKER} placeholder — using Yahoo Finance until fixed.';
      customStatus.style.color = 'var(--red)';
    }
  });
  return el;
}

export function openSettingsModal(){
  var el = ensureModal();
  document.getElementById('settings-tz').value = getTzPref();
  document.getElementById('settings-link-site').value = getLinkSitePref();
  document.getElementById('settings-custom-ex-ticker').value = '';
  document.getElementById('settings-custom-ex-url').value = '';
  document.getElementById('settings-custom-template').value = getCustomTemplate();
  document.getElementById('settings-custom-advanced').style.display = 'none';
  document.getElementById('settings-custom-advanced-toggle').textContent = 'Edit the link pattern directly instead';
  var saved = getCustomTemplate();
  var statusEl = document.getElementById('settings-custom-status');
  statusEl.textContent = saved ? 'Currently: ' + saved : 'No link saved yet — using Yahoo Finance.';
  statusEl.style.color = 'var(--dim)';
  document.getElementById('settings-custom-wrap').style.display = getLinkSitePref() === 'custom' ? 'block' : 'none';
  el.style.display = 'flex';
}

export function closeSettingsModal(){
  var el = document.getElementById('settings-modal');
  if(el) el.style.display = 'none';
}

window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
