// Dodge Rush - mobile & desktop friendly
(() => {
  const canvas = document.getElementById('game');
  const scoreEl = document.getElementById('score');
  const highEl = document.getElementById('high');
  const comboEl = document.getElementById('combo');
  const overlay = document.getElementById('overlay');
  const finalScore = document.getElementById('finalScore');

  let ctx = canvas.getContext('2d', { alpha: false });

  // sizing & DPR helper
  let DPR = Math.max(1, window.devicePixelRatio || 1);
  function resizeCanvas(){
    DPR = Math.max(1, window.devicePixelRatio || 1);
    const W = canvas.width = Math.round(window.innerWidth * DPR);
    const H = canvas.height = Math.round(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    // Reset transform exactly (avoid cumulative scale)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resizeCanvas();
  addEventListener('resize', resizeCanvas);
  addEventListener('orientationchange', () => setTimeout(resizeCanvas, 60));

  // Prevent touch scrolling/gestures interfering with gameplay
  // Use passive:false so preventDefault works on older browsers
  window.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

  // Utilities
  const rand = (a,b) => a + Math.random()*(b-a);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);

  // Determine mobile
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // Game state
  let running = true;
  let last = performance.now();
  let score = 0;
  let high = +localStorage.getItem('dodgeRushHigh') || 0;
  let combo = 1;
  let comboTimer = 0;
  const comboDecay = 2200; // ms
  const particles = [];
  const obstacles = [];
  let spawnTimer = 0;
  let spawnInterval = 800; // ms
  let difficultyTime = 0;
  let shake = 0;
  let gameOver = false;

  // Player
  const player = {
    x: innerWidth/2, y: innerHeight/2, r: 12, color: '#7ad6ff',
    vx:0, vy:0, maxSpeed: 750, follow: false, targetX: innerWidth/2, targetY: innerHeight/2
  };

  // Input
  const keys = {};
  addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (gameOver && (e.key===' ' || e.key==='Enter')) restart();
  });
  addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

  // Pointer / touch (pointer events handle touch & pen & mouse)
  canvas.addEventListener('pointerdown', (e) => {
    player.follow = true;
    const rect = canvas.getBoundingClientRect();
    player.targetX = (e.clientX - rect.left);
    player.targetY = (e.clientY - rect.top);
    if (gameOver) restart();
  }, {passive: false});
  window.addEventListener('pointermove', (e) => {
    if (!player.follow) return;
    const rect = canvas.getBoundingClientRect();
    player.targetX = (e.clientX - rect.left);
    player.targetY = (e.clientY - rect.top);
  }, {passive: false});
  window.addEventListener('pointerup', () => player.follow = false, {passive: false});

  // Particles (lighter on mobile)
  function spawnParticles(x,y,color,count=18,spread=1.4, speed=220){
    const scale = isMobile ? 0.65 : 1;
    const actual = Math.max(6, Math.round(count * scale));
    for(let i=0;i<actual;i++){
      const a = rand(0,Math.PI*2);
      const s = rand(0.2,1.2)*speed;
      particles.push({
        x,y,
        vx: Math.cos(a)*s*spread,
        vy: Math.sin(a)*s*spread,
        life: rand(420,1000) * (isMobile ? 0.9 : 1),
        t:0,
        r: rand(1.2,3) * (isMobile ? 0.9 : 1),
        color,
      });
    }
  }

  // Obstacles
  function spawnObstacle(opts){
    const o = Object.assign({
      x:0,y:0,vx:0,vy:0,r:14,color:'#ffb26b',type:'normal',speed:220,nearCounted:false
    }, opts);
    obstacles.push(o);
  }

  function spawnPattern(){
    const W = window.innerWidth, H = window.innerHeight;
    const patterns = ['single','stream','wave','ring'];
    const pick = patterns[Math.floor(Math.random()*patterns.length)];
    const edge = Math.floor(Math.random()*4); // 0=left,1=top,2=right,3=bottom
    const centerish = {x: W/2 + rand(-100,100), y: H/2 + rand(-100,100)};
    const baseSpeed = 160 + difficultyTime*0.02 + rand(0,80);

    if (pick === 'single'){
      spawnFromEdge(edge, baseSpeed, centerish);
    } else if (pick === 'stream'){
      const count = 3 + Math.floor(rand(0,4));
      for(let i=0;i<count;i++){
        setTimeout(()=> spawnFromEdge(edge, baseSpeed + i*20, centerish, 12+rand(-3,6)), i*90);
      }
    } else if (pick === 'wave'){
      const count = 6 + Math.floor(rand(0,6));
      for(let i=0;i<count;i++){
        setTimeout(()=> {
          const off = Math.sin(i/count*Math.PI*2)*120;
          const aim = {x:centerish.x + (edge%2?off:0), y:centerish.y + (edge%2?0:off)};
          spawnFromEdge(edge, baseSpeed + Math.abs(off)*0.05 + rand(-20,50), aim, 12);
        }, i*70);
      }
    } else if (pick === 'ring'){
      const pts = 8 + Math.floor(rand(0,6));
      const radius = Math.min(W,H)*0.6;
      const cx = W/2 + rand(-80,80), cy = H/2 + rand(-80,80);
      for(let i=0;i<pts;i++){
        setTimeout(()=> {
          const a = (i/pts)*Math.PI*2 + rand(-0.2,0.2);
          const sx = cx + Math.cos(a)*radius;
          const sy = cy + Math.sin(a)*radius;
          const vx = (cx - sx)/1.2;
          const vy = (cy - sy)/1.2;
          spawnObstacle({x:sx,y:sy,vx,vy,r:14+rand(-4,6),color:randColor(),type:'in'});
        }, i*50);
      }
    }
  }

  function spawnFromEdge(edge, speed, aim, r=14){
    const W = window.innerWidth, H = window.innerHeight;
    let x,y;
    if (edge===0) { x = -50; y = rand(0,H); }
    if (edge===1) { x = rand(0,W); y = -50; }
    if (edge===2) { x = W+50; y = rand(0,H); }
    if (edge===3) { x = rand(0,W); y = H+50; }
    const dx = (aim.x + rand(-80,80)) - x;
    const dy = (aim.y + rand(-80,80)) - y;
    const len = Math.hypot(dx,dy) || 1;
    const vx = dx/len * speed;
    const vy = dy/len * speed;
    spawnObstacle({x,y,vx,vy,r: r, color: randColor(), speed});
  }

  function randColor(){
    const palettes = ['#ff6b6b','#ffd166','#7ad6ff','#9b59ff','#6af2a2'];
    return palettes[Math.floor(Math.random()*palettes.length)];
  }

  // Game control
  function restart(){
    obstacles.length = 0;
    particles.length = 0;
    score = 0; combo = 1; comboTimer = 0; spawnInterval = 800; difficultyTime = 0; shake = 0;
    player.x = innerWidth/2; player.y = innerHeight/2; player.vx=0; player.vy=0;
    gameOver = false; overlay.classList.add('hidden');
    last = performance.now();
    running = true;
    spawnTimer = 300;
  }

  function endGame(){
    running = false;
    gameOver = true;
    finalScore.textContent = Math.floor(score);
    overlay.classList.remove('hidden');
    if (score > high){
      high = Math.floor(score);
      localStorage.setItem('dodgeRushHigh', high);
    }
    highEl.textContent = 'HI ' + high;
  }

  // Main loop
  function update(dt){
    if (gameOver) return;
    difficultyTime += dt;
    spawnInterval = clamp(900 - difficultyTime*0.08, 220, 900);
    spawnTimer -= dt;
    if (spawnTimer <= 0){
      spawnPattern();
      spawnTimer = spawnInterval + rand(-120,120);
    }

    // Input movement
    const kbX = (keys['arrowright']||keys['d']?1:0) - (keys['arrowleft']||keys['a']?1:0);
    const kbY = (keys['arrowdown']||keys['s']?1:0) - (keys['arrowup']||keys['w']?1:0);

    if (player.follow){
      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      player.vx += dx * 10 * dt/1000;
      player.vy += dy * 10 * dt/1000;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > player.maxSpeed) {
        player.vx = player.vx/sp * player.maxSpeed;
        player.vy = player.vy/sp * player.maxSpeed;
      }
    } else if (kbX || kbY){
      player.vx = kbX * player.maxSpeed * 0.9;
      player.vy = kbY * player.maxSpeed * 0.9;
    } else {
      player.vx *= 0.92;
      player.vy *= 0.92;
    }

    // update player
    player.x += player.vx * dt/1000;
    player.y += player.vy * dt/1000;
    player.x = clamp(player.x, player.r, window.innerWidth - player.r);
    player.y = clamp(player.y, player.r, window.innerHeight - player.r);

    // obstacles
    for (let i = obstacles.length - 1; i >= 0; i--){
      const o = obstacles[i];
      o.x += (o.vx || 0) * dt/1000;
      o.y += (o.vy || 0) * dt/1000;
      if (o.speed) {
        const mult = 1 + difficultyTime*0.00008;
        o.vx *= (1 + (mult-1)*0.002);
        o.vy *= (1 + (mult-1)*0.002);
      }
      if (o.x < -120 || o.x > window.innerWidth+120 || o.y < -120 || o.y > window.innerHeight+120){
        obstacles.splice(i,1);
        continue;
      }
      const d = Math.hypot(o.x - player.x, o.y - player.y);
      const collision = d < (o.r + player.r);
      const nearThreshold = player.r + o.r + 18;
      if (!o.nearCounted && d < nearThreshold && !collision){
        o.nearCounted = true;
        combo = Math.min(5, +(combo + 0.5).toFixed(2));
        comboTimer = comboDecay;
        score += 25 * combo;
        spawnParticles(player.x, player.y, o.color, 14, 1.2, 120);
        shake = Math.max(shake, 10);
      }
      if (collision){
        spawnParticles(player.x, player.y, '#ffffff', 28, 1.8, 320);
        spawnParticles(o.x, o.y, o.color, 20, 1.4, 140);
        shake = 24;
        endGame();
        return;
      }
    }

    // update particles
    for (let i = particles.length - 1; i >= 0; i--){
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt/1000;
      p.y += p.vy * dt/1000;
      p.vx *= 0.996; p.vy *= 0.996;
      if (p.t > p.life) particles.splice(i,1);
    }

    // score increases over time with combo
    score += dt * 0.012 * (1 + difficultyTime*0.0002) * combo;
    scoreEl.textContent = Math.floor(score);
    if (combo > 1){
      comboTimer -= dt;
      if (comboTimer <= 0){
        combo = Math.max(1, +(combo - 0.2).toFixed(2));
        comboTimer = combo > 1 ? comboDecay : 0;
      }
    }
    comboEl.textContent = 'x' + combo.toFixed(2);
  }

  function draw(){
    const W = window.innerWidth, H = window.innerHeight;
    ctx.fillStyle = '#08101a';
    ctx.fillRect(0,0,W,H);

    const sx = (Math.random()*2-1) * shake;
    const sy = (Math.random()*2-1) * shake;
    ctx.save();
    ctx.translate(sx, sy);
    shake = Math.max(0, shake - 0.8);

    for (const o of obstacles){
      ctx.beginPath();
      ctx.fillStyle = o.color;
      ctx.globalAlpha = 0.98;
      ctx.arc(o.x, o.y, o.r, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r+10, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const g = ctx.createRadialGradient(player.x, player.y, player.r*0.2, player.x, player.y, player.r*3);
    g.addColorStop(0, '#dffcff');
    g.addColorStop(0.15, '#9be7ff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r*2.8, 0, Math.PI*2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = player.color;
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();

    for (const p of particles){
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    const barW = 140, barH = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(W/2 - barW/2, 8, barW, barH);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(W/2 - barW/2, 8, barW * clamp(difficultyTime*0.0006, 0,1), barH);
  }

  function loop(t){
    const dt = Math.min(40, t - last);
    last = t;
    if (running) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // Initialize
  highEl.textContent = 'HI ' + high;
  for (let i=0;i<3;i++) spawnPattern();
  requestAnimationFrame(loop);

  overlay.addEventListener('pointerdown', (e) => {
    if (gameOver) restart();
  }, {passive:false});

  canvas.addEventListener('click', (e) => {
    if (!gameOver) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      for (let i=0;i<6;i++){
        setTimeout(()=> spawnFromEdge(Math.floor(Math.random()*4), 240+Math.random()*120, {x:cx,y:cy}, 10+Math.random()*8), i*40);
      }
    }
  });

})();
