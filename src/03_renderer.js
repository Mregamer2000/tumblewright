
/* ============================================================================
   2. RENDERER (quality tiers, post-processing, dynamic resolution, benchmark)
   ========================================================================== */
const TIERS = {
  low:    { label: 'Low',    path: 'ps1',  shadows: false, ao: false, bloom: false, reflections: false, csm: false, shadowSize: 0,    maxPR: 1.0,  lights: 4,  aniso: 1 },
  medium: { label: 'Medium', path: 'pbr',  shadows: true,  ao: false, bloom: false, reflections: false, csm: false, shadowSize: 1024, maxPR: 1.25, lights: 6,  aniso: 4 },
  high:   { label: 'High',   path: 'pbr',  shadows: true,  ao: true,  bloom: true,  reflections: false, csm: true, cascades: 3, shadowSize: 1024, maxPR: 1.5, lights: 8, aniso: 8 },
  ultra:  { label: 'Ultra',  path: 'pbr',  shadows: true,  ao: true,  bloom: true,  reflections: true,  csm: true, cascades: 4, shadowSize: 2048, maxPR: 2.0, lights: 12, aniso: 16 },
};
const TIER_KEYS = ['low', 'medium', 'high', 'ultra'];
const tierBadge = t => `<span class="badge t-${t || 'medium'}" title="Graphics: ${TIERS[t] ? TIERS[t].label : '?'}">${(TIERS[t] ? TIERS[t].label : '?').toUpperCase()}</span>`;
const SUN_DIR = new V3(0.5, -0.72, 0.42).normalize();
// ---- Low tier: PS1-style rendering ----------------------------------------------------------
// The scene renders into a 240-line target that is upscaled with nearest sampling, quantized to
// 15-bit color with ordered dithering. Materials snap vertices to that pixel grid (the PS1 "wobble")
// and interpolate textures affinely (the PS1 "warp").
const PS1 = {
  H: 240, snap: { value: new THREE.Vector2(160, 120) },
  patch(m) {
    m.onBeforeCompile = sh => {
      sh.uniforms.psSnap = PS1.snap;
      sh.vertexShader = 'uniform vec2 psSnap;\n#ifdef USE_MAP\nvarying vec3 vPsUv;\n#endif\n' + sh.vertexShader.replace('#include <project_vertex>', [
        '#include <project_vertex>',
        '{ vec4 sp = gl_Position; if (sp.w > 0.0) { sp.xy = floor(sp.xy / sp.w * psSnap + 0.5) / psSnap * sp.w; gl_Position = sp; } }',
        '#ifdef USE_MAP', 'vPsUv = vec3(vMapUv * gl_Position.w, gl_Position.w);', '#endif'].join('\n'));
      sh.fragmentShader = '#ifdef USE_MAP\nvarying vec3 vPsUv;\n#endif\n' + sh.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace(/vMapUv/g, '(vPsUv.xy / vPsUv.z)'));
    };
    m.customProgramCacheKey = () => 'ps1';
    return m;
  },
};

