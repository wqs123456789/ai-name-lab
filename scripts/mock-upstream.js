/**
 * 模拟大模型上游（OpenAI 兼容协议 + SSE 流式）
 *   npm run mock   →  http://127.0.0.1:4010/api/v1/chat/completions
 *
 * 用途：还没拿到真实密钥、或想先验证「流式 + 落库 + 前端渲染」链路时使用。
 * 验证完把 .env 里的 DOUBAO_API_KEY 填上真实值、并注释掉 DOUBAO_BASE_URL 即可。
 */
const http = require('http')

const SAMPLE = `## 1. 沈砚舟

**寓意**：砚为文房之器，舟行水上，取「笔墨作舟、学海无涯」之意，读书人气息浓。

**用字解析**：「砚」属土，稳重内敛；「舟」字轻灵，一静一动，避免厚重。

## 2. 顾清让

**寓意**：清者澄澈，让者谦和，取「清而不寒，让而不弱」的君子分寸感。

**用字解析**：出自《楚辞·渔父》「举世皆浊我独清」的意象延伸，「让」字补足温度。

## 3. 江叙白

**寓意**：叙为叙说，白为留白，合起来是「言有尽而意无穷」的东方审美。

**用字解析**：「叙」少见但不生僻；「白」字极简，与两字名形成呼吸感。

> 小贴士：三组名字声调均为「平仄平」，念起来最顺口；若姓氏为单字平声（如「陈」），建议优先第 2 组。`

const server = http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions') || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'mock: not found' }))
  }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let model = 'mock-model'
    try {
      model = JSON.parse(body).model || model
    } catch {}

    console.log(`[mock] 收到请求 model=${model} auth=${(req.headers.authorization || '').slice(0, 14)}...`)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    const chunks = SAMPLE.match(/[\s\S]{1,6}/g) || []
    let i = 0

    const timer = setInterval(() => {
      if (i >= chunks.length) {
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      const payload = { choices: [{ delta: { content: chunks[i++] }, index: 0 }] }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }, 25)

    // 同理：监听 res 而不是 req，否则请求体读完就会立刻清掉定时器
    res.on('close', () => clearInterval(timer))
  })
})

server.listen(4010, () => {
  console.log('  mock 上游已启动 → http://127.0.0.1:4010/api/v1/chat/completions')
})
