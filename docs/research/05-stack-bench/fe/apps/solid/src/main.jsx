import { createSignal, For, batch } from 'solid-js'
import { render } from 'solid-js/web'
import { makeData, install, CSS } from '../../../shared/harness.js'
const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
const mk = (r) => { const [text, setText] = createSignal(r.text); const [count, setCount] = createSignal(r.count); return { id: r.id, text, setText, count, setCount } }
const [rows, setRows] = createSignal([]); const [selected, setSelected] = createSignal(-1)
const [win, setWin] = createSignal({ on: false, start: 0 })
const view = () => win().on ? rows().slice(win().start, win().start + 60) : rows()
install('solid1.9', {
  create(n) { setRows(makeData(n).map(mk)) }, clear() { setRows([]) },
  update10th() { batch(() => { const r = rows(); for (let i = 0; i < r.length; i += 10) r[i].setText(r[i].text() + ' !!!') }) },
  select(i) { setSelected(rows()[i].id) },
  swap() { const r = rows().slice(); const t = r[1]; r[1] = r[998]; r[998] = t; setRows(r) },
  remove(i) { setRows(rows().filter((_, k) => k !== i)) }, append(n) { setRows(rows().concat(makeData(n).map(mk))) },
  addComment(i) { const r = rows()[i]; r.setCount(r.count() + 1) },
  virt(on) { setWin({ on, start: 0 }) }, scrollTo(s) { setWin({ on: true, start: s }) },
})
render(() => <For each={view()}>{(row) => <div class="blk" classList={{ sel: selected() === row.id }} data-id={row.id}><span class="g">{row.id}</span><div class="body">{row.text()}</div><button class="c">{row.count()}</button></div>}</For>, document.getElementById('app'))