const R = {
  renderer: null, scene: null, camera: null, tier: 'medium', path: 'pbr', composer: null, passes: {}, csm: null, outline: null,
  drs: { scale: 1, acc: 0, n: 0, t: 0, good: 0 }, envTex: null, probeTex: null, probeT: 0, lightPool: [], lightT: 0, focus: new V3(),
  init() {
    const canvas = $('#c');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2 is required');
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(Settings.fov, innerWidth / innerHeight, 0.05, 1500);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x7a6a58, 0.5); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.pmrem = new THREE.PMREMGenerator(r);
    // HDR gradient sky with sun disc (Medium+) + an environment map baked from it for PBR reflections
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunDir: { value: SUN_DIR.clone().negate() }, gain: { value: 1.0 }, zen: { value: new THREE.Color().setRGB(0.10, 0.27, 0.68) }, hor: { value: new THREE.Color().setRGB(0.56, 0.70, 0.86) }, gnd: { value: new THREE.Color().setRGB(0.30, 0.31, 0.29) }, sunAmt: { value: 1.0 } },
      vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: [
        'uniform vec3 sunDir; uniform float gain; uniform vec3 zen; uniform vec3 hor; uniform vec3 gnd; uniform float sunAmt; varying vec3 vDir;',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  vec3 col = h > 0.0 ? mix(hor, zen, pow(clamp(h,0.0,1.0), 0.5)) : mix(hor * 0.85, gnd, pow(clamp(-h * 5.0, 0.0, 1.0), 0.6));',
        '  float s = max(dot(d, normalize(sunDir)), 0.0);',
        '  col += vec3(1.0,0.86,0.62) * (pow(s, 1400.0) * 40.0 + pow(s, 60.0) * 0.6 + pow(s, 6.0) * 0.12) * step(-0.02, h) * sunAmt;',
        '  gl_FragColor = vec4(col * gain, 1.0);',
        '#include <tonemapping_fragment>',
        '#include <colorspace_fragment>',
        '}'].join('\n'),
    });
    skyMat.userData.outlineParameters = { visible: false };
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
    sky.frustumCulled = false; sky.renderOrder = -10;
    const envScene = this.envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(sky.geometry, skyMat));
    this.envTex = this.pmrem.fromScene(envScene, 0.02, 0.1, 2000).texture;
    this.scene.add(sky);
    // simple gradient sky (Low / PS1 tier)
    this.toonSky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#5fb4ff') }, mid: { value: new THREE.Color('#cfeaff') }, bot: { value: new THREE.Color('#e9e4dc') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, pow(clamp(y*1.4,0.0,1.0),0.7)) : mix(mid, bot, clamp(-y*6.0,0.0,1.0)); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n}',
    }));
    this.toonSky.material.userData.outlineParameters = { visible: false };
    this.toonSky.frustumCulled = false; this.toonSky.renderOrder = -10;
    this.scene.add(this.toonSky);
    // PS1 target + upscale/dither pass
    this.psRT = new THREE.WebGLRenderTarget(320, 240, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.psScene = new THREE.Scene(); this.psCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.psScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tex: { value: this.psRT.texture }, res: { value: new THREE.Vector2(320, 240) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tex; uniform vec2 res; varying vec2 vUv;',
        'float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;',
        '  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return float(m[i]) / 16.0 - 0.5; }',
        'void main(){',
        '  gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0);',
        '#include <tonemapping_fragment>',
        '#include <colorspace_fragment>',
        '  vec2 px = floor(vUv * res);',
        '  gl_FragColor.rgb = clamp(floor(gl_FragColor.rgb * 31.0 + 0.5 + bayer(px)) / 31.0, 0.0, 1.0);   // 15-bit color, ordered dither',
        '}'].join('\n'),
    })));
    addEventListener('resize', () => this.resize());
  },
  // ---- tier switching --------------------------------------------------------
  applyTier(key, resetToggles) {
    if (!TIERS[key]) key = 'medium';
    const T = TIERS[key], prevPath = this.path; this.tier = key; this.path = T.path; Settings.tier = key;
    if (resetToggles) { Settings.shadows = T.shadows; Settings.ao = T.ao; Settings.bloom = T.bloom; Settings.reflections = T.reflections; }
    saveSettings();
    const sc = this.scene, r = this.renderer;
    if (this.csm) { this.csm.remove(); this.csm.dispose(); this.csm = null; }
    const shadows = T.path === 'pbr' && Settings.shadows;
    r.shadowMap.enabled = shadows;
    if (shadows && T.csm) {
      this.csm = new CSM({ maxFar: 140, cascades: T.cascades, mode: 'practical', parent: sc, shadowMapSize: T.shadowSize, lightDirection: SUN_DIR, lightIntensity: 3.0, camera: this.camera, shadowBias: -0.00003, lightNear: 1, lightFar: 320, lightMargin: 60 });
      this.csm.fade = true;
      for (const l of this.csm.lights) { l.color.set(0xfff0dc); l.shadow.normalBias = 0.02; }
      this.sun.visible = false;
    } else {
      this.sun.visible = true; this.sun.castShadow = shadows;
      const s = T.shadowSize || 1024;
      if (this.sun.shadow.map && this.sun.shadow.mapSize.x !== s) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(s, s);
      this.sun.intensity = T.path === 'ps1' ? 1.9 : 3.0;
    }
    const pbr = T.path === 'pbr';
    this.sky.visible = pbr; this.toonSky.visible = !pbr;
    sc.environment = pbr ? (this.probeTex || this.envTex) : null;
    sc.environmentIntensity = 0.6;
    this.hemi.intensity = pbr ? 0.35 : 1.1;
    this.hemi.color.set(pbr ? 0xdcecff : 0xffffff); this.hemi.groundColor.set(pbr ? 0x7a6a58 : 0x9aa0a8);
    // point light pool (fixed size per tier so shaders never recompile when lights are added)
    for (const l of this.lightPool) sc.remove(l);
    this.lightPool = [];
    for (let i = 0; i < T.lights; i++) { const l = new THREE.PointLight(0xffffff, 0, 16, 2); l.castShadow = false; sc.add(l); this.lightPool.push(l); }
    if (!(Settings.reflections && pbr && key === 'ultra') && this.probeTex) { this.probeTex.dispose(); this.probeTex = null; sc.environment = pbr ? this.envTex : null; }
    this.applyLights();
    Mats.rebuildAll();
    if (prevPath !== T.path && (prevPath === 'ps1' || T.path === 'ps1') && Object.keys(Models.srcPs1).length) {
      World.rebuildVisuals();
      for (const p of Players.map.values()) { if (p.avatar) R.scene.remove(p.avatar); Players.makeAvatar(p); }
      if (Game.viewmodel) Game.buildViewmodel();
    }
    this.setupComposer();
    this.drs.scale = 1; this.resize();
    if (typeof UI !== 'undefined' && UI.onTierChanged) UI.onTierChanged(key);
  },
  setupComposer() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    for (const k in this.passes) { const p = this.passes[k]; if (p && p.dispose) p.dispose(); }
    this.passes = {};
    const T = TIERS[this.tier];
    if (T.path !== 'pbr') return;
    const wantAO = Settings.ao, wantBloom = Settings.bloom, wantSMAA = this.tier === 'high' || this.tier === 'ultra';
    if (!wantAO && !wantBloom && !wantSMAA) return;
    const w = innerWidth, hh = innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, hh, { type: THREE.HalfFloatType });
    const c = this.composer = new EffectComposer(this.renderer, rt);
    c.addPass(this.passes.render = new RenderPass(this.scene, this.camera));
    if (wantAO) {
      const g = this.passes.ao = new GTAOPass(this.scene, this.camera, w, hh);
      g.blendIntensity = 0.85;
      g.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: this.tier === 'ultra' ? 16 : 8 });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: this.tier === 'ultra' ? 16 : 8 });
      // see-through effects (tracers, beams, smoke, holograms) must not cast AO, or they render as dark smears
      const ov = g.overrideVisibility.bind(g);
      g.overrideVisibility = () => { ov(); this.scene.traverse(o => { const m = o.material; if (m && !Array.isArray(m) && m.transparent && !m.depthWrite) o.visible = false; }); };
      c.addPass(g);
    }
    if (wantBloom) c.addPass(this.passes.bloom = new UnrealBloomPass(new THREE.Vector2(w, hh), 0.4, 0.5, 1.8));
    c.addPass(this.passes.out = new OutputPass());
    if (wantSMAA) c.addPass(this.passes.smaa = new SMAAPass(w, hh));
  },
  pixelRatio() { return this.path === 'ps1' ? 1 : Math.min(devicePixelRatio || 1, TIERS[this.tier].maxPR) * this.drs.scale; },
  resize() {
    const w = innerWidth, hh = innerHeight, pr = this.pixelRatio();
    this.camera.aspect = w / hh; this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, hh, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, hh); }
    if (this.path === 'ps1') {   // fixed 240-line render, width follows the window's aspect
      const H = PS1.H, W = Math.round(H * w / hh); this.psRT.setSize(W, H); PS1.snap.value.set(W / 2, H / 2);
      this.psScene.children[0].material.uniforms.res.value.set(W, H);
    }
    if (this.csm) this.csm.updateFrustums();
  },
  // sun / sky light for the current tier, scaled by the map theme (overcast themes are softer)
  applyLights() {
    const T = TIERS[this.tier], L = this.themeLight || { sun: 1, hemi: 1 }, dk = 1 - 0.965 * (this.dark || 0);   // dark: inside a dark room
    this.sun.intensity = (T.path === 'ps1' ? 1.9 : 3.0) * L.sun * dk;
    if (this.csm) for (const l of this.csm.lights) l.intensity = 3.0 * L.sun * dk;
    this.hemi.intensity = (T.path === 'pbr' ? 0.35 : 1.1) * L.hemi * dk;
    if (T.path === 'pbr') this.scene.environmentIntensity = 0.6 * dk;
  },
  // re-bake the reflection environment after the sky changed (map theme)
  rebakeEnv() {
    const old = this.envTex; this.envTex = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 2000).texture;
    if (this.path === 'pbr' && !this.probeTex) this.scene.environment = this.envTex;
    if (old) old.dispose();
  },
  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); if (this.csm) this.csm.updateFrustums(); },
  // ---- dynamic resolution scaling -------------------------------------------
  drsTick(frameMs) {
    const d = this.drs;
    if (!Settings.drs || this.path === 'ps1') { if (d.scale !== 1) { d.scale = 1; this.resize(); } return; }
    d.acc += frameMs; d.n++; d.t += frameMs;
    if (d.t < 700) return;
    const avg = d.acc / d.n, target = 1000 / Settings.targetFps;
    d.acc = 0; d.n = 0; d.t = 0;
    if (avg > target * 1.12 && d.scale > 0.5) { d.scale = Math.max(0.5, +(d.scale - 0.1).toFixed(2)); d.good = 0; this.resize(); }
    else if (avg < target * 1.03 && d.scale < 1) { if (++d.good >= 4) { d.good = 0; d.scale = Math.min(1, +(d.scale + 0.05).toFixed(2)); this.resize(); } }
    else d.good = 0;
  },
  // ---- per-frame --------------------------------------------------------------
  updateLights(dt) {
    this.lightT -= dt; if (this.lightT > 0) return; this.lightT = 0.25;
    const cam = this.camera.position, list = [];
    for (const e of World.ents.values()) if (e.d.light && e.mesh) list.push([e.mesh.position.distanceToSquared(cam), e]);
    list.sort((a, b) => a[0] - b[0]);
    this.lightPool.forEach((l, i) => {
      const it = list[i];
      if (!it) { l.intensity = 0; return; }
      const e = it[1], L = e.d.light;
      l.position.copy(e.mesh.position); l.color.set(L.c || '#ffd9a0'); l.intensity = (L.i != null ? L.i : 20) * (this.path === 'ps1' ? 0.6 : 1); l.distance = L.r || 16;
    });
  },
  updateProbe(dt) {
    if (!(this.tier === 'ultra' && Settings.reflections && this.path === 'pbr')) return;
    this.probeT -= dt; if (this.probeT > 0) return; this.probeT = 6;
    if (!this.cubeRT) { this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType }); this.cubeCam = new THREE.CubeCamera(0.5, 600, this.cubeRT); }
    this.cubeCam.position.copy(this.camera.position);
    const vm = Game.viewmodel; if (vm) vm.visible = false;
    this.cubeCam.update(this.renderer, this.scene);
    if (vm) vm.visible = true;
    const next = this.pmrem.fromCubemap(this.cubeRT.texture).texture;
    if (this.probeTex) this.probeTex.dispose();
    this.probeTex = next; this.scene.environment = next;
  },
  render(dt) {
    const sc = this.scene, cam = this.camera;
    if (this.csm) { cam.updateMatrixWorld(); this.csm.update(); }
    else if (this.sun.castShadow) {
      this.sun.target.position.copy(this.focus); this.sun.position.copy(this.focus).addScaledVector(SUN_DIR, -80);
    } else { this.sun.position.copy(SUN_DIR).multiplyScalar(-80); this.sun.target.position.set(0, 0, 0); }
    this.updateLights(dt); this.updateProbe(dt);
    if (this.path === 'ps1') { const r = this.renderer; r.setRenderTarget(this.psRT); r.render(sc, cam); r.setRenderTarget(null); r.render(this.psScene, this.psCam); }
    else if (this.composer) this.composer.render(dt);
    else this.renderer.render(sc, cam);
  },
  // ---- auto-detect quality: renderer string heuristics + quick GPU benchmark -----
  detectTier() {
    const r = this.renderer, gl = r.getContext();
    let gpu = '';
    try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { }
    this.gpuName = gpu || 'unknown';
    const g = this.gpuName.toLowerCase();
    if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(g)) return { tier: 'low', ms: 99, gpu: this.gpuName };
    let cap = 'ultra';
    if (/mali|powervr|videocore|adreno \(tm\) [1-5]|hd graphics|uhd graphics 6|intel\(r\) hd/.test(g)) cap = 'medium';
    else if (/intel|iris|adreno|apple gpu|radeon\(tm\) graphics|vega [3-8]/.test(g)) cap = 'high';
    if (isChromebook && cap === 'ultra') cap = 'high';
    // micro-benchmark: shadowed PBR scene rendered offscreen
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 6, 14); cam.lookAt(0, 0, 0);
    const lt = new THREE.DirectionalLight(0xffffff, 3); lt.position.set(5, 10, 4); lt.castShadow = true; lt.shadow.mapSize.set(1024, 1024);
    sc.add(lt, new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)); sc.environment = this.envTex;
    const geo = new THREE.SphereGeometry(0.5, 32, 20), mats = [];
    for (let i = 0; i < 140; i++) {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 140, 0.6, 0.5), roughness: (i % 7) / 7, metalness: i % 2 });
      mats.push(m); const s = new THREE.Mesh(geo, m); s.castShadow = s.receiveShadow = true;
      s.position.set((i % 14) - 7, Math.floor(i / 14) * 0.6 - 2, -(i % 5)); sc.add(s);
    }
    const rt = new THREE.WebGLRenderTarget(900, 900, { type: THREE.HalfFloatType });
    const prevShadow = r.shadowMap.enabled; r.shadowMap.enabled = true;
    const px = new Uint16Array(4);
    r.setRenderTarget(rt); r.render(sc, cam); r.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
    const t0 = performance.now(), N = 14;
    for (let i = 0; i < N; i++) { sc.rotation.y += 0.05; lt.position.x = Math.sin(i) * 6; r.render(sc, cam); }
    r.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
    const ms = (performance.now() - t0) / N;
    r.setRenderTarget(null); r.shadowMap.enabled = prevShadow;
    rt.dispose(); geo.dispose(); mats.forEach(m => m.dispose()); lt.shadow.map && lt.shadow.map.dispose();
    let tier = ms < 2.2 ? 'ultra' : ms < 4.5 ? 'high' : ms < 10 ? 'medium' : 'low';
    if (TIER_KEYS.indexOf(tier) > TIER_KEYS.indexOf(cap)) tier = cap;
    return { tier, ms: +ms.toFixed(2), gpu: this.gpuName };
  },
};

