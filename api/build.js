export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})
  res.setHeader('Cache-Control','no-store')
  return res.status(200).json({
    success:true,
    app:'RCXT Radar',
    version:'4.0.0',
    scoreEngine:'4.1.0',
    trenchEngine:'1.0.0',
    chartEngine:'1.0.0',
    forecastEngine:'1.0.0',
    tradeTapeEngine:'1.2.0',
    supplyWhaleEngine:'1.0.0',
    calibrationEngine:'2.0.0',
    challengeEngine:'1.1.0',
    walletActivityEngine:'1.0.0',
    persistence:'supabase-oidc-v16',
    gitSha:process.env.VERCEL_GIT_COMMIT_SHA||null,
    gitRef:process.env.VERCEL_GIT_COMMIT_REF||null,
    environment:process.env.VERCEL_ENV||null,
    region:process.env.VERCEL_REGION||null,
    deploymentUrl:process.env.VERCEL_URL||null,
    checkedAt:new Date().toISOString(),
  })
}
