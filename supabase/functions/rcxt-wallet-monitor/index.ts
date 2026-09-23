import webpush from "npm:web-push@3.6.7";

const DEFAULT_PREFS={
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

function sanitizePrefs(value:any){
  const source=value&&typeof value==="object"?value:{};
  const next={...DEFAULT_PREFS};
  for(const key of Object.keys(DEFAULT_PREFS)){
    if(key==="cooldownMinutes") continue;
    if(typeof source[key]==="boolean") (next as any)[key]=source[key];
  }
  const cooldown=Number(source.cooldownMinutes);
  if(Number.isFinite(cooldown)) next.cooldownMinutes=Math.max(1,Math.min(180,Math.round(cooldown)));
  if(!next.signalChanges) next.allSignalChanges=false;
  return next;
}

function getKeys() {
  const secretRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "{}";
  return {
    url: Deno.env.get("SUPABASE_URL") || "",
    secretKey: JSON.parse(secretRaw)?.default || Deno.env.get("SUPABASE_SECRET_KEY") || "",
  };
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
    method:"POST",
    headers:headers(secretKey),
    body:"{}",
  });
  if(!response.ok) throw new Error("Secret lookup failed");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || {} : rows || {};
}

async function restJson(url: string, secretKey: string, path: string) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers:headers(secretKey) });
  if(!response.ok) throw new Error(`Database query failed (${response.status})`);
  return response.json();
}

async function patchRow(url: string, secretKey: string, path: string, body: unknown) {
  const clean=Object.fromEntries(Object.entries(body as Record<string,unknown>).filter(([,value])=>value!==undefined));
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method:"PATCH",
    headers:headers(secretKey,{prefer:"return=minimal"}),
    body:JSON.stringify(clean),
  });
  if(!response.ok) throw new Error(`Database update failed (${response.status})`);
}

async function insertEvent(url: string, secretKey: string, row: Record<string,unknown>) {
  const response = await fetch(`${url}/rest/v1/monitor_events?on_conflict=wallet,signature,event_type`, {
    method:"POST",
    headers:headers(secretKey,{prefer:"resolution=ignore-duplicates,return=minimal"}),
    body:JSON.stringify([row]),
  });
  if(!response.ok) throw new Error(`Event insert failed (${response.status})`);
}

async function fetchJson(url: string, timeout = 12000) {
  const response = await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(timeout)});
  let body:any=null;
  try{body=await response.json()}catch{}
  if(!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

function recentEnough(value: unknown, minutes = 5) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) && time > 0 && Date.now() - time <= minutes * 60_000;
}

function hardRiskFlags(scan:any) {
  const flags = Array.isArray(scan?.intelligence?.riskFlags) ? scan.intelligence.riskFlags : [];
  return flags.filter((flag:string)=>[
    "MINT_AUTHORITY_ACTIVE",
    "FREEZE_AUTHORITY_ACTIVE",
    "EXTREME_OWNER_CONCENTRATION",
    "EXTREME_ACCOUNT_CONCENTRATION",
  ].includes(flag));
}

function friendlyFlag(flag:string){
  return String(flag||"").replaceAll("_"," ").toLowerCase();
}

function compactMc(value:unknown){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) return "";
  if(n>=1000000) return "$"+(n/1000000).toFixed(n>=10000000?1:2)+"M";
  if(n>=1000) return "$"+(n/1000).toFixed(n>=100000?0:1)+"K";
  return "$"+Math.round(n);
}

function categoryFor(scanData:any,hardFlags:string[],hotButRisky:boolean,prefs:any){
  if(hardFlags.length) return "rugRisk";
  const risk=String(scanData?.intelligence?.risk||"");
  const highRisk=risk==="HIGH"||risk==="EXTREME";

  // Safety wins over optional momentum chatter. In KEY mode a hot/high-risk
  // token must still produce the enabled high-risk alert instead of being
  // silently routed into the disabled hotMomentumBuy category.
  if(highRisk && prefs?.highRiskBuy) return "highRiskBuy";
  if(hotButRisky && prefs?.hotMomentumBuy) return "hotMomentumBuy";
  if(highRisk) return "highRiskBuy";
  return "newBuy";
}

async function recentCategoryPush(
  dbUrl:string,
  secretKey:string,
  wallet:string,
  mint:string,
  category:string,
  cooldownMinutes:number,
){
  const rows=await restJson(
    dbUrl,
    secretKey,
    `monitor_events?wallet=eq.${encodeURIComponent(wallet)}&token_address=eq.${encodeURIComponent(mint)}&push_sent_at=not.is.null&select=push_sent_at,payload&order=push_sent_at.desc&limit=12`
  );
  const cutoff=Date.now()-cooldownMinutes*60_000;
  return (rows||[]).some((row:any)=>{
    const time=new Date(row?.push_sent_at||0).getTime();
    const previousCategory=String(row?.payload?.notificationCategory||"");
    return Number.isFinite(time)&&time>=cutoff&&previousCategory===category;
  });
}

