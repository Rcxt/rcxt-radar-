import { createRemoteJWKSet, decodeJwt, jwtVerify } from "npm:jose@6";

const VERCEL_OWNER_ID = "team_RNYqiR2RK8ZcEMqDPZ6qX7Eq";
const VERCEL_PROJECT_ID = "prj_kC582Cr3PA2JeyYggKYrcYBp0Zn6";
const oidcJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

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
      const jwksUrl = new URL(
        issuer.endsWith("/") ? ".well-known/jwks" : issuer + "/.well-known/jwks"
      );
      jwks = createRemoteJWKSet(jwksUrl);
      oidcJwks.set(issuer, jwks);
    }

    const { payload } = await jwtVerify(token, jwks, { issuer });
    return (
      payload.owner_id === VERCEL_OWNER_ID &&
      payload.project_id === VERCEL_PROJECT_ID &&
      payload.environment === "production"
    );
  } catch {
    return false;
  }
}

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const chainPattern = /^[a-z0-9_-]{2,32}$/;

function validTokenAddress(value: string) {
  return addressPattern.test(value) || evmAddressPattern.test(value);
}

function cleanChain(value: unknown, fallback = "solana") {
  const chain = String(value ?? fallback).trim().toLowerCase();
  return chainPattern.test(chain) ? chain : fallback;
}

function short(value: unknown, max = 120) {
  return String(value ?? "").slice(0, max);
}