/* ============================================================================
   3. MATERIALS & MESHES (procedural PBR textures, toon path, shape builders)
   ========================================================================== */
const MATDEFS = {
  dev:      { name: 'Dev Grid', density: 1.0, fr: 0.8, re: 0.05, rough: 0.8, metal: 0, tex: 'dev', tint: '#d4d8de' },
  wood:     { name: 'Wood', density: 0.5, fr: 0.6, re: 0.15, rough: 0.72, metal: 0, tex: 'wood', tint: '#ffffff' },
  metal:    { name: 'Metal', density: 2.2, fr: 0.4, re: 0.1, rough: 0.34, metal: 1, tex: 'brushed', tint: '#c9ced6' },
  concrete: { name: 'Concrete', density: 2.0, fr: 0.9, re: 0.02, rough: 0.95, metal: 0, tex: 'concrete', tint: '#c2beb6' },
  glass:    { name: 'Glass', density: 1.5, fr: 0.3, re: 0.15, rough: 0.04, metal: 0, tex: null, tint: '#cdeeff', glass: true },
  rubber:   { name: 'Rubber', density: 1.0, fr: 1.3, re: 0.6, rough: 0.9, metal: 0, tex: 'noise', tint: '#2a2c31' },
  plastic:  { name: 'Plastic', density: 0.4, fr: 0.5, re: 0.3, rough: 0.4, metal: 0, tex: null, tint: '#e9e9ec' },
  fabric:   { name: 'Fabric', density: 0.35, fr: 0.9, re: 0.08, rough: 0.97, metal: 0, tex: 'noise', tint: '#7d6f8f' },
  neon:     { name: 'Neon', density: 0.6, fr: 0.5, re: 0.2, rough: 0.3, metal: 0, tex: null, tint: '#4dd0e1', emissive: true },
};
const MAT_KEYS = Object.keys(MATDEFS);
const PAINT_COLORS = ['#ffffff', '#d4d8de', '#7a808a', '#2a2c31', '#ff5a5f', '#ff9f43', '#fed330', '#26de81', '#20bf6b', '#2bcbba', '#45aaf2', '#4b7bec', '#a55eea', '#f368e0', '#b8835a', '#6d4c33'];

