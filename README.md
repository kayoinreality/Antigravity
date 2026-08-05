# antigravity

Um canvas infinito para pensamentos. As notas flutuam no espaço, a busca
entende o que você digitou sem botão nenhum, notas sobre o mesmo assunto se
organizam em sistemas solares — e para apagar uma nota você a arremessa contra
a gravidade, dentro de um buraco negro.

Roda em **iOS, Android e navegador**, com sincronização entre eles.

---

## Por que foi reconstruído

A versão anterior montava uma view nativa por nota dentro de um container de
8000×8000. Com mil notas isso é cerca de cinco mil views nativas, todas vivas e
sendo medidas o tempo todo. Havia também duas stores divergentes, persistência
que reserializava o acervo inteiro a cada arraste, e nenhuma busca, backend ou
app web.

**Sobre a pergunta de RAM: o problema não era o React.** Era *como* o canvas
desenhava. Trocar de framework não conserta isso — o mesmo desenho em Flutter
teria o mesmo destino. O que muda é a técnica de renderização, e ela cabe
igualmente bem em TypeScript, o que permite compartilhar tudo com a web.

---

## Arquitetura

```
packages/core            TypeScript puro, zero dependência de plataforma
  model/                 Note, System, NoteLink, tipos de sync
  search/                parser de query, índice BM25, ranking compartilhado
  clustering/            TF-IDF, grafo k-NN mútuo, rotulagem de sistemas
  sync/                  SyncEngine local-first, regras de merge
  storage/               interface LocalStore (cada app implementa)
  theme/  text/  i18n/   tokens, normalização, pt-BR + en

packages/canvas-engine   cena agnóstica de renderer, funções puras 'worklet'
  camera · culling · lod · hit-test · orbit · blackhole

packages/supabase-client cliente tipado + adaptador remoto

apps/mobile              Expo SDK 57 + Skia + SQLite (FTS5)
apps/web                 Vite + React 19 + Canvas2D + IndexedDB
supabase/                migrations, RLS, RPCs de sync, testes SQL
scripts/                 harness de performance, runner de teste do banco
```

O que **não** pode divergir entre as plataformas mora em `packages/`: o
significado de uma query, a ordem dos resultados, o que forma um sistema, quem
vence um conflito de sync. Cada app fornece só o backend de desenho e a
persistência.

---

## Rodando

```bash
npm install

npm run dev:web       # http://localhost:5173
npm run dev:mobile    # Expo

npm test              # testes unitários (core + canvas-engine)
npm run test:db       # migrations + protocolo de sync contra Postgres
npm run seed          # harness de performance com 10.000 notas
```

Sync precisa de um `.env` — veja `.env.example`. **Sem ele os dois apps
funcionam normalmente**, apenas local-first, e o selo de status mostra "somente
neste aparelho".

Para o app web os testes end-to-end são Playwright:

```bash
cd apps/web && npx playwright test
```

---

## Buraco negro: apagar contra a gravidade

Segure uma nota e a arremesse para cima. O gesto arma quando **distância e
velocidade** acontecem juntas — mais de 12% da altura da tela, subindo a mais de
220 px/s. Distância sozinha não basta de propósito: arrastar devagar para o topo
do canvas é arrumar notas, não apagar. O gesto destrutivo tem que ser um gesto
que você quis fazer.

Armado, a singularidade materializa no topo: disco de acreção girando, anel de
lente gravitacional. Conforme a nota se aproxima ela é *espaguetificada* — se
alonga no eixo da atração, se comprime no perpendicular, drena a cor. Soltar
dentro do horizonte de eventos consome a nota; soltar fora devolve ela ao
lugar.

Nada é apagado de verdade: a exclusão grava uma lápide (`deletedAt`), o que faz
o desfazer e a propagação entre aparelhos usarem o mesmo mecanismo. Um aviso
oferece restaurar por 6 segundos, e a lápide só some do banco depois de 30 dias.

Todo o gesto roda na thread de UI, em worklets. Isso não é micro-otimização: o
gesto *é* a funcionalidade, e uma animação de exclusão engasgando porque a
thread JS está salvando a edição anterior destruiria a premissa.

---

## Busca: uma linha, nenhum botão

Não existe UI de filtro em lugar nenhum do app. Você digita uma linha e ela é
interpretada:

```
reunião semana passada #tcc      → texto + intervalo de datas + tag
projeto cor:azul fixadas         → texto + cor + notas fixadas
entregar até 30/04 @ana          → texto + limite de data + menção
"prazo final" sem link           → frase exata + notas sem conexões
```

Datas em português coloquial funcionam: `hoje`, `ontem`, `anteontem`,
`semana passada`, `últimos 7 dias`, `mês passado`, `em março`, `3 de março`,
`desde ontem`, `antes de junho`, `12/03`, `2024`. Em inglês também.

O que foi reconhecido aparece como **chips dispensáveis** abaixo do campo — é o
que torna uma linguagem implícita honesta em vez de mágica. Você continua tendo
digitado uma linha só, mas consegue ver o que o app entendeu, e dispensar um
chip edita o texto que você mesmo escreveu, sem estado escondido ao lado.

Nos resultados o canvas entra em *spotlight*: quem não casou recua para pontos
de luz, quem casou brilha, e a câmera enquadra todos os resultados de uma vez.

Por baixo, o mobile resolve o texto com FTS5 (`remove_diacritics 2`, por isso
"analise" acha "análise") e a web com um índice BM25 em memória. Os dois
chamam o mesmo `parseQuery` e o mesmo `rankResults`, então concordam sobre o que
a query significa e sobre a ordem.

