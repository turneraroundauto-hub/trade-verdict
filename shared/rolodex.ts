// Rolodex UI mechanics -- extracted from starter/app.js (Aug 16, 2026,
// Phase 3 kickoff of the TypeScript adoption plan) so Free/Pro's own
// eventual Rolodex builds can reuse this instead of hand-copying it, the
// way Starter's own build was created. Every hard-won fix from the
// preview/rolodex/ iteration saga and the Starter build (Gate dock-
// threshold math, marquee wrap-boundary arithmetic, the self-healing
// pause, swipe-to-delete) lives here now, in exactly one place.
//
// Scope boundary, deliberate: this module owns HOW the UI moves (dock/
// undock, marquee stepping, stacked-card positioning, swipe gesture) --
// never WHAT it shows. Card content (roloCardHTML, gate rendering,
// ticker links), GATE_FIELDS, and all business logic (analyzeOne, the
// real /analyze call) stay tier-owned, since those genuinely differ per
// tier (Pro's card/list-window split and exclusive features, Free's
// teased Sector Pulse). Trying to force those into this module before a
// second real consumer (Free) proves out what's actually shared would be
// premature abstraction in the other direction.
//
// This is also this repo's first Phase 3 (bundler) module -- see
// esbuild.config.mjs. It's authored with real, unversioned ES imports
// (no `?v=N`), because esbuild resolves and inlines them at build time;
// the emitted bundle is what tiers actually import.

export interface RolodexElements {
  scroller: HTMLElement;
  gateCard: HTMLElement;
  gateFullOverlay: HTMLElement;
  gateSpacer: HTMLElement;
  gateMarquee: HTMLElement;
  roloIndex: HTMLElement;
  roloStage: HTMLElement;
  roloHint: HTMLElement | null;
}

export interface RolodexCallbacks {
  // Called after goRolo() has repositioned the stack and scrolled the
  // active card into view -- the tier's own hook for "auto-analyze if
  // this ticker has no result yet," same as the rest of the app's logic.
  onActivate: (sym: string, index: number) => void;
  // Called once a swipe-to-delete gesture crosses its threshold and the
  // slide-out animation finishes -- the tier calls its own removeTicker()
  // (shared/watchlist.ts's real one, with persistence/sync/undo toast).
  onDeleteConfirmed: (sym: string) => void;
  getWatchlist: () => string[];
}

const GATE_MARQUEE_SPEED = 0.4;
const ROLO_MARQUEE_SPEED = 0.5;
const ROLO_MARQUEE_RESUME_MS = 2000;
const ROLO_SWIPE_MOVE_THRESHOLD = 14;

let els: RolodexElements;
let cb: RolodexCallbacks;
let GATE_DOCKED_H = 44;

// ── Gate dock/scroll mechanics ─────────────────────────────────────────
let spacerHeight = 0;
let dockThreshold = 0;
let gateDockedLast = false;
let gateTicking = false;

function currentGateFullHeight(): number {
  return Math.max(0, els.gateFullOverlay.getBoundingClientRect().height - GATE_DOCKED_H);
}

export function sizeGateSpacer(): void {
  spacerHeight = currentGateFullHeight();
  els.gateSpacer.style.height = (els.gateCard.classList.contains('docked') ? 0 : spacerHeight) + 'px';
  updateGateDockState();
}

export function updateGateDockState(): void {
  const docked = els.scroller.scrollTop >= dockThreshold;
  els.gateCard.classList.toggle('docked', docked);
  els.gateCard.setAttribute('aria-expanded', String(!docked));
  if (docked !== gateDockedLast) {
    els.gateSpacer.style.height = (docked ? 0 : spacerHeight) + 'px';
    gateDockedLast = docked;
  }
}

