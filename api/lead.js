// POST /api/lead
// Recebe { nome, zap, consentimento, empresa } e grava no Supabase.
// A chave de serviço fica só aqui, na variável de ambiente. O navegador nunca a vê.

const { validarEmpresa } = require('./_simples');

const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_SERVICE_KEY;
const MAX_IP     = Number(process.env.LEAD_MAX_IP || 10);   // cadastros por IP por dia
const KV_URL     = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN   = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const memoria = new Map();
async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}
async function contar(chave) {
  if (!KV_URL) { const n = (memoria.get(chave) || 0) + 1; memoria.set(chave, n); return n; }
  const n = await kv(['INCR', chave]);
  if (n === 1) await kv(['EXPIRE', chave, 60 * 60 * 48]);
  return n;
}

function responder(res, status, corpo) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(corpo);
}
function ipDe(req) {
  return String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'desconhecido').split(',')[0].trim();
}
const limpar = (v, max) => String(v || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { mensagem: 'Use POST.' });
  if (!SUPA_URL || !SUPA_KEY) return responder(res, 500, { mensagem: 'O cadastro ainda não foi configurado no servidor.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return responder(res, 400, { mensagem: 'Pedido inválido.' });

  const nome = limpar(body.nome, 80);
  const digitos = String(body.zap || '').replace(/\D/g, '').slice(0, 11);
  const zap = limpar(body.zap, 20);

  if (nome.length < 2)  return responder(res, 400, { mensagem: 'Informe seu nome.' });
  if (digitos.length < 10) return responder(res, 400, { mensagem: 'Informe um WhatsApp com DDD.' });
  if (body.consentimento !== true) return responder(res, 400, { mensagem: 'É preciso aceitar o uso dos seus dados para o contato.' });

  // A empresa é opcional: se vier, passa pela mesma validação do Raio-X.
  const empresa = validarEmpresa(body.empresa);

  try {
    const n = await contar(`lead:ip:${ipDe(req)}:${new Date().toISOString().slice(0, 10)}`);
    if (n > MAX_IP) return responder(res, 429, { mensagem: 'Muitos cadastros deste aparelho hoje. Fale com a gente pelo WhatsApp.' });

    const linha = {
      nome,
      whatsapp: zap,
      whatsapp_digitos: digitos,
      empresa: empresa ? empresa.nome : null,
      atividade: empresa ? empresa.ativ : null,
      faturamento_mes: empresa ? empresa.fat : null,
      consentimento: true,
      origem: limpar(req.headers['referer'], 200) || null
    };

    const r = await fetch(`${SUPA_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(linha)
    });
    if (!r.ok) {
      console.error('Supabase', r.status, await r.text().catch(() => ''));
      return responder(res, 502, { mensagem: 'Não consegui registrar agora. Fale com a gente pelo WhatsApp.' });
    }
    return responder(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return responder(res, 500, { mensagem: 'Erro no servidor. Fale com a gente pelo WhatsApp.' });
  }
};
