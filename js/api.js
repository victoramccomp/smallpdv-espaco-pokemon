// Comunicação com o Supabase pela API REST (PostgREST), sem biblioteca extra.
(function () {
  const cfg = window.PDV_CONFIG || {};
  const url = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const chave = cfg.supabaseKey || '';
  const configurado = url !== '' && chave !== '' &&
    !url.includes('SEU-PROJETO') && !chave.includes('SUA_CHAVE');

  async function requisicao(caminho, opcoes = {}) {
    if (!configurado) {
      throw new Error('Supabase não configurado. Preencha o arquivo js/config.js.');
    }

    const headers = { apikey: chave, 'Content-Type': 'application/json' };
    // A chave "anon" antiga é um JWT e também vai no Authorization;
    // a "publishable" (sb_publishable_...) vai só no apikey.
    if (chave.startsWith('eyJ')) headers.Authorization = 'Bearer ' + chave;
    if (opcoes.prefer) headers.Prefer = opcoes.prefer;

    let resposta;
    try {
      resposta = await fetch(url + '/rest/v1/' + caminho, {
        method: opcoes.method || 'GET',
        headers,
        body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body)
      });
    } catch {
      throw new Error('Sem conexão com o servidor. Verifique a internet.');
    }

    const texto = await resposta.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!resposta.ok) throw new Error(traduzirErro(dados, resposta.status));
    return dados;
  }

  function traduzirErro(erro, status) {
    if (erro && erro.code === '23503') {
      return 'Este produto já tem vendas registradas e não pode ser excluído.';
    }
    if (erro && erro.code === '23514') return 'Valor inválido: confira os números digitados.';
    if (status === 401 || status === 403) return 'Acesso negado pelo Supabase. Confira a chave em js/config.js.';
    if (status === 404) return 'Tabela não encontrada. Rode o arquivo supabase/schema.sql no Supabase.';
    return (erro && erro.message) || 'Erro inesperado (' + status + ').';
  }

  window.Api = {
    configurado,

    listarProdutos() {
      return requisicao('produtos?select=id,nome,estoque,valor_venda&order=nome.asc');
    },

    criarProduto(produto) {
      return requisicao('produtos', { method: 'POST', body: produto, prefer: 'return=minimal' });
    },

    atualizarProduto(id, produto) {
      return requisicao('produtos?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', body: produto, prefer: 'return=minimal'
      });
    },

    excluirProduto(id) {
      return requisicao('produtos?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    },

    registrarVenda(produtoId, quantidade, valorUnitario) {
      return requisicao('rpc/registrar_venda', {
        method: 'POST',
        body: { p_produto_id: produtoId, p_quantidade: quantidade, p_valor_unitario: valorUnitario }
      });
    },

    // inicio/fim: Date ou null (null = sem limite)
    relatorioVendas(inicio, fim) {
      return requisicao('rpc/relatorio_vendas', {
        method: 'POST',
        body: {
          p_inicio: inicio ? inicio.toISOString() : null,
          p_fim: fim ? fim.toISOString() : null
        }
      });
    }
  };
})();
