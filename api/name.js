/**
 * POST /api/name
 * AI 起名 + SSE 流式输出 + Supabase 落库
 *
 * 设计要点（对应实验目标）：
 * 1. 不用 SDK，直接手写 HTTP 请求 —— 和模型平台给的 curl 示例一一对应，
 *    能看清 method / url / headers / body 四件套。
 * 2. 所有模型配置集中在 modelConfigMap，调用逻辑只有一份 callModel()。
 * 3. 密钥全部来自 process.env，代码里不出现任何真实 key。
 */

const { createClient } = require('@supabase/supabase-js')

// ---------------------------------------------------------------------------
// 1. 模型配置表：换模型=改配置，不是改代码
// ---------------------------------------------------------------------------
const modelConfigMap = {
  doubao: {
    label: '豆包 · 火山方舟',
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v1',
    apiKeyEnv: 'DOUBAO_API_KEY',
    defaultModel: process.env.DOUBAO_MODEL || 'doubao-seed-1-6-250615'
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  },
  qwen: {
    label: '通义千问 · DashScope',
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    defaultModel: process.env.QWEN_MODEL || 'qwen-plus'
  },
  kimi: {
    label: 'Kimi · Moonshot',
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    defaultModel: process.env.KIMI_MODEL || 'moonshot-v1-8k'
  }
}

const SYSTEM_PROMPT = `你是一位精通中文姓名文化的起名顾问。
请根据用户给出的需求（性别、风格、字数、寓意方向等），给出 3 组名字方案。

输出格式要求（Markdown）：
1. 每组用二级标题，格式为 "## 1. 名字"
2. 标题下用一两句话写「寓意」，再补一行「出处/用字解析」（如出自哪句诗、字的含义）
3. 三组风格要有区分度，不要只换一个字
4. 结尾加一段 "> 小贴士：" 说明这组名字的适用场景或注意事项

直接输出结果，不要寒暄，不要解释你的思考过程。`

// ---------------------------------------------------------------------------
// 2. Supabase 客户端：服务端专用，优先 service_role（不受 RLS 限制）
// ---------------------------------------------------------------------------
function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// ---------------------------------------------------------------------------
// 3. 工具函数
// ---------------------------------------------------------------------------
function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function readBody(req) {
  // Vercel 默认已把 JSON body 解析好；本地自建 server 时可能还是字符串/流
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body)
  if (typeof req.body === 'string') {
    try {
      return Promise.resolve(JSON.parse(req.body))
    } catch {
      return Promise.resolve({})
    }
  }
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * 核心：一套代码调用四家模型（它们都兼容 OpenAI 的 /chat/completions 协议）
 * 用 curl 的视角看，这里做的事就是：
 *   curl {baseURL}/chat/completions -H "Authorization: Bearer $KEY" -d '{...}'
 */
async function callModel({ providerKey, model, requirement, signal }) {
  const cfg = modelConfigMap[providerKey]
  if (!cfg) throw new Error(`未知模型：${providerKey}`)

  const apiKey = process.env[cfg.apiKeyEnv]
  if (!apiKey) {
    throw new Error(`未配置环境变量 ${cfg.apiKeyEnv}，请在 .env（或 Vercel 环境变量）里补上这个模型的密钥`)
  }

  const url = `${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}` // 密钥只在这一行出现，且来自环境变量
    },
    body: JSON.stringify({
      model: model || cfg.defaultModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: requirement }
      ],
      stream: true,
      temperature: 0.9
    }),
    signal
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`上游接口返回 ${response.status}：${detail.slice(0, 300) || response.statusText}`)
  }

  return { response, modelName: `${providerKey}:${model || cfg.defaultModel}` }
}

/**
 * 解析上游 SSE，逐段回调。
 * 上游长这样：
 *   data: {"choices":[{"delta":{"content":"男"}}]}
 *   data: {"choices":[{"delta":{"content":"孩"}}]}
 *   data: [DONE]
 */
async function streamUpstream(response, onDelta) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE 以空行分隔事件；只处理完整的行，避免半个汉字被切断
    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (!line || line.startsWith(':')) continue // 心跳/注释行
      if (!line.startsWith('data:')) continue

      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      if (!data) continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta || {}
        if (delta.content) onDelta(delta.content)
      } catch {
        // 单个分片解析失败不影响整体，跳过即可
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 请求处理
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    // 给前端用的模型清单，避免前端把配置再抄一遍
    return res.status(200).json({
      models: Object.entries(modelConfigMap).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        model: cfg.defaultModel,
        configured: Boolean(process.env[cfg.apiKeyEnv])
      }))
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const body = await readBody(req)
  const requirement = String(body.requirement || '').trim()
  const providerKey = String(body.model || 'doubao').trim()
  const model = body.modelId ? String(body.modelId).trim() : undefined

  if (!requirement) return res.status(400).json({ error: '起名需求不能为空' })
  if (requirement.length > 500) return res.status(400).json({ error: '需求请控制在 500 字以内' })
  if (!modelConfigMap[providerKey]) return res.status(400).json({ error: `不支持的模型：${providerKey}` })

  // 从这里开始进入 SSE 模式，后面所有错误都用事件告诉前端（HTTP 头已发出，改不了状态码）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // 关掉 Nginx/Vercel 的响应缓冲，否则流式会「攒一发」
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  const controller = new AbortController()
  let clientGone = false
  // 注意：不能用 req.on('close') —— 请求体一读完它就会触发，会误判成用户断开。
  // 正确的是监听 res 的 close，并用 writableEnded 排除「正常结束」。
  const onClose = () => {
    if (res.writableEnded) return
    clientGone = true
    controller.abort() // 用户关页面/点停止时，及时掐断上游，省钱
  }
  res.on('close', onClose)

  sendEvent(res, { type: 'start', model: providerKey, label: modelConfigMap[providerKey].label })

  let fullText = ''
  let savedId = null

  try {
    const { response, modelName } = await callModel({
      providerKey,
      model,
      requirement,
      signal: controller.signal
    })

    await streamUpstream(response, (chunk) => {
      fullText += chunk
      if (!clientGone) sendEvent(res, { type: 'delta', text: chunk })
    })

    // 落库：失败不影响已经生成的内容，只发一个 warn
    if (fullText.trim()) {
      const supabase = getSupabase()
      if (!supabase) {
        sendEvent(res, { type: 'warn', message: '未配置 SUPABASE_URL / KEY，本次结果未写入数据库' })
      } else {
        const { data, error } = await supabase
          .from('name_history')
          .insert({
            user_requirement: requirement,
            name_result: fullText,
            model_name: modelName
          })
          .select('id')
          .single()

        if (error) {
          sendEvent(res, { type: 'warn', message: `写入 Supabase 失败：${error.message}` })
        } else {
          savedId = data?.id ?? null
        }
      }
    }

    if (!clientGone) {
      sendEvent(res, { type: 'done', id: savedId, length: fullText.length })
      res.write('data: [DONE]\n\n')
    }
  } catch (err) {
    if (clientGone || err.name === 'AbortError') {
      // 客户端主动断开，静默收尾
    } else {
      sendEvent(res, { type: 'error', message: err.message || '生成失败' })
    }
  } finally {
    res.off('close', onClose)
    res.end()
  }
}
