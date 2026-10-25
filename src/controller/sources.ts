/** Deliberately seeded fault: independent shortest paths cannot negotiate opposing traffic. */
export const GREEDY_SOURCE = `export function decide(observation, state) {
  const robots = observation.scenario.robots;
  const deltas = [[0,-1,'N'],[1,0,'E'],[0,1,'S'],[-1,0,'W']];
  const key = c => c.join(',');
  const walls = new Set(observation.scenario.blocked.concat(observation.activeBlocks).map(key));
  const moves = {}, destinations = {};
  for (const r of robots) {
    const from = observation.positions[r.id];
    const target = observation.carrying[r.id] ? r.dropoff : r.pickup;
    const queue = [{cell:from,first:'WAIT'}], seen = new Set([key(from)]);
    let action = 'WAIT';
    if (!observation.delivered[r.id]) for (let head=0;head<queue.length;head++) {
      const node = queue[head];
      if (key(node.cell) === key(target)) { action = node.first; break; }
      for (const [dx,dy,move] of deltas) {
        const c = [node.cell[0]+dx,node.cell[1]+dy], k = key(c);
        if(c[0]<0||c[1]<0||c[0]>=8||c[1]>=8||walls.has(k)||seen.has(k)) continue;
        seen.add(k);queue.push({cell:c,first:head===0?move:node.first});
      }
    }
    moves[r.id]=action;
    const d=deltas.find(x=>x[2]===action)||[0,0];destinations[r.id]=[from[0]+d[0],from[1]+d[1]];
  }
  const [a,b]=robots.map(r=>r.id);
  if(key(destinations[a])===key(destinations[b]) || (key(destinations[a])===key(observation.positions[b]) && key(destinations[b])===key(observation.positions[a]))) {
    moves[a]='WAIT';moves[b]='WAIT';
  }
  return {moves,state:null};
}`;

/** Local reference implementation: joint planning, independent of the trusted engine/verifier. */
export const COOPERATIVE_SOURCE = `export function decide(observation, memory) {
  const s=observation.scenario, robots=s.robots, ids=robots.map(r=>r.id);
  const signature=JSON.stringify(s);
  const wait=()=>({moves:{[ids[0]]:'WAIT',[ids[1]]:'WAIT'},state:null});
  if(memory && memory.signature===signature && memory.startTick+memory.cursor===observation.tick && memory.cursor<memory.plan.length) {
    const moves=memory.plan[memory.cursor];
    return {moves,state:{...memory,cursor:memory.cursor+1}};
  }
  const encode=c=>c[1]*8+c[0];
  const walls=new Set(s.blocked.map(encode));
  const eventCells=s.events.map(e=>encode(e.cell));
  const lastTick=Math.max(0,...s.events.map(e=>e.tick));
  const active=new Set(observation.activeBlocks.map(encode));
  let initialMask=0;
  eventCells.forEach((c,i)=>{if(active.has(c)) initialMask|=1<<i;});
  const progress=ids.map(id=>observation.delivered[id]?2:observation.carrying[id]?1:0);
  const pickup=robots.map(r=>encode(r.pickup)), dropoff=robots.map(r=>encode(r.dropoff));
  const offsets=[[-8,'N'],[1,'E'],[8,'S'],[-1,'W'],[0,'WAIT']];
  const choices=Array.from({length:64},(_,p)=>offsets.filter(([delta,move])=> {
    const next=p+delta;
    return next>=0&&next<64&&!walls.has(next)&&!(move==='E'&&p%8===7)&&!(move==='W'&&p%8===0);
  }).map(([delta,move])=>[p+delta,move]));
  // node: position A/B, order progress A/B, tick, active-event mask, parent, moves
  const nodes=[[encode(observation.positions[ids[0]]),encode(observation.positions[ids[1]]),progress[0],progress[1],observation.tick,initialMask,-1,null]];
  const key=n=>n.slice(0,4).join(',')+','+Math.min(n[4],lastTick)+','+n[5];
  const seen=new Set([key(nodes[0])]);
  let goal=-1;
  for(let head=0;head<nodes.length && head<50000;head++) {
    const n=nodes[head];
    if(n[2]===2&&n[3]===2){goal=head;break;}
    if(n[4]>=s.horizon) continue;
    for(const [a,ma] of choices[n[0]]) for(const [b,mb] of choices[n[1]]) {
      if(a===b||(a===n[1]&&b===n[0]))continue;
      if(eventCells.some((cell,i)=>(n[5]&(1<<i))&&(cell===a||cell===b)))continue;
      const p=[n[2],n[3]], positions=[a,b];
      for(let i=0;i<2;i++) {
        if(p[i]===0&&positions[i]===pickup[i])p[i]=1;
        if(p[i]===1&&positions[i]===dropoff[i])p[i]=2;
      }
      const tick=n[4]+1;
      let mask=n[5];
      s.events.forEach((e,i)=>{if(e.tick<=tick&&eventCells[i]!==a&&eventCells[i]!==b)mask|=1<<i;});
      const next=[a,b,p[0],p[1],tick,mask,head,{[ids[0]]:ma,[ids[1]]:mb}], k=key(next);
      if(seen.has(k))continue;
      seen.add(k);nodes.push(next);
    }
  }
  if(goal<0)return wait();
  const plan=[];
  while(nodes[goal][6]!==-1){plan.push(nodes[goal][7]);goal=nodes[goal][6];}
  plan.reverse();
  if(!plan.length)return wait();
  return {moves:plan[0],state:{signature,startTick:observation.tick,plan,cursor:1}};
}`;
