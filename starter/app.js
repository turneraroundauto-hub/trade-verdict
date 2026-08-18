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
function parseTickers(raw) {
  return raw.toUpperCase().replace(/[$#]/g, "").split(/[\s,;|\n]+/).map((t) => t.trim()).filter((t) => /^[A-Z]{1,6}$/.test(t));
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
function addTickers() {
  if (watchlist.length >= maxTickers) {
    alert(upgradeMessage);
    return;
  }
  var input = document.getElementById("ticker-input");
  var raw = input.value;
  var tickers = parseTickers(raw);
  if (!tickers.length) return alert("No valid tickers. Try: AAPL or MU");
  var newOnes = tickers.filter(function(t) {
    return !watchlist.includes(t);
  });
  watchlist.unshift.apply(watchlist, newOnes);
  input.value = "";
  saveWL();
  renderWatchlist();
  tickers.forEach(function(t) {
    fetchTickerData(t).then(function(d) {
      if (d) updateCardMeta(t, d);
    });
  });
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
function snapFirstCardUnderGateDock() {
  if (!els.gateCard.classList.contains("docked")) return;
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
function syncRoloStageHeight() {
  const cards = Array.from(els.roloStage.querySelectorAll(".rolo-card"));
  const activeCard = cards[roloCurrent];
  if (!activeCard) return;
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
  wrap.style.scrollMarginTop = GATE_DOCKED_H + roloIndexH + "px";
  wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}
function snapCardUnderDock(cardEl) {
  const roloIndexH = forceGateDockedSync();
  const afterPillStrip = !!(els.roloIndex.compareDocumentPosition(cardEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  cardEl.style.scrollMarginTop = GATE_DOCKED_H + (afterPillStrip ? roloIndexH : 0) + "px";
  cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
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
var HELP_BALLOON_MS = 5e3;
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
  helpTimer = setTimeout(closeHelpBalloon, HELP_BALLOON_MS);
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
  window.addEventListener("resize", sizeGateMarquee);
  window.addEventListener("resize", sizeGateSpacer);
  window.addEventListener("resize", sizeRoloMarquee);
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
var TIER = {
  name: "Starter",
  maxTickers: 7,
  pulse: true,
  tracker: false,
  alpaca: false,
  credits: "45 credits/mo",
  cache: "5 min cache",
  nextTier: "Pro",
  nextPrice: "$16.99/mo",
  stripeLink: "https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02",
  creditsLink: "https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00",
  badgeColor: "#40c4ff"
};
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
function promptLogResults() {
  var m = document.getElementById("profile-menu");
  if (m) m.classList.remove("open");
  if (confirm("Log Results tracks your win/loss outcomes over time \u2014 available on Pro.\n\nUpgrade now?")) {
    window.open(TIER.stripeLink, "_blank");
  }
}
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
  const marketLabel = closed ? "MARKET CLOSED" : "MARKET OPEN";
  const marketColor = closed ? "var(--red)" : "var(--green)";
  document.getElementById("gateMiniLabel").textContent = marketLabel;
  document.getElementById("gateMiniLabel").style.color = marketColor;
  document.getElementById("gateFullLabel").textContent = marketLabel;
  document.getElementById("gateFullLabel").style.color = marketColor;
  document.getElementById("gateNote").textContent = market && market.gateNote || (market ? "" : "Tap to retry \u2014 data unavailable.");
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
function wireAccordionHead(head) {
  function toggle() {
    const card = head.closest(".card");
    const wasExpanded = card.classList.contains("expanded");
    card.classList.toggle("expanded", !wasExpanded);
    head.setAttribute("aria-expanded", String(!wasExpanded));
    if (!wasExpanded) snapCardUnderDock(card);
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
function pregateStripHTML(result) {
  if (!result || !result.gates) return "";
  const waitText = result.wait_for && result.wait_for !== "null" ? result.wait_for : "";
  if (!waitText) return "";
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:${confColor(result.confidence)}"></div><div class="pregate-note"><span class="wait-lbl">LOOK FOR: </span>${waitText}</div></div>`;
}
function logSectionHTML() {
  return '<div class="log-row"><span class="log-prompt">TRACK RECORD</span><a class="log-upgrade-btn" href="https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02" target="_blank">UPGRADE \u2192 Pro to log results</a></div>';
}
function gateListHTML(result) {
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
    return `<div class="gate-row"><div class="gate-row-head"><span class="gate-dot" style="background:${sigColor(gate.status)}"></span><span class="gl">${label}</span></div>` + (gate.note ? `<div class="gn">${gate.note}</div>` : "") + "</div>";
  }).join("");
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ""}</span></div>`;
  return '<div class="gate-list">' + rows + logSectionHTML() + conf + "</div>";
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
  const headline = news ? highlightContextMatches(rawHeadline, ctxEl ? ctxEl.value : "") : rawHeadline;
  const age = news ? news.ageLabel : "\u2014";
  const m = td && td.metrics;
  const w52 = m && m.rangePosition != null ? m.rangePosition + "%" : "?";
  const phase = m && m.phaseProxy ? m.phaseProxy.replace("PHASE_", "") : "?";
  const beta = m && m.beta ? m.beta.toFixed(1) : "?";
  const proxyName = td && td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name.split("(")[0].trim() : "?";
  const proxySymbols = td && td.proxyRule && td.proxyRule.proxy && Array.isArray(td.proxyRule.proxy.symbols) ? td.proxyRule.proxy.symbols : [];
  const proxyHTML = proxySymbols.length === 1 ? `<a href="${tickerHref(proxySymbols[0])}" target="_blank">${proxyName}</a>` : proxyName;
  const analyzing = state.analyzing;
  const result = state.result;
  const dir = priceDirClass(td);
  return `<div class="ticker-row"><div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}">${price}</span></div><div class="ticker-action">` + (result ? verdictAreaHTML(sym, result) : `<button class="btn btn-blue btn-compact" data-analyze="${sym}" ${analyzing ? "disabled" : ""}>${analyzing ? "RUNNING\u2026" : "ANALYZE"}</button>`) + `</div></div>` + pregateStripHTML(result) + `<div class="headline"><a href="${newsHref(sym)}" target="_blank">${headline}</a> <span class="age">${age}</span></div><div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>\u03B2 <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyHTML}</b></span></div>` + badgesHTML(result) + gateListHTML(result) + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : "");
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
async function analyzeOne(sym) {
  const state = tickerState.get(sym);
  if (!state || state.analyzing) return;
  state.analyzing = true;
  state.error = null;
  renderRoloCard(sym);
  const td = state.td || await fetchTickerData(sym);
  state.td = td;
  if (td) renderRoloCard(sym);
  var ctx = document.getElementById("context-input").value;
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
        regimeData: td && td.regime ? td.regime : null
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
function analyzeAll() {
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
      n.style.cssText = "font-family:var(--mono);font-size:8px;color:var(--amber);text-align:center;margin-top:4px";
      n.textContent = "Cached \u2014 no credits remaining";
      card.appendChild(n);
    }
    return;
  }
  state.error = "No credits remaining \u2014 buy more or upgrade to Pro.";
}
var ctxDebounce = null;
function wireContextHighlight() {
  var ctxInputEl = document.getElementById("context-input");
  if (!ctxInputEl) return;
  ctxInputEl.addEventListener("input", function() {
    if (ctxDebounce) clearTimeout(ctxDebounce);
    ctxDebounce = setTimeout(refreshRoloCards, 250);
  });
}
function enforceMarketState() {
  if (isMarketClosed()) {
    const sym = watchlist[getRoloCurrent()];
    if (sym && tickerState.has(sym)) renderRoloCard(sym);
  }
}
var GLOSSARY = [
  { cat: "CRF FRAMEWORK", term: "CRF (Catalyst Response Framework)", def: "A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that\u2019s a thumbs up; if enough looks bad, that\u2019s a thumbs down.", ex: "Think of it like a pre-flight checklist for a trade \u2014 pilots don\u2019t take off until enough boxes are checked." },
  { cat: "CRF FRAMEWORK", term: "Pre-Gate \u2014 Thesis Integrity", def: "A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock\u2019s price. A serious red flag here can override everything else.", ex: "Like checking a used car\u2019s title for a salvage flag before you even look under the hood." },
  { cat: "CRF FRAMEWORK", term: "Gate 0 \u2014 Sector Gate", def: "Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.", ex: "A rising tide lifts all boats \u2014 a sinking one drags them down too." },
  { cat: "CRF FRAMEWORK", term: "Gate 1 \u2014 Bidirectional Trend Structure", def: "Looks at whether the stock has already made a big move recently, up or down. A stock that\u2019s already run up a lot is riskier to chase, and one that\u2019s fallen too far too fast is a red flag too.", ex: "Like being wary of a stock that already \u201Cran\u201D \u2014 you don\u2019t want to be the last one to the party." },
  { cat: "CRF FRAMEWORK", term: "Gate 2 \u2014 Catalyst Congruence", def: "Checks whether recent news about the company actually supports the direction the app is leaning.", ex: "Makes sure the story and the numbers are telling the same story." },
  { cat: "CRF FRAMEWORK", term: "Gate 3 \u2014 Opening Bar", def: "Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.", ex: "Like judging a race by how strong the runners look at the starting gun." },
  { cat: "CRF FRAMEWORK", term: "Gate 4 \u2014 Phase Identification", def: "Figures out whether a stock\u2019s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.", ex: "Early innings vs. late innings of the same game." },
  { cat: "CRF FRAMEWORK", term: "Gate 5 \u2014 Dynamic Sector Proxy", def: "Compares the stock to other companies or funds in the same industry, to see if it\u2019s moving with its peers or acting strangely on its own.", ex: "Checking if one kid in class is sick, or if the whole class has the flu." },
  { cat: "TICKER CLASSIFICATIONS", term: "Canary", def: "European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.", ex: "ASML fell before MU/ALAB. Warned 10-21 days early." },
  { cat: "TICKER CLASSIFICATIONS", term: "Sentiment", def: "Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.", ex: "MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%." },
  { cat: "TICKER CLASSIFICATIONS", term: "Flow", def: "Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.", ex: "ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares." },
  { cat: "TICKER CLASSIFICATIONS", term: "Phase 1 / 2 / 3", def: "Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.", ex: "ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat)." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Delta (\u0394)", def: "How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.", ex: "Delta 0.50 call gains $0.50 when stock rises $1." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Gamma (\u0393)", def: "Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.", ex: "High-gamma option: $1 stock move shifts delta from 0.50 to 0.65." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Theta (\u0398)", def: "Time decay per day. Sellers\u2019 friend, buyers\u2019 enemy. Accelerates in final 2 weeks before expiry.", ex: "$2.00 option with theta \u22120.05 loses $0.50 over 10 days even if stock flat." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Vega (\u03BD)", def: "Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).", ex: "Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts \u2192 option now $1.80." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Implied Volatility (IV)", def: "Market\u2019s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.", ex: "ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "IV Rank (IVR)", def: "Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.", ex: "IVR 85 = IV higher than 85% of readings this year \u2192 Gate 4 RED lean." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Put/Call Skew", def: "Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.", ex: "CHAT showed consistent +4pt put skew \u2192 Gate 2 bearish lean." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Expected Move", def: "Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.", ex: "Stock $50, ATM IV 80%, 30 DTE \u2192 expected move \xB1$12.30." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "IV Crush", def: "Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.", ex: "Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts \u2192 put now $1.80." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Cash-Secured Put", def: "Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you\u2019d want to own.", ex: "ARCC at $18.50 \u2192 sell $18 put for $0.48. Assigned = effective buy at $17.52." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Gamma Exposure (GEX)", def: "Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.", ex: "SPX negative GEX \u2192 Opening Drive gaps extend. Momentum more reliable." },
  { cat: "MARKET STRUCTURE", term: "Opening Drive", def: "First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.", ex: "Stock gaps up 3% with 2\xD7 average volume in bar 1 = Opening Drive setup." },
  { cat: "MARKET STRUCTURE", term: "Gap Up / Gap Down", def: "Stock opens significantly different from prior close. CRF entry: gap \u22652% from prior close, enter at ask +1%.", ex: "SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates." },
  { cat: "MARKET STRUCTURE", term: "Engulfing Candle", def: "Second candle\u2019s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.", ex: "Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf \u2192 Gate 3 GREEN." },
  { cat: "MARKET STRUCTURE", term: "Circuit Breaker", def: "Automatic trading halt when market falls a specified percentage. US halts at \u22127%, \u221213%, \u221220%. KOSPI at \u22128%.", ex: "KOSPI circuit breaker June 8 2026 at \u22128.37% \u2192 Gate 5 RED for all AI/semi." },
  { cat: "MARKET STRUCTURE", term: "Short Squeeze", def: "Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.", ex: "IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze." },
  { cat: "SECTOR TERMS", term: "KOSPI", def: "Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.", ex: "KOSPI \u22126% Tuesday \u2192 NVDA/MU/ALAB pressure Thursday-Friday." },
  { cat: "SECTOR TERMS", term: "TSM (Taiwan Semiconductor)", def: "World\u2019s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.", ex: "TSM \u22124% \u2192 Taiwan semi stress \u2192 risk-off on AI/semi entries." },
  { cat: "SECTOR TERMS", term: "XBI / IBB", def: "Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5 proxy for biotech/medical names.", ex: "XBI \u22122% \u2192 biotech risk-off \u2192 Gate 5 YELLOW or RED for SMMT/VCYT/IMVT." },
  { cat: "SECTOR TERMS", term: "SOXX", def: "iShares Semiconductor ETF. Tracks 30 largest US-listed semiconductor companies. Best sector indicator for AI/chip trades.", ex: "SOXX \u22123% while SPY flat = semiconductor-specific stress." },
  { cat: "SECTOR TERMS", term: "HBM (High Bandwidth Memory)", def: "RAM designed for AI training. Only Micron, Samsung, SK Hynix make it. Core of MU\u2019s AI thesis.", ex: "Hyperscaler capex slowdown = HBM demand slowdown = MU pressure." },
  { cat: "SECTOR TERMS", term: "Neocloud", def: "Companies renting GPU compute to AI developers. Borrow billions to buy Nvidia GPUs, rent at premium.", ex: "IREN, CoreWeave. Revenue real; profitability theoretical for most." },
  { cat: "SECTOR TERMS", term: "BDC (Business Development Company)", def: "Fund making loans to mid-sized businesses, required to distribute 90%+ of income as dividends.", ex: "ARCC is the largest publicly traded BDC. Income from loan interest, not appreciation." },
  { cat: "TRADING TERMINOLOGY", term: "Long", def: "Buying and owning shares expecting price to rise.", ex: "Buy 100 SMMT at $45. Sell at $50. $500 profit." },
  { cat: "TRADING TERMINOLOGY", term: "Short / Short Selling", def: "Borrowing shares, selling immediately, buying back later. Profit if price falls. Loss if rises \u2014 theoretically unlimited.", ex: "Short 100 IREN at $40. Falls to $32 \u2192 $800 profit." },
  { cat: "TRADING TERMINOLOGY", term: "Defined Risk", def: "Position where max loss is fixed at entry. Buying options or spreads. Cannot lose more than premium paid.", ex: "Buy 1 put for $200. Stock rallies. Max loss = $200." },
  { cat: "TRADING TERMINOLOGY", term: "Stop Loss", def: "Pre-set price at which you automatically exit to limit losses. Set before entry. CRF: \u22123% for high-conviction names.", ex: "Enter SMMT at $45. Stop at $43.65 (\u22123%). Hit $43.65 \u2192 exit immediately." },
  { cat: "TRADING TERMINOLOGY", term: "Sector Rotation", def: "Money moving from one sector to another. Sector pulse blurb tracks this daily.", ex: "AI fears \u2192 money rotates from NVDA into GLD and USO." },
  { cat: "TRADING TERMINOLOGY", term: "Sell the News", def: "Stock falls after a positive catalyst because good news was already priced in. Phase 3 behavior.", ex: "ALAB beats Q1 by 12%. Stock drops 13% next day. Beat was priced in." },
  { cat: "TRADING TERMINOLOGY", term: "14-Day Pre-Window", def: "14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (exhaustion).", ex: "MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print." },
  { cat: "TRADING TERMINOLOGY", term: "Pyramiding", def: "Adding to a winning position in smaller increments as it moves in your favor.", ex: "100 shares at $45. Rises to $47 \u2192 add 50. Hits $49 \u2192 add 25." },
  { cat: "TRADING TERMINOLOGY", term: "GTC (Good Till Cancelled)", def: "Order that stays active until manually cancelled. Use for stop losses on multi-day holds.", ex: "GTC stop at $43.65 on SMMT triggers automatically even if it gaps down overnight." },
  { cat: "OPTIONS \u2014 GREEKS", term: "Rho (\u03C1)", def: "Sensitivity to a 1% change in interest rates. Smallest of the four Greeks for short-dated options \u2014 matters on LEAPS-length duration, negligible for the Opening Drive holds this app is built around.", ex: "A 6-month call with Rho 0.15 gains ~$0.15 per 1% rate hike \u2014 a rounding error next to a same-day 3% move driven by Delta/Gamma." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Call Option", def: "Right (not obligation) to buy 100 shares at the strike price before expiration. Buyers profit if the stock rises above strike + premium paid.", ex: "Buy 1 SMMT $50 call for $2.00. Stock closes $55 at expiry \u2192 intrinsic value $5.00, profit $3.00/share." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Put Option", def: "Right (not obligation) to sell 100 shares at the strike price before expiration. Buyers profit if the stock falls below strike \u2212 premium paid.", ex: "Buy 1 IREN $35 put for $1.50. Stock drops to $30 at expiry \u2192 intrinsic value $5.00, profit $3.50/share." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "Strike Price", def: "The fixed price at which an option\u2019s owner can buy (call) or sell (put) the underlying. Set when the contract is created and never changes.", ex: "A $45 call and a $50 call on the same expiry are different contracts \u2014 the $45 strike is already in-the-money at a $47 stock price, the $50 strike is not." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "DTE (Days to Expiration)", def: "Calendar days remaining until an option contract expires. Theta decay accelerates as DTE shrinks, especially inside the final 2 weeks.", ex: "A 30 DTE option loses value slowly. The same strike at 3 DTE bleeds premium daily even on a flat stock." },
  { cat: "OPTIONS \u2014 CONCEPTS", term: "ITM / ATM / OTM", def: "In-the-money (has intrinsic value \u2014 call strike below spot, put strike above), at-the-money (strike \u2248 spot), out-of-the-money (no intrinsic value yet, pure premium). Delta approximates the odds of finishing ITM.", ex: "Stock at $50: the $45 call is ITM, the $50 call is ATM, the $55 call is OTM." },
  { cat: "TRADING TERMINOLOGY", term: "Bid / Ask (Bid-Ask Spread)", def: "Bid = highest price a buyer will pay right now. Ask = lowest price a seller will accept. The spread between them is a real, invisible cost \u2014 wider on illiquid names and thin extended-hours books.", ex: "IREN bid $39.98 / ask $40.05 \u2014 a market order to buy fills near $40.05, not the $40.00 last-trade price shown on the card." },
  { cat: "TRADING TERMINOLOGY", term: "Limit Order", def: "An order that only fills at your specified price or better. Guarantees price, not execution \u2014 can go unfilled if the stock never trades there.", ex: "Limit buy SMMT at $45.00 while it\u2019s trading $45.20 \u2014 sits unfilled until the price comes down to you (or never)." },
  { cat: "TRADING TERMINOLOGY", term: "Market Order", def: "An order that fills immediately at the best available price. Guarantees execution, not price \u2014 on a fast-moving or thin name you can pay meaningfully more than the last quote.", ex: "A market buy during a gap-up Opening Drive can fill 1-2% above the price you saw when you clicked." },
  { cat: "TRADING TERMINOLOGY", term: "Ladder / Laddering", def: "Splitting one order into several smaller limit orders staggered across a price range instead of one order at one price. Improves average fill price on size that would otherwise move a thin book.", ex: "Instead of one 500-share market buy, ladder 100 shares each at $45.00/$45.10/$45.20/$45.30/$45.40." },
  { cat: "MARKET STRUCTURE", term: "VWAP (Volume-Weighted Average Price)", def: "The running average price of a stock for the session, weighted by volume at each price. Resets daily. Widely used intraday as a fair-value line \u2014 price above VWAP favors longs, below favors shorts.", ex: "Stock pops to $52 but VWAP sits at $49.80 \u2014 a lot of the day\u2019s volume already changed hands well below the current price." },
  { cat: "MARKET STRUCTURE", term: "Relative Volume (RVOL)", def: "Current volume compared to the average volume for this point in the session. RVOL >2x on an Opening Drive gap is what separates a real institutional move from noise.", ex: "ALAB gaps up 4% on 1.1M shares in the first 5 minutes vs a normal 5-minute average of 280K \u2192 RVOL ~4x, high-conviction signal." },
  { cat: "MARKET STRUCTURE", term: "Support / Resistance", def: "Price levels where a stock has historically reversed. Support = a floor buyers defended before. Resistance = a ceiling sellers defended before. Neither is guaranteed to hold twice.", ex: "PLUG bounced at $2.10 three times this quarter \u2014 that\u2019s support until it isn\u2019t; a close below it on volume is the tell it broke." },
  { cat: "MARKET STRUCTURE", term: "Extended Hours (Pre-Market / Post-Market)", def: "Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange\u2019s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape \u2014 moves here can reverse hard once the full tape opens.", ex: "CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in." },
  { cat: "MARKET STRUCTURE", term: "Beta (\u03B2)", def: "A stock\u2019s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as \u03B2. A negative beta means the stock tends to move opposite the market \u2014 treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.", ex: "IREN at \u03B22.1 is expected to move ~2.1% for every 1% SPY move. A rare \u03B2\u22120.3 name would be expected to drift up on a red SPY day." },
  { cat: "MARKET STRUCTURE", term: "Intraday", def: "Within a single trading day \u2014 opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app\u2019s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3\u2019s same-day bar sequence, and same-day stop-loss discipline.", ex: "An intraday call on SMMT is graded against its move by that day\u2019s close, not next week\u2019s \u2014 Gate 3\u2019s opening-bar sequence only exists because the framework is timing a single session." },
  { cat: "CRF FRAMEWORK", term: "Verdict Icons \u2014 \u{1F44D} UP / \u{1F44E} DOWN / HOLD", def: "\u{1F44D} means the app leans bullish (expects the stock to rise), \u{1F44E} means it leans bearish (expects it to fall), and HOLD means it\u2019s not confident enough either way, or the market\u2019s closed.", ex: "Simple as a thumbs up or thumbs down on a movie \u2014 just for a stock\u2019s next move instead." },
  { cat: "CRF FRAMEWORK", term: "Confidence", def: "How strongly the verdict\u2019s own price action agrees with the trigger driving it. HIGH means both the ticker\u2019s own move and its sector proxy\u2019s move confirm the call. MEDIUM means the trigger is clean but there\u2019s no independent price data to confirm or deny it yet. LOW means real price action is actually moving against the call \u2014 and every LOW-confidence verdict always ships a real \u201CLOOK FOR\u201D note explaining what to watch for before acting.", ex: "A DOWN verdict where the stock itself is also selling off hard is HIGH confidence. The same DOWN verdict on a stock that\u2019s actually holding flat or ticking up is LOW \u2014 check the LOOK FOR note before acting." },
  { cat: "TRADING TERMINOLOGY", term: "Ticker", def: "The short letter code (usually 1-5 letters) that identifies one specific stock or fund on an exchange, like IREN or SPY. What you type into Import to add a name to your watchlist.", ex: "MU, ALAB, and TSM are all tickers \u2014 three different companies, three different symbols." }
];
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
function setGlossaryOpen(open) {
  var panel = document.getElementById("glossary-panel");
  var arrow = document.getElementById("glossary-arrow");
  var header = document.getElementById("glossary-header");
  panel.classList.toggle("open", open);
  arrow.classList.toggle("open", open);
  header.classList.toggle("open", open);
  if (open) buildGlossary();
}
function toggleGlossary() {
  var panel = document.getElementById("glossary-panel");
  setGlossaryOpen(!panel.classList.contains("open"));
}
function jumpToGlossaryTerm(key) {
  setGlossaryOpen(true);
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
document.getElementById("glossary-header").addEventListener("click", toggleGlossary);
document.getElementById("glossary-search").addEventListener("input", (e) => filterGlossary(e.target.value));
var HELP_CONTENT = {
  gate: 'Live status for SPY/QQQ and the sector proxies every ticker is checked against \u2014 feeds <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> for each verdict. Every verdict also carries a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> read \u2014 tap the docked bar to jump back to top.',
  pulse: 'A quick AI-written read on today\u2019s overall market mood and <a class="help-glossary-link" href="#" data-term="sector rotation">sector rotation</a> \u2014 informational only, doesn\u2019t change any gate.',
  context: "Type in real news or catalysts you already know. Matched against headlines as corroboration for Gate 2 \u2014 when it lines up with 2 of 3 real signals, it\u2019s marked CONTEXT-CORROBORATED.",
  io: 'Paste or type <a class="help-glossary-link" href="#" data-term="ticker">tickers</a>, one per line or comma-separated, to add them to your watchlist.'
};
function initApp() {
  cleanLS();
  document.getElementById("ticker-count").textContent = "CRF \xB7 " + watchlist.length + " TICKERS";
  wireContextHighlight();
  onPrefsChange(function() {
    refreshRoloCards();
    renderMarketTs();
    refreshTickerLinks(document.getElementById("gateGrid"));
    refreshTickerLinks(gateMarquee);
  });
  fetchMarket();
  sizeGateSpacer();
  renderRolodexFromWatchlist();
  setTimeout(fetchCreditStatus, 2e3);
  setInterval(function() {
    fetchMarket();
  }, 4 * 60 * 1e3);
  enforceMarketState();
  setInterval(enforceMarketState, 60 * 1e3);
  if (sbSession && sbSession.email) {
    var pb = document.getElementById("profile-btn");
    if (pb) pb.textContent = sbSession.email.charAt(0).toUpperCase();
    var pme = document.getElementById("profile-menu-email");
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
checkAuth();
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.promptLogResults = promptLogResults;
window.exportWatchlistCSV = exportWatchlistCSV;
export {
  authLogout,
  exportWatchlistCSV,
  promptLogResults,
  toggleProfileMenu
};