async function sendPushes(url:string, secretKey:string, secrets:any, wallet:string, payload:any) {
  const subscriptions = await restJson(
    url,
    secretKey,
    `push_subscriptions?wallet=eq.${encodeURIComponent(wallet)}&enabled=eq.true&select=id,endpoint,p256dh,auth`
  );
  if(!Array.isArray(subscriptions) || !subscriptions.length) return {sent:0,failed:0};

  webpush.setVapidDetails(
    "mailto:alerts@rcxt.app",
    String(secrets.vapid_public || ""),
    String(secrets.vapid_private || "")
  );

  let sent=0;
  let failed=0;
  for(const sub of subscriptions){
    try{
      await webpush.sendNotification(
        {
          endpoint:sub.endpoint,
          keys:{p256dh:sub.p256dh,auth:sub.auth},
        },
        JSON.stringify(payload),
        {TTL:120,urgency:payload?.critical?"high":"normal"}
      );
      sent++;
      await patchRow(url,secretKey,`push_subscriptions?id=eq.${sub.id}`,{
        last_success_at:new Date().toISOString(),
        last_error:null,
        updated_at:new Date().toISOString(),
      });
    }catch(error:any){
      failed++;
      const status=Number(error?.statusCode||0);
      await patchRow(url,secretKey,`push_subscriptions?id=eq.${sub.id}`,{
        enabled:status===404||status===410?false:true,
        last_error:String(error?.message||"Push failed").slice(0,300),
        updated_at:new Date().toISOString(),
      }).catch(()=>{});
    }
  }
  return {sent,failed};
}

async function processWallet(dbUrl:string, secretKey:string, secrets:any, wallet:string, rawPrefs:any) {
  const prefs=sanitizePrefs(rawPrefs);
  const activity = await fetchJson(
    `https://rcxt-radar.vercel.app/api/activity?address=${encodeURIComponent(wallet)}&limit=15`
  );
  const buys = (Array.isArray(activity?.newBuys)?activity.newBuys:[])
    .filter((buy:any)=>buy?.signature && buy?.token?.address && recentEnough(buy.blockTime,5))
    .slice(0,6);

  let processed=0;
  let pushed=0;
  let suppressed=0;

  for(const buy of buys){
    const signature=String(buy.signature);
    const existing=await restJson(
      dbUrl,
      secretKey,
      `monitor_events?wallet=eq.${encodeURIComponent(wallet)}&signature=eq.${encodeURIComponent(signature)}&event_type=eq.BUY&select=id&limit=1`
    );
    if(Array.isArray(existing)&&existing.length) continue;

    const mint=String(buy.token.address);
    let scanData:any=null;
    try{
      const result=await fetchJson(
        `https://rcxt-radar.vercel.app/api/scan?address=${encodeURIComponent(mint)}&persist=1`,
        15000
      );
      scanData=result?.scan||null;
    }catch{}

    const intel=scanData?.intelligence||{};
    const symbol=scanData?.token?.symbol||buy?.token?.symbol||mint.slice(0,6);
    const hardFlags=hardRiskFlags(scanData);
    const setup=Number((intel?.opportunityScore ?? intel?.setupScore) || 0);
    const risk=String(intel?.risk||"UNKNOWN");
    const signal=String(intel?.signal||"SCAN PENDING");
    const score=Number.isFinite(Number(intel?.score))?Number(intel.score):null;
    const mcPlan=intel?.marketCapPlan||{};
    const currentMc=Number(scanData?.market?.marketCap||mcPlan?.current||0);
    const hotButRisky=setup>=60 && (risk==="HIGH"||risk==="EXTREME") && !hardFlags.length;
    const category=categoryFor(scanData,hardFlags,hotButRisky,prefs);
    const enabled=Boolean((prefs as any)[category]);
    const recentlyPushed=!prefs.repeatBuyAlerts && await recentCategoryPush(
      dbUrl,
      secretKey,
      wallet,
      mint,
      category,
      prefs.cooldownMinutes,
    );

    let title=`RCXT BUY DETECTED: ${symbol}`;
    if(category==="rugRisk") title=`RCXT RUG RISK: ${symbol}`;
    else if(category==="hotMomentumBuy") title=`RCXT HOT / HIGH RISK: ${symbol}`;
    else if(category==="highRiskBuy") title=hotButRisky
      ? `RCXT HOT / HIGH RISK: ${symbol}`
      : `RCXT HIGH RISK BUY: ${symbol}`;

    const spent=buy?.solSpent ? `${Number(buy.solSpent).toFixed(4)} SOL · ` : "";
    const details=scanData
      ? `${score ?? "—"}/100 ${signal} · ${risk} risk · opportunity ${setup}/100`
      : "Risk scan pending; open RCXT for a manual scan";
    const flagText=hardFlags.length ? ` · ${hardFlags.slice(0,2).map(friendlyFlag).join(" · ")}` : "";
    const mcNow=compactMc(currentMc);
    const mcEntry=mcPlan?.entryLow&&mcPlan?.entryHigh
      ? `${compactMc(mcPlan.entryLow)}-${compactMc(mcPlan.entryHigh)}`
      : "";
    const mcTrim=compactMc(mcPlan?.trim1);
    const mcText=scanData
      ? (hardFlags.length
          ? (mcNow?`MC ${mcNow}`:"")
          : [
              mcNow?`MC ${mcNow}`:"",
              mcEntry?`entry ${mcEntry}`:"",
              mcTrim?`trim ${mcTrim}`:"",
            ].filter(Boolean).join(" · "))
      : "";

    let pushResult={sent:0,failed:0};
    let suppressedReason:string|null=null;
    if(!enabled){
      suppressedReason="CATEGORY_DISABLED";
      suppressed++;
    }else if(recentlyPushed){
      suppressedReason=`COOLDOWN_${prefs.cooldownMinutes}M`;
      suppressed++;
    }else{
      pushResult=await sendPushes(dbUrl,secretKey,secrets,wallet,{
        title,
        body:`${spent}${details}${flagText}${mcText?" · "+mcText:""}`,
        url:`/?token=${encodeURIComponent(mint)}`,
        tag:`wallet-${mint}-${category}`,
        token:mint,
        wallet,
        signal,
        risk,
        score,
        category,
        critical:category==="rugRisk",
        renotify:category==="rugRisk",
      });
      pushed+=pushResult.sent;
    }
    processed++;

    await insertEvent(dbUrl,secretKey,{
      wallet,
      signature,
      token_address:mint,
      event_type:"BUY",
      score,
      signal:scanData?signal:null,
      risk:scanData?risk:null,
      risk_flags:scanData?.intelligence?.riskFlags||[],
      payload:{
        symbol,
        solSpent:buy?.solSpent||null,
        setupScore:scanData?.intelligence?.setupScore??null,
        opportunityScore:scanData?.intelligence?.opportunityScore??null,
        executionScore:scanData?.intelligence?.executionScore??null,
        safetyScore:scanData?.intelligence?.safetyScore??null,
        hardRiskFlags:hardFlags,
        hotButRisky,
        marketCap:currentMc||null,
        marketCapPlan:mcPlan?.available?mcPlan:null,
        notificationCategory:category,
        notificationEnabled:enabled,
        suppressedReason,
        cooldownMinutes:prefs.cooldownMinutes,
      },
      push_sent_at:pushResult.sent>0?new Date().toISOString():null,
    });
  }

  await patchRow(dbUrl,secretKey,`monitor_wallets?wallet=eq.${encodeURIComponent(wallet)}`,{
    last_checked_at:new Date().toISOString(),
    last_event_at:processed?new Date().toISOString():undefined,
    last_error:null,
    updated_at:new Date().toISOString(),
  });

  return {processed,pushed,suppressed};
}

