/**
 * 本地开发服务器（不需要装 vercel CLI 也能跑）
 *   npm run dev   →  http://localhost:3000
 *
 * 它只做两件事：
 *   1. 托管 index.html 等静态文件
 *   2. 把 /api/* 转发给 api/ 目录下的函数，模拟 Vercel 的运行时
 */
require('dotenv').config()
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.PORT) || 3000
const ROOT = path.resolve(__dirname, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(raw)
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)

  // ---- API 路由 ----
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).replace(/\.js$/, '')
    const file = path.join(ROOT, 'api', `${name}.js`)

    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ error: `接口不存在: ${pathname}` }))
    }

    req.query = Object.fromEntries(url.searchParams.entries())
    if (req.method === 'POST') req.body = await parseBody(req)

    // 补上 Vercel 提供、但原生 Node 没有的小工具
    res.status = (code) => {
      res.statusCode = code
      return res
    }
    res.json = (obj) => {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(obj))
      return res
    }

    try {
      delete require.cache[require.resolve(file)] // 改代码不用重启
      const handler = require(file)
      await handler(req, res)
    } catch (err) {
      console.error('[api error]', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: err.message }))
      } else {
        res.end()
      }
    }
    return
  }

  // ---- 静态文件 ----
  let filePath = pathname === '/' ? '/index.html' : pathname
  const abs = path.join(ROOT, filePath)

  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('404 Not Found')
  }

  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' })
  fs.createReadStream(abs).pipe(res)
})

server.listen(PORT, () => {
  console.log(`\n  起名斋 dev server → http://localhost:${PORT}\n`)
})
