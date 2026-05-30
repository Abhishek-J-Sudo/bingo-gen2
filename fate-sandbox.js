/* fate-sandbox.js — FATE villain canvas, wired to the live bingo game.
 *
 * Public API (window.FateSandbox):
 *   init(players, canvasEl)                          — set up for a player list
 *   queueShot(playerId, limbKey)                     — FATE walks + shoots a specific limb
 *   syncState(players, calledNumbers, dangerNumbers) — silent drop (no animation, for page load)
 *   reset()                                          — restore all figures, clear physics
 */
window.FateSandbox = (() => {
  'use strict';

  const LIMB_KEYS   = ['arm-l', 'arm-r', 'head', 'leg-l', 'leg-r'];
  const FATE_X      = 52;
  const PLAYER_START_X = 108;

  let Matter, engine, physRunner, floorBody;
  let canvas, ctx, W, H;
  let figs         = {};   // playerId → FlexFigure
  let fate         = null;
  let rowYs        = [];
  let bullets      = [], impacts = [], particles = [], popups = [];
  let shake        = 0, timeScale = 1.0;
  let shootQueue   = [], shootBusy = false, pendingTarget = null;
  let rafId        = null, lastTs  = 0;
  let running      = false;

  // ── Figure ────────────────────────────────────────────────────────────────
  function Figure(px, floorY, name, scale) {
    this.baseX      = px;
    this.floorY     = floorY;
    this.name       = name;
    this.scale      = scale || 1.0;
    this.t          = Math.random() * Math.PI * 2;
    this.vy = this.dy = 0;
    this.hitFlash   = null;
    this.dropped    = new Set();
    this.physBodies = {};
  }

  Figure.prototype.reset = function () {
    this.t = Math.random() * Math.PI * 2;
    this.vy = this.dy = 0;
    this.hitFlash = null;
    this.dropped.clear();
    this.physBodies = {};
  };

  Figure.prototype.react = function () {
    if (!this.dropped.has('leg-l') && !this.dropped.has('leg-r')) this.vy = -130;
  };

  Figure.prototype.update = function (dt) {
    this.t += dt;
    if (this.dy < 0 || this.vy !== 0) {
      this.vy += 520 * dt;
      this.dy += this.vy * dt;
      if (this.dy >= 0) { this.dy = 0; this.vy = 0; }
    }
    if (this.hitFlash) {
      this.hitFlash.elapsed += dt * 1000;
      if (this.hitFlash.elapsed >= this.hitFlash.duration) this.hitFlash = null;
    }
  };

  Figure.prototype.getPose = function () {
    const s  = this.scale, t = this.t;
    const sw = Math.sin(t * 0.7) * 2.5;
    const bx = this.baseX + sw;
    const by = this.floorY + this.dy;
    const as = Math.sin(t * 0.9) * 6 * s;
    const ls = Math.sin(t * 0.6) * 5 * s;
    return {
      torso:  { x1: bx,     y1: by-38*s, x2: bx,          y2: by-78*s },
      head:   { cx: bx,     cy: by-89*s, r: 10*s },
      'arm-l':{ x1: bx,     y1: by-65*s, x2: bx-18*s+as,  y2: by-48*s },
      'arm-r':{ x1: bx,     y1: by-65*s, x2: bx+18*s-as,  y2: by-48*s },
      'leg-l':{ x1: bx,     y1: by-38*s, x2: bx-12*s-ls,  y2: by },
      'leg-r':{ x1: bx,     y1: by-38*s, x2: bx+12*s+ls,  y2: by },
    };
  };

  Figure.prototype.dropLimb = function (key) {
    if (this.dropped.has(key)) return;
    this.dropped.add(key);
    const p = this.getPose(), s = this.scale;
    let body;
    const Bodies = Matter.Bodies, Body = Matter.Body;
    if (key === 'head') {
      body = Bodies.circle(p.head.cx, p.head.cy, p.head.r, { restitution:0.55, friction:0.4, frictionAir:0.01 });
      Body.setVelocity(body, { x:(Math.random()-0.5)*14, y:-14 });
    } else {
      const l = p[key];
      const cx = (l.x1+l.x2)/2, cy = (l.y1+l.y2)/2;
      const len = Math.hypot(l.x2-l.x1, l.y2-l.y1);
      const ang = Math.atan2(l.y2-l.y1, l.x2-l.x1);
      body = Bodies.rectangle(cx, cy, len, 5*s, { angle:ang, restitution:0.4, friction:0.3, frictionAir:0.008 });
      body.limbLength = len;
      Body.setVelocity(body, { x:(Math.random()-0.5)*18, y:-(8+Math.random()*10) });
      Body.setAngularVelocity(body, (Math.random()-0.5)*1.2);
    }
    this.physBodies[key] = body;
    Matter.World.add(engine.world, body);
  };

  Figure.prototype.draw = function (c) {
    const p     = this.getPose(), s = this.scale;
    const flash = this.hitFlash && (this.hitFlash.elapsed/this.hitFlash.duration) < 0.6;
    const ink   = flash ? '#e03030' : '#1a1a1a';
    const fill  = flash ? '#ffcccc' : '#f0ede4';
    c.save();
    c.strokeStyle = ink; c.lineWidth = 3*s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(p.torso.x1,p.torso.y1); c.lineTo(p.torso.x2,p.torso.y2); c.stroke();
    ['arm-l','arm-r','leg-l','leg-r'].forEach(k => {
      if (this.dropped.has(k)) return;
      c.beginPath(); c.moveTo(p[k].x1,p[k].y1); c.lineTo(p[k].x2,p[k].y2); c.stroke();
    });
    if (!this.dropped.has('head')) {
      c.beginPath(); c.arc(p.head.cx,p.head.cy,p.head.r,0,Math.PI*2);
      c.fillStyle=fill; c.fill(); c.stroke();
    }
    Object.entries(this.physBodies).forEach(([k,b]) => {
      c.save();
      if (k==='head') {
        c.beginPath(); c.arc(b.position.x,b.position.y,10*s,0,Math.PI*2);
        c.fillStyle='#f0ede4'; c.fill(); c.strokeStyle='#1a1a1a'; c.lineWidth=3*s; c.stroke();
      } else {
        const half=(b.limbLength||18)/2, cos=Math.cos(b.angle), sin=Math.sin(b.angle);
        c.beginPath();
        c.moveTo(b.position.x-cos*half,b.position.y-sin*half);
        c.lineTo(b.position.x+cos*half,b.position.y+sin*half);
        c.strokeStyle='#1a1a1a'; c.lineWidth=3*s; c.lineCap='round'; c.stroke();
      }
      c.restore();
    });
    c.font=`bold ${Math.round(9*s)}px Courier New`; c.fillStyle='#1a1a1a'; c.textAlign='center';
    c.fillText(this.name, this.baseX, this.floorY+14);
    c.restore();
  };

  // ── FlexFigure ────────────────────────────────────────────────────────────
  function FlexFigure(px, floorY, name, scale) {
    Figure.call(this, px, floorY, name, scale);
    this.bends = {
      torso:  { b:0, v:0, freq:0.5, amp:3,  phase:0.0 },
      'arm-l':{ b:0, v:0, freq:1.1, amp:6,  phase:1.2 },
      'arm-r':{ b:0, v:0, freq:0.9, amp:6,  phase:2.5 },
      'leg-l':{ b:0, v:0, freq:0.7, amp:5,  phase:0.6 },
      'leg-r':{ b:0, v:0, freq:0.7, amp:5,  phase:1.9 },
    };
    this.poses   = null;
    this.poseIdx = 0;
    this.poseT   = 0;
  }
  FlexFigure.prototype = Object.create(Figure.prototype);
  FlexFigure.prototype.constructor = FlexFigure;

  FlexFigure.prototype.reset = function () {
    Figure.prototype.reset.call(this);
    Object.values(this.bends).forEach(s => { s.b = 0; s.v = 0; });
    this.poseIdx = 0; this.poseT = 0;
  };

  FlexFigure.prototype.react = function () {
    Figure.prototype.react.call(this);
    Object.values(this.bends).forEach(s => { s.v += (Math.random()-0.5)*900; });
  };

  FlexFigure.prototype.update = function (dt) {
    Figure.prototype.update.call(this, dt);
    if (this.poses) {
      this.poseT += dt*1000;
      if (this.poseT >= this.poses[this.poseIdx].dur) {
        this.poseT -= this.poses[this.poseIdx].dur;
        this.poseIdx = (this.poseIdx+1) % this.poses.length;
      }
    }
    const stiffness=55, damping=4.5;
    Object.values(this.bends).forEach(s => {
      const target = Math.sin(this.t*s.freq+s.phase)*s.amp;
      s.v += (stiffness*(target-s.b) - damping*s.v)*dt;
      s.b += s.v*dt;
    });
  };

  FlexFigure.prototype.onHit = function () {
    Object.values(this.bends).forEach(s => { s.v += (Math.random()-0.5)*1200; });
  };

  function drawBezierLimb(c, x1, y1, x2, y2, bend) {
    const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)||1;
    const mx=(x1+x2)/2-(dy/len)*bend, my=(y1+y2)/2+(dx/len)*bend;
    c.beginPath(); c.moveTo(x1,y1); c.quadraticCurveTo(mx,my,x2,y2); c.stroke();
  }

  FlexFigure.prototype.draw = function (c) {
    const p     = this.getPose(), s = this.scale;
    const flash = this.hitFlash && (this.hitFlash.elapsed/this.hitFlash.duration)<0.6;
    const ink   = flash ? '#e03030' : '#1a1a1a';
    const fill  = flash ? '#ffcccc' : '#f0ede4';
    const bds   = this.bends;
    c.save();
    c.strokeStyle=ink; c.lineWidth=3*s; c.lineCap='round';
    drawBezierLimb(c, p.torso.x1,p.torso.y1,p.torso.x2,p.torso.y2, bds.torso.b);
    ['arm-l','arm-r','leg-l','leg-r'].forEach(k => {
      if (this.dropped.has(k)) return;
      drawBezierLimb(c, p[k].x1,p[k].y1,p[k].x2,p[k].y2, bds[k].b);
    });
    if (!this.dropped.has('head')) {
      c.beginPath(); c.arc(p.head.cx,p.head.cy,p.head.r,0,Math.PI*2);
      c.fillStyle=fill; c.fill(); c.stroke();
    }
    Object.entries(this.physBodies).forEach(([k,b]) => {
      c.save();
      if (k==='head') {
        c.beginPath(); c.arc(b.position.x,b.position.y,10*s,0,Math.PI*2);
        c.fillStyle='#f0ede4'; c.fill(); c.strokeStyle='#1a1a1a'; c.lineWidth=3*s; c.stroke();
      } else {
        const half=(b.limbLength||18)/2, cos=Math.cos(b.angle), sin=Math.sin(b.angle);
        c.beginPath();
        c.moveTo(b.position.x-cos*half,b.position.y-sin*half);
        c.lineTo(b.position.x+cos*half,b.position.y+sin*half);
        c.strokeStyle='#1a1a1a'; c.lineWidth=3*s; c.lineCap='round'; c.stroke();
      }
      c.restore();
    });
    c.font=`bold ${Math.round(9*s)}px Courier New`; c.fillStyle='#1a1a1a'; c.textAlign='center';
    c.fillText(this.name, this.baseX, this.floorY+14);
    c.restore();
  };

  // ── FateVillain ───────────────────────────────────────────────────────────
  function FateVillain(x, startY) {
    this.x=x; this.y=startY; this.targetY=startY; this.startY=startY;
    this.t=0; this.aimTarget=null; this.aimElapsed=0; this.aimDuration=0; this.muzzleFlash=null;
  }

  FateVillain.prototype.reset = function () {
    this.y=this.startY; this.targetY=this.startY; this.t=0; this.aimTarget=null; this.muzzleFlash=null;
  };

  FateVillain.prototype.aimAt = function (tx, ty, dur) {
    this.aimTarget={x:tx,y:ty}; this.aimElapsed=0; this.aimDuration=dur;
  };

  FateVillain.prototype.update = function (dt) {
    this.t+=dt;
    const gap=this.targetY-this.y;
    if (Math.abs(gap)>0.5) this.y+=gap*Math.min(7*dt,1); else this.y=this.targetY;
    if (this.aimTarget) { this.aimElapsed+=dt*1000; if (this.aimElapsed>=this.aimDuration) this.aimTarget=null; }
    if (this.muzzleFlash) { this.muzzleFlash.elapsed+=dt*1000; if (this.muzzleFlash.elapsed>=this.muzzleFlash.duration) this.muzzleFlash=null; }
  };

  FateVillain.prototype.getPose = function () {
    const S=1.15, t=this.t, sw=Math.sin(t*0.35)*1.5;
    const bx=this.x+sw, by=this.y;
    const pose = {
      torso:  { x1:bx, y1:by-38*S, x2:bx,      y2:by-78*S },
      head:   { cx:bx, cy:by-89*S, r:10*S },
      'arm-l':{ x1:bx, y1:by-65*S, x2:bx-18*S, y2:by-52*S },
      'arm-r':{ x1:bx, y1:by-65*S, x2:bx+20*S, y2:by-60*S },
      'leg-l':{ x1:bx, y1:by-38*S, x2:bx-12*S, y2:by },
      'leg-r':{ x1:bx, y1:by-38*S, x2:bx+12*S, y2:by },
    };
    if (this.aimTarget) {
      const sx=pose['arm-r'].x1, sy=pose['arm-r'].y1;
      const dx=this.aimTarget.x-sx, dy=this.aimTarget.y-sy, d=Math.hypot(dx,dy)||1;
      pose['arm-r'].x2=sx+(dx/d)*24; pose['arm-r'].y2=sy+(dy/d)*24;
    }
    return pose;
  };

  FateVillain.prototype.draw = function (c) {
    const S=1.15, p=this.getPose(), by=this.y;
    c.save(); c.strokeStyle='#1a1a1a'; c.lineWidth=3.5; c.lineCap='round';
    c.beginPath(); c.moveTo(p.torso.x1,p.torso.y1); c.lineTo(p.torso.x2,p.torso.y2); c.stroke();
    ['arm-l','arm-r','leg-l','leg-r'].forEach(k=>{
      c.beginPath(); c.moveTo(p[k].x1,p[k].y1); c.lineTo(p[k].x2,p[k].y2); c.stroke();
    });
    const arm=p['arm-r'], adx=arm.x2-arm.x1, ady=arm.y2-arm.y1, ad=Math.hypot(adx,ady)||1;
    c.save(); c.strokeStyle='#111'; c.lineWidth=6; c.lineCap='square';
    c.beginPath(); c.moveTo(arm.x2,arm.y2); c.lineTo(arm.x2+(adx/ad)*13,arm.y2+(ady/ad)*13); c.stroke();
    c.restore();
    if (this.muzzleFlash) {
      const mf=this.muzzleFlash, age=mf.elapsed/mf.duration;
      c.save(); c.globalAlpha=1-age; c.fillStyle='#FFE600';
      c.beginPath(); c.arc(mf.x,mf.y,(1-age)*12,0,Math.PI*2); c.fill(); c.restore();
    }
    c.beginPath(); c.arc(p.head.cx,p.head.cy,p.head.r,0,Math.PI*2);
    c.fillStyle='#ddd'; c.fill(); c.stroke();
    const hcx=p.head.cx, hcy=p.head.cy, hr=p.head.r;
    c.save(); c.fillStyle='#111'; c.strokeStyle='#111'; c.lineWidth=1;
    c.fillRect(hcx-hr*1.7,hcy-hr-4,hr*3.4,5);
    c.fillRect(hcx-hr*1.05,hcy-hr-4-hr*2.4,hr*2.1,hr*2.4);
    c.restore();
    c.font='bold 10px Courier New'; c.fillStyle='#cc0000'; c.textAlign='center';
    c.fillText('FATE', this.x, by+18);
    c.restore();
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  function computeLayout(players) {
    const n   = players.length;
    const rows = n > 5 ? 2 : 1;
    rowYs = rows === 1
      ? [Math.round(H * 0.74)]
      : [Math.round(H * 0.44), Math.round(H * 0.84)];

    const perRow = Math.ceil(n / rows);
    const zoneW  = W - PLAYER_START_X - 16;
    const colW   = zoneW / perRow;

    const next = {};
    players.forEach((player, idx) => {
      const row = (rows === 2 && idx >= perRow) ? 1 : 0;
      const col = idx - row * perRow;
      const x   = PLAYER_START_X + col * colW + colW / 2;
      const y   = rowYs[row];
      const existing = figs[player.id];
      if (existing) {
        existing.baseX  = x;
        existing.floorY = y;
        next[player.id] = existing;
      } else {
        next[player.id] = new FlexFigure(x, y, player.name, 0.85);
      }
    });
    figs = next;

    if (!fate) {
      fate = new FateVillain(FATE_X, rowYs[0]);
    } else {
      fate.startY  = rowYs[0];
      fate.y       = Math.min(fate.y, rowYs[rowYs.length-1]);
      fate.targetY = fate.targetY || rowYs[0];
    }
  }

  // ── Physics floor ─────────────────────────────────────────────────────────
  function addFloor() {
    const b = Matter.Bodies.rectangle(W/2, H+25, W+100, 50, { isStatic:true });
    Matter.World.add(engine.world, b);
  }

  // ── Shoot queue ───────────────────────────────────────────────────────────
  function processPending() {
    if (!shootQueue.length) { shootBusy=false; return; }
    shootBusy    = true;
    pendingTarget = shootQueue.shift();
    fate.targetY  = pendingTarget.fig.floorY;
  }

  function fireAt(target, limbKey) {
    if (target.dropped.has(limbKey)) { setTimeout(processPending, 100); return; }
    const tp  = target.getPose();
    const tx  = limbKey==='head' ? tp.head.cx : (tp[limbKey].x1+tp[limbKey].x2)/2;
    const ty  = limbKey==='head' ? tp.head.cy : (tp[limbKey].y1+tp[limbKey].y2)/2;
    fate.aimAt(tx, ty, 700);
    const fp=fate.getPose(), arm=fp['arm-r'];
    const adx=arm.x2-arm.x1, ady=arm.y2-arm.y1, ad=Math.hypot(adx,ady)||1;
    const gx=arm.x2+(adx/ad)*13, gy=arm.y2+(ady/ad)*13;
    fate.muzzleFlash={ x:gx, y:gy, elapsed:0, duration:140 };
    shake=Math.max(shake,5);
    const bvx=tx-gx, bvy=ty-gy, bd=Math.hypot(bvx,bvy)||1;
    bullets.push({ x:gx, y:gy, nx:bvx/bd, ny:bvy/bd, speed:bd/0.28,
      target, limbKey, tx, ty, traveled:0, maxDist:bd+25, done:false });
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const rawDt = Math.min((now-lastTs)/1000, 0.05);
    lastTs = now;
    if (timeScale<1) timeScale=Math.min(1, timeScale+rawDt*1.8);
    const dt=rawDt*timeScale;
    engine.timing.timeScale=timeScale;

    if (shake>0.4) shake*=0.82; else shake=0;
    const sx=shake?(Math.random()-0.5)*2*shake:0;
    const sy=shake?(Math.random()-0.5)*2*shake:0;

    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.translate(sx,sy);

    // Background
    ctx.fillStyle='#f0ede4'; ctx.fillRect(0,0,W,H);

    // Floor lines per row
    rowYs.forEach(ry => {
      ctx.fillStyle='#c0b090';
      ctx.fillRect(PLAYER_START_X-8, ry, W-PLAYER_START_X+8, 3);
    });
    ctx.fillStyle='#c0b090';
    ctx.fillRect(0, Math.round(fate.y), PLAYER_START_X-8, 3);

    // Update
    fate.update(dt);
    Object.values(figs).forEach(f => f.update(dt));

    // Fire when FATE arrives
    if (pendingTarget && Math.abs(fate.y-fate.targetY)<3) {
      fireAt(pendingTarget.fig, pendingTarget.limbKey);
      pendingTarget=null;
    }

    // Draw figures (back row first if 2 rows)
    const figList = Object.values(figs);
    if (rowYs.length > 1) {
      figList.filter(f=>f.floorY===rowYs[1]).forEach(f=>f.draw(ctx));
      figList.filter(f=>f.floorY===rowYs[0]).forEach(f=>f.draw(ctx));
    } else {
      figList.forEach(f=>f.draw(ctx));
    }
    fate.draw(ctx);

    // Bullets
    for (let i=bullets.length-1; i>=0; i--) {
      const b=bullets[i];
      if (b.done){ bullets.splice(i,1); continue; }
      b.x+=b.nx*b.speed*dt; b.y+=b.ny*b.speed*dt; b.traveled+=b.speed*dt;
      if (Math.hypot(b.tx-b.x,b.ty-b.y)<10 || b.traveled>=b.maxDist) {
        b.done=true;
        b.target.dropLimb(b.limbKey);
        b.target.hitFlash={ elapsed:0, duration:200 };
        if (b.target.onHit) b.target.onHit();
        impacts.push({ x:b.tx, y:b.ty, elapsed:0, duration:360 });
        shake=Math.max(shake,12);
        for (let j=0;j<14;j++) {
          const ang=Math.random()*Math.PI*2, spd=60+Math.random()*160;
          particles.push({ x:b.tx,y:b.ty, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd-90,
            life:1, color:j<9?'#e03030':'#FFE600', size:2+Math.random()*3 });
        }
        if (LIMB_KEYS.every(k=>b.target.dropped.has(k))) {
          timeScale=0.15;
          popups.push({ x:b.target.baseX, y:b.target.floorY-60, vy:-70, life:1.5 });
        }
        setTimeout(processPending,340);
      }
    }

    bullets.forEach(b=>{
      ctx.save(); ctx.strokeStyle='#c00'; ctx.lineWidth=2; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(b.x-b.nx*13,b.y-b.ny*13); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.fillStyle='#ff2200'; ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // Impact bursts
    for (let i=impacts.length-1; i>=0; i--) {
      const imp=impacts[i]; imp.elapsed+=dt*1000;
      if (imp.elapsed>=imp.duration){ impacts.splice(i,1); continue; }
      const age=imp.elapsed/imp.duration, sz=age*22;
      ctx.save(); ctx.globalAlpha=1-age; ctx.strokeStyle='#FFE600'; ctx.lineWidth=2.5;
      for (let a=0;a<6;a++){
        const angle=(a/6)*Math.PI*2+age*0.4;
        ctx.beginPath();
        ctx.moveTo(imp.x+Math.cos(angle)*sz*0.3,imp.y+Math.sin(angle)*sz*0.3);
        ctx.lineTo(imp.x+Math.cos(angle)*sz,imp.y+Math.sin(angle)*sz);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Particles
    for (let i=particles.length-1; i>=0; i--) {
      const p=particles[i];
      p.vy+=300*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt*2.8;
      if (p.life<=0){ particles.splice(i,1); continue; }
      ctx.save(); ctx.globalAlpha=p.life; ctx.fillStyle=p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*Math.max(0.1,p.life),0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // Elimination popups
    for (let i=popups.length-1; i>=0; i--) {
      const p=popups[i];
      p.y+=p.vy*dt; p.vy*=0.94; p.life-=dt*0.7;
      if (p.life<=0){ popups.splice(i,1); continue; }
      ctx.save(); ctx.globalAlpha=Math.min(1,p.life);
      ctx.font='bold 12px Courier New'; ctx.fillStyle='#cc0000'; ctx.textAlign='center';
      ctx.letterSpacing='2px'; ctx.fillText('ELIMINATED',p.x,p.y);
      ctx.restore();
    }

    ctx.restore(); // end shake
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init(players, canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    W = 600;
    H = Math.round(W * 0.34);
    canvas.width  = W;
    canvas.height = H;

    if (!Matter) {
      Matter = window.Matter;
      engine     = Matter.Engine.create({ gravity:{ y:2.2 } });
      physRunner = Matter.Runner.create();
      Matter.Runner.run(physRunner, engine);
      addFloor();
    }

    computeLayout(players);

    if (!running) {
      running = true;
      lastTs  = performance.now();
      rafId   = requestAnimationFrame(loop);
    }
  }

  function queueShot(playerId, limbKey) {
    const fig = figs[playerId];
    if (!fig || fig.dropped.has(limbKey)) return;
    shootQueue.push({ fig, limbKey });
    if (!shootBusy) processPending();
  }

  function syncState(players, calledNumbers, dangerNumbers) {
    players.forEach(p => {
      const fig = figs[p.id];
      if (!fig) return;
      (dangerNumbers[p.id] || []).forEach((n, i) => {
        if (calledNumbers.includes(n)) fig.dropped.add(LIMB_KEYS[i]);
      });
    });
  }

  function reset() {
    Object.values(figs).forEach(f => {
      Object.values(f.physBodies).forEach(b => Matter.World.remove(engine.world, b));
      f.reset();
    });
    if (fate) fate.reset();
    bullets.length=0; impacts.length=0; particles.length=0; popups.length=0;
    shake=0; timeScale=1.0;
    if (engine) engine.timing.timeScale=1.0;
    shootQueue=[]; shootBusy=false; pendingTarget=null;
    if (engine) { Matter.World.clear(engine.world,true); addFloor(); }
  }

  return { init, queueShot, syncState, reset };
})();