function clamp(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
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

function authorized(req: Request, publishableKey: string) {
  return Boolean(publishableKey) && (req.headers.get("apikey") || "") === publishableKey;
}

async function insertRow(url: string, secretKey: string, table: string, row: Record<string, unknown>) {
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { "content-type":"application/json", apikey:secretKey, authorization:`Bearer ${secretKey}`, prefer:"return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Database insert failed (${response.status})`);
  }
}

async function calibratePrevious(url: string, secretKey: string, address: string, chainId: string, currentPrice: number) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return { labeled: 0 };

  const now = Date.now();
  const params = new URLSearchParams({
    token_address: `eq.${address}`,
    chain_id: `eq.${chainId}`,
    select: "id,price_usd,signal,created_at",
    created_at: `gte.${new Date(now - 30 * 3_600_000).toISOString()}`,
    order: "created_at.desc",
    limit: "100",
  });

  const response = await fetch(`${url}/rest/v1/token_scans?${params}`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) return { labeled: 0 };

  const scans = await response.json();
  const windows = [
    { horizon: "1h", target: 60, min: 50, max: 90 },
    { horizon: "6h", target: 360, min: 330, max: 450 },
    { horizon: "24h", target: 1440, min: 1320, max: 1620 },
  ];

  const rows: any[] = [];
  for (const scan of scans || []) {
    const basePrice = Number(scan?.price_usd || 0);
    const createdAt = new Date(scan?.created_at || 0).getTime();
    if (!basePrice || !createdAt) continue;

    const ageMinutes = (now - createdAt) / 60_000;
    for (const window of windows) {
      if (ageMinutes < window.min || ageMinutes > window.max) continue;

      const returnPct = ((currentPrice / basePrice) - 1) * 100;
      const signal = String(scan?.signal || "");
      const favorable =
        signal === "BUY SETUP" || signal === "LEAN BUY"
          ? returnPct > 0
          : signal === "REDUCE" || signal === "SELL / AVOID"
            ? returnPct < 0
            : null;

      rows.push({
        scan_id: scan.id,
        horizon: window.horizon,
        observed_at: new Date().toISOString(),
        observed_price_usd: currentPrice,
        return_pct: Number(returnPct.toFixed(6)),
        favorable,
        delay_minutes: Number((ageMinutes - window.target).toFixed(2)),
        source: "rcxt-calibration",
      });
    }
  }

  if (!rows.length) return { labeled: 0 };

  const write = await fetch(`${url}/rest/v1/score_outcomes?on_conflict=scan_id,horizon`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  return { labeled: write.ok ? rows.length : 0 };
}

async function fetchCalibrationView(url: string, secretKey: string, view: string, order: string) {
  const response = await fetch(
    `${url}/rest/v1/${view}?select=*&order=${encodeURIComponent(order)}`,
    { headers: { apikey: secretKey } },
  );
  if (!response.ok) throw new Error(`${view} query failed (${response.status})`);
  return response.json();
}

async function calibrationSummary(url: string, secretKey: string) {
  const [summary,buckets,components,chainSummary,chainBuckets,rawSummary,rawBuckets,rawComponents] = await Promise.all([
    fetchCalibrationView(url,secretKey,"score_calibration_clean_summary","score_version.desc,horizon.asc,signal.asc"),
    fetchCalibrationView(url,secretKey,"score_calibration_clean_buckets","score_version.desc,score_bucket_min.desc,horizon.asc"),
    fetchCalibrationView(url,secretKey,"score_component_outcomes_clean","score_version.desc,horizon.asc"),
    fetchCalibrationView(url,secretKey,"score_calibration_chain_summary","score_version.desc,chain_family.asc,horizon.asc,signal.asc"),
    fetchCalibrationView(url,secretKey,"score_calibration_chain_buckets","score_version.desc,chain_family.asc,score_bucket_min.desc,horizon.asc"),
    fetchCalibrationView(url,secretKey,"score_calibration_summary","score_version.desc,horizon.asc,signal.asc"),
    fetchCalibrationView(url,secretKey,"score_calibration_buckets","score_version.desc,score_bucket_min.desc,horizon.asc"),
    fetchCalibrationView(url,secretKey,"score_component_outcomes","score_version.desc,horizon.asc"),
  ]);
  return {summary,buckets,components,chainSummary,chainBuckets,rawSummary,rawBuckets,rawComponents};
}

async function walletHistory(url: string, secretKey: string, address: string, limit = 100) {
  const params = new URLSearchParams({
    wallet_address: `eq.${address}`,
    select: "sol_balance,token_count,token_value_usd,sol_price_usd,sol_value_usd,total_value_usd,created_at",
    order: "created_at.asc",
    limit: String(Math.min(250, Math.max(1, limit))),
  });
  const response = await fetch(`${url}/rest/v1/wallet_snapshots?${params}`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error(`Wallet history query failed (${response.status})`);
  return response.json();
}

async function tokenHistory(url: string, secretKey: string, address: string, chainId: string, limit = 20) {
  const params = new URLSearchParams({
    token_address: `eq.${address}`,
    chain_id: `eq.${chainId}`,
    select: "chain_id,chain_family,score,score_version,signal,risk,confidence,setup_score,execution_score,safety_score,data_quality_score,market_state,risk_flag_count,price_usd,market_cap,liquidity_usd,volume_24h,created_at",
    order: "created_at.desc",
    limit: String(Math.min(50, Math.max(1, limit))),
  });
  const response = await fetch(`${url}/rest/v1/token_scans?${params}`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error(`History query failed (${response.status})`);
  return response.json();
}

export default {
  async fetch(req: Request) {
    let keys;
    try { keys = getKeys(); }
    catch { return Response.json({ok:false,error:"Function key configuration invalid"},{status:500}); }

    if (!authorized(req, keys.publishableKey)) {
      return Response.json({ok:false,error:"Unauthorized"},{status:401});
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = String(url.searchParams.get("token") || "").trim();
      const chainId = cleanChain(url.searchParams.get("chain") || "solana");
      const wallet = String(url.searchParams.get("wallet") || "").trim();
      const calibration = url.searchParams.get("calibration") === "1";

      if (calibration) {
        if (!keys.url || !keys.secretKey) return Response.json({ok:false,error:"Server configuration missing"},{status:500});
        try {
          const calibrationData = await calibrationSummary(keys.url, keys.secretKey);
          return Response.json({
            ok:true,
            kind:"calibration_summary",
            rows:calibrationData.summary,
            ...calibrationData,
            samplePolicy:"independent-chain-token-time-buckets-with-timing-window"
          });
        } catch (error) {
          return Response.json({ok:false,error:String((error as Error)?.message || error).slice(0,300)},{status:500});
        }
      }

      if (wallet) {
        if (!addressPattern.test(wallet)) return Response.json({ok:false,error:"Invalid wallet address"},{status:400});
        if (!keys.url || !keys.secretKey) return Response.json({ok:false,error:"Server configuration missing"},{status:500});
        try {
          const rows = await walletHistory(keys.url, keys.secretKey, wallet, Number(url.searchParams.get("limit") || 100));
          return Response.json({ok:true,kind:"wallet_history",rows});
        } catch (error) {
          return Response.json({ok:false,error:String((error as Error)?.message || error).slice(0,300)},{status:500});
        }
      }

      if (token) {
        if (!validTokenAddress(token)) return Response.json({ok:false,error:"Invalid token address"},{status:400});
        if (!keys.url || !keys.secretKey) return Response.json({ok:false,error:"Server configuration missing"},{status:500});
        try {
          const rows = await tokenHistory(keys.url, keys.secretKey, token, chainId, Number(url.searchParams.get("limit") || 20));
          return Response.json({ok:true,kind:"token_history",chain:chainId,rows});
        } catch (error) {
          return Response.json({ok:false,error:String((error as Error)?.message || error).slice(0,300)},{status:500});
        }
      }

      return Response.json({
        ok:Boolean(keys.url && keys.secretKey),
        service:"rcxt-log",
        version:19,
      },{status:keys.url && keys.secretKey ? 200 : 500});
    }

    if (req.method !== "POST") return Response.json({ok:false,error:"Method not allowed"},{status:405});
    if (!keys.url || !keys.secretKey) return Response.json({ok:false,error:"Server configuration missing"},{status:500});
    if (!(await verifyVercelOidc(req))) {
      return Response.json({ok:false,error:"Invalid Vercel service identity"},{status:401});
    }

    const length = Number(req.headers.get("content-length") || 0);
    if (length > 250_000) return Response.json({ok:false,error:"Payload too large"},{status:413});

    let body: any;
    try { body = await req.json(); }
    catch { return Response.json({ok:false,error:"Invalid JSON"},{status:400}); }

    const kind =
      body?.kind === "wallet_snapshot" ? "wallet_snapshot" :
      body?.kind === "social_scan" ? "social_scan" :
      body?.kind === "ai_analysis" ? "ai_analysis" :
      "token_scan";

    try {
      if (kind === "ai_analysis") {
        const address = String(body?.token_address || "").trim();
        if (!validTokenAddress(address)) return Response.json({ok:false,error:"Invalid token address"},{status:400});

        await insertRow(keys.url, keys.secretKey, "ai_analyses", {
          token_address: address,
          token_symbol: short(body?.token_symbol, 24) || null,
          score_version: short(body?.score_version, 24) || null,
          model: short(body?.model, 80) || "unknown",
          analysis: short(body?.analysis, 4000),
          payload: typeof body?.payload === "object" && body.payload ? body.payload : {},
          source: "rcxt-ai",
        });
        return Response.json({ok:true,kind});
      }

      if (kind === "social_scan") {
        const address = String(body?.token_address || "").trim();
        if (!validTokenAddress(address)) return Response.json({ok:false,error:"Invalid token address"},{status:400});

        await insertRow(keys.url, keys.secretKey, "social_scans", {
          token_address: address,
          token_symbol: short(body?.token_symbol, 24) || null,
          momentum_score: clamp(body?.momentum_score, 0, 100),
          quality_score: clamp(body?.quality_score, 0, 100),
          source_diversity: clamp(body?.source_diversity, 0, 10),
          mention_count: clamp(body?.mention_count, 0, 1000000),
          unique_authors: clamp(body?.unique_authors, 0, 1000000),
          engagement: clamp(body?.engagement, 0, 1e15),
          sentiment: clamp(body?.sentiment, -1, 1),
          relevance_score: clamp(body?.relevance_score, 0, 100),
          duplicate_ratio: clamp(body?.duplicate_ratio, 0, 1),
          author_concentration: clamp(body?.author_concentration, 0, 1),
          payload: typeof body?.payload === "object" && body.payload ? body.payload : {},
          source: "rcxt-social",
        });
        return Response.json({ok:true,kind});
      }

      if (kind === "wallet_snapshot") {
        const walletAddress = String(body?.wallet_address || "").trim();
        if (!addressPattern.test(walletAddress)) return Response.json({ok:false,error:"Invalid wallet address"},{status:400});

        await insertRow(keys.url, keys.secretKey, "wallet_snapshots", {
          wallet_address:walletAddress,
          sol_balance:clamp(body?.sol_balance,0,1e15),
          token_count:clamp(body?.token_count,0,1_000_000),
          token_value_usd:clamp(body?.token_value_usd,0,1e18),
          sol_price_usd:clamp(body?.sol_price_usd,0,1e12),
          sol_value_usd:clamp(body?.sol_value_usd,0,1e18),
          total_value_usd:clamp(body?.total_value_usd,0,1e18),
          payload:typeof body?.payload === "object" && body.payload ? body.payload : {},
          source:"rcxt-radar",
        });
        return Response.json({ok:true,kind});
      }

      const address = String(body?.token_address || "").trim();
      if (!validTokenAddress(address)) return Response.json({ok:false,error:"Invalid token address"},{status:400});

      const chainId = cleanChain(body?.chain_id || body?.payload?.chain?.id || "solana");
      const chainFamily = cleanChain(body?.chain_family || body?.payload?.chain?.family || (evmAddressPattern.test(address) ? "evm" : "solana"));
      const currentPrice = Number(body?.price_usd || 0);
      const calibration = await calibratePrevious(keys.url, keys.secretKey, address, chainId, currentPrice);

      await insertRow(keys.url, keys.secretKey, "token_scans", {
        token_address:address,
        chain_id:chainId,
        chain_family:chainFamily,
        token_name:short(body?.token_name,80)||null,
        token_symbol:short(body?.token_symbol,24)||null,
        score:clamp(body?.score,0,100),
        score_version:short(body?.score_version,24)||null,
        risk:short(body?.risk,32)||null,
        signal:short(body?.signal,32)||null,
        confidence:clamp(body?.confidence,0,100),
        setup_score:clamp(body?.setup_score,0,100),
        execution_score:clamp(body?.execution_score,0,100),
        safety_score:clamp(body?.safety_score,0,100),
        data_quality_score:clamp(body?.data_quality_score,0,100),
        market_state:short(body?.market_state,48)||null,
        risk_flag_count:clamp(body?.risk_flag_count,0,64),
        price_usd:clamp(body?.price_usd,0,1e15),
        market_cap:clamp(body?.market_cap,0,1e18),
        liquidity_usd:clamp(body?.liquidity_usd,0,1e18),
        volume_24h:clamp(body?.volume_24h,0,1e18),
        ai_summary:short(body?.ai_summary,1200)||null,
        payload:typeof body?.payload === "object" && body.payload ? body.payload : {},
        source:"rcxt-radar",
      });
      return Response.json({ok:true,kind,calibration});
    } catch (error) {
      return Response.json({ok:false,error:String((error as Error)?.message || error).slice(0,500)},{status:500});
    }
  },
};