export default {
  async fetch(req:Request){
    const keys=getKeys();
    if(!keys.url||!keys.secretKey) return Response.json({success:false,error:"Server configuration missing"},{status:500});

    let secrets:any;
    try{secrets=await getSecrets(keys.url,keys.secretKey)}
    catch{return Response.json({success:false,error:"Monitor secrets unavailable"},{status:500})}

    const supplied=req.headers.get("x-rcxt-monitor-token")||"";
    if(!secrets?.cron_token || supplied!==secrets.cron_token){
      return Response.json({success:false,error:"Unauthorized"},{status:401});
    }

    const monitors=await restJson(
      keys.url,
      keys.secretKey,
      "monitor_wallets?enabled=eq.true&select=wallet,preferences&limit=25"
    );

    let wallets=0,events=0,pushes=0,suppressed=0,errors=0;
    for(const row of monitors||[]){
      const wallet=String(row?.wallet||"");
      if(!wallet) continue;
      wallets++;
      try{
        const result=await processWallet(keys.url,keys.secretKey,secrets,wallet,row?.preferences);
        events+=result.processed;
        pushes+=result.pushed;
        suppressed+=result.suppressed;
      }catch(error:any){
        errors++;
        await patchRow(keys.url,keys.secretKey,`monitor_wallets?wallet=eq.${encodeURIComponent(wallet)}`,{
          last_checked_at:new Date().toISOString(),
          last_error:String(error?.message||"Monitor failed").slice(0,300),
          updated_at:new Date().toISOString(),
        }).catch(()=>{});
      }
    }

    return Response.json({
      success:true,
      wallets,
      events,
      pushes,
      suppressed,
      errors,
      checkedAt:new Date().toISOString(),
    });
  }
};
