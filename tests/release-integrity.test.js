import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('trading math exports are unique and source is merge-clean', async()=>{
  const source=await readFile(new URL('../src/lib/trading-math.js',import.meta.url),'utf8')
  const names=[...source.matchAll(/export function\s+([A-Za-z0-9_]+)/g)].map((match)=>match[1])
  const duplicates=names.filter((name,index)=>names.indexOf(name)!==index)
  assert.deepEqual(duplicates,[])
  assert.equal((source.match(/export function buildEntryQuality/g)||[]).length,1)
  assert.equal((source.match(/export function buildRugRiskChecklist/g)||[]).length,1)
  assert.equal(/<<<<<<<|=======|>>>>>>>/.test(source),false)
})
