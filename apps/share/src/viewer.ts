/** Literal script: the CLI and Worker display the hash of exactly the same bytes. */
export const VIEWER_SCRIPT = `(async()=>{
const $=s=>document.querySelector(s), status=$('#status');
try {
 const id=document.body.dataset.id, origin=document.body.dataset.origin||location.origin;
 const fragment=new URLSearchParams(location.hash.slice(1));
 const keyText=fragment.get('key'), capability=fragment.get('comments');
 if(!/^[A-Za-z0-9_-]{43}$/.test(keyText||'')) throw Error('復号鍵のある共有リンクを開いてください。');
 const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 const encode=b=>btoa(Array.from(b,c=>String.fromCharCode(c)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const aes=await crypto.subtle.importKey('raw',decode(keyText),'AES-GCM',false,['encrypt','decrypt']);
 const aad=comment=>new TextEncoder().encode('mitori.snapshot/1:'+id+(comment?':comment':''));
 const decrypt=async(b,comment)=>new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12),additionalData:aad(comment)},aes,b.slice(12)));
 const fetchOk=async(path,options)=>{const r=await fetch(origin+path,options);if(!r.ok)throw Error('共有API: '+r.status);return r;};
 const response=await fetchOk('/api/snapshots/'+id);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length>5000000)throw Error('snapshot が大きすぎます。');
 const html=await decrypt(bytes,false), frame=$('iframe');
 frame.srcdoc=html;
 status.textContent='復号しました。リンクを持つ人は閲覧・コメントできます。鍵はブラウザ履歴・同期に残ります。';
 const refresh=async()=>{const list=await(await fetchOk('/api/snapshots/'+id+'/comments')).json();const ul=$('#comments');ul.replaceChildren();for(const c of list){const li=document.createElement('li');try{li.textContent=await decrypt(decode(c.ciphertext),true);}catch{li.textContent='復号できないコメント';}ul.append(li);}};
 await refresh();
 if(/^[A-Za-z0-9_-]{43}$/.test(capability||'')){
  const form=$('form');form.hidden=false;form.addEventListener('submit',async e=>{e.preventDefault();const text=$('textarea').value.trim();if(!text)return;const button=$('button');button.disabled=true;try{const nonce=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(true)},aes,new TextEncoder().encode(text)));const out=new Uint8Array(nonce.length+cipher.length);out.set(nonce);out.set(cipher,12);await fetchOk('/api/snapshots/'+id+'/comments',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+capability},body:JSON.stringify({ciphertext:encode(out)})});$('textarea').value='';await refresh();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
 }
}catch(e){status.textContent='開けませんでした: '+e.message;}
})();`;

export function viewerHtml(id: string, origin = "", exportHash = ""): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("invalid snapshot id");
  if (origin !== "" && !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin) && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    throw new Error("share origin must be HTTPS (loopback HTTP for local tests)");
  }
  if (exportHash !== "" && !/^[A-Za-z0-9+/]{43}=$/.test(exportHash)) throw new Error("invalid export script hash");
  // The SHA-256 hash for CSP is filled by the Worker or CLI, after hashing the literal script.
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mitori 共有</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-__VIEWER_HASH__' ${exportHash ? `'sha256-${exportHash}'` : ""}; style-src 'unsafe-inline'; connect-src ${origin || "'self'"}; frame-src 'self' about:; base-uri 'none'; form-action 'none'"><style>body{font:16px system-ui;margin:0;padding:1rem}iframe{width:100%;height:75vh;border:1px solid #aaa}textarea{width:100%;min-height:5em}li{white-space:pre-wrap;overflow-wrap:anywhere}</style><body data-id="${id}" data-origin="${origin}"><p id="status" role="status">復号中… 鍵を含むリンクはブラウザ履歴・同期に残ります。</p><iframe title="共有された設計書" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><h2>暗号化コメント</h2><ul id="comments"></ul><form hidden><label>コメント<textarea maxlength="4000" required></textarea></label><button>送信</button></form><script>${VIEWER_SCRIPT}</script></body></html>`;
}
