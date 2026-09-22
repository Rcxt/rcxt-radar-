export function applySocialToIntelligence(intelligence,social){
  if(!intelligence||!social?.available) return {...intelligence,social:null}
  const quality=Number(social.qualityScore||0)
  const diversity=Number(social.sourceDiversity||0)
  const momentum=Number(social.momentumScore||50)

  let adjustment=0
  if(quality>=55 && diversity>=2){
    adjustment=Math.round((momentum-50)*0.10)
    adjustment=Math.max(-5,Math.min(5,adjustment))
  }else if(quality>=35 && diversity>=1){
    adjustment=Math.round((momentum-50)*0.04)
    adjustment=Math.max(-2,Math.min(2,adjustment))
  }

  const original=Number(intelligence.score||0)
  let score=Math.max(0,Math.min(100,original+adjustment))
  if(intelligence.signal==='SELL / AVOID') score=Math.min(score,37)
  if(intelligence.signal==='REDUCE') score=Math.min(score,49)
  if(intelligence.signal==='WATCH') score=Math.min(score,74)
  if(intelligence.signal==='LEAN BUY') score=Math.min(score,84)

  return {
    ...intelligence,
    score,
    social:{
      adjustment,
      momentumScore:momentum,
      qualityScore:quality,
      sourceDiversity:diversity,
      mentionCount:social.mentionCount,
      uniqueAuthors:social.uniqueAuthors,
      sentiment:social.sentiment,
      duplicateRatio:social.duplicateRatio,
    }
  }
}
