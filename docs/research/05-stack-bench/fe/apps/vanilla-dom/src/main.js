import { makeData, install, CSS } from '../../../shared/harness.js'
const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
const app = document.getElementById('app')
let rows = [], els = new Map(), selected = -1, all = [], win = false
const tpl = document.createElement('template'); tpl.innerHTML = '<div class="blk"><span class="g"></span><div class="body"></div><button class="c"></button></div>'
function mk(r) { const e = tpl.content.firstChild.cloneNode(true); e.dataset.id = r.id; e.children[0].textContent = r.id; e.children[1].textContent = r.text; e.children[2].textContent = r.count; return e }
function setRows(next) { rows = next; const frag = document.createDocumentFragment(); const newEls = new Map(); for (const r of rows) { let e = els.get(r.id); if (!e) e = mk(r); newEls.set(r.id, e); frag.append(e) } els = newEls; app.replaceChildren(frag) }
install('vanilla-dom', {
  create(n) { all = makeData(n); setRows(win ? all.slice(0, 60) : all) }, clear() { all = []; setRows([]) }, virt(on) { win = on; setRows(on ? all.slice(0, 60) : all) }, scrollTo(s) { setRows(all.slice(s, s + 60)) },
  update10th() { for (let i = 0; i < rows.length; i += 10) { rows[i].text += ' !!!'; els.get(rows[i].id).children[1].textContent = rows[i].text } },
  select(i) { const o = els.get(selected); o && o.classList.remove('sel'); selected = rows[i].id; els.get(selected).classList.add('sel') },
  swap() { const t = rows[1]; rows[1] = rows[998]; rows[998] = t; setRows(rows) },
  remove(i) { setRows(rows.filter((_, k) => k !== i)) }, append(n) { setRows(rows.concat(makeData(n))) },
  addComment(i) { rows[i].count++; els.get(rows[i].id).children[2].textContent = rows[i].count },
})
