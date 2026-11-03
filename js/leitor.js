// Leitor de código de barras pela câmera do celular.
// Android (Chrome): usa o leitor embutido do navegador (BarcodeDetector).
// iPhone e demais: carrega a biblioteca ZXing (js/vendor) só quando precisa.
//
// Uso: const codigo = await LeitorCodigo.ler();  // texto lido, ou null se cancelar
const LeitorCodigo = (function () {
  const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
  const CAMINHO_ZXING = 'js/vendor/zxing-browser-0.2.1.min.js';

  let zxingCarregando = null;

  function carregarZXing() {
    if (!zxingCarregando) {
      zxingCarregando = new Promise((resolver, rejeitar) => {
        const script = document.createElement('script');
        script.src = CAMINHO_ZXING;
        script.onload = () => resolver(window.ZXingBrowser);
        script.onerror = () => {
          zxingCarregando = null;
          rejeitar(new Error('Não foi possível carregar o leitor. Verifique a internet.'));
        };
        document.head.appendChild(script);
      });
    }
    return zxingCarregando;
  }

  async function detectorNativo() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const suportados = await window.BarcodeDetector.getSupportedFormats();
      const formatos = FORMATOS.filter((f) => suportados.includes(f));
      return formatos.length ? new window.BarcodeDetector({ formats: formatos }) : null;
    } catch {
      return null;
    }
  }

  function mensagemDeErro(erro) {
    if (!window.isSecureContext) return 'A câmera só funciona com o site em https://.';
    if (erro && erro.name === 'NotAllowedError') {
      return 'Permita o uso da câmera para ler o código (nas configurações do navegador).';
    }
    if (erro && (erro.name === 'NotFoundError' || erro.name === 'OverconstrainedError')) {
      return 'Nenhuma câmera encontrada neste aparelho.';
    }
    if (erro && erro.name === 'NotReadableError') return 'A câmera está sendo usada por outro aplicativo.';
    return (erro && erro.message) || 'Não foi possível abrir a câmera.';
  }

  function criarTela() {
    const tela = document.createElement('div');
    tela.className = 'leitor';
    tela.setAttribute('role', 'dialog');
    tela.setAttribute('aria-label', 'Ler código de barras');
    tela.innerHTML =
      '<video class="leitor-video" playsinline muted autoplay></video>' +
      '<div class="leitor-mira" aria-hidden="true"></div>' +
      '<p class="leitor-texto">Aponte a câmera para o código de barras</p>' +
      '<button type="button" class="botao secundario leitor-cancelar">Cancelar</button>';
    document.body.appendChild(tela);
    document.body.classList.add('leitor-aberto');
    return tela;
  }

  function ler() {
    return new Promise((resolver, rejeitar) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        rejeitar(new Error(mensagemDeErro(null)));
        return;
      }

      const tela = criarTela();
      const video = tela.querySelector('video');
      let encerrado = false;
      let fluxo = null;      // câmera aberta por nós (leitor nativo)
      let controles = null;  // câmera aberta pela ZXing
      let temporizador = null;

      function encerrar(codigo, erro) {
        if (encerrado) return;
        encerrado = true;
        clearTimeout(temporizador);
        if (controles) controles.stop();
        if (fluxo) fluxo.getTracks().forEach((t) => t.stop());
        tela.remove();
        document.body.classList.remove('leitor-aberto');
        if (erro) {
          rejeitar(new Error(mensagemDeErro(erro)));
          return;
        }
        if (codigo && navigator.vibrate) navigator.vibrate(80);
        resolver(codigo ? String(codigo).trim() : null);
      }

      tela.querySelector('.leitor-cancelar').addEventListener('click', () => encerrar(null));

      const camera = { video: { facingMode: { ideal: 'environment' } }, audio: false };

      detectorNativo().then(async (detector) => {
        if (encerrado) return;
        if (detector) {
          fluxo = await navigator.mediaDevices.getUserMedia(camera);
          if (encerrado) { fluxo.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = fluxo;
          await video.play().catch(() => {});
          const procurar = async () => {
            if (encerrado) return;
            try {
              const achados = await detector.detect(video);
              if (achados.length) return encerrar(achados[0].rawValue);
            } catch { /* quadro ainda não pronto: tenta de novo */ }
            temporizador = setTimeout(procurar, 150);
          };
          procurar();
        } else {
          const ZXing = await carregarZXing();
          if (encerrado) return;
          const leitor = new ZXing.BrowserMultiFormatReader();
          controles = await leitor.decodeFromConstraints(camera, video, (resultado) => {
            if (resultado) encerrar(resultado.getText());
          });
          if (encerrado) controles.stop();
        }
      }).catch((erro) => encerrar(null, erro));
    });
  }

  return { ler };
})();
