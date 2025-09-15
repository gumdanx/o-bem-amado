async function loadJSONL(url){
  const res = await fetch(url);
  const txt = await res.text();
  const out = [];
  for (const line of txt.split(/\r?\n/)){
    const s = line.trim(); if (!s) continue;
    try{ out.push(JSON.parse(s)); }catch{}
  }
  return out;
}
function tagNum(tags, prefix){
  if (!Array.isArray(tags)) return null;
  for (const t of tags){
    const m = (t||"").toString().match(new RegExp("^"+prefix+"(\\d+)$","i"));
    if (m) return Number(m[1]);
  }
  return null;
}
function escapeHTML(s){ return (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function italicizeParentheses(html){ return html.replace(/\((.+?)\)/g, '<em>($1)</em>'); }
// Algarismos romanos
function toRoman(num){
  if (num == null || isNaN(num)) return "";
  const map = [
    [1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],
    [100,"C"],[90,"XC"],[50,"L"],[40,"XL"],
    [10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]
  ];
  let n = Math.max(0, Math.floor(num)), out = "";
  for (const [v, s] of map){ while(n >= v){ out += s; n -= v; } }
  return out || "0";
}
function getUnitRoman(arr, k){
  const withRoman = arr.find(e => e.roman);
  return (withRoman && String(withRoman.roman).trim()) || toRoman(k);
}

// título da unidade: prioriza section {label:"Unidade", title:"..."}; depois qualquer section com title;
// por fim, usa o label (≠ "Ação") como fallback.
function getUnitTitle(arr){
  if (!Array.isArray(arr)) return "";
  const a = arr.find(e => e.type==="section" && /^unidade$/i.test(e.label||"") && (e.title||"").trim());
  if (a) return a.title.trim();
  const b = arr.find(e => e.type==="section" && (e.title||"").trim());
  if (b) return b.title.trim();
  const c = arr.find(e => e.type==="section" && (e.label||"").trim() && !/^a[cç]a[̃~]?o$/i.test(e.label||""));
  if (c) return (c.label||"").trim();
  return "";
}

function normalize(e){
  const page = e.page ?? tagNum(e.tags, "p");
  const quadro = tagNum(e.tags, "q");
  const unidade = tagNum(e.tags, "u");
  return {
    id:e.id, type:e.type||"section",
    page, quadro, unidade,
    text:e.text||"", character:e.character||null,
    verb:Array.isArray(e.verb)?e.verb:(e.verb?[e.verb]:[]),
    obs:e.obs||"", label:e.label||"",
    title:e.title||"",          // << aqui
    roman:e.roman||null,        // << e aqui
    tags:e.tags||[]
  };
}

function buildGroups(entries, by="page"){
  const keyer = { page:e=>e.page, quadro:e=>e.quadro, unidade:e=>e.unidade }[by];
  const groups = new Map();
  for (const e of entries){
    const k = keyer(e);
    if (k==null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, arr] of groups){
    // comparadores por agrupamento
    const cmp = {
      page: (a, b) =>
        (a.__seq - b.__seq), // mantém exatamente a ordem do arquivo dentro da página

      quadro: (a, b) =>
        ((a.page ?? 1e9) - (b.page ?? 1e9)) || // primeiro por página
        (a.__seq - b.__seq),                   // depois, sequência original

      unidade: (a, b) =>
        ((a.page ?? 1e9) - (b.page ?? 1e9)) ||     // página
        ((a.quadro ?? 1e9) - (b.quadro ?? 1e9)) || // quadro
        (a.__seq - b.__seq)                         // sequência original
    }[by];

    arr.sort(cmp);
  }
  // garante que a CAPA (page 0) exista em todos os agrupamentos
  const cover = entries.filter(e => e.page === 0);
  if (cover.length && !groups.has(0)) {
    groups.set(0, cover);
  }
  // reordena com 0 primeiro
  return new Map([...groups.entries()].sort((a,b)=>a[0]-b[0]));
}

function sectionHeader(kind, num){
  const wrap = document.createElement("div");
  wrap.className = "section-sep";
  const line = document.createElement("div"); line.className = "line";
  const label = document.createElement("div"); label.className = "label";

  let txt;
  if (num === 0) {
    txt = "Capa";
  } else if (kind === "unidade") {
    txt = "Unidade " + toRoman(num);
  } else {
    const map = { page:"Página", quadro:"Quadro", unidade:"Unidade" };
    txt = `${map[kind]} ${num}`;
  }

  label.textContent = txt;
  wrap.append(line, label);
  return wrap;
}

// Capa: agrega personagens únicos e monta layout especial
function uniqueCharacters(all) {
  const set = new Set();
  for (const e of all) {
    const c = (e.character || "").trim();
    if (!c || c === "—" || c === "-") continue;
    set.add(c);
  }
  return [...set];
}

function countUnique(arr, key) {
  const set = new Set();
  arr.forEach(e => { if (e[key] != null) set.add(e[key]); });
  return set.size;
}

function stripAccents(s){
  return (s||"").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// pega "Ação" na página 0, aceitando com/sem acento, e usando o label OU o texto
function findAcaoCover(coverEntries){
  // 1) caso mais comum: label == "Ação" (seu caso)
  for (const e of coverEntries){
    const labelNorm = stripAccents((e.label||"")).toLowerCase().trim();
    if (labelNorm === "acao"){
      const t = (e.text||"").trim();
      return t ? `Ação: ${t}` : "Ação";
    }
  }
  // 2) fallback: texto/label que contenham "acao" no começo
  for (const e of coverEntries){
    const raw = (e.text || e.label || "");
    const norm = stripAccents(raw).toLowerCase().trim();
    if (/^acao(\b|:|-)/.test(norm)){
      // se não tiver dois pontos, adiciona prefixo
      return /acao\s*:/.test(norm) ? raw : `Ação: ${raw.replace(/^acao\b\s*/i,"")}`;
    }
  }
  return "";
}

function renderCover(container, allData, coverEntries) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "cover";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = (document.querySelector("h1")?.textContent || "O Bem-Amado").toUpperCase();

  const author = document.createElement("div");
  author.className = "author";
  author.textContent = "DE DIAS GOMES";

  const workline = document.createElement("div");
  workline.className = "workline";
  const nQuadros = countUnique(allData, "quadro");
  workline.textContent = `PEÇA EM ATO ÚNICO E ${nQuadros} QUADROS`.toUpperCase();

  const sect = document.createElement("div");
  sect.className = "section-title";
  sect.textContent = "PERSONAGENS:";

  const charsWrap = document.createElement("div");
  charsWrap.className = "characters";
  const chars = uniqueCharacters(allData).sort((a,b)=>a.localeCompare(b,'pt',{sensitivity:'base'}));
  (chars.length ? chars : ["—"]).forEach(c => {
    const line = document.createElement("div");
    line.className = "char";
    line.textContent = c;
    charsWrap.appendChild(line);
  });

  const acaoText = findAcaoCover(coverEntries);
  wrap.append(title, author, workline, sect, charsWrap);

  if (acaoText) {
    const acao = document.createElement("div");
    acao.className = "acao";
    acao.innerHTML = italicizeParentheses(escapeHTML(acaoText));
    wrap.appendChild(acao);
  }

  container.appendChild(wrap);
}

function createDialogue(e){
  const wrap = document.createElement("div");
  wrap.className = "item dialogue";
  const det = document.createElement("details");
  const sum = document.createElement("summary");
  sum.innerHTML = `<span class="character">${e.character ?? "—"}</span><span class="text">${italicizeParentheses(escapeHTML(e.text))}</span>`;
  const payload = document.createElement("div");
  payload.className = "payload";
  const verbs = (e.verb||[]).filter(Boolean);
  let inner = "";
  if (verbs.length){ inner += `<div><span class="italic">Verbo:</span> <strong>${verbs.join(", ")}</strong></div>`; }
  if (e.obs){ inner += `<div class="italic">${italicizeParentheses(escapeHTML(e.obs))}</div>`; }
  payload.innerHTML = inner || `<div class="italic">Sem observações.</div>`;
  det.append(sum, payload);
  det.addEventListener("toggle", ()=>{ wrap.classList.toggle("selected", det.open); });
  wrap.append(det);
  wrap.dataset.print = JSON.stringify({ type:"dialogue", character:e.character||"—", verb:verbs.join(", "), text:e.text||"" });
  return wrap;
}
function createRubrica(e){
  const wrap = document.createElement("div");
  wrap.className = "item rubrica";
  const t = italicizeParentheses(escapeHTML(e.text||e.label||""));
  wrap.innerHTML = `<div class="rubrica">${t}</div>`;
  return wrap;
}
const createStage = createRubrica;
const createAction = createRubrica;
function createSection(e){
  const wrap = document.createElement("div");
  wrap.className = "item section";
  const t = italicizeParentheses(escapeHTML(e.text||""));
  wrap.innerHTML = t;
  return wrap;
}

function renderContent(container, arr, kind, groupKey, query=""){
  // CAPA: grupo 0 sempre vira layout especial
  if (groupKey === 0) {
    container.innerHTML = "";
    container.appendChild(sectionHeader(kind, groupKey));
    renderCover(container, window.__ALL_DATA || [], arr);
    return;
  }

  container.innerHTML = "";
  container.appendChild(sectionHeader(kind, groupKey));

  // UNIDADE: rótulo em romano (usando JSONL.roman se houver) + título centralizado
  if (kind === "unidade"){
    // Atualiza o rótulo "Unidade I/II/..." usando getUnitRoman(arr, groupKey)
    const lab = container.querySelector(".section-sep .label");
    if (lab) lab.textContent = "Unidade " + getUnitRoman(arr, groupKey);

    // Insere o título da unidade logo abaixo do cabeçalho
    const unitTitle = getUnitTitle(arr);
    if (unitTitle){
      const t = document.createElement("div");
      t.className = "unit-title";
      t.textContent = unitTitle;
      container.appendChild(t);
    }
  }

  // Busca — agora inclui 'title' também
  const q = (query||"").trim().toLowerCase();
  const filtered = !q ? arr : arr.filter(e=>{
    const hay = [
      e.character||"", e.text||"",
      ...(Array.isArray(e.verb)?e.verb:[]),
      e.obs||"", e.label||"",
      e.title||"",                  // <= INCLUÍDO
      ...(e.tags||[])
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length){
    const d = document.createElement("div");
    d.className = "placeholder";
    d.textContent = "Nada encontrado para este filtro.";
    container.appendChild(d);
    return;
  }

  for (const e of filtered){
    let node;
    if (e.type === "dialogue") node = createDialogue(e);
    else if (e.type === "stage") node = createStage(e);
    else if (e.type === "action") node = createAction(e);
    else node = createSection(e);
    if (kind === "quadro" && e.quadro != null) node.classList.add("quadro-start");
    if (e.page === 0) node.classList.add("page-0");
    container.appendChild(node);
  }

  // linhas de impressão (diálogo)
  for (const node of container.querySelectorAll(".item")){
    const d = node.dataset.print ? JSON.parse(node.dataset.print) : null;
    if (d && d.type === "dialogue"){
      const line = document.createElement("div");
      line.className = "print-line";
      const verbs = d.verb ? ` : <span class="print-verb">${escapeHTML(d.verb)}</span>` : "";
      line.innerHTML = `<span class="print-character">${escapeHTML(d.character)}</span>${verbs} : ${escapeHTML(d.text)}`;
      line.style.display = "none";
      node.appendChild(line);
    }
  }
}

(async function init(){
  // antes: const data = (await loadJSONL("roteiro.jsonl")).map(normalize);
  const raw = await loadJSONL("roteiro.jsonl");
  const data = raw.map((e, i) => ({ ...normalize(e), __seq: i })); // <-- guarda ordem original
  window.__ALL_DATA = data; // se você já usa isso na capa, mantém
  const sidebar = document.getElementById("groups");
  const content = document.getElementById("content");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const hamburger = document.getElementById("hamburger");
  const togglesHeader = document.getElementById("toggles");
  const mobileToggles = document.getElementById("mobileToggles");
  const search = document.getElementById("search");
  const searchToggle = document.getElementById("searchToggle");

  function ensureMobileToggles(){
    if (!mobileToggles.querySelector(".toggle")){
      const clone = togglesHeader.cloneNode(true);
      clone.classList.remove("desktop-only");
      mobileToggles.innerHTML = "";
      mobileToggles.appendChild(clone);
      wireToggleButtons(clone.querySelectorAll(".toggle"));
    }
  }

  let kind = "page";
  let groups = new Map();
  let orderedKeys = [];
  let activeKey = null;

  function setKind(k){
    kind = k;
    groups = buildGroups(data, kind);
    orderedKeys = [...groups.keys()];
    renderGroups();
    activeKey = orderedKeys.includes(activeKey) ? activeKey : orderedKeys[0];
    activateGroup(activeKey);
  }

  function renderGroups(){
    ensureMobileToggles();
    // limpa
    const existing = sidebar.querySelectorAll(".group-item");
    existing.forEach(n => n.remove());

    for (const [k, arr] of groups){
      // conta apenas falas (dialogue)
      const dcount = arr.reduce((n, e) => n + (e.type === "dialogue" ? 1 : 0), 0);

      const item = document.createElement("div");
      item.className = "group-item";
      item.dataset.group = k;

      const labelTxt = (k === 0) ? "Capa" :
        (kind === 'page'   ? ('Página '  + k) :
         kind === 'quadro' ? ('Quadro '  + k) :
                  ('Unidade ' + getUnitRoman(arr, k)));
      // monta HTML: só mostra count se dcount > 0
      item.innerHTML = `<span class="group-name">${labelTxt}</span>` +
                      (dcount > 0 ? `<span class="group-count">${dcount}</span>` : "");

      item.addEventListener("click", () => activateGroup(k));
      sidebar.appendChild(item);
    }
  }

  function activateGroup(k){
    activeKey = k;
    sidebar.querySelectorAll(".group-item").forEach(n=>n.classList.toggle("active", Number(n.dataset.group)===k));
    renderContent(content, groups.get(k), kind, k, search.value);
  }

  function gotoPrev(){
    const idx = orderedKeys.indexOf(activeKey);
    if (idx>0) activateGroup(orderedKeys[idx-1]);
  }
  function gotoNext(){
    const idx = orderedKeys.indexOf(activeKey);
    if (idx>=0 && idx<orderedKeys.length-1) activateGroup(orderedKeys[idx+1]);
  }

  function wireToggleButtons(btns){
    btns.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".toggle").forEach(b=>b.setAttribute("aria-pressed","false"));
        btns.forEach(b=>b.setAttribute("aria-pressed","false"));
        document.querySelectorAll(`.toggle[data-kind="${btn.dataset.kind}"]`).forEach(b=>b.setAttribute("aria-pressed","true"));
        setKind(btn.dataset.kind);
      });
    });
  }
  wireToggleButtons(togglesHeader.querySelectorAll(".toggle"));

  prevBtn.addEventListener("click", gotoPrev);
  nextBtn.addEventListener("click", gotoNext);
  hamburger.addEventListener("click", ()=> sidebar.classList.toggle("open"));
  searchToggle.addEventListener("click", ()=>{
    const isMobile = window.innerWidth <= 900;
    if(!isMobile) return;
    const open = document.body.classList.toggle("search-open");
    if (open) {
      search.style.display = "block";
      setTimeout(() => search.focus(), 0);
    } else {
      search.blur();
      search.style.display = "none";
    }
  });
  search.addEventListener("input", ()=> activateGroup(activeKey));

  // Fechar busca com ESC no mobile
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("search-open")) {
      document.body.classList.remove("search-open");
      search.blur();
      search.style.display = "none";   // <- acrescentar
    }
  });

  // Se redimensionar para desktop enquanto a busca estiver aberta, normaliza
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && document.body.classList.contains("search-open")) {
      document.body.classList.remove("search-open");
      search.style.display = ""; // volta ao default do desktop
    }
  });
  setKind(kind);
})();