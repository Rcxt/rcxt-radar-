import test from 'node:test'
import assert from 'node:assert/strict'
import chartHandler from '../api/chart.js'

function mockResponse(){
  return {
    statusCode:200,
    headers:{},
    body:null,
    setHeader(name,value){this.headers[name]=value},
    status(code){this.statusCode=code;return this},
    json(value){this.body=value;return this},
  }
}

test('chart route resolves EVM chain context and returns analytics',async()=>{
  const previousFetch=globalThis.fetch
  const rows=[]
  for(let i=0;i<20;i+=1){
    const open=1+i*0.01
    rows.push([1790000000+i*300,open,open+0.02,open-0.01,open+0.01,1000+i*10])
  }
  globalThis.fetch=async()=>new Response(JSON.stringify({
    data:{attributes:{ohlcv_list:rows}},
    meta:{test:true},
  }),{status:200,headers:{'content-type':'application/json'}})

  const res=mockResponse()
  try{
    await chartHandler({
      method:'GET',
      url:'/api/chart?pair=0x1111111111111111111111111111111111111111&chain=base&interval=5m',
      headers:{'x-forwarded-for':'chart-route-test'},
    },res)
  }finally{
    globalThis.fetch=previousFetch
  }

  assert.equal(res.statusCode,200)
  assert.equal(res.body?.success,true)
  assert.equal(res.body?.chain,'base')
  assert.equal(res.body?.pairAddress,'0x1111111111111111111111111111111111111111')
  assert.equal(res.body?.analytics?.available,true)
})
