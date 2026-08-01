
// ═══════════════════════════════════════════════════════════════════
// CREDIT SYSTEM — Trade Verdict
// ═══════════════════════════════════════════════════════════════════
// Storage: simple in-memory Map + JSON file on disk for persistence
// In production replace with Supabase when user base grows
//
// CREDIT ECONOMICS: 1 credit == 1 ticker analysis (one /analyze call).
// server.js deducts exactly 1 credit per ticker, before the Anthropic
// call, and never batches multiple tickers into one deduction — keep
// it that way so "credits" stays legible as "analyses." The Anthropic
// call is capped at max_tokens:800 on claude-sonnet-4-6, which keeps
// real cost per analysis well under the $0.05/credit target; if the
// model or max_tokens ever changes, re-check that math.
// ═══════════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");

const CREDIT_FILE = path.join(__dirname, "credits.json");

// Supabase client, injected by server.js. Not used for storage yet
// (still flat-file backed, see header) — kept so server.js's boot-time
// credits.setSupabase(supabase) call has somewhere to land instead of
// crashing, and so it's ready to wire up when storage moves off disk.
let supabaseClient = null;
function setSupabase(client) {
  supabaseClient = client;
}

// ── TIER DEFINITIONS ──────────────────────────────────────────────
const TIERS = {
  free: {
    name:          "Free",
    monthlyCredits: 0,          // free tier does NOT get a monthly allowance
    maxTickers:    3,
    cacheMinutes:  15,
    pulse:         false,
    tracker:       false,
    glossary:      true,
    alpaca:        false,
    earnings:      false,
    startingCredits: 3,         // hard cap: 3 credits, reset weekly (see checkWeeklyReset)
  },
  starter: {
    name:          "Starter",
    monthlyCredits: 45,
    maxTickers:    7,
    cacheMinutes:  5,
    pulse:         true,
    tracker:       false,
    glossary:      true,
    alpaca:        false,
    earnings:      false,
    maxRollover:   45,
    price:         9.99,
  },
  pro: {
    name:          "Pro",
    monthlyCredits: 100,
    maxTickers:    999,
    cacheMinutes:  1,
    pulse:         true,
    tracker:       true,
    glossary:      true,
    alpaca:        false,
    earnings:      false,
    maxRollover:   45,
    price:         16.99,
  },
  shark: {
    name:          "Shark",
    monthlyCredits: 145,
    maxTickers:    999,
    cacheMinutes:  1,
    pulse:         true,
    tracker:       true,
    glossary:      true,
    alpaca:        true,
    earnings:      true,
    maxRollover:   45,
    price:         39.99,
  },
};

// ── CREDIT STORE ──────────────────────────────────────────────────
let creditStore = {};

function loadCredits() {
  try {
    if (fs.existsSync(CREDIT_FILE)) {
      creditStore = JSON.parse(fs.readFileSync(CREDIT_FILE, "utf8"));
      console.log(`Credit store loaded: ${Object.keys(creditStore).length} users`);
    }
  } catch(e) {
    console.error("Credit store load failed:", e.message);
    creditStore = {};
  }
}

function saveCredits() {
  try {
    fs.writeFileSync(CREDIT_FILE, JSON.stringify(creditStore, null, 2));
  } catch(e) {
    console.error("Credit store save failed:", e.message);
  }
}

// ── USER RECORD ───────────────────────────────────────────────────
// apiKey → { tier, credits, purchasedCredits, lastReset, lastWeeklyReset, createdAt }
//
// apiKey formats in use:
//   "sub:<email>"  — logged-in user (any tier), stable across devices/IPs
//   "ip:<address>" — anonymous free-tier visitor, tracked per-IP
//   raw tier secret — legacy/manual paid-tier key (PATH 2 in server.js)
//
// `tier` is the authoritative tier for this request (from server.js's
// subscriber lookup / auth path). It's used to initialize new records
// and to keep an existing record's tier in sync (e.g. after an
// upgrade/downgrade), since credits.json is a secondary cache, not the
// source of truth for who's on what plan.
function getUser(apiKey, tier) {
  const initTier = (tier && TIERS[tier]) ? tier : "free";
  if (!creditStore[apiKey]) {
    creditStore[apiKey] = {
      tier:             initTier,
      credits:          TIERS[initTier].startingCredits ?? TIERS[initTier].monthlyCredits,
      purchasedCredits: 0,
      lastReset:        currentMonthKey(),
      lastWeeklyReset:  currentWeekKey(),
      createdAt:        new Date().toISOString(),
    };
    saveCredits();
  }
  const user = creditStore[apiKey];
  if (tier && TIERS[tier] && user.tier !== tier) {
    user.tier = tier;
  }
  return user;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}

