# Less Tax — MVP

App de Raio-X tributário para pequenas empresas, com o assistente Lessy (Claude Sonnet 5) e pré-venda por Pix.

## Estrutura

```
MVP/
├── index.html        # o app inteiro (tela, cálculos, Pix, chat)
├── api/
│   ├── lessy.js      # função da Vercel: chama o Claude e controla os limites
│   └── _simples.js   # cálculos do Simples e instruções do Lessy (não vira rota)
├── vercel.json       # tempo máximo da função (30 s)
├── package.json
├── .env.example      # variáveis de ambiente necessárias
└── .gitignore
```

Não há dependências para instalar: a função usa o `fetch` nativo do Node 18+.

## Publicar na Vercel

1. **Chave da API**: crie em https://platform.claude.com (API Keys). Em *Billing*, defina um limite de gastos (por exemplo, US$ 10/mês).
2. **Deploy**: dentro da pasta `MVP`, rode `npx vercel` e aceite as opções padrão. Depois, `npx vercel --prod`.
3. **Variáveis de ambiente**: no painel da Vercel, em *Settings > Environment Variables*, adicione `ANTHROPIC_API_KEY`. As outras de `.env.example` são opcionais.
4. **Contadores (recomendado)**: em *Storage* (ou *Marketplace*), conecte um banco **Upstash Redis** ao projeto. A Vercel cria sozinha `KV_REST_API_URL` e `KV_REST_API_TOKEN`. Sem isso, os limites ficam só na memória do servidor e podem zerar quando ele reinicia.
5. Rode `npx vercel --prod` de novo para aplicar as variáveis.

## Limites do Lessy

| Variável | Padrão | O que controla |
|---|---|---|
| `LESSY_MAX_SESSAO` | 3 | Perguntas por sessão (cada simulação é uma sessão) |
| `LESSY_MAX_IP` | 20 | Perguntas por IP por dia. Alto de propósito: num evento, muitos celulares usam o mesmo Wi-Fi |
| `LESSY_MAX_DIA` | 400 | Teto geral por dia, para proteger o orçamento |
| `LESSY_MODEL` | `claude-sonnet-5` | Troque para `claude-haiku-4-5` para gastar cerca de metade |

Se mudar `LESSY_MAX_SESSAO`, mude também `LIMITE_SESSAO` no `index.html`.

A pergunta só é contada quando o Lessy responde. Quando o limite acaba, as perguntas rápidas continuam funcionando com respostas prontas, sem gastar API.

**Custo estimado com Sonnet 5**: cerca de US$ 0,005 por pergunta, ou US$ 1,50 para 100 pessoas usando as 3 perguntas.

## Segurança

- A chave da API fica só na Vercel. Nunca coloque no `index.html`.
- O navegador envia apenas a pergunta (até 300 caracteres) e os números da empresa. O servidor valida os dados, refaz os cálculos e monta as instruções do Lessy, então o endpoint não serve como "Claude grátis" para outros usos.
- Respostas limitadas a 400 tokens.

## Pix e WhatsApp

Os dados ficam no bloco `CONFIG` no início do `<script>` do `index.html`: chave, nome, cidade, valor, WhatsApp e texto da oferta.

## Testar localmente

`npx vercel dev` sobe o site e a função em http://localhost:3000 (precisa da `ANTHROPIC_API_KEY` num arquivo `.env`).
Abrindo o `index.html` direto no navegador, sem servidor, o Lessy usa só as respostas prontas.
