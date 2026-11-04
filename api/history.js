/**
 * GET /api/history?limit=10
 * 读最近的起名记录（服务端读，前端拿不到任何密钥）
 */
const { createClient } = require('@supabase/supabase-js')

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    return res.status(200).json({ items: [], note: '未配置 Supabase，历史记录不可用' })
  }

  const limit = Math.min(Number(req.query?.limit) || 10, 50)

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await supabase
      .from('name_history')
      .select('id, user_requirement, model_name, created_at, name_result')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return res.status(500).json({ error: error.message, items: [] })

    res.status(200).json({
      items: (data || []).map((row) => ({
        id: row.id,
        requirement: row.user_requirement,
        model: row.model_name,
        createdAt: row.created_at,
        preview: String(row.name_result || '').slice(0, 120)
      }))
    })
  } catch (err) {
    res.status(500).json({ error: err.message, items: [] })
  }
}
