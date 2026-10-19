// Gate 3 Day read push (Oct 19, 2026, Pro beta) -- Supabase Realtime.
//
// When ANALYZE is tapped before the 3rd 15-min bar closes, the server
// (Tra, resolveDayJob) computes the Day verdict once the bars are in and
// broadcasts it to a private topic, day:<auth uid>. The realtime.messages
// RLS policy (supabase-ddl-patch27) lets a signed-in user receive only
// their own topic. Bundler-only module (Pro), no ?v= consumer.
//
// Best-effort: the card also asks GET /day/:ticker when readyAt passes, so
// a dropped socket never loses the read.
import { RealtimeClient, RealtimeChannel } from '@supabase/realtime-js';

const SUPABASE_URL = 'https://oinomcikdyisrbfeeirp.supabase.co';
// Public anon key (same one every tier's page source already carries).
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pbm9tY2lrZHlpc3JiZmVlaXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzM3NzgsImV4cCI6MjEwMDI0OTc3OH0.PiMDYsSZjNd4Iw-0wbQH4niDvUmW8ymycmiyb5Raf1w';

let client: RealtimeClient | null = null;
let channel: RealtimeChannel | null = null;
let channelUid = '';

function jwtSub(token: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).sub || '';
  } catch { return ''; }
}

// Safe to call before every ANALYZE: it only re-auths an existing socket.
export function watchDayReads(token: string | null | undefined, onDay: (payload: any) => void): void {
  if (!token) return;
  const uid = jwtSub(token);
  if (!uid) return;
  try {
    if (!client) client = new RealtimeClient(SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1', { params: { apikey: SUPABASE_ANON } });
    client.setAuth(token);
    if (channel && channelUid === uid) return;
    if (channel) client.removeChannel(channel);
    channelUid = uid;
    channel = client.channel('day:' + uid, { config: { private: true } });
    channel.on('broadcast', { event: 'day' }, (msg: any) => { try { onDay(msg && msg.payload); } catch (e) { /* card re-render errors stay local */ } });
    channel.subscribe();
  } catch (e) {
    console.warn('day-realtime:', (e as Error).message);
  }
}
