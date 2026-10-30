// Comunicação com o Supabase (Auth + API REST), sem biblioteca extra.
(function () {
  const cfg = window.PDV_CONFIG || {};
  const url = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const chave = cfg.supabaseKey || '';
  const configurado = url !== '' && chave !== '' &&
    !url.includes('SEU-PROJETO') && !chave.includes('SUA_CHAVE');

  const CHAVE_SESSAO = 'pdv_sessao';

  // ---------- Sessão (guardada no navegador) ----------

  function lerSessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)) || null; } catch { return null; }
  }

  function gravarSessao(sessao) {
    try {
      if (sessao) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch { /* navegador sem armazenamento: a sessão dura só esta página */ }
    sessaoAtual = sessao;
  }

  let sessaoAtual = lerSessao();

  function sessaoDaResposta(dados) {
    return {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expira_em: Date.now() + (dados.expires_in || 3600) * 1000,
      usuario: { id: dados.user.id, email: dados.user.email },
      perfil: sessaoAtual && sessaoAtual.usuario.id === dados.user.id ? sessaoAtual.perfil : null
    };
  }

  // Quem não está logado (ou teve a sessão encerrada) volta para a tela de login.
  function irParaLogin() {
    gravarSessao(null);
    if (!/login\.html$/.test(location.pathname)) location.replace('login.html');
    return new Promise(() => {}); // a página está saindo; nada mais deve rodar
  }

  async function chamarAuth(caminho, corpo, token) {
    const headers = { apikey: chave, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let resposta;
    try {
      resposta = await fetch(url + '/auth/v1/' + caminho, {
        method: 'POST', headers, body: JSON.stringify(corpo || {})
      });
    } catch {
      throw new Error('Sem conexão com o servidor. Verifique a internet.');
    }
    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const erro = new Error(traduzirErroAuth(dados));
      erro.status = resposta.status;
      throw erro;
    }
    return dados;
  }

  function traduzirErroAuth(dados) {
    const codigo = dados && (dados.error_code || dados.code);
    if (codigo === 'invalid_credentials') return 'E-mail ou senha incorretos.';
    if (codigo === 'email_not_confirmed') return 'E-mail ainda não confirmado. Peça ao admin para confirmar o usuário.';
    if (codigo === 'user_banned') return 'Este usuário está bloqueado.';
    if (codigo === 'over_request_rate_limit') return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return (dados && (dados.msg || dados.message || dados.error_description)) || 'Não foi possível entrar.';
  }

  // O acesso do Supabase vale ~1 hora; renova pouco antes de vencer.
  let renovacaoEmAndamento = null;
  function renovarSessao() {
    if (!renovacaoEmAndamento) {
      const sessao = sessaoAtual;
      renovacaoEmAndamento = chamarAuth('token?grant_type=refresh_token', { refresh_token: sessao.refresh_token })
        .then((dados) => { gravarSessao(sessaoDaResposta(dados)); })
        .catch((erro) => {
          if (erro.status >= 400 && erro.status < 500) return irParaLogin();
          throw erro; // sem internet: mantém a sessão para tentar de novo
        })
        .finally(() => { renovacaoEmAndamento = null; });
    }
    return renovacaoEmAndamento;
  }

  async function tokenValido() {
    if (!sessaoAtual) return irParaLogin();
    if (Date.now() > sessaoAtual.expira_em - 60 * 1000) await renovarSessao();
    return sessaoAtual.access_token;
  }

  // ---------- API REST ----------

  async function requisicao(caminho, opcoes = {}, jaRenovou = false) {
    if (!configurado) {
      throw new Error('Supabase não configurado. Preencha o arquivo js/config.js.');
    }

    const headers = {
      apikey: chave,
      Authorization: 'Bearer ' + await tokenValido(),
      'Content-Type': 'application/json'
    };
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

    // Token recusado (ex.: relógio do aparelho adiantado): renova uma vez e repete.
    if (resposta.status === 401 && !jaRenovou) {
      await renovarSessao();
      return requisicao(caminho, opcoes, true);
    }
    if (resposta.status === 401) return irParaLogin();
    if (!resposta.ok) {
      if (dados && dados.code === '23503' && opcoes.erroVinculo) throw new Error(opcoes.erroVinculo);
      throw new Error(traduzirErro(dados, resposta.status));
    }
    return dados;
  }

  function traduzirErro(erro, status) {
    if (erro && erro.code === '23503') return 'Este cadastro está em uso e não pode ser excluído.';
    if (erro && erro.code === '23505') return 'Já existe um cadastro com esse nome.';
    if (erro && erro.code === '23514') return 'Valor inválido: confira os números digitados.';
    if (erro && erro.code === '42501') return 'Você não tem permissão para isso. Fale com o admin.';
    if (status === 403) return 'Você não tem permissão para isso. Fale com o admin.';
    if (status === 404) return 'Tabela não encontrada. Rode o arquivo supabase/schema.sql no Supabase.';
    return (erro && erro.message) || 'Erro inesperado (' + status + ').';
  }

  window.Api = {
    configurado,

    // ----- login -----

    sessao() { return sessaoAtual; },

    async entrar(email, senha) {
      if (!configurado) throw new Error('Supabase não configurado. Preencha o arquivo js/config.js.');
      const dados = await chamarAuth('token?grant_type=password', { email, password: senha });
      gravarSessao(sessaoDaResposta(dados));
      return this.carregarPerfil();
    },

    async sair() {
      const sessao = sessaoAtual;
      gravarSessao(null);
      if (sessao) {
        try { await chamarAuth('logout', {}, sessao.access_token); } catch { /* já saiu localmente */ }
      }
      location.replace('login.html');
    },

    // Nome e papel (admin ou não) do usuário logado, sempre lidos do banco.
    async carregarPerfil() {
      const linhas = await requisicao('perfis?select=nome,admin&id=eq.' + encodeURIComponent(sessaoAtual.usuario.id));
      if (!linhas || !linhas.length) {
        gravarSessao(null);
        throw new Error('Usuário sem perfil no sistema. Rode o supabase/schema.sql de novo.');
      }
      sessaoAtual.perfil = linhas[0];
      gravarSessao(sessaoAtual);
      return linhas[0];
    },

    listarVendedores() {
      return requisicao('perfis?select=id,nome&order=nome.asc');
    },

    // ----- fornecedores -----

    listarFornecedores() {
      return requisicao('fornecedores?select=id,nome&order=nome.asc');
    },

    criarFornecedor(fornecedor) {
      return requisicao('fornecedores', { method: 'POST', body: fornecedor, prefer: 'return=minimal' });
    },

    atualizarFornecedor(id, fornecedor) {
      return requisicao('fornecedores?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', body: fornecedor, prefer: 'return=minimal'
      });
    },

    excluirFornecedor(id) {
      return requisicao('fornecedores?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        erroVinculo: 'Este fornecedor tem produtos vinculados. Troque o fornecedor desses produtos antes de excluir.'
      });
    },

    // ----- produtos e vendas -----

    // fornecedor: { nome } — vem vazio para quem não é admin
    listarProdutos() {
      return requisicao('produtos?select=id,nome,estoque,valor_venda,fornecedor_id,fornecedor:fornecedores(nome)&order=nome.asc');
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
      return requisicao('produtos?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        erroVinculo: 'Este produto já tem vendas registradas e não pode ser excluído.'
      });
    },

    registrarVenda(produtoId, quantidade, valorUnitario) {
      return requisicao('rpc/registrar_venda', {
        method: 'POST',
        body: { p_produto_id: produtoId, p_quantidade: quantidade, p_valor_unitario: valorUnitario }
      });
    },

    // inicio/fim: Date ou null (null = sem limite); usuarioId/fornecedorId: null = todos
    relatorioVendas(inicio, fim, usuarioId, fornecedorId) {
      return requisicao('rpc/relatorio_vendas', {
        method: 'POST',
        body: {
          p_inicio: inicio ? inicio.toISOString() : null,
          p_fim: fim ? fim.toISOString() : null,
          p_usuario_id: usuarioId || null,
          p_fornecedor_id: fornecedorId ? Number(fornecedorId) : null
        }
      });
    }
  };
})();
