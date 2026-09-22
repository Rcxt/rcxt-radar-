import { generateText } from 'ai'

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false})
  try{
    const {text}=await generateText({
      model:'openai/gpt-5.6-sol',
      prompt:'Reply with exactly: RCXT_AI_OK',
      maxOutputTokens:20
    })
    return res.status(200).json({ok:text.trim()==='RCXT_AI_OK',model:'openai/gpt-5.6-sol',text:text.trim()})
  }catch(error){
    return res.status(503).json({ok:false,error:String(error?.message||error)})
  }
}