---

## Sistemas solares

O app percebe quando várias notas falam do mesmo assunto e oferece organizá-las:

> ☉ 6 notas sobre "faculdade" — formar sistema?

Aceitando, elas entram em órbita em torno de uma estrela nomeada pelo termo que
distingue o grupo do resto do canvas. Os anéis são dimensionados a partir da
diagonal da nota, então a ausência de sobreposição sai da geometria em vez de
precisar de relaxamento físico. As notas mais centrais no assunto orbitam mais
perto. Puxar uma nota para além de 1,6× o raio da órbita a solta do sistema.

O agrupamento é **lexical e roda no aparelho**: TF-IDF, grafo k-NN mútuo,
componentes conexas. Offline, sem chave de API, sem mandar o texto das notas
para lugar nenhum. É mútuo e não unidirecional porque uma nota-hub vagamente
parecida com tudo encadeia todos os tópicos num componente só — a falha clássica
de k-NN.

A interface `SemanticProvider` é o ponto de troca para embeddings depois: hoje o
sistema erra em sinônimos ("faculdade" vs "universidade"), e trocar o provider
resolve isso sem tocar em nada acima dele.

---

## Números

Medidos com `npm run seed` (10.000 notas, canvas realista):

| | |
|---|---|
| Dados em memória | 10,6 MB |
| Culling por frame | 0,08 ms — 1% do orçamento a 120 Hz |
| Notas realmente desenhadas | 17 |
| Busca (texto) | 1,8–2,3 ms |
| Busca (só filtros) | ~13 ms |
| Agrupar 1.500 notas | 608 ms |

A memória escala com o *dado*, não com a contagem de views — que era o ponto.

O agrupamento continua superlinear (500/1.500/3.000/6.000 notas custam
160 ms/640 ms/2,1 s/9,9 s), então os dois apps agrupam apenas as **1.500 notas
mais recentes**. É o maior recorte que fica abaixo de um segundo, e é o escopo
certo de qualquer forma: uma sugestão é sobre o que você anda trabalhando.

---

## Como as decisões de renderização funcionam

**Mobile.** Uma view nativa, uma `SkPicture` por frame, montada na thread de UI
a partir da câmera e do conjunto visível. Duas armadilhas evitadas: a árvore
declarativa do Skia aloca um objeto JSI por nó, e o layout de texto domina tudo.
Por isso cada nota é gravada uma vez em `SkPicture` cacheada por nível de
detalhe, quando o *conteúdo* muda — mover uma nota não custa nada, e o pan
apenas reexecuta listas de comandos.

**Web.** Um `<canvas>`, uma chamada de desenho por frame. Notas nunca são nós do
DOM. O estado que muda a cada frame vive em refs, não em estado do React, senão
um pan a 120 Hz seria 120 renderizações por segundo de uma árvore que não produz
DOM nenhum.

**Nível de detalhe.** Abaixo de 0,35 de zoom uma nota vira um ponto de luz. É
mais barato de desenhar *e* é exatamente o céu estrelado que o canvas quer ser —
performance e estética resolvidas pela mesma decisão.

---

## Sync

Local-first de verdade: o banco no aparelho é a fonte da verdade, o servidor é
réplica. Tudo funciona offline e a fila drena ao reconectar. Um app de notas que
trava esperando a rede para mostrar as suas próprias notas é um app pior.

O merge é last-write-wins por linha, com o contador de revisão do servidor como
critério de desempate. Não é CRDT — seria a escolha certa para edição
colaborativa de um documento, mas aqui o conflito realista é "a mesma nota
editada no celular e no notebook offline", e LWW dá uma resposta previsível. O
custo, dito claramente: a edição do lado perdedor é descartada, não mesclada.

As duas RPCs (`sync_push`, `sync_pull`) existem porque a regra de merge precisa
morar num lugar só. Um upsert direto do cliente fica a uma corrida de distância
de deixar uma escrita antiga sobrescrever uma nova.

O app é **totalmente usável sem conta**. Ao entrar, as notas criadas
anonimamente são carimbadas com o seu usuário e enviadas.

---

## Verificação

O que foi testado executando de verdade, não só compilando:

| | |
|---|---|
| `packages/core` | 108 testes — gramática de datas pt-BR/en, ordem do ranking, determinismo do agrupamento, convergência de sync entre dois aparelhos |
| `packages/canvas-engine` | 43 testes — inclusive que os dois caminhos de culling devolvem conjuntos idênticos |
| Supabase | 27 asserções contra um Postgres real: round trip, LWW nos dois sentidos, lápides, isolamento entre usuários, RLS |
| `apps/web` | 17 testes Playwright em Chromium — busca, chips, o arraste lento que **não** apaga versus o arremesso que apaga, desfazer, formar sistema |
| `apps/mobile` | bundle Android (2019 módulos) e iOS (1931); 21 worklets confirmados transformados pelo Babel |

### O que ainda precisa ser conferido num aparelho

O renderer Skia nunca rodou num celular a partir daqui — não havia device no
ambiente. A arquitetura de `SkPicture` única é a resposta certa para o gargalo
de JSI, mas os números de FPS e RAM só se confirmam no seu aparelho:

- [ ] Dev build no Android e no iOS
- [ ] `npm run seed -- 10000 --out seed.json`, importar, e verificar pan/zoom a 60fps
- [ ] Anotar RAM no perfilador antes e depois
- [ ] Buraco negro no toque real: háptico, espaguetificação, desfazer
- [ ] Criar notas offline nos dois apps, reconectar, confirmar convergência

---

## Licença

MIT.
