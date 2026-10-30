// Tela: Login
(function () {
  const form = document.getElementById('form-login');
  const campoEmail = document.getElementById('email');
  const campoSenha = document.getElementById('senha');
  const botao = document.getElementById('btn-entrar');

  // Já está logado: vai direto para a venda.
  if (Api.sessao()) {
    location.replace('index.html');
    return;
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const email = campoEmail.value.trim();
    const senha = campoSenha.value;
    if (!email) {
      avisar('Digite o e-mail.', 'erro');
      campoEmail.focus();
      return;
    }
    if (!senha) {
      avisar('Digite a senha.', 'erro');
      campoSenha.focus();
      return;
    }

    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      await Api.entrar(email, senha);
      location.replace('index.html');
    } catch (erro) {
      avisar(erro.message, 'erro');
      campoSenha.select();
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
})();