// Fixed 7-day buckets since the Unix epoch — simple, timezone-free, and
// deterministic (no ISO-week edge cases to get wrong).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function currentWeekKey() {
  return Math.floor(Date.now() / WEEK_MS);
}

// ── MONTHLY RESET (paid tiers) ──────────────────────────────────────
function checkMonthlyReset(user) {
  const thisMonth = currentMonthKey();
  if (user.lastReset === thisMonth) return; // already reset this month

  const tier = TIERS[user.tier] || TIERS.free;

  // Roll over unused credits — capped at 45 across all tiers
  const unusedCredits  = Math.max(0, user.credits);
  const rollover       = Math.min(unusedCredits, tier.maxRollover ?? 45);

  // New balance = rollover + monthly allowance
  user.credits   = rollover + tier.monthlyCredits;
  user.lastReset = thisMonth;

  console.log(`Monthly reset for ${user.tier} user: ${rollover} rolled + ${tier.monthlyCredits} new = ${user.credits} credits`);
  saveCredits();
}

// ── WEEKLY RESET (free tier only) ───────────────────────────────────
// Free tier does not roll over — every reset is a hard reset back to
// the tier's starting credits (currently 3/week). This applies the
// same way whether the key is an anonymous IP or a logged-in email, so
// a signed-in free user's base allowance is still 3/week; the "+ BUY
// CREDITS $0.99" purchase option (logged-in only, see server.js) tops
// up purchasedCredits on top of that, and purchased credits never expire.
function checkWeeklyReset(user) {
  const thisWeek = currentWeekKey();
  if (user.lastWeeklyReset === thisWeek) return;

  user.credits         = TIERS.free.startingCredits;
  user.lastWeeklyReset = thisWeek;

  console.log(`Weekly reset for free user: ${user.credits} credits`);
  saveCredits();
}

// Called on every request — dispatches to the right reset cadence for
// the user's current tier.
function checkReset(user) {
  if (user.tier === "free") checkWeeklyReset(user);
  else checkMonthlyReset(user);
}

// ── CREDIT OPERATIONS ─────────────────────────────────────────────
function getTotalCredits(user) {
  return (user.credits || 0) + (user.purchasedCredits || 0);
}

function deductCredit(apiKey, count = 1, tier) {
  const user = getUser(apiKey, tier);
  checkReset(user);

  const total = getTotalCredits(user);
  if (total < count) return false; // insufficient credits

  // Deduct from purchased credits first (they never expire)
  // then from regular credits
  let remaining = count;
  if (user.purchasedCredits >= remaining) {
    user.purchasedCredits -= remaining;
  } else {
    remaining -= user.purchasedCredits;
    user.purchasedCredits = 0;
    user.credits -= remaining;
  }

  saveCredits();
  return true;
}

function addPurchasedCredits(apiKey, count, tier) {
  const user = getUser(apiKey, tier);
  user.purchasedCredits = (user.purchasedCredits || 0) + count;
  saveCredits();
  return getTotalCredits(user);
}

function upgradeTier(apiKey, newTier) {
  if (!TIERS[newTier]) return false;
  const user = getUser(apiKey, newTier);
  user.tier  = newTier;
  // Immediately give this month's credits on upgrade
  const tier = TIERS[newTier];
  user.credits   = Math.min(user.credits, tier.maxRollover ?? 45) + tier.monthlyCredits;
  user.lastReset = currentMonthKey();
  saveCredits();
  return true;
}

function getUserStatus(apiKey, tier) {
  const user = getUser(apiKey, tier);
  checkReset(user);
  const tierConfig = TIERS[user.tier] || TIERS.free;
  return {
    tier:             user.tier,
    tierName:         tierConfig.name,
    credits:          user.credits,
    purchasedCredits: user.purchasedCredits,
    totalCredits:     getTotalCredits(user),
    maxTickers:       tierConfig.maxTickers,
    cacheMinutes:     tierConfig.cacheMinutes,
    features:         {
      pulse:    tierConfig.pulse,
      tracker:  tierConfig.tracker,
      glossary: tierConfig.glossary,
      alpaca:   tierConfig.alpaca,
      earnings: tierConfig.earnings,
    },
    lastReset:       user.lastReset,
    lastWeeklyReset: user.lastWeeklyReset,
  };
}

module.exports = {
  TIERS,
  setSupabase,
  loadCredits,
  getUser,
  getUserStatus,
  deductCredit,
  addPurchasedCredits,
  upgradeTier,
  getTotalCredits,
};
