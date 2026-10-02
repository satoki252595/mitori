import React, { useState, useEffect, memo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { makeData, install, CSS } from '../../../shared/harness.js'
const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
const Row = memo(({ row, sel }) => <div className={'blk' + (sel ? ' sel' : '')} data-id={row.id}><span className="g">{row.id}</span><div className="body">{row.text}</div><button className="c">{row.count}</button></div>)
function App() {
  const [rows, setRows] = useState([]); const [selected, setSelected] = useState(-1)
  const [win, setWin] = useState({ on: false, start: 0 })
  const ref = useRef(); ref.current = { rows }
  useEffect(() => {
    const F = (fn) => (...a) => flushSync(() => fn(...a))
    const ops = {
      create(n) { setRows(makeData(n)) }, clear() { setRows([]) },
      update10th() { setRows(r => r.map((x, i) => i % 10 === 0 ? { ...x, text: x.text + ' !!!' } : x)) },
      select(i) { setSelected(ref.current.rows[i].id) },
      swap() { setRows(r => { const a = r.slice(); const t = a[1]; a[1] = a[998]; a[998] = t; return a }) },
      remove(i) { setRows(r => r.filter((_, k) => k !== i)) }, append(n) { setRows(r => r.concat(makeData(n))) },
      virt(on) { setWin({ on, start: 0 }) }, scrollTo(s) { setWin({ on: true, start: s }) },
      addComment(i) { setRows(r => { const a = r.slice(); a[i] = { ...a[i], count: a[i].count + 1 }; return a }) },
    }
    for (const k in ops) ops[k] = F(ops[k])
    install('react19', ops)
  }, [])
  const view = win.on ? rows.slice(win.start, win.start + 60) : rows
  return <>{view.map(r => <Row key={r.id} row={r} sel={r.id === selected} />)}</>
}
createRoot(document.getElementById('app')).render(<App />)
