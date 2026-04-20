<script>
  let carrinho = {};
  let modoEdicao = false;
  let pratosCache = []; // Cache local para validar estoque antes de enviar
  let processandoPedido = false; // Trava contra cliques duplos (evita baixar estoque 2x)

  // --- CARREGAMENTO ---
  async function carregarMenu() {
    try {
      const res = await fetch("/api/v1/pratos/");
      pratosCache = await res.json();
      const grid = document.getElementById("grid-produtos");

      grid.innerHTML = pratosCache.map((p) => {
        const estoqueVal = p.estoque ?? 0;
        const precoVal = parseFloat(p.preco) || 0;
        const esgotado = estoqueVal <= 0;

        // Regra de Clique: Se esgotado e não for modo edição, o clique é anulado
        const acaoClique = modoEdicao 
          ? `abrirModalEdicao('${p.id}', '${p.nome}', ${precoVal}, ${estoqueVal})`
          : esgotado ? "" : `adicionarAoCarrinho('${p.id}', '${p.nome}', ${precoVal})`;

        return `
          <button onclick="${acaoClique}" 
                  ${esgotado && !modoEdicao ? 'disabled' : ''}
                  class="relative p-6 rounded-2xl shadow-sm border-2 transition-all text-left flex flex-col h-full group 
                  ${esgotado && !modoEdicao ? "bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed" : "bg-white"}
                  ${modoEdicao ? "border-amber-200 bg-amber-50/30" : !esgotado ? "border-transparent hover:border-blue-500 hover:shadow-xl" : ""}">
              
              ${modoEdicao ? '<span class="absolute top-2 right-2 bg-amber-500 text-white p-1 rounded-lg text-[8px] font-black uppercase tracking-tighter">Editar</span>' : ""}
              ${esgotado && !modoEdicao ? '<span class="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-lg text-[8px] font-black uppercase tracking-tighter">Esgotado</span>' : ""}
              
              <p class="font-black ${esgotado && !modoEdicao ? 'text-gray-400' : 'text-slate-800'} ${modoEdicao ? "text-amber-700" : "group-hover:text-blue-600"} text-lg leading-tight mb-2 uppercase tracking-tighter">${p.nome}</p>
              
              <div class="flex justify-between items-end mt-auto">
                  <p class="${esgotado && !modoEdicao ? 'text-gray-400' : 'text-blue-600'} font-black text-xl">R$ ${precoVal.toFixed(2)}</p>
                  <p class="text-[10px] font-bold ${estoqueVal > 0 ? "text-slate-300" : "text-red-500"} uppercase">Est: ${estoqueVal}</p>
              </div>
          </button>
        `;
      }).join("");
    } catch (e) {
      console.error("Erro ao carregar menu:", e);
    }
  }

  // --- CARRINHO ---
  function adicionarAoCarrinho(id, nome, preco) {
    const prato = pratosCache.find(p => p.id === id);
    if (!prato) return;

    const qtdNoCarrinho = carrinho[id] ? carrinho[id].qtd : 0;

    // BLOQUEIO FRONT-END: Não deixa adicionar se o estoque for insuficiente
    if (qtdNoCarrinho >= prato.estoque) {
      alert(`⚠️ Estoque insuficiente para ${nome}. Disponível: ${prato.estoque}`);
      return;
    }

    if (carrinho[id]) {
      carrinho[id].qtd += 1;
    } else {
      carrinho[id] = { nome, preco: parseFloat(preco), qtd: 1 };
      document.getElementById("carrinho-vazio")?.classList.add("hidden");
    }
    renderizarCarrinho();
  }

  function alterarQtd(id, delta) {
    if (!carrinho[id]) return;
    const prato = pratosCache.find(p => p.id === id);
    const novaQtd = carrinho[id].qtd + delta;

    if (delta > 0 && prato && novaQtd > prato.estoque) {
      alert("⚠️ Limite de estoque atingido!");
      return;
    }

    if (novaQtd <= 0) {
      delete carrinho[id];
      if (Object.keys(carrinho).length === 0) {
          document.getElementById("carrinho-vazio")?.classList.remove("hidden");
      }
    } else {
      carrinho[id].qtd = novaQtd;
    }
    renderizarCarrinho();
  }

  function renderizarCarrinho() {
    const lista = document.getElementById("lista-carrinho");
    const totalElem = document.getElementById("total-pedido");
    const chaves = Object.keys(carrinho);

    if (chaves.length === 0) {
      lista.innerHTML = '<p id="carrinho-vazio" class="text-slate-300 text-center mt-20 font-bold uppercase text-xs tracking-widest">Carrinho vazio</p>';
      totalElem.innerText = "R$ 0,00";
      return;
    }

    let total = 0;
    lista.innerHTML = chaves.map((id) => {
      const item = carrinho[id];
      total += item.preco * item.qtd;
      return `
        <div class="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div class="flex-1 pr-2">
                <p class="font-black text-xs text-slate-800 uppercase tracking-tighter">${item.nome}</p>
                <p class="text-[10px] font-bold text-blue-500">R$ ${item.preco.toFixed(2)}</p>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="alterarQtd('${id}', -1)" class="w-7 h-7 bg-white text-slate-600 rounded-lg flex items-center justify-center font-black shadow-sm">-</button>
                <span class="font-black text-sm w-4 text-center">${item.qtd}</span>
                <button onclick="alterarQtd('${id}', 1)" class="w-7 h-7 bg-white text-slate-600 rounded-lg flex items-center justify-center font-black shadow-sm">+</button>
            </div>
        </div>`;
    }).join("");
    totalElem.innerText = `R$ ${total.toFixed(2)}`;
  }

  // --- FINALIZAÇÃO ---
  async function finalizarPedido(tipo) {
    if (processandoPedido) return;

    const itens = Object.keys(carrinho).map((id) => ({
      prato_id: id,
      quantidade: carrinho[id].qtd,
    }));
    
    if (itens.length === 0) return alert("Carrinho vazio!");

    try {
      processandoPedido = true;
      const res = await fetch("/api/v1/pedidos/criar/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": "{{ csrf_token }}",
        },
        body: JSON.stringify({ tipo, itens }),
      });

      // AQUI ESTÁ A CORREÇÃO: Pegamos o JSON independente de ser erro ou sucesso
      const dados = await res.json();

      if (res.ok) {
        alert("✅ Pedido realizado!");
        carrinho = {};
        renderizarCarrinho();
        await carregarMenu(); // Atualiza estoque na tela
      } else {
        // EXIBE A MENSAGEM DO BACKEND: ValueError do Python vai aparecer aqui
        alert("❌ Erro: " + (dados.error || "Estoque insuficiente ou falha no servidor."));
        await carregarMenu(); // Sincroniza o estoque caso tenha acabado
      }
    } catch (e) {
      console.error(e);
      alert("Erro crítico de conexão.");
    } finally {
      processandoPedido = false;
    }
  }

  // Utilitários de Edição permanecem iguais, mas chamando carregarMenu()
  function toggleModoEdicao() {
    modoEdicao = !modoEdicao;
    const btn = document.getElementById("btn-modo-edicao");
    btn.classList.toggle("bg-amber-100");
    btn.classList.toggle("text-amber-700");
    btn.innerText = modoEdicao ? "Sair da Edição" : "Editar Cardápio";
    carregarMenu();
  }

  function abrirModalEdicao(id, nome, preco, estoque) {
    document.getElementById("edit-id").value = id;
    document.getElementById("edit-nome").value = nome;
    document.getElementById("edit-preco").value = preco;
    document.getElementById("edit-estoque").value = estoque;
    document.getElementById("modal-edicao").classList.remove("hidden");
  }

  function fecharModal() {
    document.getElementById("modal-edicao").classList.add("hidden");
  }

  async function salvarEdicao() {
    const id = document.getElementById("edit-id").value;
    const dados = {
      nome: document.getElementById("edit-nome").value,
      preco: document.getElementById("edit-preco").value,
      estoque: document.getElementById("edit-estoque").value,
    };
    try {
      const res = await fetch(`/api/v1/pratos/editar/${id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRFToken": "{{ csrf_token }}" },
        body: JSON.stringify(dados),
      });
      if (res.ok) {
        fecharModal();
        carregarMenu();
      }
    } catch (e) { console.error(e); }
  }

  window.onload = carregarMenu;
</script>