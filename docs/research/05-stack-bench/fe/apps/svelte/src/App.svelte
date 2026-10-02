<script>
  import { flushSync } from 'svelte'
  import { makeData, install, CSS } from '../../../shared/harness.js'
  let rows = $state([])
  let selected = $state(-1)
  let win = $state({ on: false, start: 0 })
  const view = $derived(win.on ? rows.slice(win.start, win.start + 60) : rows)
  const raw = {
    create(n) { rows = makeData(n) }, clear() { rows = [] },
    update10th() { for (let i = 0; i < rows.length; i += 10) rows[i].text += ' !!!' },
    select(i) { selected = rows[i].id },
    swap() { const t = rows[1]; rows[1] = rows[998]; rows[998] = t },
    remove(i) { rows.splice(i, 1) }, append(n) { rows.push(...makeData(n)) },
    addComment(i) { rows[i].count++ },
    virt(on) { win.on = on }, scrollTo(s) { win.start = s },
  }
  const ops = {}; for (const k in raw) ops[k] = (...a) => { raw[k](...a); flushSync() }
  install('svelte5', ops)
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
</script>
{#each view as row (row.id)}
  <div class="blk" class:sel={row.id === selected} data-id={row.id}><span class="g">{row.id}</span><div class="body">{row.text}</div><button class="c">{row.count}</button></div>
{/each}
