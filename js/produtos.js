// Tela: Cadastro de Produto (cadastrar, editar e excluir)
(function () {
  const form = document.getElementById('form-produto');
  const tituloForm = document.getElementById('titulo-form');
  const campoNome = document.getElementById('nome');
  const campoEstoque = document.getElementById('estoque');
  const campoValor = document.getElementById('valor-venda');
  const botaoSalvar = document.getElementById('btn-salvar');
  const botaoCancelar = document.getElementById('btn-cancelar');
  const botaoExcluir = document.getElementById('btn-excluir');
  const lista = document.getElementById('lista-produtos');
  const contagem = document.getElementById('contagem');

  let produtos = [];
  let emEdicao = null; // produto sendo editado (null = cadastrando um novo)

  async function carregarProdutos() {
    try {
      produtos = await Api.listarProdutos();
    } catch (erro) {
      lista.innerHTML = '<li class="vazio">Não foi possível carregar os produtos.</li>';
      avisar(erro.message, 'erro');
      return;
    }
    desenharLista();
  }

  function desenharLista() {
    contagem.textContent = produtos.length ? '(' + produtos.length + ')' : '';
    if (!produtos.length) {
      lista.innerHTML = '<li class="vazio">Nenhum produto cadastrado ainda.</li>';
      return;
    }
    lista.innerHTML = produtos.map((p) => {
      const textoEstoque = p.estoque > 0 ? 'Estoque: ' + p.estoque : 'Sem estoque';
      const editando = emEdicao && emEdicao.id === p.id ? ' editando' : '';
      return '<li><button type="button" class="item-produto' + editando + '" data-id="' + p.id + '">' +
        '<span><span class="nome">' + escaparHtml(p.nome) + '</span>' +
        '<span class="estoque' + (p.estoque > 0 ? '' : ' zerado') + '">' + textoEstoque + '</span></span>' +
        '<span class="preco">' + formatarDinheiro(p.valor_venda) + '</span>' +
        '</button></li>';
    }).join('');
  }

  function modoNovo() {
    emEdicao = null;
    form.reset();
    tituloForm.textContent = 'Novo produto';
    botaoSalvar.textContent = 'Cadastrar produto';
    botaoCancelar.hidden = true;
    botaoExcluir.hidden = true;
    limparErros();
    desenharLista();
  }

  function modoEdicao(produto) {
    emEdicao = produto;
    campoNome.value = produto.nome;
    campoEstoque.value = produto.estoque;
    campoValor.value = valorParaCampo(produto.valor_venda);
    tituloForm.textContent = 'Editar produto';
    botaoSalvar.textContent = 'Salvar alterações';
    botaoCancelar.hidden = false;
    botaoExcluir.hidden = false;
    limparErros();
    desenharLista();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function limparErros() {
    [campoNome, campoEstoque, campoValor].forEach((c) => c.removeAttribute('aria-invalid'));
  }

  function erroNoCampo(campo, mensagem) {
    campo.setAttribute('aria-invalid', 'true');
    avisar(mensagem, 'erro');
    campo.focus();
  }

  lista.addEventListener('click', (evento) => {
    const item = evento.target.closest('.item-produto');
    if (!item) return;
    const produto = produtos.find((p) => String(p.id) === item.dataset.id);
    if (produto) modoEdicao(produto);
  });

  [campoNome, campoEstoque, campoValor].forEach((c) =>
    c.addEventListener('input', () => c.removeAttribute('aria-invalid')));

  botaoCancelar.addEventListener('click', modoNovo);

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const nome = campoNome.value.trim();
    const estoque = lerInteiro(campoEstoque.value, 0);
    const valor = lerDinheiro(campoValor.value);

    if (!nome) return erroNoCampo(campoNome, 'Digite o nome do produto.');
    if (!Number.isFinite(estoque)) return erroNoCampo(campoEstoque, 'Digite o estoque (número inteiro, 0 ou mais).');
    if (!Number.isFinite(valor)) return erroNoCampo(campoValor, 'Digite um valor válido, ex.: 12,50');

    const dados = { nome, estoque, valor_venda: valor };
    const eraNovo = !emEdicao;
    const textoOriginal = botaoSalvar.textContent;
    botaoSalvar.disabled = true;
    botaoSalvar.textContent = 'Salvando…';
    try {
      if (eraNovo) {
        await Api.criarProduto(dados);
        avisar('Produto cadastrado.', 'ok');
      } else {
        await Api.atualizarProduto(emEdicao.id, dados);
        avisar('Produto atualizado.', 'ok');
      }
      modoNovo();
      await carregarProdutos();
      if (eraNovo) campoNome.focus();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botaoSalvar.disabled = false;
      if (botaoSalvar.textContent === 'Salvando…') botaoSalvar.textContent = textoOriginal;
    }
  });

  botaoExcluir.addEventListener('click', async () => {
    if (!emEdicao) return;
    if (!confirm('Excluir "' + emEdicao.nome + '"? Essa ação não pode ser desfeita.')) return;
    try {
      await Api.excluirProduto(emEdicao.id);
      avisar('Produto excluído.', 'ok');
      modoNovo();
      await carregarProdutos();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  });

  iniciarPagina({ somenteAdmin: true }).then(carregarProdutos);
})();
