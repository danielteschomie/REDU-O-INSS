/**
 * Netlify Function de teste: ConsultarOS + AlterarOS (Omie) — % Red. Base Cálc INSS
 *
 * USO (depois de publicado, ex: https://SEU-SITE.netlify.app):
 *
 *   Listar OS:
 *     GET /.netlify/functions/teste-omie-inss?acao=listar
 *
 *   Calcular em modo DRY RUN (não altera nada no Omie):
 *     GET /.netlify/functions/teste-omie-inss?acao=calcular&codigoPedido=123456&va=300&vt=200
 *
 *   Calcular e ENVIAR de verdade (só em app de TESTE do Omie):
 *     GET /.netlify/functions/teste-omie-inss?acao=calcular&codigoPedido=123456&va=300&vt=200&confirmar=1
 */

const BASE_URL = "https://app.omie.com.br/api/v1/servicos/os/";

async function omieCall(call, param) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [param],
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

exports.handler = async (event) => {
  if (!process.env.OMIE_APP_KEY || !process.env.OMIE_APP_SECRET) {
    return resposta(500, {
      erro: "Configure OMIE_APP_KEY e OMIE_APP_SECRET nas variáveis de ambiente do Netlify.",
    });
  }

  const q = event.queryStringParameters || {};
  const acao = q.acao;

  if (acao === "listar") {
    const { status, body } = await omieCall("ListarOS", {
      pagina: 1,
      registros_por_pagina: 20,
      apenas_importado_api: "N",
    });
    return resposta(status, body);
  }

  if (acao === "calcular") {
    const codigoPedido = Number(q.codigoPedido);
    const va = Number(q.va || 0);
    const vt = Number(q.vt || 0);
    const confirmar = q.confirmar === "1" || q.confirmar === "true";

    if (!codigoPedido) {
      return resposta(400, { erro: "Informe codigoPedido na query string." });
    }

    const { body: osData } = await omieCall("ConsultarOS", { nCodOS: codigoPedido });
    const valorBruto = osData?.ServicosPrestados?.[0]?.nValUnit;

    if (!valorBruto) {
      return resposta(200, {
        aviso: "Não encontrei nValUnit automaticamente. Confira a estrutura da OS e ajuste o código.",
        retornoOS: osData,
      });
    }

    const percentual = ((va + vt) / valorBruto) * 100;
    const percentualFormatado = Number(percentual.toFixed(6));

    const tentativas = [
      {
        nome: "Tentativa A: vRetencao.redBaseINSS",
        param: {
          cabecalho: { codigo_pedido: codigoPedido },
          ServicosPrestados: [{ vRetencao: { redBaseINSS: percentualFormatado } }],
        },
      },
      {
        nome: "Tentativa B: impostos.nAliqINSS",
        param: {
          cabecalho: { codigo_pedido: codigoPedido },
          ServicosPrestados: [{ impostos: { nAliqINSS: percentualFormatado } }],
        },
      },
      {
        nome: "Tentativa C: campo direto na raiz do serviço",
        param: {
          cabecalho: { codigo_pedido: codigoPedido },
          ServicosPrestados: [{ redBaseINSS: percentualFormatado }],
        },
      },
    ];

    if (!confirmar) {
      return resposta(200, {
        modo: "DRY RUN — nenhuma chamada de update foi enviada",
        valorBruto,
        percentualCalculado: percentualFormatado,
        payloadsQueSeriamTestados: tentativas,
      });
    }

    const resultados = [];
    for (const t of tentativas) {
      const r = await omieCall("AlterarOS", t.param);
      resultados.push({ tentativa: t.nome, status: r.status, resposta: r.body });
    }

    return resposta(200, {
      valorBruto,
      percentualCalculado: percentualFormatado,
      resultados,
    });
  }

  return resposta(400, {
    erro: "Use ?acao=listar ou ?acao=calcular&codigoPedido=...&va=...&vt=...",
  });
};

function resposta(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj, null, 2),
  };
}
