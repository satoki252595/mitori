import { makeData, install, CSS } from '../../../shared/harness.js'
const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
const app = document.getElementById('app')
let rows = [], selected = -1
const rowHTML = (r) => `<div class="blk${r.id === selected ? ' sel' : ''}" data-id="${r.id}"><span class="g">${r.id}</span><div class="body">${r.text}</div><button class="c">${r.count}</button></div>`
const render = () => { app.innerHTML = rows.map(rowHTML).join('') }
install('vanilla-innerHTML', {
  create(n) { rows = makeData(n); render() }, clear() { rows = []; render() },
  update10th() { for (let i = 0; i < rows.length; i += 10) rows[i] = { ...rows[i], text: rows[i].text + ' !!!' }; render() },
  select(i) { selected = rows[i].id; render() }, swap() { const t = rows[1]; rows[1] = rows[998]; rows[998] = t; render() },
  remove(i) { rows.splice(i, 1); render() }, append(n) { rows = rows.concat(makeData(n)); render() },
  addComment(i) { rows[i] = { ...rows[i], count: rows[i].count + 1 }; render() },
})
