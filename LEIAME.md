# ZiisTec

Vite + React + Supabase. Fase 1 (autenticação, empresa, membresia, assinatura)
já usa o Supabase real. Os demais módulos ainda estão em memória e abrem vazios.

## Publicar na Vercel

1. **Importar** — em vercel.com, `Add New… → Project` e aponte para o
   repositório com este código. A Vercel detecta Vite sozinha (o `vercel.json`
   já define build, saída e o redirecionamento de rotas para `index.html`).
2. **Adicionar `VITE_SUPABASE_URL`** — em `Environment Variables`, com a URL do
   projeto Supabase (Project Settings → API).
3. **Adicionar `VITE_SUPABASE_ANON_KEY`** — a chave *publishable/anon* da mesma
   tela. Nunca a `service_role`.
4. **Deploy.** Ao terminar, a Vercel devolve a URL do app.

Sem as duas variáveis o app abre avisando "Configuração pendente" — ele não
quebra, mas também não conecta.

## Depois do primeiro deploy

No Supabase, em `Authentication → URL Configuration`, coloque a URL da Vercel em
**Site URL** e também em **Redirect URLs**. É isso que faz o link de recuperação
de senha e, futuramente, o login com Google voltarem para o app.

O Google OAuth ainda não foi ativado — ele depende dessa URL final.

## Rodar localmente (opcional)

    npm install
    cp .env.example .env   # preencha as duas variáveis
    npm run dev

## Validar a Fase 1 contra o Supabase

    node scripts/validar-fase1.mjs seu@email.com suasenha123

Com convite de técnico:

    node scripts/validar-fase1.mjs owner@email.com senha123 tecnico@email.com senha123

## Banco

`supabase/` traz as duas migrations já aplicadas, apenas para referência.
Não precisam ser executadas de novo.
