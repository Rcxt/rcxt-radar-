import { createRemoteJWKSet, decodeJwt, jwtVerify } from "npm:jose@6";

const VERCEL_OWNER_ID = "team_RNYqiR2RK8ZcEMqDPZ6qX7Eq";
const VERCEL_PROJECT_ID = "prj_kC582Cr3PA2JeyYggKYrcYBp0Zn6";
const oidcJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DEFAULT_PREFS = {
  newBuy:true,
  rugRisk:true,
  highRiskBuy:true,
  hotMomentumBuy:false,
  signalChanges:true,
  allSignalChanges:false,
  scoreCrossing:false,
  marketCapCrossing:false,
  radarChanges:false,
  xMomentum:false,
  repeatBuyAlerts:false,
  cooldownMinutes:20,
};

const BOOLEAN_PREFS = [
  "newBuy","rugRisk","highRiskBuy","hotMomentumBuy","signalChanges","allSignalChanges",
  "scoreCrossing","marketCapCrossing","radarChanges","xMomentum","repeatBuyAlerts",
];

function sanitizePrefs(value:any){
  const source=value&&typeof value==="object"?value:{};
  const next={...DEFAULT_PREFS};
  for(const key of BOOLEAN_PREFS){
    if(typeof source[key]==="boolean") (next as any)[key]=source[key];
  }
  const cooldown=Number(source.cooldownMinutes);
  if(Number.isFinite(cooldown)) next.cooldownMinutes=Math.max(1,Math.min(180,Math.round(cooldown)));
  if(!next.signalChanges) next.allSignalChanges=false;
  return next;
}

function getKeys() {
  const publishableRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}";
  const secretRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "{}";
  return {
    url: Deno.env.get("SUPABASE_URL") || "",
    publishableKey: JSON.parse(publishableRaw)?.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "",
    secretKey: JSON.parse(secretRaw)?.default || Deno.env.get("SUPABASE_SECRET_KEY") || "",
  };
}

