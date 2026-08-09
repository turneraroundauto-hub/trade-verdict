import { TIMEZONES, LINK_SITES, getTzPref, setTzPref, getLinkSitePref, setLinkSitePref } from './prefs.js?v=1';

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
    + '<div style="font-size:10px;color:var(--dim);margin-bottom:6px">TICKER LINKS OPEN IN</div>'
    + '<select id="settings-link-site" style="width:100%;margin-bottom:18px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:12px;padding:8px;border-radius:6px"></select>'
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
  linkSel.addEventListener('change', function(){ setLinkSitePref(linkSel.value); });
  return el;
}

export function openSettingsModal(){
  var el = ensureModal();
  document.getElementById('settings-tz').value = getTzPref();
  document.getElementById('settings-link-site').value = getLinkSitePref();
  el.style.display = 'flex';
}

export function closeSettingsModal(){
  var el = document.getElementById('settings-modal');
  if(el) el.style.display = 'none';
}

window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
