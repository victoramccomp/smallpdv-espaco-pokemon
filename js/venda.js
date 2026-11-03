// Tela: Registro de Venda (pedido com vários itens, troco e edição de pedidos)
(function () {
  const formItem = document.getElementById('form-item');
  const campoProduto = document.getElementById('produto');
  const campoValor = document.getElementById('valor');
  const campoQuantidade = document.getElementById('quantidade');
  const infoEstoque = document.getElementById('info-estoque');
  const botaoLer = document.getElementById('btn-ler');

  const listaItens = document.getElementById('itens-pedido');
  const saidaTotal = document.getElementById('total');
  const campoRecebido = document.getElementById('recebido');
  const rotuloTroco = document.getElementById('rotulo-troco');
  const saidaTroco = document.getElementById('troco');
  const botaoFinalizar = document.getElementById('btn-finalizar');
  const botaoLimpar = document.getElementById('btn-limpar');
  const acoesEdicao = document.getElementById('acoes-edicao');
  const botaoDescartar = document.getElementById('btn-descartar');
  const botaoCancelarPedido = document.getElementById('btn-cancelar-pedido');
  const faixaEdicao = document.getElementById('faixa-edicao');
  const tituloPedido = document.getElementById('titulo-pedido');

  const tituloPedidos = document.getElementById('titulo-pedidos');
  const listaPedidos = document.getElementById('lista-pedidos');

  const CHAVE_RASCUNHO = 'pdv_rascunho_pedido';
  const formatoData = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  let perfil = null;
  let produtos = [];
  let itens = [];             // pedido em montagem: { produto_id, nome, quantidade, valor_unitario }
  let pedidoEmEdicao = null;  // pedido já registrado que está sendo editado (null = pedido novo)
  let pedidos = [];

  // ---------- Estoque disponível ----------

  // Estoque atual + o que já estava no pedido em edição − o que está no pedido agora.
  function disponivel(produtoId) {
    const p = produtos.find((x) => x.id === produtoId);
    if (!p) return 0;
    const original = pedidoEmEdicao
      ? pedidoEmEdicao.itens.filter((i) => i.produto_id === produtoId).reduce((s, i) => s + i.quantidade, 0)
      : 0;
    const noPedido = itens.filter((i) => i.produto_id === produtoId).reduce((s, i) => s + i.quantidade, 0);
    return p.estoque + original - noPedido;
  }

  function textoDisponivel(n) {
    return n > 0 ? n + (n === 1 ? ' disponível' : ' disponíveis') : 'sem estoque';
  }

  // ---------- Produtos e seleção ----------

  async function carregarProdutos() {
    try {
      produtos = await Api.listarProdutos();
    } catch (erro) {
      campoProduto.innerHTML = '<option value="">Não foi possível carregar</option>';
      avisar(erro.message, 'erro');
      return;
    }
    desenharOpcoes();
  }

  function desenharOpcoes() {
    const selecionado = campoProduto.value;
    campoProduto.innerHTML = '';
    campoProduto.add(new Option(produtos.length ? 'Selecione um produto' : 'Nenhum produto cadastrado', ''));
    for (const p of produtos) {
      const n = disponivel(p.id);
      const opcao = new Option(p.nome + ' — ' + textoDisponivel(n), p.id);
      opcao.disabled = n <= 0;
      campoProduto.add(opcao);
    }
    campoProduto.value = selecionado;
    if (campoProduto.selectedIndex < 0 || campoProduto.selectedOptions[0].disabled) campoProduto.value = '';
    mostrarEstoque(produtoSelecionado());
  }

  function produtoSelecionado() {
    return produtos.find((p) => String(p.id) === campoProduto.value);
  }

  function mostrarEstoque(p) {
    infoEstoque.textContent = p ? 'Disponível: ' + disponivel(p.id) : '';
  }

  // Ao escolher o produto, o valor de venda já vem preenchido (e continua editável).
  function selecionarProduto(p) {
    campoValor.value = p ? valorParaCampo(p.valor_venda) : '';
    campoQuantidade.value = p ? '1' : '';
    campoValor.removeAttribute('aria-invalid');
    campoQuantidade.removeAttribute('aria-invalid');
    mostrarEstoque(p);
  }

  campoProduto.addEventListener('change', () => selecionarProduto(produtoSelecionado()));
  campoValor.addEventListener('input', () => campoValor.removeAttribute('aria-invalid'));
  campoQuantidade.addEventListener('input', () => campoQuantidade.removeAttribute('aria-invalid'));
  campoQuantidade.addEventListener('focus', () => campoQuantidade.select());

  botaoLer.addEventListener('click', async () => {
    let codigo;
    try {
      codigo = await LeitorCodigo.ler();
    } catch (erro) {
      avisar(erro.message, 'erro');
      return;
    }
    if (!codigo) return;

    const p = produtos.find((x) => x.codigo_barras === codigo);
    if (!p) {
      avisar('Código ' + codigo + ' não está cadastrado em nenhum produto.', 'erro');
      return;
    }
    if (disponivel(p.id) <= 0) {
      avisar(p.nome + ' está sem estoque.', 'erro');
      return;
    }
    campoProduto.value = String(p.id);
    selecionarProduto(p);
    avisar('Lido: ' + p.nome, 'ok');
  });

  // ---------- Itens do pedido ----------

  formItem.addEventListener('submit', (evento) => {
    evento.preventDefault();

    const p = produtoSelecionado();
    const valor = lerDinheiro(campoValor.value);
    const quantidade = lerInteiro(campoQuantidade.value, 1);

    if (!p) {
      avisar('Selecione um produto.', 'erro');
      campoProduto.focus();
      return;
    }
    if (!Number.isFinite(valor)) {
      campoValor.setAttribute('aria-invalid', 'true');
      avisar('Digite um valor válido, ex.: 12,50', 'erro');
      campoValor.focus();
      return;
    }
    if (!Number.isFinite(quantidade)) {
      campoQuantidade.setAttribute('aria-invalid', 'true');
      avisar('Digite a quantidade (número inteiro maior que zero).', 'erro');
      campoQuantidade.focus();
      return;
    }
    const livre = disponivel(p.id);
    if (quantidade > livre) {
      campoQuantidade.setAttribute('aria-invalid', 'true');
      avisar('Só há ' + livre + ' disponível de ' + p.nome + '.', 'erro');
      campoQuantidade.focus();
      return;
    }

    // Mesmo produto com o mesmo valor: soma na linha que já existe.
    const existente = itens.find((i) => i.produto_id === p.id && i.valor_unitario === valor);
    if (existente) existente.quantidade += quantidade;
    else itens.push({ produto_id: p.id, nome: p.nome, quantidade, valor_unitario: valor });

    campoProduto.value = '';
    selecionarProduto(null);
    mudouPedido();
  });

  listaItens.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (!botao) return;
    const item = itens[Number(botao.closest('li').dataset.indice)];
    if (!item) return;

    if (botao.dataset.acao === 'mais') {
      if (disponivel(item.produto_id) <= 0) {
        avisar('Não há mais ' + item.nome + ' em estoque.', 'erro');
        return;
      }
      item.quantidade += 1;
    } else if (botao.dataset.acao === 'menos') {
      if (item.quantidade > 1) item.quantidade -= 1;
    } else if (botao.dataset.acao === 'remover') {
      itens.splice(itens.indexOf(item), 1);
    }
    mudouPedido();
  });

  function totalDoPedido() {
    return Math.round(itens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0) * 100) / 100;
  }

  function mudouPedido() {
    desenharItens();
    desenharOpcoes();
    salvarRascunho();
  }

  function desenharItens() {
    if (!itens.length) {
      listaItens.innerHTML = '<li class="vazio">Nenhum item ainda. Escolha um produto acima.</li>';
    } else {
      listaItens.innerHTML = itens.map((i, indice) =>
        '<li class="item-pedido" data-indice="' + indice + '">' +
          '<div class="item-info">' +
            '<span class="nome">' + escaparHtml(i.nome) + '</span>' +
            '<span class="detalhe">' + formatarDinheiro(i.valor_unitario) + ' cada · <strong>' +
              formatarDinheiro(i.quantidade * i.valor_unitario) + '</strong></span>' +
          '</div>' +
          '<div class="item-qtd">' +
            '<button type="button" data-acao="menos" aria-label="Diminuir"' + (i.quantidade <= 1 ? ' disabled' : '') + '>−</button>' +
            '<span aria-label="Quantidade">' + i.quantidade + '</span>' +
            '<button type="button" data-acao="mais" aria-label="Aumentar">+</button>' +
          '</div>' +
          '<button type="button" class="item-remover" data-acao="remover" aria-label="Remover ' + escaparHtml(i.nome) + '">×</button>' +
        '</li>'
      ).join('');
    }
    saidaTotal.textContent = formatarDinheiro(totalDoPedido());
    botaoFinalizar.disabled = !itens.length;
    botaoLimpar.hidden = !itens.length || !!pedidoEmEdicao;
    atualizarTroco();
  }

  // ---------- Troco ----------

  function atualizarTroco() {
    const recebido = lerDinheiro(campoRecebido.value);
    const total = totalDoPedido();
    saidaTroco.className = '';
    if (!Number.isFinite(recebido)) {
      rotuloTroco.textContent = 'Troco';
      saidaTroco.textContent = '—';
    } else if (recebido >= total) {
      rotuloTroco.textContent = 'Troco';
      saidaTroco.textContent = formatarDinheiro(recebido - total);
      saidaTroco.className = 'troco-ok';
    } else {
      rotuloTroco.textContent = 'Falta';
      saidaTroco.textContent = formatarDinheiro(total - recebido);
      saidaTroco.className = 'troco-falta';
    }
  }

  campoRecebido.addEventListener('input', atualizarTroco);

  // ---------- Rascunho (pedido novo sobrevive a recarregar a página) ----------

  function salvarRascunho() {
    if (pedidoEmEdicao) return;
    try {
      if (itens.length) {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ usuario: Api.sessao().usuario.id, itens }));
      } else {
        localStorage.removeItem(CHAVE_RASCUNHO);
      }
    } catch { /* sem armazenamento: o rascunho só vale nesta página */ }
  }

  function restaurarRascunho() {
    let rascunho = null;
    try { rascunho = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO)); } catch { rascunho = null; }
    if (!rascunho || rascunho.usuario !== Api.sessao().usuario.id) return;
    itens = (rascunho.itens || []).filter((i) => produtos.some((p) => p.id === i.produto_id));
  }

  // ---------- Finalizar, editar e cancelar ----------

  botaoFinalizar.addEventListener('click', async () => {
    if (!itens.length) return;

    const total = totalDoPedido();
    const recebido = lerDinheiro(campoRecebido.value);
    if (Number.isFinite(recebido) && recebido < total) {
      avisar('O valor recebido é menor que o total do pedido.', 'erro');
      campoRecebido.focus();
      return;
    }

    const dados = itens.map((i) => ({
      produto_id: i.produto_id, quantidade: i.quantidade, valor_unitario: i.valor_unitario
    }));
    const editando = !!pedidoEmEdicao;
    const textoOriginal = botaoFinalizar.textContent;
    botaoFinalizar.disabled = true;
    botaoFinalizar.textContent = editando ? 'Salvando…' : 'Registrando…';
    try {
      if (editando) await Api.editarPedido(pedidoEmEdicao.id, dados);
      else await Api.registrarPedido(dados);

      let mensagem = (editando ? 'Pedido atualizado: ' : 'Venda registrada: ') + formatarDinheiro(total);
      if (Number.isFinite(recebido)) mensagem += ' · Troco: ' + formatarDinheiro(recebido - total);
      avisar(mensagem, 'ok');
      voltarParaPedidoNovo();
      await Promise.all([carregarProdutos(), carregarPedidos()]);
    } catch (erro) {
      avisar(erro.message, 'erro');
      await carregarProdutos(); // o estoque pode ter mudado em outro aparelho
      botaoFinalizar.textContent = textoOriginal;
      botaoFinalizar.disabled = !itens.length;
    }
  });

  function voltarParaPedidoNovo() {
    pedidoEmEdicao = null;
    itens = [];
    campoRecebido.value = '';
    campoProduto.value = '';
    selecionarProduto(null);
    faixaEdicao.hidden = true;
    tituloPedido.textContent = 'Pedido';
    botaoFinalizar.textContent = 'Registrar venda';
    acoesEdicao.hidden = true;
    botaoCancelarPedido.hidden = true;
    mudouPedido();
    desenharPedidos();
  }

  function entrarEmEdicao(pedido) {
    if (!pedidoEmEdicao && itens.length &&
        !confirm('Há um pedido em andamento. Descartar os itens dele para editar este pedido?')) return;

    pedidoEmEdicao = pedido;
    itens = pedido.itens.map((i) => ({
      produto_id: i.produto_id,
      nome: i.produto ? i.produto.nome : 'Produto',
      quantidade: i.quantidade,
      valor_unitario: Number(i.valor_unitario)
    }));
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* ignora */ }

    campoRecebido.value = '';
    campoProduto.value = '';
    selecionarProduto(null);
    faixaEdicao.textContent = 'Editando o pedido #' + pedido.id + ' de ' + formatoData.format(new Date(pedido.criado_em)) +
      (perfil.admin && pedido.vendedor ? ' (' + pedido.vendedor.nome + ')' : '') + '.';
    faixaEdicao.hidden = false;
    tituloPedido.textContent = 'Pedido #' + pedido.id;
    botaoFinalizar.textContent = 'Salvar alterações';
    acoesEdicao.hidden = false;
    botaoCancelarPedido.hidden = false;
    mudouPedido();
    desenharPedidos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  botaoDescartar.addEventListener('click', voltarParaPedidoNovo);

  botaoLimpar.addEventListener('click', () => {
    if (!confirm('Tirar todos os itens deste pedido?')) return;
    voltarParaPedidoNovo();
  });

  botaoCancelarPedido.addEventListener('click', async () => {
    if (!pedidoEmEdicao) return;
    if (!confirm('Cancelar o pedido #' + pedidoEmEdicao.id + '? Os produtos voltam para o estoque e a venda some do relatório.')) return;
    try {
      await Api.cancelarPedido(pedidoEmEdicao.id);
      avisar('Pedido #' + pedidoEmEdicao.id + ' cancelado.', 'ok');
      voltarParaPedidoNovo();
      await Promise.all([carregarProdutos(), carregarPedidos()]);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  });

  // ---------- Lista de pedidos ----------

  async function carregarPedidos() {
    try {
      pedidos = await Api.listarPedidos();
    } catch (erro) {
      listaPedidos.innerHTML = '<li class="vazio">Não foi possível carregar os pedidos.</li>';
      avisar(erro.message, 'erro');
      return;
    }
    desenharPedidos();
  }

  function desenharPedidos() {
    if (!pedidos.length) {
      listaPedidos.innerHTML = '<li class="vazio">Nenhum pedido registrado ainda.</li>';
      return;
    }
    listaPedidos.innerHTML = pedidos.map((pe) => {
      const total = pe.itens.reduce((s, i) => s + Number(i.valor_total), 0);
      const resumo = pe.itens.map((i) => i.quantidade + '× ' + (i.produto ? i.produto.nome : 'Produto')).join(', ');
      const editado = new Date(pe.atualizado_em) - new Date(pe.criado_em) > 60 * 1000;
      const vendedor = perfil.admin ? ' · ' + (pe.vendedor ? pe.vendedor.nome : 'sem vendedor') : '';
      const atual = pedidoEmEdicao && pedidoEmEdicao.id === pe.id ? ' editando' : '';
      return '<li><button type="button" class="item-produto item-pedido-salvo' + atual + '" data-id="' + pe.id + '">' +
        '<span><span class="nome">#' + pe.id + ' · ' + formatoData.format(new Date(pe.criado_em)) +
          escaparHtml(vendedor) + (editado ? ' <span class="etiqueta">editado</span>' : '') + '</span>' +
        '<span class="estoque">' + escaparHtml(resumo) + '</span></span>' +
        '<span class="preco">' + formatarDinheiro(total) + '</span>' +
        '</button></li>';
    }).join('');
  }

  listaPedidos.addEventListener('click', (evento) => {
    const botao = evento.target.closest('.item-pedido-salvo');
    if (!botao) return;
    const pedido = pedidos.find((pe) => String(pe.id) === botao.dataset.id);
    if (pedido) entrarEmEdicao(pedido);
  });

  // ---------- Início ----------

  iniciarPagina().then(async (p) => {
    perfil = p;
    tituloPedidos.textContent = perfil.admin ? 'Pedidos recentes' : 'Meus pedidos';
    await carregarProdutos();
    restaurarRascunho();
    mudouPedido();
    carregarPedidos();
  });
})();