export function jumpToTop(): void {
  els.scroller.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Gate's own index marquee (docked bar) ──────────────────────────────
let gateMarqueeOneSetW = 0;
let gateMarqueePos = 0;

// Caller supplies the built item HTML (GATE_FIELDS + tickerHref links are
// tier-owned content) -- this just wires the duplicate-pass marquee shell
// and re-measures.
export function buildGateMarquee(itemsHTML: string): void {
  els.gateMarquee.innerHTML = itemsHTML + itemsHTML;
  gateMarqueePos = 0;
  requestAnimationFrame(sizeGateMarquee);
}

// Measures pass1's first item vs pass2's first item directly -- scrollLeft/
// padding/gap all cancel out of the difference automatically.
function sizeGateMarquee(): void {
  const items = els.gateMarquee.querySelectorAll<HTMLElement>('.gm-item');
  if (items.length < 2) { gateMarqueeOneSetW = els.gateMarquee.scrollWidth / 2; return; }
  const firstPassStart = items[0].getBoundingClientRect().left;
  const secondPassStart = items[items.length / 2].getBoundingClientRect().left;
  gateMarqueeOneSetW = secondPassStart - firstPassStart;
}

function stepGateMarquee(): void {
  if (els.gateCard.classList.contains('docked') && gateMarqueeOneSetW > 0) {
    gateMarqueePos += GATE_MARQUEE_SPEED;
    if (gateMarqueePos >= gateMarqueeOneSetW) { gateMarqueePos -= gateMarqueeOneSetW; }
    els.gateMarquee.scrollLeft = Math.round(gateMarqueePos);
  }
  requestAnimationFrame(stepGateMarquee);
}

// ── Stacked-card positioning ────────────────────────────────────────────
let roloCurrent = 0;

export function getRoloCurrent(): number {
  return roloCurrent;
}

export function syncRoloStageHeight(): void {
  const cards = Array.from(els.roloStage.querySelectorAll<HTMLElement>('.rolo-card'));
  const activeCard = cards[roloCurrent];
  if (!activeCard) return;
  els.roloStage.style.height = activeCard.offsetHeight + 'px';
}

export function positionRoloStack(): void {
  const cards = Array.from(els.roloStage.querySelectorAll<HTMLElement>('.rolo-card'));
  cards.forEach((card, i) => {
    const d = i - roloCurrent, abs = Math.abs(d);
    card.style.pointerEvents = abs === 0 ? 'auto' : 'none';
    if (abs === 0) {
      card.style.transform = 'translateY(0) scale(1)'; card.style.opacity = '1'; card.style.zIndex = '10'; card.style.filter = 'none';
    } else if (abs <= 2) {
      card.style.transform = `translateY(${d < 0 ? -14 * abs : 14 * abs}px) scale(${1 - 0.05 * abs})`;
      card.style.opacity = String(0.55 - 0.2 * (abs - 1)); card.style.zIndex = String(10 - abs); card.style.filter = 'brightness(.7)';
    } else {
      card.style.transform = `translateY(${d < 0 ? -60 : 60}px) scale(0.85)`; card.style.opacity = '0'; card.style.zIndex = '1';
    }
  });
  const chips = Array.from(els.roloIndex.querySelectorAll<HTMLElement>('.rolo-chip'));
  chips.forEach((chip) => chip.classList.toggle('active', +(chip.dataset.idx || -1) === roloCurrent));
  if (els.roloHint) els.roloHint.textContent = cards.length ? (roloCurrent + 1) + ' / ' + cards.length : '— / —';
  syncRoloStageHeight();
}

// Tapping a pill can happen from anywhere on the page -- #roloIndex stays
// sticky-docked all the way through content that follows it, so the card
// itself can be scrolled well out of view. scrollIntoView (not a hand-
// computed scrollTop) so it stays correct automatically as the Gate/pill-
// strip's own real heights change, rather than re-deriving offsets by
// hand -- this codebase has repeatedly relearned that lesson the hard way.
function scrollToActiveCard(): void {
  const wrap = els.roloStage.closest<HTMLElement>('.rolo-wrap');
  if (!wrap) return;
  // Force the Gate into its docked layout BEFORE computing the scroll
  // target, not after. scrollIntoView() computes its destination once,
  // synchronously, against the CURRENT document layout -- but a real
  // scroll normally triggers updateGateDockState() to collapse
  // gateSpacer's ~150-200px of reserved flow space. Left to happen only
  // via the scroll event, that collapse lands while the native
  // smooth-scroll animation is already mid-flight toward a target
  // computed against the OLD (taller) layout -- the page shifts out from
  // under the animation and it overshoots. Confirmed via direct
  // getBoundingClientRect measurement (Aug 16, 2026): the active card
  // ended up rendered partially UNDER the sticky pill strip instead of
  // below it, breaking pointer targeting on the card's top edge (the
  // swipe-to-delete gesture's own pointerdown handler). Settling the
  // dock state first, synchronously, makes the layout stable for the
  // entire scroll -- idempotent with updateGateDockState()'s own dock
  // handling once the real scroll event fires (gateDockedLast is already
  // true, so it's a no-op, no double transition).
  if (!els.gateCard.classList.contains('docked')) {
    els.gateCard.classList.add('docked');
    els.gateCard.setAttribute('aria-expanded', 'false');
    // gateSpacer's height is CSS-transitioned (.2s) for the normal scroll-
    // driven dock -- a style write alone doesn't make the LAYOUT (what
    // scrollIntoView below actually measures) reflect 0 until that
    // transition finishes animating, confirmed by sampling
    // getBoundingClientRect() every 30ms through a real dock: it stayed
    // at the full ~198px for one frame after the style write, then eased
    // down over the next ~200ms while the scroll (and the wrap's real
    // position) tracked it the whole way, landing short every time.
    // Suppress the transition for this forced, synchronous collapse only
    // (still-natural scroll-driven docks keep their eased "pull up"), and
    // force a reflow before restoring it so scrollIntoView measures the
    // real, final, already-collapsed layout.
    const prevTransition = els.gateSpacer.style.transition;
    els.gateSpacer.style.transition = 'none';
    els.gateSpacer.style.height = '0px';
    void els.gateSpacer.offsetHeight;
    els.gateSpacer.style.transition = prevTransition;
    gateDockedLast = true;
  }
  const roloIndexH = els.roloIndex.getBoundingClientRect().height;
  wrap.style.scrollMarginTop = (GATE_DOCKED_H + roloIndexH) + 'px';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function goRolo(i: number): void {
  const count = els.roloStage.querySelectorAll('.rolo-card').length;
  if (!count) return;
  roloCurrent = Math.max(0, Math.min(count - 1, i));
  positionRoloStack();
  scrollToActiveCard();
  const watchlist = cb.getWatchlist();
  const sym = watchlist[roloCurrent];
  if (sym) cb.onActivate(sym, roloCurrent);
}

export function clampRoloCurrent(): void {
  const watchlist = cb.getWatchlist();
  roloCurrent = Math.min(roloCurrent, Math.max(0, watchlist.length - 1));
}

// ── Swipe-to-delete on the active card only ─────────────────────────────
// Same visual/threshold pattern as production's real card-list swipe
// (shared/watchlist.ts's gesture handlers), re-bound to whichever single
// .rolo-card is currently active instead of a list row, since the
// Rolodex stage has no per-row list to attach the old gesture to.
interface SwipeState {
  pointerId: number;
  card: HTMLElement;
  startX: number;
  startY: number;
  mode: 'swipe' | null;
  pendingDx: number;
}
let roloSwipe: SwipeState | null = null;

function roloDeleteThreshold(card: HTMLElement): number {
  return Math.min(120, card.getBoundingClientRect().width * 0.35);
}

function ensureRoloSwipeBg(): HTMLElement {
  let bg = els.roloStage.querySelector<HTMLElement>('.rolo-swipe-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'rolo-swipe-bg';
    bg.innerHTML = '<span class="swipe-icon">🗑</span><span class="swipe-label">DELETE</span>';
    els.roloStage.insertBefore(bg, els.roloStage.firstChild);
  }
  return bg;
}

function onRoloPointerDown(e: PointerEvent): void {
  if (roloSwipe) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>('.rolo-card');
  if (!card) return;
  const cards = Array.from(els.roloStage.querySelectorAll('.rolo-card'));
  if (cards.indexOf(card) !== roloCurrent) return;
  roloSwipe = { pointerId: e.pointerId, card, startX: e.clientX, startY: e.clientY, mode: null, pendingDx: 0 };
}

function onRoloPointerMove(e: PointerEvent): void {
  const g = roloSwipe; if (!g || e.pointerId !== g.pointerId) return;
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (g.mode === null) {
    if (Math.abs(dx) > ROLO_SWIPE_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.mode = 'swipe';
      try { g.card.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      g.card.style.transition = 'none';
    } else if (Math.abs(dy) > ROLO_SWIPE_MOVE_THRESHOLD) {
      endRoloSwipe();
      return;
    } else return;
  }
  if (g.mode === 'swipe') {
    e.preventDefault();
    const clamped = Math.min(0, Math.max(dx, -g.card.getBoundingClientRect().width));
    g.card.style.transform = 'translateY(0) scale(1) translateX(' + clamped + 'px)';
    const bg = ensureRoloSwipeBg();
    const progress = Math.min(Math.abs(clamped) / roloDeleteThreshold(g.card), 1);
    bg.style.opacity = String(progress);
    g.pendingDx = clamped;
  }
}

function onRoloPointerUp(e: PointerEvent): void {
  const g = roloSwipe; if (!g || e.pointerId !== g.pointerId) return;
  if (g.mode === 'swipe') finishRoloSwipe(g);
  endRoloSwipe();
}

function finishRoloSwipe(g: SwipeState): void {
  const threshold = roloDeleteThreshold(g.card);
  const bg = ensureRoloSwipeBg();
  if (Math.abs(g.pendingDx) >= threshold) {
    const w = g.card.getBoundingClientRect().width;
    g.card.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
    g.card.style.transform = 'translateX(-' + (w + 40) + 'px)';
    g.card.style.opacity = '0';
    const sym = cb.getWatchlist()[roloCurrent];
    setTimeout(() => { bg.style.opacity = '0'; if (sym) cb.onDeleteConfirmed(sym); }, 180);
  } else {
    g.card.style.transition = 'transform .18s ease';
    g.card.style.transform = 'translateY(0) scale(1)';
    bg.style.opacity = '0';
  }
}

function endRoloSwipe(): void {
  const g = roloSwipe;
  if (g) { try { g.card.releasePointerCapture(g.pointerId); } catch (err) { /* noop */ } }
  roloSwipe = null;
}

// ── Ticker pill strip auto-scroll marquee ──────────────────────────────
let roloMarqueeOneSetW = 0;
let roloMarqueePos = 0;
let roloMarqueeDataReady = false;
let roloMarqueePaused = false;
let roloMarqueeResumeTimer: ReturnType<typeof setTimeout> | null = null;
let roloItemsPerPass = 1;

function scheduleRoloMarqueeResume(): void {
  if (roloMarqueeResumeTimer) clearTimeout(roloMarqueeResumeTimer);
  roloMarqueeResumeTimer = setTimeout(() => {
    roloMarqueePos = els.roloIndex.scrollLeft;
    roloMarqueePaused = false;
  }, ROLO_MARQUEE_RESUME_MS);
}

function pauseRoloMarquee(): void {
  roloMarqueePaused = true;
  scheduleRoloMarqueeResume();
}

export function sizeRoloMarquee(): void {
  const itemsPerPass = roloItemsPerPass;
  if (els.roloIndex.children.length >= itemsPerPass * 2) {
    const firstPassStart = els.roloIndex.children[0].getBoundingClientRect().left;
    const secondPassStart = els.roloIndex.children[itemsPerPass].getBoundingClientRect().left;
    roloMarqueeOneSetW = secondPassStart - firstPassStart;
  } else {
    roloMarqueeOneSetW = els.roloIndex.scrollWidth / 2;
  }
}

function stepRoloMarquee(): void {
  if (!roloMarqueePaused && roloMarqueeDataReady && roloMarqueeOneSetW > 0) {
    roloMarqueePos += ROLO_MARQUEE_SPEED;
    if (roloMarqueePos >= roloMarqueeOneSetW) { roloMarqueePos -= roloMarqueeOneSetW; }
    els.roloIndex.scrollLeft = Math.round(roloMarqueePos);
  }
  requestAnimationFrame(stepRoloMarquee);
}

// Rebuilds the pill strip from the current watchlist -- caller supplies a
// chip factory (tier-owned pill content/styling) and a divider label
// (tier-owned "— N —" text). Handles the duplicate-pass-for-wraparound
// loop, the click->goRolo wiring, and the native-focus-scroll suppression
// on each chip, all of which are pure mechanics independent of what a
// chip actually looks like.
//
// buildExtraChip is optional and, when supplied, appends ONE additional
// non-ticker element into every repeated pass (after the watchlist's real
// chips, before the divider) -- e.g. Free's "Starter?" upsell pill (Aug
// 16, 2026). It's deliberately NOT routed through goRolo/the active-card
// index at all (the caller wires its own href/click behavior on the
// element it returns) and doesn't affect the watchlist or its tickers in
// any way -- purely a repeating, marquee-visible promotional pill. Still
// mechanics-owned (repeating it correctly across passes, keeping the
// wrap-boundary math correct) even though its content is tier-specific.
export function rebuildRoloIndex(
  watchlist: string[],
  buildChip: (sym: string, idx: number) => HTMLButtonElement,
  dividerText: string,
  buildExtraChip?: () => HTMLElement,
): void {
  els.roloIndex.innerHTML = '';
  roloMarqueePos = 0;
  roloMarqueeDataReady = false;
  roloItemsPerPass = watchlist.length + (buildExtraChip ? 1 : 0) + 1;

  function appendChipPass(): HTMLElement {
    watchlist.forEach((sym, i) => {
      const chip = buildChip(sym, i);
      chip.addEventListener('click', () => goRolo(i));
      chip.addEventListener('pointerdown', (e) => e.preventDefault());
      els.roloIndex.appendChild(chip);
    });
    if (buildExtraChip) {
      const extra = buildExtraChip();
      extra.addEventListener('pointerdown', (e) => e.preventDefault());
      els.roloIndex.appendChild(extra);
    }
    const divider = document.createElement('span');
    divider.className = 'rolo-divider';
    divider.textContent = dividerText;
    els.roloIndex.appendChild(divider);
    return divider;
  }

  const firstDivider = appendChipPass();
  const oneSetW = firstDivider.offsetLeft + firstDivider.offsetWidth;
  for (let guard = 0; guard < 20 && (els.roloIndex.scrollWidth - els.roloIndex.clientWidth) < oneSetW; guard++) {
    appendChipPass();
  }
}

export function markRoloMarqueeDataReady(): void {
  roloMarqueeDataReady = true;
}

// ── Init ─────────────────────────────────────────────────────────────
export function initRolodex(elements: RolodexElements, callbacks: RolodexCallbacks): void {
  els = elements;
  cb = callbacks;
  GATE_DOCKED_H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gate-docked-h')) || 44;
  // Dock threshold is a fixed constant (.content's own top padding) derived
  // algebraically from gateSpacer always being sized to exactly
  // (overlayHeight - GATE_DOCKED_H). Not re-measured live, which is what
  // makes undock work correctly once gateSpacer starts collapsing to 0.
  const contentEl = document.querySelector('.content');
  dockThreshold = contentEl ? parseFloat(getComputedStyle(contentEl).paddingTop) || 0 : 0;

  window.addEventListener('resize', sizeGateMarquee);
  window.addEventListener('resize', sizeGateSpacer);
  window.addEventListener('resize', sizeRoloMarquee);

  let gateTickingLocal = false;
  els.scroller.addEventListener('scroll', () => {
    if (gateTickingLocal) return;
    gateTickingLocal = true;
    requestAnimationFrame(() => {
      updateGateDockState();
      gateTickingLocal = false;
    });
  }, { passive: true });

  els.gateCard.addEventListener('click', () => { if (els.gateCard.classList.contains('docked')) jumpToTop(); });
  els.gateCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (els.gateCard.classList.contains('docked')) jumpToTop(); }
  });

  els.roloStage.addEventListener('pointerdown', onRoloPointerDown);
  document.addEventListener('pointermove', onRoloPointerMove, { passive: false });
  document.addEventListener('pointerup', onRoloPointerUp);
  document.addEventListener('pointercancel', onRoloPointerUp);

  els.roloIndex.addEventListener('pointerdown', pauseRoloMarquee);
  els.roloIndex.addEventListener('pointerup', scheduleRoloMarqueeResume);
  els.roloIndex.addEventListener('pointercancel', scheduleRoloMarqueeResume);

  requestAnimationFrame(stepGateMarquee);
  requestAnimationFrame(stepRoloMarquee);
}
