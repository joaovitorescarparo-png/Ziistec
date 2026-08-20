# ZiisTec

Plataforma para prestadores de serviços técnicos, com clientes, ordens de serviço, agenda, orçamentos, financeiro, compras, equipe, garantias e pós-venda, integrada ao Supabase e publicada pela Vercel.

## Estrutura

- `src/legacy/ZiisTecApp.jsx`: fonte operacional consolidada e versionada normalmente.
- `src/lib/`: camada de dados, segurança operacional, Storage, PDF e integrações.
- `src/screens/`: autenticação, onboarding e administração da plataforma.
- `supabase/`: migrations versionadas do banco, RLS e RPCs.
- `api/`: funções server-side da Vercel.

O build não aplica mais uma cadeia de patches sobre o frontend. Antes de `dev` e `build`, a integridade do código consolidado é validada por SHA-256. A migration de fundação histórica ainda é reconstruída dos seus blocos com verificação de hash.

## Dependências e CI

O projeto usa `package-lock.json` para instalações reproduzíveis. A CI executa verificação de integridade, auditoria de vulnerabilidades de nível alto/crítico, build de produção e CodeQL.

## Deploy

A branch `main` é integrada ao projeto ZiisTec na Vercel. Alterações aprovadas em `main` geram o deploy de produção automaticamente.
