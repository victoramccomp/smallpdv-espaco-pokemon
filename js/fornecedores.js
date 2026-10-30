// Tela: Cadastro de Fornecedor (somente admin)
(function () {
  const form = document.getElementById('form-fornecedor');
  const tituloForm = document.getElementById('titulo-form');
  const campoNome = document.getElementById('nome');
  const botaoSalvar = document.getElementById('btn-salvar');
  const botaoCancelar = document.getElementById('btn-cancelar');
  const botaoExcluir = document.getElementById('btn-excluir');
  const lista = document.getElementById('lista-fornecedores');
  const contagem = document.getElementById('contagem');

  let fornecedores = [];
  let emEdicao = null; // fornecedor sendo editado (null = cadastrando um novo)

  async function carregarFornecedores() {
    try {
      fornecedores = await Api.listarFornecedores();
    } catch (erro) {
      lista.innerHTML = '<li class="vazio">Não foi possível carregar os fornecedores.</li>';
      avisar(erro.message, 'erro');
      return;
    }
    desenharLista();
  }

  function desenharLista() {
    contagem.textContent = fornecedores.length ? '(' + fornecedores.length + ')' : '';
    if (!fornecedores.length) {
      lista.innerHTML = '<li class="vazio">Nenhum fornecedor cadastrado ainda.</li>';
      return;
    }
    lista.innerHTML = fornecedores.map((f) => {
      const editando = emEdicao && emEdicao.id === f.id ? ' editando' : '';
      return '<li><button type="button" class="item-produto' + editando + '" data-id="' + f.id + '">' +
        '<span class="nome">' + escaparHtml(f.nome) + '</span>' +
        '</button></li>';
    }).join('');
  }

  function modoNovo() {
    emEdicao = null;
    form.reset();
    tituloForm.textContent = 'Novo fornecedor';
    botaoSalvar.textContent = 'Cadastrar fornecedor';
    botaoCancelar.hidden = true;
    botaoExcluir.hidden = true;
    campoNome.removeAttribute('aria-invalid');
    desenharLista();
  }

  function modoEdicao(fornecedor) {
    emEdicao = fornecedor;
    campoNome.value = fornecedor.nome;
    tituloForm.textContent = 'Editar fornecedor';
    botaoSalvar.textContent = 'Salvar alterações';
    botaoCancelar.hidden = false;
    botaoExcluir.hidden = false;
    campoNome.removeAttribute('aria-invalid');
    desenharLista();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  lista.addEventListener('click', (evento) => {
    const item = evento.target.closest('.item-produto');
    if (!item) return;
    const fornecedor = fornecedores.find((f) => String(f.id) === item.dataset.id);
    if (fornecedor) modoEdicao(fornecedor);
  });

  campoNome.addEventListener('input', () => campoNome.removeAttribute('aria-invalid'));
  botaoCancelar.addEventListener('click', modoNovo);

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const nome = campoNome.value.trim();
    if (!nome) {
      campoNome.setAttribute('aria-invalid', 'true');
      avisar('Digite o nome do fornecedor.', 'erro');
      campoNome.focus();
      return;
    }

    const eraNovo = !emEdicao;
    const textoOriginal = botaoSalvar.textContent;
    botaoSalvar.disabled = true;
    botaoSalvar.textContent = 'Salvando…';
    try {
      if (eraNovo) {
        await Api.criarFornecedor({ nome });
        avisar('Fornecedor cadastrado.', 'ok');
      } else {
        await Api.atualizarFornecedor(emEdicao.id, { nome });
        avisar('Fornecedor atualizado.', 'ok');
      }
      modoNovo();
      await carregarFornecedores();
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
      await Api.excluirFornecedor(emEdicao.id);
      avisar('Fornecedor excluído.', 'ok');
      modoNovo();
      await carregarFornecedores();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  });

  iniciarPagina({ somenteAdmin: true }).then(carregarFornecedores);
})();
