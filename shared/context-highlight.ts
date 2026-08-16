// Session Context is free text the user types before analyzing ("KOSPI
// down 4%, circuit breaker. NVDA earnings tomorrow...") — this doesn't
// touch that pipeline at all, it's a separate, purely visual signal: if
// a card's own news headline shares at least two distinct real words
// with whatever's currently in Session Context, those words get
// highlighted in the headline. One shared word is treated as
// coincidence (most headlines share a word like "stock" or "shares"
// with almost anything) and ignored; two or more is treated as an
// actual topical link worth calling out.

const STOPWORDS = new Set(['a','an','the','and','or','but','if','of','in','on','for','to','with','at','by','from','as',
  'is','are','was','were','be','been','being','it','its','this','that','these','those','after','before','over','under',
  'into','out','up','down','than','then','so','not','no','yes','has','have','had','will','would','could','should','can',
  'may','might','must','more','most','also','still','just','now','new','via','their','his','her','your','you','we','our']);

function tokenize(text: string): string[] {
  return (text || '').toLowerCase().match(/[a-z0-9$%]+/g) || [];
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Returns HTML-safe headline text (always escaped, whether or not
// anything matches) with any shared word wrapped in <mark class="ctx-match">.
export function highlightContextMatches(headline: string, contextText: string): string {
  var safe = escapeHtml(headline || '');
  var ctxWords = new Set(tokenize(contextText).filter(function(w){ return w.length > 2 && !STOPWORDS.has(w); }));
  if(ctxWords.size < 2) return safe;
  var headlineWords = new Set(tokenize(headline));
  var matches: string[] = [];
  headlineWords.forEach(function(w){ if(ctxWords.has(w)) matches.push(w); });
  if(matches.length < 2) return safe;
  var pattern = matches
    .sort(function(a, b){ return b.length - a.length; })
    .map(function(w){ return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
    .join('|');
  var re = new RegExp('\\b(' + pattern + ')\\b', 'gi');
  return safe.replace(re, '<mark class="ctx-match">$1</mark>');
}
