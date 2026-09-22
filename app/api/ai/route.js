import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { logTokenScan } from '@/lib/supabase-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fallbackAnalysis(scan) {
  const intel = scan?.intelligence
  const positives = intel?.positives?.slice(0, 3).join('; ') || 'No strong positive signals.'
  const negatives = intel?.negatives?.slice(0, 3).join('; ') || 'No major negative signals.'

  return [
    `RCXT Signal: ${intel?.signal || 'WATCH'} — score ${intel?.score ?? 0}/100 with ${intel?.confidence ?? 0}% data confidence.`,
    `Bull case: ${positives}`,
    `Risk case: ${negatives}`,
    'Plan: wait for confirmation from liquidity, order flow, and momentum rather than chasing a single candle. Treat this as market intelligence, not a guaranteed trade outcome.',
  ].join('\n\n')
}

export async function POST(request) {
  let scan

  try {
    const body = await request.json()
    scan = body?.scan
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 })
  }

  if (!scan?.address || !scan?.intelligence) {
    return NextResponse.json({ success: false, error: 'Scan data is required.' }, { status: 400 })
  }

  const compact = {
    token: scan.token,
    market: scan.market,
    trading: scan.trading,
    security: scan.security,
    intelligence: scan.intelligence,
    pair: scan.pair,
  }

  const system = `You are RCXT Radar's market analyst. Analyze the supplied Solana token snapshot only from the data provided.
Be concise, skeptical, and practical. Never claim certainty, guaranteed profit, insider knowledge, or future prices.
The deterministic RCXT signal is the source of truth; your job is to explain it, point out contradictions, and describe what would strengthen or invalidate the setup.
Use exactly four short sections: SIGNAL, WHY, INVALIDATION, RISK.
Do not tell the user to risk money they cannot afford to lose.`

  try {
    const { text } = await generateText({
      model: 'openai/gpt-5.6-sol',
      system,
      prompt: JSON.stringify(compact),
      maxOutputTokens: 500,
    })

    await Promise.race([
      logTokenScan(scan, text),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ])

    return NextResponse.json({
      success: true,
      model: 'openai/gpt-5.6-sol',
      analysis: text,
    })
  } catch {
    const analysis = fallbackAnalysis(scan)

    return NextResponse.json({
      success: true,
      model: 'deterministic-fallback',
      analysis,
    })
  }
}
