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

// shared/watchlist-sync.ts
var cfg = null;
var pulling = false;
function initWatchlistSync(config) {
  cfg = config;
}
var PULL_RETRY_DELAYS_MS = [0, 1500, 4e3];
async function pullWatchlistFromServer() {
  if (!cfg) return;
  var data = null;
  for (var i = 0; i < PULL_RETRY_DELAYS_MS.length && !data; i++) {
    if (PULL_RETRY_DELAYS_MS[i]) await new Promise(function(r) {
      setTimeout(r, PULL_RETRY_DELAYS_MS[i]);
    });
    try {
      var res = await fetch(cfg.addSecret(cfg.API_URL + "/watchlist"), { headers: cfg.authH(), cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch (e) {
    }
  }
  if (data) {
    if (data.tickers && data.tickers.length) {
      pulling = true;
      setWatchlist(data.tickers);
      pulling = false;
    } else if (watchlist.length) {
      pushWatchlistToServer(true);
    }
  }
}
var pushTimer = null;
function schedulePushWatchlist() {
  if (!cfg || pulling) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(function() {
    pushWatchlistToServer(false);
  }, 1200);
}
async function pushWatchlistToServer(seed) {
  if (!cfg) return;
  try {
    await fetch(cfg.addSecret(cfg.API_URL + "/watchlist"), { method: "POST", headers: cfg.authH(), body: JSON.stringify({ tickers: watchlist, seed: !!seed }) });
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
  return Math.max(0, els.gateFullOverlay.getBoundingClientRect().height - GATE_DOCKED_H);
}
function sizeGateSpacer() {
  spacerHeight = currentGateFullHeight();
  els.gateSpacer.style.height = (els.gateCard.classList.contains("docked") ? 0 : spacerHeight) + "px";
  updateGateDockState();
  scheduleFirstCardSnapCheck();
  sizeRoloIndexOffset();
}
function listHeadHeight() {
  return els.listHead.getBoundingClientRect().height;
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
  const roloIndexH = els.roloIndex.getBoundingClientRect().height;
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
  if (els.roloHint) els.roloHint.textContent = cards.length ? roloCurrent + 1 + " / " + cards.length : "\u2014 / \u2014";
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
  }
  return els.roloIndex.getBoundingClientRect().height;
}
function scrollToActiveCard() {
  const wrap = els.roloStage.closest(".rolo-wrap");
  if (!wrap) return;
  const roloIndexH = forceGateDockedSync();
  wrap.style.scrollMarginTop = GATE_DOCKED_H + listHeadHeight() + roloIndexH + "px";
  wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}
var CARD_BODY_MIN_HEIGHT = 120;
var CARD_BODY_BOTTOM_MARGIN = 16;
function capCardBodyHeight(cardEl, dockOffset) {
  const pad = cardEl.querySelector(".card-body-pad");
  const head = cardEl.querySelector(".card-head");
  if (!pad || !head) return;
  const available = els.scroller.clientHeight - dockOffset - head.getBoundingClientRect().height - CARD_BODY_BOTTOM_MARGIN;
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
  const roloIndexH = els.roloIndex.getBoundingClientRect().height;
  document.querySelectorAll(".card.expanded[data-card]").forEach((cardEl) => {
    capCardBodyHeight(cardEl, dockOffsetFor(cardEl, roloIndexH));
  });
}
var LANDSCAPE_HUD_MIN_HEIGHT = 160;
var LANDSCAPE_HUD_BOTTOM_MARGIN = 16;
var lsEls = null;
var lsOnSelect = null;
var lsIsActive = false;
var lsActiveCard = null;
var lsAnchors = /* @__PURE__ */ new Map();
function isLandscapeMode() {
  return lsIsActive;
}
function snapLandscapeHudUnderDock(hudEl) {
  if (!lsEls) return;
  const roloIndexH = forceGateDockedSync();
  const dockOffset = dockOffsetFor(hudEl, roloIndexH);
  hudEl.style.scrollMarginTop = dockOffset + "px";
  hudEl.scrollIntoView({ behavior: "smooth", block: "start" });
  const available = els.scroller.clientHeight - dockOffset - LANDSCAPE_HUD_BOTTOM_MARGIN;
  lsEls.pane.style.maxHeight = Math.max(LANDSCAPE_HUD_MIN_HEIGHT, available) + "px";
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
  Array.from(lsEls.ribbon.children).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.card === card.dataset.card);
  });
  if (lsOnSelect) lsOnSelect(card);
  snapLandscapeHudUnderDock(lsEls.hud);
}
function activateLandscape() {
  if (!lsEls) return;
  const cards = Array.from(document.querySelectorAll(".card[data-card]"));
  cards.forEach((card) => {
    if (!lsAnchors.has(card)) lsAnchors.set(card, { parent: card.parentNode, next: card.nextSibling });
    lsEls.pane.appendChild(card);
  });
  if (!lsEls.ribbon.childElementCount) buildLandscapeRibbon(cards);
  lsIsActive = true;
  if (lsActiveCard) selectLandscapeCard(lsActiveCard);
  else lsEls.empty.style.display = "";
}
function deactivateLandscape() {
  if (!lsEls) return;
  Array.from(document.querySelectorAll(".card[data-card]")).forEach((card) => {
    const anchor = lsAnchors.get(card);
    if (anchor) anchor.parent.insertBefore(card, anchor.next);
    card.classList.remove("landscape-active");
  });
  lsEls.pane.style.maxHeight = "";
  lsIsActive = false;
}
function initLandscapeMode(landscapeElements, onSelect) {
  lsEls = landscapeElements;
  lsOnSelect = onSelect;
  const mq = window.matchMedia("(orientation: landscape)");
  const apply = () => {
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
function roloDeleteThreshold(card) {
  return Math.min(120, card.getBoundingClientRect().width * 0.35);
}
function ensureRoloSwipeBg() {
  let bg = els.roloStage.querySelector(".rolo-swipe-bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.className = "rolo-swipe-bg";
    bg.innerHTML = '<span class="swipe-icon">\u{1F5D1}</span><span class="swipe-label">DELETE</span>';
    els.roloStage.insertBefore(bg, els.roloStage.firstChild);
  }
  return bg;
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
    const clamped = Math.min(0, Math.max(dx, -g.card.getBoundingClientRect().width));
    g.card.style.transform = "translateY(0) scale(1) translateX(" + clamped + "px)";
    const bg = ensureRoloSwipeBg();
    const progress = Math.min(Math.abs(clamped) / roloDeleteThreshold(g.card), 1);
    bg.style.opacity = String(progress);
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
  const threshold = roloDeleteThreshold(g.card);
  const bg = ensureRoloSwipeBg();
  if (Math.abs(g.pendingDx) >= threshold) {
    const w = g.card.getBoundingClientRect().width;
    g.card.style.transition = "transform .18s ease-in, opacity .18s ease-in";
    g.card.style.transform = "translateX(-" + (w + 40) + "px)";
    g.card.style.opacity = "0";
    const sym = cb.getWatchlist()[roloCurrent];
    setTimeout(() => {
      bg.style.opacity = "0";
      if (sym) cb.onDeleteConfirmed(sym);
    }, 180);
  } else {
    g.card.style.transition = "transform .18s ease";
    g.card.style.transform = "translateY(0) scale(1)";
    bg.style.opacity = "0";
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
function initHelpBalloons(content, onGlossaryJump) {
  helpContent = content;
  document.addEventListener("click", (e) => {
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
    const target = e.target;
    if ((e.key === "Enter" || e.key === " ") && (target.closest("[data-help]") || target.closest(".help-glossary-link"))) {
      e.stopPropagation();
    } else if (e.key === "Escape") {
      closeHelpBalloon();
    }
  }, true);
  els.scroller.addEventListener("scroll", () => {
    if (Date.now() - helpOpenedAt < HELP_SCROLL_GRACE_MS) return;
    closeHelpBalloon();
  });
  window.addEventListener("resize", closeHelpBalloon);
}
function initRolodex(elements, callbacks) {
  els = elements;
  cb = callbacks;
  GATE_DOCKED_H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gate-docked-h")) || 44;
  const contentEl = document.querySelector(".content");
  dockThreshold = contentEl ? parseFloat(getComputedStyle(contentEl).paddingTop) || 0 : 0;
  sizeRoloIndexOffset();
  window.addEventListener("resize", sizeGateMarquee);
  window.addEventListener("resize", sizeGateSpacer);
  window.addEventListener("resize", sizeRoloMarquee);
  window.addEventListener("resize", recapExpandedCards);
  window.addEventListener("resize", syncRoloStageHeight);
  window.addEventListener("resize", sizeRoloIndexOffset);
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

// starter/app.ts
var API_URL2 = "https://tra-zacg.onrender.com";
var market = null;
function isMarketClosed() {
  var now = /* @__PURE__ */ new Date();
  var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  var day = et.getDay();
  if (day === 0 || day === 6) return true;
  var mins = et.getHours() * 60 + et.getMinutes();
  return mins < 570 || mins >= 960;
}
function sigColor(s) {
  return { GREEN: "var(--green)", RED: "var(--red)", YELLOW: "var(--amber)", "N/A": "var(--ink-dim)" }[s] || "var(--ink-dim)";
}
function dirClass(d) {
  return d === "green" ? "up" : d === "red" ? "down" : d === "flat" ? "flat" : "neutral";
}
var sbSession = null;
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
function isSessionValid(s) {
  if (!s || !s.token) return false;
  if (s.expiresAt && Date.now() / 1e3 > s.expiresAt - 60) return false;
  return true;
}
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
  document.getElementById("auth-toggle").textContent = isL ? "New user? Create account" : "Already have an account? Sign in";
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
    var session = await r.json();
    storeSession(session);
    sbSession = session;
    btn.textContent = "SIGN IN";
    btn.disabled = false;
    checkTierAccess(session);
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
    err.style.color = "var(--green)";
    err.textContent = "Account created! Check your email to confirm, then sign in.";
    btn.textContent = "SIGN IN";
    btn.disabled = false;
    toggleAuthMode("login");
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
    pulseEl.className = "pulse-loading";
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
  if (card.dataset.card === "glossary") buildGlossary();
  if (!isLandscapeMode()) snapCardUnderDock(card);
  if (card.dataset.card === "scorecard") renderScorecardCard();
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
function logSectionHTML() {
  return '<div class="log-row"><span class="log-prompt">TRACK RECORD</span><a class="log-upgrade-btn" href="https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02" target="_blank">UPGRADE \u2192 Pro to log results</a></div>';
}
function gateListHTML(result, historicalReaction) {
  if (!result || !result.gates) {
    return '<div class="gate-list"><div class="gate-clear"><span class="gate-dot" style="background:var(--ink-faint)"></span><span>Tap ANALYZE to run the gates</span></div></div>';
  }
  const g = result.gates;
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
  return '<div class="gate-list">' + rows + logSectionHTML() + conf + track + "</div>";
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
  const dir = priceDirClass(td);
  return `<div class="ticker-row"><div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}">${price}</span><div class="ticker-swipe-hint">\u2190 Swipe to delete</div></div><div class="ticker-action">` + (result ? verdictAreaHTML(sym, result) : `<button class="btn btn-blue btn-compact${analyzing ? " btn-running" : ""}" data-analyze="${sym}" ${analyzing ? "disabled" : ""}>${analyzing ? "RUNNING\u2026" : "ANALYZE"}</button>`) + `</div></div>` + pregateStripHTML(result) + earningsBlockedRetryHTML(sym, result) + `<div class="headline">${wrapHeadlineLinks(sym, headline)} <span class="age">${age}</span></div><div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>\u03B2 <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyHTML}</b></span>${decayHTML}</div>` + badgesHTML(result) + gateListHTML(result, td && td.historicalReaction) + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : "");
}
function renderRoloCard(sym) {
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
  if (!card) return;
  const state = tickerState.get(sym);
  if (!state) return;
  card.innerHTML = roloCardHTML(sym, state);
  card.classList.remove("verdict-up", "verdict-down");
  const btn = card.querySelector("[data-analyze]");
  if (btn) btn.addEventListener("click", () => analyzeOne(sym));
  const resetEl = card.querySelector("[data-reset]");
  if (resetEl) resetEl.addEventListener("click", () => resetTicker(sym));
  if (state.result && !isMarketClosed()) {
    const v = (state.result.verdict || "").toUpperCase();
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
  tickerState.delete(sym);
  removeTicker(sym);
}
async function renderRolodexFromWatchlist() {
  document.getElementById("ticker-count").textContent = "CRF \xB7 " + watchlist.length + " TICKERS";
  roloStage.innerHTML = "";
  watchlist.forEach((sym) => {
    if (!tickerState.has(sym)) tickerState.set(sym, { td: null, result: null, analyzing: false, error: null });
    const card = document.createElement("div");
    card.className = "rolo-card";
    card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });
  rebuildRoloIndex(watchlist, (sym, i) => {
    const chip = document.createElement("button");
    chip.className = "rolo-chip";
    chip.dataset.sym = sym;
    chip.dataset.idx = String(i);
    return chip;
  }, `\u2014 ${watchlist.length} \u2014`);
  watchlist.forEach((sym) => renderPill(sym));
  clampRoloCurrent();
  positionRoloStack();
  requestAnimationFrame(() => {
    sizeGateSpacer();
    sizeRoloMarquee();
  });
  await Promise.all(watchlist.map(async (sym) => {
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if (state) {
      state.td = td;
    }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(() => sizeRoloMarquee());
  }));
  requestAnimationFrame(() => {
    sizeRoloMarquee();
    markRoloMarqueeDataReady();
  });
}
function refreshRoloCards() {
  watchlist.forEach((sym) => {
    if (tickerState.has(sym)) renderRoloCard(sym);
  });
}
var DIAL_POSITIONS = {
  ACTIVE_SWING: { label: "Aggressive", cadence: "Session-by-session", entries: "Opening Drive, Pre-Catalyst Buildup, post-flush", stops: "Tight (+4% / -1%)", recheck: "Every session", sizing: "Smaller, capped at HALF" },
  ACTIVE_LEAN: { label: "Light Aggressive", cadence: "Daily", entries: "Pre-Catalyst Buildup, post-flush (no Opening Drive)", stops: "Standard (+4% / -3%)", recheck: "Daily", sizing: "Standard" },
  NEUTRAL: { label: "CRF Default", cadence: "CRF default", entries: "CRF default", stops: "CRF default", recheck: "CRF default", sizing: "CRF default" },
  POSITION_LEAN: { label: "Light Passive", cadence: "2\u20133x per week", entries: "Post-flush only", stops: "Wider (-5%)", recheck: "2\u20133x per week", sizing: "Larger, fewer concurrent" },
  POSITION_LONG: { label: "Passive", cadence: "Weekly", entries: "Post-flush, full confirmation only", stops: "Widest (-8%)", recheck: "Weekly", sizing: "Largest, fewest concurrent" }
};
var DIAL_ORDER = ["ACTIVE_LEAN", "NEUTRAL", "POSITION_LEAN"];
function getDialPosition() {
  var v = localStorage.getItem("tv_dial_position");
  return v && DIAL_ORDER.indexOf(v) !== -1 ? v : "NEUTRAL";
}
function setDialPosition(pos) {
  if (DIAL_ORDER.indexOf(pos) === -1) return;
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
        holdThroughEarnings: !!holdThroughEarnings
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
    var _r = await res.json();
    cacheVerdict(sym, _r);
    state.result = _r;
    state.analyzing = false;
    renderRoloCard(sym);
    renderPill(sym);
    fetchCreditStatus();
  } catch (e) {
    state.analyzing = false;
    state.error = e.message;
    renderRoloCard(sym);
    renderPill(sym);
  }
}
function retryWithEarningsHoldThrough(sym) {
  const state = tickerState.get(sym);
  if (state) state.result = null;
  analyzeOne(sym, true);
}
function analyzeAll() {
  if (watchlist.length) goRolo(0);
  watchlist.forEach((sym) => analyzeOne(sym));
}
document.getElementById("analyzeAllBtn").addEventListener("click", analyzeAll);
document.getElementById("importBtn").addEventListener("click", addTickers);
async function exportWatchlistCSV(btnEl) {
  if (!watchlist.length) return alert("Watchlist is empty \u2014 nothing to export.");
  var old = null;
  if (btnEl) {
    old = btnEl.textContent;
    btnEl.textContent = "EXPORTING\u2026";
    btnEl.disabled = true;
  }
  var rows = await Promise.all(watchlist.map(async function(t) {
    var td = await fetchTickerData(t);
    var price = td && td.metrics && td.metrics.price != null ? td.metrics.price : "";
    var pct = td && td.metrics && typeof td.metrics.pct === "number" ? td.metrics.pct.toFixed(2) : "";
    return [t, price, pct];
  }));
  var csvEsc = function(v) {
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var csv = [["Ticker", "Price", "Change%"]].concat(rows).map(function(r) {
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
function handleNoCredits(sym) {
  const state = tickerState.get(sym);
  const cached = getCachedVerdict(sym);
  if (cached) {
    state.result = cached;
    state.error = null;
    renderRoloCard(sym);
    const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
    if (card) {
      const n = document.createElement("div");
      n.style.cssText = "font-family:var(--mono);font-size:10px;color:var(--amber);text-align:center;margin-top:4px";
      n.textContent = "Cached \u2014 no credits remaining";
      card.appendChild(n);
    }
    return;
  }
  state.error = "No credits remaining \u2014 buy more or upgrade to Pro.";
}
function enforceMarketState() {
  if (isMarketClosed()) {
    const sym = watchlist[getRoloCurrent()];
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
  { cat: "CRF FRAMEWORK", term: "Proxy", def: "The specific peer stock, ETF, or index a ticker is measured against for Gate 5 \u2014 shown on each card as PROXY. If the ticker and its proxy are moving together, that confirms the read; if they diverge, Gate 5 treats it as a warning sign.", ex: "IREN and CIFR are both checked against TSM, since Taiwan chip-supply stress hits the whole AI/semi trade the same way." },
  { cat: "CRF FRAMEWORK", term: "Verdict Icons \u2014 \u{1F44D} UP / \u{1F44E} DOWN / HOLD", def: "\u{1F44D} means the app leans bullish (expects the stock to rise), \u{1F44E} means it leans bearish (expects it to fall), and HOLD means it\u2019s not confident enough either way, or the market\u2019s closed.", ex: "Simple as a thumbs up or thumbs down on a movie \u2014 just for a stock\u2019s next move instead." },
  { cat: "MARKET STRUCTURE", term: "Beta (\u03B2)", def: "A stock\u2019s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as \u03B2. A negative beta means the stock tends to move opposite the market \u2014 treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.", ex: "IREN at \u03B22.1 is expected to move ~2.1% for every 1% SPY move. A rare \u03B2\u22120.3 name would be expected to drift up on a red SPY day." },
  { cat: "MARKET STRUCTURE", term: "Circuit Breaker", def: "Automatic trading halt when market falls a specified percentage. US halts at \u22127%, \u221213%, \u221220%. KOSPI at \u22128%.", ex: "KOSPI circuit breaker June 8 2026 at \u22128.37% \u2192 Gate 5 RED for all AI/semi." },
  { cat: "MARKET STRUCTURE", term: "Engulfing Candle", def: "Second candle\u2019s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.", ex: "Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf \u2192 Gate 3 GREEN." },
  { cat: "MARKET STRUCTURE", term: "Extended Hours (Pre-Market / Post-Market)", def: "Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange\u2019s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape \u2014 moves here can reverse hard once the full tape opens.", ex: "CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in." },
  { cat: "MARKET STRUCTURE", term: "Gap Up / Gap Down", def: "Stock opens significantly different from prior close. CRF entry: gap \u22652% from prior close, enter at ask +1%.", ex: "SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates." },
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
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Gamma Exposure (GEX)", def: "Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.", ex: "SPX negative GEX \u2192 Opening Drive gaps extend. Momentum more reliable." },
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
  { cat: "SECTOR TERMS", term: "TSM (Taiwan Semiconductor)", def: "World\u2019s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.", ex: "TSM \u22124% \u2192 Taiwan semi stress \u2192 risk-off on AI/semi entries." },
  { cat: "SECTOR TERMS", term: "XBI / IBB", def: "Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5 proxy for biotech/medical names.", ex: "XBI \u22122% \u2192 biotech risk-off \u2192 Gate 5 YELLOW or RED for SMMT/VCYT/IMVT." },
  { cat: "TICKER CLASSIFICATIONS", term: "Canary", def: "European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.", ex: "ASML fell before MU/ALAB. Warned 10-21 days early." },
  { cat: "TICKER CLASSIFICATIONS", term: "Flow", def: "Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.", ex: "ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares." },
  { cat: "TICKER CLASSIFICATIONS", term: "Phase 1 / 2 / 3", def: "Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.", ex: "ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat)." },
  { cat: "TICKER CLASSIFICATIONS", term: "Sentiment", def: "Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.", ex: "MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%." },
  { cat: "TRADING TERMINOLOGY", term: "14-Day Pre-Window", def: "14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (exhaustion).", ex: "MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print." },
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
  else if (!isLandscapeMode()) snapCardUnderDock(card);
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
async function renderScorecardCard() {
  var el = document.getElementById("scorecard-body");
  if (!el) return;
  el.innerHTML = '<div class="track-empty">Loading...</div>';
  try {
    var res = await fetch(addSecret2(API_URL2 + "/scorecard"), { headers: authH2() });
    if (res.status === 403) {
      el.innerHTML = '<div class="track-empty">Scorecard not available on this tier yet.</div>';
      return;
    }
    if (res.status === 401) {
      el.innerHTML = '<div class="track-empty">Sign in to see your personal scorecard.</div>';
      return;
    }
    var data = await res.json();
    if (data.insufficientData) {
      el.innerHTML = '<div class="track-empty">Accumulating \u2014 ' + (data.gradedCount || 0) + "/20 graded verdicts so far. Check back once more verdicts have been scored.</div>";
      return;
    }
    var strictRow = data.strictPct != null ? '<div class="trigger-row"><span class="trigger-lbl">Strict accuracy</span><span class="trigger-val">' + data.strictPct + "%</span></div>" : "";
    var html = '<div class="track-log-title">VERDICT ACCURACY (' + data.gradedCount + " graded)</div>" + strictRow + '<div class="trigger-row"><span class="trigger-lbl">Directional accuracy</span><span class="trigger-val">' + data.directionalPct + "%</span></div>";
    if (data.breakdown) {
      var section = function(title, key) {
        var groups = data.breakdown[key] || {};
        var rows = Object.keys(groups).map(function(k) {
          var g = groups[k];
          return '<div class="trigger-row"><span class="trigger-lbl">' + k + '</span><span class="trigger-val">' + (g.directionalPct != null ? g.directionalPct + "%" : "\u2014") + '</span><span class="trigger-sub">' + g.gradedCount + "</span></div>";
        }).join("");
        return rows ? '<div class="track-log-title" style="margin-top:12px">' + title + "</div>" + rows : "";
      };
      html += section("BY GATE 1 BRANCH", "gate1Branch") + section("BY PRE-GATE STATE", "preGateState") + section("BY GATE 0 READ", "gate0Read") + section("BY GATE 2 CORROBORATION", "gate2CorroborationState");
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
  out.innerHTML = '<div class="track-empty">Loading...</div>';
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
        var tGaugeHTML = '<div class="trigger-row"><span class="trigger-lbl-wrap"><span style="width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;background:' + sentColor + '"></span><span class="trigger-lbl">---</span></span><span class="trigger-val-wrap"><span class="trigger-val" style="color:' + tGaugeColor + '">' + (tComp ? tComp.level : "N/A") + '</span><button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span><span class="trigger-sub">' + topical.sentiment + (tComp ? " \xB7 " + Math.round(tComp.score / 10) + "/10" : "") + "</span></div>";
        var tHeadlineHTML = '<div class="headline" style="margin-top:8px"><a href="' + topical.url + '" target="_blank">' + topical.summary + "</a></div>";
        var tf = topical.factors;
        var tFactorsHTML = tf ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>' + agitatorFactorRow("Surprise", "agitator-surprise", tf.surprise ?? null) + agitatorFactorRow("Uncertainty", "agitator-uncertainty", tf.uncertainty ?? null) + agitatorFactorRow("Freshness", "agitator-freshness", tf.freshness ?? null) + agitatorFactorRow("Ripple Effect", "agitator-ripple", tf.rippleEffect ?? null) + agitatorFactorRow("Swing Risk", "agitator-swing", tf.swingRisk ?? null) + agitatorFactorRow("Expected Move", "agitator-expected-move", tf.expectedMove ?? null) : "";
        var tCompaniesHTML = topical.companies && topical.companies.length ? '<div class="track-log-title" style="margin-top:10px">RELATED</div><div class="compact-list">' + topical.companies.map(topicalCompanyRowHTML).join("") + "</div>" : "";
        topicalHTML = tGaugeHTML + tHeadlineHTML + tFactorsHTML + tCompaniesHTML;
      } else {
        topicalHTML = '<div class="track-empty">Couldn\u2019t find a company for "' + q + '".</div>';
      }
      out.innerHTML = suggestionHTML + topicalHTML;
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
    wireAgitatorAddButtons(out);
    if (!isLandscapeMode()) snapCardUnderDock(document.getElementById("card-agitator"));
  } catch (e) {
    out.innerHTML = '<div class="track-empty">Agitator Gauge unavailable right now.</div>';
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-running");
    btn.textContent = "Check Aggression";
  }
}
var HELP_CONTENT = {
  gate: 'Live status for SPY/QQQ and the sector proxies every ticker is checked against \u2014 feeds <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> for each verdict. Every verdict also carries a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> read \u2014 tap the docked bar to jump back to top. Pre/post-market prices are IEX-only and may vary from the full consolidated tape; built for regular-session (9:30am\u20134pm ET) analysis.',
  pulse: 'A quick AI-written read on today\u2019s overall market mood and <a class="help-glossary-link" href="#" data-term="sector rotation">sector rotation</a> \u2014 informational only, doesn\u2019t change any gate.',
  context: "Real news or catalysts you already know \u2014 auto-included in every analysis and checked against headlines. 2 of 3 matching signals marks it CONTEXT-CORROBORATED for Gate 2.",
  io: 'Paste or type <a class="help-glossary-link" href="#" data-term="ticker">tickers</a> or company names, one per line or comma-separated, to add them to your watchlist. Type a ticker in caps (AAPL) or a name any other way (Tesla) \u2014 either resolves to the right symbol.',
  scorecard: "Real, server-graded accuracy \u2014 every verdict is automatically checked against the actual price move ~3 trading days later, no manual logging needed. Suppressed until at least 20 verdicts have been graded.",
  agitator: "A standalone discovery tool for proofing a new stock interest or a media rumor BEFORE it enters your watchlist \u2014 free, no credit cost. Type a ticker, a company name, or paste a full headline/rumor \u2014 one box handles all three \u2014 and get a LOW/MEDIUM/HIGH read across 6 real signals, plus a few real related companies to also check. Past Reactions isn\u2019t tracked yet, so it\u2019s shown but never scored.",
  "agitator-score": "One overall number, 0-10, averaging the 6 signals below it \u2014 a quick read on how big a deal this news might be for the stock, not a precise measurement.",
  "agitator-surprise": "How unexpected this is for this company. A routine, expected update scores low; something out of the blue scores high.",
  "agitator-uncertainty": "How unclear it still is to everyone how big a deal this actually is. High means the market hasn\u2019t figured out how to react yet.",
  "agitator-freshness": "Is this brand-new information nobody has reacted to yet (high), or something already known and priced in days ago (low)?",
  "agitator-ripple": "How likely this is to also move other related stocks, the sector, or the broader market \u2014 not just this one company.",
  "agitator-swing": "How easily this stock\u2019s price can be pushed around. Smaller, thinly-traded stocks swing more on the same amount of buying or selling.",
  "agitator-expected-move": "How much price movement the options market is already betting on for this stock, right now.",
  "agitator-past": "How reliably this app\u2019s past verdicts on this ticker have graded out. Shows n/a until enough real graded history exists.",
  dial: "Sets your monitoring cadence and holding-period posture \u2014 Starter offers Light Aggressive, CRF Default, and Light Passive; Pro adds the full-strength Aggressive position above and the full-strength Passive position below. CRF Default behaves exactly like every other tier. Light Aggressive never inflates sizing beyond what your gates already earned. A real earnings print always blocks new entries first, at every position, unless you explicitly hold through it for that one check. Monitoring cadence, entry guidance, stop guidance, and recheck interval are informational \u2014 this app doesn\u2019t place real stop orders or send reminders yet."
};
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
  renderDialCard();
  setTimeout(fetchCreditStatus, 2e3);
  setInterval(function() {
    fetchMarket();
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
  var expectedTier = "starter";
  var err = document.getElementById("auth-error");
  if (session.tier !== expectedTier) {
    if (err) {
      err.style.color = "var(--amber)";
      if (session.tier === "free") {
        err.textContent = session.hasSubscribed ? "Your STARTER subscription is no longer active. Redirecting to free tier..." : "No active STARTER subscription. Redirecting to free tier...";
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
  showScreen("app-root");
  initApp();
  return true;
}
async function checkAuth() {
  var stored = getStoredSession();
  if (!stored || !isSessionValid(stored)) {
    showScreen("auth-screen");
    bindAuthEvents();
    return;
  }
  sbSession = stored;
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
}
initWatchlist({ defaultTickers: ["SMMT", "VCYT", "TWST", "IMVT", "IREN", "ALAB", "MU"], maxTickers: 7, upgradeMessage: "Starter tier supports up to 7 tickers.\n\nUpgrade to Pro for more." });
initTickerCache({ API_URL: API_URL2, authH: authH2, addSecret: addSecret2 });
initRolodex({
  scroller: document.getElementById("scroller"),
  gateCard: document.getElementById("gateCard"),
  gateFullOverlay: document.getElementById("gateFullOverlay"),
  gateSpacer: document.getElementById("gateSpacer"),
  gateMarquee,
  listHead: document.getElementById("listHead"),
  roloIndex,
  roloStage,
  roloHint: document.getElementById("roloHint")
}, {
  getWatchlist: () => watchlist,
  onActivate: (sym) => {
    const state = tickerState.get(sym);
    if (state && !state.result && !state.analyzing) analyzeOne(sym);
  },
  onDeleteConfirmed: deleteActiveTicker
});
initHelpBalloons(HELP_CONTENT, jumpToGlossaryTerm);
initLandscapeMode({
  hud: document.getElementById("landscapeHud"),
  ribbon: document.getElementById("utilityRibbon"),
  pane: document.getElementById("utilityPane"),
  empty: document.getElementById("utilityEmpty")
}, expandCard);
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
checkAuth();
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.exportWatchlistCSV = exportWatchlistCSV;
window.jumpToAbout = jumpToAbout;
window.setDialPosition = setDialPosition;
window.retryWithEarningsHoldThrough = retryWithEarningsHoldThrough;
export {
  authLogout,
  exportWatchlistCSV,
  toggleProfileMenu
};