const Tex = {
  cache: {},
  canvas(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; },
  make(key, srgb) {
    const k = key + (srgb ? ':s' : ':l');
    if (this.cache[k]) return this.cache[k];
    const cv = this.draw[key]();
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, R.renderer.capabilities.getMaxAnisotropy());
    return (this.cache[k] = t);
  },
  // PS1: 128px copy of a texture, sampled with nearest filtering and no mipmaps
  ps1(key) {
    const k = 'ps1:' + key; if (this.cache[k]) return this.cache[k];
    const src = this.make(key, true).image, cv = Tex.canvas(128, (c, s) => c.drawImage(src, 0, 0, s, s));
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
    return (this.cache[k] = t);
  },
  noise(ctx, s, n, a, b, alpha) { for (let i = 0; i < n; i++) { const v = a + Math.random() * (b - a) | 0; ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`; const r = Math.random() * 2.2 + 0.4; ctx.fillRect(Math.random() * s, Math.random() * s, r, r); } },
  draw: {
    dev() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#dfe2e6'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 5000, 200, 240, 0.25);
      c.strokeStyle = 'rgba(40,50,60,.12)'; c.lineWidth = 2; for (let i = 0; i <= 8; i++) { const p = i * s / 8; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, s); c.moveTo(0, p); c.lineTo(s, p); c.stroke(); }
      c.strokeStyle = 'rgba(40,50,60,.35)'; c.lineWidth = 4; for (let i = 0; i <= 2; i++) { const p = i * s / 2; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, s); c.moveTo(0, p); c.lineTo(s, p); c.stroke(); }
    }); },
    ground() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#a4a99f'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 14000, 130, 200, 0.35);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '90,95,85' : '230,232,225'},0.05)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 20 + Math.random() * 60, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(40,45,40,.16)'; c.lineWidth = 2; for (let i = 0; i <= 4; i++) { const p = i * s / 4; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, s); c.moveTo(0, p); c.lineTo(s, p); c.stroke(); }
      c.strokeStyle = 'rgba(40,45,40,.4)'; c.lineWidth = 5; c.strokeRect(0, 0, s, s);
    }); },
    wood() { return Tex.canvas(512, (c, s) => {
      const planks = 5, ph = s / planks;
      for (let p = 0; p < planks; p++) {
        const hue = 28 + Math.random() * 8, l = 42 + Math.random() * 12;
        c.fillStyle = `hsl(${hue},48%,${l}%)`; c.fillRect(0, p * ph, s, ph);
        for (let i = 0; i < 70; i++) {
          c.strokeStyle = `hsla(${hue - 4},50%,${l - 12 - Math.random() * 10}%,${0.12 + Math.random() * 0.25})`; c.lineWidth = 0.6 + Math.random() * 1.6;
          const y0 = p * ph + Math.random() * ph, a = Math.random() * 4, f = 0.004 + Math.random() * 0.01, off = Math.random() * 7;
          c.beginPath(); for (let x = 0; x <= s; x += 8) { const y = y0 + Math.sin(x * f + off) * a; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
        }
        if (Math.random() < 0.6) { const kx = Math.random() * s, ky = p * ph + ph * 0.5; c.fillStyle = `hsla(${hue - 6},45%,22%,.55)`; c.beginPath(); c.ellipse(kx, ky, 9, 5, 0, 0, 7); c.fill(); }
        c.fillStyle = 'rgba(30,18,8,.55)'; c.fillRect(0, p * ph, s, 2.5);
      }
    }); },
    grass() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#56663f'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 16000, 60, 150, 0.28);
      for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '70,86,48' : '120,128,80'},0.14)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 12 + Math.random() * 50, 0, 7); c.fill(); }
      for (let i = 0; i < 2600; i++) { const x = Math.random() * s, y = Math.random() * s, g = 70 + Math.random() * 70 | 0; c.strokeStyle = `rgba(${g - 20},${g + 20},${g - 40},.5)`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - .5) * 3, y - 3 - Math.random() * 5); c.stroke(); }
    }); },
    sand() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#c9ab7a'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 20000, 150, 230, 0.25);
      c.strokeStyle = 'rgba(120,90,50,.12)'; c.lineWidth = 3; for (let i = 0; i < 18; i++) { const y0 = i * s / 18 + Math.random() * 8; c.beginPath(); for (let x = 0; x <= s; x += 16) { const y = y0 + Math.sin(x * 0.03 + i) * 5; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
    }); },
    snow() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#e4eaef'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 14000, 190, 255, 0.3);
      for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(150,170,190,0.08)'; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 20 + Math.random() * 60, 0, 7); c.fill(); }
    }); },
    road() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#3b3d3f'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 18000, 40, 110, 0.35);
      c.fillStyle = '#d8d4c8'; c.fillRect(0, 20, s, 10); c.fillRect(0, s - 30, s, 10);                  // edge lines
      c.fillStyle = '#e0b83a'; for (let x = 0; x < s; x += 128) c.fillRect(x + 16, s / 2 - 6, 80, 12);   // dashed centre line
    }); },
    concrete() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#a7a39c'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 22000, 110, 200, 0.4);
      for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '70,70,68' : '215,212,205'},0.06)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 50, 0, 7); c.fill(); }
      for (let i = 0; i < 260; i++) { c.fillStyle = 'rgba(40,40,40,.5)'; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, Math.random() * 1.6, 0, 7); c.fill(); }
    }); },
    brushed() { return Tex.canvas(256, (c, s) => {
      c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) { const v = 110 + Math.random() * 110 | 0; c.strokeStyle = `rgba(${v},${v},${v},.35)`; c.lineWidth = Math.random() * 1.2 + 0.3; const y = Math.random() * s; c.beginPath(); c.moveTo(0, y); c.lineTo(s, y + Math.random() * 2 - 1); c.stroke(); }
    }); },
    noise() { return Tex.canvas(256, (c, s) => { c.fillStyle = '#909090'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 9000, 90, 200, 0.5); }); },
    // ---- map textures (Construct) ----
    tiles() { return Tex.canvas(512, (c, s) => {                    // square paving tiles, 5 per 2 m
      c.fillStyle = '#8c8c89'; c.fillRect(0, 0, s, s); const n = 5, t = s / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 150 + Math.random() * 26 | 0; c.fillStyle = `rgb(${v},${v - 2},${v - 5})`; c.fillRect(x * t + 3, y * t + 3, t - 6, t - 6); }
      Tex.noise(c, s, 14000, 110, 200, 0.22);
      for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '90,88,84' : '200,196,188'},0.08)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 6 + Math.random() * 30, 0, 7); c.fill(); }
    }); },
    plaster() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#d8cda9'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 16000, 170, 230, 0.2);
      for (let i = 0; i < 45; i++) { c.fillStyle = `rgba(${Math.random() < .6 ? '150,140,110' : '240,235,215'},0.07)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 60, 0, 7); c.fill(); }
    }); },
    wplaster() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#e6e5df'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 14000, 195, 250, 0.18);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${Math.random() < .6 ? '185,185,178' : '250,250,246'},0.05)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 60, 0, 7); c.fill(); }
    }); },
    asphalt() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#3a3c3f'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 26000, 30, 110, 0.35);
      for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '20,21,23' : '90,92,95'},0.08)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 50, 0, 7); c.fill(); }
    }); },
    plasterred() { return Tex.canvas(512, (c, s) => {
      c.fillStyle = '#a6524d'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 16000, 90, 170, 0.22);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${Math.random() < .6 ? '110,50,45' : '200,120,110'},0.08)`; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 50, 0, 7); c.fill(); }
    }); },
    brick() { return Tex.canvas(512, (c, s) => {                    // red brick, 16 courses per 2 m
      c.fillStyle = '#b3a797'; c.fillRect(0, 0, s, s); const rows = 16, h = s / rows, w = h * 2.1;
      for (let r = 0; r < rows; r++) for (let x = -(r % 2) * w / 2; x < s; x += w) { const l = 30 + Math.random() * 12, hue = 8 + Math.random() * 8; c.fillStyle = `hsl(${hue},48%,${l}%)`; c.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3); }
      Tex.noise(c, s, 12000, 60, 160, 0.18);
    }); },
    roof() { return Tex.canvas(256, (c, s) => { c.fillStyle = '#3b3d40'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 12000, 30, 110, 0.4); }); },
    facade_w() { return Tex.canvas(256, (c, s) => {                // white modern block: big windows, balcony slab
      c.fillStyle = '#e9eaea'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 3000, 200, 245, 0.25);
      const g = c.createLinearGradient(0, 40, 0, 200); g.addColorStop(0, '#5f7482'); g.addColorStop(1, '#27323b'); c.fillStyle = g; c.fillRect(22, 36, 212, 160);
      c.fillStyle = 'rgba(210,225,235,.25)'; c.fillRect(22, 36, 70, 160); c.fillStyle = '#d8dada'; c.fillRect(124, 36, 6, 160);
      c.fillStyle = '#f4f5f5'; c.fillRect(0, 196, s, 22); c.fillStyle = '#b9bcbd'; c.fillRect(0, 216, s, 5);
      c.fillStyle = 'rgba(40,45,50,.55)'; for (let x = 6; x < s; x += 14) c.fillRect(x, 178, 3, 18); c.fillRect(0, 176, s, 4);
    }); },
    facade_t() { return Tex.canvas(256, (c, s) => {                // tall white tower: piers + dark glass bands
      c.fillStyle = '#e4e4e0'; c.fillRect(0, 0, s, s); Tex.noise(c, s, 3000, 195, 240, 0.25);
      c.fillStyle = '#2d3942'; c.fillRect(0, 70, s, 110); c.fillStyle = 'rgba(190,210,225,.3)'; c.fillRect(0, 70, s, 30);
      c.fillStyle = '#d6d6d1'; c.fillRect(0, 60, s, 12); c.fillRect(0, 178, s, 12); c.fillStyle = '#c9c9c4'; for (let x = 0; x < s; x += 64) c.fillRect(x, 60, 8, 130);
    }); },
    facade_a1() { return Tex.facade('#cdbf9f', '#40464c', '#e3dccb'); },
    facade_a2() { return Tex.facade('#a9a49c', '#343b42', '#d6d2c8'); },
    facade_a3() { return Tex.facade('#c29f7c', '#3a3530', '#ecdfcd'); },
    facade_a4() { return Tex.facade('#9aa3a8', '#2e3740', '#dfe4e6'); },
  },
  // old apartment bay: wall, window with frame and sill, the odd balcony
  facade(wall, glass, trim) {
    return Tex.canvas(256, (c, s) => {
      c.fillStyle = wall; c.fillRect(0, 0, s, s); Tex.noise(c, s, 6000, 90, 210, 0.22);
      c.fillStyle = trim; c.fillRect(50, 50, 156, 150); c.fillStyle = glass; c.fillRect(58, 58, 140, 134);
      c.fillStyle = 'rgba(200,215,225,.18)'; c.fillRect(58, 58, 60, 134); c.fillStyle = trim; c.fillRect(124, 58, 7, 134); c.fillRect(58, 110, 140, 6);
      c.fillStyle = trim; c.fillRect(42, 200, 172, 10); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(42, 210, 172, 6);
    });
  },
};

// custom (non-Mats) PBR materials must be set up for the cascaded shadow lights, or each cascade lights them like its own sun;
// extra shader edits go in onBeforeCompile *after* this (CSM replaces the hook)
function csmMat(m, edit) {
  if (R.csm && R.path === 'pbr') R.csm.setupMaterial(m);
  const base = m.onBeforeCompile; m.onBeforeCompile = function (sh, r) { if (base) base.call(this, sh, r); if (edit) edit(sh); };
  return m;
}
const Mats = {
  cache: new Map(), toonGrad: null,
  grad() {
    if (this.toonGrad) return this.toonGrad;
    const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return (this.toonGrad = t);
  },
  // get(type, color, opts) -> material appropriate for the current render path
  get(type, color, plain, nw) {   // nw: no PS1 vertex snapping / affine warping (floors and map pieces)
    const D = MATDEFS[type] || (type.startsWith('ground') ? null : MATDEFS.plastic);
    const path = plain ? 'plain' : R.path;
    const col = color || (D ? D.tint : '#ffffff');
    const key = path + '|' + type + '|' + col + (R.csm && !plain ? '|csm' : '') + (nw && path === 'ps1' ? '|nw' : '');
    let m = this.cache.get(key);
    if (m) return m;
    if (type === 'ground' || type.startsWith('ground_')) {
      const tk = type === 'ground' ? 'ground' : type.slice(7), map = Tex.make(tk, true);
      if (path === 'ps1') m = new THREE.MeshLambertMaterial({ color: '#ffffff', map: Tex.ps1(tk) });   // the ground never warps
      else m = new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.92, metalness: 0, roughnessMap: Tex.make('noise', false) });
      m.userData.outlineParameters = { visible: false };
    } else if (path === 'ps1') {
      if (D.emissive) m = new THREE.MeshBasicMaterial({ color: col });
      else m = new THREE.MeshLambertMaterial({ color: col, map: D.tex ? Tex.ps1(D.tex) : null, transparent: !!D.glass, opacity: D.glass ? 0.45 : 1, depthWrite: !D.glass });
      if (!nw) PS1.patch(m);
    } else {
      if (D.glass) {
        m = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.5, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide });
      } else if (D.emissive) {
        m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.6, roughness: 0.3 });
      } else {
        const p = { color: col, roughness: D.rough, metalness: D.metal, envMapIntensity: 1 };
        if (D.tex === 'wood' || D.tex === 'dev' || D.tex === 'concrete') p.map = Tex.make(D.tex, true);
        if (D.tex === 'brushed' || D.tex === 'noise' || D.tex === 'concrete') p.roughnessMap = Tex.make(D.tex, false);
        if (D.tex === 'brushed') { p.map = Tex.make('brushed', true); }
        m = new THREE.MeshStandardMaterial(p);
      }
    }
    if (R.csm && !plain && path === 'pbr') R.csm.setupMaterial(m);
    this.cache.set(key, m);
    return m;
  },
  rebuildAll() {
    const old = [...this.cache.values()]; this.cache.clear();
    R.scene.traverse(o => { if (o.isMesh && o.userData.mt) o.material = this.get(o.userData.mt, o.userData.mc, false, o.userData.nw); else if (o.isMesh && o.userData.remat) o.material = o.userData.remat(); });
    for (const m of old) m.dispose();
  },
};
// A mesh whose material follows the render path (toon/pbr) and painter changes
function matMesh(geo, type, color, nw) {
  const m = new THREE.Mesh(geo, Mats.get(type, color, false, nw));
  m.userData.mt = type; m.userData.mc = color || null; m.userData.nw = !!nw; m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---- geometry helpers ------------------------------------------------------
const Geo = {
  cache: new Map(),
  get(key, make) { let g = this.cache.get(key); if (!g) { g = make(); this.cache.set(key, g); } return g; },
  // box whose UVs are in world units (1 texture = 2 m) so map pieces tile nicely at any size
  worldBox(w, hgt, d) {
    return this.get(`wb${w},${hgt},${d}`, () => {
      const seg = v => Math.max(1, Math.min(12, Math.ceil(v / 2)));   // ~2 m quads so PS1 affine textures don't smear
      const g = new THREE.BoxGeometry(w, hgt, d, seg(w), seg(hgt), seg(d)), uv = g.attributes.uv, P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {   // box projection, 1 texture = 2 m
        const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i));
        if (ax > 0.5) uv.setXY(i, (P.getZ(i) + d / 2) / 2, (P.getY(i) + hgt / 2) / 2);
        else if (ay > 0.5) uv.setXY(i, (P.getX(i) + w / 2) / 2, (P.getZ(i) + d / 2) / 2);
        else uv.setXY(i, (P.getX(i) + w / 2) / 2, (P.getY(i) + hgt / 2) / 2);
      }
      return g;
    });
  },
  wedge(w, hgt, d) {
    return this.get(`wg${w},${hgt},${d}`, () => {
      const x = w / 2, y = hgt / 2, z = d / 2;
      const P = { a: [-x, -y, z], b: [x, -y, z], c: [x, -y, -z], d: [-x, -y, -z], e: [-x, y, -z], f: [x, y, -z] };
      const pos = [], uvs = [];
      const quad = (p1, p2, p3, p4, u, v) => { pos.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4); uvs.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v); };
      const tri = (p1, p2, p3, uv) => { pos.push(...p1, ...p2, ...p3); uvs.push(...uv); };
      const sl = Math.hypot(hgt, d) / 2;
      quad(P.a, P.d, P.c, P.b, d / 2, w / 2);       // bottom
      quad(P.d, P.e, P.f, P.c, hgt / 2, w / 2);     // back
      quad(P.a, P.b, P.f, P.e, w / 2, sl);          // slope
      tri(P.a, P.e, P.d, [0, 0, d / 2, hgt / 2, d / 2, 0]);  // left side
      tri(P.b, P.c, P.f, [0, 0, d / 2, 0, d / 2, hgt / 2]);  // right side
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals(); return g;
    });
  },
};
function wedgePoints(w, hgt, d) { const x = w / 2, y = hgt / 2, z = d / 2; return new Float32Array([-x, -y, z, x, -y, z, x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z]); }

// ---- Blender-built models ------------------------------------------------
// Mesh materials in the GLB are SLOT names; each slot maps to a game material so the
// toon/PBR tiers, CSM shadows and the painter keep working. 'main' = the entity's own material + color.
const SLOT_MATS = {
  trim: ['plastic', '#2a2c31'], metal: ['metal', '#c9ced6'], darkmetal: ['metal', '#4a505a'], rubber: ['rubber', '#26282d'],
  glass: ['glass', null], light: ['neon', '#fff3c4'], redlight: ['neon', '#ff3b30'], white: ['plastic', '#f2f2f2'],
  accent: ['neon', '#4dd0e1'], fabric: ['plastic', '#2f3238'], hair: ['plastic', '#3a2a1e'], visor: ['metal', '#141820'],
  sleeve: ['plastic', '#3a3f4b'], second: ['plastic', '#fed330'], skin: ['plastic', '#e0ac7e'], red: ['plastic', '#d63031'], wood: ['wood', null],
  book1: ['plastic', '#8e2f2f'], book2: ['plastic', '#2f4f8e'], book3: ['plastic', '#3e7a3e'], book4: ['plastic', '#c9a23a'],
};
// weapon models: main slot material, first-person offset from the camera (vm), and muzzle point (tracers / physgun beam) in first-person space
const WEAPON_MODEL = {
  physgun: { t: 'metal', c: '#39404d', muzzle: [0, 0, -0.43], vm: [0.2, -0.17, -0.66] },
  toolgun: { t: 'plastic', c: '#fed330', muzzle: [0, 0, -0.32], vm: [0.2, -0.19, -0.56] },
  pistol: { t: 'metal', c: '#2a2c31', muzzle: [0, 0.018, -0.155], vm: [0.19, -0.17, -0.5] },
  rifle: { t: 'plastic', c: '#3d4a32', muzzle: [0, 0, -0.65], vm: [0.17, -0.17, -0.74] },
  grenade: { t: 'plastic', c: '#4b5b3a', muzzle: [0, 0, -0.06], vm: [0.2, -0.16, -0.5] },
  crowbar: { t: 'metal', c: '#c0392b', muzzle: [0, 0.24, -0.47], vm: [0.22, -0.2, -0.52] },
  shotgun: { t: 'metal', c: '#2e3238', muzzle: [0, 0.022, -0.66], vm: [0.18, -0.17, -0.62] },
  sniper: { t: 'plastic', c: '#6b6247', muzzle: [0, 0.008, -0.88], vm: [0.17, -0.16, -0.72] },
  rocket: { t: 'plastic', c: '#55653f', muzzle: [0, 0.06, -0.64], vm: [0.2, -0.2, -0.46] },
  propcannon: { t: 'plastic', c: '#ff9f43', muzzle: [0, 0, -0.52], vm: [0.2, -0.17, -0.52] },
  deleter: { model: 'toolgun', t: 'plastic', c: '#e0463c', muzzle: [0, 0, -0.32], vm: [0.2, -0.19, -0.56] },
};
// reference sizes the models were authored at (scaled to the entity's collider)
const MODEL_REF = { crate: { box: [1, 1, 1] }, mcrate: { box: [1, 1, 1] }, cblock: { box: [1.2, 0.6, 0.6] }, barrel: { cyl: [0.34, 1] }, cone: { cyl: [0.24, 0.7] } };
const DEFAULT_VIS = { seat: 'seat', wheel: 'wheel' };
const Models = {
  src: {}, srcPs1: {},
  async load() {
    const parse = async id => {
      const el = document.getElementById(id), b64 = el ? el.textContent.trim() : '', out = {};
      if (!b64) return out;
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(bin.buffer, '');
      gltf.scene.traverse(o => { if (o.isMesh) o.userData.slot = String((o.material && o.material.name) || 'main').split('.')[0]; });
      for (const o of [...gltf.scene.children]) out[o.name] = o;
      return out;
    };
    try { this.src = await parse('tw-models'); } catch (e) { console.warn('Models failed to load, using built-in shapes', e); this.src = {}; }
    try { this.srcPs1 = await parse('tw-models-ps1'); } catch (e) { this.srcPs1 = {}; }
  },
  has(n) { return !!this.src[n]; },
  // the Low tier uses the low-poly PS1 set when it has that model
  instance(name, mainType, mainColor, extra) {
    const root = ((R.path === 'ps1' && this.srcPs1[name]) || this.src[name]).clone(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      const sl = o.userData.slot;
      let [t, c] = sl === 'main' ? [mainType, mainColor] : (SLOT_MATS[sl] || ['plastic', null]);
      if (extra && extra[sl]) c = extra[sl];
      o.material = Mats.get(t, c); o.userData.mt = t; o.userData.mc = c; o.castShadow = o.receiveShadow = true;
    });
    return root;
  },
  plain(obj) { obj.traverse(o => { if (o.isMesh && o.userData.mt) o.material = Mats.get(o.userData.mt, o.userData.mc, true); }); return obj; },
  // re-color the 'main' slot of a model instance (player color, painter, weapon tint)
  recolor(obj, type, color) {
    obj.traverse(o => { if (o.isMesh && (o.userData.slot === 'main' || !o.userData.slot)) { o.material = Mats.get(type, color); o.userData.mt = type; o.userData.mc = color; } });
  },
  fit(m, name, s) {
    const R = MODEL_REF[name];
    if (R && R.box && s.s) m.scale.set(s.s[0] / R.box[0], s.s[1] / R.box[1], s.s[2] / R.box[2]);
    else if (R && R.cyl && s.r) m.scale.set(s.r / R.cyl[0], s.h / R.cyl[1], s.r / R.cyl[0]);
    else if (name === 'wheel') { m.scale.set(s.r, s.w, s.r); const w = new THREE.Group(); w.quaternion.setFromUnitVectors(UP, _v1.fromArray(s.ax).normalize()); w.add(m); return w; }
    return m;
  },
};

// Build the visual for an entity descriptor. Returns a Group.
function buildVisual(d) {
  const g = new THREE.Group(), s = d.sh, mt = d.m || 'plastic', mc = d.c || null;
  const add = (geo, t, c, pos, quat) => { const m = matMesh(geo, t, c, d.k === 'map'); if (pos) m.position.fromArray(pos); if (quat) m.quaternion.copy(quat); g.add(m); return m; };
  const vis = d.vis || DEFAULT_VIS[s.t];
  if (vis === 'none' || (vis && Models.has(vis))) {
    if (vis !== 'none') g.add(Models.fit(Models.instance(vis, mt, mc, { hair: d.hc, second: d.c2 }), vis, s));
    if (d.thr) for (const t of d.thr) g.add(buildThruster(t));
    if (d.k === 'rocket') g.add(rocketFlame());
    if (d.veh) addVehicleWheels(g, d);
    if (d.wpn) addNpcWeapon(g, d.wpn);
    return g;
  }
  switch (s.t) {
    case 'box':
      if (d.k === 'map') add(Geo.worldBox(s.s[0], s.s[1], s.s[2]), mt, mc);
      else add(Geo.get(`rb${s.s}`, () => new RoundedBoxGeometry(s.s[0], s.s[1], s.s[2], 2, Math.min(0.035, Math.min(...s.s) * 0.2))), mt, mc);
      break;
    case 'ramp': add(Geo.wedge(s.s[0], s.s[1], s.s[2]), mt, mc); break;
    case 'ball': add(Geo.get(`sp${s.r}`, () => new THREE.SphereGeometry(s.r, 32, 20)), mt, mc); break;
    case 'cyl': {
      add(Geo.get(`cy${s.r},${s.h}`, () => new THREE.CylinderGeometry(s.r, s.r, s.h, 28)), mt, mc);
      if (s.ribs) for (const y of [-s.h * 0.28, s.h * 0.28]) add(Geo.get(`rib${s.r}`, () => new THREE.TorusGeometry(s.r * 1.01, 0.018, 6, 28).rotateX(Math.PI / 2)), mt, mc, [0, y, 0]);
      break;
    }
    case 'cap': add(Geo.get(`cp${s.r},${s.h}`, () => new THREE.CapsuleGeometry(s.r, s.h, 6, 14)), mt, mc); break;
    case 'cone': {
      add(Geo.get(`cn${s.r},${s.h}`, () => new THREE.ConeGeometry(s.r, s.h, 24)), mt, mc);
      add(Geo.get(`cnb${s.r}`, () => new THREE.BoxGeometry(s.r * 2.3, 0.04, s.r * 2.3)), mt, mc, [0, -s.h / 2 + 0.02, 0]);
      add(Geo.get(`cns${s.r},${s.h}`, () => new THREE.CylinderGeometry(s.r * 0.52, s.r * 0.66, s.h * 0.16, 24, 1, true)), 'plastic', '#f5f5f5', [0, s.h * 0.05, 0]);
      break;
    }
    case 'wheel': {
      const q = new QT().setFromUnitVectors(UP, _v1.fromArray(s.ax).normalize());
      add(Geo.get(`wh${s.r},${s.w}`, () => new THREE.CylinderGeometry(s.r, s.r, s.w, 30)), 'rubber', mc, null, q);
      add(Geo.get(`whh${s.r},${s.w}`, () => new THREE.CylinderGeometry(s.r * 0.55, s.r * 0.55, s.w * 1.06, 20)), 'metal', '#c9ced6', null, q);
      add(Geo.get(`whk${s.r},${s.w}`, () => new THREE.BoxGeometry(s.r * 1.5, s.w * 1.08, s.r * 0.12)), 'metal', '#7a808a', null, q);
      break;
    }
    case 'seat': {
      add(Geo.get('seatb', () => new RoundedBoxGeometry(0.62, 0.14, 0.6, 2, 0.04)), mt, mc, [0, 0, 0]);
      add(Geo.get('seatk', () => new RoundedBoxGeometry(0.62, 0.62, 0.12, 2, 0.04)), mt, mc, [0, 0.36, 0.26]);
      add(Geo.get('seatc', () => new RoundedBoxGeometry(0.54, 0.06, 0.5, 2, 0.025)), 'plastic', '#2a2c31', [0, 0.09, 0.02]);
      break;
    }
    case 'light': {
      add(Geo.get('lbase', () => new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20)), 'metal', '#7a808a', [0, -0.12, 0]);
      add(Geo.get('lbulb', () => new THREE.SphereGeometry(0.16, 20, 14)), 'neon', d.light ? d.light.c : '#ffd9a0', [0, 0.05, 0]);
      break;
    }
    case 'spawn': {
      const ring = add(Geo.get('spr', () => new THREE.TorusGeometry(0.55, 0.05, 8, 40).rotateX(Math.PI / 2)), 'neon', '#4dd0e1');
      const ar = add(Geo.get('spa', () => new THREE.ConeGeometry(0.18, 0.4, 3).rotateX(Math.PI / 2)), 'neon', '#4dd0e1', [0, 0.1, 0.55]);
      ring.castShadow = ar.castShadow = false; g.userData.editOnly = true;
      break;
    }
    case 'multi': for (const b of s.b) if (!b[6]) add(Geo.get(`mb${b}`, () => new RoundedBoxGeometry(b[0], b[1], b[2], 2, 0.03)), mt, mc, [b[3], b[4], b[5]]); break;
    case 'chair': {
      add(Geo.get('chs', () => new RoundedBoxGeometry(0.46, 0.05, 0.44, 2, 0.01)), mt, mc);
      add(Geo.get('chb', () => new RoundedBoxGeometry(0.46, 0.5, 0.04, 2, 0.01)), mt, mc, [0, 0.275, -0.2]);
      for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) add(Geo.get('chl', () => new THREE.BoxGeometry(0.045, 0.45, 0.045)), mt, mc, [x, -0.25, z]);
      break;
    }
    case 'table': {
      const [w, hh, dd] = s.s;
      add(Geo.get(`tbt${s.s}`, () => new RoundedBoxGeometry(w, 0.05, dd, 2, 0.012)), mt, mc, [0, hh / 2 - 0.025, 0]);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(Geo.get(`tbl${hh}`, () => new THREE.BoxGeometry(0.06, hh - 0.05, 0.06)), mt, mc, [x * (w / 2 - 0.08), -0.025, z * (dd / 2 - 0.08)]);
      break;
    }
    case 'rocket': {
      add(Geo.get('rkb', () => new THREE.CylinderGeometry(0.045, 0.045, 0.5, 14).rotateX(Math.PI / 2)), 'plastic', '#55653f');
      add(Geo.get('rkn', () => new THREE.ConeGeometry(0.045, 0.14, 14).rotateX(-Math.PI / 2).translate(0, 0, -0.32)), 'metal', '#4a505a');
      g.add(rocketFlame());
      break;
    }
    case 'nade': {
      add(Geo.get('nade', () => new THREE.SphereGeometry(0.09, 16, 12)), 'metal', '#3d4a32');
      add(Geo.get('nadep', () => new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10)), 'metal', '#9aa0a8', [0, 0.1, 0]);
      break;
    }
  }
  if (d.thr) for (const t of d.thr) g.add(buildThruster(t));
  if (d.veh) addVehicleWheels(g, d);
  if (d.board) g.add(boardFace(d));
  return g;
}
// billboard picture: the painted image (data URL) or a "paint me" placeholder, on the panel's front
const BoardTex = { cache: new Map(), blank: null };
function boardTexture(url) {
  if (!url) {
    if (!BoardTex.blank) {
      const c = Tex.canvas(256, (x, S) => { x.fillStyle = '#e9e6df'; x.fillRect(0, 0, S, S); x.fillStyle = '#6b6f78'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText('PRESS E TO PAINT', S / 2, S / 2 + 9); });
      BoardTex.blank = new THREE.CanvasTexture(c); BoardTex.blank.colorSpace = THREE.SRGBColorSpace;
    }
    return BoardTex.blank;
  }
  let t = BoardTex.cache.get(url);
  if (!t) {
    const img = new Image(); t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    img.onload = () => { t.needsUpdate = true; }; img.src = url;
    BoardTex.cache.set(url, t); if (BoardTex.cache.size > 24) BoardTex.cache.delete(BoardTex.cache.keys().next().value);
  }
  return t;
}
function boardFace(d) {
  const m = new THREE.Mesh(Geo.get('boardface', () => new THREE.PlaneGeometry(4.0, 2.0)), new THREE.MeshStandardMaterial({ map: boardTexture(d.img), roughness: 0.85, metalness: 0 }));
  m.material.userData.outlineParameters = { visible: false }; m.position.set(0, 2.5, 0.062); m.name = 'boardface';
  return m;
}
// wheel visuals for a raycast vehicle: vw<i> (suspension + steering) > spin (rolling) > tyre
function addVehicleWheels(g, d) {
  const V = VEH[d.veh]; if (!V) return;
  V.w.forEach((w, i) => {
    const steer = new THREE.Group(); steer.name = 'vw' + i; steer.position.set(w[0], w[1], w[2]);
    const spin = new THREE.Group(); spin.name = 'spin'; steer.add(spin);
    const sh = { r: V.r, w: V.wd, ax: [w[0] < 0 ? 1 : -1, 0, 0] };   // hub side faces outward
    if (Models.has('wheel')) spin.add(Models.fit(Models.instance('wheel', 'rubber', '#26282d'), 'wheel', sh));
    else { const m = matMesh(Geo.get(`vwc${V.r},${V.wd}`, () => new THREE.CylinderGeometry(V.r, V.r, V.wd, 24).rotateZ(Math.PI / 2)), 'rubber', '#26282d'); spin.add(m); }
    g.add(steer);
  });
}
// armed NPCs: the weapon model sits in the right hand, barrel along the forearm (which points at the target when aiming)
function addNpcWeapon(g, w) {
  const mk = 'wp_' + w, W = WEAPON_MODEL[w]; if (!W || !Models.has(mk)) return;
  const m = Models.instance(mk, W.t, W.c), hand = m.getObjectByName(mk + '_hand'); if (hand) hand.visible = false;
  m.rotation.x = -Math.PI / 2; m.position.set(0, -0.19, -0.06); m.name = 'npcgun'; g.add(m);
}
function rocketFlame() {
  const f = new THREE.Mesh(Geo.get('rkf', () => new THREE.ConeGeometry(0.05, 0.5, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.55)),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  f.material.userData.outlineParameters = { visible: false }; f.castShadow = false; f.name = 'flame';
  return f;
}
function buildThruster(t) {
  const grp = new THREE.Group(); grp.userData.thr = t.id;
  const dir = _v1.fromArray(t.d).normalize();
  grp.position.fromArray(t.p); grp.quaternion.setFromUnitVectors(UP, dir.clone().negate()); // nozzle points opposite the force
  const body = matMesh(Geo.get('thb', () => new THREE.CylinderGeometry(0.1, 0.14, 0.26, 16).translate(0, 0.13, 0)), 'metal', '#5b6270');
  const flame = new THREE.Mesh(Geo.get('thf', () => new THREE.ConeGeometry(0.1, 0.7, 12, 1, true).translate(0, 0.62, 0)),
    new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.material.userData.outlineParameters = { visible: false };
  flame.visible = false; flame.name = 'flame';
  grp.add(body, flame); return grp;
}
