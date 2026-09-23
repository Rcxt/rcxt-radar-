export function deriveScanVerdict(scan){
  const intel=scan?.intelligence||{}
  const signal=String(intel.signal||'WATCH')
  const risk=String(intel.risk||'UNKNOWN')
  const evidence=intel?.securityEvidence||{}
  const marketEvidence=evidence?.market||scan?.market?.consensus||{}
  const executionScore=Number(intel.executionScore)
  const safetyScore=Number(intel.safetyScore)
  const priceProviderCount=Number(marketEvidence?.priceProviderCount||0)
  const priceConflict=Boolean(marketEvidence?.priceConflict)
  const hardDanger=Boolean(
    evidence?.rugged ||
    Number(evidence?.dangerRiskCount||0)>0 ||
    signal==='SELL / AVOID' ||
    signal==='REDUCE' ||
    risk==='EXTREME'
  )
  const passes=Boolean(
    !hardDanger &&
    ['BUY SETUP','LEAN BUY'].includes(signal) &&
    intel.contractVerified &&
    !intel.preliminary &&
    !priceConflict &&
    Number.isFinite(executionScore) && executionScore>=55 &&
    (!Number.isFinite(safetyScore) || safetyScore>=60)
  )
  const verdict=hardDanger?'NO':passes?'YES':'WAIT'
  const negatives=Array.isArray(intel.negatives)?intel.negatives:[]
  const positives=Array.isArray(intel.positives)?intel.positives:[]
  const missing=Array.isArray(intel?.entryGate?.leanBuyMissing)?intel.entryGate.leanBuyMissing:[]
  const reason=verdict==='YES'
    ? (positives[0]||'Setup, contract and execution gates currently pass.')
    : verdict==='NO'
      ? (negatives[0]||'Current RCXT risk controls veto this setup.')
      : (missing[0]||negatives[0]||'More confirmation is needed before the setup passes RCXT gates.')

  return {
    verdict,
    tone:verdict.toLowerCase(),
    reason,
    priceProviderCount,
    priceConflict,
    executionScore:Number.isFinite(executionScore)?executionScore:null,
    checks:[
      {
        label:'Contract',
        value:intel.contractVerified?'PASS':scan?.security?.available?'REVIEW':'UNKNOWN',
        state:intel.contractVerified?'pass':'warn',
      },
      {
        label:'Price sources',
        value:priceConflict?'CONFLICT':priceProviderCount>=2?'AGREE':'PARTIAL',
        state:priceConflict?'fail':priceProviderCount>=2?'pass':'warn',
      },
      {
        label:'Execution',
        value:Number.isFinite(executionScore)?(executionScore>=60?'PASS':executionScore>=45?'MIXED':'WEAK'):'UNKNOWN',
        state:Number.isFinite(executionScore)?(executionScore>=60?'pass':executionScore>=45?'warn':'fail'):'warn',
      },
    ],
  }
}