async function verifyVercelOidc(req: Request) {
  const token = req.headers.get("x-rcxt-vercel-oidc") || "";
  if (!token) return false;
  try {
    const unverified = decodeJwt(token);
    const issuer = String(unverified.iss || "");
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:" || issuerUrl.hostname !== "oidc.vercel.com") return false;
    let jwks = oidcJwks.get(issuer);
    if (!jwks) {
      const jwksUrl = new URL(issuer.endsWith("/") ? ".well-known/jwks" : issuer + "/.well-known/jwks");
      jwks = createRemoteJWKSet(jwksUrl);
      oidcJwks.set(issuer, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, { issuer });
    return payload.owner_id === VERCEL_OWNER_ID &&
      payload.project_id === VERCEL_PROJECT_ID &&
      payload.environment === "production";
  } catch {
    return false;
  }
}

function headers(secretKey: string, extra: Record<string,string> = {}) {
  return {
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function getSecrets(url: string, secretKey: string) {
  const response = await fetch(`${url}/rest/v1/rpc/rcxt_monitor_secrets`, {
    method: "POST",
    headers: headers(secretKey),
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Monitor secret lookup failed");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || {} : rows || {};
}

async function getStatus(url: string, secretKey: string, wallet: string) {
  const [monitorResponse, subsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/monitor_wallets?wallet=eq.${encodeURIComponent(wallet)}&select=wallet,enabled,preferences,last_checked_at,last_event_at,last_error,updated_at&limit=1`, {
      headers: headers(secretKey),
      signal: AbortSignal.timeout(8000),
    }),
    fetch(`${url}/rest/v1/push_subscriptions?wallet=eq.${encodeURIComponent(wallet)}&enabled=eq.true&select=id,updated_at`, {
      headers: headers(secretKey),
      signal: AbortSignal.timeout(8000),
    }),
  ]);
  const monitorRows = monitorResponse.ok ? await monitorResponse.json() : [];
  const subs = subsResponse.ok ? await subsResponse.json() : [];
  return {
    monitor: monitorRows?.[0] || null,
    subscriptionCount: Array.isArray(subs) ? subs.length : 0,
  };
}

async function upsertMonitor(url: string, secretKey: string, wallet: string, enabled: boolean, preferences?:any) {
  const row:any={ wallet, enabled, updated_at:new Date().toISOString(), last_error:null };
  if(preferences) row.preferences=sanitizePrefs(preferences);
  const response = await fetch(`${url}/rest/v1/monitor_wallets?on_conflict=wallet`, {
    method: "POST",
    headers: headers(secretKey, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([row]),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Could not update monitor state");
  const rows = await response.json();
  return rows?.[0] || null;
}

async function upsertSubscription(url: string, secretKey: string, wallet: string, subscription: any) {
  const endpoint = String(subscription?.endpoint || "").slice(0, 2000);
  const p256dh = String(subscription?.keys?.p256dh || "").slice(0, 512);
  const auth = String(subscription?.keys?.auth || "").slice(0, 512);
  if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new Error("Invalid push subscription");

  const response = await fetch(`${url}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: "POST",
    headers: headers(secretKey, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{
      wallet,
      endpoint,
      p256dh,
      auth,
      enabled: true,
      updated_at: new Date().toISOString(),
      last_error: null,
    }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Could not save push subscription");
  const rows = await response.json();
  return rows?.[0] || null;
}

async function disableSubscription(url: string, secretKey: string, wallet: string, endpoint: string) {
  if (!endpoint) return;
  const response=await fetch(
    `${url}/rest/v1/push_subscriptions?wallet=eq.${encodeURIComponent(wallet)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    {
      method: "PATCH",
      headers: headers(secretKey, { prefer: "return=minimal" }),
      body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    }
  );
  if(!response.ok) throw new Error("Could not disable push subscription");
}

function responseShape(wallet:string,status:any,secrets:any=null){
  return {
    success:true,
    wallet,
    enabled:Boolean(status.monitor?.enabled),
    subscriptionCount:status.subscriptionCount,
    preferencesStored:Boolean(status.monitor?.preferences),
    preferences:sanitizePrefs(status.monitor?.preferences),
    lastCheckedAt:status.monitor?.last_checked_at || null,
    lastEventAt:status.monitor?.last_event_at || null,
    lastError:status.monitor?.last_error || null,
    ...(secrets?{vapidPublicKey:secrets?.vapid_public || null}:{}),
    mode:"server-background-monitor",
  };
}

export default {
  async fetch(req: Request) {
    const keys = getKeys();
    if (!keys.url || !keys.secretKey) return Response.json({ success:false, error:"Server configuration missing" }, { status:500 });
    if (!(await verifyVercelOidc(req))) return Response.json({ success:false, error:"Invalid Vercel service identity" }, { status:401 });

    const url = new URL(req.url);
    if (req.method === "GET") {
      const wallet = String(url.searchParams.get("wallet") || "").trim();
      if (!addressPattern.test(wallet)) return Response.json({ success:false, error:"Invalid wallet address" }, { status:400 });
      try {
        const [status, secrets] = await Promise.all([
          getStatus(keys.url, keys.secretKey, wallet),
          getSecrets(keys.url, keys.secretKey),
        ]);
        return Response.json(responseShape(wallet,status,secrets));
      } catch (error) {
        return Response.json({ success:false, error:String((error as Error)?.message || error).slice(0,300) }, { status:500 });
      }
    }

    if (req.method !== "POST") return Response.json({ success:false, error:"Method not allowed" }, { status:405 });
    let body:any;
    try { body = await req.json(); } catch { return Response.json({ success:false, error:"Invalid JSON" }, { status:400 }); }

    const wallet = String(body?.wallet || "").trim();
    if (!addressPattern.test(wallet)) return Response.json({ success:false, error:"Invalid wallet address" }, { status:400 });
    const action = String(body?.action || "");

    try {
      if (action === "enable") {
        const status=await getStatus(keys.url,keys.secretKey,wallet);
        await upsertMonitor(keys.url, keys.secretKey, wallet, true, body?.preferences || status.monitor?.preferences);
      } else if (action === "disable") {
        const status=await getStatus(keys.url,keys.secretKey,wallet);
        await upsertMonitor(keys.url, keys.secretKey, wallet, false, body?.preferences || status.monitor?.preferences);
      } else if (action === "preferences") {
        const status=await getStatus(keys.url,keys.secretKey,wallet);
        await upsertMonitor(
          keys.url,
          keys.secretKey,
          wallet,
          Boolean(status.monitor?.enabled),
          body?.preferences,
        );
      } else if (action === "subscribe") {
        await upsertSubscription(keys.url, keys.secretKey, wallet, body?.subscription);
      } else if (action === "unsubscribe") {
        await disableSubscription(keys.url, keys.secretKey, wallet, String(body?.endpoint || ""));
      } else {
        return Response.json({ success:false, error:"Unknown action" }, { status:400 });
      }

      const status = await getStatus(keys.url, keys.secretKey, wallet);
      return Response.json(responseShape(wallet,status));
    } catch (error) {
      return Response.json({ success:false, error:String((error as Error)?.message || error).slice(0,300) }, { status:500 });
    }
  },
};
