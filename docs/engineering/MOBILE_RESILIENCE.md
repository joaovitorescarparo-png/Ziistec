# ZiisTec — resiliência mobile e rascunho (Bloco 7)

Escopo: evitar perda silenciosa de trabalho no celular sem transformar o app em offline-first. Nada é salvo no banco sem o usuário tocar em salvar.

## Fechar modal: Esc, Voltar e salvamento

- Fundo, X, Esc e Voltar (botão ou gesto do Android, Voltar do navegador) seguem o mesmo fluxo, `useModalDismiss` sobre o `useDiscardGuard` do Bloco 6:
  - sem alteração, o modal fecha;
  - com alteração, aparece "Continuar editando" / "Descartar";
  - com save em andamento (`busy`), nada fecha o modal.
- Cada modal aberto ganha uma entrada de histórico, na mesma URL (`src/lib/modalStack.js`). O primeiro Voltar fecha o modal em vez de sair da tela.
  - Fechar por X, fundo ou salvar remove essa entrada com um único `history.back()`.
  - O `popstate` desse back é ignorado.
  - Só há novo `pushState` quando o modal decide continuar aberto: alteração, aviso aberto ou salvando. Assim não há loop.
- Esc e Voltar valem só para o modal do topo. O Esc é ignorado quando o foco está em outro painel, como o Assistente.
- Se outra navegação empilhou histórico depois do modal (ex.: o Assistente abriu um registro), fechar o modal não volta o histórico. Pode sobrar uma entrada inerte, que é consumida por um Voltar a mais.
- Telas que não são modal (editor de orçamento, memória da OS) continuam com o guard do Bloco 6. O Voltar do navegador nelas segue o comportamento normal.

## Limitações reais da plataforma

- **iOS/Safari:**
  - não é possível impedir o fechamento da aba, nem o recarregar ou o encerramento do app pelo sistema;
  - `beforeunload` não mostra confirmação no iOS;
  - `pagehide` e `visibilitychange` (hidden) disparam, mas só permitem gravar algo rapidamente; não permitem perguntar.
- **Desktop e Android (Chrome):** `beforeunload` mostra a confirmação do próprio navegador ao recarregar ou fechar com formulário alterado. O texto é do navegador e não pode ser personalizado.
- **Encerramento pelo sistema** (aba em segundo plano descartada):
  - o estado do React se perde;
  - o único recurso é o rascunho abaixo, que vale para a mesma aba;
  - num app instalado na tela inicial (PWA) encerrado por completo, o `sessionStorage` pode não sobreviver, e o rascunho se perde junto. É uma limitação conhecida, aceita para não gravar dados em armazenamento persistente.

## Rascunho mínimo (`src/lib/formDrafts.js`, `src/hooks/useFormDraft.js`)

- **Onde:**
  - **Novo cliente:** só cadastro novo; edição não guarda rascunho.
  - **Nova OS:** só no modo real.
  - Orçamento, lançamento, compra e finalização **não** guardam rascunho, porque carregam preço, custo, financeiro ou fotos.
- **Armazenamento:**
  - `sessionStorage`: só esta aba, apagado ao fechar a aba;
  - TTL de 2 horas;
  - formato versionado (`v1`); versão incompatível é descartada.
- **Isolamento:**
  - a chave é `zt:draft:v1:<company_id>:<user_id>:<form>`;
  - o conteúdo repete usuário, empresa e formulário, e é validado contra a sessão antes de restaurar;
  - entrar com outro usuário ou outra empresa apaga os rascunhos de outro escopo;
  - sair da conta apaga todos.
- **Dados:**
  - allowlist por formulário, só texto operacional:
    - cliente: tipo, nome, fantasia, responsável, telefone, WhatsApp, endereço, observação;
    - OS: cliente, orçamento vinculado, local, descrição, data/hora, responsável, observação e o `requestId` da tentativa de save dessa mesma OS (salvar de novo não duplica);
  - ficam fora: CPF/CNPJ, itens com preço ou custo, margens, coordenadas, arquivos, fotos e blobs, ids de registro existente, tokens e qualquer campo não listado;
  - o conteúdo é sanitizado de novo na leitura.
- **Ciclo de vida:**
  - restaura ao abrir o formulário, com aviso e "Descartar rascunho";
  - grava enquanto há alteração e em `pagehide`/`visibilitychange`;
  - apaga ao fechar o formulário por qualquer caminho (salvar, descartar, cancelar, navegar).
  - Só sobrevive se a página morrer com o formulário aberto.

## Estado da OS depois de trocar status/agenda

`atualizarOSDB` relê a OS por `fromWorkOrder`, que vem sem relato, histórico, checklist, fotos, retornos e materiais registrados (esses chegam pela hidratação). `mesclarOSRelida` preserva esses complementos ao iniciar, agendar, desagendar ou salvar a OS. Antes, eles sumiam do detalhe até recarregar.
