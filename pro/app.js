// shared/ticker-cache.ts
var API_URL = "";
var authH = () => ({});
var addSecret = (url) => url;
var tickerCache = {};
var inFlight = {};
function initTickerCache(config) {
  API_URL = config.API_URL;
  authH = config.authH;
  addSecret = config.addSecret;
}
async function lookupSymbol(query) {
  try {
    const res = await fetch(addSecret(API_URL + "/lookup?q=" + encodeURIComponent(query)), { headers: authH() });
    const data = await res.json();
    return typeof data.symbol === "string" ? data.symbol : null;
  } catch (e) {
    return null;
  }
}
async function fetchTickerData(symbol, force) {
  if (tickerCache[symbol] && !force) return tickerCache[symbol];
  if (inFlight[symbol] && !force) return inFlight[symbol];
  const p = (async () => {
    try {
      const res = await fetch(addSecret(API_URL + "/ticker/" + symbol), { headers: authH() });
      const data = await res.json();
      tickerCache[symbol] = data;
      return data;
    } catch (e) {
      return null;
    } finally {
      delete inFlight[symbol];
    }
  })();
  inFlight[symbol] = p;
  return p;
}

// shared/session.ts
var SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var REFRESH_LEAD_SEC = 5 * 60;
var KEEPALIVE_MS = 4 * 60 * 1e3;
function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem("tv_session") || "null");
  } catch (e) {
    return null;
  }
}
function storeSession(s) {
  if (s) localStorage.setItem("tv_session", JSON.stringify(s));
  else localStorage.removeItem("tv_session");
}
function stampNewSession(s) {
  if (s) s.loginAt = Date.now();
  return s;
}
function accessTokenExpired(s, leadSec) {
  return !!(s && s.expiresAt && Date.now() / 1e3 > s.expiresAt - leadSec);
}
function isSessionValid(s) {
  if (!s || !s.token) return false;
  if (s.refreshToken && s.loginAt) return Date.now() - s.loginAt < SESSION_MAX_AGE_MS;
  return !accessTokenExpired(s, 60);
}
var inFlight2 = null;
function ensureFreshSession(apiUrl) {
  var s = getStoredSession();
  if (!isSessionValid(s)) return Promise.resolve(null);
  if (!accessTokenExpired(s, REFRESH_LEAD_SEC) || !s.refreshToken) return Promise.resolve(s);
  if (inFlight2) return inFlight2;
  inFlight2 = (async () => {
    try {
      var r = await fetch(apiUrl + "/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
      if (r.ok) {
        var fresh = await r.json();
        if (fresh && fresh.token) {
          var cur = getStoredSession() || s;
          cur.token = fresh.token;
          cur.refreshToken = fresh.refreshToken || cur.refreshToken;
          cur.expiresAt = fresh.expiresAt;
          storeSession(cur);
          return cur;
        }
      }
      if (r.status === 401) {
        storeSession(null);
        return null;
      }
    } catch (e) {
    }
    return accessTokenExpired(s, 0) ? null : s;
  })();
  inFlight2.finally(() => {
    inFlight2 = null;
  });
  return inFlight2;
}
function startSessionKeepAlive(apiUrl, onChange) {
  var tick = function() {
    ensureFreshSession(apiUrl).then(onChange);
  };
  setInterval(tick, KEEPALIVE_MS);
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") tick();
  });
}

// shared/device-id.ts
var DEVICE_ID_KEY = "tv_device_id";
var DEVICE_PLATFORM_KEY = "tv_device_platform";
function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}
function getDevicePlatform() {
  try {
    const cached = localStorage.getItem(DEVICE_PLATFORM_KEY);
    if (cached === "web" || cached === "twa") return cached;
    const platform = document.referrer.indexOf("android-app://") === 0 ? "twa" : "web";
    localStorage.setItem(DEVICE_PLATFORM_KEY, platform);
    return platform;
  } catch {
    return "web";
  }
}
function pingDeviceVisit(config) {
  try {
    const deviceId = getOrCreateDeviceId();
    const platform = getDevicePlatform();
    fetch(config.addSecret(config.API_URL + "/device-ping"), {
      method: "POST",
      headers: config.authH(),
      body: JSON.stringify({ deviceId, platform }),
      keepalive: true
    }).catch(() => {
    });
  } catch {
  }
}

// shared/prefs.ts
var TIMEZONES = {
  ET: { label: "ET (Eastern)", iana: "America/New_York" },
  CT: { label: "CT (Central)", iana: "America/Chicago" },
  MT: { label: "MT (Mountain)", iana: "America/Denver" },
  PT: { label: "PT (Pacific)", iana: "America/Los_Angeles" }
};
var LINK_SITES = {
  yahoo: {
    label: "Yahoo Finance",
    href: function(t) {
      return "https://finance.yahoo.com/quote/" + encodeURIComponent(t);
    },
    newsHref: function(t) {
      return "https://finance.yahoo.com/quote/" + encodeURIComponent(t) + "/news/";
    }
  },
  tradingview: {
    label: "TradingView",
    // Bare /symbols/{TICKER}/ has the identical exchange-ambiguity problem
    // as Google Finance's direct quote page (see the comment above) — this
    // app has no per-symbol exchange data (checked: nowhere in the frontend
    // or the mirrored server.js), and TradingView's own bare-symbol
    // resolution isn't reliably US-biased: confirmed live (Aug 10, 2026)
    // that a real user's ARCC link landed on Egypt's EGX-listed Arabian
    // Cement instead of NASDAQ's Ares Capital. Routes through a plain web
    // search instead (same proven-safe pattern as Yahoo/Google's own
    // fallback), biased toward tradingview.com with a keyword rather than
    // the `site:` operator — this app already found `site:` search results
    // unreliable (Google shows an interstitial banner instead of direct
    // results, hit earlier this session while building the news-link
    // feature). UNVERIFIED LIVE: this sandbox blocks tradingview.com and
    // google.com egress alike, so the actual search-result ranking for a
    // given ticker couldn't be confirmed — spot-check after deploy.
    href: function(t) {
      return "https://www.google.com/search?q=" + encodeURIComponent(t.replace("-USD", " USD") + " stock tradingview");
    },
    newsHref: function(t) {
      return "https://news.google.com/search?q=" + encodeURIComponent(t.replace("-USD", " USD") + " stock tradingview");
    }
  },
  stocktwits: {
    label: "StockTwits",
    href: function(t) {
      return "https://stocktwits.com/symbol/" + encodeURIComponent(t.replace("-USD", ".X"));
    },
    newsHref: function(t) {
      return "https://stocktwits.com/symbol/" + encodeURIComponent(t.replace("-USD", ".X")) + "/news";
    }
  },
  google: {
    label: "Google Finance",
    href: function(t) {
      return "https://www.google.com/search?q=" + encodeURIComponent(t.replace("-USD", " USD") + " stock");
    },
    newsHref: function(t) {
      return "https://news.google.com/search?q=" + encodeURIComponent(t.replace("-USD", " USD") + " stock");
    }
  },
  robinhood: {
    label: "Robinhood",
    href: function(t) {
      return "https://robinhood.com/stocks/" + encodeURIComponent(t.replace("-USD", ""));
    }
  },
  custom: {
    label: "Custom link\u2026",
    href: function(t) {
      return customMarketTemplateHref(t);
    },
    newsHref: function(t) {
      return customNewsTemplateHref(t);
    }
  }
};
var CUSTOM_TEMPLATE_KEY = "tv_link_custom_template";
var CUSTOM_MARKET_TEMPLATE_KEY = "tv_link_custom_market_template";
function isValidCustomTemplate(template) {
  var t = (template || "").trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (!/\{ticker\}/i.test(t)) return false;
  return true;
}
function buildTemplateFromExample(exampleUrl, exampleTicker) {
  var url = (exampleUrl || "").trim();
  var ticker = (exampleTicker || "").trim();
  if (!ticker || !/^https?:\/\//i.test(url)) return null;
  var escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var re = new RegExp("(^|[^A-Za-z0-9])(" + escaped + ")(?=[^A-Za-z0-9]|$)", "gi");
  var found = false;
  var result = url.replace(re, function(_match, boundary, matched) {
    found = true;
    var placeholder = matched === matched.toUpperCase() ? "{TICKER}" : "{ticker}";
    return boundary + placeholder;
  });
  return found ? result : null;
}
var URL_NON_TICKER_WORDS = /* @__PURE__ */ new Set([
  "quote",
  "quotes",
  "stock",
  "stocks",
  "symbol",
  "symbols",
  "news",
  "chart",
  "charts",
  "charting",
  "market",
  "markets",
  "markt",
  "investing",
  "finance",
  "financials",
  "company",
  "overview",
  "summary",
  "profile",
  "research",
  "www",
  "com",
  "us",
  "en",
  "html",
  "htm",
  "index",
  "nasdaq",
  "nyse",
  "amex",
  "otc",
  "otcmkts",
  "arca",
  "bats",
  "cboe"
]);
function looksLikeTicker(s) {
  return /^[A-Za-z]{1,5}(\.[A-Za-z]{1,2})?$/.test(s);
}
function detectTickerInUrl(rawUrl) {
  var url;
  try {
    url = new URL((rawUrl || "").trim());
  } catch (e) {
    return null;
  }
  var segments = url.pathname.split("/").filter(Boolean);
  for (var i = segments.length - 1; i >= 0; i--) {
    var seg;
    try {
      seg = decodeURIComponent(segments[i]);
    } catch (e) {
      seg = segments[i];
    }
    if (looksLikeTicker(seg) && !URL_NON_TICKER_WORDS.has(seg.toLowerCase())) return seg;
    if (seg.indexOf("-") !== -1) {
      var parts = seg.split("-");
      for (var j = parts.length - 1; j >= 0; j--) {
        if (looksLikeTicker(parts[j]) && !URL_NON_TICKER_WORDS.has(parts[j].toLowerCase())) return parts[j];
      }
    }
  }
  var queryKeys = ["symbol", "ticker", "q", "s"];
  for (var k = 0; k < queryKeys.length; k++) {
    var v = url.searchParams.get(queryKeys[k]);
    if (!v) continue;
    var last = v.indexOf(":") !== -1 ? v.split(":").pop() : v;
    if (looksLikeTicker(last)) return last;
  }
  return null;
}
function getCustomTemplate() {
  return localStorage.getItem(CUSTOM_TEMPLATE_KEY) || "";
}
function setCustomTemplate(template) {
  if (forced) return false;
  var t = (template || "").trim();
  if (!isValidCustomTemplate(t)) return false;
  localStorage.setItem(CUSTOM_TEMPLATE_KEY, t);
  listeners.forEach(function(cb2) {
    cb2();
  });
  return true;
}
function getCustomMarketTemplate() {
  return localStorage.getItem(CUSTOM_MARKET_TEMPLATE_KEY) || "";
}
function setCustomMarketTemplate(template) {
  if (forced) return false;
  var t = (template || "").trim();
  if (!isValidCustomTemplate(t)) return false;
  localStorage.setItem(CUSTOM_MARKET_TEMPLATE_KEY, t);
  listeners.forEach(function(cb2) {
    cb2();
  });
  return true;
}
function applyTemplate(template, t) {
  return template.replace(/\{TICKER\}/g, encodeURIComponent(t.toUpperCase())).replace(/\{ticker\}/g, encodeURIComponent(t.toLowerCase()));
}
function customMarketTemplateHref(t) {
  var template = getCustomMarketTemplate();
  if (!isValidCustomTemplate(template)) return LINK_SITES.yahoo.href(t);
  return applyTemplate(template, t);
}
function customNewsTemplateHref(t) {
  var template = getCustomTemplate();
  if (!isValidCustomTemplate(template)) return LINK_SITES.yahoo.newsHref(t);
  return applyTemplate(template, t);
}
var TZ_KEY = "tv_tz_pref";
var LINK_KEY = "tv_link_site_pref";
var listeners = [];
var forced = false;
function getTzPref() {
  if (forced) return "ET";
  var v = localStorage.getItem(TZ_KEY);
  return v && TIMEZONES[v] ? v : "ET";
}
function setTzPref(tz) {
  if (forced || !TIMEZONES[tz]) return;
  localStorage.setItem(TZ_KEY, tz);
  listeners.forEach(function(cb2) {
    cb2();
  });
}
function getTzIana() {
  return TIMEZONES[getTzPref()].iana;
}
function getLinkSitePref() {
  if (forced) return "yahoo";
  var v = localStorage.getItem(LINK_KEY);
  return v && LINK_SITES[v] ? v : "yahoo";
}
function setLinkSitePref(site) {
  if (forced || !LINK_SITES[site]) return;
  localStorage.setItem(LINK_KEY, site);
  listeners.forEach(function(cb2) {
    cb2();
  });
}
function tickerHref(t) {
  return LINK_SITES[getLinkSitePref()].href(t);
}
function newsHref(t) {
  var site = LINK_SITES[getLinkSitePref()];
  return (site.newsHref || site.href)(t);
}
function onPrefsChange(cb2) {
  listeners.push(cb2);
}
function refreshTickerLinks(root) {
  (root || document).querySelectorAll("a[data-ticker]").forEach(function(a) {
    a.href = tickerHref(a.dataset.ticker);
  });
}

// shared/context-highlight.ts
var STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "of",
  "in",
  "on",
  "for",
  "to",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "after",
  "before",
  "over",
  "under",
  "into",
  "out",
  "up",
  "down",
  "than",
  "then",
  "so",
  "not",
  "no",
  "yes",
  "has",
  "have",
  "had",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "more",
  "most",
  "also",
  "still",
  "just",
  "now",
  "new",
  "via",
  "their",
  "his",
  "her",
  "your",
  "you",
  "we",
  "our"
]);
function tokenize(text) {
  return (text || "").toLowerCase().match(/[a-z0-9$%]+/g) || [];
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function highlightContextMatches(headline, contextText) {
  var safe = escapeHtml(headline || "");
  var ctxWords = new Set(tokenize(contextText).filter(function(w) {
    return w.length > 2 && !STOPWORDS.has(w);
  }));
  if (ctxWords.size < 2) return safe;
  var headlineWords = new Set(tokenize(headline));
  var matches = [];
  headlineWords.forEach(function(w) {
    if (ctxWords.has(w)) matches.push(w);
  });
  if (matches.length < 2) return safe;
  var pattern = matches.sort(function(a, b) {
    return b.length - a.length;
  }).map(function(w) {
    return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|");
  var re = new RegExp("\\b(" + pattern + ")\\b", "gi");
  return safe.replace(re, '<mark class="ctx-match">$1</mark>');
}

// shared/watchlist.ts
var watchlist = [];
var maxTickers = 3;
var upgradeMessage = "";
var gesturesBound = false;
var renderScope = null;
var postRenderHook = null;
var cardsReadyPromise = new Promise(function(res) {
});
var saveHook = null;
function onWatchlistSave(cb2) {
  saveHook = cb2;
}
var addedHook = null;
function onTickersAdded(cb2) {
  addedHook = cb2;
}
function initWatchlist(config) {
  maxTickers = config.maxTickers;
  upgradeMessage = config.upgradeMessage;
  var _wl = JSON.parse(localStorage.getItem("tv_wl") || JSON.stringify(config.defaultTickers));
  if (_wl.length > maxTickers) _wl = _wl.slice(0, maxTickers);
  watchlist = _wl;
  bindGestures();
}
function saveWL() {
  localStorage.setItem("tv_wl", JSON.stringify(watchlist));
  var countEl = document.getElementById("ticker-count");
  if (countEl) countEl.textContent = "CRF \xB7 " + watchlist.length + " TICKERS";
  if (saveHook) saveHook();
}
function setWatchlist(tickers) {
  var clean = [], dropped = [];
  tickers.forEach(function(t) {
    var u = String(t).toUpperCase().trim();
    if (/^[A-Z]{1,6}$/.test(u)) {
      if (!clean.includes(u)) clean.push(u);
    } else if (u) dropped.push(u);
  });
  if (clean.length > maxTickers) {
    dropped = dropped.concat(clean.slice(maxTickers));
    clean = clean.slice(0, maxTickers);
  }
  if (tickers.length && !clean.length) {
    console.error("setWatchlist: all " + tickers.length + " provided ticker(s) failed validation, keeping existing watchlist unchanged:", tickers);
    return dropped;
  }
  watchlist = clean;
  saveWL();
  renderWatchlist();
  return dropped;
}
function splitEntries(raw) {
  return raw.replace(/[$#]/g, "").split(/[,;|\n]+/).map(function(s) {
    return s.trim();
  }).filter(Boolean);
}
function literalTickersIn(segment) {
  var words = segment.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.every(function(w) {
    return /^[A-Z]{1,6}$/.test(w);
  }) ? words : null;
}
function updateCardMeta(ticker, td) {
  var card = document.getElementById("card-" + ticker);
  if (!card) return;
  var priceEl = card.querySelector(".ticker-price");
  if (priceEl && td) {
    priceEl.textContent = td.metrics && td.metrics.price ? "$" + td.metrics.price.toFixed(2) : "N/A";
  }
  var phaseEl = card.querySelector(".phase-strip");
  if (phaseEl && td && td.metrics) {
    var m = td.metrics;
    var rp = m.rangePosition !== null && m.rangePosition !== void 0 ? m.rangePosition + "%" : "?";
    var ph = m.phaseProxy || "?";
    var phColor = ph === "PHASE_3" ? "var(--red)" : ph === "PHASE_2" ? "var(--amber)" : "var(--green)";
    var betaStr = m.beta ? "\u03B2" + m.beta.toFixed(1) : "?";
    var proxyName = td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name : "";
    var proxyShort = proxyName.split("(")[0].trim();
    phaseEl.innerHTML = '<div class="phase-item"><span class="phase-lbl">52W</span><span class="phase-val">' + rp + '</span></div><div class="phase-item"><span class="phase-lbl">PHASE</span><span class="phase-val" style="color:' + phColor + '">' + ph.replace("PHASE_", "") + '</span></div><div class="phase-item"><span class="phase-lbl">\u03B2</span><span class="phase-val">' + betaStr + "</span></div>" + (proxyShort ? '<div class="phase-item"><span class="phase-lbl">PROXY</span><span class="phase-val" style="color:var(--blue);font-size:9px">' + proxyShort + "</span></div>" : "");
  } else if (phaseEl && td) {
    phaseEl.innerHTML = '<div class="phase-item"><span class="phase-val" style="color:var(--dim);font-size:9px">No market data for this symbol (index/unsupported ticker)</span></div>';
  }
  var newsEl = card.querySelector(".news-line");
  var news = td && td.news;
  if (newsEl) {
    if (news && news.ageHours <= 300) {
      newsEl.style.display = "block";
      var ctxEl = document.getElementById("context-input");
      var headlineHtml = highlightContextMatches(news.headline, ctxEl ? ctxEl.value : "");
      newsEl.innerHTML = '<a href="' + newsHref(ticker) + '" target="_blank">' + headlineHtml + '</a><span class="news-age">' + news.ageLabel + "</span>";
    } else newsEl.style.display = "none";
  }
}
async function addTickers() {
  var input = document.getElementById("ticker-input");
  var raw = input.value;
  var entries = splitEntries(raw);
  if (!entries.length) return alert("No valid tickers or company names. Try: AAPL or Tesla");
  var importBtn = document.getElementById("importBtn");
  var importBtnLabel = importBtn ? importBtn.textContent : null;
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.classList.add("btn-running");
    importBtn.textContent = "ADDING\u2026";
  }
  var resolved;
  try {
    resolved = await Promise.all(entries.map(async function(entry) {
      var literal = literalTickersIn(entry);
      if (literal) return { entry, tickers: literal };
      var symbol = await lookupSymbol(entry);
      return { entry, tickers: symbol ? [symbol] : [] };
    }));
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.classList.remove("btn-running");
      importBtn.textContent = importBtnLabel || "Import Tickers";
    }
  }
  var tickers = [];
  var unresolved = [];
  resolved.forEach(function(r) {
    if (r.tickers.length) tickers.push.apply(tickers, r.tickers);
    else unresolved.push(r.entry);
  });
  tickers = tickers.filter(function(t, i) {
    return tickers.indexOf(t) === i;
  });
  if (!tickers.length) return alert(unresolved.length ? "Couldn't find: " + unresolved.join(", ") : "No valid tickers or company names. Try: AAPL or Tesla");
  var newOnes = tickers.filter(function(t) {
    return !watchlist.includes(t);
  });
  if (newOnes.length && watchlist.length + newOnes.length > maxTickers) {
    var evictCount = watchlist.length + newOnes.length - maxTickers;
    var proceed = confirm(upgradeMessage + "\n\nAdding " + (newOnes.length === 1 ? "this ticker" : "these tickers") + " will remove your oldest " + evictCount + " ticker" + (evictCount === 1 ? "" : "s") + " to make room. Continue?");
    if (!proceed) {
      if (unresolved.length) alert("Couldn't find: " + unresolved.join(", "));
      return;
    }
  }
  watchlist.unshift.apply(watchlist, newOnes);
  if (watchlist.length > maxTickers) watchlist = watchlist.slice(0, maxTickers);
  input.value = "";
  saveWL();
  renderWatchlist();
  tickers.forEach(function(t) {
    fetchTickerData(t).then(function(d) {
      if (d) updateCardMeta(t, d);
    });
  });
  if (unresolved.length) alert("Couldn't find: " + unresolved.join(", "));
  if (newOnes.length && addedHook) addedHook();
}
function addKnownTicker(symbol) {
  var t = symbol.toUpperCase();
  if (watchlist.includes(t)) return false;
  if (watchlist.length + 1 > maxTickers) {
    var proceed = confirm(upgradeMessage + "\n\nAdding this ticker will remove your oldest ticker to make room. Continue?");
    if (!proceed) return false;
    watchlist.pop();
  }
  watchlist.unshift(t);
  saveWL();
  renderWatchlist();
  fetchTickerData(t).then(function(d) {
    if (d) updateCardMeta(t, d);
  });
  if (addedHook) addedHook();
  return true;
}
function removeTicker(ticker) {
  var idx = watchlist.indexOf(ticker);
  if (idx === -1) return;
  watchlist = watchlist.filter(function(t) {
    return t !== ticker;
  });
  saveWL();
  renderWatchlist();
  showUndoToast(ticker, idx);
}
var undoTimer = null;
function showUndoToast(ticker, idx) {
  var el = document.getElementById("undo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "undo-toast";
    el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#101c2e;border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:14px;font-family:monospace;font-size:12px;color:var(--white);box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:999;opacity:0;transition:opacity .2s;pointer-events:none";
    document.body.appendChild(el);
  }
  if (undoTimer) clearTimeout(undoTimer);
  el.innerHTML = "<span>Removed " + ticker + '</span><button id="undo-btn" style="background:none;border:none;color:var(--blue);font-family:monospace;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.06em;pointer-events:auto">UNDO</button>';
  el.style.pointerEvents = "auto";
  el.style.opacity = "1";
  document.getElementById("undo-btn").onclick = function() {
    if (!watchlist.includes(ticker)) {
      watchlist.splice(Math.min(idx, watchlist.length), 0, ticker);
      saveWL();
      renderWatchlist();
      fetchTickerData(ticker).then(function(d) {
        if (d) updateCardMeta(ticker, d);
      });
    }
    hideUndoToast();
  };
  undoTimer = setTimeout(hideUndoToast, 4e3);
}
function hideUndoToast() {
  var el = document.getElementById("undo-toast");
  if (el) {
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
  }
  if (undoTimer) clearTimeout(undoTimer);
}
function renderWatchlist() {
  var wl = document.getElementById("watchlist");
  if (!wl) return;
  var list = renderScope != null ? watchlist.slice(0, renderScope) : watchlist;
  wl.innerHTML = list.map(function(ticker) {
    return '<div class="card-wrap" data-ticker="' + ticker + '"><div class="swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div><div class="card loading" id="card-' + ticker + '"><div class="card-head"><div class="card-left"><div class="ticker-row"><span class="ticker-name"><a class="ticker-a" href="' + tickerHref(ticker) + '" target="_blank">' + ticker + '</a></span><span class="ticker-price">&mdash;</span></div><div class="pregate-strip" id="pregate-' + ticker + `" style="display:none"></div><div class="news-line" style="display:none"></div><div class="phase-strip"></div><div class="reason-txt" style="display:none"></div><div class="card-badges"></div></div><div class="card-right"><div class="drag-handle" title="Drag to reorder">&#10303;</div><div class="card-action"><button class="analyze-btn" onclick="analyzeTicker('` + ticker + `')">ANALYZE</button></div></div></div><div class="log-section" style="display:none"></div><div class="gate-section" style="display:none"></div></div></div>`;
  }).join("");
  var resolveThisRender;
  cardsReadyPromise = new Promise(function(res) {
    resolveThisRender = res;
  });
  hydrateCards(list).then(function() {
    resolveThisRender();
    if (postRenderHook) postRenderHook();
  });
}
async function hydrateCards(list) {
  await Promise.all(list.map(function(t) {
    return fetchTickerData(t).then(function(d) {
      if (d) updateCardMeta(t, d);
      var card = document.getElementById("card-" + t);
      if (card) card.classList.remove("loading");
    });
  }));
}
var ACTIVE = null;
var MOVE_THRESHOLD = 14;
function bindGestures() {
  if (gesturesBound) return;
  var wl = document.getElementById("watchlist");
  if (!wl) return;
  gesturesBound = true;
  wl.addEventListener("pointerdown", onPointerDown);
}
function onPointerDown(e) {
  if (ACTIVE) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  var wrap = e.target.closest(".card-wrap");
  if (!wrap) return;
  var card = wrap.querySelector(".card");
  if (!card) return;
  ACTIVE = {
    pointerId: e.pointerId,
    wrap,
    card,
    ticker: wrap.dataset.ticker,
    startX: e.clientX,
    startY: e.clientY,
    mode: null,
    pendingDx: 0,
    swipeBg: wrap.querySelector(".swipe-bg")
  };
  if (e.target.closest(".drag-handle")) beginReorder(e);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
}
function beginReorder(e) {
  var g = ACTIVE;
  g.mode = "reorder";
  try {
    g.wrap.setPointerCapture(e.pointerId);
  } catch (err) {
  }
  g.card.style.transition = "none";
  g.wrap.classList.add("dragging");
  g.card.classList.add("dragging");
}
function deleteThreshold(wrap) {
  return Math.min(120, wrap.getBoundingClientRect().width * 0.35);
}
function onPointerMove(e) {
  var g = ACTIVE;
  if (!g || e.pointerId !== g.pointerId) return;
  var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (g.mode === null) {
    if (Math.abs(dx) > MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.mode = "swipe";
      try {
        g.wrap.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      g.card.style.transition = "none";
      g.wrap.classList.add("swiping");
    } else if (Math.abs(dy) > MOVE_THRESHOLD) {
      endGesture();
      return;
    } else return;
  }
  if (g.mode === "swipe") {
    e.preventDefault();
    var clamped = Math.min(0, Math.max(dx, -g.wrap.getBoundingClientRect().width));
    g.card.style.transform = "translateX(" + clamped + "px)";
    var progress = Math.min(Math.abs(clamped) / deleteThreshold(g.wrap), 1);
    g.swipeBg.style.opacity = String(progress);
    g.pendingDx = clamped;
  } else if (g.mode === "reorder") {
    e.preventDefault();
    while (trySwap(g, e)) {
    }
    g.card.style.transform = "translateY(" + (e.clientY - g.startY) + "px)";
  }
}
function trySwap(g, e) {
  var wl = document.getElementById("watchlist");
  var wrapRect = g.wrap.getBoundingClientRect();
  var dy = e.clientY - g.startY;
  var draggedCenter = wrapRect.top + wrapRect.height / 2 + dy;
  var next = g.wrap.nextElementSibling;
  if (next) {
    var nr = next.getBoundingClientRect();
    if (draggedCenter > nr.top + nr.height / 2) {
      wl.insertBefore(next, g.wrap);
      swapTickers(g.ticker, next.dataset.ticker);
      g.startY += nr.height;
      return true;
    }
  }
  var prev = g.wrap.previousElementSibling;
  if (prev) {
    var pr = prev.getBoundingClientRect();
    if (draggedCenter < pr.top + pr.height / 2) {
      wl.insertBefore(g.wrap, prev);
      swapTickers(g.ticker, prev.dataset.ticker);
      g.startY -= pr.height;
      return true;
    }
  }
  return false;
}
function swapTickers(a, b) {
  var ia = watchlist.indexOf(a), ib = watchlist.indexOf(b);
  if (ia === -1 || ib === -1) return;
  var tmp = watchlist[ia];
  watchlist[ia] = watchlist[ib];
  watchlist[ib] = tmp;
  saveWL();
}
function onPointerUp(e) {
  var g = ACTIVE;
  if (!g || e.pointerId !== g.pointerId) return;
  if (g.mode === "swipe") finishSwipe(g);
  else if (g.mode === "reorder") finishReorder(g);
  endGesture();
}
function finishSwipe(g) {
  var threshold = deleteThreshold(g.wrap);
  if (Math.abs(g.pendingDx) >= threshold) {
    var wrap = g.wrap, ticker = g.ticker, w = wrap.getBoundingClientRect().width;
    g.card.style.transition = "transform .18s ease-in";
    g.card.style.transform = "translateX(-" + (w + 40) + "px)";
    wrap.style.overflow = "hidden";
    wrap.style.transition = "max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s";
    requestAnimationFrame(function() {
      wrap.style.maxHeight = "0px";
      wrap.style.opacity = "0";
      wrap.style.marginTop = "0px";
      wrap.style.marginBottom = "0px";
    });
    setTimeout(function() {
      removeTicker(ticker);
    }, 220);
  } else {
    g.card.style.transition = "transform .18s ease";
    g.card.style.transform = "translateX(0)";
    g.swipeBg.style.opacity = "0";
  }
  g.wrap.classList.remove("swiping");
}
function finishReorder(g) {
  g.card.style.transition = "transform .15s ease";
  g.card.style.transform = "translateY(0)";
  g.wrap.classList.remove("dragging");
  g.card.classList.remove("dragging");
  setTimeout(function() {
    g.card.style.transition = "";
  }, 160);
}
function endGesture() {
  var g = ACTIVE;
  if (g) {
    try {
      g.wrap.releasePointerCapture(g.pointerId);
    } catch (err) {
    }
  }
  ACTIVE = null;
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", onPointerUp);
}
window.addTickers = addTickers;

// shared/analysis-cache.ts
var verdictCache = {};
function lsCK(t) {
  return "tv_v_" + t + "_" + (/* @__PURE__ */ new Date()).toDateString().replace(/ /g, "_");
}
function saveLSVerdict(t, d) {
  try {
    localStorage.setItem(lsCK(t), JSON.stringify(d));
  } catch (e) {
  }
}
function loadLSVerdict(t) {
  try {
    var r = localStorage.getItem(lsCK(t));
    return r ? JSON.parse(r) : null;
  } catch (e) {
    return null;
  }
}
function cleanLS() {
  var today = (/* @__PURE__ */ new Date()).toDateString().replace(/ /g, "_");
  Object.keys(localStorage).forEach(function(k) {
    if (k.startsWith("tv_v_") && !k.includes(today)) localStorage.removeItem(k);
  });
}
function cacheVerdict(t, d) {
  verdictCache[t] = { data: d, date: (/* @__PURE__ */ new Date()).toDateString() };
  saveLSVerdict(t, d);
}
function getCachedVerdict(t) {
  var e = verdictCache[t];
  if (e && e.date === (/* @__PURE__ */ new Date()).toDateString()) return e.data;
  var ls = loadLSVerdict(t);
  if (ls) {
    verdictCache[t] = { data: ls, date: (/* @__PURE__ */ new Date()).toDateString() };
    return ls;
  }
  return null;
}

// shared/track-record.ts
var LOG_KEY = "tv_accuracy_log";
function getLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
var saveHook2 = null;
function saveLog(log) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
  if (saveHook2) saveHook2();
}
function logResult(ticker, verdict, correct, rowEl, meta) {
  var log = getLog();
  var entry = {
    ticker,
    verdict,
    correct,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    session: (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })
  };
  if (meta && meta.trigger) entry.trigger = meta.trigger;
  log.push(entry);
  if (log.length > 200) log = log.slice(-200);
  saveLog(log);
  var color = correct ? "var(--green)" : "var(--red)";
  var label = correct ? "\u2713 LOGGED RIGHT" : "\u2717 LOGGED WRONG";
  rowEl.innerHTML = '<span class="log-recorded" style="color:' + color + ";background:" + color + "11;border:1px solid " + color + '44">' + label + "</span>";
  renderTrackRecord();
}
function clearLog() {
  if (!confirm("Clear all logged trades?")) return;
  saveLog([]);
  renderTrackRecord();
}
function replaceLog(entries) {
  saveLog(entries);
  renderTrackRecord();
}
function getAccuracyLog() {
  return getLog();
}
function renderTrackRecord() {
  var log = getLog();
  var body = document.getElementById("track-body");
  if (!body) return;
  var streakEl = document.getElementById("trackStreakInline");
  if (!log.length) {
    body.innerHTML = '<div class="track-empty">No trades logged yet.<br>After each verdict tap \u2713 RIGHT or \u2717 WRONG.</div>';
    if (streakEl) streakEl.innerHTML = "";
    return;
  }
  var streak = 0, streakType = null;
  for (var i = log.length - 1; i >= 0; i--) {
    if (streakType === null) streakType = log[i].correct;
    if (log[i].correct === streakType) streak++;
    else break;
  }
  var streakColor = streakType ? "var(--green)" : "var(--red)";
  var streakLabel = streak > 1 ? "\u{1F525}" + streak : "&mdash;";
  var pips = log.slice(-5).map(function(e) {
    return '<span class="track-streak-pip" style="background:' + (e.correct ? "var(--green)" : "var(--red)") + '"></span>';
  }).join("");
  if (streakEl) streakEl.innerHTML = '<span style="color:' + streakColor + '">' + streakLabel + '</span><span class="track-streak-pips">' + pips + "</span>";
  var vDim = function(v) {
    return v === "UP" ? "var(--green-dim)" : v === "DOWN" ? "var(--red-dim)" : "var(--amber-dim)";
  };
  var vColor = function(v) {
    return v === "UP" ? "var(--green)" : v === "DOWN" ? "var(--red)" : "var(--amber)";
  };
  var tradeRow = function(e) {
    var rColor = e.correct ? "var(--green)" : "var(--red)";
    var d = new Date(e.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    return '<div class="track-log-item"><span class="tli-ticker"><a class="ticker-a" href="' + tickerHref(e.ticker) + '" target="_blank">' + e.ticker + '</a></span><span class="tli-pill" style="background:' + vDim(e.verdict) + ";color:" + vColor(e.verdict) + '">' + e.verdict + '</span><span class="tli-check" style="color:' + rColor + '">' + (e.correct ? "\u2713" : "\u2717") + '</span><span class="tli-date">' + d + "</span></div>";
  };
  var reversed = [].concat(log).reverse();
  var visibleRows = reversed.slice(0, 3).map(tradeRow).join("");
  var extra = reversed.slice(3, 8);
  var extraHTML = extra.length ? '<button type="button" class="view-full-log-link" id="trackLogMoreBtn">View full log (' + log.length + ') &rarr;</button><div id="trackLogMoreBody" style="display:none">' + extra.map(tradeRow).join("") + "</div>" : "";
  body.innerHTML = visibleRows + extraHTML;
  var moreBtn = document.getElementById("trackLogMoreBtn");
  if (moreBtn) moreBtn.addEventListener("click", function() {
    var b = document.getElementById("trackLogMoreBody");
    if (!b) return;
    var open = b.style.display === "none";
    b.style.display = open ? "block" : "none";
    moreBtn.innerHTML = open ? "Hide full log &larr;" : "View full log (" + log.length + ") &rarr;";
  });
}
window.logResult = logResult;
window.clearLog = clearLog;

// shared/track-record-sync.ts
var cfg = null;
var pulling = false;
function initTrackRecordSync(config) {
  cfg = config;
}
var PULL_RETRY_DELAYS_MS = [0, 1500, 4e3];
async function pullTrackRecordFromServer() {
  if (!cfg) return;
  var data = null;
  for (var i = 0; i < PULL_RETRY_DELAYS_MS.length && !data; i++) {
    if (PULL_RETRY_DELAYS_MS[i]) await new Promise(function(r) {
      setTimeout(r, PULL_RETRY_DELAYS_MS[i]);
    });
    try {
      var res = await fetch(cfg.addSecret(cfg.API_URL + "/track"), { headers: cfg.authH(), cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch (e) {
    }
  }
  if (data) {
    if (data.entries && data.entries.length) {
      pulling = true;
      replaceLog(data.entries);
      pulling = false;
    } else if (getAccuracyLog().length) {
      pushTrackRecordToServer(true);
    }
  }
}
var pushTimer = null;
function schedulePushTrackRecord() {
  if (!cfg || pulling) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(function() {
    pushTrackRecordToServer(false);
  }, 1200);
}
async function pushTrackRecordToServer(seed) {
  if (!cfg) return;
  try {
    await fetch(cfg.addSecret(cfg.API_URL + "/track"), { method: "POST", headers: cfg.authH(), body: JSON.stringify({ entries: getAccuracyLog(), seed: !!seed }) });
  } catch (e) {
  }
}

// shared/watchlist-sync.ts
var cfg2 = null;
var pulling2 = false;
function initWatchlistSync(config) {
  cfg2 = config;
}
var PULL_RETRY_DELAYS_MS2 = [0, 1500, 4e3];
async function pullWatchlistFromServer() {
  if (!cfg2) return;
  var data = null;
  for (var i = 0; i < PULL_RETRY_DELAYS_MS2.length && !data; i++) {
    if (PULL_RETRY_DELAYS_MS2[i]) await new Promise(function(r) {
      setTimeout(r, PULL_RETRY_DELAYS_MS2[i]);
    });
    try {
      var res = await fetch(cfg2.addSecret(cfg2.API_URL + "/watchlist"), { headers: cfg2.authH(), cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch (e) {
    }
  }
  if (data) {
    if (data.tickers && data.tickers.length) {
      pulling2 = true;
      setWatchlist(data.tickers);
      pulling2 = false;
    } else if (watchlist.length) {
      pushWatchlistToServer(true);
    }
  }
}
var pushTimer2 = null;
function schedulePushWatchlist() {
  if (!cfg2 || pulling2) return;
  if (pushTimer2) clearTimeout(pushTimer2);
  pushTimer2 = setTimeout(function() {
    pushWatchlistToServer(false);
  }, 1200);
}
async function pushWatchlistToServer(seed) {
  if (!cfg2) return;
  try {
    await fetch(cfg2.addSecret(cfg2.API_URL + "/watchlist"), { method: "POST", headers: cfg2.authH(), body: JSON.stringify({ tickers: watchlist, seed: !!seed }) });
  } catch (e) {
  }
}

// shared/settings-modal.ts
function ensureModal() {
  var el = document.getElementById("settings-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "settings-modal";
  el.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";
  el.innerHTML = '<div style="background:#101c2e;border:1px solid var(--border);border-radius:10px;padding:20px;max-width:340px;width:100%;font-family:monospace;color:var(--white)" onclick="event.stopPropagation()"><div style="font-size:13px;font-weight:700;letter-spacing:.06em;margin-bottom:16px">SETTINGS</div><div style="font-size:10px;color:var(--dim);margin-bottom:6px">TIME ZONE</div><select id="settings-tz" style="width:100%;margin-bottom:16px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:12px;padding:8px;border-radius:6px"></select><div style="font-size:10px;color:var(--dim);margin-bottom:6px">TICKER &amp; NEWS LINKS OPEN IN</div><select id="settings-link-site" style="width:100%;margin-bottom:8px;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:12px;padding:8px;border-radius:6px"></select><div id="settings-custom-wrap" style="display:none;margin-bottom:18px"><div style="font-size:9px;color:var(--dim);margin-bottom:5px">MARKET DATA (TICKER) URL</div><input type="text" id="settings-custom-market-url" placeholder="Paste your favorite stock quote URL" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box"><div id="settings-custom-market-status" style="font-size:10px;margin-top:8px;margin-bottom:16px"></div><div style="font-size:9px;color:var(--dim);margin-bottom:5px">NEWS URL</div><input type="text" id="settings-custom-ex-url" placeholder="Paste your favorite market news URL" style="width:100%;background:#0a1420;border:1px solid var(--border);color:var(--white);font-family:monospace;font-size:11px;padding:8px;border-radius:6px;box-sizing:border-box"><div id="settings-custom-status" style="font-size:10px;margin-top:8px"></div><div style="font-size:10px;color:var(--amber);margin-top:8px">Blank or invalid = Yahoo Finance is used instead, per field.</div></div><button type="button" id="settings-close-btn" style="width:100%;background:var(--blue);border:none;color:#03101f;font-family:monospace;font-size:12px;font-weight:700;padding:10px;border-radius:6px;cursor:pointer;letter-spacing:.04em">DONE</button></div>';
  document.body.appendChild(el);
  el.addEventListener("click", closeSettingsModal);
  document.getElementById("settings-close-btn").addEventListener("click", closeSettingsModal);
  var tzSel = document.getElementById("settings-tz");
  Object.keys(TIMEZONES).forEach(function(k) {
    var o = document.createElement("option");
    o.value = k;
    o.textContent = TIMEZONES[k].label;
    tzSel.appendChild(o);
  });
  tzSel.addEventListener("change", function() {
    setTzPref(tzSel.value);
  });
  var linkSel = document.getElementById("settings-link-site");
  Object.keys(LINK_SITES).forEach(function(k) {
    var o = document.createElement("option");
    o.value = k;
    o.textContent = LINK_SITES[k].label;
    linkSel.appendChild(o);
  });
  var customWrap = document.getElementById("settings-custom-wrap");
  var exUrl = document.getElementById("settings-custom-ex-url");
  var customStatus = document.getElementById("settings-custom-status");
  var marketUrl = document.getElementById("settings-custom-market-url");
  var marketStatus = document.getElementById("settings-custom-market-status");
  function refreshCustomVisibility() {
    customWrap.style.display = linkSel.value === "custom" ? "block" : "none";
  }
  linkSel.addEventListener("change", function() {
    setLinkSitePref(linkSel.value);
    refreshCustomVisibility();
  });
  function showCurrentTemplate() {
    var saved = getCustomTemplate();
    customStatus.textContent = saved ? "Currently: " + saved : "No link saved yet \u2014 using Yahoo Finance.";
    customStatus.style.color = "var(--dim)";
  }
  function showCurrentMarketTemplate() {
    var saved = getCustomMarketTemplate();
    marketStatus.textContent = saved ? "Currently: " + saved : "No link saved yet \u2014 using Yahoo Finance.";
    marketStatus.style.color = "var(--dim)";
  }
  exUrl.addEventListener("input", function() {
    var raw = exUrl.value.trim();
    if (!raw) {
      showCurrentTemplate();
      return;
    }
    var withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    var detected = detectTickerInUrl(withScheme);
    var template = detected ? buildTemplateFromExample(withScheme, detected) : null;
    if (template) {
      setCustomTemplate(template);
      customStatus.textContent = "Saved \u2014 news links now use this.";
      customStatus.style.color = "var(--green)";
    } else {
      customStatus.textContent = "Couldn't find a ticker in that URL \u2014 try pasting a single stock's page instead.";
      customStatus.style.color = "var(--red)";
    }
  });
  marketUrl.addEventListener("input", function() {
    var raw = marketUrl.value.trim();
    if (!raw) {
      showCurrentMarketTemplate();
      return;
    }
    var withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    var detected = detectTickerInUrl(withScheme);
    var template = detected ? buildTemplateFromExample(withScheme, detected) : null;
    if (template) {
      setCustomMarketTemplate(template);
      marketStatus.textContent = "Saved \u2014 ticker links now use this.";
      marketStatus.style.color = "var(--green)";
    } else {
      marketStatus.textContent = "Couldn't find a ticker in that URL \u2014 try pasting a single stock's page instead.";
      marketStatus.style.color = "var(--red)";
    }
  });
  return el;
}
function openSettingsModal() {
  var el = ensureModal();
  document.getElementById("settings-tz").value = getTzPref();
  document.getElementById("settings-link-site").value = getLinkSitePref();
  document.getElementById("settings-custom-ex-url").value = "";
  var saved = getCustomTemplate();
  var statusEl = document.getElementById("settings-custom-status");
  statusEl.textContent = saved ? "Currently: " + saved : "No link saved yet \u2014 using Yahoo Finance.";
  statusEl.style.color = "var(--dim)";
  document.getElementById("settings-custom-market-url").value = "";
  var savedMarket = getCustomMarketTemplate();
  var marketStatusEl = document.getElementById("settings-custom-market-status");
  marketStatusEl.textContent = savedMarket ? "Currently: " + savedMarket : "No link saved yet \u2014 using Yahoo Finance.";
  marketStatusEl.style.color = "var(--dim)";
  document.getElementById("settings-custom-wrap").style.display = getLinkSitePref() === "custom" ? "block" : "none";
  el.style.display = "flex";
}
function closeSettingsModal() {
  var el = document.getElementById("settings-modal");
  if (el) el.style.display = "none";
}
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;

// shared/rolodex.ts
var GATE_MARQUEE_SPEED = 0.4;
var ROLO_MARQUEE_SPEED = 0.5;
var ROLO_MARQUEE_RESUME_MS = 2e3;
var ROLO_SWIPE_MOVE_THRESHOLD = 14;
var els;
var cb;
var GATE_DOCKED_H = 44;
var spacerHeight = 0;
var dockThreshold = 0;
var gateDockedLast = false;
function currentGateFullHeight() {
  return Math.max(0, els.gateFullOverlay.getBoundingClientRect().height / currentAppScale() - GATE_DOCKED_H);
}
function sizeGateSpacer() {
  spacerHeight = currentGateFullHeight();
  els.gateSpacer.style.height = (els.gateCard.classList.contains("docked") ? 0 : spacerHeight) + "px";
  updateGateDockState();
  scheduleFirstCardSnapCheck();
  sizeRoloIndexOffset();
}
function listHeadHeight() {
  return els.listHead.getBoundingClientRect().height / currentAppScale();
}
function sizeRoloIndexOffset() {
  els.roloIndex.style.top = GATE_DOCKED_H + listHeadHeight() + "px";
}
function updateGateDockState() {
  const docked = els.scroller.scrollTop >= dockThreshold;
  els.gateCard.classList.toggle("docked", docked);
  els.gateCard.setAttribute("aria-expanded", String(!docked));
  if (docked !== gateDockedLast) {
    els.gateSpacer.style.height = (docked ? 0 : spacerHeight) + "px";
    gateDockedLast = docked;
    if (cb.onGateDockChange) cb.onGateDockChange(docked);
  }
}
function jumpToTop() {
  els.scroller.scrollTo({ top: 0, behavior: "smooth" });
}
var FIRST_CARD_SNAP_MAX_DELTA = 80;
var FIRST_CARD_SNAP_SETTLE_MS = 120;
var firstCardSnapTimer = null;
function settleGateSpacerHeightSync() {
  const target = els.gateCard.classList.contains("docked") ? 0 : spacerHeight;
  const prevTransition = els.gateSpacer.style.transition;
  els.gateSpacer.style.transition = "none";
  els.gateSpacer.style.height = target + "px";
  void els.gateSpacer.offsetHeight;
  els.gateSpacer.style.transition = prevTransition;
}
function snapFirstCardUnderGateDock() {
  if (isLandscapeMode()) return;
  if (!els.gateCard.classList.contains("docked")) return;
  settleGateSpacerHeightSync();
  const card = document.querySelector(".content")?.firstElementChild;
  if (!card) return;
  const scrollerTop = els.scroller.getBoundingClientRect().top;
  const cardTop = card.getBoundingClientRect().top - scrollerTop;
  const delta = cardTop - GATE_DOCKED_H;
  if (Math.abs(delta) > 0.5 && Math.abs(delta) <= FIRST_CARD_SNAP_MAX_DELTA) {
    els.scroller.scrollBy({ top: delta, behavior: "smooth" });
  }
}
function scheduleFirstCardSnapCheck() {
  if (firstCardSnapTimer) clearTimeout(firstCardSnapTimer);
  firstCardSnapTimer = setTimeout(snapFirstCardUnderGateDock, FIRST_CARD_SNAP_SETTLE_MS);
}
var gateMarqueeOneSetW = 0;
var gateMarqueePos = 0;
function buildGateMarquee(itemsHTML) {
  els.gateMarquee.innerHTML = itemsHTML + itemsHTML;
  gateMarqueePos = 0;
  requestAnimationFrame(sizeGateMarquee);
}
function sizeGateMarquee() {
  const items = els.gateMarquee.querySelectorAll(".gm-item");
  if (items.length < 2) {
    gateMarqueeOneSetW = els.gateMarquee.scrollWidth / 2;
    return;
  }
  const firstPassStart = items[0].getBoundingClientRect().left;
  const secondPassStart = items[items.length / 2].getBoundingClientRect().left;
  gateMarqueeOneSetW = secondPassStart - firstPassStart;
}
function stepGateMarquee() {
  if (els.gateCard.classList.contains("docked") && gateMarqueeOneSetW > 0) {
    gateMarqueePos += GATE_MARQUEE_SPEED;
    if (gateMarqueePos >= gateMarqueeOneSetW) {
      gateMarqueePos -= gateMarqueeOneSetW;
    }
    els.gateMarquee.scrollLeft = Math.round(gateMarqueePos);
  }
  requestAnimationFrame(stepGateMarquee);
}
var roloCurrent = 0;
function getRoloCurrent() {
  return roloCurrent;
}
var ROLO_CARD_MIN_HEIGHT = 160;
var ROLO_CARD_BOTTOM_MARGIN = 16;
function capRoloCardHeight(activeCard) {
  const roloIndexH = els.roloIndex.getBoundingClientRect().height / currentAppScale();
  const available = els.scroller.clientHeight - GATE_DOCKED_H - listHeadHeight() - roloIndexH - ROLO_CARD_BOTTOM_MARGIN;
  const cap = Math.max(ROLO_CARD_MIN_HEIGHT, available);
  if (activeCard.scrollHeight > cap) {
    activeCard.style.maxHeight = cap + "px";
    activeCard.style.overflowY = "auto";
  } else {
    activeCard.style.maxHeight = "";
    activeCard.style.overflowY = "";
  }
}
function syncRoloStageHeight() {
  const cards = Array.from(els.roloStage.querySelectorAll(".rolo-card"));
  const activeCard = cards[roloCurrent];
  if (!activeCard) return;
  capRoloCardHeight(activeCard);
  els.roloStage.style.height = activeCard.offsetHeight + "px";
}
function positionRoloStack() {
  const cards = Array.from(els.roloStage.querySelectorAll(".rolo-card"));
  cards.forEach((card, i) => {
    const d = i - roloCurrent, abs = Math.abs(d);
    card.style.pointerEvents = abs === 0 ? "auto" : "none";
    if (abs === 0) {
      card.style.transform = "translateY(0) scale(1)";
      card.style.opacity = "1";
      card.style.zIndex = "10";
      card.style.filter = "none";
    } else if (abs <= 2) {
      card.style.transform = `translateY(${d < 0 ? -14 * abs : 14 * abs}px) scale(${1 - 0.05 * abs})`;
      card.style.opacity = String(0.55 - 0.2 * (abs - 1));
      card.style.zIndex = String(10 - abs);
      card.style.filter = "brightness(.7)";
    } else {
      card.style.transform = `translateY(${d < 0 ? -60 : 60}px) scale(0.85)`;
      card.style.opacity = "0";
      card.style.zIndex = "1";
    }
  });
  const chips = Array.from(els.roloIndex.querySelectorAll(".rolo-chip"));
  chips.forEach((chip) => chip.classList.toggle("active", +(chip.dataset.idx || -1) === roloCurrent));
  syncRoloStageHeight();
}
function forceGateDockedSync() {
  if (!els.gateCard.classList.contains("docked")) {
    els.gateCard.classList.add("docked");
    els.gateCard.setAttribute("aria-expanded", "false");
    const prevTransition = els.gateSpacer.style.transition;
    els.gateSpacer.style.transition = "none";
    els.gateSpacer.style.height = "0px";
    void els.gateSpacer.offsetHeight;
    els.gateSpacer.style.transition = prevTransition;
    gateDockedLast = true;
    if (cb.onGateDockChange) cb.onGateDockChange(true);
  }
  return els.roloIndex.getBoundingClientRect().height / currentAppScale();
}
function scrollToUnderDock(el, dockOffset) {
  const elRect = el.getBoundingClientRect();
  const scrollerRect = els.scroller.getBoundingClientRect();
  const scale = currentAppScale();
  const virtualDocTop = (elRect.top - scrollerRect.top) / scale + els.scroller.scrollTop;
  els.scroller.scrollTo({ top: virtualDocTop - dockOffset, behavior: "smooth" });
}
function scrollToActiveCard() {
  const wrap = els.roloStage.closest(".rolo-wrap");
  if (!wrap) return;
  const roloIndexH = forceGateDockedSync();
  scrollToUnderDock(wrap, GATE_DOCKED_H + listHeadHeight() + roloIndexH);
}
var CARD_BODY_MIN_HEIGHT = 120;
var CARD_BODY_BOTTOM_MARGIN = 16;
function capCardBodyHeight(cardEl, dockOffset) {
  const pad = cardEl.querySelector(".card-body-pad");
  const head = cardEl.querySelector(".card-head");
  if (!pad || !head) return;
  const available = els.scroller.clientHeight - dockOffset - head.getBoundingClientRect().height / currentAppScale() - CARD_BODY_BOTTOM_MARGIN;
  pad.style.maxHeight = Math.max(CARD_BODY_MIN_HEIGHT, available) + "px";
}
function dockOffsetFor(cardEl, roloIndexH) {
  const afterPillStrip = !!(els.roloIndex.compareDocumentPosition(cardEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  return GATE_DOCKED_H + (afterPillStrip ? listHeadHeight() + roloIndexH : 0);
}
function snapCardUnderDock(cardEl) {
  const roloIndexH = forceGateDockedSync();
  const dockOffset = dockOffsetFor(cardEl, roloIndexH);
  capCardBodyHeight(cardEl, dockOffset);
  cardEl.style.scrollMarginTop = dockOffset + "px";
  const body = cardEl.querySelector(".card-body");
  if (!body) {
    cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const prevTransition = body.style.transition;
  body.style.transition = "none";
  body.style.gridTemplateRows = "1fr";
  void body.offsetHeight;
  cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  body.style.gridTemplateRows = "0fr";
  void body.offsetHeight;
  body.style.transition = prevTransition;
  body.style.gridTemplateRows = "";
}
function recapExpandedCards() {
  if (isLandscapeMode()) return;
  const roloIndexH = els.roloIndex.getBoundingClientRect().height / currentAppScale();
  document.querySelectorAll(".card.expanded[data-card]").forEach((cardEl) => {
    capCardBodyHeight(cardEl, dockOffsetFor(cardEl, roloIndexH));
  });
}
var APP_SCALE_REFERENCE_WIDTH = 960;
function currentAppScale() {
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  const w = window.innerWidth;
  return isLandscape && w > APP_SCALE_REFERENCE_WIDTH ? w / APP_SCALE_REFERENCE_WIDTH : 1;
}
function updateResponsiveScale() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!isLandscape || w <= APP_SCALE_REFERENCE_WIDTH) {
    shell.style.transform = "";
    shell.style.width = "";
    shell.style.height = "";
    return;
  }
  const scale = w / APP_SCALE_REFERENCE_WIDTH;
  shell.style.width = APP_SCALE_REFERENCE_WIDTH + "px";
  shell.style.height = h / scale + "px";
  shell.style.transform = `scale(${scale})`;
  shell.style.transformOrigin = "top center";
}
var LANDSCAPE_HUD_MIN_HEIGHT = 160;
var LANDSCAPE_HUD_BOTTOM_MARGIN = 4;
var lsEls = null;
var lsOnSelect = null;
var lsIsActive = false;
var lsActiveCard = null;
var lsAnchors = /* @__PURE__ */ new Map();
function isLandscapeMode() {
  return lsIsActive;
}
function sizeLandscapeHud() {
  if (!lsEls) return;
  const roloIndexH = els.roloIndex.getBoundingClientRect().height / currentAppScale();
  const dockOffset = dockOffsetFor(lsEls.hud, roloIndexH);
  const available = els.scroller.clientHeight - dockOffset - LANDSCAPE_HUD_BOTTOM_MARGIN;
  lsEls.hud.style.height = Math.max(LANDSCAPE_HUD_MIN_HEIGHT, available) + "px";
}
function snapLandscapeHudUnderDock(hudEl) {
  if (!lsEls) return;
  const roloIndexH = forceGateDockedSync();
  const dockOffset = dockOffsetFor(hudEl, roloIndexH);
  sizeLandscapeHud();
  scrollToUnderDock(hudEl, dockOffset);
}
function buildLandscapeRibbon(cards) {
  if (!lsEls) return;
  lsEls.ribbon.innerHTML = cards.map((card) => {
    const icon = card.querySelector(".card-icon")?.textContent || "";
    const label = card.querySelector(".card-label")?.textContent || "";
    return `<button type="button" class="ribbon-item" data-card="${card.dataset.card}" aria-label="${label}"><span class="ribbon-icon">${icon}</span><span class="ribbon-label">${label}</span></button>`;
  }).join("");
  Array.from(lsEls.ribbon.children).forEach((btn, i) => {
    btn.addEventListener("click", () => selectLandscapeCard(cards[i]));
  });
}
function selectLandscapeCard(card) {
  if (!lsEls) return;
  lsActiveCard = card;
  lsEls.empty.style.display = "none";
  Array.from(lsEls.pane.querySelectorAll(".card[data-card]")).forEach((c) => {
    c.classList.toggle("landscape-active", c === card);
  });
  lsEls.pane.scrollTop = 0;
  Array.from(lsEls.ribbon.children).forEach((btn) => {
    const el = btn;
    const active = el.dataset.card === card.dataset.card;
    el.classList.toggle("active", active);
    if (active) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  if (lsOnSelect) lsOnSelect(card);
  snapLandscapeHudUnderDock(lsEls.hud);
}
function activateLandscape() {
  if (!lsEls) return;
  const cards = Array.from(document.querySelectorAll(".card[data-card]"));
  cards.forEach((card) => {
    if (!lsAnchors.has(card)) lsAnchors.set(card, { parent: card.parentNode, next: card.nextSibling });
    const pad = card.querySelector(".card-body-pad");
    if (pad) pad.style.maxHeight = "";
    lsEls.pane.appendChild(card);
  });
  if (!lsEls.ribbon.childElementCount) buildLandscapeRibbon(cards);
  lsIsActive = true;
  if (!lsActiveCard) {
    const alreadyExpanded = cards.find((c) => c.classList.contains("expanded"));
    if (alreadyExpanded) lsActiveCard = alreadyExpanded;
  }
  if (lsActiveCard) selectLandscapeCard(lsActiveCard);
  else {
    lsEls.empty.style.display = "";
    sizeLandscapeHud();
  }
}
function deactivateLandscape() {
  if (!lsEls) return;
  Array.from(document.querySelectorAll(".card[data-card]")).forEach((card) => {
    const anchor = lsAnchors.get(card);
    if (anchor) anchor.parent.insertBefore(card, anchor.next);
    card.classList.remove("landscape-active");
  });
  lsEls.hud.style.maxHeight = "";
  lsIsActive = false;
}
function initLandscapeMode(landscapeElements, onSelect) {
  lsEls = landscapeElements;
  lsOnSelect = onSelect;
  const mq = window.matchMedia("(orientation: landscape)");
  const apply = () => {
    updateResponsiveScale();
    if (mq.matches) activateLandscape();
    else deactivateLandscape();
  };
  mq.addEventListener("change", apply);
  apply();
}
function goRolo(i) {
  const count = els.roloStage.querySelectorAll(".rolo-card").length;
  if (!count) return;
  roloCurrent = Math.max(0, Math.min(count - 1, i));
  positionRoloStack();
  scrollToActiveCard();
  const watchlist2 = cb.getWatchlist();
  const sym = watchlist2[roloCurrent];
  if (sym) cb.onActivate(sym, roloCurrent);
}
function clampRoloCurrent() {
  const watchlist2 = cb.getWatchlist();
  roloCurrent = Math.min(roloCurrent, Math.max(0, watchlist2.length - 1));
}
var roloSwipe = null;
function roloSwipeThreshold(card) {
  return Math.min(120, card.getBoundingClientRect().width * 0.35);
}
function ensureRoloSwipeBg() {
  let bg = els.roloStage.querySelector(".rolo-swipe-bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.className = "rolo-swipe-bg";
    els.roloStage.insertBefore(bg, els.roloStage.firstChild);
  }
  return bg;
}
function updateRoloSwipeBg(bg, dx, progress) {
  const dir = dx < 0 ? "left" : "right";
  if (bg.dataset.dir !== dir) {
    bg.dataset.dir = dir;
    bg.classList.toggle("rolo-swipe-bg-next", dir === "right");
    bg.innerHTML = dir === "left" ? '<span class="swipe-icon">\u{1F5D1}</span><span class="swipe-label">DELETE</span>' : '<span class="swipe-label">NEXT</span><span class="swipe-icon">\u2192</span>';
  }
  bg.style.opacity = String(progress);
}
function activeRoloCardEl() {
  const cards = Array.from(els.roloStage.querySelectorAll(".rolo-card"));
  return cards[roloCurrent] || null;
}
function onRoloPointerDown(e) {
  if (roloSwipe) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const target = e.target;
  const card = target.closest(".rolo-card");
  if (!card) return;
  const cards = Array.from(els.roloStage.querySelectorAll(".rolo-card"));
  if (cards.indexOf(card) !== roloCurrent) return;
  roloSwipe = { pointerId: e.pointerId, card, startX: e.clientX, startY: e.clientY, mode: null, pendingDx: 0 };
}
function onRoloPointerMove(e) {
  const g = roloSwipe;
  if (!g || e.pointerId !== g.pointerId) return;
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (g.mode === null) {
    if (Math.abs(dx) > ROLO_SWIPE_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.mode = "swipe";
      try {
        g.card.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      g.card.style.transition = "none";
    } else if (Math.abs(dy) > ROLO_SWIPE_MOVE_THRESHOLD) {
      endRoloSwipe();
      return;
    } else return;
  }
  if (g.mode === "swipe") {
    e.preventDefault();
    const w = g.card.getBoundingClientRect().width;
    const clamped = Math.max(-w, Math.min(dx, w));
    g.card.style.transform = "translateY(0) scale(1) translateX(" + clamped + "px)";
    const bg = ensureRoloSwipeBg();
    const progress = Math.min(Math.abs(clamped) / roloSwipeThreshold(g.card), 1);
    updateRoloSwipeBg(bg, clamped, progress);
    g.pendingDx = clamped;
  }
}
function onRoloPointerUp(e) {
  const g = roloSwipe;
  if (!g || e.pointerId !== g.pointerId) return;
  if (g.mode === "swipe") finishRoloSwipe(g);
  endRoloSwipe();
}
function finishRoloSwipe(g) {
  const threshold = roloSwipeThreshold(g.card);
  const bg = ensureRoloSwipeBg();
  if (g.pendingDx <= -threshold) {
    const w = g.card.getBoundingClientRect().width;
    g.card.style.transition = "transform .18s ease-in, opacity .18s ease-in";
    g.card.style.transform = "translateX(-" + (w + 40) + "px)";
    g.card.style.opacity = "0";
    const sym = cb.getWatchlist()[roloCurrent];
    setTimeout(() => {
      bg.style.opacity = "0";
      if (sym) cb.onDeleteConfirmed(sym);
    }, 180);
  } else if (g.pendingDx >= threshold) {
    const watchlist2 = cb.getWatchlist();
    bg.style.opacity = "0";
    if (roloCurrent < watchlist2.length - 1) {
      g.card.style.transition = "";
      goRolo(roloCurrent + 1);
    } else {
      g.card.style.transition = "transform .18s ease";
      g.card.style.transform = "translateY(0) scale(1)";
    }
  } else {
    g.card.style.transition = "transform .18s ease";
    g.card.style.transform = "translateY(0) scale(1)";
    bg.style.opacity = "0";
  }
}
var demoBgEl = null;
function simulateSwipeDemo(direction) {
  return new Promise((resolve) => {
    const card = activeRoloCardEl();
    if (!card) {
      resolve();
      return;
    }
    const w = card.getBoundingClientRect().width;
    const dx = direction === "left" ? -w * 0.42 : w * 0.42;
    const bg = ensureRoloSwipeBg();
    updateRoloSwipeBg(bg, dx, 1);
    demoBgEl = bg;
    card.style.transition = "transform .32s cubic-bezier(.2,.7,.2,1)";
    card.style.transform = "translateY(0) scale(1) translateX(" + dx + "px)";
    setTimeout(resolve, 340);
  });
}
function resetSwipeDemoCard() {
  const card = activeRoloCardEl();
  if (card) {
    card.style.transition = "transform .22s ease";
    card.style.transform = "translateY(0) scale(1)";
  }
  if (demoBgEl) {
    demoBgEl.style.opacity = "0";
    demoBgEl = null;
  }
}
function endRoloSwipe() {
  const g = roloSwipe;
  if (g) {
    try {
      g.card.releasePointerCapture(g.pointerId);
    } catch (err) {
    }
  }
  roloSwipe = null;
}
var roloMarqueeOneSetW = 0;
var roloMarqueePos = 0;
var roloMarqueeDataReady = false;
var roloMarqueePaused = false;
var roloMarqueeResumeTimer = null;
var roloItemsPerPass = 1;
function scheduleRoloMarqueeResume() {
  if (roloMarqueeResumeTimer) clearTimeout(roloMarqueeResumeTimer);
  roloMarqueeResumeTimer = setTimeout(() => {
    roloMarqueePos = els.roloIndex.scrollLeft;
    roloMarqueePaused = false;
  }, ROLO_MARQUEE_RESUME_MS);
}
function pauseRoloMarquee() {
  roloMarqueePaused = true;
  scheduleRoloMarqueeResume();
}
function sizeRoloMarquee() {
  const itemsPerPass = roloItemsPerPass;
  if (els.roloIndex.children.length >= itemsPerPass * 2) {
    const firstPassStart = els.roloIndex.children[0].getBoundingClientRect().left;
    const secondPassStart = els.roloIndex.children[itemsPerPass].getBoundingClientRect().left;
    roloMarqueeOneSetW = secondPassStart - firstPassStart;
  } else {
    roloMarqueeOneSetW = els.roloIndex.scrollWidth / 2;
  }
}
function stepRoloMarquee() {
  if (!roloMarqueePaused && roloMarqueeDataReady && roloMarqueeOneSetW > 0) {
    roloMarqueePos += ROLO_MARQUEE_SPEED;
    if (roloMarqueePos >= roloMarqueeOneSetW) {
      roloMarqueePos -= roloMarqueeOneSetW;
    }
    els.roloIndex.scrollLeft = Math.round(roloMarqueePos);
  }
  requestAnimationFrame(stepRoloMarquee);
}
function rebuildRoloIndex(watchlist2, buildChip, dividerText, buildExtraChip) {
  els.roloIndex.innerHTML = "";
  roloMarqueePos = 0;
  roloMarqueeDataReady = false;
  roloItemsPerPass = watchlist2.length + (buildExtraChip ? 1 : 0) + 1;
  function appendChipPass() {
    watchlist2.forEach((sym, i) => {
      const chip = buildChip(sym, i);
      chip.addEventListener("click", () => goRolo(i));
      chip.addEventListener("pointerdown", (e) => e.preventDefault());
      els.roloIndex.appendChild(chip);
    });
    if (buildExtraChip) {
      const extra = buildExtraChip();
      extra.addEventListener("pointerdown", (e) => e.preventDefault());
      els.roloIndex.appendChild(extra);
    }
    const divider = document.createElement("span");
    divider.className = "rolo-divider";
    divider.textContent = dividerText;
    els.roloIndex.appendChild(divider);
    return divider;
  }
  const firstDivider = appendChipPass();
  const oneSetW = firstDivider.offsetLeft + firstDivider.offsetWidth;
  for (let guard = 0; guard < 20 && els.roloIndex.scrollWidth - els.roloIndex.clientWidth < oneSetW; guard++) {
    appendChipPass();
  }
}
function markRoloMarqueeDataReady() {
  roloMarqueeDataReady = true;
}
var HELP_BALLOON_MS_PER_4_LINES = 5e3;
var HELP_SCROLL_GRACE_MS = 200;
var helpEl = null;
var helpTimer = null;
var helpOpenKey = null;
var helpOpenedAt = 0;
var helpContent = {};
function ensureHelpEl() {
  if (helpEl) return helpEl;
  const el = document.createElement("div");
  el.className = "help-balloon";
  el.setAttribute("role", "tooltip");
  document.body.appendChild(el);
  helpEl = el;
  return el;
}
function closeHelpBalloon() {
  if (helpTimer) {
    clearTimeout(helpTimer);
    helpTimer = null;
  }
  if (helpEl) helpEl.classList.remove("open");
  helpOpenKey = null;
}
function positionHelpBalloon(btn, el) {
  const margin = 10;
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(r.left, margin), window.innerWidth - margin - w);
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - h - 8);
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function openHelpBalloon(btn, key) {
  if (helpOpenKey === key && helpEl && helpEl.classList.contains("open")) {
    closeHelpBalloon();
    return;
  }
  const html = helpContent[key];
  if (!html) return;
  const el = ensureHelpEl();
  el.classList.remove("open");
  el.innerHTML = html;
  positionHelpBalloon(btn, el);
  requestAnimationFrame(() => el.classList.add("open"));
  helpOpenKey = key;
  helpOpenedAt = Date.now();
  if (helpTimer) clearTimeout(helpTimer);
  const cs = getComputedStyle(el);
  const lineHeightPx = parseFloat(cs.lineHeight) || 19.5;
  const vPad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const lines = Math.max(1, Math.round((el.scrollHeight - vPad) / lineHeightPx));
  const duration = Math.ceil(lines / 4) * HELP_BALLOON_MS_PER_4_LINES;
  helpTimer = setTimeout(closeHelpBalloon, duration);
}
var tutorialActive = false;
var tutorialAdvanceCb = null;
var tutorialExitCb = null;
function isTutorialActive() {
  return tutorialActive;
}
function openTutorialBalloon(anchor, html, onAdvance, onExit) {
  tutorialActive = true;
  tutorialAdvanceCb = onAdvance;
  tutorialExitCb = onExit;
  if (helpTimer) {
    clearTimeout(helpTimer);
    helpTimer = null;
  }
  const el = ensureHelpEl();
  el.classList.remove("open");
  el.innerHTML = html;
  positionHelpBalloon(anchor, el);
  requestAnimationFrame(() => el.classList.add("open"));
  helpOpenKey = "__tutorial__";
  helpOpenedAt = Date.now();
}
function endTutorial() {
  tutorialActive = false;
  tutorialAdvanceCb = null;
  tutorialExitCb = null;
  closeHelpBalloon();
}
function initHelpBalloons(content, onGlossaryJump) {
  helpContent = content;
  document.addEventListener("click", (e) => {
    if (tutorialActive) {
      e.preventDefault();
      e.stopPropagation();
      const advance = tutorialAdvanceCb;
      tutorialActive = false;
      tutorialAdvanceCb = null;
      tutorialExitCb = null;
      closeHelpBalloon();
      if (advance) advance();
      return;
    }
    const target = e.target;
    const link = target.closest(".help-glossary-link");
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      closeHelpBalloon();
      onGlossaryJump(link.dataset.term || "");
      return;
    }
    const btn = target.closest("[data-help]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openHelpBalloon(btn, btn.dataset.help || "");
      return;
    }
    if (helpEl && helpEl.classList.contains("open") && !helpEl.contains(target)) closeHelpBalloon();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tutorialActive) {
      const exit = tutorialExitCb;
      tutorialActive = false;
      tutorialAdvanceCb = null;
      tutorialExitCb = null;
      closeHelpBalloon();
      if (exit) exit();
      return;
    }
    const target = e.target;
    if ((e.key === "Enter" || e.key === " ") && (target.closest("[data-help]") || target.closest(".help-glossary-link"))) {
      e.stopPropagation();
    } else if (e.key === "Escape") {
      closeHelpBalloon();
    }
  }, true);
  els.scroller.addEventListener("scroll", () => {
    if (tutorialActive) return;
    if (Date.now() - helpOpenedAt < HELP_SCROLL_GRACE_MS) return;
    closeHelpBalloon();
  });
  window.addEventListener("resize", () => {
    if (!tutorialActive) closeHelpBalloon();
  });
}
function initRolodex(elements, callbacks) {
  els = elements;
  cb = callbacks;
  GATE_DOCKED_H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gate-docked-h")) || 44;
  const contentEl = document.querySelector(".content");
  dockThreshold = contentEl ? parseFloat(getComputedStyle(contentEl).paddingTop) || 0 : 0;
  sizeRoloIndexOffset();
  updateResponsiveScale();
  window.addEventListener("resize", updateResponsiveScale);
  window.addEventListener("resize", sizeGateMarquee);
  window.addEventListener("resize", sizeGateSpacer);
  window.addEventListener("resize", sizeRoloMarquee);
  window.addEventListener("resize", recapExpandedCards);
  window.addEventListener("resize", syncRoloStageHeight);
  window.addEventListener("resize", sizeRoloIndexOffset);
  window.addEventListener("resize", sizeLandscapeHud);
  let gateTickingLocal = false;
  els.scroller.addEventListener("scroll", () => {
    if (gateTickingLocal) return;
    gateTickingLocal = true;
    requestAnimationFrame(() => {
      updateGateDockState();
      gateTickingLocal = false;
    });
  }, { passive: true });
  els.scroller.addEventListener("scroll", scheduleFirstCardSnapCheck, { passive: true });
  els.gateCard.addEventListener("click", () => {
    if (els.gateCard.classList.contains("docked")) jumpToTop();
  });
  els.gateCard.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (els.gateCard.classList.contains("docked")) jumpToTop();
    }
  });
  els.roloStage.addEventListener("pointerdown", onRoloPointerDown);
  document.addEventListener("pointermove", onRoloPointerMove, { passive: false });
  document.addEventListener("pointerup", onRoloPointerUp);
  document.addEventListener("pointercancel", onRoloPointerUp);
  els.roloIndex.addEventListener("pointerdown", pauseRoloMarquee);
  els.roloIndex.addEventListener("pointerup", scheduleRoloMarqueeResume);
  els.roloIndex.addEventListener("pointercancel", scheduleRoloMarqueeResume);
  requestAnimationFrame(stepGateMarquee);
  requestAnimationFrame(stepRoloMarquee);
}

// shared/rate-prompt.ts
var PLAY_PACKAGE = "app.tradetribunal.twa";
var PLAY_LISTING_URL = "https://play.google.com/store/apps/details?id=" + PLAY_PACKAGE;
var PLAY_INTENT_URL = "intent://details?id=" + PLAY_PACKAGE + "#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=" + encodeURIComponent(PLAY_LISTING_URL) + ";end";
var RATE_MIN_ANALYSES = 3;
var RATE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1e3;
var RATE_SHOW_DELAY_MS = 2e3;
var COUNT_KEY = "tv_rate_analyses";
var STATE_KEY = "tv_rate_state";
var SNOOZE_KEY = "tv_rate_snooze_until";
var TWA_SESSION_KEY = "tv_twa_session";
var PLATFORM_KEY = "tv_device_platform";
var BLOCKING_OVERLAY_IDS = ["signin-nudge", "comeback-screen", "settings-modal"];
function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
  }
}
function notePlayAppLaunch() {
  try {
    if (document.referrer.indexOf("android-app://") === 0) sessionStorage.setItem(TWA_SESSION_KEY, "1");
  } catch {
  }
}
function isPlayApp() {
  notePlayAppLaunch();
  try {
    if (sessionStorage.getItem(TWA_SESSION_KEY) === "1") return true;
    if (/[?&]ratepreview\b/.test(location.search)) return true;
  } catch {
  }
  return lsGet(PLATFORM_KEY) === "twa";
}
function shouldShowRatePrompt(now = Date.now()) {
  if (!isPlayApp()) return false;
  const state = lsGet(STATE_KEY);
  if (state === "rated" || state === "never") return false;
  if (Number(lsGet(COUNT_KEY) || 0) < RATE_MIN_ANALYSES) return false;
  const snooze = Number(lsGet(SNOOZE_KEY) || 0);
  return !(snooze && now < snooze);
}
function isVisible(el) {
  return !!el && getComputedStyle(el).display !== "none";
}
function showRatePromptIfAllowed() {
  if (!shouldShowRatePrompt()) return;
  const busy = BLOCKING_OVERLAY_IDS.some(function(id) {
    return isVisible(document.getElementById(id));
  }) || !!document.querySelector(".spotlight-ring") || isTutorialActive();
  if (busy) return;
  const el = document.getElementById("rate-prompt");
  if (el) el.style.display = "flex";
}
var showTimer = null;
function onAnalysisSucceeded() {
  lsSet(COUNT_KEY, String(Number(lsGet(COUNT_KEY) || 0) + 1));
  if (!shouldShowRatePrompt()) return;
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(function() {
    showTimer = null;
    showRatePromptIfAllowed();
  }, RATE_SHOW_DELAY_MS);
}
function closeRatePrompt(action) {
  const el = document.getElementById("rate-prompt");
  if (el) el.style.display = "none";
  if (action === "rate") {
    lsSet(STATE_KEY, "rated");
    try {
      window.location.href = PLAY_INTENT_URL;
    } catch {
      window.open(PLAY_LISTING_URL, "_blank");
    }
  } else if (action === "never") {
    lsSet(STATE_KEY, "never");
  } else {
    lsSet(SNOOZE_KEY, String(Date.now() + RATE_SNOOZE_MS));
  }
}
function initRatePrompt() {
  const on = function(id, action) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", function() {
      closeRatePrompt(action);
    });
  };
  on("rate-prompt-rate", "rate");
  on("rate-prompt-later", "later");
  on("rate-prompt-backdrop", "later");
  on("rate-prompt-never", "never");
}

// node_modules/@supabase/realtime-js/dist/module/lib/websocket-factory.js
var WebSocketFactory = class {
  /**
   * Static-only utility – prevent instantiation.
   */
  constructor() {
  }
  static detectEnvironment() {
    var _a;
    if (typeof WebSocket !== "undefined") {
      return { type: "native", wsConstructor: WebSocket };
    }
    const gt = globalThis;
    if (typeof globalThis !== "undefined" && typeof gt.WebSocket !== "undefined") {
      return { type: "native", wsConstructor: gt.WebSocket };
    }
    const gl = typeof global !== "undefined" ? global : void 0;
    if (gl && typeof gl.WebSocket !== "undefined") {
      return { type: "native", wsConstructor: gl.WebSocket };
    }
    if (typeof globalThis !== "undefined" && typeof gt.WebSocketPair !== "undefined" && typeof globalThis.WebSocket === "undefined") {
      return {
        type: "cloudflare",
        error: "Cloudflare Workers detected. WebSocket clients are not supported in Cloudflare Workers.",
        workaround: "Use Cloudflare Workers WebSocket API for server-side WebSocket handling, or deploy to a different runtime."
      };
    }
    if (typeof globalThis !== "undefined" && gt.EdgeRuntime || typeof navigator !== "undefined" && ((_a = navigator.userAgent) === null || _a === void 0 ? void 0 : _a.includes("Vercel-Edge"))) {
      return {
        type: "unsupported",
        error: "Edge runtime detected (Vercel Edge/Netlify Edge). WebSockets are not supported in edge functions.",
        workaround: "Use serverless functions or a different deployment target for WebSocket functionality."
      };
    }
    const _process = globalThis["process"];
    if (_process) {
      const processVersions = _process["versions"];
      if (processVersions && processVersions["node"]) {
        return {
          type: "unsupported",
          error: "Node.js detected but native WebSocket not found.",
          workaround: "Ensure you are running Node.js 22+ or provide a WebSocket implementation via the transport option."
        };
      }
    }
    return {
      type: "unsupported",
      error: "Unknown JavaScript runtime without WebSocket support.",
      workaround: "Ensure you're running in a supported environment (browser, Node.js, Deno) or provide a custom WebSocket implementation."
    };
  }
  /**
   * Returns the best available WebSocket constructor for the current runtime.
   *
   * @category Realtime
   *
   * @example Example with error handling
   * ```ts
   * try {
   *   const WS = WebSocketFactory.getWebSocketConstructor()
   *   const socket = new WS('wss://example.com/socket')
   * } catch (error) {
   *   console.error('WebSocket not available in this environment.', error)
   * }
   * ```
   */
  static getWebSocketConstructor() {
    const env = this.detectEnvironment();
    if (env.wsConstructor) {
      return env.wsConstructor;
    }
    let errorMessage = env.error || "WebSocket not supported in this environment.";
    if (env.workaround) {
      errorMessage += `

Suggested solution: ${env.workaround}`;
    }
    throw new Error(errorMessage);
  }
  /**
   * Detects whether the runtime can establish WebSocket connections.
   *
   * @category Realtime
   *
   * @example Example in a Node.js script
   * ```ts
   * if (!WebSocketFactory.isWebSocketSupported()) {
   *   console.error('WebSockets are required for this script.')
   *   process.exitCode = 1
   * }
   * ```
   */
  static isWebSocketSupported() {
    try {
      const env = this.detectEnvironment();
      return env.type === "native";
    } catch (_a) {
      return false;
    }
  }
};
var websocket_factory_default = WebSocketFactory;

// node_modules/@supabase/realtime-js/dist/module/lib/version.js
var version = "2.118.0";

// node_modules/@supabase/realtime-js/dist/module/lib/constants.js
var DEFAULT_VERSION = `realtime-js/${version}`;
var VSN_1_0_0 = "1.0.0";
var VSN_2_0_0 = "2.0.0";
var DEFAULT_VSN = VSN_2_0_0;
var DEFAULT_TIMEOUT = 1e4;
var DEFAULT_POSTGRES_CHANGES_WAIT_TIMEOUT = 15e3;
var POSTGRES_CHANGES_WAIT_ERROR_GRACE = 1e4;
var MAX_PUSH_BUFFER_SIZE = 100;
var CHANNEL_STATES = {
  closed: "closed",
  errored: "errored",
  joined: "joined",
  joining: "joining",
  leaving: "leaving"
};
var CHANNEL_EVENTS = {
  close: "phx_close",
  error: "phx_error",
  join: "phx_join",
  reply: "phx_reply",
  leave: "phx_leave",
  access_token: "access_token"
};
var CONNECTION_STATE = {
  connecting: "connecting",
  open: "open",
  closing: "closing",
  closed: "closed"
};

// node_modules/@supabase/realtime-js/dist/module/lib/serializer.js
var Serializer = class {
  constructor(allowedMetadataKeys) {
    this.HEADER_LENGTH = 1;
    this.USER_BROADCAST_PUSH_META_LENGTH = 6;
    this.KINDS = { userBroadcastPush: 3, userBroadcast: 4 };
    this.BINARY_ENCODING = 0;
    this.JSON_ENCODING = 1;
    this.BROADCAST_EVENT = "broadcast";
    this.allowedMetadataKeys = [];
    this.allowedMetadataKeys = allowedMetadataKeys !== null && allowedMetadataKeys !== void 0 ? allowedMetadataKeys : [];
  }
  encode(msg, callback) {
    if (msg.event === this.BROADCAST_EVENT && !(msg.payload instanceof ArrayBuffer) && typeof msg.payload.event === "string") {
      return callback(this._binaryEncodeUserBroadcastPush(msg));
    }
    let payload = [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
    return callback(JSON.stringify(payload));
  }
  _binaryEncodeUserBroadcastPush(message) {
    var _a;
    if (this._isArrayBuffer((_a = message.payload) === null || _a === void 0 ? void 0 : _a.payload)) {
      return this._encodeBinaryUserBroadcastPush(message);
    } else {
      return this._encodeJsonUserBroadcastPush(message);
    }
  }
  _encodeBinaryUserBroadcastPush(message) {
    var _a, _b;
    const userPayload = (_b = (_a = message.payload) === null || _a === void 0 ? void 0 : _a.payload) !== null && _b !== void 0 ? _b : new ArrayBuffer(0);
    return this._encodeUserBroadcastPush(message, this.BINARY_ENCODING, userPayload);
  }
  _encodeJsonUserBroadcastPush(message) {
    var _a, _b;
    const userPayload = (_b = (_a = message.payload) === null || _a === void 0 ? void 0 : _a.payload) !== null && _b !== void 0 ? _b : {};
    const encoder = new TextEncoder();
    const encodedUserPayload = encoder.encode(JSON.stringify(userPayload)).buffer;
    return this._encodeUserBroadcastPush(message, this.JSON_ENCODING, encodedUserPayload);
  }
  _encodeUserBroadcastPush(message, encodingType, encodedPayload) {
    var _a, _b;
    const encoder = new TextEncoder();
    const topic = encoder.encode(message.topic);
    const ref = encoder.encode((_a = message.ref) !== null && _a !== void 0 ? _a : "");
    const joinRef = encoder.encode((_b = message.join_ref) !== null && _b !== void 0 ? _b : "");
    const userEvent = encoder.encode(message.payload.event);
    const rest = this.allowedMetadataKeys ? this._pick(message.payload, this.allowedMetadataKeys) : {};
    const metadata = encoder.encode(Object.keys(rest).length === 0 ? "" : JSON.stringify(rest));
    if (joinRef.length > 255) {
      throw new Error(`joinRef length ${joinRef.length} exceeds maximum of 255`);
    }
    if (ref.length > 255) {
      throw new Error(`ref length ${ref.length} exceeds maximum of 255`);
    }
    if (topic.length > 255) {
      throw new Error(`topic length ${topic.length} exceeds maximum of 255`);
    }
    if (userEvent.length > 255) {
      throw new Error(`userEvent length ${userEvent.length} exceeds maximum of 255`);
    }
    if (metadata.length > 255) {
      throw new Error(`metadata length ${metadata.length} exceeds maximum of 255`);
    }
    const metaLength = this.USER_BROADCAST_PUSH_META_LENGTH + joinRef.length + ref.length + topic.length + userEvent.length + metadata.length;
    const header = new ArrayBuffer(this.HEADER_LENGTH + metaLength);
    const view = new DataView(header);
    const bytes = new Uint8Array(header);
    let offset = 0;
    view.setUint8(offset++, this.KINDS.userBroadcastPush);
    view.setUint8(offset++, joinRef.length);
    view.setUint8(offset++, ref.length);
    view.setUint8(offset++, topic.length);
    view.setUint8(offset++, userEvent.length);
    view.setUint8(offset++, metadata.length);
    view.setUint8(offset++, encodingType);
    bytes.set(joinRef, offset);
    offset += joinRef.length;
    bytes.set(ref, offset);
    offset += ref.length;
    bytes.set(topic, offset);
    offset += topic.length;
    bytes.set(userEvent, offset);
    offset += userEvent.length;
    bytes.set(metadata, offset);
    offset += metadata.length;
    var combined = new Uint8Array(header.byteLength + encodedPayload.byteLength);
    combined.set(new Uint8Array(header), 0);
    combined.set(new Uint8Array(encodedPayload), header.byteLength);
    return combined.buffer;
  }
  decode(rawPayload, callback) {
    if (this._isArrayBuffer(rawPayload)) {
      let result = this._binaryDecode(rawPayload);
      return callback(result);
    }
    if (typeof rawPayload === "string") {
      const jsonPayload = JSON.parse(rawPayload);
      const [join_ref, ref, topic, event, payload] = jsonPayload;
      return callback({ join_ref, ref, topic, event, payload });
    }
    return callback({});
  }
  _binaryDecode(buffer) {
    const view = new DataView(buffer);
    const kind = view.getUint8(0);
    const decoder = new TextDecoder();
    switch (kind) {
      case this.KINDS.userBroadcast:
        return this._decodeUserBroadcast(buffer, view, decoder);
    }
  }
  _decodeUserBroadcast(buffer, view, decoder) {
    const topicSize = view.getUint8(1);
    const userEventSize = view.getUint8(2);
    const metadataSize = view.getUint8(3);
    const payloadEncoding = view.getUint8(4);
    let offset = this.HEADER_LENGTH + 4;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const userEvent = decoder.decode(buffer.slice(offset, offset + userEventSize));
    offset = offset + userEventSize;
    const metadata = decoder.decode(buffer.slice(offset, offset + metadataSize));
    offset = offset + metadataSize;
    const payload = buffer.slice(offset, buffer.byteLength);
    const parsedPayload = payloadEncoding === this.JSON_ENCODING ? JSON.parse(decoder.decode(payload)) : payload;
    const data = {
      type: this.BROADCAST_EVENT,
      event: userEvent,
      payload: parsedPayload
    };
    if (metadataSize > 0) {
      data["meta"] = JSON.parse(metadata);
    }
    return { join_ref: null, ref: null, topic, event: this.BROADCAST_EVENT, payload: data };
  }
  _isArrayBuffer(buffer) {
    var _a;
    return buffer instanceof ArrayBuffer || ((_a = buffer === null || buffer === void 0 ? void 0 : buffer.constructor) === null || _a === void 0 ? void 0 : _a.name) === "ArrayBuffer";
  }
  _pick(obj, keys) {
    if (!obj || typeof obj !== "object") {
      return {};
    }
    return Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)));
  }
};

// node_modules/@supabase/realtime-js/dist/module/lib/transformers.js
var PostgresTypes;
(function(PostgresTypes2) {
  PostgresTypes2["abstime"] = "abstime";
  PostgresTypes2["bool"] = "bool";
  PostgresTypes2["date"] = "date";
  PostgresTypes2["daterange"] = "daterange";
  PostgresTypes2["float4"] = "float4";
  PostgresTypes2["float8"] = "float8";
  PostgresTypes2["int2"] = "int2";
  PostgresTypes2["int4"] = "int4";
  PostgresTypes2["int4range"] = "int4range";
  PostgresTypes2["int8"] = "int8";
  PostgresTypes2["int8range"] = "int8range";
  PostgresTypes2["json"] = "json";
  PostgresTypes2["jsonb"] = "jsonb";
  PostgresTypes2["money"] = "money";
  PostgresTypes2["numeric"] = "numeric";
  PostgresTypes2["oid"] = "oid";
  PostgresTypes2["reltime"] = "reltime";
  PostgresTypes2["text"] = "text";
  PostgresTypes2["time"] = "time";
  PostgresTypes2["timestamp"] = "timestamp";
  PostgresTypes2["timestamptz"] = "timestamptz";
  PostgresTypes2["timetz"] = "timetz";
  PostgresTypes2["tsrange"] = "tsrange";
  PostgresTypes2["tstzrange"] = "tstzrange";
})(PostgresTypes || (PostgresTypes = {}));
var convertChangeData = (columns, record, options = {}) => {
  var _a;
  const skipTypes = (_a = options.skipTypes) !== null && _a !== void 0 ? _a : [];
  if (!record) {
    return {};
  }
  return Object.keys(record).reduce((acc, rec_key) => {
    acc[rec_key] = convertColumn(rec_key, columns, record, skipTypes);
    return acc;
  }, {});
};
var convertColumn = (columnName, columns, record, skipTypes) => {
  const column = columns.find((x) => x.name === columnName);
  const colType = column === null || column === void 0 ? void 0 : column.type;
  const value = record[columnName];
  if (colType && !skipTypes.includes(colType)) {
    return convertCell(colType, value);
  }
  return noop(value);
};
var convertCell = (type, value) => {
  if (type.charAt(0) === "_") {
    const dataType = type.slice(1, type.length);
    return toArray(value, dataType);
  }
  switch (type) {
    case PostgresTypes.bool:
      return toBoolean(value);
    case PostgresTypes.float4:
    case PostgresTypes.float8:
    case PostgresTypes.int2:
    case PostgresTypes.int4:
    case PostgresTypes.int8:
    case PostgresTypes.numeric:
    case PostgresTypes.oid:
      return toNumber(value);
    case PostgresTypes.json:
    case PostgresTypes.jsonb:
      return toJson(value);
    case PostgresTypes.timestamp:
      return toTimestampString(value);
    // Format to be consistent with PostgREST
    case PostgresTypes.abstime:
    // To allow users to cast it based on Timezone
    case PostgresTypes.date:
    // To allow users to cast it based on Timezone
    case PostgresTypes.daterange:
    case PostgresTypes.int4range:
    case PostgresTypes.int8range:
    case PostgresTypes.money:
    case PostgresTypes.reltime:
    // To allow users to cast it based on Timezone
    case PostgresTypes.text:
    case PostgresTypes.time:
    // To allow users to cast it based on Timezone
    case PostgresTypes.timestamptz:
    // To allow users to cast it based on Timezone
    case PostgresTypes.timetz:
    // To allow users to cast it based on Timezone
    case PostgresTypes.tsrange:
    case PostgresTypes.tstzrange:
      return noop(value);
    default:
      return noop(value);
  }
};
var noop = (value) => {
  return value;
};
var toBoolean = (value) => {
  switch (value) {
    case "t":
      return true;
    case "f":
      return false;
    default:
      return value;
  }
};
var toNumber = (value) => {
  if (typeof value === "string") {
    const parsedValue = parseFloat(value);
    if (!Number.isNaN(parsedValue)) {
      return parsedValue;
    }
  }
  return value;
};
var toJson = (value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_a) {
      return value;
    }
  }
  return value;
};
var toArray = (value, type) => {
  if (typeof value !== "string") {
    return value;
  }
  const lastIdx = value.length - 1;
  const closeBrace = value[lastIdx];
  const openBrace = value[0];
  if (openBrace === "{" && closeBrace === "}") {
    let arr;
    const valTrim = value.slice(1, lastIdx);
    try {
      arr = JSON.parse("[" + valTrim + "]");
    } catch (_) {
      arr = valTrim ? valTrim.split(",") : [];
    }
    return arr.map((val) => convertCell(type, val));
  }
  return value;
};
var toTimestampString = (value) => {
  if (typeof value === "string") {
    return value.replace(" ", "T");
  }
  return value;
};
var httpEndpointURL = (socketUrl) => {
  const wsUrl = new URL(socketUrl);
  wsUrl.protocol = wsUrl.protocol.replace(/^ws/i, "http");
  wsUrl.pathname = wsUrl.pathname.replace(/\/+$/, "").replace(/\/socket\/websocket$/i, "").replace(/\/socket$/i, "").replace(/\/websocket$/i, "");
  if (wsUrl.pathname === "" || wsUrl.pathname === "/") {
    wsUrl.pathname = "/api/broadcast";
  } else {
    wsUrl.pathname = wsUrl.pathname + "/api/broadcast";
  }
  return wsUrl.href;
};

// node_modules/@supabase/phoenix/priv/static/phoenix.mjs
var closure = (value) => {
  if (typeof value === "function") {
    return (
      /** @type {() => T} */
      value
    );
  } else {
    let closure2 = function() {
      return value;
    };
    return closure2;
  }
};
var globalSelf = typeof self !== "undefined" ? self : null;
var phxWindow = typeof window !== "undefined" ? window : null;
var global2 = globalSelf || phxWindow || globalThis;
var DEFAULT_VSN2 = "2.0.0";
var DEFAULT_TIMEOUT2 = 1e4;
var WS_CLOSE_NORMAL = 1e3;
var MAX_LONGPOLL_BATCH_SIZE = 100;
var SOCKET_STATES = (
  /** @type {const} */
  { connecting: 0, open: 1, closing: 2, closed: 3 }
);
var CHANNEL_STATES2 = (
  /** @type {const} */
  {
    closed: "closed",
    errored: "errored",
    joined: "joined",
    joining: "joining",
    leaving: "leaving"
  }
);
var CHANNEL_EVENTS2 = (
  /** @type {const} */
  {
    close: "phx_close",
    error: "phx_error",
    join: "phx_join",
    reply: "phx_reply",
    leave: "phx_leave"
  }
);
var TRANSPORTS = (
  /** @type {const} */
  {
    longpoll: "longpoll",
    websocket: "websocket"
  }
);
var XHR_STATES = (
  /** @type {const} */
  {
    complete: 4
  }
);
var AUTH_TOKEN_PREFIX = "base64url.bearer.phx.";
var Push = class {
  /**
   * Initializes the Push
   * @param {Channel} channel - The Channel
   * @param {ChannelEvent} event - The event, for example `"phx_join"`
   * @param {() => Record<string, unknown>} payload - The payload, for example `{user_id: 123}`
   * @param {number} timeout - The push timeout in milliseconds
   */
  constructor(channel2, event, payload, timeout) {
    this.channel = channel2;
    this.event = event;
    this.payload = payload || function() {
      return {};
    };
    this.receivedResp = null;
    this.timeout = timeout;
    this.timeoutTimer = null;
    this.recHooks = [];
    this.sent = false;
    this.ref = void 0;
  }
  /**
   *
   * @param {number} timeout
   */
  resend(timeout) {
    this.timeout = timeout;
    this.reset();
    this.send();
  }
  /**
   *
   */
  send() {
    if (this.hasReceived("timeout")) {
      return;
    }
    this.startTimeout();
    this.sent = true;
    this.channel.socket.push({
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload(),
      ref: this.ref,
      join_ref: this.channel.joinRef()
    });
  }
  /**
   *
   * @param {string} status
   * @param {(response: any) => void} callback
   */
  receive(status, callback) {
    if (this.hasReceived(status)) {
      callback(this.receivedResp.response);
    }
    this.recHooks.push({ status, callback });
    return this;
  }
  reset() {
    this.cancelRefEvent();
    this.ref = null;
    this.refEvent = null;
    this.receivedResp = null;
    this.sent = false;
  }
  destroy() {
    this.cancelRefEvent();
    this.cancelTimeout();
  }
  /**
   * @private
   */
  matchReceive({ status, response, _ref }) {
    this.recHooks.filter((h) => h.status === status).forEach((h) => h.callback(response));
  }
  /**
   * @private
   */
  cancelRefEvent() {
    if (!this.refEvent) {
      return;
    }
    this.channel.off(this.refEvent);
  }
  cancelTimeout() {
    clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
  }
  startTimeout() {
    if (this.timeoutTimer) {
      this.cancelTimeout();
    }
    this.ref = this.channel.socket.makeRef();
    this.refEvent = this.channel.replyEventName(this.ref);
    this.channel.on(this.refEvent, (payload) => {
      this.cancelRefEvent();
      this.cancelTimeout();
      this.receivedResp = payload;
      this.matchReceive(payload);
    });
    this.timeoutTimer = setTimeout(() => {
      this.trigger("timeout", {});
    }, this.timeout);
  }
  /**
   * @private
   */
  hasReceived(status) {
    return this.receivedResp && this.receivedResp.status === status;
  }
  trigger(status, response) {
    this.channel.trigger(this.refEvent, { status, response });
  }
};
var Timer = class {
  /**
  * @param {() => void} callback
  * @param {(tries: number) => number} timerCalc
  */
  constructor(callback, timerCalc) {
    this.callback = callback;
    this.timerCalc = timerCalc;
    this.timer = void 0;
    this.tries = 0;
  }
  reset() {
    this.tries = 0;
    clearTimeout(this.timer);
  }
  /**
   * Cancels any previous scheduleTimeout and schedules callback
   */
  scheduleTimeout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tries = this.tries + 1;
      this.callback();
    }, this.timerCalc(this.tries + 1));
  }
};
var Channel = class {
  /**
   * @param {string} topic
   * @param {Params | (() => Params)} params
   * @param {Socket} socket
   */
  constructor(topic, params, socket) {
    this.state = CHANNEL_STATES2.closed;
    this.topic = topic;
    this.params = closure(params || {});
    this.socket = socket;
    this.bindings = [];
    this.bindingRef = 0;
    this.timeout = this.socket.timeout;
    this.joinedOnce = false;
    this.joinPush = new Push(this, CHANNEL_EVENTS2.join, this.params, this.timeout);
    this.pushBuffer = [];
    this.stateChangeRefs = [];
    this.rejoinTimer = new Timer(() => {
      if (this.socket.isConnected()) {
        this.rejoin();
      }
    }, this.socket.rejoinAfterMs);
    this.stateChangeRefs.push(this.socket.onError(() => this.rejoinTimer.reset()));
    this.stateChangeRefs.push(
      this.socket.onOpen(() => {
        this.rejoinTimer.reset();
        if (this.isErrored()) {
          this.rejoin();
        }
      })
    );
    this.joinPush.receive("ok", () => {
      this.state = CHANNEL_STATES2.joined;
      this.rejoinTimer.reset();
      this.pushBuffer.forEach((pushEvent) => pushEvent.send());
      this.pushBuffer = [];
    });
    this.joinPush.receive("error", (reason) => {
      this.state = CHANNEL_STATES2.errored;
      if (this.socket.hasLogger()) this.socket.log("channel", `error ${this.topic}`, reason);
      if (this.socket.isConnected()) {
        this.rejoinTimer.scheduleTimeout();
      }
    });
    this.onClose(() => {
      this.rejoinTimer.reset();
      if (this.socket.hasLogger()) this.socket.log("channel", `close ${this.topic}`);
      this.state = CHANNEL_STATES2.closed;
      this.socket.remove(this);
    });
    this.onError((reason) => {
      if (this.socket.hasLogger()) this.socket.log("channel", `error ${this.topic}`, reason);
      if (this.isJoining()) {
        this.joinPush.reset();
      }
      this.state = CHANNEL_STATES2.errored;
      if (this.socket.isConnected()) {
        this.rejoinTimer.scheduleTimeout();
      }
    });
    this.joinPush.receive("timeout", () => {
      if (this.socket.hasLogger()) this.socket.log("channel", `timeout ${this.topic}`, this.joinPush.timeout);
      let leavePush = new Push(this, CHANNEL_EVENTS2.leave, closure({}), this.timeout);
      leavePush.send();
      this.state = CHANNEL_STATES2.errored;
      this.joinPush.reset();
      if (this.socket.isConnected()) {
        this.rejoinTimer.scheduleTimeout();
      }
    });
    this.on(CHANNEL_EVENTS2.reply, (payload, ref) => {
      this.trigger(this.replyEventName(ref), payload);
    });
  }
  /**
   * Join the channel
   * @param {number} timeout
   * @returns {Push}
   */
  join(timeout = this.timeout) {
    if (this.joinedOnce) {
      throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance");
    } else {
      this.timeout = timeout;
      this.joinedOnce = true;
      this.rejoin();
      return this.joinPush;
    }
  }
  /**
   * Teardown the channel.
   *
   * Destroys and stops related timers.
   */
  teardown() {
    this.pushBuffer.forEach((push) => push.destroy());
    this.pushBuffer = [];
    this.rejoinTimer.reset();
    this.joinPush.destroy();
    this.state = CHANNEL_STATES2.closed;
    this.bindings = [];
  }
  /**
   * Hook into channel close
   * @param {ChannelBindingCallback} callback
   */
  onClose(callback) {
    this.on(CHANNEL_EVENTS2.close, callback);
  }
  /**
   * Hook into channel errors
   * @param {ChannelOnErrorCallback} callback
   * @return {number}
   */
  onError(callback) {
    return this.on(CHANNEL_EVENTS2.error, (reason) => callback(reason));
  }
  /**
   * Subscribes on channel events
   *
   * Subscription returns a ref counter, which can be used later to
   * unsubscribe the exact event listener
   *
   * @example
   * const ref1 = channel.on("event", do_stuff)
   * const ref2 = channel.on("event", do_other_stuff)
   * channel.off("event", ref1)
   * // Since unsubscription, do_stuff won't fire,
   * // while do_other_stuff will keep firing on the "event"
   *
   * @param {string} event
   * @param {ChannelBindingCallback} callback
   * @returns {number} ref
   */
  on(event, callback) {
    let ref = this.bindingRef++;
    this.bindings.push({ event, ref, callback });
    return ref;
  }
  /**
   * Unsubscribes off of channel events
   *
   * Use the ref returned from a channel.on() to unsubscribe one
   * handler, or pass nothing for the ref to unsubscribe all
   * handlers for the given event.
   *
   * @example
   * // Unsubscribe the do_stuff handler
   * const ref1 = channel.on("event", do_stuff)
   * channel.off("event", ref1)
   *
   * // Unsubscribe all handlers from event
   * channel.off("event")
   *
   * @param {string} event
   * @param {number} [ref]
   */
  off(event, ref) {
    this.bindings = this.bindings.filter((bind) => {
      return !(bind.event === event && (typeof ref === "undefined" || ref === bind.ref));
    });
  }
  /**
   * @private
   */
  canPush() {
    return this.socket.isConnected() && this.isJoined();
  }
  /**
   * Sends a message `event` to phoenix with the payload `payload`.
   * Phoenix receives this in the `handle_in(event, payload, socket)`
   * function. if phoenix replies or it times out (default 10000ms),
   * then optionally the reply can be received.
   *
   * @example
   * channel.push("event")
   *   .receive("ok", payload => console.log("phoenix replied:", payload))
   *   .receive("error", err => console.log("phoenix errored", err))
   *   .receive("timeout", () => console.log("timed out pushing"))
   * @param {string} event
   * @param {Object} payload
   * @param {number} [timeout]
   * @returns {Push}
   */
  push(event, payload, timeout = this.timeout) {
    payload = payload || {};
    if (!this.joinedOnce) {
      throw new Error(`tried to push '${event}' to '${this.topic}' before joining. Use channel.join() before pushing events`);
    }
    let pushEvent = new Push(this, event, function() {
      return payload;
    }, timeout);
    if (this.canPush()) {
      pushEvent.send();
    } else {
      pushEvent.startTimeout();
      this.pushBuffer.push(pushEvent);
    }
    return pushEvent;
  }
  /** Leaves the channel
   *
   * Unsubscribes from server events, and
   * instructs channel to terminate on server
   *
   * Triggers onClose() hooks
   *
   * To receive leave acknowledgements, use the `receive`
   * hook to bind to the server ack, ie:
   *
   * @example
   * channel.leave().receive("ok", () => alert("left!") )
   *
   * @param {number} timeout
   * @returns {Push}
   */
  leave(timeout = this.timeout) {
    this.rejoinTimer.reset();
    this.joinPush.cancelTimeout();
    this.state = CHANNEL_STATES2.leaving;
    let onClose = () => {
      if (this.socket.hasLogger()) this.socket.log("channel", `leave ${this.topic}`);
      this.trigger(CHANNEL_EVENTS2.close, "leave");
    };
    let leavePush = new Push(this, CHANNEL_EVENTS2.leave, closure({}), timeout);
    leavePush.receive("ok", () => onClose()).receive("timeout", () => onClose());
    leavePush.send();
    if (!this.canPush()) {
      leavePush.trigger("ok", {});
    }
    return leavePush;
  }
  /**
   * Overridable message hook
   *
   * Receives all events for specialized message handling
   * before dispatching to the channel callbacks.
   *
   * Must return the payload, modified or unmodified
   * @type{ChannelOnMessage}
   */
  onMessage(_event, payload, _ref) {
    return payload;
  }
  /**
   * Overridable filter hook
   *
   * If this function returns `true`, `binding`'s callback will be called.
   *
   * @type{ChannelFilterBindings}
   */
  filterBindings(_binding, _payload, _ref) {
    return true;
  }
  isMember(topic, event, payload, joinRef) {
    if (this.topic !== topic) {
      return false;
    }
    if (joinRef && joinRef !== this.joinRef()) {
      if (this.socket.hasLogger()) this.socket.log("channel", "dropping outdated message", { topic, event, payload, joinRef });
      return false;
    } else {
      return true;
    }
  }
  joinRef() {
    return this.joinPush.ref;
  }
  /**
   * @private
   */
  rejoin(timeout = this.timeout) {
    if (this.isLeaving()) {
      return;
    }
    this.socket.leaveOpenTopic(this.topic);
    this.state = CHANNEL_STATES2.joining;
    this.joinPush.resend(timeout);
  }
  /**
   * @param {string} event
   * @param {unknown} [payload]
   * @param {?string} [ref]
   * @param {?string} [joinRef]
   */
  trigger(event, payload, ref, joinRef) {
    let handledPayload = this.onMessage(event, payload, ref, joinRef);
    if (payload && !handledPayload) {
      throw new Error("channel onMessage callbacks must return the payload, modified or unmodified");
    }
    let eventBindings = this.bindings.filter((bind) => bind.event === event && this.filterBindings(bind, payload, ref));
    for (let i = 0; i < eventBindings.length; i++) {
      let bind = eventBindings[i];
      bind.callback(handledPayload, ref, joinRef || this.joinRef());
    }
  }
  /**
  * @param {string} ref
  */
  replyEventName(ref) {
    return `chan_reply_${ref}`;
  }
  isClosed() {
    return this.state === CHANNEL_STATES2.closed;
  }
  isErrored() {
    return this.state === CHANNEL_STATES2.errored;
  }
  isJoined() {
    return this.state === CHANNEL_STATES2.joined;
  }
  isJoining() {
    return this.state === CHANNEL_STATES2.joining;
  }
  isLeaving() {
    return this.state === CHANNEL_STATES2.leaving;
  }
};
var Ajax = class {
  static request(method, endPoint, headers, body, timeout, ontimeout, callback) {
    if (global2.XDomainRequest) {
      let req = new global2.XDomainRequest();
      return this.xdomainRequest(req, method, endPoint, body, timeout, ontimeout, callback);
    } else if (global2.XMLHttpRequest) {
      let req = new global2.XMLHttpRequest();
      return this.xhrRequest(req, method, endPoint, headers, body, timeout, ontimeout, callback);
    } else if (global2.fetch && global2.AbortController) {
      return this.fetchRequest(method, endPoint, headers, body, timeout, ontimeout, callback);
    } else {
      throw new Error("No suitable XMLHttpRequest implementation found");
    }
  }
  static fetchRequest(method, endPoint, headers, body, timeout, ontimeout, callback) {
    let options = {
      method,
      headers,
      body
    };
    let controller = null;
    if (timeout) {
      controller = new AbortController();
      const _timeoutId = setTimeout(() => controller.abort(), timeout);
      options.signal = controller.signal;
    }
    global2.fetch(endPoint, options).then((response) => response.text()).then((data) => this.parseJSON(data)).then((data) => callback && callback(data)).catch((err) => {
      if (err.name === "AbortError" && ontimeout) {
        ontimeout();
      } else {
        callback && callback(null);
      }
    });
    return controller;
  }
  static xdomainRequest(req, method, endPoint, body, timeout, ontimeout, callback) {
    req.timeout = timeout;
    req.open(method, endPoint);
    req.onload = () => {
      let response = this.parseJSON(req.responseText);
      callback && callback(response);
    };
    if (ontimeout) {
      req.ontimeout = ontimeout;
    }
    req.onprogress = () => {
    };
    req.send(body);
    return req;
  }
  static xhrRequest(req, method, endPoint, headers, body, timeout, ontimeout, callback) {
    req.open(method, endPoint, true);
    req.timeout = timeout;
    for (let [key, value] of Object.entries(headers)) {
      req.setRequestHeader(key, value);
    }
    req.onerror = () => callback && callback(null);
    req.onreadystatechange = () => {
      if (req.readyState === XHR_STATES.complete && callback) {
        let response = this.parseJSON(req.responseText);
        callback(response);
      }
    };
    if (ontimeout) {
      req.ontimeout = ontimeout;
    }
    req.send(body);
    return req;
  }
  static parseJSON(resp) {
    if (!resp || resp === "") {
      return null;
    }
    try {
      return JSON.parse(resp);
    } catch {
      console && console.log("failed to parse JSON response", resp);
      return null;
    }
  }
  static serialize(obj, parentKey) {
    let queryStr = [];
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }
      let paramKey = parentKey ? `${parentKey}[${key}]` : key;
      let paramVal = obj[key];
      if (typeof paramVal === "object") {
        queryStr.push(this.serialize(paramVal, paramKey));
      } else {
        queryStr.push(encodeURIComponent(paramKey) + "=" + encodeURIComponent(paramVal));
      }
    }
    return queryStr.join("&");
  }
  static appendParams(url, params) {
    if (Object.keys(params).length === 0) {
      return url;
    }
    let prefix = url.match(/\?/) ? "&" : "?";
    return `${url}${prefix}${this.serialize(params)}`;
  }
};
var arrayBufferToBase64 = (buffer) => {
  let binary = "";
  let bytes = new Uint8Array(buffer);
  let len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};
var LongPoll = class {
  constructor(endPoint, protocols) {
    if (protocols && protocols.length === 2 && protocols[1].startsWith(AUTH_TOKEN_PREFIX)) {
      this.authToken = atob(protocols[1].slice(AUTH_TOKEN_PREFIX.length));
    }
    this.endPoint = null;
    this.token = null;
    this.skipHeartbeat = true;
    this.reqs = /* @__PURE__ */ new Set();
    this.awaitingBatchAck = false;
    this.currentBatch = null;
    this.currentBatchTimer = null;
    this.batchBuffer = [];
    this.onopen = function() {
    };
    this.onerror = function() {
    };
    this.onmessage = function() {
    };
    this.onclose = function() {
    };
    this.pollEndpoint = this.normalizeEndpoint(endPoint);
    this.readyState = SOCKET_STATES.connecting;
    setTimeout(() => this.poll(), 0);
  }
  normalizeEndpoint(endPoint) {
    return endPoint.replace("ws://", "http://").replace("wss://", "https://").replace(new RegExp("(.*)/" + TRANSPORTS.websocket), "$1/" + TRANSPORTS.longpoll);
  }
  endpointURL() {
    return Ajax.appendParams(this.pollEndpoint, { token: this.token });
  }
  closeAndRetry(code, reason, wasClean) {
    this.close(code, reason, wasClean);
    this.readyState = SOCKET_STATES.connecting;
  }
  ontimeout() {
    this.onerror("timeout");
    this.closeAndRetry(1005, "timeout", false);
  }
  isActive() {
    return this.readyState === SOCKET_STATES.open || this.readyState === SOCKET_STATES.connecting;
  }
  poll() {
    const headers = { "Accept": "application/json" };
    if (this.authToken) {
      headers["X-Phoenix-AuthToken"] = this.authToken;
    }
    this.ajax("GET", headers, null, () => this.ontimeout(), (resp) => {
      if (resp) {
        var { status, token, messages } = resp;
        if (status === 410 && this.token !== null) {
          this.onerror(410);
          this.closeAndRetry(3410, "session_gone", false);
          return;
        }
        this.token = token;
      } else {
        status = 0;
      }
      switch (status) {
        case 200:
          messages.forEach((msg) => {
            setTimeout(() => this.onmessage({ data: msg }), 0);
          });
          this.poll();
          break;
        case 204:
          this.poll();
          break;
        case 410:
          this.readyState = SOCKET_STATES.open;
          this.onopen({});
          this.poll();
          break;
        case 403:
          this.onerror(403);
          this.close(1008, "forbidden", false);
          break;
        case 0:
        case 500:
          this.onerror(500);
          this.closeAndRetry(1011, "internal server error", 500);
          break;
        default:
          throw new Error(`unhandled poll status ${status}`);
      }
    });
  }
  // we collect all pushes within the current event loop by
  // setTimeout 0, which optimizes back-to-back procedural
  // pushes against an empty buffer
  send(body) {
    if (typeof body !== "string") {
      body = arrayBufferToBase64(body);
    }
    if (this.currentBatch) {
      this.currentBatch.push(body);
    } else if (this.awaitingBatchAck) {
      this.batchBuffer.push(body);
    } else {
      this.currentBatch = [body];
      this.currentBatchTimer = setTimeout(() => {
        this.batchSend(this.currentBatch);
        this.currentBatch = null;
      }, 0);
    }
  }
  batchSend(messages, offset = 0) {
    this.awaitingBatchAck = true;
    const next = offset + MAX_LONGPOLL_BATCH_SIZE;
    const batch = messages.slice(offset, next);
    this.ajax("POST", { "Content-Type": "application/x-ndjson" }, batch.join("\n"), () => this.onerror("timeout"), (resp) => {
      if (!resp || resp.status !== 200) {
        this.awaitingBatchAck = false;
        this.onerror(resp && resp.status);
        this.closeAndRetry(1011, "internal server error", false);
      } else if (next < messages.length) {
        this.batchSend(messages, next);
      } else if (this.batchBuffer.length > 0) {
        this.batchSend(this.batchBuffer);
        this.batchBuffer = [];
      } else {
        this.awaitingBatchAck = false;
      }
    });
  }
  close(code, reason, wasClean) {
    for (let req of this.reqs) {
      req.abort();
    }
    this.readyState = SOCKET_STATES.closed;
    let opts = Object.assign({ code: 1e3, reason: void 0, wasClean: true }, { code, reason, wasClean });
    this.batchBuffer = [];
    clearTimeout(this.currentBatchTimer);
    this.currentBatchTimer = null;
    if (typeof CloseEvent !== "undefined") {
      this.onclose(new CloseEvent("close", opts));
    } else {
      this.onclose(opts);
    }
  }
  ajax(method, headers, body, onCallerTimeout, callback) {
    let req;
    let ontimeout = () => {
      this.reqs.delete(req);
      onCallerTimeout();
    };
    req = Ajax.request(method, this.endpointURL(), headers, body, this.timeout, ontimeout, (resp) => {
      this.reqs.delete(req);
      if (this.isActive()) {
        callback(resp);
      }
    });
    this.reqs.add(req);
  }
};
var Presence = class _Presence {
  /**
   * Initializes the Presence
   * @param {Channel} channel - The Channel
   * @param {PresenceOptions} [opts] - The options, for example `{events: {state: "state", diff: "diff"}}`
   */
  constructor(channel2, opts = {}) {
    let events = opts.events || /** @type {PresenceEvents} */
    { state: "presence_state", diff: "presence_diff" };
    this.state = /* @__PURE__ */ Object.create(null);
    this.pendingDiffs = [];
    this.channel = channel2;
    this.joinRef = null;
    this.caller = {
      onJoin: function() {
      },
      onLeave: function() {
      },
      onSync: function() {
      }
    };
    this.channel.on(events.state, (newState) => {
      let { onJoin, onLeave, onSync } = this.caller;
      this.joinRef = this.channel.joinRef();
      this.state = _Presence.syncState(this.state, newState, onJoin, onLeave);
      this.pendingDiffs.forEach((diff) => {
        this.state = _Presence.syncDiff(this.state, diff, onJoin, onLeave);
      });
      this.pendingDiffs = [];
      onSync();
    });
    this.channel.on(events.diff, (diff) => {
      let { onJoin, onLeave, onSync } = this.caller;
      if (this.inPendingSyncState()) {
        this.pendingDiffs.push(diff);
      } else {
        this.state = _Presence.syncDiff(this.state, diff, onJoin, onLeave);
        onSync();
      }
    });
  }
  /**
   * @param {PresenceOnJoin} callback
   */
  onJoin(callback) {
    this.caller.onJoin = callback;
  }
  /**
   * @param {PresenceOnLeave} callback
   */
  onLeave(callback) {
    this.caller.onLeave = callback;
  }
  /**
   * @param {PresenceOnSync} callback
   */
  onSync(callback) {
    this.caller.onSync = callback;
  }
  /**
   * Returns the array of presences, with selected metadata.
   *
   * @template [T=PresenceState]
   * @param {((key: string, obj: PresenceState) => T)} [by]
   *
   * @returns {T[]}
   */
  list(by) {
    return _Presence.list(this.state, by);
  }
  inPendingSyncState() {
    return !this.joinRef || this.joinRef !== this.channel.joinRef();
  }
  // lower-level public static API
  /**
   * Used to sync the list of presences on the server
   * with the client's state. An optional `onJoin` and `onLeave` callback can
   * be provided to react to changes in the client's local presences across
   * disconnects and reconnects with the server.
   *
   * @param {Record<string, PresenceState>} currentState
   * @param {Record<string, PresenceState>} newState
   * @param {PresenceOnJoin} onJoin
   * @param {PresenceOnLeave} onLeave
   *
   * @returns {Record<string, PresenceState>}
   */
  static syncState(currentState, newState, onJoin, onLeave) {
    let state = this.toNullProtoObj(this.clone(currentState));
    newState = this.toNullProtoObj(newState);
    let joins = /* @__PURE__ */ Object.create(null);
    let leaves = /* @__PURE__ */ Object.create(null);
    this.map(state, (key, presence) => {
      if (!newState[key]) {
        leaves[key] = presence;
      }
    });
    this.map(newState, (key, newPresence) => {
      let currentPresence = state[key];
      if (currentPresence) {
        let newRefs = newPresence.metas.map((m) => m.phx_ref);
        let curRefs = currentPresence.metas.map((m) => m.phx_ref);
        let joinedMetas = newPresence.metas.filter((m) => curRefs.indexOf(m.phx_ref) < 0);
        let leftMetas = currentPresence.metas.filter((m) => newRefs.indexOf(m.phx_ref) < 0);
        if (joinedMetas.length > 0) {
          joins[key] = newPresence;
          joins[key].metas = joinedMetas;
        }
        if (leftMetas.length > 0) {
          leaves[key] = this.clone(currentPresence);
          leaves[key].metas = leftMetas;
        }
      } else {
        joins[key] = newPresence;
      }
    });
    return this.syncDiff(state, { joins, leaves }, onJoin, onLeave);
  }
  /**
   *
   * Used to sync a diff of presence join and leave
   * events from the server, as they happen. Like `syncState`, `syncDiff`
   * accepts optional `onJoin` and `onLeave` callbacks to react to a user
   * joining or leaving from a device.
   *
   * @param {Record<string, PresenceState>} state
   * @param {PresenceDiff} diff
   * @param {PresenceOnJoin} onJoin
   * @param {PresenceOnLeave} onLeave
   *
   * @returns {Record<string, PresenceState>}
   */
  static syncDiff(state, diff, onJoin, onLeave) {
    state = this.toNullProtoObj(state);
    let { joins, leaves } = this.clone(diff);
    if (!onJoin) {
      onJoin = function() {
      };
    }
    if (!onLeave) {
      onLeave = function() {
      };
    }
    this.map(joins, (key, newPresence) => {
      let currentPresence = state[key];
      state[key] = this.clone(newPresence);
      if (currentPresence) {
        let joinedRefs = state[key].metas.map((m) => m.phx_ref);
        let curMetas = currentPresence.metas.filter((m) => joinedRefs.indexOf(m.phx_ref) < 0);
        state[key].metas.unshift(...curMetas);
      }
      onJoin(key, currentPresence, newPresence);
    });
    this.map(leaves, (key, leftPresence) => {
      let currentPresence = state[key];
      if (!currentPresence) {
        return;
      }
      let refsToRemove = leftPresence.metas.map((m) => m.phx_ref);
      currentPresence.metas = currentPresence.metas.filter((p) => {
        return refsToRemove.indexOf(p.phx_ref) < 0;
      });
      onLeave(key, currentPresence, leftPresence);
      if (currentPresence.metas.length === 0) {
        delete state[key];
      }
    });
    return state;
  }
  /**
   * Returns the array of presences, with selected metadata.
   *
   * @template [T=PresenceState]
   * @param {Record<string, PresenceState>} presences
   * @param {((key: string, obj: PresenceState) => T)} [chooser]
   *
   * @returns {T[]}
   */
  static list(presences, chooser) {
    if (!chooser) {
      chooser = function(key, pres) {
        return pres;
      };
    }
    return this.map(presences, (key, presence) => {
      return chooser(key, presence);
    });
  }
  // private
  /**
  * @template T
  * @param {Record<string, PresenceState>} obj
  * @param {(key: string, obj: PresenceState) => T} func
  */
  static map(obj, func) {
    return Object.getOwnPropertyNames(obj).map((key) => func(key, obj[key]));
  }
  // Presence keys are chosen on the server and may collide with
  // Object.prototype properties ("__proto__", "constructor", ...), so any
  // object indexed by presence key must not have a prototype chain
  //
  // TODO: replace the null-prototype objects with Maps in Phoenix 2.0
  // (breaking change for the lower-level static API)
  static toNullProtoObj(obj) {
    if (Object.getPrototypeOf(obj) === null) {
      return obj;
    }
    let cleaned = /* @__PURE__ */ Object.create(null);
    Object.getOwnPropertyNames(obj).forEach((key) => {
      cleaned[key] = obj[key];
    });
    return cleaned;
  }
  /**
  * @template T
  * @param {T} obj
  * @returns {T}
  */
  static clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
};
var serializer_default = {
  HEADER_LENGTH: 1,
  META_LENGTH: 4,
  KINDS: { push: 0, reply: 1, broadcast: 2 },
  /**
  * @template T
  * @param {Message<Record<string, any>>} msg
  * @param {(msg: ArrayBuffer | string) => T} callback
  * @returns {T}
  */
  encode(msg, callback) {
    if (msg.payload.constructor === ArrayBuffer) {
      return callback(this.binaryEncode(msg));
    } else {
      let payload = [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
      return callback(JSON.stringify(payload));
    }
  },
  /**
  * @template T
  * @param {ArrayBuffer | string} rawPayload
  * @param {(msg: Message<unknown>) => T} callback
  * @returns {T}
  */
  decode(rawPayload, callback) {
    if (rawPayload.constructor === ArrayBuffer) {
      return callback(this.binaryDecode(rawPayload));
    } else {
      let [join_ref, ref, topic, event, payload] = JSON.parse(rawPayload);
      return callback({ join_ref, ref, topic, event, payload });
    }
  },
  /** @private */
  binaryEncode(message) {
    let { join_ref, ref, event, topic, payload } = message;
    let encoder = new TextEncoder();
    let joinRefBytes = encoder.encode(join_ref);
    let refBytes = encoder.encode(ref);
    let topicBytes = encoder.encode(topic);
    let eventBytes = encoder.encode(event);
    this.assertFieldSize(joinRefBytes.byteLength, "join_ref");
    this.assertFieldSize(refBytes.byteLength, "ref");
    this.assertFieldSize(topicBytes.byteLength, "topic");
    this.assertFieldSize(eventBytes.byteLength, "event");
    let metaLength = this.META_LENGTH + joinRefBytes.byteLength + refBytes.byteLength + topicBytes.byteLength + eventBytes.byteLength;
    let header = new ArrayBuffer(this.HEADER_LENGTH + metaLength);
    let headerBytes = new Uint8Array(header);
    let view = new DataView(header);
    let offset = 0;
    view.setUint8(offset++, this.KINDS.push);
    view.setUint8(offset++, joinRefBytes.byteLength);
    view.setUint8(offset++, refBytes.byteLength);
    view.setUint8(offset++, topicBytes.byteLength);
    view.setUint8(offset++, eventBytes.byteLength);
    headerBytes.set(joinRefBytes, offset);
    offset += joinRefBytes.byteLength;
    headerBytes.set(refBytes, offset);
    offset += refBytes.byteLength;
    headerBytes.set(topicBytes, offset);
    offset += topicBytes.byteLength;
    headerBytes.set(eventBytes, offset);
    offset += eventBytes.byteLength;
    var combined = new Uint8Array(header.byteLength + payload.byteLength);
    combined.set(headerBytes, 0);
    combined.set(new Uint8Array(payload), header.byteLength);
    return combined.buffer;
  },
  assertFieldSize(size, name) {
    if (size > 255) {
      throw new Error(`unable to convert ${name} to binary: must be less than or equal to 255 bytes, but is ${size} bytes`);
    }
  },
  /**
  * @private
  */
  binaryDecode(buffer) {
    let view = new DataView(buffer);
    let kind = view.getUint8(0);
    let decoder = new TextDecoder();
    switch (kind) {
      case this.KINDS.push:
        return this.decodePush(buffer, view, decoder);
      case this.KINDS.reply:
        return this.decodeReply(buffer, view, decoder);
      case this.KINDS.broadcast:
        return this.decodeBroadcast(buffer, view, decoder);
    }
  },
  /** @private */
  decodePush(buffer, view, decoder) {
    let joinRefSize = view.getUint8(1);
    let topicSize = view.getUint8(2);
    let eventSize = view.getUint8(3);
    let offset = this.HEADER_LENGTH + this.META_LENGTH - 1;
    let joinRef = decoder.decode(buffer.slice(offset, offset + joinRefSize));
    offset = offset + joinRefSize;
    let topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    let event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    let data = buffer.slice(offset, buffer.byteLength);
    return { join_ref: joinRef, ref: null, topic, event, payload: data };
  },
  /** @private */
  decodeReply(buffer, view, decoder) {
    let joinRefSize = view.getUint8(1);
    let refSize = view.getUint8(2);
    let topicSize = view.getUint8(3);
    let eventSize = view.getUint8(4);
    let offset = this.HEADER_LENGTH + this.META_LENGTH;
    let joinRef = decoder.decode(buffer.slice(offset, offset + joinRefSize));
    offset = offset + joinRefSize;
    let ref = decoder.decode(buffer.slice(offset, offset + refSize));
    offset = offset + refSize;
    let topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    let event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    let data = buffer.slice(offset, buffer.byteLength);
    let payload = { status: event, response: data };
    return { join_ref: joinRef, ref, topic, event: CHANNEL_EVENTS2.reply, payload };
  },
  /** @private */
  decodeBroadcast(buffer, view, decoder) {
    let topicSize = view.getUint8(1);
    let eventSize = view.getUint8(2);
    let offset = this.HEADER_LENGTH + 2;
    let topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    let event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    let data = buffer.slice(offset, buffer.byteLength);
    return { join_ref: null, ref: null, topic, event, payload: data };
  }
};
var Socket = class {
  /** Initializes the Socket *
   *
   * For IE8 support use an ES5-shim (https://github.com/es-shims/es5-shim)
   *
   * @constructor
   * @param {string} endPoint - The string WebSocket endpoint, ie, `"ws://example.com/socket"`,
   *                                               `"wss://example.com"`
   *                                               `"/socket"` (inherited host & protocol)
   * @param {SocketOptions} [opts] - Optional configuration
   */
  constructor(endPoint, opts = {}) {
    this.stateChangeCallbacks = { open: [], close: [], error: [], message: [] };
    this.channels = [];
    this.sendBuffer = [];
    this.ref = 0;
    this.fallbackRef = null;
    this.timeout = opts.timeout || DEFAULT_TIMEOUT2;
    this.transport = opts.transport || global2.WebSocket || LongPoll;
    this.conn = void 0;
    this.primaryPassedHealthCheck = false;
    this.longPollFallbackMs = opts.longPollFallbackMs;
    this.fallbackTimer = null;
    let envSessionStorage = null;
    try {
      envSessionStorage = global2 && global2.sessionStorage;
    } catch {
    }
    this.sessionStore = opts.sessionStorage || envSessionStorage;
    this.establishedConnections = 0;
    this.defaultEncoder = serializer_default.encode.bind(serializer_default);
    this.defaultDecoder = serializer_default.decode.bind(serializer_default);
    this.closeWasClean = true;
    this.disconnecting = false;
    this.binaryType = opts.binaryType || "arraybuffer";
    this.connectClock = 1;
    this.pageHidden = false;
    this.encode = void 0;
    this.decode = void 0;
    if (this.transport !== LongPoll) {
      this.encode = opts.encode || this.defaultEncoder;
      this.decode = opts.decode || this.defaultDecoder;
    } else {
      this.encode = this.defaultEncoder;
      this.decode = this.defaultDecoder;
    }
    let awaitingConnectionOnPageShow = null;
    if (phxWindow && phxWindow.addEventListener) {
      phxWindow.addEventListener("pagehide", (_e) => {
        if (this.conn) {
          this.disconnect();
          awaitingConnectionOnPageShow = this.connectClock;
        }
      });
      phxWindow.addEventListener("pageshow", (_e) => {
        if (awaitingConnectionOnPageShow === this.connectClock) {
          awaitingConnectionOnPageShow = null;
          this.connect();
        }
      });
      phxWindow.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.pageHidden = true;
        } else {
          this.pageHidden = false;
          if (!this.isConnected() && !this.closeWasClean) {
            this.teardown(() => this.connect());
          }
        }
      });
    }
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs || 3e4;
    this.autoSendHeartbeat = opts.autoSendHeartbeat ?? true;
    this.heartbeatCallback = opts.heartbeatCallback ?? (() => {
    });
    this.rejoinAfterMs = (tries) => {
      if (opts.rejoinAfterMs) {
        return opts.rejoinAfterMs(tries);
      } else {
        return [1e3, 2e3, 5e3][tries - 1] || 1e4;
      }
    };
    this.reconnectAfterMs = (tries) => {
      if (opts.reconnectAfterMs) {
        return opts.reconnectAfterMs(tries);
      } else {
        return [10, 50, 100, 150, 200, 250, 500, 1e3, 2e3][tries - 1] || 5e3;
      }
    };
    this.logger = opts.logger || null;
    if (!this.logger && opts.debug) {
      this.logger = (kind, msg, data) => {
        console.log(`${kind}: ${msg}`, data);
      };
    }
    this.longpollerTimeout = opts.longpollerTimeout || 2e4;
    this.params = closure(opts.params || {});
    this.endPoint = `${endPoint}/${TRANSPORTS.websocket}`;
    this.vsn = opts.vsn || DEFAULT_VSN2;
    this.heartbeatTimeoutTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatSentAt = null;
    this.pendingHeartbeatRef = null;
    this.reconnectTimer = new Timer(() => {
      if (this.pageHidden) {
        this.log("Not reconnecting as page is hidden!");
        this.teardown();
        return;
      }
      this.teardown(async () => {
        if (opts.beforeReconnect) await opts.beforeReconnect();
        this.connect();
      });
    }, this.reconnectAfterMs);
    this.authToken = opts.authToken && closure(opts.authToken);
  }
  /**
   * Returns the LongPoll transport reference
   */
  getLongPollTransport() {
    return LongPoll;
  }
  /**
   * Disconnects and replaces the active transport
   *
   * @param {SocketTransport} newTransport - The new transport class to instantiate
   *
   */
  replaceTransport(newTransport) {
    this.connectClock++;
    this.closeWasClean = true;
    clearTimeout(this.fallbackTimer);
    this.reconnectTimer.reset();
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    this.transport = newTransport;
  }
  /**
   * Returns the socket protocol
   *
   * @returns {"wss" | "ws"}
   */
  protocol() {
    return location.protocol.match(/^https/) ? "wss" : "ws";
  }
  /**
   * The fully qualified socket url
   *
   * @returns {string}
   */
  endPointURL() {
    let uri = Ajax.appendParams(
      Ajax.appendParams(this.endPoint, this.params()),
      { vsn: this.vsn }
    );
    if (uri.charAt(0) !== "/") {
      return uri;
    }
    if (uri.charAt(1) === "/") {
      return `${this.protocol()}:${uri}`;
    }
    return `${this.protocol()}://${location.host}${uri}`;
  }
  /**
   * Disconnects the socket
   *
   * See https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes for valid status codes.
   *
   * @param {() => void} [callback] - Optional callback which is called after socket is disconnected.
   * @param {number} [code] - A status code for disconnection (Optional).
   * @param {string} [reason] - A textual description of the reason to disconnect. (Optional)
   */
  disconnect(callback, code, reason) {
    this.connectClock++;
    this.disconnecting = true;
    this.closeWasClean = true;
    clearTimeout(this.fallbackTimer);
    this.reconnectTimer.reset();
    this.teardown(() => {
      this.disconnecting = false;
      callback && callback();
    }, code, reason);
  }
  /**
   * @param {Params} [params] - [DEPRECATED] The params to send when connecting, for example `{user_id: userToken}`
   *
   * Passing params to connect is deprecated; pass them in the Socket constructor instead:
   * `new Socket("/socket", {params: {user_id: userToken}})`.
   */
  connect(params) {
    if (params) {
      console && console.log("passing params to connect is deprecated. Instead pass :params to the Socket constructor");
      this.params = closure(params);
    }
    if (this.conn && !this.disconnecting) {
      return;
    }
    if (this.longPollFallbackMs && this.transport !== LongPoll) {
      this.connectWithFallback(LongPoll, this.longPollFallbackMs);
    } else {
      this.transportConnect();
    }
  }
  /**
   * Logs the message. Override `this.logger` for specialized logging. noops by default
   * @param {string} kind
   * @param {string} msg
   * @param {Object} data
   */
  log(kind, msg, data) {
    this.logger && this.logger(kind, msg, data);
  }
  /**
   * Returns true if a logger has been set on this socket.
   */
  hasLogger() {
    return this.logger !== null;
  }
  /**
   * Registers callbacks for connection open events
   *
   * @example socket.onOpen(function(){ console.info("the socket was opened") })
   *
   * @param {SocketOnOpen} callback
   */
  onOpen(callback) {
    let ref = this.makeRef();
    this.stateChangeCallbacks.open.push([ref, callback]);
    return ref;
  }
  /**
   * Registers callbacks for connection close events
   * @param {SocketOnClose} callback
   * @returns {string}
   */
  onClose(callback) {
    let ref = this.makeRef();
    this.stateChangeCallbacks.close.push([ref, callback]);
    return ref;
  }
  /**
   * Registers callbacks for connection error events
   *
   * @example socket.onError(function(error){ alert("An error occurred") })
   *
   * @param {SocketOnError} callback
   * @returns {string}
   */
  onError(callback) {
    let ref = this.makeRef();
    this.stateChangeCallbacks.error.push([ref, callback]);
    return ref;
  }
  /**
   * Registers callbacks for connection message events
   * @param {SocketOnMessage} callback
   * @returns {string}
   */
  onMessage(callback) {
    let ref = this.makeRef();
    this.stateChangeCallbacks.message.push([ref, callback]);
    return ref;
  }
  /**
   * Sets a callback that receives lifecycle events for internal heartbeat messages.
   * Useful for instrumenting connection health (e.g. sent/ok/timeout/disconnected).
   * @param {HeartbeatCallback} callback
   */
  onHeartbeat(callback) {
    this.heartbeatCallback = callback;
  }
  /**
   * Pings the server and invokes the callback with the RTT in milliseconds
   * @param {(timeDelta: number) => void} callback
   *
   * Returns true if the ping was pushed or false if unable to be pushed.
   */
  ping(callback) {
    if (!this.isConnected()) {
      return false;
    }
    let ref = this.makeRef();
    let startTime = Date.now();
    this.push({ topic: "phoenix", event: "heartbeat", payload: {}, ref });
    let onMsgRef = this.onMessage((msg) => {
      if (msg.ref === ref) {
        this.off([onMsgRef]);
        callback(Date.now() - startTime);
      }
    });
    return true;
  }
  /**
   * @private
   *
   * @param {Function}
   */
  transportName(transport) {
    switch (transport) {
      case LongPoll:
        return "LongPoll";
      default:
        return transport.name;
    }
  }
  /**
   * @private
   */
  transportConnect() {
    this.connectClock++;
    this.closeWasClean = false;
    let protocols = void 0;
    if (this.authToken) {
      protocols = ["phoenix", `${AUTH_TOKEN_PREFIX}${btoa(this.authToken()).replace(/=/g, "")}`];
    }
    this.conn = new this.transport(this.endPointURL(), protocols);
    this.conn.binaryType = this.binaryType;
    this.conn.timeout = this.longpollerTimeout;
    this.conn.onopen = () => this.onConnOpen();
    this.conn.onerror = (error) => this.onConnError(error);
    this.conn.onmessage = (event) => this.onConnMessage(event);
    this.conn.onclose = (event) => this.onConnClose(event);
  }
  getSession(key) {
    return this.sessionStore && this.sessionStore.getItem(key);
  }
  storeSession(key, val) {
    this.sessionStore && this.sessionStore.setItem(key, val);
  }
  connectWithFallback(fallbackTransport, fallbackThreshold = 2500) {
    clearTimeout(this.fallbackTimer);
    let established = false;
    let primaryTransport = true;
    let openRef, errorRef;
    let fallbackTransportName = this.transportName(fallbackTransport);
    let fallback = (reason) => {
      this.log("transport", `falling back to ${fallbackTransportName}...`, reason);
      this.off([openRef, errorRef]);
      primaryTransport = false;
      this.replaceTransport(fallbackTransport);
      this.transportConnect();
    };
    if (this.getSession(`phx:fallback:${fallbackTransportName}`)) {
      return fallback("memorized");
    }
    this.fallbackTimer = setTimeout(fallback, fallbackThreshold);
    errorRef = this.onError((reason) => {
      this.log("transport", "error", reason);
      if (primaryTransport && !established) {
        clearTimeout(this.fallbackTimer);
        fallback(reason);
      }
    });
    if (this.fallbackRef) {
      this.off([this.fallbackRef]);
    }
    this.fallbackRef = this.onOpen(() => {
      established = true;
      if (!primaryTransport) {
        let fallbackTransportName2 = this.transportName(fallbackTransport);
        if (!this.primaryPassedHealthCheck) {
          this.storeSession(`phx:fallback:${fallbackTransportName2}`, "true");
        }
        return this.log("transport", `established ${fallbackTransportName2} fallback`);
      }
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(fallback, fallbackThreshold);
      this.ping((rtt) => {
        this.log("transport", "connected to primary after", rtt);
        this.primaryPassedHealthCheck = true;
        clearTimeout(this.fallbackTimer);
      });
    });
    this.transportConnect();
  }
  clearHeartbeats() {
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimeoutTimer);
  }
  onConnOpen() {
    if (this.hasLogger()) this.log("transport", `connected to ${this.endPointURL()}`);
    this.closeWasClean = false;
    this.disconnecting = false;
    this.establishedConnections++;
    this.flushSendBuffer();
    this.reconnectTimer.reset();
    if (this.autoSendHeartbeat) {
      this.resetHeartbeat();
    }
    this.triggerStateCallbacks("open");
  }
  /**
   * @private
   */
  heartbeatTimeout() {
    if (this.pendingHeartbeatRef) {
      this.pendingHeartbeatRef = null;
      this.heartbeatSentAt = null;
      if (this.hasLogger()) {
        this.log("transport", "heartbeat timeout. Attempting to re-establish connection");
      }
      try {
        this.heartbeatCallback("timeout");
      } catch (e) {
        this.log("error", "error in heartbeat callback", e);
      }
      this.triggerChanError(new Error("heartbeat timeout"));
      this.closeWasClean = false;
      this.teardown(() => this.reconnectTimer.scheduleTimeout(), WS_CLOSE_NORMAL, "heartbeat timeout");
    }
  }
  resetHeartbeat() {
    if (this.conn && this.conn.skipHeartbeat) {
      return;
    }
    this.pendingHeartbeatRef = null;
    this.clearHeartbeats();
    this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), this.heartbeatIntervalMs);
  }
  teardown(callback, code, reason) {
    if (!this.conn) {
      return callback && callback();
    }
    const connToClose = this.conn;
    this.waitForBufferDone(connToClose, () => {
      if (code) {
        connToClose.close(code, reason || "");
      } else {
        connToClose.close();
      }
      this.waitForSocketClosed(connToClose, () => {
        if (this.conn === connToClose) {
          this.conn.onopen = function() {
          };
          this.conn.onerror = function() {
          };
          this.conn.onmessage = function() {
          };
          this.conn.onclose = function() {
          };
          this.conn = null;
        }
        callback && callback();
      });
    });
  }
  waitForBufferDone(conn, callback, tries = 1) {
    if (tries === 5 || !conn.bufferedAmount) {
      callback();
      return;
    }
    setTimeout(() => {
      this.waitForBufferDone(conn, callback, tries + 1);
    }, 150 * tries);
  }
  waitForSocketClosed(conn, callback, tries = 1) {
    if (tries === 5 || conn.readyState === SOCKET_STATES.closed) {
      callback();
      return;
    }
    setTimeout(() => {
      this.waitForSocketClosed(conn, callback, tries + 1);
    }, 150 * tries);
  }
  /**
  * @param {CloseEvent} event
  */
  onConnClose(event) {
    if (this.conn) this.conn.onclose = () => {
    };
    if (this.hasLogger()) this.log("transport", "close", event);
    this.triggerChanError(event);
    this.clearHeartbeats();
    if (!this.closeWasClean) {
      this.reconnectTimer.scheduleTimeout();
    }
    this.triggerStateCallbacks("close", event);
  }
  /**
   * @private
   * @param {Event} error
   */
  onConnError(error) {
    if (this.hasLogger()) this.log("transport", "error", error);
    let transportBefore = this.transport;
    let establishedBefore = this.establishedConnections;
    this.triggerStateCallbacks("error", error, transportBefore, establishedBefore);
    if (transportBefore === this.transport || establishedBefore > 0) {
      this.triggerChanError(error);
    }
  }
  /**
   * @private
   * @param {unknown} [reason] underlying close/error event forwarded to channel error listeners
   */
  triggerChanError(reason) {
    this.channels.forEach((channel2) => {
      if (!(channel2.isErrored() || channel2.isLeaving() || channel2.isClosed())) {
        channel2.trigger(CHANNEL_EVENTS2.error, reason);
      }
    });
  }
  /**
   * @returns {string}
   */
  connectionState() {
    switch (this.conn && this.conn.readyState) {
      case SOCKET_STATES.connecting:
        return "connecting";
      case SOCKET_STATES.open:
        return "open";
      case SOCKET_STATES.closing:
        return "closing";
      default:
        return "closed";
    }
  }
  /**
   * @returns {boolean}
   */
  isConnected() {
    return this.connectionState() === "open";
  }
  /**
   *
   * @param {Channel} channel
   */
  remove(channel2) {
    this.off(channel2.stateChangeRefs);
    this.channels = this.channels.filter((c) => c !== channel2);
  }
  /**
   * Removes `onOpen`, `onClose`, `onError,` and `onMessage` registrations.
   *
   * @param {string[]} refs - list of refs returned by calls to
   *                 `onOpen`, `onClose`, `onError,` and `onMessage`
   */
  off(refs) {
    for (let key in this.stateChangeCallbacks) {
      this.stateChangeCallbacks[key] = this.stateChangeCallbacks[key].filter(([ref]) => {
        return refs.indexOf(ref) === -1;
      });
    }
  }
  /**
   * Initiates a new channel for the given topic
   *
   * @param {string} topic
   * @param {Params | (() => Params)} [chanParams]- Parameters for the channel
   * @returns {Channel}
   */
  channel(topic, chanParams = {}) {
    let chan = new Channel(topic, chanParams, this);
    this.channels.push(chan);
    return chan;
  }
  /**
   * @param {Message<Record<string, any>>} data
   */
  push(data) {
    if (this.hasLogger()) {
      let { topic, event, payload, ref, join_ref } = data;
      this.log("push", `${topic} ${event} (${join_ref}, ${ref})`, payload);
    }
    if (this.isConnected()) {
      this.encode(data, (result) => this.conn.send(result));
    } else {
      this.sendBuffer.push(() => this.encode(data, (result) => this.conn.send(result)));
    }
  }
  /**
   * Return the next message ref, accounting for overflows
   * @returns {string}
   */
  makeRef() {
    let newRef = this.ref + 1;
    if (newRef === this.ref) {
      this.ref = 0;
    } else {
      this.ref = newRef;
    }
    return this.ref.toString();
  }
  sendHeartbeat() {
    if (!this.isConnected()) {
      try {
        this.heartbeatCallback("disconnected");
      } catch (e) {
        this.log("error", "error in heartbeat callback", e);
      }
      return;
    }
    if (this.pendingHeartbeatRef) {
      this.heartbeatTimeout();
      return;
    }
    this.pendingHeartbeatRef = this.makeRef();
    this.heartbeatSentAt = Date.now();
    this.push({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.pendingHeartbeatRef });
    try {
      this.heartbeatCallback("sent");
    } catch (e) {
      this.log("error", "error in heartbeat callback", e);
    }
    this.heartbeatTimeoutTimer = setTimeout(() => this.heartbeatTimeout(), this.heartbeatIntervalMs);
  }
  flushSendBuffer() {
    if (this.isConnected() && this.sendBuffer.length > 0) {
      this.sendBuffer.forEach((callback) => callback());
      this.sendBuffer = [];
    }
  }
  /**
  * @param {MessageEvent<any>} rawMessage
  */
  onConnMessage(rawMessage) {
    this.decode(rawMessage.data, (msg) => {
      let { topic, event, payload, ref, join_ref } = msg;
      if (ref && ref === this.pendingHeartbeatRef) {
        const latency = this.heartbeatSentAt ? Date.now() - this.heartbeatSentAt : void 0;
        this.clearHeartbeats();
        try {
          this.heartbeatCallback(payload.status === "ok" ? "ok" : "error", latency);
        } catch (e) {
          this.log("error", "error in heartbeat callback", e);
        }
        this.pendingHeartbeatRef = null;
        this.heartbeatSentAt = null;
        if (this.autoSendHeartbeat) {
          this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), this.heartbeatIntervalMs);
        }
      }
      if (this.hasLogger()) this.log("receive", `${payload.status || ""} ${topic} ${event} ${ref && "(" + ref + ")" || ""}`.trim(), payload);
      for (let i = 0; i < this.channels.length; i++) {
        const channel2 = this.channels[i];
        if (!channel2.isMember(topic, event, payload, join_ref)) {
          continue;
        }
        channel2.trigger(event, payload, ref, join_ref);
      }
      this.triggerStateCallbacks("message", msg);
    });
  }
  /**
   * @private
   * @template {keyof SocketStateChangeCallbacks} K
   * @param {K} event
   * @param {...Parameters<SocketStateChangeCallbacks[K][number][1]>} args
   * @returns {void}
   */
  triggerStateCallbacks(event, ...args) {
    try {
      this.stateChangeCallbacks[event].forEach(([_, callback]) => {
        try {
          callback(...args);
        } catch (e) {
          this.log("error", `error in ${event} callback`, e);
        }
      });
    } catch (e) {
      this.log("error", `error triggering ${event} callbacks`, e);
    }
  }
  leaveOpenTopic(topic) {
    let dupChannel = this.channels.find((c) => c.topic === topic && (c.isJoined() || c.isJoining()));
    if (dupChannel) {
      if (this.hasLogger()) this.log("transport", `leaving duplicate topic "${topic}"`);
      dupChannel.leave();
    }
  }
};

// node_modules/@supabase/realtime-js/dist/module/phoenix/presenceAdapter.js
var PresenceAdapter = class _PresenceAdapter {
  constructor(channel2, opts) {
    const phoenixOptions = phoenixPresenceOptions(opts);
    this.presence = new Presence(channel2.getChannel(), phoenixOptions);
    this.presence.onJoin((key, currentPresence, newPresence) => {
      const onJoinPayload = _PresenceAdapter.onJoinPayload(key, currentPresence, newPresence);
      channel2.getChannel().trigger("presence", onJoinPayload);
    });
    this.presence.onLeave((key, currentPresence, leftPresence) => {
      const onLeavePayload = _PresenceAdapter.onLeavePayload(key, currentPresence, leftPresence);
      channel2.getChannel().trigger("presence", onLeavePayload);
    });
    this.presence.onSync(() => {
      channel2.getChannel().trigger("presence", { event: "sync" });
    });
  }
  get state() {
    return _PresenceAdapter.transformState(this.presence.state);
  }
  /**
   * @private
   * Remove 'metas' key
   * Change 'phx_ref' to 'presence_ref'
   * Remove 'phx_ref' and 'phx_ref_prev'
   *
   * @example Transform state
   * // returns {
   *  abc123: [
   *    { presence_ref: '2', user_id: 1 },
   *    { presence_ref: '3', user_id: 2 }
   *  ]
   * }
   * RealtimePresence.transformState({
   *  abc123: {
   *    metas: [
   *      { phx_ref: '2', phx_ref_prev: '1' user_id: 1 },
   *      { phx_ref: '3', user_id: 2 }
   *    ]
   *  }
   * })
   *
   */
  static transformState(state) {
    state = cloneState(state);
    return Object.getOwnPropertyNames(state).reduce((newState, key) => {
      const presences = state[key];
      newState[key] = transformState(presences);
      return newState;
    }, {});
  }
  static onJoinPayload(key, currentPresence, newPresence) {
    const currentPresences = parseCurrentPresences(currentPresence);
    const newPresences = transformState(newPresence);
    return {
      event: "join",
      key,
      currentPresences,
      newPresences
    };
  }
  static onLeavePayload(key, currentPresence, leftPresence) {
    const currentPresences = parseCurrentPresences(currentPresence);
    const leftPresences = transformState(leftPresence);
    return {
      event: "leave",
      key,
      currentPresences,
      leftPresences
    };
  }
};
function transformState(presences) {
  return presences.metas.map((presence) => {
    const descriptors = Object.getOwnPropertyDescriptors(presence);
    const transformedPresence = Object.defineProperties({}, descriptors);
    transformedPresence["presence_ref"] = transformedPresence["phx_ref"];
    delete transformedPresence["phx_ref"];
    delete transformedPresence["phx_ref_prev"];
    return transformedPresence;
  });
}
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
function phoenixPresenceOptions(opts) {
  return (opts === null || opts === void 0 ? void 0 : opts.events) && { events: opts.events };
}
function parseCurrentPresences(currentPresences) {
  return (currentPresences === null || currentPresences === void 0 ? void 0 : currentPresences.metas) ? transformState(currentPresences) : [];
}

// node_modules/@supabase/realtime-js/dist/module/RealtimePresence.js
var REALTIME_PRESENCE_LISTEN_EVENTS;
(function(REALTIME_PRESENCE_LISTEN_EVENTS2) {
  REALTIME_PRESENCE_LISTEN_EVENTS2["SYNC"] = "sync";
  REALTIME_PRESENCE_LISTEN_EVENTS2["JOIN"] = "join";
  REALTIME_PRESENCE_LISTEN_EVENTS2["LEAVE"] = "leave";
})(REALTIME_PRESENCE_LISTEN_EVENTS || (REALTIME_PRESENCE_LISTEN_EVENTS = {}));
var RealtimePresence = class {
  get state() {
    return this.presenceAdapter.state;
  }
  /**
   * Creates a Presence helper that keeps the local presence state in sync with the server.
   *
   * @param channel - The realtime channel to bind to.
   * @param opts - Optional custom event names, e.g. `{ events: { state: 'state', diff: 'diff' } }`.
   *
   * @category Realtime
   *
   * @example Example for a presence channel
   * ```ts
   * const presence = new RealtimePresence(channel)
   *
   * channel.on('presence', ({ event, key }) => {
   *   console.log(`Presence ${event} on ${key}`)
   * })
   * ```
   */
  constructor(channel2, opts) {
    this.channel = channel2;
    this.presenceAdapter = new PresenceAdapter(this.channel.channelAdapter, opts);
  }
};

// node_modules/@supabase/realtime-js/dist/module/lib/normalizeChannelError.js
function normalizeChannelError(reason) {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string") {
    return new Error(reason);
  }
  if (reason && typeof reason === "object") {
    const obj = reason;
    if (typeof obj.code === "number") {
      const detail = typeof obj.reason === "string" && obj.reason ? ` (${obj.reason})` : "";
      return new Error(`socket closed: ${obj.code}${detail}`, { cause: reason });
    }
    return new Error("channel error: transport failure", { cause: reason });
  }
  return new Error("channel error: connection lost");
}

// node_modules/@supabase/realtime-js/dist/module/phoenix/channelAdapter.js
var ChannelAdapter = class {
  constructor(socket, topic, params) {
    const phoenixParams = phoenixChannelParams(params);
    this.channel = socket.getSocket().channel(topic, phoenixParams);
    this.socket = socket;
  }
  get state() {
    return this.channel.state;
  }
  set state(state) {
    this.channel.state = state;
  }
  get joinedOnce() {
    return this.channel.joinedOnce;
  }
  get joinPush() {
    return this.channel.joinPush;
  }
  get rejoinTimer() {
    return this.channel.rejoinTimer;
  }
  on(event, callback) {
    return this.channel.on(event, callback);
  }
  off(event, refNumber) {
    this.channel.off(event, refNumber);
  }
  subscribe(timeout) {
    return this.channel.join(timeout);
  }
  unsubscribe(timeout) {
    return this.channel.leave(timeout);
  }
  teardown() {
    this.channel.teardown();
  }
  onClose(callback) {
    this.channel.onClose(callback);
  }
  onError(callback) {
    return this.channel.onError(callback);
  }
  push(event, payload, timeout) {
    let push;
    try {
      push = this.channel.push(event, payload, timeout);
    } catch (error) {
      throw new Error(`tried to push '${event}' to '${this.channel.topic}' before joining. Use channel.subscribe() before pushing events`);
    }
    if (this.channel.pushBuffer.length > MAX_PUSH_BUFFER_SIZE) {
      const removedPush = this.channel.pushBuffer.shift();
      removedPush.cancelTimeout();
      this.socket.log("channel", `discarded push due to buffer overflow: ${removedPush.event}`, removedPush.payload());
    }
    return push;
  }
  updateJoinPayload(payload) {
    const oldPayload = this.channel.joinPush.payload();
    this.channel.joinPush.payload = () => Object.assign(Object.assign({}, oldPayload), payload);
  }
  canPush() {
    return this.socket.isConnected() && this.state === CHANNEL_STATES.joined;
  }
  isJoined() {
    return this.state === CHANNEL_STATES.joined;
  }
  isJoining() {
    return this.state === CHANNEL_STATES.joining;
  }
  isClosed() {
    return this.state === CHANNEL_STATES.closed;
  }
  isLeaving() {
    return this.state === CHANNEL_STATES.leaving;
  }
  updateFilterBindings(filterBindings) {
    this.channel.filterBindings = filterBindings;
  }
  updatePayloadTransform(callback) {
    this.channel.onMessage = callback;
  }
  /**
   * @internal
   */
  getChannel() {
    return this.channel;
  }
};
function phoenixChannelParams(options) {
  return {
    config: Object.assign({
      broadcast: { ack: false, self: false },
      presence: { key: "", enabled: false },
      private: false
    }, options.config)
  };
}

// node_modules/@supabase/realtime-js/dist/module/RealtimePostgresFilterBuilder.js
var PostgrestReservedCharsRegexp = /[,()"\\]/;
var needsQuoting = (value) => PostgrestReservedCharsRegexp.test(value) || value !== value.trim();
var quote = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
var serializeScalar = (value) => {
  const serialized = value === null ? "null" : String(value);
  return needsQuoting(serialized) ? quote(serialized) : serialized;
};
var serializeIsValue = (value) => value === null ? "null" : String(value);
var serialize = (operator, value) => {
  if (operator === "in") {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) {
      throw new Error("Realtime `in` filter requires at least one value.");
    }
    const items = Array.from(new Set(values)).map((v) => serializeScalar(v)).join(",");
    return `in.(${items})`;
  }
  if (operator === "is") {
    return `is.${serializeIsValue(value)}`;
  }
  return `${operator}.${serializeScalar(value)}`;
};
var RealtimePostgresFilterBuilder = class {
  constructor() {
    this.filters = [];
  }
  add(column, operator, value, negate = false) {
    const prefix = negate ? "not." : "";
    this.filters.push(`${column}=${prefix}${serialize(operator, value)}`);
    return this;
  }
  /** Match rows where `column` equals `value` (`column=eq.value`). */
  eq(column, value) {
    return this.add(column, "eq", value);
  }
  /** Match rows where `column` does not equal `value` (`column=neq.value`). */
  neq(column, value) {
    return this.add(column, "neq", value);
  }
  /** Match rows where `column` is greater than `value` (`column=gt.value`). */
  gt(column, value) {
    return this.add(column, "gt", value);
  }
  /** Match rows where `column` is greater than or equal to `value` (`column=gte.value`). */
  gte(column, value) {
    return this.add(column, "gte", value);
  }
  /** Match rows where `column` is less than `value` (`column=lt.value`). */
  lt(column, value) {
    return this.add(column, "lt", value);
  }
  /** Match rows where `column` is less than or equal to `value` (`column=lte.value`). */
  lte(column, value) {
    return this.add(column, "lte", value);
  }
  /**
   * Match rows where `column` is one of `values` (`column=in.(a,b,c)`).
   * Requires at least one value; duplicates are removed. An element containing a
   * reserved character is double-quoted (`in.("a,b",c)`), so commas inside an
   * element are preserved. `null` is intentionally not accepted (`IN (null)`
   * never matches in SQL) — use `is`/`not('col','is',null)` for null checks.
   */
  in(column, values) {
    return this.add(column, "in", values);
  }
  /** Match rows where `column` matches the case-sensitive `pattern` (`column=like.pattern`). */
  like(column, pattern) {
    return this.add(column, "like", pattern);
  }
  /** Match rows where `column` matches the case-insensitive `pattern` (`column=ilike.pattern`). */
  ilike(column, pattern) {
    return this.add(column, "ilike", pattern);
  }
  /** Match rows where `column` matches the POSIX regex `pattern` (`column=match.pattern`). */
  match(column, pattern) {
    return this.add(column, "match", pattern);
  }
  /** Match rows where `column` matches the case-insensitive POSIX regex `pattern` (`column=imatch.pattern`). */
  imatch(column, pattern) {
    return this.add(column, "imatch", pattern);
  }
  /**
   * Match rows where `column` `IS` the given value (`column=is.null`).
   * Accepts `null`, a boolean, or the keywords `'null' | 'true' | 'false' | 'unknown'`.
   */
  is(column, value) {
    return this.add(column, "is", value);
  }
  /** Match rows where `column` is distinct from `value` (`column=isdistinct.value`). NULL-safe inequality. */
  isDistinct(column, value) {
    return this.add(column, "isdistinct", value);
  }
  not(column, operator, value) {
    return this.add(column, operator, value, true);
  }
  /**
   * Serialize all conditions into the comma-separated (AND) filter string.
   *
   * Conditions are joined by commas, which the server applies as `AND`. A scalar
   * value (or single `in` element) that contains a reserved character — `,`,
   * `(`, `)`, `"`, `\` — or surrounding whitespace is double-quoted and escaped
   * the way PostgREST does, so commas inside a value are preserved rather than
   * read as a condition boundary.
   */
  build() {
    return this.filters.join(",");
  }
  /** Alias for {@link build}; lets the builder be used wherever a string is expected. */
  toString() {
    return this.build();
  }
};

// node_modules/@supabase/realtime-js/dist/module/RealtimeChannel.js
var REALTIME_POSTGRES_CHANGES_LISTEN_EVENT;
(function(REALTIME_POSTGRES_CHANGES_LISTEN_EVENT2) {
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT2["ALL"] = "*";
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT2["INSERT"] = "INSERT";
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT2["UPDATE"] = "UPDATE";
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT2["DELETE"] = "DELETE";
})(REALTIME_POSTGRES_CHANGES_LISTEN_EVENT || (REALTIME_POSTGRES_CHANGES_LISTEN_EVENT = {}));
var REALTIME_LISTEN_TYPES;
(function(REALTIME_LISTEN_TYPES2) {
  REALTIME_LISTEN_TYPES2["BROADCAST"] = "broadcast";
  REALTIME_LISTEN_TYPES2["PRESENCE"] = "presence";
  REALTIME_LISTEN_TYPES2["POSTGRES_CHANGES"] = "postgres_changes";
  REALTIME_LISTEN_TYPES2["SYSTEM"] = "system";
})(REALTIME_LISTEN_TYPES || (REALTIME_LISTEN_TYPES = {}));
var REALTIME_SUBSCRIBE_STATES;
(function(REALTIME_SUBSCRIBE_STATES2) {
  REALTIME_SUBSCRIBE_STATES2["SUBSCRIBED"] = "SUBSCRIBED";
  REALTIME_SUBSCRIBE_STATES2["TIMED_OUT"] = "TIMED_OUT";
  REALTIME_SUBSCRIBE_STATES2["CLOSED"] = "CLOSED";
  REALTIME_SUBSCRIBE_STATES2["CHANNEL_ERROR"] = "CHANNEL_ERROR";
})(REALTIME_SUBSCRIBE_STATES || (REALTIME_SUBSCRIBE_STATES = {}));
var RealtimeChannel = class _RealtimeChannel {
  get state() {
    return this.channelAdapter.state;
  }
  set state(state) {
    this.channelAdapter.state = state;
  }
  get joinedOnce() {
    return this.channelAdapter.joinedOnce;
  }
  get timeout() {
    return this.socket.timeout;
  }
  get joinPush() {
    return this.channelAdapter.joinPush;
  }
  get rejoinTimer() {
    return this.channelAdapter.rejoinTimer;
  }
  /**
   * Creates a channel that can broadcast messages, sync presence, and listen to Postgres changes.
   *
   * The topic determines which realtime stream you are subscribing to. Config options let you
   * enable acknowledgement for broadcasts, presence tracking, or private channels.
   *
   * @category Realtime
   *
   * @example Using supabase-js (recommended)
   * ```ts
   * import { createClient } from '@supabase/supabase-js'
   *
   * const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
   * const channel = supabase.channel('room1')
   * channel
   *   .on('broadcast', { event: 'cursor-pos' }, (payload) => console.log(payload))
   *   .subscribe()
   * ```
   *
   * @example Standalone import for bundle-sensitive environments
   * ```ts
   * import RealtimeClient from '@supabase/realtime-js'
   *
   * const client = new RealtimeClient('https://xyzcompany.supabase.co/realtime/v1', {
   *   params: { apikey: 'your-publishable-key' },
   * })
   * const channel = new RealtimeChannel('realtime:public:messages', { config: {} }, client)
   * ```
   */
  constructor(topic, params = { config: {} }, socket) {
    var _a, _b;
    this.topic = topic;
    this.params = params;
    this.socket = socket;
    this.bindings = {};
    this.subTopic = topic.replace(/^realtime:/i, "");
    this.params.config = Object.assign({
      broadcast: { ack: false, self: false },
      presence: { key: "", enabled: false },
      private: false
    }, params.config);
    this.channelAdapter = new ChannelAdapter(this.socket.socketAdapter, topic, this.params);
    this.presence = new RealtimePresence(this);
    this._onClose(() => {
      this.socket._remove(this);
    });
    this._updateFilterTransform();
    this.broadcastEndpointURL = httpEndpointURL(this.socket.socketAdapter.endPointURL());
    this.private = this.params.config.private || false;
    if (!this.private && ((_b = (_a = this.params.config) === null || _a === void 0 ? void 0 : _a.broadcast) === null || _b === void 0 ? void 0 : _b.replay)) {
      throw new Error(`tried to use replay on public channel '${this.topic}'. It must be a private channel.`);
    }
  }
  /**
   * Subscribe registers your client with the server.
   *
   * The optional `callback` receives a `status` and, on failure, an `err` argument.
   * Log the full `err` so its `cause`, `name`, and any structured fields aren't hidden
   * behind `err.message`.
   *
   * @category Realtime
   *
   * @example Handling errors
   * ```js
   * supabase.channel('room1').subscribe((status, err) => {
   *   if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
   *     // Log the full error: its `cause` often holds the underlying reason.
   *     console.error(status, err)
   *   }
   * })
   * ```
   */
  subscribe(callback, timeout = this.timeout) {
    var _a, _b, _c, _d;
    if (!this.socket.isConnected()) {
      this.socket.connect();
    }
    if (this.channelAdapter.isClosed()) {
      const { config: { broadcast, presence, private: isPrivate, postgres_changes_options } } = this.params;
      const postgres_changes = (_b = (_a = this.bindings.postgres_changes) === null || _a === void 0 ? void 0 : _a.map((r) => r.filter)) !== null && _b !== void 0 ? _b : [];
      const presence_enabled = !!this.bindings[REALTIME_LISTEN_TYPES.PRESENCE] && this.bindings[REALTIME_LISTEN_TYPES.PRESENCE].length > 0 || ((_c = this.params.config.presence) === null || _c === void 0 ? void 0 : _c.enabled) === true;
      const accessTokenPayload = {};
      const config = Object.assign({ broadcast, presence: Object.assign(Object.assign({}, presence), { enabled: presence_enabled }), postgres_changes, private: isPrivate }, postgres_changes_options ? { postgres_changes_options } : {});
      if (this.socket.accessTokenValue) {
        accessTokenPayload.access_token = this.socket.accessTokenValue;
      }
      this._onError((reason) => {
        callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, normalizeChannelError(reason));
      });
      this._onClose(() => callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.CLOSED));
      this.updateJoinPayload(Object.assign({ config }, accessTokenPayload));
      this._updateFilterMessage();
      const joinTimeout = (postgres_changes_options === null || postgres_changes_options === void 0 ? void 0 : postgres_changes_options.wait) && postgres_changes.length > 0 ? Math.max(timeout, ((_d = postgres_changes_options.timeout) !== null && _d !== void 0 ? _d : DEFAULT_POSTGRES_CHANGES_WAIT_TIMEOUT) + POSTGRES_CHANGES_WAIT_ERROR_GRACE) : timeout;
      this.channelAdapter.subscribe(joinTimeout).receive("ok", async ({ postgres_changes: postgres_changes2 }) => {
        if (!this.socket._isManualToken()) {
          this.socket.setAuth();
        }
        if (postgres_changes2 === void 0) {
          callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
          return;
        }
        this._updatePostgresBindings(postgres_changes2, callback);
      }).receive("error", (error) => {
        this.state = CHANNEL_STATES.errored;
        const message = Object.values(error).join(", ") || "error";
        callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error(message, { cause: error }));
      }).receive("timeout", () => {
        callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.TIMED_OUT);
      });
    }
    return this;
  }
  _updatePostgresBindings(postgres_changes, callback) {
    var _a;
    const clientPostgresBindings = this.bindings.postgres_changes;
    const bindingsLen = (_a = clientPostgresBindings === null || clientPostgresBindings === void 0 ? void 0 : clientPostgresBindings.length) !== null && _a !== void 0 ? _a : 0;
    const newPostgresBindings = [];
    for (let i = 0; i < bindingsLen; i++) {
      const clientPostgresBinding = clientPostgresBindings[i];
      const { filter: { event, schema, table, filter } } = clientPostgresBinding;
      const serverPostgresFilter = postgres_changes && postgres_changes[i];
      if (serverPostgresFilter && serverPostgresFilter.event === event && _RealtimeChannel.isFilterValueEqual(serverPostgresFilter.schema, schema) && _RealtimeChannel.isFilterValueEqual(serverPostgresFilter.table, table) && _RealtimeChannel.isFilterValueEqual(serverPostgresFilter.filter, filter)) {
        newPostgresBindings.push(Object.assign(Object.assign({}, clientPostgresBinding), { id: serverPostgresFilter.id }));
      } else {
        this.unsubscribe();
        this.state = CHANNEL_STATES.errored;
        callback === null || callback === void 0 ? void 0 : callback(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error("mismatch between server and client bindings for postgres changes"));
        return;
      }
    }
    this.bindings.postgres_changes = newPostgresBindings;
    if (this.state != CHANNEL_STATES.errored && callback) {
      callback(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    }
  }
  /**
   * Returns the current presence state for this channel.
   *
   * The shape is a map keyed by presence key (for example a user id) where each entry contains the
   * tracked metadata for that user.
   *
   * @category Realtime
   */
  presenceState() {
    return this.presence.state;
  }
  /**
   * Sends the supplied payload to the presence tracker so other subscribers can see that this
   * client is online. Use `untrack` to stop broadcasting presence for the same key.
   *
   * Tracking makes this client visible to other subscribers immediately, regardless of this
   * channel's `config.presence.enabled` setting or whether it has a `presence` listener — that
   * flag only affects whether *this* client receives presence updates from others (and, on
   * RLS-protected channels, whether it's authorized to do so).
   *
   * @category Realtime
   */
  async track(payload, opts = {}) {
    return await this.send({
      type: "presence",
      event: "track",
      payload
    }, opts);
  }
  /**
   * Removes the current presence state for this client.
   *
   * @category Realtime
   */
  async untrack(opts = {}) {
    return await this.send({
      type: "presence",
      event: "untrack"
    }, opts);
  }
  /**
   * Listen to realtime events on this channel.
   * @category Realtime
   *
   * @remarks
   * - By default, Broadcast and Presence are enabled for all projects.
   * - By default, listening to database changes is disabled for new projects due to database performance and security concerns. You can turn it on by managing Realtime's [replication](/docs/guides/api#realtime-api-overview).
   * - You can receive the "previous" data for updates and deletes by setting the table's `REPLICA IDENTITY` to `FULL` (e.g., `ALTER TABLE your_table REPLICA IDENTITY FULL;`).
   * - Row level security is not applied to delete statements. When RLS is enabled and replica identity is set to full, only the primary key is sent to clients.
   *
   * @example Listen to broadcast messages
   * ```js
   * const channel = supabase.channel("room1")
   *
   * channel.on("broadcast", { event: "cursor-pos" }, (payload) => {
   *   console.log("Cursor position received!", payload);
   * }).subscribe((status) => {
   *   if (status === "SUBSCRIBED") {
   *     channel.send({
   *       type: "broadcast",
   *       event: "cursor-pos",
   *       payload: { x: Math.random(), y: Math.random() },
   *     });
   *   }
   * });
   * ```
   *
   * @example Listen to presence sync
   * ```js
   * const channel = supabase.channel('room1')
   * channel
   *   .on('presence', { event: 'sync' }, () => {
   *     console.log('Synced presence state: ', channel.presenceState())
   *   })
   *   .subscribe(async (status) => {
   *     if (status === 'SUBSCRIBED') {
   *       await channel.track({ online_at: new Date().toISOString() })
   *     }
   *   })
   * ```
   *
   * @example Listen to presence join
   * ```js
   * const channel = supabase.channel('room1')
   * channel
   *   .on('presence', { event: 'join' }, ({ newPresences }) => {
   *     console.log('Newly joined presences: ', newPresences)
   *   })
   *   .subscribe(async (status) => {
   *     if (status === 'SUBSCRIBED') {
   *       await channel.track({ online_at: new Date().toISOString() })
   *     }
   *   })
   * ```
   *
   * @example Listen to presence leave
   * ```js
   * const channel = supabase.channel('room1')
   * channel
   *   .on('presence', { event: 'leave' }, ({ leftPresences }) => {
   *     console.log('Newly left presences: ', leftPresences)
   *   })
   *   .subscribe(async (status) => {
   *     if (status === 'SUBSCRIBED') {
   *       await channel.track({ online_at: new Date().toISOString() })
   *       await channel.untrack()
   *     }
   *   })
   * ```
   *
   * Registering the same `postgres_changes` filter more than once on a channel is a no-op: the
   * duplicate is ignored and an error is logged, since the server only ever creates one
   * subscription per distinct filter.
   *
   * @example Listen to all database changes
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: '*', schema: '*' }, payload => {
   *     console.log('Change received!', payload)
   *   })
   *   .subscribe()
   * ```
   *
   * @example Listen to a specific table
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: '*', schema: 'public', table: 'countries' }, payload => {
   *     console.log('Change received!', payload)
   *   })
   *   .subscribe()
   * ```
   *
   * @example Listen to inserts
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'countries' }, payload => {
   *     console.log('Change received!', payload)
   *   })
   *   .subscribe()
   * ```
   *
   * @exampleDescription Listen to updates
   * By default, Supabase will send only the updated record. If you want to receive the previous values as well you can
   * enable full replication for the table you are listening to:
   *
   * ```sql
   * alter table "your_table" replica identity full;
   * ```
   *
   * @example Listen to updates
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'countries' }, payload => {
   *     console.log('Change received!', payload)
   *   })
   *   .subscribe()
   * ```
   *
   * @exampleDescription Listen to deletes
   * By default, Supabase does not send deleted records. If you want to receive the deleted record you can
   * enable full replication for the table you are listening to:
   *
   * ```sql
   * alter table "your_table" replica identity full;
   * ```
   *
   * @example Listen to deletes
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'countries' }, payload => {
   *     console.log('Change received!', payload)
   *   })
   *   .subscribe()
   * ```
   *
   * @exampleDescription Listen to multiple events
   * You can chain listeners if you want to listen to multiple events for each table.
   *
   * @example Listen to multiple events
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'countries' }, handleRecordInserted)
   *   .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'countries' }, handleRecordDeleted)
   *   .subscribe()
   * ```
   *
   * @exampleDescription Listen to row level changes
   * You can listen to individual rows using the format `{table}:{col}=eq.{val}` - where `{col}` is the column name, and `{val}` is the value which you want to match.
   *
   * @example Listen to row level changes
   * ```js
   * supabase
   *   .channel('room1')
   *   .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'countries', filter: 'id=eq.200' }, handleRecordUpdated)
   *   .subscribe()
   * ```
   */
  on(type, filter, callback) {
    const stateCheck = this.channelAdapter.isJoined() || this.channelAdapter.isJoining();
    const typeCheck = type === REALTIME_LISTEN_TYPES.PRESENCE || type === REALTIME_LISTEN_TYPES.POSTGRES_CHANGES;
    if (stateCheck && typeCheck) {
      this.socket.log("channel", `cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
      throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
    }
    return this._on(type, filter, callback);
  }
  /**
   * Sends a broadcast message explicitly via REST API.
   *
   * This method always uses the REST API endpoint regardless of WebSocket connection state.
   * Useful when you want to guarantee REST delivery or when gradually migrating from implicit REST fallback.
   *
   * Payloads that are `ArrayBuffer` or `ArrayBufferView` (e.g. `Uint8Array`) are sent as
   * `application/octet-stream`; all other payloads are JSON-encoded.
   *
   * @param event The name of the broadcast event
   * @param payload Payload to be sent (required)
   * @param opts Options including timeout
   * @returns Promise resolving to object with success status, and error details if failed
   *
   * @category Realtime
   */
  async httpSend(event, payload, opts = {}) {
    var _a;
    if (payload === void 0 || payload === null) {
      return Promise.reject(new Error("Payload is required for httpSend()"));
    }
    const isBinary = payload instanceof ArrayBuffer || ArrayBuffer.isView(payload);
    const headers = {
      apikey: this.socket.apiKey ? this.socket.apiKey : "",
      "Content-Type": isBinary ? "application/octet-stream" : "application/json"
    };
    if (this.socket.accessTokenValue) {
      headers["Authorization"] = `Bearer ${this.socket.accessTokenValue}`;
    }
    const url = new URL(this.broadcastEndpointURL);
    url.pathname += `/${encodeURIComponent(this.subTopic)}/events/${encodeURIComponent(event)}`;
    if (this.private) {
      url.searchParams.set("private", "true");
    }
    const options = {
      method: "POST",
      headers,
      body: isBinary ? payload : JSON.stringify(payload)
    };
    const response = await this._fetchWithTimeout(url.toString(), options, (_a = opts.timeout) !== null && _a !== void 0 ? _a : this.timeout);
    if (response.status === 202) {
      return { success: true };
    }
    if (response.status === 404) {
      return Promise.reject(new Error("httpSend() requires Realtime server v2.97.0 or newer; the endpoint returned 404. Update your Supabase CLI to a recent version, or upgrade the Realtime server in your self-hosted setup. See https://github.com/supabase/supabase-js/blob/master/packages/core/realtime-js/migrations/httpsend-server-version.md"));
    }
    let errorMessage = response.statusText;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorBody.message || errorMessage;
    } catch (_b) {
    }
    return Promise.reject(new Error(errorMessage));
  }
  /**
   * Sends a message into the channel.
   *
   * @param args Arguments to send to channel
   * @param args.type The type of event to send
   * @param args.event The name of the event being sent
   * @param args.payload Payload to be sent
   * @param opts Options to be used during the send process
   *
   * @category Realtime
   *
   * @remarks
   * - When using REST you don't need to subscribe to the channel
   * - REST calls are only available from 2.37.0 onwards
   * - If you create a channel only to send a REST broadcast, remove it from
   *   the client when the send completes
   *
   * @example Send a message via websocket
   * ```js
   * const channel = supabase.channel('room1')
   *
   * channel.subscribe((status) => {
   *   if (status === 'SUBSCRIBED') {
   *     channel.send({
   *       type: 'broadcast',
   *       event: 'cursor-pos',
   *       payload: { x: Math.random(), y: Math.random() },
   *     })
   *   }
   * })
   * ```
   *
   * @exampleResponse Send a message via websocket
   * ```js
   * ok | timed out | error
   * ```
   *
   * @example Send a message via REST
   * ```js
   * const channel = supabase.channel('room1')
   *
   * try {
   *   await channel.httpSend('cursor-pos', { x: Math.random(), y: Math.random() })
   * } finally {
   *   await supabase.removeChannel(channel)
   * }
   * ```
   */
  async send(args, opts = {}) {
    var _a, _b;
    if (!this.channelAdapter.canPush() && args.type === "broadcast") {
      const fallbackWarning = "Realtime send() is automatically falling back to REST API. This behavior will be deprecated in the future. Please use httpSend() explicitly for REST delivery.";
      if (this.socket.hasLogger()) {
        this.socket.log("channel", fallbackWarning);
      } else {
        console.warn(fallbackWarning);
      }
      const { event, payload: endpoint_payload } = args;
      const headers = {
        apikey: this.socket.apiKey ? this.socket.apiKey : "",
        "Content-Type": "application/json"
      };
      if (this.socket.accessTokenValue) {
        headers["Authorization"] = `Bearer ${this.socket.accessTokenValue}`;
      }
      const options = {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [
            {
              topic: this.subTopic,
              event,
              payload: endpoint_payload,
              private: this.private
            }
          ]
        })
      };
      try {
        const response = await this._fetchWithTimeout(this.broadcastEndpointURL, options, (_a = opts.timeout) !== null && _a !== void 0 ? _a : this.timeout);
        await ((_b = response.body) === null || _b === void 0 ? void 0 : _b.cancel());
        return response.ok ? "ok" : "error";
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return "timed out";
        } else {
          return "error";
        }
      }
    } else {
      return new Promise((resolve) => {
        var _a2, _b2, _c;
        const push = this.channelAdapter.push(args.type, args, opts.timeout || this.timeout);
        if (args.type === "broadcast" && !((_c = (_b2 = (_a2 = this.params) === null || _a2 === void 0 ? void 0 : _a2.config) === null || _b2 === void 0 ? void 0 : _b2.broadcast) === null || _c === void 0 ? void 0 : _c.ack)) {
          resolve("ok");
        }
        push.receive("ok", () => resolve("ok"));
        push.receive("error", () => resolve("error"));
        push.receive("timeout", () => resolve("timed out"));
      });
    }
  }
  /**
   * Updates the payload that will be sent the next time the channel joins (reconnects).
   * Useful for rotating access tokens or updating config without re-creating the channel.
   *
   * @category Realtime
   */
  updateJoinPayload(payload) {
    this.channelAdapter.updateJoinPayload(payload);
  }
  /**
   * Leaves the channel.
   *
   * Unsubscribes from server events, and instructs channel to terminate on server.
   * Triggers onClose() hooks.
   *
   * To receive leave acknowledgements, use the a `receive` hook to bind to the server ack, ie:
   * channel.unsubscribe().receive("ok", () => alert("left!") )
   *
   * @category Realtime
   */
  async unsubscribe(timeout = this.timeout) {
    return new Promise((resolve) => {
      this.channelAdapter.unsubscribe(timeout).receive("ok", () => resolve("ok")).receive("timeout", () => resolve("timed out")).receive("error", () => resolve("error"));
    });
  }
  /**
   * Destroys and stops related timers.
   *
   * @category Realtime
   */
  teardown() {
    this.channelAdapter.teardown();
  }
  /** @internal */
  async _fetchWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await this.socket.fetch(url, Object.assign(Object.assign({}, options), { signal: controller.signal }));
    clearTimeout(id);
    return response;
  }
  /** @internal */
  _on(type, filter, callback) {
    var _a;
    const typeLower = type.toLocaleLowerCase();
    const filterValue = filter === null || filter === void 0 ? void 0 : filter.filter;
    if (filterValue instanceof RealtimePostgresFilterBuilder || typeof filterValue === "object" && filterValue !== null && typeof filterValue.build === "function") {
      filter = Object.assign(Object.assign({}, filter), { filter: filterValue.build() });
    }
    if (typeLower === REALTIME_LISTEN_TYPES.POSTGRES_CHANGES) {
      const duplicate = (_a = this.bindings[typeLower]) === null || _a === void 0 ? void 0 : _a.find((bind) => _RealtimeChannel.isSamePostgresFilter(bind.filter, filter));
      if (duplicate) {
        this.socket.log("error", `duplicate \`postgres_changes\` binding for ${this.topic} ignored`, filter);
        return this;
      }
    }
    const ref = this.channelAdapter.on(type, callback);
    const binding = {
      type: typeLower,
      filter,
      callback,
      ref
    };
    if (this.bindings[typeLower]) {
      this.bindings[typeLower].push(binding);
    } else {
      this.bindings[typeLower] = [binding];
    }
    this._updateFilterMessage();
    return this;
  }
  /**
   * Registers a callback that will be executed when the channel closes.
   *
   * @internal
   */
  _onClose(callback) {
    this.channelAdapter.onClose(callback);
  }
  /**
   * Registers a callback that will be executed when the channel encounteres an error.
   *
   * @internal
   */
  _onError(callback) {
    this.channelAdapter.onError(callback);
  }
  /** @internal */
  _updateFilterMessage() {
    this.channelAdapter.updateFilterBindings((binding, payload, ref) => {
      var _a, _b, _c, _d, _e, _f, _g;
      const typeLower = binding.event.toLocaleLowerCase();
      if (this._notThisChannelEvent(typeLower, ref)) {
        return false;
      }
      const bind = (_a = this.bindings[typeLower]) === null || _a === void 0 ? void 0 : _a.find((bind2) => bind2.ref === binding.ref);
      if (!bind) {
        return true;
      }
      if (["broadcast", "presence", "postgres_changes"].includes(typeLower)) {
        if ("id" in bind) {
          const bindId = bind.id;
          const bindEvent = (_b = bind.filter) === null || _b === void 0 ? void 0 : _b.event;
          return bindId && ((_c = payload.ids) === null || _c === void 0 ? void 0 : _c.includes(bindId)) && (bindEvent === "*" || (bindEvent === null || bindEvent === void 0 ? void 0 : bindEvent.toLocaleLowerCase()) === ((_d = payload.data) === null || _d === void 0 ? void 0 : _d.type.toLocaleLowerCase()));
        } else {
          const bindEvent = (_f = (_e = bind === null || bind === void 0 ? void 0 : bind.filter) === null || _e === void 0 ? void 0 : _e.event) === null || _f === void 0 ? void 0 : _f.toLocaleLowerCase();
          return bindEvent === "*" || bindEvent === ((_g = payload === null || payload === void 0 ? void 0 : payload.event) === null || _g === void 0 ? void 0 : _g.toLocaleLowerCase());
        }
      } else {
        return bind.type.toLocaleLowerCase() === typeLower;
      }
    });
  }
  /** @internal */
  _notThisChannelEvent(event, ref) {
    const { close, error, leave, join } = CHANNEL_EVENTS;
    const events = [close, error, leave, join];
    return ref && events.includes(event) && ref !== this.joinPush.ref;
  }
  /** @internal */
  _updateFilterTransform() {
    this.channelAdapter.updatePayloadTransform((event, payload, ref) => {
      if (typeof payload === "object" && "ids" in payload) {
        const postgresChanges = payload.data;
        const { schema, table, commit_timestamp, type, errors } = postgresChanges;
        const enrichedPayload = {
          schema,
          table,
          commit_timestamp,
          eventType: type,
          new: {},
          old: {},
          errors
        };
        return Object.assign(Object.assign({}, enrichedPayload), this._getPayloadRecords(postgresChanges));
      }
      return payload;
    });
  }
  copyBindings(other) {
    if (this.joinedOnce) {
      throw new Error("cannot copy bindings into joined channel");
    }
    for (const kind in other.bindings) {
      for (const binding of other.bindings[kind]) {
        this._on(binding.type, binding.filter, binding.callback);
      }
    }
  }
  /**
   * Compares two optional filter values for equality.
   * Treats undefined, null, and empty string as equivalent empty values.
   * @internal
   */
  static isFilterValueEqual(serverValue, clientValue) {
    const normalizedServer = serverValue !== null && serverValue !== void 0 ? serverValue : void 0;
    const normalizedClient = clientValue !== null && clientValue !== void 0 ? clientValue : void 0;
    return normalizedServer === normalizedClient;
  }
  /**
   * Two `postgres_changes` filters are the same when the server would collapse them into a single
   * subscription.
   * @internal
   */
  static isSamePostgresFilter(a, b) {
    var _a, _b, _c, _d;
    const selectA = (_b = (_a = a === null || a === void 0 ? void 0 : a.select) === null || _a === void 0 ? void 0 : _a.join()) !== null && _b !== void 0 ? _b : void 0;
    const selectB = (_d = (_c = b === null || b === void 0 ? void 0 : b.select) === null || _c === void 0 ? void 0 : _c.join()) !== null && _d !== void 0 ? _d : void 0;
    return (a === null || a === void 0 ? void 0 : a.event) === (b === null || b === void 0 ? void 0 : b.event) && _RealtimeChannel.isFilterValueEqual(a === null || a === void 0 ? void 0 : a.schema, b === null || b === void 0 ? void 0 : b.schema) && _RealtimeChannel.isFilterValueEqual(a === null || a === void 0 ? void 0 : a.table, b === null || b === void 0 ? void 0 : b.table) && _RealtimeChannel.isFilterValueEqual(a === null || a === void 0 ? void 0 : a.filter, b === null || b === void 0 ? void 0 : b.filter) && selectA === selectB;
  }
  /** @internal */
  _getPayloadRecords(payload) {
    const records = {
      new: {},
      old: {}
    };
    if (payload.type === "INSERT" || payload.type === "UPDATE") {
      records.new = convertChangeData(payload.columns, payload.record);
    }
    if (payload.type === "UPDATE" || payload.type === "DELETE") {
      records.old = convertChangeData(payload.columns, payload.old_record);
    }
    return records;
  }
};

// node_modules/@supabase/realtime-js/dist/module/phoenix/socketAdapter.js
var SocketAdapter = class {
  constructor(endPoint, options) {
    this.socket = new Socket(endPoint, options);
  }
  get timeout() {
    return this.socket.timeout;
  }
  get endPoint() {
    return this.socket.endPoint;
  }
  get transport() {
    return this.socket.transport;
  }
  get heartbeatIntervalMs() {
    return this.socket.heartbeatIntervalMs;
  }
  get heartbeatCallback() {
    return this.socket.heartbeatCallback;
  }
  set heartbeatCallback(callback) {
    this.socket.heartbeatCallback = callback;
  }
  get heartbeatTimer() {
    return this.socket.heartbeatTimer;
  }
  get pendingHeartbeatRef() {
    return this.socket.pendingHeartbeatRef;
  }
  get reconnectTimer() {
    return this.socket.reconnectTimer;
  }
  get vsn() {
    return this.socket.vsn;
  }
  get encode() {
    return this.socket.encode;
  }
  get decode() {
    return this.socket.decode;
  }
  get reconnectAfterMs() {
    return this.socket.reconnectAfterMs;
  }
  get sendBuffer() {
    return this.socket.sendBuffer;
  }
  get stateChangeCallbacks() {
    return this.socket.stateChangeCallbacks;
  }
  connect() {
    this.socket.connect();
  }
  disconnect(callback, code, reason, timeout = 1e4) {
    return new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), timeout);
      this.socket.disconnect(() => {
        callback();
        resolve("ok");
      }, code, reason);
    });
  }
  push(data) {
    this.socket.push(data);
  }
  log(kind, msg, data) {
    this.socket.log(kind, msg, data);
  }
  hasLogger() {
    return this.socket.hasLogger();
  }
  makeRef() {
    return this.socket.makeRef();
  }
  onOpen(callback) {
    this.socket.onOpen(callback);
  }
  onClose(callback) {
    this.socket.onClose(callback);
  }
  onError(callback) {
    this.socket.onError(callback);
  }
  onMessage(callback) {
    this.socket.onMessage(callback);
  }
  isConnected() {
    return this.socket.isConnected();
  }
  isConnecting() {
    return this.socket.connectionState() == CONNECTION_STATE.connecting;
  }
  isDisconnecting() {
    return this.socket.connectionState() == CONNECTION_STATE.closing;
  }
  connectionState() {
    return this.socket.connectionState();
  }
  endPointURL() {
    return this.socket.endPointURL();
  }
  sendHeartbeat() {
    this.socket.sendHeartbeat();
  }
  /**
   * @internal
   */
  getSocket() {
    return this.socket;
  }
};

// node_modules/@supabase/realtime-js/dist/module/RealtimeClient.js
var CONNECTION_TIMEOUTS = {
  HEARTBEAT_INTERVAL: 25e3,
  RECONNECT_DELAY: 10,
  HEARTBEAT_TIMEOUT_FALLBACK: 100
};
var RECONNECT_INTERVALS = [1e3, 2e3, 5e3, 1e4];
var DEFAULT_RECONNECT_FALLBACK = 1e4;
function createMemorySessionStorage() {
  const store = /* @__PURE__ */ new Map();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      var _a;
      return (_a = Array.from(store.keys())[index]) !== null && _a !== void 0 ? _a : null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}
function resolveSessionStorage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.sessionStorage) {
      return globalThis.sessionStorage;
    }
  } catch (_a) {
  }
  return createMemorySessionStorage();
}
var WORKER_SCRIPT = `
  addEventListener("message", (e) => {
    if (e.data.event === "start") {
      setInterval(() => postMessage({ event: "keepAlive" }), e.data.interval);
    }
  });`;
var RealtimeClient = class {
  get endPoint() {
    return this.socketAdapter.endPoint;
  }
  get timeout() {
    return this.socketAdapter.timeout;
  }
  get transport() {
    return this.socketAdapter.transport;
  }
  get heartbeatCallback() {
    return this.socketAdapter.heartbeatCallback;
  }
  get heartbeatIntervalMs() {
    return this.socketAdapter.heartbeatIntervalMs;
  }
  get heartbeatTimer() {
    if (this.worker) {
      return this._workerHeartbeatTimer;
    }
    return this.socketAdapter.heartbeatTimer;
  }
  get pendingHeartbeatRef() {
    if (this.worker) {
      return this._pendingWorkerHeartbeatRef;
    }
    return this.socketAdapter.pendingHeartbeatRef;
  }
  get reconnectTimer() {
    return this.socketAdapter.reconnectTimer;
  }
  get vsn() {
    return this.socketAdapter.vsn;
  }
  get encode() {
    return this.socketAdapter.encode;
  }
  get decode() {
    return this.socketAdapter.decode;
  }
  get reconnectAfterMs() {
    return this.socketAdapter.reconnectAfterMs;
  }
  get sendBuffer() {
    return this.socketAdapter.sendBuffer;
  }
  get stateChangeCallbacks() {
    return this.socketAdapter.stateChangeCallbacks;
  }
  /**
   * Initializes the Socket.
   *
   * @param endPoint The string WebSocket endpoint, ie, "ws://example.com/socket", "wss://example.com", "/socket" (inherited host & protocol)
   * @param options.transport The Websocket Transport, for example WebSocket. This can be a custom implementation
   * @param options.timeout The default timeout in milliseconds to trigger push timeouts.
   * @param options.params The optional params to pass when connecting.
   * @param options.headers Deprecated: headers cannot be set on websocket connections and this option will be removed in the future.
   * @param options.heartbeatIntervalMs The millisec interval to send a heartbeat message.
   * @param options.heartbeatCallback The optional function to handle heartbeat status and latency.
   * @param options.logger The optional function for specialized logging, ie: logger: (kind, msg, data) => { console.log(`${kind}: ${msg}`, data) }
   * @param options.logLevel Sets the log level for Realtime
   * @param options.encode The function to encode outgoing messages. Defaults to JSON: (payload, callback) => callback(JSON.stringify(payload))
   * @param options.decode The function to decode incoming messages. Defaults to Serializer's decode.
   * @param options.reconnectAfterMs he optional function that returns the millsec reconnect interval. Defaults to stepped backoff off.
   * @param options.worker Use Web Worker to set a side flow. Defaults to false.
   * @param options.workerUrl The URL of the worker script. Defaults to https://realtime.supabase.com/worker.js that includes a heartbeat event call to keep the connection alive.
   * @param options.vsn The protocol version to use when connecting. Supported versions are "1.0.0" and "2.0.0". Defaults to "2.0.0".
   *
   * @category Realtime
   *
   * @example Using supabase-js (recommended)
   * ```ts
   * import { createClient } from '@supabase/supabase-js'
   *
   * const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
   * const channel = supabase.channel('room1')
   * channel
   *   .on('broadcast', { event: 'cursor-pos' }, (payload) => console.log(payload))
   *   .subscribe()
   * ```
   *
   * @example Standalone import for bundle-sensitive environments
   * ```ts
   * import RealtimeClient from '@supabase/realtime-js'
   *
   * const client = new RealtimeClient('https://xyzcompany.supabase.co/realtime/v1', {
   *   params: { apikey: 'your-publishable-key' },
   * })
   * client.connect()
   * ```
   */
  constructor(endPoint, options) {
    var _a;
    this.channels = new Array();
    this.accessTokenValue = null;
    this.accessToken = null;
    this.apiKey = null;
    this.httpEndpoint = "";
    this.headers = {};
    this.params = {};
    this.ref = 0;
    this.serializer = new Serializer();
    this._manuallySetToken = false;
    this._authPromise = null;
    this._authGeneration = 0;
    this._workerHeartbeatTimer = void 0;
    this._pendingWorkerHeartbeatRef = null;
    this._pendingDisconnectTimer = null;
    this._disconnectOnEmptyChannelsAfterMs = 0;
    this._resolveFetch = (customFetch) => {
      if (customFetch) {
        return (...args) => customFetch(...args);
      }
      return (...args) => fetch(...args);
    };
    if (!((_a = options === null || options === void 0 ? void 0 : options.params) === null || _a === void 0 ? void 0 : _a.apikey)) {
      throw new Error("API key is required to connect to Realtime");
    }
    this.apiKey = options.params.apikey;
    const socketAdapterOptions = this._initializeOptions(options);
    this.socketAdapter = new SocketAdapter(endPoint, socketAdapterOptions);
    this.httpEndpoint = httpEndpointURL(endPoint);
    this.fetch = this._resolveFetch(options === null || options === void 0 ? void 0 : options.fetch);
  }
  /**
   * Connects the socket, unless already connected.
   *
   * @category Realtime
   */
  connect() {
    if (this.isConnecting() || this.isDisconnecting() || this.isConnected()) {
      return;
    }
    if (this.accessToken && !this._authPromise) {
      this._setAuthSafely("connect");
    }
    this._setupConnectionHandlers();
    try {
      this.socketAdapter.connect();
    } catch (error) {
      const errorMessage = error.message;
      throw new Error(`WebSocket not available: ${errorMessage}`);
    }
    this._handleNodeJsRaceCondition();
  }
  /**
   * Returns the URL of the websocket.
   * @returns string The URL of the websocket.
   *
   * @category Realtime
   */
  endpointURL() {
    return this.socketAdapter.endPointURL();
  }
  /**
   * Disconnects the socket.
   *
   * @param code A numeric status code to send on disconnect.
   * @param reason A custom reason for the disconnect.
   *
   * @category Realtime
   */
  async disconnect(code, reason) {
    this._cancelPendingDisconnect();
    if (this.isDisconnecting()) {
      return "ok";
    }
    return await this.socketAdapter.disconnect(() => {
      clearInterval(this._workerHeartbeatTimer);
      this._terminateWorker();
    }, code, reason);
  }
  /**
   * Returns all created channels
   *
   * @category Realtime
   */
  getChannels() {
    return this.channels;
  }
  /**
   * Unsubscribes, removes and tears down a single channel
   * @param channel A RealtimeChannel instance
   *
   * @category Realtime
   */
  async removeChannel(channel2) {
    const status = await channel2.unsubscribe();
    if (status === "ok") {
      channel2.teardown();
    }
    return status;
  }
  /**
   * Unsubscribes, removes and tears down all channels
   *
   * @category Realtime
   */
  async removeAllChannels() {
    const promises = this.channels.map(async (channel2) => {
      const result2 = await channel2.unsubscribe();
      channel2.teardown();
      return result2;
    });
    const result = await Promise.all(promises);
    await this.disconnect();
    return result;
  }
  /**
   * Logs the message.
   *
   * For customized logging, `this.logger` can be overridden in Client constructor.
   *
   * @category Realtime
   */
  log(kind, msg, data) {
    this.socketAdapter.log(kind, msg, data);
  }
  /**
   * Returns true if a custom `logger` has been configured on this client.
   *
   * @category Realtime
   */
  hasLogger() {
    return this.socketAdapter.hasLogger();
  }
  /**
   * Returns the current state of the socket.
   *
   * @category Realtime
   */
  connectionState() {
    return this.socketAdapter.connectionState() || CONNECTION_STATE.closed;
  }
  /**
   * Returns `true` is the connection is open.
   *
   * @category Realtime
   */
  isConnected() {
    return this.socketAdapter.isConnected();
  }
  /**
   * Returns `true` if the connection is currently connecting.
   *
   * @category Realtime
   */
  isConnecting() {
    return this.socketAdapter.isConnecting();
  }
  /**
   * Returns `true` if the connection is currently disconnecting.
   *
   * @category Realtime
   */
  isDisconnecting() {
    return this.socketAdapter.isDisconnecting();
  }
  /**
   * Creates (or reuses) a {@link RealtimeChannel} for the provided topic.
   *
   * Topics are automatically prefixed with `realtime:` to match the Realtime service.
   * If a channel with the same topic already exists it will be returned instead of creating
   * a duplicate connection.
   *
   * @category Realtime
   */
  channel(topic, params = { config: {} }) {
    const realtimeTopic = `realtime:${topic}`;
    const exists = this.getChannels().find((c) => c.topic === realtimeTopic);
    if (!exists) {
      const chan = new RealtimeChannel(`realtime:${topic}`, params, this);
      this._cancelPendingDisconnect();
      this.channels.push(chan);
      return chan;
    } else {
      return exists;
    }
  }
  /**
   * Push out a message if the socket is connected.
   *
   * If the socket is not connected, the message gets enqueued within a local buffer, and sent out when a connection is next established.
   *
   * @category Realtime
   */
  push(data) {
    this.socketAdapter.push(data);
  }
  /**
   * Sets the JWT access token used for channel subscription authorization and Realtime RLS.
   *
   * If param is null it will use the `accessToken` callback function or the token set on the client.
   *
   * On callback used, it will set the value of the token internal to the client.
   *
   * When a token is explicitly provided AND no `accessToken` callback is configured,
   * it will be preserved across channel operations (including removeChannel and
   * resubscribe) and the client stays in manual-token mode.
   *
   * When an `accessToken` callback IS configured, the callback is the source of truth:
   * the client remains in callback mode and continues to refresh from it on heartbeat,
   * even after a bootstrap/override `setAuth(token)` call.
   *
   * The callback is called on connect and on every heartbeat (`heartbeatIntervalMs`,
   * default 25000ms). Its token must stay valid past the next call, or the server closes
   * the channel at expiry with no automatic resubscribe.
   *
   * @param token A JWT string to override the token set on the client.
   *
   * @example Setting the authorization header
   * // Use a manual token (preserved across resubscribes when no accessToken callback is set)
   * client.realtime.setAuth('my-custom-jwt')
   *
   * // Switch back to using the accessToken callback
   * client.realtime.setAuth()
   *
   * @category Realtime
   */
  async setAuth(token = null) {
    const authGeneration = ++this._authGeneration;
    const authPromise = this._performAuth(token, authGeneration);
    if (authGeneration === this._authGeneration) {
      this._authPromise = authPromise;
    }
    try {
      await authPromise;
    } finally {
      if (this._authPromise === authPromise) {
        this._authPromise = null;
      }
    }
  }
  /**
   * Returns true if the current access token was explicitly set via setAuth(token),
   * false if it was obtained via the accessToken callback.
   * @internal
   */
  _isManualToken() {
    return this._manuallySetToken;
  }
  /**
   * Sends a heartbeat message if the socket is connected.
   *
   * @category Realtime
   */
  async sendHeartbeat() {
    this.socketAdapter.sendHeartbeat();
  }
  /**
   * Sets a callback that receives lifecycle events for internal heartbeat messages.
   * Useful for instrumenting connection health (e.g. sent/ok/timeout).
   *
   * @category Realtime
   */
  onHeartbeat(callback) {
    this.socketAdapter.heartbeatCallback = this._wrapHeartbeatCallback(callback);
  }
  /**
   * Return the next message ref, accounting for overflows
   *
   * @internal
   */
  _makeRef() {
    return this.socketAdapter.makeRef();
  }
  /**
   * Removes a channel from RealtimeClient
   *
   * @param channel An open subscription.
   *
   * @internal
   */
  _remove(channel2) {
    this.channels = this.channels.filter((c) => c.topic !== channel2.topic);
    if (this.channels.length === 0) {
      this.log("transport", "no channels remaining, scheduling disconnect");
      this._schedulePendingDisconnect();
    }
  }
  /** @internal */
  _schedulePendingDisconnect() {
    this._cancelPendingDisconnect();
    if (this._disconnectOnEmptyChannelsAfterMs === 0) {
      this.log("transport", "disconnecting immediately - no channels");
      this.disconnect();
      return;
    }
    this._pendingDisconnectTimer = setTimeout(() => {
      this._pendingDisconnectTimer = null;
      if (this.channels.length === 0) {
        this.log("transport", "deferred disconnect fired - no channels, disconnecting");
        this.disconnect();
      }
    }, this._disconnectOnEmptyChannelsAfterMs);
    this.log("transport", `deferred disconnect scheduled in ${this._disconnectOnEmptyChannelsAfterMs}ms`);
  }
  /** @internal */
  _cancelPendingDisconnect() {
    if (this._pendingDisconnectTimer !== null) {
      this.log("transport", "pending disconnect cancelled - channel activity detected");
      clearTimeout(this._pendingDisconnectTimer);
      this._pendingDisconnectTimer = null;
    }
  }
  /**
   * Perform the actual auth operation
   * @internal
   */
  async _performAuth(token, authGeneration) {
    let tokenToSend;
    let isManualToken = false;
    if (token) {
      tokenToSend = token;
      isManualToken = true;
    } else if (this.accessToken) {
      try {
        tokenToSend = await this.accessToken();
      } catch (e) {
        this.log("error", "Error fetching access token from callback", e);
        tokenToSend = this.accessTokenValue;
      }
    } else {
      tokenToSend = this.accessTokenValue;
    }
    if (authGeneration !== this._authGeneration) {
      return;
    }
    if (this.accessToken) {
      this._manuallySetToken = false;
    } else if (isManualToken) {
      this._manuallySetToken = true;
    }
    if (this.accessTokenValue != tokenToSend) {
      this.accessTokenValue = tokenToSend;
      this.channels.forEach((channel2) => {
        const payload = {
          access_token: tokenToSend,
          version: DEFAULT_VERSION
        };
        channel2.updateJoinPayload(payload);
        if (channel2.joinedOnce && channel2.channelAdapter.isJoined()) {
          channel2.channelAdapter.push(CHANNEL_EVENTS.access_token, {
            access_token: tokenToSend
          });
        }
      });
    }
  }
  /**
   * Wait for any in-flight auth operations to complete
   * @internal
   */
  async _waitForAuthIfNeeded() {
    if (this._authPromise) {
      await this._authPromise;
    }
  }
  /**
   * Safely call setAuth with standardized error handling
   * @internal
   */
  _setAuthSafely(context = "general") {
    if (!this._isManualToken()) {
      this.setAuth().catch((e) => {
        this.log("error", `Error setting auth in ${context}`, e);
      });
    }
  }
  /** @internal */
  _setupConnectionHandlers() {
    this.socketAdapter.onOpen(() => {
      const authPromise = this._authPromise || (this.accessToken && !this.accessTokenValue ? this.setAuth() : Promise.resolve());
      authPromise.catch((e) => {
        this.log("error", "error waiting for auth on connect", e);
      });
      if (this.worker && !this.workerRef) {
        this._startWorkerHeartbeat();
      }
    });
    this.socketAdapter.onClose(() => {
      if (this.worker && this.workerRef) {
        this._terminateWorker();
      }
    });
    this.socketAdapter.onMessage((message) => {
      if (message.ref && message.ref === this._pendingWorkerHeartbeatRef) {
        this._pendingWorkerHeartbeatRef = null;
      }
    });
  }
  /** @internal */
  _handleNodeJsRaceCondition() {
    if (this.socketAdapter.isConnected()) {
      this.socketAdapter.getSocket().onConnOpen();
    }
  }
  /** @internal */
  _wrapHeartbeatCallback(heartbeatCallback) {
    return (status, latency) => {
      if (status === "disconnected")
        return;
      if (status == "sent")
        this._setAuthSafely();
      if (heartbeatCallback)
        heartbeatCallback(status, latency);
    };
  }
  /** @internal */
  _startWorkerHeartbeat() {
    if (this.workerUrl) {
      this.log("worker", `starting worker for from ${this.workerUrl}`);
    } else {
      this.log("worker", `starting default worker`);
    }
    const objectUrl = this._workerObjectUrl(this.workerUrl);
    this.workerRef = new Worker(objectUrl);
    this.workerRef.onerror = (error) => {
      this.log("worker", "worker error", error.message);
      this._terminateWorker();
      this.disconnect();
    };
    this.workerRef.onmessage = (event) => {
      if (event.data.event === "keepAlive") {
        this.sendHeartbeat();
      }
    };
    this.workerRef.postMessage({
      event: "start",
      interval: this.heartbeatIntervalMs
    });
  }
  /**
   * Terminate the Web Worker and clear the reference
   * @internal
   */
  _terminateWorker() {
    if (this.workerRef) {
      this.log("worker", "terminating worker");
      this.workerRef.terminate();
      this.workerRef = void 0;
    }
  }
  /** @internal */
  _workerObjectUrl(url) {
    let result_url;
    if (url) {
      result_url = url;
    } else {
      const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
      result_url = URL.createObjectURL(blob);
    }
    return result_url;
  }
  /**
   * Initialize socket options with defaults
   * @internal
   */
  _initializeOptions(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    this.worker = (_a = options === null || options === void 0 ? void 0 : options.worker) !== null && _a !== void 0 ? _a : false;
    this.accessToken = (_b = options === null || options === void 0 ? void 0 : options.accessToken) !== null && _b !== void 0 ? _b : null;
    const result = {};
    result.timeout = (_c = options === null || options === void 0 ? void 0 : options.timeout) !== null && _c !== void 0 ? _c : DEFAULT_TIMEOUT;
    result.heartbeatIntervalMs = (_d = options === null || options === void 0 ? void 0 : options.heartbeatIntervalMs) !== null && _d !== void 0 ? _d : CONNECTION_TIMEOUTS.HEARTBEAT_INTERVAL;
    this._disconnectOnEmptyChannelsAfterMs = (_e = options === null || options === void 0 ? void 0 : options.disconnectOnEmptyChannelsAfterMs) !== null && _e !== void 0 ? _e : 2 * ((_f = options === null || options === void 0 ? void 0 : options.heartbeatIntervalMs) !== null && _f !== void 0 ? _f : CONNECTION_TIMEOUTS.HEARTBEAT_INTERVAL);
    result.transport = (_g = options === null || options === void 0 ? void 0 : options.transport) !== null && _g !== void 0 ? _g : websocket_factory_default.getWebSocketConstructor();
    result.params = options === null || options === void 0 ? void 0 : options.params;
    result.logger = options === null || options === void 0 ? void 0 : options.logger;
    result.heartbeatCallback = this._wrapHeartbeatCallback(options === null || options === void 0 ? void 0 : options.heartbeatCallback);
    result.sessionStorage = (_h = options === null || options === void 0 ? void 0 : options.sessionStorage) !== null && _h !== void 0 ? _h : resolveSessionStorage();
    result.reconnectAfterMs = (_j = options === null || options === void 0 ? void 0 : options.reconnectAfterMs) !== null && _j !== void 0 ? _j : ((tries) => {
      return RECONNECT_INTERVALS[tries - 1] || DEFAULT_RECONNECT_FALLBACK;
    });
    let defaultEncode;
    let defaultDecode;
    const vsn = (_k = options === null || options === void 0 ? void 0 : options.vsn) !== null && _k !== void 0 ? _k : DEFAULT_VSN;
    switch (vsn) {
      case VSN_1_0_0:
        defaultEncode = (payload, callback) => {
          return callback(JSON.stringify(payload));
        };
        defaultDecode = (payload, callback) => {
          return callback(JSON.parse(payload));
        };
        break;
      case VSN_2_0_0:
        defaultEncode = this.serializer.encode.bind(this.serializer);
        defaultDecode = this.serializer.decode.bind(this.serializer);
        break;
      default:
        throw new Error(`Unsupported serializer version: ${result.vsn}`);
    }
    result.vsn = vsn;
    result.encode = (_l = options === null || options === void 0 ? void 0 : options.encode) !== null && _l !== void 0 ? _l : defaultEncode;
    result.decode = (_m = options === null || options === void 0 ? void 0 : options.decode) !== null && _m !== void 0 ? _m : defaultDecode;
    result.beforeReconnect = this._reconnectAuth.bind(this);
    if ((options === null || options === void 0 ? void 0 : options.logLevel) || (options === null || options === void 0 ? void 0 : options.log_level)) {
      this.logLevel = options.logLevel || options.log_level;
      result.params = Object.assign(Object.assign({}, result.params), { log_level: this.logLevel });
    }
    if (this.worker) {
      if (typeof window !== "undefined" && !window.Worker) {
        throw new Error("Web Worker is not supported");
      }
      this.workerUrl = options === null || options === void 0 ? void 0 : options.workerUrl;
      result.autoSendHeartbeat = !this.worker;
    }
    return result;
  }
  /** @internal */
  async _reconnectAuth() {
    await this._waitForAuthIfNeeded();
    if (!this.isConnected()) {
      this.connect();
    }
  }
};

// shared/day-realtime.ts
var SUPABASE_URL = "https://oinomcikdyisrbfeeirp.supabase.co";
var SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pbm9tY2lrZHlpc3JiZmVlaXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzM3NzgsImV4cCI6MjEwMDI0OTc3OH0.PiMDYsSZjNd4Iw-0wbQH4niDvUmW8ymycmiyb5Raf1w";
var client = null;
var channel = null;
var channelUid = "";
function jwtSub(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).sub || "";
  } catch {
    return "";
  }
}
function watchDayReads(token, onDay) {
  if (!token) return;
  const uid = jwtSub(token);
  if (!uid) return;
  try {
    if (!client) client = new RealtimeClient(SUPABASE_URL.replace("https://", "wss://") + "/realtime/v1", { params: { apikey: SUPABASE_ANON } });
    client.setAuth(token);
    if (channel && channelUid === uid) return;
    if (channel) client.removeChannel(channel);
    channelUid = uid;
    channel = client.channel("day:" + uid, { config: { private: true } });
    channel.on("broadcast", { event: "day" }, (msg) => {
      try {
        onDay(msg && msg.payload);
      } catch (e) {
      }
    });
    channel.subscribe();
  } catch (e) {
    console.warn("day-realtime:", e.message);
  }
}

// pro/app.ts
var API_URL2 = "https://tra-zacg.onrender.com";
var CARD_CAP = 15;
var market = null;
var lastAnalysis = {};
var MARKET_HOLIDAYS = /* @__PURE__ */ new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24"
]);
var MARKET_EARLY_CLOSE_DAYS = /* @__PURE__ */ new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
function etDateStr(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isMarketClosed() {
  var now = /* @__PURE__ */ new Date();
  var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  var day = et.getDay();
  if (day === 0 || day === 6) return true;
  var dateStr = etDateStr(et);
  if (MARKET_HOLIDAYS.has(dateStr)) return true;
  var mins = et.getHours() * 60 + et.getMinutes();
  var closeMins = MARKET_EARLY_CLOSE_DAYS.has(dateStr) ? 780 : 960;
  return mins < 570 || mins >= closeMins;
}
function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
function vibrateTap() {
  if (canVibrate()) navigator.vibrate(15);
}
function vibrateResult() {
  if (canVibrate()) navigator.vibrate([15, 60, 40]);
}
function sigColor(s) {
  return { GREEN: "var(--green)", RED: "var(--red)", YELLOW: "var(--amber)", "N/A": "var(--ink-dim)" }[s] || "var(--ink-dim)";
}
function dirClass(d) {
  return d === "green" ? "up" : d === "red" ? "down" : d === "flat" ? "flat" : "neutral";
}
function pctColor(p) {
  return p > 0 ? "var(--green)" : p < 0 ? "var(--red)" : "var(--ink-dim)";
}
function fmtPct(p) {
  return (p > 0 ? "+" : "") + p.toFixed(2) + "%";
}
var sbSession = null;
function authH2() {
  return { "Content-Type": "application/json" };
}
function addSecret2(url) {
  if (sbSession && sbSession.token) {
    var sep = url.includes("?") ? "&" : "?";
    return url + sep + "supabase_token=" + encodeURIComponent(sbSession.token);
  }
  return url;
}
function showScreen(id) {
  ["auth-screen", "app-root"].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = s === id ? s === "app-root" ? "block" : "flex" : "none";
  });
}
function authLogout() {
  storeSession(null);
  sbSession = null;
  showScreen("auth-screen");
}
function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  var m = document.getElementById("profile-menu");
  if (!m) return;
  m.classList.toggle("open");
}
document.addEventListener("click", function(e) {
  var m = document.getElementById("profile-menu");
  if (!m || !m.classList.contains("open")) return;
  if (!e.target.closest(".profile-wrap")) m.classList.remove("open");
});
async function fetchCreditStatus() {
  try {
    var res = await fetch(addSecret2(API_URL2 + "/status"), { headers: authH2() });
    var data = await res.json();
    var el = document.getElementById("credits-btn");
    if (el && data.totalCredits !== void 0) {
      el.textContent = (data.totalCredits > 0 ? data.totalCredits : "+") + " CREDITS";
    }
  } catch (e) {
  }
}
var authMode = "login";
function bindAuthEvents() {
  var eyeBtn = document.getElementById("eye-btn");
  var resetLink = document.getElementById("reset-link");
  var authBtn = document.getElementById("auth-btn");
  var authToggle = document.getElementById("auth-toggle");
  var pwInput = document.getElementById("auth-password");
  var emailInput = document.getElementById("auth-email");
  if (eyeBtn) eyeBtn.addEventListener("click", function() {
    var inp = document.getElementById("auth-password");
    inp.type = inp.type === "password" ? "text" : "password";
    eyeBtn.innerHTML = inp.type === "password" ? "&#128065;" : "&#128584;";
  });
  if (resetLink) resetLink.addEventListener("click", function() {
    var email = document.getElementById("auth-email").value.trim();
    var err = document.getElementById("auth-error");
    if (!email) {
      err.style.color = "var(--red)";
      err.textContent = "Enter your email first";
      return;
    }
    err.style.color = "var(--dim)";
    err.textContent = "Sending reset link...";
    fetch(API_URL2 + "/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(function(r) {
      return r.json();
    }).then(function() {
      err.style.color = "var(--green)";
      err.textContent = "Reset link sent! Check your email.";
    }).catch(function(e) {
      err.style.color = "var(--red)";
      err.textContent = e.message;
    });
  });
  if (authBtn) authBtn.addEventListener("click", function() {
    if (authMode === "login") handleLogin();
    else handleSignup();
  });
  if (authToggle) authToggle.addEventListener("click", () => toggleAuthMode());
  if (pwInput) pwInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") authBtn && authBtn.click();
  });
  if (emailInput) emailInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") pwInput && pwInput.focus();
  });
}
function toggleAuthMode(mode) {
  authMode = mode || (authMode === "login" ? "signup" : "login");
  var isL = authMode === "login";
  document.getElementById("auth-title").textContent = isL ? "SIGN IN" : "CREATE ACCOUNT";
  document.getElementById("auth-btn").textContent = isL ? "SIGN IN" : "CREATE ACCOUNT";
  document.getElementById("auth-toggle").innerHTML = isL ? 'New user? <span style="text-decoration:underline">Create Account</span>' : 'Already have an account? <span style="text-decoration:underline">Sign in</span>';
  document.getElementById("auth-error").textContent = "";
  document.getElementById("auth-error").style.color = "var(--red)";
  var rl = document.getElementById("reset-link");
  if (rl) rl.style.display = isL ? "inline" : "none";
}
async function handleLogin() {
  var email = document.getElementById("auth-email").value.trim(), password = document.getElementById("auth-password").value, btn = document.getElementById("auth-btn"), err = document.getElementById("auth-error");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "SIGNING IN...";
  try {
    var r = await fetch(API_URL2 + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!r.ok) {
      var e = await r.json();
      throw new Error(e.error || "Login failed");
    }
    var session = stampNewSession(await r.json());
    storeSession(session);
    sbSession = session;
    btn.textContent = "SIGN IN";
    btn.disabled = false;
    checkTierAccess(session);
    pingDeviceVisit({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
  } catch (e2) {
    err.textContent = e2.message;
    btn.textContent = "SIGN IN";
    btn.disabled = false;
  }
}
async function handleSignup() {
  var email = document.getElementById("auth-email").value.trim(), password = document.getElementById("auth-password").value, btn = document.getElementById("auth-btn"), err = document.getElementById("auth-error");
  err.textContent = "";
  err.style.color = "var(--red)";
  if (!email || !password) {
    err.textContent = "Email and password required";
    return;
  }
  if (password.length < 6) {
    err.textContent = "Password must be at least 6 characters";
    return;
  }
  btn.disabled = true;
  btn.textContent = "CREATING...";
  try {
    var r = await fetch(API_URL2 + "/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!r.ok) {
      var e = await r.json();
      throw new Error(e.error || "Signup failed");
    }
    toggleAuthMode("login");
    err.style.color = "var(--green)";
    err.textContent = "Account created! Check your email to confirm, then sign in.";
    btn.disabled = false;
  } catch (e2) {
    err.textContent = e2.message;
    btn.textContent = "CREATE ACCOUNT";
    btn.disabled = false;
  }
}
var GATE_FIELDS = [
  ["spy", "SPY"],
  ["qqq", "QQQ"],
  ["btc", "BTC"],
  ["soxx", "SOXX"],
  ["xbi", "XBI"],
  ["iwm", "IWM"],
  ["gld", "GLD"],
  ["uso", "USO"],
  ["tsm", "TSM"],
  ["msft", "MSFT"]
];
var GATE_LINK_OVERRIDE = { BTC: "BTC-USD" };
function gateLinkSymbol(label) {
  return GATE_LINK_OVERRIDE[label] || label;
}
var gateMarquee = document.getElementById("gateMarquee");
async function fetchMarket(force) {
  try {
    var url = force ? addSecret2(API_URL2 + "/market?force=true") : addSecret2(API_URL2 + "/market");
    var res = await fetch(url, { headers: authH2() });
    market = await res.json();
  } catch (e) {
    market = null;
  }
  renderGate();
  renderPulse();
  refreshGateMarquee();
  requestAnimationFrame(sizeGateSpacer);
}
function renderPulse() {
  var pulseEl = document.getElementById("pulse-text");
  if (!pulseEl) return;
  if (market && market.pulse) {
    pulseEl.className = "pulse-text";
    pulseEl.textContent = market.pulse;
  } else if (market) {
    pulseEl.className = "pulse-loading text-pulse";
    pulseEl.textContent = "Generating pulse...";
  } else {
    pulseEl.className = "pulse-loading";
    pulseEl.textContent = "Unavailable";
  }
}
function renderGate() {
  const status = market && market.gateStatus || "GREEN";
  const color = sigColor(status);
  document.getElementById("gateMiniDot").style.background = color;
  document.getElementById("gateFullDot").style.background = color;
  const closed = isMarketClosed();
  const marketLabel = closed ? "CLOSED" : "OPEN";
  const marketColor = closed ? "var(--red)" : "var(--green)";
  document.getElementById("gateMiniLabel").textContent = marketLabel;
  document.getElementById("gateMiniLabel").style.color = marketColor;
  document.getElementById("gateFullLabel").textContent = marketLabel;
  document.getElementById("gateFullLabel").style.color = marketColor;
  document.getElementById("gateNote").innerHTML = autoLinkGlossaryTerms(market && market.gateNote || (market ? "" : "Tap to retry \u2014 data unavailable."));
  const grid = document.getElementById("gateGrid");
  grid.innerHTML = GATE_FIELDS.map(([key, label]) => {
    const d = market && market[key];
    const val = !d || d.change === "?" ? "?" : d.change;
    const cls = !d || d.change === "?" ? "neutral" : dirClass(d.direction);
    const sym = gateLinkSymbol(label);
    return `<div class="gate-stat"><div class="k"><a href="${tickerHref(sym)}" target="_blank" data-ticker="${sym}">${label}</a></div><div class="v ${cls}">${val}</div></div>`;
  }).join("");
  renderMarketTs();
}
function renderMarketTs() {
  var tsEl = document.getElementById("marketTs");
  if (!tsEl) return;
  if (!market || !market.timestamp) {
    tsEl.textContent = "";
    return;
  }
  var t = new Date(market.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: getTzIana() });
  tsEl.textContent = (market.cached ? "\u26A1 Cached" : "\u{1F534} Live") + " \xB7 Updated " + t + " " + getTzPref();
}
function refreshGateMarquee() {
  const itemsHTML = GATE_FIELDS.map(([key, label]) => {
    const d = market && market[key];
    const val = !d || d.change === "?" ? "?" : d.change;
    const cls = !d || d.change === "?" ? "neutral" : dirClass(d.direction);
    const sym = gateLinkSymbol(label);
    return `<span class="gm-item"><a class="sym" href="${tickerHref(sym)}" target="_blank" data-ticker="${sym}" onclick="event.stopPropagation()">${label}</a><span class="val ${cls}">${val}</span></span>`;
  }).join("");
  buildGateMarquee(itemsHTML);
}
function expandCard(card) {
  card.classList.add("expanded");
  const head = card.querySelector(".card-head");
  if (head) head.setAttribute("aria-expanded", "true");
  const kind = card.dataset.card;
  if (kind === "glossary") buildGlossary();
  if (!isLandscapeMode()) snapCardUnderDock(card);
  if (kind === "watchlist") renderOverflowList();
  else if (kind === "proxy") renderProxyExplorer();
  else if (kind === "heatmap") renderHeatMap();
  else if (kind === "scorecard") renderScorecardCard();
}
var accordionLastToggleAt = /* @__PURE__ */ new WeakMap();
var ACCORDION_TOGGLE_DEBOUNCE_MS = 400;
function wireAccordionHead(head) {
  function toggle() {
    const now = Date.now();
    if (now - (accordionLastToggleAt.get(head) || 0) < ACCORDION_TOGGLE_DEBOUNCE_MS) return;
    accordionLastToggleAt.set(head, now);
    const card = head.closest(".card");
    const wasExpanded = card.classList.contains("expanded");
    if (wasExpanded) {
      card.classList.remove("expanded");
      head.setAttribute("aria-expanded", "false");
    } else {
      expandCard(card);
    }
  }
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}
document.querySelectorAll(".card[data-card] > .card-head").forEach(wireAccordionHead);
var roloStage = document.getElementById("roloStage");
var roloIndex = document.getElementById("roloIndex");
var scroller = document.getElementById("scroller");
var tickerState = /* @__PURE__ */ new Map();
var TYPE_COLOR = { CANARY: "var(--amber)", SENTIMENT: "var(--blue)", FLOW: "var(--green)" };
var SIZING_LABEL = { FULL: "Full", HALF: "Half", QUARTER: "\xBC size" };
var SIZING_COLOR = { FULL: "var(--green)", HALF: "var(--amber)", QUARTER: "var(--amber)" };
function badgesHTML(result) {
  if (!result) return "";
  let html = "";
  if (result.type) {
    const c = TYPE_COLOR[result.type] || "var(--ink-dim)";
    html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${result.type}</span>`;
  }
  if (result.sizing) {
    if (result.sizing !== "NONE") {
      const label = SIZING_LABEL[result.sizing] || result.sizing;
      const c = SIZING_COLOR[result.sizing] || "var(--ink-dim)";
      html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${label}</span>`;
    } else {
      html += '<span class="badge" style="color:var(--blue);border-color:rgba(74,168,255,.4);background:rgba(74,168,255,.08)">Defined risk</span>';
    }
  }
  return html ? `<div class="card-badges">${html}</div>` : "";
}
function confColor(conf) {
  return conf === "HIGH" ? "var(--green)" : conf === "MEDIUM" ? "var(--amber)" : "var(--red)";
}
function earningsBlockedRetryHTML(sym, result) {
  if (!result || !result.earningsBlocked) return "";
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:var(--red)"></div><div class="pregate-note"><button type="button" class="btn btn-purple btn-compact" onclick="retryWithEarningsHoldThrough('${sym}')" style="margin-top:4px">Hold through earnings anyway</button></div></div>`;
}
function pregateStripHTML(result) {
  if (!result || !result.gates) return "";
  const waitText = result.wait_for && result.wait_for !== "null" ? result.wait_for : "";
  if (!waitText) return "";
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:${confColor(result.confidence)}"></div><div class="pregate-note"><span class="wait-lbl">LOOK FOR: </span>${autoLinkGlossaryTerms(waitText)}</div></div>`;
}
function classifyTrigger(data) {
  var reason = data && data.reason || "";
  if (reason.indexOf("Pre-Gate thesis-integrity override") === 0) return "pre-gate";
  if (reason.indexOf("Broad market failure") === 0) return "gate0";
  if (reason.indexOf("Gate 1 structural breakdown override") === 0) return "gate1";
  if (reason.indexOf("Gate 5 forceDown") === 0) return "gate5";
  if (data && data.verdict === "DOWN") return "corroboration";
  return "standard";
}
var TRIGGER_LABELS = {
  "pre-gate": "PRE-GATE OVERRIDE",
  "gate0": "GATE 0 OVERRIDE",
  "gate1": "GATE 1 OVERRIDE",
  "gate5": "GATE 5 OVERRIDE",
  "corroboration": "2+ GATE CORROBORATION",
  "standard": "STANDARD VERDICT"
};
function logResultUI(ticker, verdict, correct, btnEl) {
  var rowEl = btnEl.closest(".log-row");
  if (!rowEl) return;
  var meta = { trigger: classifyTrigger(lastAnalysis[ticker]) };
  logResult(ticker, verdict, correct, rowEl, meta);
  schedulePushTrackRecord();
}
function logSectionHTML(sym, verdict) {
  return `<div class="log-row"><span class="log-prompt">WAS IT RIGHT?</span><button class="log-btn log-btn-right" data-log="${sym}" data-verdict="${verdict}" data-correct="true">\u2713 RIGHT</button><button class="log-btn log-btn-wrong" data-log="${sym}" data-verdict="${verdict}" data-correct="false">\u2717 WRONG</button><button class="log-btn log-btn-skip" data-log-skip="1">SKIP</button></div>`;
}
function analystViewHTML(sym, result, td) {
  if (!result || !result.gates) return "";
  var trigger = classifyTrigger(result);
  var triggerColor = {
    "pre-gate": "var(--red)",
    "gate0": "var(--red)",
    "gate1": "var(--red)",
    "gate5": "var(--red)",
    "corroboration": "var(--amber)",
    "standard": "var(--ink-dim)"
  };
  var g = result.gates;
  var redCount = ["g1_prewindow", "g2_catalyst", "g4_phase", "g5_korea"].filter(function(k) {
    return g[k] && g[k].status === "RED";
  }).length;
  var rule = td && td.proxyRule;
  var proxyHtml = "";
  if (rule && rule.proxy) {
    var tier = rule.tier || "primary";
    var tierColor = { primary: "var(--green)", candidate: "var(--purple)", secondary: "var(--amber)", "fundamentals-confirmed": "var(--blue)", "fundamentals-speculative": "var(--red)" };
    var tc = tierColor[tier] || "var(--ink-dim)";
    proxyHtml = `<div class="analyst-row"><span class="analyst-lbl">PROXY TIER</span><span class="proxy-tier-badge" style="color:${tc};border-color:${tc}55;background:${tc}11">${tier.toUpperCase().replace(/-/g, " ")}</span></div><div class="analyst-note">${rule.proxy.name}${rule.dynamicallyResolved ? " \u2014 dynamically resolved (Gate 5)" : " \u2014 fixed sector proxy"}</div>`;
    if (rule.elevatedCapCeiling || rule.autoExecuteStop) {
      proxyHtml += `<div class="analyst-row"><span class="analyst-lbl">RISK FLAGS</span>` + (rule.elevatedCapCeiling ? '<span class="proxy-tier-badge" style="color:var(--amber);border-color:rgba(255,182,45,.4);background:rgba(255,182,45,.1)">ELEVATED CAP CEILING</span>' : "") + (rule.autoExecuteStop ? '<span class="proxy-tier-badge" style="color:var(--red);border-color:rgba(255,59,92,.4);background:rgba(255,59,92,.1)">AUTO-EXECUTE STOP</span>' : "") + "</div>";
    }
  }
  return `<button class="expand-btn expand-btn-purple" data-toggle-analyst="${sym}"><span>ANALYST VIEW</span><span class="analyst-arrow">\u25BC</span></button><div class="analyst-list" data-analyst-body="${sym}" style="display:none"><div class="analyst-row"><span class="analyst-lbl">TRIGGER</span><span class="analyst-val" style="color:${triggerColor[trigger]}">${TRIGGER_LABELS[trigger]}</span></div><div class="analyst-row"><span class="analyst-lbl">CORROBORATION</span><span class="analyst-val">${redCount}/4 non-exempt gates RED</span></div>` + (result.reason ? `<div class="analyst-row"><span class="analyst-lbl">VERDICT REASON</span></div><div class="analyst-note">${result.reason}</div>` : "") + proxyHtml + "</div>";
}
function dayWindow(result) {
  return result && result.window || null;
}
function activeView(state) {
  const w = dayWindow(state.result);
  if (!w || !w.day) return "long";
  return state.view || "day";
}
function viewResult(state) {
  const r = state.result;
  const w = dayWindow(r);
  if (!r || !w || !w.day || activeView(state) !== "day") return r;
  return Object.assign({}, r, { verdict: w.day.verdict, sizing: w.day.sizing });
}
function fmtClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: getTzIana() }) + " " + getTzPref();
  } catch (e) {
    return "";
  }
}
function gateMark(kind, status) {
  if (kind === "reading") return '<span class="gate-dot gate-reading"></span>';
  if (kind === "ok") return `<span class="gate-mark" style="color:${sigColor(status || "")}">\u2713</span>`;
  if (kind === "miss") return '<span class="gate-mark" style="color:var(--red)">\u2717</span>';
  return '<span class="gate-mark" style="color:var(--ink-dim)">\u2013</span>';
}
function markRow(label, kind, status, note) {
  return `<div class="gate-row">${gateMark(kind, status)}<div class="gn"><span class="gl">${label}</span>${note ? " - " + autoLinkGlossaryTerms(note) : ""}</div></div>`;
}
function progressGateRows(state) {
  const r = state.result;
  const p = state.progress || {};
  const gates = r && r.gates || p.gates || {};
  const missing = r && r.gateMissing || p.gateMissing || {};
  const win = r && r.window || p.window || null;
  const done = !state.analyzing;
  const pending = (g) => done ? "miss" : "reading";
  const serverRow = (label, key) => {
    const g = gates[key];
    if (missing[key]) return markRow(label, "miss", "", "not read (no data)");
    if (!g) return markRow(label, pending(g), "", done ? "not read" : "reading\u2026");
    if (key === "pre_gate" && g.status === "GREEN") return '<div class="gate-clear">' + gateMark("ok", "GREEN") + "<span>PRE-GATE clear</span></div>";
    return markRow(label, "ok", g.status, g.note || "");
  };
  let g3;
  const showLongG3 = r && win && win.state !== "FORMING" && activeView(state) === "long";
  if (showLongG3) {
    const g = gates.g3_openbar || {};
    g3 = markRow("G3  WEEK", "ok", g.status, g.note || "");
  } else if (!win) {
    g3 = markRow("G3  LAST 3 BARS", pending(null), "", done ? "not read" : "reading bars\u2026");
  } else if (win.gate3 && win.gate3.status) {
    g3 = markRow("G3  LAST 3 BARS", "ok", win.gate3.status, win.gate3.note);
  } else if (win.state === "FORMING") {
    g3 = markRow("G3  LAST 3 BARS", "miss", "", `${win.barsDone}/${win.barsNeeded} bars. Day read at ${fmtClock(win.readyAt)}.`);
  } else {
    g3 = markRow("G3  LAST 3 BARS", "na", "", win.gate3 && win.gate3.note || "Long verdict only.");
  }
  const g2g = gates.g2_catalyst;
  const g2 = g2g ? markRow("G2  CATALYST", "ok", g2g.status, g2g.note || "") : markRow("G2  CATALYST", pending(null), "", done ? "not read" : "reading\u2026");
  return serverRow("PRE-GATE", "pre_gate") + serverRow("G1  14D", "g1_prewindow") + g2 + g3 + serverRow("G4  PHASE", "g4_phase") + serverRow("G5  PROXY", "g5_korea");
}
function dayLongBarHTML(sym, state) {
  const w = dayWindow(state.result);
  if (!w) return "";
  const view = activeView(state);
  let status = "";
  if (w.day) status = (view === "day" ? w.day.note + " " : "") + (w.asOf ? "Bars as of " + fmtClock(w.asOf) + "." : "");
  else if (w.state === "FORMING") status = `Day read at ${fmtClock(w.readyAt)} (${w.barsDone}/${w.barsNeeded} bars). It will show here on its own, no extra credit.`;
  else status = w.gate3 && w.gate3.note || "Long verdict only.";
  const btn = (v, label, enabled) => `<button type="button" class="view-btn${view === v ? " active" : ""}" data-view="${v}" ${enabled ? "" : "disabled"}>${label}</button>`;
  return `<div class="day-long-bar">${btn("day", "DAY", !!w.day)}${btn("long", "LONG", true)}</div><div class="day-note">${status}</div>`;
}
function gateListHTML(sym, result, historicalReaction) {
  const stp = tickerState.get(sym);
  if ((!result || !result.gates) && stp && stp.progress) {
    return '<div class="gate-list">' + progressGateRows(stp) + "</div>";
  }
  if (!result || !result.gates) {
    return '<div class="gate-list"><div class="gate-clear"><span class="gate-dot" style="background:var(--ink-faint)"></span><span>Tap ANALYZE to run the gates</span></div></div>';
  }
  const g = result.gates;
  const st = tickerState.get(sym);
  if (st && (dayWindow(result) || st.progress)) {
    const vr = viewResult(st) || result;
    const conf0 = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ""}</span></div>`;
    const track0 = historicalReaction ? `<div class="conf-row"><span class="conf-lbl">TRACK RECORD</span><span class="conf-val">${historicalReaction.directionalPct}% <span style="color:var(--ink-dim);font-weight:normal">(${historicalReaction.gradedCount} graded)</span></span></div>` : "";
    return '<div class="gate-list">' + progressGateRows(st) + logSectionHTML(sym, (vr.verdict || "FLAT").toUpperCase()) + conf0 + track0 + "</div>";
  }
  const rows = [
    ["PRE-GATE", g.pre_gate],
    ["G1  14D", g.g1_prewindow],
    ["G2  CATALYST", g.g2_catalyst],
    ["G3  OPEN BAR", g.g3_openbar],
    ["G4  PHASE", g.g4_phase],
    ["G5  PROXY", g.g5_korea]
  ].map(([label, gate]) => {
    gate = gate || {};
    if (gate === g.pre_gate && gate.status === "GREEN") {
      return '<div class="gate-clear"><span class="gate-dot" style="background:var(--green)"></span><span>PRE-GATE clear</span></div>';
    }
    return `<div class="gate-row"><span class="gate-dot" style="background:${sigColor(gate.status)}"></span><div class="gn"><span class="gl">${label}</span>${gate.note ? " - " + autoLinkGlossaryTerms(gate.note) : ""}</div></div>`;
  }).join("");
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ""}</span></div>`;
  const track = historicalReaction ? `<div class="conf-row"><span class="conf-lbl">TRACK RECORD</span><span class="conf-val">${historicalReaction.directionalPct}% <span style="color:var(--ink-dim);font-weight:normal">(${historicalReaction.gradedCount} graded)</span></span></div>` : "";
  const v = (result.verdict || "FLAT").toUpperCase();
  return '<div class="gate-list">' + rows + logSectionHTML(sym, v) + conf + track + "</div>";
}
function verdictAreaHTML(sym, result) {
  const closed = isMarketClosed();
  const v = (result.verdict || "FLAT").toUpperCase();
  if (closed) {
    return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">MKT CLOSED</span></div>`;
  }
  if (v === "UP") return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-up">\u{1F44D}</span><span class="verdict-lbl-up">UP</span></div>`;
  if (v === "DOWN") return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-down">\u{1F44E}</span><span class="verdict-lbl-down">DOWN</span></div>`;
  return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">WAIT &amp; WATCH</span></div>`;
}
function priceDirClass(td) {
  const pct = td && td.metrics && typeof td.metrics.pct === "number" ? td.metrics.pct : 0;
  return pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
}
function roloCardHTML(sym, state) {
  const td = state.td;
  const price = td && td.metrics && td.metrics.price != null ? "$" + td.metrics.price.toFixed(2) : "\u2014";
  const news = td && td.news;
  const rawHeadline = news ? news.headline : "No news within the last business week";
  const ctxEl = document.getElementById("context-input");
  const headline = autoLinkGlossaryTerms(news ? highlightContextMatches(rawHeadline, ctxEl ? ctxEl.value : "") : rawHeadline);
  const age = news ? news.ageLabel : "\u2014";
  const m = td && td.metrics;
  const w52 = m && m.rangePosition != null ? m.rangePosition + "%" : "?";
  const phase = m && m.phaseProxy ? m.phaseProxy.replace("PHASE_", "") : "?";
  const beta = m && m.beta ? m.beta.toFixed(1) : "?";
  const proxyName = td && td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name.split("(")[0].trim() : "?";
  const proxySymbols = td && td.proxyRule && td.proxyRule.proxy && Array.isArray(td.proxyRule.proxy.symbols) ? td.proxyRule.proxy.symbols : [];
  const proxyHTML = proxySymbols.length === 1 ? `<a href="${tickerHref(proxySymbols[0])}" target="_blank">${proxyName}</a>` : proxyName;
  const decay = td && td.corroborationDecay;
  const decayHTML = decay ? `<span>CONTEXT <b style="color:${decay.label === "FRESH" ? "var(--green)" : "var(--red)"}">${decay.label} ${decay.freshnessPct}%</b></span>` : "";
  const analyzing = state.analyzing;
  const result = state.result;
  const shown = viewResult(state);
  const dir = priceDirClass(td);
  const noData = !td;
  const pulseCls = noData ? " text-pulse" : "";
  return `<div class="ticker-row"><div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}${pulseCls}">${price}</span><div class="ticker-swipe-hint">\u2190 Swipe to delete</div></div><div class="ticker-action">` + (shown ? verdictAreaHTML(sym, shown) : `<button class="btn btn-blue btn-compact${analyzing ? " btn-running" : ""}" data-analyze="${sym}" ${analyzing ? "disabled" : ""}>${analyzing ? "RUNNING\u2026" : "ANALYZE"}</button>`) + `</div></div>` + pregateStripHTML(result) + earningsBlockedRetryHTML(sym, result) + `<div class="headline${pulseCls}">${wrapHeadlineLinks(sym, headline)} <span class="age">${age}</span></div><div class="meta-row"><span>52W <b class="${pulseCls}">${w52}</b></span><span>PHASE <b class="${pulseCls}">${phase}</b></span><span>\u03B2 <b class="${pulseCls}">${beta}</b></span><span>PROXY <b style="color:var(--blue)" class="${pulseCls}">${proxyHTML}</b></span>${decayHTML}</div>` + badgesHTML(shown) + dayLongBarHTML(sym, state) + gateListHTML(sym, result, td && td.historicalReaction) + analystViewHTML(sym, result, td) + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : "");
}
function wireCardButtons(card, sym) {
  const btn = card.querySelector("[data-analyze]");
  if (btn) btn.addEventListener("click", () => {
    vibrateTap();
    analyzeOne(sym);
  });
  card.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    const st = tickerState.get(sym);
    if (!st || b.hasAttribute("disabled")) return;
    st.view = b.dataset.view === "long" ? "long" : "day";
    vibrateTap();
    renderRoloCard(sym);
    renderPill(sym);
  }));
  const resetEl = card.querySelector("[data-reset]");
  if (resetEl) resetEl.addEventListener("click", () => resetTicker(sym));
  const analystToggle = card.querySelector("[data-toggle-analyst]");
  if (analystToggle) analystToggle.addEventListener("click", () => {
    const body = card.querySelector(`[data-analyst-body="${sym}"]`);
    const arrow = analystToggle.querySelector(".analyst-arrow");
    if (!body) return;
    const open = body.style.display === "none";
    body.style.display = open ? "block" : "none";
    if (arrow) arrow.textContent = open ? "\u25B2" : "\u25BC";
    syncRoloStageHeight();
  });
  const rightBtn = card.querySelector('[data-log][data-correct="true"]');
  const wrongBtn = card.querySelector('[data-log][data-correct="false"]');
  const skipBtn = card.querySelector("[data-log-skip]");
  if (rightBtn) rightBtn.addEventListener("click", () => logResultUI(sym, rightBtn.dataset.verdict, true, rightBtn));
  if (wrongBtn) wrongBtn.addEventListener("click", () => logResultUI(sym, wrongBtn.dataset.verdict, false, wrongBtn));
  if (skipBtn) skipBtn.addEventListener("click", () => {
    skipBtn.closest(".log-row").style.display = "none";
  });
}
function renderRoloCard(sym) {
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
  if (!card) return;
  const state = tickerState.get(sym);
  if (!state) return;
  card.innerHTML = roloCardHTML(sym, state);
  card.classList.remove("verdict-up", "verdict-down");
  wireCardButtons(card, sym);
  const shownR = viewResult(state);
  if (shownR && !isMarketClosed()) {
    const v = (shownR.verdict || "").toUpperCase();
    if (v === "UP") card.classList.add("verdict-up");
    else if (v === "DOWN") card.classList.add("verdict-down");
  }
  syncRoloStageHeight();
}
function resetTicker(sym) {
  const state = tickerState.get(sym);
  if (!state) return;
  state.result = null;
  state.error = null;
  state.progress = null;
  state.view = void 0;
  if (state.dayTimer) {
    clearTimeout(state.dayTimer);
    state.dayTimer = null;
  }
  renderRoloCard(sym);
  renderPill(sym);
}
function renderPill(sym) {
  document.querySelectorAll(`.rolo-chip[data-sym="${sym}"]`).forEach((chip) => {
    const state = tickerState.get(sym);
    const td = state && state.td;
    const price = td && td.metrics && td.metrics.price != null ? "$" + td.metrics.price.toFixed(2) : "\u2014";
    const perf = "perf-" + priceDirClass(td || null);
    chip.className = "rolo-chip " + perf + (chip.dataset.idx === String(getRoloCurrent()) ? " active" : "");
    chip.innerHTML = `<span class="rc-sym">${sym}</span><span class="rc-price">${price}</span>`;
  });
}
function deleteActiveTicker(sym) {
  vibrateTap();
  tickerState.delete(sym);
  removeTicker(sym);
}
function cardWindow() {
  return watchlist.slice(0, CARD_CAP);
}
var pillHydrationDone = Promise.resolve();
async function renderRolodexFromWatchlist() {
  document.getElementById("ticker-count").textContent = "CRF \xB7 " + watchlist.length + " TICKERS";
  const cardCountEl = document.getElementById("card-count");
  if (cardCountEl) cardCountEl.textContent = Math.min(watchlist.length, CARD_CAP) + "/" + CARD_CAP;
  const window2 = cardWindow();
  roloStage.innerHTML = "";
  window2.forEach((sym) => {
    if (!tickerState.has(sym)) tickerState.set(sym, { td: null, result: null, analyzing: false, error: null });
    const card = document.createElement("div");
    card.className = "rolo-card";
    card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });
  rebuildRoloIndex(window2, (sym, i) => {
    const chip = document.createElement("button");
    chip.className = "rolo-chip";
    chip.dataset.sym = sym;
    chip.dataset.idx = String(i);
    return chip;
  }, `\u2014 ${window2.length} \u2014`);
  window2.forEach((sym) => renderPill(sym));
  clampRoloCurrent();
  positionRoloStack();
  requestAnimationFrame(() => {
    sizeGateSpacer();
    sizeRoloMarquee();
  });
  let resolveHydration;
  pillHydrationDone = new Promise((res) => {
    resolveHydration = res;
  });
  await Promise.all(window2.map(async (sym) => {
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if (state) {
      state.td = td;
    }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(() => sizeRoloMarquee());
  }));
  resolveHydration();
  requestAnimationFrame(() => {
    sizeRoloMarquee();
    markRoloMarqueeDataReady();
  });
  renderOverflowListIfOpen();
}
function refreshRoloCards() {
  cardWindow().forEach((sym) => {
    if (tickerState.has(sym)) renderRoloCard(sym);
  });
  renderOverflowListIfOpen();
}
var PULL_TRIGGER_PX = 64;
var PULL_MAX_PX = 96;
var PULL_RESISTANCE = 0.5;
var pullPointerId = null;
var pullStartY = 0;
var pullTracking = false;
var pullRefreshing = false;
function pullIndicatorEl() {
  return document.getElementById("pullRefreshIndicator");
}
function setPullHeight(px, settle) {
  const el = pullIndicatorEl();
  if (!el) return;
  el.classList.toggle("settling", !!settle);
  el.style.height = px + "px";
}
function setPullLabel(text) {
  const el = pullIndicatorEl();
  const lbl = el ? el.querySelector(".pull-refresh-label") : null;
  if (lbl) lbl.textContent = text;
}
function resetPull() {
  pullTracking = false;
  setPullHeight(0, true);
  const el = pullIndicatorEl();
  if (el) el.classList.remove("pull-ready");
}
function onScrollerPointerDown(e) {
  if (pullRefreshing || e.pointerType === "mouse" && e.button !== 0 || isLandscapeMode()) return;
  if (scroller.scrollTop > 0) return;
  pullPointerId = e.pointerId;
  pullStartY = e.clientY;
  pullTracking = false;
}
function onScrollerPointerMove(e) {
  if (pullPointerId === null || e.pointerId !== pullPointerId || pullRefreshing) return;
  if (scroller.scrollTop > 0) {
    if (pullTracking) resetPull();
    return;
  }
  const rawDy = e.clientY - pullStartY;
  if (rawDy <= 0) {
    if (pullTracking) resetPull();
    return;
  }
  pullTracking = true;
  e.preventDefault();
  const dy = Math.min(rawDy * PULL_RESISTANCE, PULL_MAX_PX);
  setPullHeight(dy);
  const ready = dy >= PULL_TRIGGER_PX;
  const el = pullIndicatorEl();
  if (el) el.classList.toggle("pull-ready", ready);
  setPullLabel(ready ? "Release to refresh" : "Pull to refresh");
}
function onScrollerPointerUp(e) {
  if (pullPointerId === null || e.pointerId !== pullPointerId) return;
  pullPointerId = null;
  if (!pullTracking) return;
  const el = pullIndicatorEl();
  const dy = el ? parseFloat(el.style.height || "0") : 0;
  pullTracking = false;
  if (dy >= PULL_TRIGGER_PX) doPullToRefresh();
  else resetPull();
}
async function doPullToRefresh() {
  pullRefreshing = true;
  vibrateTap();
  setPullHeight(PULL_TRIGGER_PX, true);
  const el = pullIndicatorEl();
  if (el) {
    el.classList.add("refreshing");
    el.classList.remove("pull-ready");
  }
  setPullLabel("Refreshing\u2026");
  try {
    await Promise.all([
      fetchMarket(true),
      ...watchlist.map(async (sym) => {
        const td = await fetchTickerData(sym, true);
        const state = tickerState.get(sym);
        if (state) state.td = td;
      })
    ]);
    cardWindow().forEach((sym) => {
      renderRoloCard(sym);
      renderPill(sym);
    });
    renderOverflowListIfOpen();
    const proxyCard = document.querySelector('.card[data-card="proxy"]');
    if (proxyCard && proxyCard.classList.contains("expanded")) renderProxyExplorer();
    const heatCard = document.querySelector('.card[data-card="heatmap"]');
    if (heatCard && heatCard.classList.contains("expanded")) renderHeatMap();
    vibrateResult();
  } finally {
    pullRefreshing = false;
    if (el) el.classList.remove("refreshing");
    setPullHeight(0, true);
  }
}
scroller.addEventListener("pointerdown", onScrollerPointerDown);
scroller.addEventListener("pointermove", onScrollerPointerMove, { passive: false });
scroller.addEventListener("pointerup", onScrollerPointerUp);
scroller.addEventListener("pointercancel", onScrollerPointerUp);
var DIAL_POSITIONS = {
  ACTIVE_SWING: { label: "Aggressive", cadence: "Session-by-session", entries: "Opening Drive, Pre-Catalyst Buildup, post-flush", stops: "Tight (+4% / -1%)", recheck: "Every session", sizing: "Smaller, capped at HALF" },
  ACTIVE_LEAN: { label: "Light Aggressive", cadence: "Daily", entries: "Pre-Catalyst Buildup, post-flush (no Opening Drive)", stops: "Standard (+4% / -3%)", recheck: "Daily", sizing: "Standard" },
  NEUTRAL: { label: "CRF Default", cadence: "CRF default", entries: "CRF default", stops: "CRF default", recheck: "CRF default", sizing: "CRF default" },
  POSITION_LEAN: { label: "Light Passive", cadence: "2\u20133x per week", entries: "Post-flush only", stops: "Wider (-5%)", recheck: "2\u20133x per week", sizing: "Larger, fewer concurrent" },
  POSITION_LONG: { label: "Passive", cadence: "Weekly", entries: "Post-flush, full confirmation only", stops: "Widest (-8%)", recheck: "Weekly", sizing: "Largest, fewest concurrent" }
};
var DIAL_ORDER = ["ACTIVE_SWING", "ACTIVE_LEAN", "NEUTRAL", "POSITION_LEAN", "POSITION_LONG"];
function getDialPosition() {
  var v = localStorage.getItem("tv_dial_position");
  return v && DIAL_POSITIONS[v] ? v : "NEUTRAL";
}
function setDialPosition(pos) {
  if (!DIAL_POSITIONS[pos]) return;
  localStorage.setItem("tv_dial_position", pos);
  renderDialCard();
}
function renderDialCard() {
  var pos = getDialPosition();
  var d = DIAL_POSITIONS[pos];
  var n = DIAL_ORDER.length;
  var ticks = DIAL_ORDER.map(function(p, i) {
    var pct = n > 1 ? i / (n - 1) * 100 : 50;
    var active = p === pos;
    return '<button type="button" class="dial-tick' + (active ? " active" : "") + '" style="left:' + pct + '%" data-dial-pos="' + p + `" onclick="setDialPosition('` + p + `')" aria-label="` + DIAL_POSITIONS[p].label.replace(" (default)", "") + '"></button>';
  }).join("");
  var activePct = n > 1 ? DIAL_ORDER.indexOf(pos) / (n - 1) * 100 : 50;
  var labels = DIAL_ORDER.map(function(p) {
    var active = p === pos;
    return '<span class="dial-label-item' + (active ? " active" : "") + `" onclick="setDialPosition('` + p + `')">` + DIAL_POSITIONS[p].label.replace(" (default)", "") + "</span>";
  }).join("");
  var el = document.getElementById("dial-body");
  if (el) {
    el.innerHTML = '<div class="dial-track" id="dial-track"><div class="dial-thumb" id="dial-thumb" style="left:' + activePct + '%"></div>' + ticks + '</div><div class="dial-labels">' + labels + '</div><div class="track-log-title" style="margin-top:10px">' + d.label + '</div><div class="trigger-row"><span class="trigger-lbl">Monitoring cadence</span><span class="trigger-sub">' + d.cadence + '</span></div><div class="trigger-row"><span class="trigger-lbl">Entry guidance</span><span class="trigger-sub">' + d.entries + '</span></div><div class="trigger-row"><span class="trigger-lbl">Stop guidance</span><span class="trigger-sub">' + d.stops + '</span></div><div class="trigger-row"><span class="trigger-lbl">Recheck interval</span><span class="trigger-sub">' + d.recheck + '</span></div><div class="trigger-row"><span class="trigger-lbl">Position size</span><span class="trigger-sub">' + d.sizing + "</span></div>";
    wireDialDrag();
  }
}
var dialDragging = false;
function dialPosFromClientX(clientX) {
  var track = document.getElementById("dial-track");
  var n = DIAL_ORDER.length;
  if (!track || n < 2) return getDialPosition();
  var rect = track.getBoundingClientRect();
  var frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  var idx = Math.round(frac * (n - 1));
  return DIAL_ORDER[idx];
}
function wireDialDrag() {
  var track = document.getElementById("dial-track");
  var thumb = document.getElementById("dial-thumb");
  if (!track || !thumb) return;
  function onMove(e) {
    if (!dialDragging) return;
    var p = dialPosFromClientX(e.clientX);
    if (p !== getDialPosition()) setDialPosition(p);
  }
  function onUp() {
    dialDragging = false;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  }
  function onDown(e) {
    dialDragging = true;
    var p = dialPosFromClientX(e.clientX);
    if (p !== getDialPosition()) setDialPosition(p);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
  }
  thumb.addEventListener("pointerdown", onDown);
  track.addEventListener("pointerdown", function(e) {
    if (e.target === thumb) return;
    onDown(e);
  });
}
async function analyzeOne(sym, holdThroughEarnings) {
  const state = tickerState.get(sym);
  if (!state || state.analyzing) return;
  state.analyzing = true;
  state.error = null;
  state.progress = null;
  state.view = void 0;
  state.hold = !!holdThroughEarnings;
  if (state.dayTimer) {
    clearTimeout(state.dayTimer);
    state.dayTimer = null;
  }
  watchDayReads(sbSession && sbSession.token, onDayPush);
  renderRoloCard(sym);
  const td = state.td || await fetchTickerData(sym);
  state.td = td;
  if (td) renderRoloCard(sym);
  var ctx = "";
  var sc = {
    spy: market && market.spy ? market.spy.change : "?",
    qqq: market && market.qqq ? market.qqq.change : "?",
    btc: market && market.btc ? market.btc.change : "?",
    iwm: market && market.iwm ? market.iwm.change : "?",
    soxx: market && market.soxx ? market.soxx.change : "?",
    xbi: market && market.xbi ? market.xbi.change : "?",
    ibb: market && market.ibb ? market.ibb.change : "?",
    gld: market && market.gld ? market.gld.change : "?",
    uso: market && market.uso ? market.uso.change : "?",
    tsm: market && market.tsm ? market.tsm.change : "?",
    msft: market && market.msft ? market.msft.change : "?",
    gateStatus: market ? market.gateStatus || "GREEN" : "GREEN",
    gateNote: market ? market.gateNote || "" : "",
    btcSignal: market ? market.btcSignal || "neutral" : "neutral"
  };
  try {
    var res = await fetch(addSecret2(API_URL2 + "/analyze"), {
      method: "POST",
      headers: authH2(),
      body: JSON.stringify({
        ticker: sym,
        sectorContext: sc,
        marketContext: ctx,
        metricsData: td && td.metrics ? td.metrics : null,
        newsData: td && td.news ? td.news : null,
        openingBarData: td && td.openingBar ? td.openingBar : null,
        proxyRule: td && td.proxyRule ? td.proxyRule : null,
        gate1Data: td && td.gate1 ? td.gate1 : null,
        preGateData: td && td.preGate ? td.preGate : null,
        weeklyCarryoverData: td && td.weeklyCarryover ? td.weeklyCarryover : null,
        regimeData: td && td.regime ? td.regime : null,
        dialPosition: getDialPosition(),
        holdThroughEarnings: !!holdThroughEarnings,
        stream: true
        // beta accounts get gate-by-gate NDJSON; others plain JSON
      })
    });
    if (!res.ok) {
      var errData = await res.json().catch(function() {
        return {};
      });
      if (res.status === 402 && errData.code === "NO_CREDITS") {
        handleNoCredits(sym);
        fetchCreditStatus();
        state.analyzing = false;
        renderRoloCard(sym);
        renderPill(sym);
        return;
      }
      throw new Error(errData.error || "Server error " + res.status);
    }
    var ctype = res.headers.get("content-type") || "";
    var _r = ctype.indexOf("ndjson") >= 0 && res.body ? await readAnalyzeStream(res, sym, state) : await res.json();
    cacheVerdict(sym, _r);
    lastAnalysis[sym] = _r;
    state.result = _r;
    state.analyzing = false;
    vibrateResult();
    renderRoloCard(sym);
    renderPill(sym);
    fetchCreditStatus();
    onAnalysisSucceeded();
    scheduleDayCheck(sym);
  } catch (e) {
    state.analyzing = false;
    state.error = e.message;
    renderRoloCard(sym);
    renderPill(sym);
  }
}
async function readAnalyzeStream(res, sym, state) {
  state.progress = { gates: null, gateMissing: null, window: null };
  renderRoloCard(sym);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (; ; ) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "gates") {
        state.progress.gates = msg.gates;
        state.progress.gateMissing = msg.gateMissing;
        renderRoloCard(sym);
      } else if (msg.type === "gate3") {
        state.progress.window = msg.window;
        renderRoloCard(sym);
      } else if (msg.type === "final") return msg.result;
      else if (msg.type === "error") throw new Error(msg.error || "Analysis failed");
    }
    if (done) break;
  }
  throw new Error("Analysis was interrupted. You were not charged if no verdict came back.");
}
function applyDayWindow(sym, win) {
  const st = tickerState.get(sym);
  if (!st || !st.result || !win) return;
  st.result = Object.assign({}, st.result, { window: win });
  st.view = "day";
  if (st.dayTimer) {
    clearTimeout(st.dayTimer);
    st.dayTimer = null;
  }
  cacheVerdict(sym, st.result);
  lastAnalysis[sym] = st.result;
  vibrateResult();
  renderRoloCard(sym);
  renderPill(sym);
}
function onDayPush(payload) {
  if (!payload || !payload.ticker || !payload.window) return;
  const st = tickerState.get(payload.ticker);
  const w = st && dayWindow(st.result);
  if (w && w.pending) applyDayWindow(payload.ticker, payload.window);
}
function scheduleDayCheck(sym) {
  const st = tickerState.get(sym);
  const w = st && dayWindow(st.result);
  if (!st || !w || !w.pending) return;
  const wait = Math.max(5e3, Date.parse(w.readyAt) - Date.now() + 2e4);
  st.dayTimer = setTimeout(() => checkDayRead(sym, 0), wait);
}
async function checkDayRead(sym, attempt) {
  const st = tickerState.get(sym);
  const w = st && dayWindow(st.result);
  if (!st || !w || !w.pending) return;
  try {
    const url = API_URL2 + "/day/" + encodeURIComponent(sym) + "?dial=" + encodeURIComponent(getDialPosition()) + (st.hold ? "&hold=1" : "");
    const r = await fetch(addSecret2(url), { headers: authH2() });
    if (r.ok) {
      const d = await r.json();
      if (d.window && d.status !== "PENDING") {
        applyDayWindow(sym, d.window);
        return;
      }
    }
  } catch (e) {
  }
  if (attempt < 10) st.dayTimer = setTimeout(() => checkDayRead(sym, attempt + 1), 6e4);
}
function retryWithEarningsHoldThrough(sym) {
  const state = tickerState.get(sym);
  if (state) state.result = null;
  analyzeOne(sym, true);
}
function analyzeAll() {
  const list = cardWindow();
  if (list.length) goRolo(0);
  list.forEach((sym) => analyzeOne(sym));
}
function handleNoCredits(sym) {
  const state = tickerState.get(sym);
  const cached = getCachedVerdict(sym);
  if (cached) {
    state.result = cached;
    state.error = null;
    renderRoloCard(sym);
    return;
  }
  state.error = "No credits remaining \u2014 buy more or upgrade to Shark.";
}
var compactSortDir = 1;
function toggleCompactSort() {
  compactSortDir = -compactSortDir;
  var btn = document.getElementById("compact-sort-btn");
  if (btn) btn.textContent = compactSortDir === 1 ? "\u25B2" : "\u25BC";
  renderOverflowList();
}
function overflowTickers() {
  return watchlist.slice(CARD_CAP);
}
function renderOverflowListIfOpen() {
  var card = document.querySelector('.card[data-card="watchlist"]');
  if (card && card.classList.contains("expanded")) renderOverflowList();
  var countEl = document.getElementById("compact-count");
  if (countEl) countEl.textContent = String(overflowTickers().length);
}
var compactGesturesBound = false;
async function renderOverflowList() {
  var el = document.getElementById("watchlist-compact");
  if (!el) return;
  var overflow = overflowTickers();
  var countEl = document.getElementById("compact-count");
  if (countEl) countEl.textContent = String(overflow.length);
  if (!overflow.length) {
    el.innerHTML = '<div class="track-empty">Everything tracked fits in the top ' + CARD_CAP + " cards.</div>";
    return;
  }
  el.innerHTML = '<div class="track-empty text-pulse">Loading watchlist\u2026</div>';
  var rows = await Promise.all(overflow.map(async function(t) {
    var td = await fetchTickerData(t);
    return { ticker: t, price: td && td.metrics && td.metrics.price != null ? td.metrics.price : null, pct: td && td.metrics && typeof td.metrics.pct === "number" ? td.metrics.pct : null, news: td && td.news };
  }));
  rows.sort(function(a, b) {
    var pa = a.pct == null ? compactSortDir === 1 ? Infinity : -Infinity : a.pct;
    var pb = b.pct == null ? compactSortDir === 1 ? Infinity : -Infinity : b.pct;
    return (pa - pb) * compactSortDir;
  });
  var ctxEl = document.getElementById("context-input");
  var ctxVal = ctxEl ? ctxEl.value : "";
  el.innerHTML = rows.map(function(r) {
    var t = r.ticker;
    var hasNews = r.news && r.news.ageHours <= 300;
    return '<div class="compact-row-wrap" data-ticker="' + t + '"><div class="compact-swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div><div class="compact-row"><div class="compact-row-main"><div class="compact-row-top"><span class="compact-ticker" style="color:' + (r.pct != null ? pctColor(r.pct) : "var(--ink)") + '"><a class="ticker-a" href="' + tickerHref(t) + '" target="_blank">' + t + '</a></span><span class="compact-price" style="color:' + (r.pct != null ? pctColor(r.pct) : "var(--ink)") + '">' + (r.price != null ? "$" + r.price.toFixed(2) : "&mdash;") + '</span><span class="compact-pct" style="color:' + (r.pct != null ? pctColor(r.pct) : "var(--ink-dim)") + '">' + (r.pct != null ? fmtPct(r.pct) : "&mdash;") + '</span></div><div class="compact-news"' + (hasNews ? "" : ' style="display:none"') + ">" + (hasNews ? wrapHeadlineLinks(t, autoLinkGlossaryTerms(highlightContextMatches(r.news.headline, ctxVal))) : "") + '</div></div><button type="button" class="compact-plus-btn" title="Add as card" data-promote="' + t + '">+</button></div></div>';
  }).join("");
  el.querySelectorAll("[data-promote]").forEach((btn) => btn.addEventListener("click", () => promoteToCard(btn.dataset.promote)));
  bindCompactGestures();
}
function promoteToCard(ticker) {
  var idx = watchlist.indexOf(ticker);
  if (idx < 0 || idx < CARD_CAP) return;
  var arr = watchlist.slice();
  arr.splice(idx, 1);
  arr.splice(CARD_CAP - 1, 0, ticker);
  setWatchlist(arr);
}
var COMPACT_MOVE_THRESHOLD = 14;
var compactActive = null;
function bindCompactGestures() {
  if (compactGesturesBound) return;
  var el = document.getElementById("watchlist-compact");
  if (!el) return;
  compactGesturesBound = true;
  el.addEventListener("pointerdown", onCompactPointerDown);
}
function onCompactPointerDown(e) {
  if (compactActive) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  var wrap = e.target.closest(".compact-row-wrap");
  if (!wrap) return;
  var row = wrap.querySelector(".compact-row");
  if (!row) return;
  compactActive = { pointerId: e.pointerId, wrap, row, ticker: wrap.dataset.ticker, startX: e.clientX, startY: e.clientY, dragging: false, pendingDx: 0, swipeBg: wrap.querySelector(".compact-swipe-bg") };
  document.addEventListener("pointermove", onCompactPointerMove, { passive: false });
  document.addEventListener("pointerup", onCompactPointerUp);
  document.addEventListener("pointercancel", onCompactPointerUp);
}
function compactDeleteThreshold(wrap) {
  return Math.min(120, wrap.getBoundingClientRect().width * 0.35);
}
function onCompactPointerMove(e) {
  var g = compactActive;
  if (!g || e.pointerId !== g.pointerId) return;
  var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (!g.dragging) {
    if (Math.abs(dx) > COMPACT_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.dragging = true;
      try {
        g.wrap.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      g.row.style.transition = "none";
      g.wrap.classList.add("swiping");
    } else if (Math.abs(dy) > COMPACT_MOVE_THRESHOLD) {
      endCompactGesture();
      return;
    } else return;
  }
  e.preventDefault();
  var clamped = Math.min(0, Math.max(dx, -g.wrap.getBoundingClientRect().width));
  g.row.style.transform = "translateX(" + clamped + "px)";
  var progress = Math.min(Math.abs(clamped) / compactDeleteThreshold(g.wrap), 1);
  g.swipeBg.style.opacity = String(progress);
  g.pendingDx = clamped;
}
function onCompactPointerUp(e) {
  var g = compactActive;
  if (!g || e.pointerId !== g.pointerId) return;
  var threshold = compactDeleteThreshold(g.wrap);
  if (g.dragging && Math.abs(g.pendingDx) >= threshold) {
    var wrap = g.wrap, ticker = g.ticker, w = wrap.getBoundingClientRect().width;
    g.row.style.transition = "transform .18s ease-in";
    g.row.style.transform = "translateX(-" + (w + 40) + "px)";
    wrap.style.overflow = "hidden";
    wrap.style.transition = "max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s";
    requestAnimationFrame(function() {
      wrap.style.maxHeight = "0px";
      wrap.style.opacity = "0";
      wrap.style.marginTop = "0px";
      wrap.style.marginBottom = "0px";
    });
    setTimeout(function() {
      removeTicker(ticker);
    }, 220);
  } else if (g.dragging) {
    g.row.style.transition = "transform .18s ease";
    g.row.style.transform = "translateX(0)";
    g.swipeBg.style.opacity = "0";
    g.wrap.classList.remove("swiping");
  }
  endCompactGesture();
}
function endCompactGesture() {
  var g = compactActive;
  if (g) {
    try {
      g.wrap.releasePointerCapture(g.pointerId);
    } catch (err) {
    }
  }
  compactActive = null;
  document.removeEventListener("pointermove", onCompactPointerMove);
  document.removeEventListener("pointerup", onCompactPointerUp);
  document.removeEventListener("pointercancel", onCompactPointerUp);
}
var COHERENCE_FLAT_BAND_PCT = 1;
var COHERENCE_DECOUPLE_PCT = 2;
function classifyCoherence(tickerPct, proxyPct) {
  if (Math.abs(tickerPct) <= COHERENCE_FLAT_BAND_PCT) return { label: "LAG RISK", color: "var(--amber)" };
  var proxyDown = proxyPct < 0;
  var opposite = proxyDown && tickerPct > 0 || !proxyDown && tickerPct < 0;
  if (opposite && Math.abs(tickerPct) >= COHERENCE_DECOUPLE_PCT) return { label: "DECOUPLING", color: "var(--red)" };
  return { label: "TRACKING", color: "var(--green)" };
}
function tickerLink(symbol) {
  return `<a href="${tickerHref(symbol)}" target="_blank" class="proxy-verify-link">${symbol}</a>`;
}
var TIER_RANK = { primary: 0, candidate: 1, secondary: 2, "fundamentals-confirmed": 3, "fundamentals-speculative": 4 };
var COHERENCE_RANK = { TRACKING: 0, "LAG RISK": 1, DECOUPLING: 2 };
var proxySort = { key: null, dir: 1 };
function setProxySort(key) {
  if (proxySort.key === key) proxySort.dir = -proxySort.dir;
  else {
    proxySort.key = key;
    proxySort.dir = 1;
  }
  updateProxySortButtons();
  renderProxyExplorer();
}
function updateProxySortButtons() {
  ["level", "coherence"].forEach(function(k) {
    var btn = document.getElementById("proxy-sort-" + k);
    if (!btn) return;
    var active = proxySort.key === k;
    var arrow = btn.querySelector(".sort-arrow");
    if (arrow) arrow.textContent = active ? proxySort.dir === 1 ? "\u25B2" : "\u25BC" : "\u21C5";
    btn.classList.toggle("sort-btn-active", active);
  });
}
function sortByRank(rows, rankFn, dir) {
  rows.sort(function(a, b) {
    var ra = rankFn(a), rb = rankFn(b);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return (ra - rb) * dir;
  });
}
var proxyExplorerGen = 0;
async function renderProxyExplorer(force) {
  var body = document.getElementById("proxy-explorer-body");
  if (!body) return;
  if (!watchlist.length) {
    body.innerHTML = '<div class="track-empty">Watchlist is empty.</div>';
    return;
  }
  body.innerHTML = '<div class="track-empty text-pulse">Loading proxy resolutions\u2026</div>';
  await pillHydrationDone;
  if (!watchlist.length) return;
  var myGen = ++proxyExplorerGen;
  var priority = cardWindow();
  var rest = overflowTickers();
  var resultsByTicker = {};
  async function buildRow(t) {
    var td = await fetchTickerData(t, force);
    var rule = td && td.proxyRule;
    var tickerPct = td && td.metrics ? td.metrics.pct : null;
    var liveSymbols = rule && rule.proxy ? (rule.proxy.symbols || []).filter((s) => market && market[s.toLowerCase()] && typeof market[s.toLowerCase()].pct === "number") : [];
    var coherence = null;
    if (rule && rule.proxy && typeof tickerPct === "number" && liveSymbols.length) {
      var proxyPcts = liveSymbols.map((s) => market[s.toLowerCase()].pct);
      var avgProxyPct = proxyPcts.reduce((a, b) => a + b, 0) / proxyPcts.length;
      coherence = classifyCoherence(tickerPct, avgProxyPct);
    }
    return { ticker: t, rule, tickerPct, tier: rule ? rule.tier || "primary" : null, liveSymbols, coherence };
  }
  function paint() {
    if (myGen !== proxyExplorerGen) return;
    var rows = watchlist.filter((t) => resultsByTicker[t]).map((t) => resultsByTicker[t]);
    if (proxySort.key === "level") sortByRank(rows, (r) => r.tier != null ? TIER_RANK[r.tier] : null, proxySort.dir);
    else if (proxySort.key === "coherence") sortByRank(rows, (r) => r.coherence ? COHERENCE_RANK[r.coherence.label] : null, proxySort.dir);
    var tierColor = { primary: "var(--green)", candidate: "var(--purple)", secondary: "var(--amber)", "fundamentals-confirmed": "var(--blue)", "fundamentals-speculative": "var(--red)" };
    body.innerHTML = rows.map((r) => {
      if (!r.rule || !r.rule.proxy) return `<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">${tickerLink(r.ticker)}</span><span class="analyst-val" style="color:var(--ink-dim)">unavailable</span></div></div>`;
      var tier = r.tier || "primary";
      var tc = tierColor[tier] || "var(--ink-dim)";
      var verifyLinks = [tickerLink(r.ticker)].concat((r.rule.proxy.symbols || []).map(tickerLink)).join(" &middot; ");
      var coherenceHtml;
      if (!r.coherence) {
        coherenceHtml = '<div class="proxy-coherence"><span class="analyst-lbl">LIVE COHERENCE</span><span class="analyst-val" style="color:var(--ink-dim)">no live feed for this proxy</span></div>';
      } else {
        var chips = r.liveSymbols.map((s) => {
          var p = market[s.toLowerCase()].pct;
          return `<span class="proxy-live-chip">${tickerLink(s)} <b style="color:${pctColor(p)}">${fmtPct(p)}</b></span>`;
        }).join("");
        coherenceHtml = `<div class="proxy-coherence"><div class="analyst-row" style="padding:0"><span class="analyst-lbl">LIVE COHERENCE</span><span class="proxy-tier-badge" style="color:${r.coherence.color};border-color:${r.coherence.color}55;background:${r.coherence.color}11">${r.coherence.label}</span></div><div class="proxy-live-row"><span class="proxy-live-chip">${tickerLink(r.ticker)} <b style="color:${pctColor(r.tickerPct)}">${fmtPct(r.tickerPct)}</b></span>${chips}</div></div>`;
      }
      return `<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">${tickerLink(r.ticker)}</span><span class="proxy-tier-badge" style="color:${tc};border-color:${tc}55;background:${tc}11">${tier.toUpperCase().replace(/-/g, " ")}</span></div><div class="proxy-detail">${r.rule.proxy.name}</div><div class="proxy-detail" style="color:var(--ink-dim)">${r.rule.category || ""}${r.rule.dynamicallyResolved ? " \xB7 dynamically resolved (quarterly recompute)" : " \xB7 fixed sector proxy"}</div>` + (r.rule.proxy.rationale ? `<div class="proxy-detail">${r.rule.proxy.rationale}</div>` : "") + `<div class="proxy-verify-row"><span class="analyst-lbl">VERIFY</span>${verifyLinks}</div>` + coherenceHtml + "</div>";
    }).join("") + (rest.length && rows.length < watchlist.length ? `<div class="track-empty text-pulse">Loading ${watchlist.length - rows.length} more\u2026</div>` : "") + '<div class="proxy-shark-tease"><a href="../shark/coming-soon.html">&#9889; SHARK &mdash; real-time Alpaca data &amp; deeper proxy analytics &rarr;</a></div>';
  }
  await Promise.all(priority.map(async (t) => {
    resultsByTicker[t] = await buildRow(t);
  }));
  paint();
  rest.forEach((t) => {
    buildRow(t).then((row) => {
      resultsByTicker[t] = row;
      paint();
    });
  });
}
function refreshProxyExplorer() {
  renderProxyExplorer(true);
}
async function renderScorecardCard() {
  var el = document.getElementById("scorecard-body");
  if (!el) return;
  el.innerHTML = '<div class="track-empty text-pulse">Loading...</div>';
  try {
    var res = await fetch(addSecret2(API_URL2 + "/scorecard"), { headers: authH2() });
    if (res.status === 403) {
      el.innerHTML = '<div class="track-empty">Scorecard not available on this tier yet.</div>';
      return;
    }
    var data = await res.json();
    if (data.insufficientData) {
      el.innerHTML = '<div class="track-empty">Accumulating \u2014 ' + (data.gradedCount || 0) + "/20 graded UP/DOWN verdicts so far. Check back once more verdicts have been scored.</div>";
      return;
    }
    var pctColor2 = (p) => p >= 65 ? "var(--green)" : p >= 50 ? "var(--amber)" : "var(--red)";
    var proofHTML = (w, pf) => {
      if (!pf) return "";
      var out = '<div class="sc-tile-proof">&plusmn;' + pf.margin + " pts</div>";
      if (pf.alwaysUpPct == null) return out;
      var gap = w.pct - pf.alwaysUpPct;
      var verdict = gap > pf.margin ? ["beats it", "var(--green)"] : gap < -pf.margin ? ["trails it", "var(--red)"] : ["not proven yet", "var(--amber)"];
      return out + '<div class="sc-tile-proof">Always-UP ' + pf.alwaysUpPct + '% &middot; <span style="color:' + verdict[1] + '">' + verdict[0] + "</span></div>";
    };
    var tile = (label, w, pf) => '<div class="sc-tile"><div class="sc-tile-lbl">' + label + "</div>" + (w && w.pct != null ? '<div class="sc-tile-val" style="color:' + pctColor2(w.pct) + '">' + w.pct + '%</div><div class="sc-tile-sub">' + w.gradedCount + " graded</div>" + proofHTML(w, pf) : '<div class="sc-tile-val" style="font-size:12px;color:var(--ink-dim)">' + (w ? w.gradedCount : 0) + "/20 graded</div>") + "</div>";
    var proof = data.proof || {};
    var html = '<div class="sc-head-row"><div class="track-log-title" style="margin:0">VERDICT ACCURACY</div><span class="sc-pooled-badge">Pooled &middot; all users</span></div><div class="sc-tile-grid">' + tile("Day trade", data.day, proof.day) + tile("Long (5 days)", data.long, proof.long) + "</div>";
    var cell = (w) => w && w.pct != null ? '<span class="sc-split-val" style="color:' + pctColor2(w.pct) + '">' + w.pct + "%</span>" : '<span class="sc-split-val" style="color:var(--ink-dim)">\u2014</span>';
    var b = data.breakdown || {};
    var splitRow = (label, r) => '<div class="sc-split"><span class="trigger-lbl">' + label + "</span>" + cell(r && r.day) + cell(r && r.long) + "</div>";
    html += '<div class="sc-split sc-split-head"><span></span><span>DAY</span><span>LONG</span></div>' + splitRow("UP calls", b.up) + splitRow("DOWN calls", b.down) + splitRow("FLAT calls", b.flat);
    if (data.topTickers && data.topTickers.length) {
      var topRows = data.topTickers.map(
        (t) => '<div class="trigger-row"><span class="trigger-lbl"><a class="ticker-a" href="' + tickerHref(t.ticker) + '" target="_blank">' + t.ticker + '</a></span><span class="trigger-val" style="color:' + pctColor2(t.pct) + '">' + t.pct + '%</span><span class="trigger-sub">' + t.gradedCount + "</span></div>"
      ).join("");
      html += '<div class="track-log-title" style="margin-top:12px">TOP TICKERS (POOLED)</div>' + topRows;
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="track-empty">Scorecard unavailable right now.</div>';
  }
}
function factorGaugeHTML(val) {
  var pct = Math.max(0, Math.min(100, val));
  var label = val >= 66 ? "High" : val >= 34 ? "Medium" : "Low";
  return '<div class="factor-gauge" role="img" aria-label="' + label + '"><div class="factor-gauge-bar"><span class="fg-seg fg-green"></span><span class="fg-seg fg-amber"></span><span class="fg-seg fg-red"></span></div><div class="factor-gauge-arrow" style="left:' + pct + '%"></div></div>';
}
function agitatorFactorRow(label, helpKey, val) {
  var helpBtn = '<button type="button" class="help-btn" data-help="' + helpKey + '" aria-label="What is this?">?</button>';
  var lblHTML = '<span class="trigger-lbl-wrap"><span class="trigger-lbl">' + label + "</span>" + helpBtn + "</span>";
  if (val == null) return '<div class="trigger-row">' + lblHTML + '<span class="trigger-sub">n/a</span></div>';
  return '<div class="trigger-row">' + lblHTML + factorGaugeHTML(val) + "</div>";
}
function addTickerBtnHTML(symbol) {
  var already = watchlist.includes(symbol);
  return '<button type="button" class="compact-plus-btn" data-add-ticker="' + symbol + '"' + (already ? ' disabled title="Already on your watchlist">\u2713' : ' title="Add ' + symbol + ' to watchlist">+') + "</button>";
}
function wireAgitatorAddButtons(scope) {
  scope.querySelectorAll("[data-add-ticker]").forEach(function(b) {
    b.addEventListener("click", function() {
      var sym = b.dataset.addTicker;
      addKnownTicker(sym);
      if (watchlist.includes(sym)) {
        b.disabled = true;
        b.textContent = "\u2713";
        b.setAttribute("aria-label", "Already on your watchlist");
      }
    });
  });
}
function relatedRowHTML(c) {
  var t = c.symbol;
  var color = c.direction === "green" ? "var(--green)" : c.direction === "red" ? "var(--red)" : "var(--amber)";
  var hasNews = !!(c.news && c.news.ageHours <= 300);
  var ctxEl = document.getElementById("context-input");
  var ctxVal = ctxEl ? ctxEl.value : "";
  return '<div class="compact-row-wrap" data-ticker="' + t + '"><div class="compact-row"><div class="compact-row-main"><div class="compact-row-top"><span class="compact-ticker" style="color:' + color + '"><a class="ticker-a" href="' + tickerHref(t) + '" target="_blank">' + t + '</a></span><span class="compact-price" style="color:' + color + '">' + (c.price ? "$" + c.price : "&mdash;") + '</span><span class="compact-pct" style="color:' + color + '">' + (c.change || "&mdash;") + '</span></div><div class="compact-news"' + (hasNews ? "" : ' style="display:none"') + ">" + (hasNews ? wrapHeadlineLinks(t, autoLinkGlossaryTerms(highlightContextMatches(c.news.headline, ctxVal))) : "") + "</div></div>" + addTickerBtnHTML(t) + "</div></div>";
}
function topicalCompanyRowHTML(c) {
  var color = c.reactionPct == null ? "var(--ink-dim)" : c.reactionPct > 0 ? "var(--green)" : c.reactionPct < 0 ? "var(--red)" : "var(--amber)";
  var pctLabel = c.reactionPct == null ? "no data" : (c.reactionPct > 0 ? "+" : "") + c.reactionPct.toFixed(2) + "% since publish";
  return '<div class="compact-row-wrap" data-ticker="' + c.symbol + '"><div class="compact-row"><div class="compact-row-main"><div class="compact-row-top"><span class="compact-ticker" style="color:' + color + '"><a class="ticker-a" href="' + tickerHref(c.symbol) + '" target="_blank">' + c.symbol + '</a></span><span class="compact-pct" style="color:' + color + '">' + pctLabel + "</span></div></div>" + addTickerBtnHTML(c.symbol) + "</div></div>";
}
async function runAgitatorCheck() {
  vibrateTap();
  var qEl = document.getElementById("agitator-query");
  var btn = document.getElementById("agitatorCheckBtn");
  var out = document.getElementById("agitator-body");
  if (!out) return;
  var q = qEl.value.trim();
  if (!q) {
    out.innerHTML = '<div class="track-empty">Type a ticker, company name, or paste a headline first.</div>';
    return;
  }
  btn.disabled = true;
  btn.classList.add("btn-running");
  btn.textContent = "CHECKING\u2026";
  out.innerHTML = '<div class="track-empty text-pulse">Loading...</div>';
  try {
    var url = API_URL2 + "/agitator?q=" + encodeURIComponent(q) + "&watchlist=" + encodeURIComponent(watchlist.join(","));
    var res = await fetch(addSecret2(url), { headers: authH2() });
    if (res.status === 403) {
      out.innerHTML = '<div class="track-empty">Agitator Gauge not available on this tier yet.</div>';
      return;
    }
    if (res.status === 429) {
      out.innerHTML = '<div class="track-empty">Too many checks this hour \u2014 try again later.</div>';
      return;
    }
    var data = await res.json();
    if (data.commodity) {
      var cm = data.commodity;
      var spotHTML = typeof cm.price === "number" ? '<div class="headline" style="margin-top:8px">' + cm.name + " (" + cm.code + ') \u2014 <a href="' + cm.url + '" target="_blank">$' + cm.price.toFixed(2) + " / " + cm.unit + "</a></div>" : "";
      var proxyHTML = cm.proxyPrice != null ? '<div class="headline" style="margin-top:' + (spotHTML ? "4px" : "8px") + '">Tradable proxy: <a href="' + tickerHref(cm.proxyTicker) + '" target="_blank">' + cm.proxyTicker + "</a> $" + cm.proxyPrice + (cm.proxyChange ? " (" + cm.proxyChange + ")" : "") + "</div>" : "";
      if (!spotHTML && !proxyHTML) {
        out.innerHTML = '<div class="track-empty">Live price for ' + cm.name + " is unavailable right now.</div>";
        return;
      }
      var cmComp = cm.composite;
      var cmGaugeColor = !cmComp ? "var(--ink-dim)" : cmComp.level === "HIGH" ? "var(--red)" : cmComp.level === "MEDIUM" ? "var(--amber)" : "var(--green)";
      var cmGaugeHTML = '<div class="trigger-row" style="margin-top:8px"><span class="trigger-lbl-wrap"><span class="trigger-lbl"><a href="' + tickerHref(cm.proxyTicker) + '" target="_blank">' + cm.proxyTicker + '</a></span></span><span class="trigger-val-wrap"><span class="trigger-val" style="color:' + cmGaugeColor + '">' + (cmComp ? cmComp.level : "N/A") + '</span><button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span><span class="trigger-sub">' + (cmComp ? Math.round(cmComp.score / 10) + "/10" : "no data") + "</span></div>";
      var cmf = cm.factors;
      var cmFactorsHTML = cmf ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>' + agitatorFactorRow("Surprise", "agitator-surprise", cmf.surprise ?? null) + agitatorFactorRow("Uncertainty", "agitator-uncertainty", cmf.uncertainty ?? null) + agitatorFactorRow("Freshness", "agitator-freshness", cmf.freshness ?? null) + agitatorFactorRow("Ripple Effect", "agitator-ripple", cmf.rippleEffect ?? null) + agitatorFactorRow("Swing Risk", "agitator-swing", cmf.swingRisk ?? null) + agitatorFactorRow("Expected Move", "agitator-expected-move", cmf.expectedMove ?? null) : "";
      var cmNewsHTML = '<div class="headline" style="margin-top:8px">' + (cm.news ? cm.news.url ? '<a href="' + cm.news.url + '" target="_blank">' + cm.news.headline + "</a>" : cm.news.headline : '<span style="opacity:.6">No recent related news found.</span>') + "</div>";
      var cmRelatedHTML = '<div class="track-log-title" style="margin-top:10px">RELATED</div>' + (cm.related && cm.related.length ? '<div class="compact-list">' + cm.related.map(relatedRowHTML).join("") + "</div>" : '<div class="track-empty">No related companies found.</div>');
      out.innerHTML = '<div class="track-log-title">SPOT PRICE</div>' + spotHTML + proxyHTML + '<div class="track-empty" style="margin-top:6px">' + (spotHTML ? "Live commodity spot price." : cm.name + " spot price unavailable \u2014 showing its tradable proxy instead.") + "</div>" + cmGaugeHTML + cmNewsHTML + cmFactorsHTML + cmRelatedHTML;
      vibrateResult();
      wireAgitatorAddButtons(out);
      snapCardUnderDock(document.getElementById("card-agitator"));
      return;
    }
    if (!data.resolved) {
      var suggestionHTML = "";
      if (data.suggestion) {
        suggestionHTML = '<div class="track-empty" id="agitatorSuggestBanner" style="margin-bottom:8px">Did you mean <strong>' + data.suggestion.company + "</strong> (" + data.suggestion.ticker + ')? <button type="button" class="btn-compact" id="agitatorSuggestYes" data-ticker="' + data.suggestion.ticker + '">Yes</button> <button type="button" class="btn-compact" id="agitatorSuggestNo">Cancel</button></div>';
      }
      var topical = data.topical;
      var topicalHTML = "";
      if (topical) {
        var sentColor = topical.sentiment === "BULLISH" ? "var(--green)" : topical.sentiment === "BEARISH" ? "var(--red)" : "var(--amber)";
        var tComp = topical.composite;
        var tGaugeColor = !tComp ? "var(--ink-dim)" : tComp.level === "HIGH" ? "var(--red)" : tComp.level === "MEDIUM" ? "var(--amber)" : "var(--green)";
        var tPrimary = topical.companies && topical.companies.length ? topical.companies[0] : null;
        var tTickerLabel = tPrimary ? '<a href="' + tickerHref(tPrimary.symbol) + '" target="_blank">' + tPrimary.symbol + "</a>" : "---";
        var tGaugeHTML = '<div class="trigger-row"><span class="trigger-lbl-wrap"><span style="width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;background:' + sentColor + '"></span><span class="trigger-lbl">' + tTickerLabel + '</span></span><span class="trigger-val-wrap"><span class="trigger-val" style="color:' + tGaugeColor + '">' + (tComp ? tComp.level : "N/A") + '</span><button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span><span class="trigger-sub">' + topical.sentiment + (tComp ? " \xB7 " + Math.round(tComp.score / 10) + "/10" : "") + "</span></div>";
        var tHeadlineHTML = '<div class="headline" style="margin-top:8px"><a href="' + topical.url + '" target="_blank">' + topical.summary + "</a></div>";
        var tf = topical.factors;
        var tFactorsHTML = tf ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>' + agitatorFactorRow("Surprise", "agitator-surprise", tf.surprise ?? null) + agitatorFactorRow("Uncertainty", "agitator-uncertainty", tf.uncertainty ?? null) + agitatorFactorRow("Freshness", "agitator-freshness", tf.freshness ?? null) + agitatorFactorRow("Ripple Effect", "agitator-ripple", tf.rippleEffect ?? null) + agitatorFactorRow("Swing Risk", "agitator-swing", tf.swingRisk ?? null) + agitatorFactorRow("Expected Move", "agitator-expected-move", tf.expectedMove ?? null) : "";
        var tCompaniesHTML = '<div class="track-log-title" style="margin-top:10px">RELATED</div>' + (topical.companies && topical.companies.length ? '<div class="compact-list">' + topical.companies.map(topicalCompanyRowHTML).join("") + "</div>" : '<div class="track-empty">No related companies found.</div>');
        topicalHTML = tGaugeHTML + tHeadlineHTML + tFactorsHTML + tCompaniesHTML;
      } else {
        topicalHTML = '<div class="track-empty">Couldn\u2019t find a company for "' + q + '".</div>';
      }
      out.innerHTML = suggestionHTML + topicalHTML;
      vibrateResult();
      var yesBtn = document.getElementById("agitatorSuggestYes");
      if (yesBtn) yesBtn.addEventListener("click", function() {
        qEl.value = yesBtn.dataset.ticker || "";
        runAgitatorCheck();
      });
      var noBtn = document.getElementById("agitatorSuggestNo");
      if (noBtn) noBtn.addEventListener("click", function() {
        var banner = document.getElementById("agitatorSuggestBanner");
        if (banner) banner.remove();
      });
      wireAgitatorAddButtons(out);
      return;
    }
    var comp = data.composite;
    var gaugeColor = !comp ? "var(--ink-dim)" : comp.level === "HIGH" ? "var(--red)" : comp.level === "MEDIUM" ? "var(--amber)" : "var(--green)";
    var tq = data.tickerQuote;
    var tqColor = !tq ? "" : tq.direction === "green" ? "var(--green)" : tq.direction === "red" ? "var(--red)" : "var(--amber)";
    var tqHTML = tq ? '<span class="tq-price">$' + tq.price + '</span><span class="tq-chg" style="color:' + tqColor + '">' + tq.change + "</span>" : "";
    var gaugeHTML = '<div class="trigger-row"><span class="trigger-lbl-wrap"><span class="trigger-lbl"><a href="' + tickerHref(data.symbol) + '" target="_blank">' + data.symbol + "</a></span>" + tqHTML + addTickerBtnHTML(data.symbol) + '</span><span class="trigger-val-wrap"><span class="trigger-val" style="color:' + gaugeColor + '">' + (comp ? comp.level : "N/A") + '</span><button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span><span class="trigger-sub">' + (comp ? Math.round(comp.score / 10) + "/10 avg. of 6 signals" : "no data") + "</span></div>";
    var f = data.factors;
    var factorsHTML = f ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>' + agitatorFactorRow("Surprise", "agitator-surprise", f.surprise) + agitatorFactorRow("Uncertainty", "agitator-uncertainty", f.uncertainty) + agitatorFactorRow("Freshness", "agitator-freshness", f.positioning) + agitatorFactorRow("Ripple Effect", "agitator-ripple", f.crossAsset) + agitatorFactorRow("Swing Risk", "agitator-swing", f.liquidity) + agitatorFactorRow("Expected Move", "agitator-expected-move", f.ivEnvironment) + agitatorFactorRow("Past Reactions", "agitator-past", f.historicalReaction) : "";
    var headlineHTML = '<div class="headline" style="margin-top:8px">' + (data.headlineUsed ? data.headlineUsedUrl ? '<a href="' + data.headlineUsedUrl + '" target="_blank">' + data.headlineUsed + "</a>" : data.headlineUsed : '<span style="opacity:.6">No recent related news found.</span>') + "</div>";
    var compsHTML = '<div class="track-log-title" style="margin-top:10px">RELATED</div>' + (data.comps && data.comps.length ? '<div class="compact-list">' + data.comps.map(relatedRowHTML).join("") + "</div>" : '<div class="track-empty">No related companies found.</div>');
    out.innerHTML = gaugeHTML + headlineHTML + factorsHTML + compsHTML;
    vibrateResult();
    wireAgitatorAddButtons(out);
    snapCardUnderDock(document.getElementById("card-agitator"));
  } catch (e) {
    out.innerHTML = '<div class="track-empty">Agitator Gauge unavailable right now.</div>';
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-running");
    btn.textContent = "Check Aggression";
  }
}
var HEATMAP_SECTORS = [["spy", "SPY"], ["qqq", "QQQ"], ["iwm", "IWM"], ["xbi", "XBI"], ["soxx", "SOXX"], ["tsm", "TSM"], ["msft", "MSFT"], ["btc", "BTC"], ["gld", "GLD"], ["uso", "USO"]];
var HEATMAP_MAX_PCT = 3;
function heatTileHtml(label, pct, ticker) {
  var tagAttr = ticker ? ` data-ticker="${ticker}"` : "";
  if (typeof pct !== "number") return `<div class="heat-tile heat-tile-empty"${tagAttr}><span class="heat-tile-lbl"><a class="ticker-a" href="${tickerHref(label)}" target="_blank">${label}</a></span><span class="heat-tile-val">?</span></div>`;
  var intensity = Math.min(Math.abs(pct) / HEATMAP_MAX_PCT, 1);
  var rgb = pct >= 0 ? "0,230,118" : pct < 0 ? "255,59,92" : "96,125,139";
  var bg = `rgba(${rgb},${(0.08 + intensity * 0.32).toFixed(2)})`;
  var border = `rgba(${rgb},${(0.25 + intensity * 0.5).toFixed(2)})`;
  return `<div class="heat-tile" style="background:${bg};border-color:${border}"${tagAttr}><span class="heat-tile-lbl"><a class="ticker-a" href="${tickerHref(label)}" target="_blank">${label}</a></span><span class="heat-tile-val">${fmtPct(pct)}</span></div>`;
}
var heatMapGen = 0;
async function renderHeatMap(force) {
  var sectorEl = document.getElementById("heatmap-sectors");
  var wlEl = document.getElementById("heatmap-watchlist");
  if (!sectorEl || !wlEl) return;
  sectorEl.innerHTML = HEATMAP_SECTORS.map(([key, label]) => {
    var d = market && market[key];
    return heatTileHtml(label, d && typeof d.pct === "number" ? d.pct : null);
  }).join("");
  if (!watchlist.length) {
    wlEl.innerHTML = '<div class="track-empty">Watchlist is empty.</div>';
    return;
  }
  var myGen = ++heatMapGen;
  wlEl.innerHTML = watchlist.map((t) => heatTileHtml(t, null, t)).join("");
  function paintTile(t, pct) {
    if (myGen !== heatMapGen) return;
    var el = wlEl.querySelector(`[data-ticker="${t}"]`);
    if (!el) return;
    el.outerHTML = heatTileHtml(t, pct, t);
  }
  await pillHydrationDone;
  if (myGen !== heatMapGen) return;
  var priority = cardWindow();
  var rest = overflowTickers();
  await Promise.all(priority.map(async (t) => {
    var td = await fetchTickerData(t, force);
    paintTile(t, td && td.metrics ? td.metrics.pct : null);
  }));
  rest.forEach((t) => {
    fetchTickerData(t, force).then((td) => paintTile(t, td && td.metrics ? td.metrics.pct : null));
  });
}
function refreshHeatMap() {
  renderHeatMap(true);
}
async function exportWatchlistCSV(btnEl) {
  if (!watchlist.length) return alert("Watchlist is empty \u2014 nothing to export.");
  var old = null;
  if (btnEl) {
    old = btnEl.textContent;
    btnEl.textContent = "EXPORTING\u2026";
    btnEl.disabled = true;
  }
  var rows = await Promise.all(watchlist.map(async function(t, i) {
    var td = await fetchTickerData(t);
    var price = td && td.metrics && td.metrics.price != null ? td.metrics.price : "";
    var pct = td && td.metrics && typeof td.metrics.pct === "number" ? td.metrics.pct.toFixed(2) : "";
    var iv = td && typeof td.iv === "number" ? (td.iv * 100).toFixed(1) + "%" : "N/A";
    return [t, i < CARD_CAP ? "CARD" : "WATCHLIST", price, iv, pct];
  }));
  var csvEsc = function(v) {
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var csv = [["Ticker", "List", "Price", "IV", "Change%"]].concat(rows).map(function(r) {
    return r.map(csvEsc).join(",");
  }).join("\r\n");
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "trade-tribunal-watchlist-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (btnEl) {
    btnEl.textContent = old;
    btnEl.disabled = false;
  }
}
function enforceMarketState() {
  if (isMarketClosed()) {
    const sym = cardWindow()[getRoloCurrent()];
    if (sym && tickerState.has(sym)) renderRoloCard(sym);
  }
}
var GLOSSARY = [
  { cat: "CRF FRAMEWORK", term: "CRF (Catalyst Response Framework)", def: "A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that\u2019s a thumbs up; if enough looks bad, that\u2019s a thumbs down.", ex: "Think of it like a pre-flight checklist for a trade \u2014 pilots don\u2019t take off until enough boxes are checked." },
  { cat: "CRF FRAMEWORK", term: "Confidence", def: "How strongly the verdict\u2019s own price action agrees with the trigger driving it. HIGH means both the ticker\u2019s own move and its sector proxy\u2019s move confirm the call. MEDIUM means the trigger is clean but there\u2019s no independent price data to confirm or deny it yet. LOW means real price action is actually moving against the call \u2014 and every LOW-confidence verdict always ships a real \u201CLOOK FOR\u201D note explaining what to watch for before acting.", ex: "A DOWN verdict where the stock itself is also selling off hard is HIGH confidence. The same DOWN verdict on a stock that\u2019s actually holding flat or ticking up is LOW \u2014 check the LOOK FOR note before acting." },
  { cat: "CRF FRAMEWORK", term: "Gate 0 \u2014 Sector Gate", def: "Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.", ex: "A rising tide lifts all boats \u2014 a sinking one drags them down too." },
  { cat: "CRF FRAMEWORK", term: "Gate 1 \u2014 Bidirectional Trend Structure", def: "Looks at whether the stock has already made a big move recently, up or down. A stock that\u2019s already run up a lot is riskier to chase, and one that\u2019s fallen too far too fast is a red flag too.", ex: "Like being wary of a stock that already \u201Cran\u201D \u2014 you don\u2019t want to be the last one to the party." },
  { cat: "CRF FRAMEWORK", term: "Gate 2 \u2014 Catalyst Congruence", def: "Checks whether recent news about the company actually supports the direction the app is leaning.", ex: "Makes sure the story and the numbers are telling the same story." },
  { cat: "CRF FRAMEWORK", term: "Gate 3 \u2014 Opening Bar", def: "Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.", ex: "Like judging a race by how strong the runners look at the starting gun." },
  { cat: "CRF FRAMEWORK", term: "Gate 4 \u2014 Phase Identification", def: "Figures out whether a stock\u2019s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.", ex: "Early innings vs. late innings of the same game." },
  { cat: "CRF FRAMEWORK", term: "Gate 5 \u2014 Dynamic Sector Proxy", def: "Compares the stock to other companies or funds in the same industry, to see if it\u2019s moving with its peers or acting strangely on its own.", ex: "Checking if one kid in class is sick, or if the whole class has the flu." },
  { cat: "CRF FRAMEWORK", term: "Pre-Gate \u2014 Thesis Integrity", def: "A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock\u2019s price. A serious red flag here can override everything else.", ex: "Like checking a used car\u2019s title for a salvage flag before you even look under the hood." },
  { cat: "CRF FRAMEWORK", term: "Proxy", def: "The specific peer stock, ETF, or index a ticker is measured against for Gate 5 \u2014 shown on each card as PROXY. If the ticker and its proxy are moving together, that confirms the read; if they diverge, Gate 5 treats it as a warning sign. See Proxy tier (Gate 5) for how confident the app is in this specific comparison.", ex: "IREN and CIFR are both checked against TSM, since Taiwan chip-supply stress hits the whole AI/semi trade the same way." },
  { cat: "CRF FRAMEWORK", term: "Proxy Resolution Explorer", def: "A Pro-only panel where you can see which industry comparison the app picked for each stock on your watchlist, and how strong that comparison is.", ex: "A behind-the-scenes look at the \u201Cwho\u2019s this stock compared to\u201D decision for every ticker you\u2019re tracking." },
  { cat: "CRF FRAMEWORK", term: "Sector Heat Map", def: "A Pro-only panel showing how different industries are doing today at a glance, so you can quickly spot which sectors are green and which are red.", ex: "Like a weather map, but for which parts of the stock market are stormy right now." },
  { cat: "CRF FRAMEWORK", term: "Verdict Icons \u2014 \u{1F44D} UP / \u{1F44E} DOWN / HOLD", def: "\u{1F44D} means the app leans bullish (expects the stock to rise), \u{1F44E} means it leans bearish (expects it to fall), and HOLD means it\u2019s not confident enough either way, or the market\u2019s closed.", ex: "Simple as a thumbs up or thumbs down on a movie \u2014 just for a stock\u2019s next move instead." },
  { cat: "MARKET STRUCTURE", term: "Beta (\u03B2)", def: "A stock\u2019s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as \u03B2. A negative beta means the stock tends to move opposite the market \u2014 treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.", ex: "IREN at \u03B22.1 is expected to move ~2.1% for every 1% SPY move. A rare \u03B2\u22120.3 name would be expected to drift up on a red SPY day." },
  { cat: "MARKET STRUCTURE", term: "Circuit Breaker", def: "Automatic trading halt when market falls a specified percentage. US halts at \u22127%, \u221213%, \u221220%. KOSPI at \u22128%.", ex: "KOSPI circuit breaker \u2192 Gate 5 RED for all AI/semi names via the Korea/Taiwan proxy exception." },
  { cat: "MARKET STRUCTURE", term: "Engulfing Candle", def: "Second candle\u2019s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.", ex: "Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf \u2192 Gate 3 GREEN." },
  { cat: "MARKET STRUCTURE", term: "Extended Hours (Pre-Market / Post-Market)", def: "Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange\u2019s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape \u2014 moves here can reverse hard once the full tape opens.", ex: "CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in." },
  { cat: "MARKET STRUCTURE", term: "Gap Up / Gap Down", def: "Stock opens significantly different from prior close. CRF entry: gap \u22652% from prior close, enter at ask +1%.", ex: "SMMT closed $45, opens $47.50 = +5.5% gap. Check all gates." },
  { cat: "MARKET STRUCTURE", term: "Intraday", def: "Within a single trading day \u2014 opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app\u2019s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3\u2019s same-day bar sequence, and same-day stop-loss discipline.", ex: "An intraday call on SMMT is graded against its move by that day\u2019s close, not next week\u2019s \u2014 Gate 3\u2019s opening-bar sequence only exists because the framework is timing a single session." },
  { cat: "MARKET STRUCTURE", term: "Opening Drive", def: "First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.", ex: "Stock gaps up 3% with 2\xD7 average volume in bar 1 = Opening Drive setup." },
  { cat: "MARKET STRUCTURE", term: "Relative Volume (RVOL)", def: "Current volume compared to the average volume for this point in the session. RVOL >2x on an Opening Drive gap is what separates a real institutional move from noise.", ex: "ALAB gaps up 4% on 1.1M shares in the first 5 minutes vs a normal 5-minute average of 280K \u2192 RVOL ~4x, high-conviction signal." },
  { cat: "MARKET STRUCTURE", term: "Short Squeeze", def: "Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.", ex: "IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze." },
  { cat: "MARKET STRUCTURE", term: "Support / Resistance", def: "Price levels where a stock has historically reversed. Support = a floor buyers defended before. Resistance = a ceiling sellers defended before. Neither is guaranteed to hold twice.", ex: "PLUG bounced at $2.10 three times this quarter \u2014 that\u2019s support until it isn\u2019t; a close below it on volume is the tell it broke." },
  { cat: "MARKET STRUCTURE", term: "VWAP (Volume-Weighted Average Price)", def: "The running average price of a stock for the session, weighted by volume at each price. Resets daily. Widely used intraday as a fair-value line \u2014 price above VWAP favors longs, below favors shorts.", ex: "Stock pops to $52 but VWAP sits at $49.80 \u2014 a lot of the day\u2019s volume already changed hands well below the current price." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Call Option", def: "Right (not obligation) to buy 100 shares at the strike price before expiration. Buyers profit if the stock rises above strike + premium paid.", ex: "Buy 1 SMMT $50 call for $2.00. Stock closes $55 at expiry \u2192 intrinsic value $5.00, profit $3.00/share." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Cash-Secured Put", def: "Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you\u2019d want to own.", ex: "ARCC at $18.50 \u2192 sell $18 put for $0.48. Assigned = effective buy at $17.52." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "DTE (Days to Expiration)", def: "Calendar days remaining until an option contract expires. Theta decay accelerates as DTE shrinks, especially inside the final 2 weeks.", ex: "A 30 DTE option loses value slowly. The same strike at 3 DTE bleeds premium daily even on a flat stock." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Expected Move", def: "Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.", ex: "Stock $50, ATM IV 80%, 30 DTE \u2192 expected move \xB1$12.30." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Gamma Exposure (GEX)", def: "Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves. Acts as a weighting overlay on Gate 0, not a pass/fail rule.", ex: "SPX negative GEX \u2192 Opening Drive gaps extend. Momentum more reliable." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Implied Volatility (IV)", def: "Market\u2019s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.", ex: "ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "ITM / ATM / OTM", def: "In-the-money (has intrinsic value \u2014 call strike below spot, put strike above), at-the-money (strike \u2248 spot), out-of-the-money (no intrinsic value yet, pure premium). Delta approximates the odds of finishing ITM.", ex: "Stock at $50: the $45 call is ITM, the $50 call is ATM, the $55 call is OTM." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "IV Crush", def: "Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.", ex: "Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts \u2192 put now $1.80." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "IV Rank (IVR)", def: "Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.", ex: "IVR 85 = IV higher than 85% of readings this year \u2192 Gate 4 RED lean." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Put Option", def: "Right (not obligation) to sell 100 shares at the strike price before expiration. Buyers profit if the stock falls below strike \u2212 premium paid.", ex: "Buy 1 IREN $35 put for $1.50. Stock drops to $30 at expiry \u2192 intrinsic value $5.00, profit $3.50/share." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Put/Call Skew", def: "Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.", ex: "CHAT showed consistent +4pt put skew \u2192 Gate 2 bearish lean." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Strike Price", def: "The fixed price at which an option\u2019s owner can buy (call) or sell (put) the underlying. Set when the contract is created and never changes.", ex: "A $45 call and a $50 call on the same expiry are different contracts \u2014 the $45 strike is already in-the-money at a $47 stock price, the $50 strike is not." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Delta (\u0394)", def: "How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.", ex: "Delta 0.50 call gains $0.50 when stock rises $1." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Gamma (\u0393)", def: "Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.", ex: "High-gamma option: $1 stock move shifts delta from 0.50 to 0.65." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Rho (\u03C1)", def: "Sensitivity to a 1% change in interest rates. Smallest of the four Greeks for short-dated options \u2014 matters on LEAPS-length duration, negligible for the Opening Drive holds this app is built around.", ex: "A 6-month call with Rho 0.15 gains ~$0.15 per 1% rate hike \u2014 a rounding error next to a same-day 3% move driven by Delta/Gamma." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Theta (\u0398)", def: "Time decay per day. Sellers\u2019 friend, buyers\u2019 enemy. Accelerates in final 2 weeks before expiry.", ex: "$2.00 option with theta \u22120.05 loses $0.50 over 10 days even if stock flat." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Vega (\u03BD)", def: "Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).", ex: "Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts \u2192 option now $1.80." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "52-Week High", def: "The highest price a stock has traded at over the trailing 52 weeks \u2014 shown on each card as 52W.", ex: "A stock making a new 52-week high is trading at its best price in a full year." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "52-Week Low", def: "The lowest price a stock has traded at over the trailing 52 weeks.", ex: "A stock making a new 52-week low is trading at its worst price in a full year \u2014 worth investigating, not automatically a bargain." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "All-Time High (ATH)", def: "The highest price a stock has ever traded at since it started trading \u2014 not just the trailing year.", ex: "A stock can sit well below its 52-week high while still trading near its all-time high, if that high was set more than a year ago." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "All-Time Low (ATL)", def: "The lowest price a stock has ever traded at, since it started trading.", ex: "A stock hitting a fresh all-time low has never been cheaper in its public trading history." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Bearish", def: "Expecting the price to fall. This app\u2019s \u{1F44E} DOWN verdict is a bearish call.", ex: "\u201CBearish on the sector\u201D means expecting it to fall broadly, not just one name." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Breakdown", def: "Price moves decisively below a support level it had been holding, often on above-average volume \u2014 the bearish mirror of a breakout.", ex: "A stock that held $40 for weeks finally closes at $37 on heavy volume \u2014 a breakdown." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Breakout", def: "Price moves decisively above a resistance level it had been struggling to clear, often on above-average volume.", ex: "A stock that failed at $50 three times finally closes at $52 on 3\xD7 average volume \u2014 a breakout." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Bullish", def: "Expecting the price to rise. This app\u2019s \u{1F44D} UP verdict is a bullish call.", ex: "\u201CBullish on IREN\u201D means expecting it to rise." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Discount", def: "Trading below par, fair value, or intrinsic worth \u2014 the opposite of Premium.", ex: "A closed-end fund trading at a 10% discount to net asset value is priced below what its holdings are actually worth." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Fairly Priced", def: "Trading roughly in line with what a company\u2019s fundamentals justify \u2014 neither a bargain nor stretched.", ex: "A stock at 18\xD7 earnings growing 18% a year, in line with its sector, is fairly priced." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Floating", def: "Drifting with little conviction in either direction \u2014 not trending, not volatile, just idling near its current price.", ex: "A stock ticking between $29.80 and $30.20 all session on thin volume is floating, not making a real move." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Frozen", def: "Essentially motionless \u2014 flat price, thin or no volume, nothing fresh to read from it.", ex: "A halted or extremely illiquid stock showing the same last-trade price for hours is frozen." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Gapping Down", def: "Opens the session noticeably below where it closed the prior day, leaving a visible gap on the chart \u2014 the bearish mirror of gapping up.", ex: "Closes Monday at $45, opens Tuesday at $41 \u2014 gapping down 8.9% overnight." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Gapping Up", def: "Opens the session noticeably above where it closed the prior day, leaving a visible gap on the chart.", ex: "Closes Monday at $45, opens Tuesday at $48 \u2014 gapping up 6.7% overnight." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Overbought", def: "Pushed up too far, too fast \u2014 often flagged by momentum indicators like RSI above 70 \u2014 and considered due for a pullback.", ex: "A stock up 40% in two weeks with RSI at 85 is overbought, even if the underlying story is still good." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Oversold", def: "Pushed down too far, too fast \u2014 RSI below 30 is the common threshold \u2014 and considered due for a bounce.", ex: "A stock down 30% in a broad market flush with RSI at 18 is oversold, even though nothing changed about the company itself." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Overvalued", def: "Trading above what a company\u2019s fundamentals justify \u2014 often used to flag Phase 3-style names priced for perfection.", ex: "A stock at 80\xD7 forward earnings with slowing growth gets called overvalued even if the chart still looks strong." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Overweight", def: "An analyst or portfolio call to hold more of a stock than its normal weighting in a benchmark, because it\u2019s expected to outperform. Opposite of Underweight.", ex: "A fund rating MU \u201COverweight\u201D means holding more of it than its ~0.3% weight in the index it tracks." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Par", def: "A security\u2019s original face value \u2014 100% of what it was issued at. Mostly a bond term; \u201Cat par\u201D means trading exactly at that value.", ex: "A $1,000 bond trading at par sells for $1,000, no more, no less." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Premium", def: "Trading above par, fair value, or intrinsic worth. On options, the premium is simply the price paid for the contract.", ex: "A closed-end fund trading at a 5% premium to net asset value costs more than the assets it actually holds." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Rallying", def: "In the middle of a sustained upward move, usually over several sessions.", ex: "A stock up 15% over five straight green days is rallying." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Range-bound", def: "Trading between a fairly consistent floor and ceiling with no clear trend, bouncing between support and resistance.", ex: "A stock stuck between $18 and $22 for a month, testing each edge without breaking through, is range-bound." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Sideways", def: "Moving with no clear up or down trend over a stretch of time \u2014 the everyday term for range-bound, consolidating price action.", ex: "A stock unchanged on net over three weeks, chopping in both directions, is trading sideways." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Undervalued", def: "Trading below what a company\u2019s fundamentals (earnings, growth, assets) suggest it\u2019s actually worth \u2014 a value case, not a momentum one.", ex: "A stock at 8\xD7 earnings when peers trade at 15\xD7, with no clear reason for the gap, gets called undervalued." },
  { cat: "PRICE & VALUATION LANGUAGE", term: "Volatile", def: "Moving in large, rapid swings in either direction \u2014 high uncertainty about where price settles next, regardless of the underlying trend.", ex: "A stock swinging \xB18% in a single session on light news is volatile, whichever direction it ends up." },
  { cat: "SECTOR TERMS", term: "BDC (Business Development Company)", def: "Fund making loans to mid-sized businesses, required to distribute 90%+ of income as dividends.", ex: "ARCC is the largest publicly traded BDC. Income from loan interest, not appreciation." },
  { cat: "SECTOR TERMS", term: "HBM (High Bandwidth Memory)", def: "RAM designed for AI training. Only Micron, Samsung, SK Hynix make it. Core of MU\u2019s AI thesis.", ex: "Hyperscaler capex slowdown = HBM demand slowdown = MU pressure." },
  { cat: "SECTOR TERMS", term: "KOSPI", def: "Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.", ex: "KOSPI \u22126% Tuesday \u2192 NVDA/MU/ALAB pressure Thursday-Friday." },
  { cat: "SECTOR TERMS", term: "Neocloud", def: "Companies renting GPU compute to AI developers. Borrow billions to buy Nvidia GPUs, rent at premium.", ex: "IREN, CoreWeave. Revenue real; profitability theoretical for most." },
  { cat: "SECTOR TERMS", term: "SOXX", def: "iShares Semiconductor ETF. Tracks 30 largest US-listed semiconductor companies. Best sector indicator for AI/chip trades.", ex: "SOXX \u22123% while SPY flat = semiconductor-specific stress." },
  { cat: "SECTOR TERMS", term: "TSM (Taiwan Semiconductor)", def: "World\u2019s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names (Korea/Taiwan proxy exception \u2014 takes priority over the dynamic algorithm for this group).", ex: "TSM \u22124% \u2192 Taiwan semi stress \u2192 risk-off on AI/semi entries." },
  { cat: "SECTOR TERMS", term: "XBI / IBB", def: "Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5\u2019s fixed proxy for biotech/medical names.", ex: "XBI \u22122% \u2192 biotech risk-off \u2192 Gate 5 YELLOW or RED for SMMT/VCYT/IMVT." },
  { cat: "TICKER CLASSIFICATIONS", term: "Canary", def: "European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.", ex: "ASML fell before MU/ALAB. Warned 10-21 days early." },
  { cat: "TICKER CLASSIFICATIONS", term: "Flow", def: "Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.", ex: "ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares." },
  { cat: "TICKER CLASSIFICATIONS", term: "Proxy tier (Gate 5)", def: "A label showing how confident the app is in the industry comparison it picked for this stock \u2014 some comparisons are well-tested, others are more of an educated guess.", ex: "Like the difference between a doctor\u2019s confirmed diagnosis and an educated guess based on symptoms." },
  { cat: "TICKER CLASSIFICATIONS", term: "Sentiment", def: "Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.", ex: "MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%." },
  { cat: "TRADING TERMINOLOGY", term: "14-Day Pre-Window", def: "14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (uptrend exhaustion branch).", ex: "MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print." },
  { cat: "TRADING TERMINOLOGY", term: "Bid / Ask (Bid-Ask Spread)", def: "Bid = highest price a buyer will pay right now. Ask = lowest price a seller will accept. The spread between them is a real, invisible cost \u2014 wider on illiquid names and thin extended-hours books.", ex: "IREN bid $39.98 / ask $40.05 \u2014 a market order to buy fills near $40.05, not the $40.00 last-trade price shown on the card." },
  { cat: "TRADING TERMINOLOGY", term: "Defined Risk", def: "Position where max loss is fixed at entry. Buying options or spreads. Cannot lose more than premium paid.", ex: "Buy 1 put for $200. Stock rallies. Max loss = $200." },
  { cat: "TRADING TERMINOLOGY", term: "GTC (Good Till Cancelled)", def: "Order that stays active until manually cancelled. Use for stop losses on multi-day holds.", ex: "GTC stop at $43.65 on SMMT triggers automatically even if it gaps down overnight." },
  { cat: "TRADING TERMINOLOGY", term: "Ladder / Laddering", def: "Splitting one order into several smaller limit orders staggered across a price range instead of one order at one price. Improves average fill price on size that would otherwise move a thin book.", ex: "Instead of one 500-share market buy, ladder 100 shares each at $45.00/$45.10/$45.20/$45.30/$45.40." },
  { cat: "TRADING TERMINOLOGY", term: "Limit Order", def: "An order that only fills at your specified price or better. Guarantees price, not execution \u2014 can go unfilled if the stock never trades there.", ex: "Limit buy SMMT at $45.00 while it\u2019s trading $45.20 \u2014 sits unfilled until the price comes down to you (or never)." },
  { cat: "TRADING TERMINOLOGY", term: "Long", def: "Buying and owning shares expecting price to rise.", ex: "Buy 100 SMMT at $45. Sell at $50. $500 profit." },
  { cat: "TRADING TERMINOLOGY", term: "Market Order", def: "An order that fills immediately at the best available price. Guarantees execution, not price \u2014 on a fast-moving or thin name you can pay meaningfully more than the last quote.", ex: "A market buy during a gap-up Opening Drive can fill 1-2% above the price you saw when you clicked." },
  { cat: "TRADING TERMINOLOGY", term: "Pyramiding", def: "Adding to a winning position in smaller increments as it moves in your favor.", ex: "100 shares at $45. Rises to $47 \u2192 add 50. Hits $49 \u2192 add 25." },
  { cat: "TRADING TERMINOLOGY", term: "Sector Rotation", def: "Money moving from one sector to another. Sector pulse blurb tracks this daily.", ex: "AI fears \u2192 money rotates from NVDA into GLD and USO." },
  { cat: "TRADING TERMINOLOGY", term: "Sell the News", def: "Stock falls after a positive catalyst because good news was already priced in. Phase 3 behavior.", ex: "ALAB beats Q1 by 12%. Stock drops 13% next day. Beat was priced in." },
  { cat: "TRADING TERMINOLOGY", term: "Short / Short Selling", def: "Borrowing shares, selling immediately, buying back later. Profit if price falls. Loss if rises \u2014 theoretically unlimited.", ex: "Short 100 IREN at $40. Falls to $32 \u2192 $800 profit." },
  { cat: "TRADING TERMINOLOGY", term: "Stop Loss", def: "Pre-set price at which you automatically exit to limit losses. Set before entry. CRF: \u22123% for high-conviction names.", ex: "Enter SMMT at $45. Stop at $43.65 (\u22123%). Hit $43.65 \u2192 exit immediately." },
  { cat: "TRADING TERMINOLOGY", term: "Ticker", def: "The short letter code (usually 1-5 letters) that identifies one specific stock or fund on an exchange, like IREN or SPY. What you type into Import to add a name to your watchlist.", ex: "MU, ALAB, and TSM are all tickers \u2014 three different companies, three different symbols." }
];
var GLOSSARY_LINK_TERMS = [
  { re: /\b52-Week High\b/gi, key: "52-week high" },
  { re: /\b52-Week Low\b/gi, key: "52-week low" },
  { re: /\bAll-Time High\b/gi, key: "all-time high" },
  { re: /\bATH\b/g, key: "all-time high" },
  { re: /\bAll-Time Low\b/gi, key: "all-time low" },
  { re: /\bATL\b/g, key: "all-time low" },
  { re: /\bFairly Priced\b/gi, key: "fairly priced" },
  { re: /\bRange-bound\b/gi, key: "range-bound" },
  { re: /\bGapping Up\b/gi, key: "gapping up" },
  { re: /\bGapping Down\b/gi, key: "gapping down" },
  { re: /\bOverweight\b/gi, key: "overweight" },
  { re: /\bUndervalued\b/gi, key: "undervalued" },
  { re: /\bOvervalued\b/gi, key: "overvalued" },
  { re: /\bat par\b/gi, key: "par" },
  { re: /\bPremium\b/gi, key: "premium" },
  { re: /\bDiscount\b/gi, key: "discount" },
  { re: /\bBullish\b/gi, key: "bullish" },
  { re: /\bBearish\b/gi, key: "bearish" },
  { re: /\bOverbought\b/gi, key: "overbought" },
  { re: /\bOversold\b/gi, key: "oversold" },
  { re: /\bBreakout\b/gi, key: "breakout" },
  { re: /\bBreakdown\b/gi, key: "breakdown" },
  { re: /\bSideways\b/gi, key: "sideways" },
  { re: /\bVolatile\b/gi, key: "volatile" },
  { re: /\bRallying\b/gi, key: "rallying" },
  { re: /\bFloating\b/gi, key: "floating" },
  { re: /\bFrozen\b/gi, key: "frozen" }
];
function linkTextSegment(text) {
  if (!text) return text;
  var hits = [];
  GLOSSARY_LINK_TERMS.forEach(function(lt) {
    lt.re.lastIndex = 0;
    var mm;
    while (mm = lt.re.exec(text)) {
      hits.push({ start: mm.index, end: mm.index + mm[0].length, text: mm[0], key: lt.key });
      if (mm[0].length === 0) lt.re.lastIndex++;
    }
  });
  if (!hits.length) return text;
  hits.sort(function(a, b) {
    return a.start - b.start || b.end - b.start - (a.end - a.start);
  });
  var kept = [];
  var lastEnd = -1;
  hits.forEach(function(h) {
    if (h.start >= lastEnd) {
      kept.push(h);
      lastEnd = h.end;
    }
  });
  var out = "", pos = 0;
  kept.forEach(function(h) {
    out += text.slice(pos, h.start);
    out += '<a href="#" class="help-glossary-link term-link" data-term="' + h.key + '">' + h.text + "</a>";
    pos = h.end;
  });
  out += text.slice(pos);
  return out;
}
function autoLinkGlossaryTerms(html) {
  if (!html) return html;
  var TAG_RE = /<[^>]*>/g;
  var out = "", lastIndex = 0, m;
  while (m = TAG_RE.exec(html)) {
    out += linkTextSegment(html.slice(lastIndex, m.index));
    out += m[0];
    lastIndex = m.index + m[0].length;
  }
  out += linkTextSegment(html.slice(lastIndex));
  return out;
}
function wrapHeadlineLinks(sym, html) {
  var href = newsHref(sym);
  var parts = html.split(/(<a\b[^>]*\bclass="[^"]*\bterm-link\b[^"]*"[^>]*>.*?<\/a>)/g);
  return parts.map(function(p) {
    if (!p) return p;
    if (p.indexOf("help-glossary-link") !== -1) return p;
    return '<a href="' + href + '" target="_blank">' + p + "</a>";
  }).join("");
}
var glossaryBuilt = false;
function buildGlossary() {
  if (glossaryBuilt) return;
  glossaryBuilt = true;
  var body = document.getElementById("glossary-body");
  if (!body) return;
  var cats = {};
  GLOSSARY.forEach(function(g) {
    if (!cats[g.cat]) cats[g.cat] = [];
    cats[g.cat].push(g);
  });
  var html = "";
  Object.entries(cats).forEach(function(entry) {
    var cat = entry[0], terms = entry[1];
    html += '<div class="glossary-cat" data-cat="' + cat + '">' + cat + "</div>";
    terms.forEach(function(t) {
      html += '<div class="glossary-term visible" data-term="' + t.term.toLowerCase() + '" data-def="' + t.def.toLowerCase() + '"><div class="glossary-term-name">' + t.term + '</div><div class="glossary-term-def">' + t.def + "</div>" + (t.ex ? '<div class="glossary-term-example">e.g. ' + t.ex + "</div>" : "") + "</div>";
    });
  });
  body.innerHTML = html;
}
function ensureGlossaryOpen() {
  var card = document.getElementById("card-glossary");
  if (!card) return;
  if (!card.classList.contains("expanded")) expandCard(card);
  else snapCardUnderDock(card);
}
function jumpToAbout() {
  var m = document.getElementById("profile-menu");
  if (m) m.classList.remove("open");
  var search = document.getElementById("glossary-search");
  if (search) search.value = "";
  filterGlossary("");
  ensureGlossaryOpen();
}
function jumpToGlossaryTerm(key) {
  ensureGlossaryOpen();
  var search = document.getElementById("glossary-search");
  if (search) search.value = "";
  filterGlossary("");
  var k = key.toLowerCase();
  var target = null;
  document.querySelectorAll(".glossary-term").forEach(function(el) {
    if (!target && el.dataset.term && el.dataset.term.indexOf(k) !== -1) target = el;
  });
  if (target) {
    var hit = target;
    hit.scrollIntoView({ behavior: "smooth", block: "center" });
    hit.classList.add("glossary-flash");
    setTimeout(function() {
      hit.classList.remove("glossary-flash");
    }, 1600);
  }
}
function filterGlossary(query) {
  buildGlossary();
  var q = query.toLowerCase().trim();
  var terms = document.querySelectorAll(".glossary-term");
  var anyVisible = false;
  terms.forEach(function(el) {
    var match = !q || el.dataset.term.includes(q) || el.dataset.def.includes(q);
    el.classList.toggle("visible", match);
    if (match) anyVisible = true;
  });
  document.querySelectorAll(".glossary-cat").forEach(function(catEl) {
    var next = catEl.nextElementSibling, hasVisible = false;
    while (next && !next.classList.contains("glossary-cat")) {
      if (next.classList.contains("visible")) hasVisible = true;
      next = next.nextElementSibling;
    }
    catEl.style.display = hasVisible || !q ? "block" : "none";
  });
  var nr = document.getElementById("glossary-no-results");
  if (nr) nr.style.display = !anyVisible && q ? "block" : "none";
}
document.getElementById("glossary-search").addEventListener("input", (e) => filterGlossary(e.target.value));
var HELP_CONTENT = {
  pills: "Tap any pill above to open its ticker card, then hit ANALYZE to run it through all 6 gates and get a real UP/DOWN/FLAT verdict \u2014 this is the whole point of the app. Swipe a card left to remove it from your watchlist, or right to jump to the next ticker and analyze it automatically.",
  gate: 'Live market mood for SPY, QQQ, and other key indices \u2014 this becomes <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> on every ticker you analyze. Every verdict also shows a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> level. Tap this bar anytime to jump back to the top. Pre-market and after-hours prices come from a smaller data feed and can differ slightly from regular trading hours (9:30am\u20134pm ET).',
  pulse: 'A quick, AI-written summary of today\u2019s market mood and which <a class="help-glossary-link" href="#" data-term="sector rotation">sectors</a> are leading or lagging. For your information only \u2014 it never changes a gate or a verdict.',
  io: 'Type or paste <a class="help-glossary-link" href="#" data-term="ticker">tickers</a> or company names \u2014 one per line, or separated by commas. Pro has no limit. All caps (AAPL) adds a ticker directly; type it any other way (Tesla) and it resolves to the right symbol. Analyze All runs your top 15 cards, up to 5 credits.',
  watchlist: 'Every <a class="help-glossary-link" href="#" data-term="ticker">ticker</a> beyond your top 15 cards lives here. Tap + on any row to move it up into your main list.',
  proxy: 'Shows which sector or stock each ticker is compared against for <a class="help-glossary-link" href="#" data-term="gate 5">Gate 5</a>, and whether they\u2019re still moving together right now.',
  heatmap: "A color-coded snapshot of major sectors and every ticker in your watchlist, sorted by today\u2019s % change.",
  scorecard: `Pooled across every user and tier, so every number here describes the same set of calls. Each verdict is graded twice. Day trade: did it close in the call's direction at that same session's close? Long: did it close in the call's direction 5 trading days later? Closing against the call by any amount is wrong. If the stock reached +4% (day) or +16% (long) in the call's direction along the way but still closed against it, it counts as half right. FLAT calls are right when the stock stayed within half its normal move for that window (or moved under 0.1%), half right within one normal move. The two tiles count UP and DOWN calls only; the rows below split UP, DOWN and FLAT. Verdicts pulled pre-market, after close, on weekends or holidays aren't counted \u2014 they aren't tradable when issued. Each tile stays hidden until 20 calls are graded; each row and ticker needs 5. Under each tile: the \xB1 range is the margin of error (the true rate is likely within it), and Always-UP is what calling UP on every one of those same calls would have scored. "Beats it" only shows when the gap is bigger than the range. "Your Log" below is your own record \u2014 tap \u2713 RIGHT or \u2717 WRONG after a session closes to build it.`,
  agitator: "Check out a new stock idea or a rumor before it earns a spot on your watchlist \u2014 always free. Type a ticker, a company name, or paste a headline, and get one LOW/MEDIUM/HIGH read built from 6 real signals, plus a few related companies worth a look.",
  "agitator-score": "One overall score, 0\u201310, averaging the 6 signals below \u2014 a fast read on how big a deal this news might be, not an exact measurement.",
  "agitator-surprise": "How unexpected this is for this company. A routine, expected update scores low; something out of the blue scores high.",
  "agitator-uncertainty": "How unclear it still is to everyone how big a deal this actually is. High means the market hasn\u2019t figured out how to react yet.",
  "agitator-freshness": "Is this brand-new information nobody has reacted to yet (high), or something already known and priced in days ago (low)?",
  "agitator-ripple": "How likely this is to also move other related stocks, the sector, or the broader market \u2014 not just this one company.",
  "agitator-swing": "How easily this stock\u2019s price can be pushed around. Smaller, thinly-traded stocks swing more on the same amount of buying or selling.",
  "agitator-expected-move": "How much price movement the options market is already betting on for this stock, right now.",
  "agitator-past": "How reliably this app\u2019s past verdicts on this ticker have graded out. Shows n/a until enough real graded history exists.",
  dial: "Sets how actively you plan to trade \u2014 from Aggressive (watching closely) to Passive (checking in occasionally). CRF Default behaves just like every other tier. Aggressive can allow up to HALF position size, never more than your gates actually earned. A real earnings report always blocks new entries first, unless you choose to hold through it. Everything else here \u2014 timing, entries, stops \u2014 is guidance only; this app doesn\u2019t place real orders or send reminders."
};
var TUTORIAL_STEP_SETTLE_MS = 450;
function tutorialCard(id) {
  return document.getElementById(id);
}
function tutorialExpand(id) {
  const card = tutorialCard(id);
  if (!card) return;
  if (!card.classList.contains("expanded")) expandCard(card);
  if (isLandscapeMode()) selectLandscapeCard(card);
}
function tutorialActiveCardEl() {
  const cards = Array.from(roloStage.querySelectorAll(".rolo-card"));
  return cards[getRoloCurrent()] || null;
}
function tutorialAnchor(cardKind, helpId) {
  if (isLandscapeMode()) return document.querySelector(`.ribbon-item[data-card="${cardKind}"]`);
  return document.querySelector(`[data-help="${helpId}"]`);
}
function tutorialGlossaryAnchor() {
  if (isLandscapeMode()) return document.querySelector('.ribbon-item[data-card="glossary"]');
  return document.getElementById("glossary-header");
}
var TUTORIAL_STEPS = [
  {
    // The centerpiece -- no accordion, anchors straight to the new pills
    // help button next to "Tap Pills to Analyze."
    html: HELP_CONTENT.pills,
    getAnchor: () => document.querySelector('[data-help="pills"]'),
    before: () => scrollToActiveCard()
  },
  {
    html: "This is <b>swipe-to-delete</b> \u2014 swipe any card left anytime to remove that ticker from your watchlist.",
    getAnchor: () => tutorialActiveCardEl(),
    before: () => simulateSwipeDemo("left")
  },
  {
    html: "Swipe right to jump to the <b>next ticker</b> in your watchlist and analyze it automatically.",
    getAnchor: () => tutorialActiveCardEl(),
    before: () => {
      resetSwipeDemoCard();
      return simulateSwipeDemo("right");
    }
  },
  {
    html: HELP_CONTENT.gate,
    getAnchor: () => document.querySelector('[data-help="gate"]'),
    before: () => {
      resetSwipeDemoCard();
      jumpToTop();
    }
  },
  {
    html: "Set your Aggression Dial before you analyze \u2014 it shapes how big a position size your verdicts can suggest, from Aggressive to Passive.",
    getAnchor: () => tutorialAnchor("dial", "dial"),
    before: () => tutorialExpand("card-dial")
  },
  {
    html: HELP_CONTENT.pulse,
    getAnchor: () => document.querySelector('[data-help="pulse"]'),
    before: () => jumpToTop()
  },
  {
    html: HELP_CONTENT.agitator,
    getAnchor: () => tutorialAnchor("agitator", "agitator"),
    before: () => tutorialExpand("card-agitator")
  },
  {
    html: HELP_CONTENT.io,
    getAnchor: () => tutorialAnchor("io", "io"),
    before: () => tutorialExpand("card-io")
  },
  {
    html: HELP_CONTENT.watchlist,
    getAnchor: () => tutorialAnchor("watchlist", "watchlist"),
    before: () => tutorialExpand("card-watchlist")
  },
  {
    html: HELP_CONTENT.proxy,
    getAnchor: () => tutorialAnchor("proxy", "proxy"),
    before: () => tutorialExpand("card-proxy")
  },
  {
    html: HELP_CONTENT.heatmap,
    getAnchor: () => tutorialAnchor("heatmap", "heatmap"),
    before: () => tutorialExpand("card-heatmap")
  },
  {
    html: HELP_CONTENT.scorecard,
    getAnchor: () => tutorialAnchor("scorecard", "scorecard"),
    before: () => tutorialExpand("card-scorecard")
  },
  {
    html: "That\u2019s the app. Tap a pill, hit ANALYZE, and let the gates do the work \u2014 everything else here just supports that call. Come back to <b>\u25B6 Run Tutorial</b>, right here in the Glossary, anytime you want to see this again.",
    getAnchor: () => tutorialGlossaryAnchor(),
    before: () => tutorialExpand("card-glossary")
  }
];
async function runTutorialStep(index) {
  if (index >= TUTORIAL_STEPS.length) {
    endTutorial();
    return;
  }
  const step = TUTORIAL_STEPS[index];
  if (step.before) await step.before();
  await new Promise((r) => setTimeout(r, TUTORIAL_STEP_SETTLE_MS));
  const anchor = step.getAnchor();
  if (!anchor) {
    runTutorialStep(index + 1);
    return;
  }
  openTutorialBalloon(
    anchor,
    step.html,
    () => {
      runTutorialStep(index + 1);
    },
    () => {
      resetSwipeDemoCard();
    }
  );
}
function startTutorial() {
  localStorage.setItem("tv_tutorial_seen_pro", "1");
  runTutorialStep(0);
}
window.startTutorial = startTutorial;
function initApp() {
  cleanLS();
  document.getElementById("ticker-count").textContent = "CRF \xB7 " + watchlist.length + " TICKERS";
  onPrefsChange(function() {
    refreshRoloCards();
    renderMarketTs();
    refreshTickerLinks(document.getElementById("gateGrid"));
    refreshTickerLinks(gateMarquee);
  });
  fetchMarket();
  sizeGateSpacer();
  renderRolodexFromWatchlist();
  renderTrackRecord();
  renderDialCard();
  setTimeout(fetchCreditStatus, 2e3);
  setTimeout(function() {
    if (!localStorage.getItem("tv_tutorial_seen_pro")) startTutorial();
  }, 900);
  setInterval(function() {
    fetchMarket();
    var proxyCard = document.querySelector('.card[data-card="proxy"]');
    if (proxyCard && proxyCard.classList.contains("expanded")) renderProxyExplorer();
    var heatCard = document.querySelector('.card[data-card="heatmap"]');
    if (heatCard && heatCard.classList.contains("expanded")) renderHeatMap();
  }, 4 * 60 * 1e3);
  enforceMarketState();
  setInterval(enforceMarketState, 60 * 1e3);
  if (sbSession && sbSession.email) {
    var pb = document.getElementById("profile-btn");
    if (pb) pb.textContent = sbSession.email.charAt(0).toUpperCase();
    var pme = document.getElementById("profile-menu-email-text");
    if (pme) pme.textContent = sbSession.email;
  }
}
async function checkTierAccess(session) {
  var expectedTier = "pro";
  var err = document.getElementById("auth-error");
  if (session.tier !== expectedTier) {
    if (err) {
      err.style.color = "var(--amber)";
      if (session.tier === "free") {
        err.textContent = session.hasSubscribed ? "Your PRO subscription is no longer active. Redirecting to free tier..." : "No active PRO subscription. Redirecting to free tier...";
      } else {
        err.textContent = "Redirecting to your " + session.tier.toUpperCase() + " tier...";
      }
    }
    setTimeout(function() {
      if (session.redirectUrl) {
        window.location.href = session.redirectUrl;
      } else {
        window.location.href = "https://tradetribunal.app/";
      }
    }, 1500);
    return false;
  }
  initWatchlistSync({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
  onWatchlistSave(function() {
    schedulePushWatchlist();
    renderRolodexFromWatchlist();
  });
  onTickersAdded(function() {
    goRolo(0);
  });
  await pullWatchlistFromServer();
  initTrackRecordSync({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
  await pullTrackRecordFromServer();
  showScreen("app-root");
  initApp();
  return true;
}
async function checkAuth() {
  var stored = await ensureFreshSession(API_URL2);
  if (!stored) {
    showScreen("auth-screen");
    bindAuthEvents();
    return;
  }
  sbSession = stored;
  startSessionKeepAlive(API_URL2, function(s) {
    if (s) sbSession = s;
  });
  try {
    var r = await fetch(API_URL2 + "/auth/me?supabase_token=" + encodeURIComponent(stored.token));
    if (r.ok) {
      var fresh = await r.json();
      if (fresh.tier) {
        stored.tier = fresh.tier;
        stored.hasSubscribed = !!fresh.hasSubscribed;
        var URLS = { free: "https://tradetribunal.app/", starter: "https://tradetribunal.app/starter/", pro: "https://tradetribunal.app/pro/", shark: "https://tradetribunal.app/shark/" };
        stored.redirectUrl = URLS[fresh.tier] || URLS.free;
        storeSession(stored);
        sbSession = stored;
      }
    }
  } catch (e) {
  }
  checkTierAccess(stored);
  bindAuthEvents();
  pingDeviceVisit({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
}
initWatchlist({ defaultTickers: ["SMMT", "VCYT", "TWST", "IMVT", "IREN", "ALAB", "MU"], maxTickers: 999, upgradeMessage: "Pro supports unlimited tickers already \u2014 this cap should never be hit." });
initTickerCache({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
initRolodex({
  scroller,
  gateCard: document.getElementById("gateCard"),
  gateFullOverlay: document.getElementById("gateFullOverlay"),
  gateSpacer: document.getElementById("gateSpacer"),
  gateMarquee,
  listHead: document.getElementById("listHead"),
  roloIndex,
  roloStage
}, {
  getWatchlist: cardWindow,
  onActivate: (sym) => {
    const state = tickerState.get(sym);
    if (state && !state.result && !state.analyzing) analyzeOne(sym);
  },
  onDeleteConfirmed: deleteActiveTicker,
  // Landscape-only: collapse the header once the Gate docks, to reclaim
  // vertical space on a short landscape viewport. See shared/rolodex.ts's
  // own comment on onGateDockChange for why this is a different, safer
  // mechanism than the Aug 16, 2026 scroll-hide header this app already
  // tried and reverted.
  onGateDockChange: (docked) => {
    if (isLandscapeMode()) document.body.classList.toggle("header-collapsed", docked);
  }
});
initHelpBalloons(HELP_CONTENT, jumpToGlossaryTerm);
initLandscapeMode({
  hud: document.getElementById("landscapeHud"),
  ribbon: document.getElementById("utilityRibbon"),
  pane: document.getElementById("utilityPane"),
  empty: document.getElementById("utilityEmpty")
}, expandCard);
checkAuth();
document.getElementById("analyzeAllBtn").addEventListener("click", analyzeAll);
initRatePrompt();
document.getElementById("importBtn").addEventListener("click", addTickers);
document.getElementById("exportCsvBtn").addEventListener("click", () => exportWatchlistCSV(document.getElementById("exportCsvBtn")));
document.getElementById("clearTrackBtn").addEventListener("click", () => {
  clearLog();
});
document.getElementById("agitatorCheckBtn").addEventListener("click", runAgitatorCheck);
document.getElementById("agitator-clear").addEventListener("click", () => {
  var qEl = document.getElementById("agitator-query");
  qEl.value = "";
  qEl.focus();
});
document.getElementById("agitator-query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runAgitatorCheck();
  }
});
document.getElementById("compact-sort-btn").addEventListener("click", toggleCompactSort);
document.getElementById("proxy-sort-level").addEventListener("click", () => setProxySort("level"));
document.getElementById("proxy-sort-coherence").addEventListener("click", () => setProxySort("coherence"));
document.getElementById("proxy-refresh-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  refreshProxyExplorer();
});
document.getElementById("heatmap-refresh-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  refreshHeatMap();
});
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.jumpToAbout = jumpToAbout;
window.setDialPosition = setDialPosition;
window.retryWithEarningsHoldThrough = retryWithEarningsHoldThrough;
export {
  authLogout,
  exportWatchlistCSV,
  logResultUI,
  refreshHeatMap,
  refreshProxyExplorer,
  renderHeatMap,
  renderProxyExplorer,
  setProxySort,
  toggleCompactSort,
  toggleProfileMenu
};
