var verdictCache = {};
function lsCK(t) { return 'tv_v_' + t + '_' + new Date().toDateString().replace(/ /g, '_'); }
function saveLSVerdict(t, d) { try {
    localStorage.setItem(lsCK(t), JSON.stringify(d));
}
catch (e) { } }
function loadLSVerdict(t) { try {
    var r = localStorage.getItem(lsCK(t));
    return r ? JSON.parse(r) : null;
}
catch (e) {
    return null;
} }
export function cleanLS() { var today = new Date().toDateString().replace(/ /g, '_'); Object.keys(localStorage).forEach(function (k) { if (k.startsWith('tv_v_') && !k.includes(today))
    localStorage.removeItem(k); }); }
export function cacheVerdict(t, d) { verdictCache[t] = { data: d, date: new Date().toDateString() }; saveLSVerdict(t, d); }
export function getCachedVerdict(t) {
    var e = verdictCache[t];
    if (e && e.date === new Date().toDateString())
        return e.data;
    var ls = loadLSVerdict(t);
    if (ls) {
        verdictCache[t] = { data: ls, date: new Date().toDateString() };
        return ls;
    }
    return null;
}
