/** No application state or secrets enter this document. Its CSP also governs blob Workers. */
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

export const SANDBOX_HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head><body><script>
let worker = null, workerUrl = null, pending = new Map(), sequence = 0;
function close() {
  if (worker) worker.terminate();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  worker = null;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Controller terminated')); }
  pending.clear();
}
function init(source) {
  close();
  const tail = '\\nself.onmessage = async (event) => { const { id, observation, state } = event.data; try { const decision = await decide(observation, state); self.postMessage({id, decision}); } catch(error) { self.postMessage({id,error:String(error && error.message || error)}); } };';
  workerUrl = URL.createObjectURL(new Blob([source, tail], {type:'text/javascript'}));
  worker = new Worker(workerUrl, {type:'module'});
  worker.onmessage = (event) => {
    const task = pending.get(event.data && event.data.id);
    if (!task) return;
    pending.delete(event.data.id); clearTimeout(task.timer);
    if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.decision);
  };
  worker.onerror = (event) => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(event.message || 'Controller crashed')); } pending.clear(); };
  return true;
}
function decideStep(observation, state) {
  return new Promise((resolve,reject) => {
    if (!worker) return reject(new Error('Controller not initialized'));
    const id = ++sequence;
    // First decision includes module startup; every subsequent decision has a 100ms budget.
    const timeout = sequence === 1 ? 1000 : 100;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Controller decision timed out')); close(); }, timeout);
    pending.set(id,{resolve,reject,timer});
    worker.postMessage({id,observation,state});
  });
}
window.fleetSandbox = { init, decide:decideStep, close };
window.addEventListener('message', async (event) => {
  if (event.source !== parent || !event.data || event.data.channel !== 'fleetforge') return;
  const {id,method,args} = event.data;
  try { if (!['init','decide','close'].includes(method)) throw new Error('Unknown sandbox method'); const result = await window.fleetSandbox[method](...(args || [])); parent.postMessage({channel:'fleetforge',id,result},'*'); }
  catch(error) { parent.postMessage({channel:'fleetforge',id,error:String(error && error.message || error)},'*'); }
});
parent.postMessage({channel:'fleetforge',ready:true},'*');
</script></body></html>`;
