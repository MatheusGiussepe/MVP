// POST /api/lessy
// Recebe { sid, pergunta, empresa, historico } e responde { resposta, restantes }.
// A chave da API fica só aqui, na variável de ambiente ANTHROPIC_API_KEY.

const { validarEmpresa, instrucoes, dadosEmpresa } = require('./_simples');

const MODELO       = process.env.LESSY_MODEL || 'claude-sonnet-5';
const MAX_SESSAO   = Number(process.env.LESSY_MAX_SESSAO || 3);    // perguntas por sessão
const MAX_IP       = Number(process.env.LESSY_MAX_IP || 20);       // por IP por dia (vários celulares no mesmo Wi-Fi)
const MAX_DIA      = Number(process.env.LESSY_MAX_DIA || 400);     // teto geral por dia: protege o orçamento
const KV_URL       = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN     = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DOIS_DIAS    = 60 * 60 * 48;

// ---------- contadores (Upstash Redis via REST; sem ele, memória da instância) ----------
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
async function ler(chave) {
  if (!KV_URL) return memoria.get(chave) || 0;
  return Number(await kv(['GET', chave])) || 0;
}
async function somar(chave) {
  if (!KV_URL) { const n = (memoria.get(chave) || 0) + 1; memoria.set(chave, n); return n; }
  const n = await kv(['INCR', chave]);
  if (n === 1) await kv(['EXPIRE', chave, DOIS_DIAS]);
  return n;
}

// ---------- utilidades ----------
function responder(res, status, corpo) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(corpo);
}
function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido').split(',')[0].trim();
}
function limparHistorico(h) {
  if (!Array.isArray(h)) return [];
  const itens = h.slice(-4)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
  while (itens.length && itens[0].role !== 'user') itens.shift();       // a conversa precisa começar pelo usuário
  const alternado = [];
  for (const m of itens) if (!alternado.length || alternado[alternado.length - 1].role !== m.role) alternado.push(m);
  if (alternado.length && alternado[alternado.length - 1].role === 'user') alternado.pop(); // a pergunta nova entra depois
  return alternado;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { mensagem: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) return responder(res, 500, { mensagem: 'O Lessy ainda não foi configurado no servidor.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return responder(res, 400, { mensagem: 'Pedido inválido.' });

  const sid = String(body.sid || '');
  const pergunta = String(body.pergunta || '').trim();
  const empresa = validarEmpresa(body.empresa);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) return responder(res, 400, { mensagem: 'Sessão inválida. Recarregue a página.' });
  if (!pergunta || pergunta.length > 300) return responder(res, 400, { mensagem: 'Escreva uma pergunta de até 300 caracteres.' });
  if (!empresa) return responder(res, 400, { mensagem: 'Preencha os dados da empresa antes de perguntar.' });

  const dia = new Date().toISOString().slice(0, 10);
  const kSessao = `lessy:s:${sid}`, kIp = `lessy:ip:${ipDe(req)}:${dia}`, kDia = `lessy:dia:${dia}`;

  try {
    const [usadasSessao, usadasIp, usadasDia] = await Promise.all([ler(kSessao), ler(kIp), ler(kDia)]);
    if (usadasSessao >= MAX_SESSAO)
      return responder(res, 429, { restantes: 0, mensagem: 'Você usou as 3 perguntas desta demonstração. As perguntas rápidas continuam funcionando, e um especialista pode ajudar com o resto.' });
    if (usadasIp >= MAX_IP || usadasDia >= MAX_DIA)
      return responder(res, 429, { restantes: Math.max(0, MAX_SESSAO - usadasSessao), mensagem: 'O Lessy está com muita procura agora. Tente de novo mais tarde ou use as perguntas rápidas.' });

    const messages = [...limparHistorico(body.historico), { role: 'user', content: `${dadosEmpresa(empresa)}\n\nPergunta: ${pergunta}` }];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: MODELO, max_tokens: 400, system: instrucoes(), messages })
    });
    if (!r.ok) {
      console.error('Anthropic', r.status, await r.text().catch(() => ''));
      return responder(res, 502, { mensagem: 'O Lessy não conseguiu responder agora. Tente de novo em instantes.' });
    }
    const data = await r.json();
    const resposta = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!resposta) return responder(res, 502, { mensagem: 'O Lessy não conseguiu responder agora. Tente de novo em instantes.' });

    // Só conta a pergunta quando ela foi respondida
    const [n] = await Promise.all([somar(kSessao), somar(kIp), somar(kDia)]);
    return responder(res, 200, { resposta, restantes: Math.max(0, MAX_SESSAO - n) });
  } catch (e) {
    console.error(e);
    return responder(res, 500, { mensagem: 'Erro no servidor. Tente de novo em instantes.' });
  }
};
