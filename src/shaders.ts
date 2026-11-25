export const NOISE = /* glsl */ `
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5;} return s/0.9375; }
vec2 voronoi(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(hash21(i+g), hash21(i+g+19.7));
    vec2 r=g+o-f; float d=dot(r,r); if(d<d1){d2=d1;d1=d;} else if(d<d2){d2=d;} }
  return vec2(sqrt(d1), sqrt(d2)); }
`;

/** Pass 1: geometry → G-buffer (watercolor base, ink patterns, normals/depth, ids). */
export const gbufVert = /* glsl */ `
precision highp float;
in vec3 position; in vec2 puv; in float mat; in float vari; in float oid;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec4 uSway; uniform float uTime;
out vec3 vWorld; out vec2 vUv; out float vViewZ; out float vLocalY;
flat out float vMat; flat out float vVar; flat out float vId;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.);
  vLocalY = position.y;
  float hy = max(wp.y - uSway.y, 0.)/10.;
  wp.x += uSway.w*hy*hy*sin(uTime*1.7 + uSway.x);
  wp.z += uSway.w*hy*hy*0.6*cos(uTime*1.3 + uSway.z);
  vWorld = wp.xyz; vUv = puv; vMat = mat; vVar = vari; vId = oid;
  vec4 vp = viewMatrix*wp; vViewZ = -vp.z;
  gl_Position = projectionMatrix*vp;
}`;

export const gbufFrag = /* glsl */ `
precision highp float;
in vec3 vWorld; in vec2 vUv; in float vViewZ; in float vLocalY;
flat in float vMat; flat in float vVar; flat in float vId;
uniform vec3 uPal[17]; uniform vec3 uShade, uLight, uFrame;
uniform vec3 uSun; uniform vec3 uCam; uniform float uFar;
uniform sampler2D uShadow; uniform mat4 uLightVP;
uniform float uHatch, uDetail, uNight;
uniform vec2 uFade; // radius where paint starts / ends fading
uniform float uSea;
uniform float uReveal; uniform float uClip;
uniform float uSketch; uniform vec2 uIvy; uniform float uTime;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
layout(location=2) out vec4 oInfo;
${NOISE}

float lineAA(float d, float fw, float px){ return 1. - smoothstep(px*fw*.5, px*fw*.5 + fw, d); }

float shadowAt(vec3 wp, vec3 N){
  vec4 lp = uLightVP*vec4(wp + N*0.08, 1.);
  vec3 s = lp.xyz/lp.w*.5+.5;
  if(any(lessThan(s.xy, vec2(0.))) || any(greaterThan(s.xy, vec2(1.)))) return 1.;
  float acc = 0.; vec2 t = vec2(1./2048.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++)
    acc += step(s.z - 0.0015, texture(uShadow, s.xy + vec2(x,y)*t*1.5).r);
  return acc/9.;
}

// distance-to-grid line helper with hand jitter; cell in world units
float gridInk(vec2 p, vec2 cell, float rowShift, float keepP, float seed, float px){
  float row = floor(p.y/cell.y);
  float ws = 0.65 + 0.7*hash11(row*7.13 + seed);
  vec2 c = vec2(cell.x*ws, cell.y);
  vec2 q = vec2(p.x + hash11(row + seed)*c.x*rowShift, p.y);
  vec2 id = floor(q/c), f = fract(q/c);
  vec2 d = min(f, 1.-f)*c;
  float fw = length(fwidth(p));
  float keep = step(hash21(id + seed), keepP);
  // draw bottom + one vertical side per kept cell, sketch style
  float l = max(lineAA(d.y, fw, px)*step(.5,1.-f.y)*1., lineAA(d.x, fw, px)*step(f.x,.5));
  float fade = smoothstep(min(c.x,c.y)*0.45, min(c.x,c.y)*0.12, fw);
  return l*keep*fade;
}

float cellHash(vec2 p, vec2 cell, float rowShift, float seed){
  float row = floor(p.y/cell.y);
  float ws = 0.65 + 0.7*hash11(row*7.13 + seed);
  vec2 c = vec2(cell.x*ws, cell.y);
  vec2 q = vec2(p.x + hash11(row + seed)*c.x*rowShift, p.y);
  return hash21(floor(q/c) + seed + 11.);
}

float pattern(int m, vec2 p, float dark, float seed){
  float fw = length(fwidth(p));
  vec2 j = vec2(vnoise(p*1.7+seed), vnoise(p*1.7+seed+5.))-.5;
  vec2 q = p + j*0.06;
  float keep = 0.18 + 0.55*dark;
  if(m==0){ // stone: irregular blocks, sketched sparsely
    return gridInk(q, vec2(0.95,0.48), 1., keep, seed, 1.1);
  } else if(m==1){ // plaster: occasional exposed stones + cracks
    float s = gridInk(q, vec2(0.7,0.36), 1., 0.07 + 0.15*dark, seed+3., 1.0);
    float cr = lineAA(abs(vnoise(q*vec2(1.3,2.7)+seed)-.5), fw*2.7, 0.8) * step(0.8, vnoise(q*0.6+seed*3.));
    return max(s, cr*0.6);
  } else if(m==2){ // planks: horizontal boards with breaks
    float y = q.y/0.3; float d = abs(fract(y)-.5)*0.3; float l = lineAA(0.15-d, fw, 1.0);
    float brk = step(0.25, vnoise(vec2(q.x*0.9, floor(y)*3.7+seed)));
    float joint = lineAA(abs(fract(q.x/2.1 + hash11(floor(y)+seed))-.5)*2.1 - 1.04, fw, 1.0);
    return max(l*brk, joint*0.0) * smoothstep(0.12,0.04,fw) * (0.55+0.45*dark+0.2);
  } else if(m==3){ // brick
    return gridInk(q, vec2(0.48,0.2), 0.5, 0.25 + 0.5*dark, seed, 0.9);
  } else if(m==4 || m==5){ // slate / clay tiles: rows of courses
    float rowH = m==4 ? 0.32 : 0.36;
    float row = floor(q.y/rowH); float fy = fract(q.y/rowH);
    float hl = lineAA(min(fy,1.-fy)*rowH, fw, 1.0) * step(0.3, vnoise(vec2(q.x*0.7, row*5.1+seed)));
    float cw = m==4 ? 0.42 : 0.3;
    float xx = q.x/cw + row*0.5; float fx = fract(xx);
    float vl = lineAA(min(fx,1.-fx)*cw, fw, 0.9) * step(fy, 0.55) * step(hash21(vec2(floor(xx), row)+seed), 0.35+0.5*dark);
    if(m==5){ // scalloped edge on clay tiles
      float sc = abs(fy - 0.15*(1.-pow(abs(fx*2.-1.),2.)));
      hl = max(hl, lineAA(sc*rowH, fw, 0.9) * step(hash21(vec2(floor(xx),row)+seed+3.), 0.25+0.5*dark));
    }
    return max(hl, vl) * smoothstep(rowH*0.5, rowH*0.15, fw);
  } else if(m==6){ // copper: standing seams
    float fx = fract(q.x/0.45); float l = lineAA(min(fx,1.-fx)*0.45, fw, 1.0);
    float fy = fract(q.y/1.1); float h = lineAA(min(fy,1.-fy)*1.1, fw, 0.8)*0.5;
    return max(l*0.8, h) * smoothstep(0.2,0.06,fw);
  } else if(m==9){ // rock: cracks
    vec2 v = voronoi(q*vec2(0.9,1.3)+seed);
    float l = lineAA(v.y-v.x, fw*1.1, 1.2) * step(0.35, vnoise(q*0.8));
    float strokes = lineAA(abs(fract(q.y*2.2 + vnoise(q*0.5)*2.)-.5)*0.45, fw, 0.9)*step(0.55, vnoise(q*vec2(0.5,3.)))*dark;
    return max(l, strokes*0.8);
  } else if(m==10){ // grass: little ticks
    vec2 c = q/0.45 + vec2(vnoise(q*0.9)*1.3, vnoise(q*0.9+7.)*1.3); vec2 id = floor(c); vec2 f = fract(c)-.5;
    float on = step(hash21(id+seed), 0.18 + 0.3*dark) * step(0.5, vnoise(q*0.3 + seed));
    float l = lineAA(abs(f.x + f.y*0.35)*0.45, fw, 1.2) * step(abs(f.y), 0.38);
    return l*on*smoothstep(0.25,0.08,fw);
  } else if(m==13){ // cobbles
    vec2 v = voronoi(q*2.6+seed);
    return lineAA((v.y-v.x)/2.6, fw, 1.0) * step(0.35 - 0.3*dark, vnoise(q*0.7)) * smoothstep(0.12,0.04,fw);
  } else if(m==7 || m==11){ // window / door use normalized uv
    return 0.;
  }
  return 0.;
}

float hatch(vec2 p, float tone, vec3 w, float seed){
  if(uHatch < .5) return 0.;
  float fw = length(fwidth(p));
  float s = 0.24;
  float jit = (vnoise(p*1.1+seed)-.5)*0.35;
  float t1 = dot(p, vec2(0.6,0.8))/s + jit;
  float l1 = lineAA(abs(fract(t1)-.5)*s, fw, 1.0) * step(0.45, vnoise(vec2(dot(p,vec2(0.8,-0.6))*1.6, floor(t1)*3.1)));
  float t2 = dot(p, vec2(0.85,-0.5))/s*1.1 - jit;
  float l2 = lineAA(abs(fract(t2)-.5)*s, fw, 0.9) * step(0.5, vnoise(vec2(dot(p,vec2(0.5,0.85))*1.6, floor(t2)*2.3)));
  float h1 = smoothstep(0.48, 0.32, tone), h2 = smoothstep(0.26, 0.14, tone);
  float patchy = mix(0.45, 1., smoothstep(0.3, 0.6, vnoise(w.xz*0.25 + w.y*0.2)));
  float fade = smoothstep(s*0.55, s*0.2, fw);
  return max(l1*h1, l2*h2)*patchy*fade*0.6;
}

void main(){
  if(vLocalY < uClip) discard;
  if(vWorld.y > uReveal + (vnoise(vWorld.xz*1.3 + vWorld.y*0.2) - .5)*1.2) discard;
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(uCam - vWorld);
  if(dot(N,V) < 0.) N = -N;
  int m = int(vMat + .5);
  vec3 base = uPal[m];
  float seed = hash11(vId)*50.;
  base *= 0.86 + 0.28*vVar;
  base = mix(base, base*vec3(1.05,0.97,0.92), (hash11(vId*3.1)-.5)*0.8);
  // wash mottling, anchored to the world
  float mott = fbm(vWorld.xz*0.3 + vec2(vWorld.y*0.27, -vWorld.y*0.21));
  base *= 0.88 + 0.24*mott;
  if(m==0 || m==3 || m==1){
    vec2 cell = m==3 ? vec2(0.48,0.2) : m==1 ? vec2(1.4,0.7) : vec2(0.95,0.48);
    float h = cellHash(vUv, cell, m==3 ? 0.5 : 1., seed);
    float amt = m==1 ? 0.06 : 0.16;
    base *= 1. + (h-.5)*2.*amt*step(0.45, hash11(h*91.));
    base = mix(base, vec3(dot(base, vec3(.33))), step(0.9, h)*0.35); // a few pale/grey stones
  }

  // ivy creeping up old masonry
  float ivyM = 0.; float ivyLeaf = 0.;
  if(uIvy.x > 0.01 && (m==0 || m==3 || m==1) && abs(N.y) < 0.5){
    float hgt = vWorld.y - uIvy.y;
    float reach = uIvy.x*8.;
    float n = fbm(vWorld.xz*0.8 + vec2(vWorld.y*0.45, seed));
    ivyLeaf = vnoise(vec2(dot(vWorld.xz, vec2(0.7, 0.7)), vWorld.y)*9.) * 0.7 + vnoise(vWorld.xz*3. + vWorld.y*4.) * 0.3;
    ivyM = step(0., hgt) * (1. - smoothstep(0.45, 0.6, hgt/max(reach, 0.01) + (0.55 - n)*1.3)) * step(0.38, ivyLeaf);
    base = mix(base, mix(base, uPal[10]*vec3(0.6, 0.78, 0.55)*(0.75 + 0.5*ivyLeaf), 0.8), ivyM);
  }
  float sh = shadowAt(vWorld, N);
  float nl = dot(N, uSun);
  float lit = smoothstep(-0.05, 0.3, nl) * sh;
  float sky = 0.5 + 0.5*N.y;
  float tone = clamp(0.24 + 0.62*lit + 0.14*sky, 0., 1.);
  vec3 col = base * mix(uShade, uLight, tone);

  float dark = 1. - tone;
  float ink = 0.;
  float emis = 0.;
  if(m==7){ // window: cream frame + mullions on dark glass; arched / round cut here
    vec2 u = vUv; vec2 fw = fwidth(u);
    float shape = u.x > 1.5 ? floor(u.x/2.) : 0.;
    u.x -= shape*2.;
    float edge = min(min(u.x,1.-u.x), min(u.y,1.-u.y));
    if(shape == 1.){
      if(u.y > 0.68){
        vec2 e = vec2((u.x-.5)/.5, (u.y-.68)/.32);
        float r = length(e); if(r > 1.) discard;
        edge = min(min(u.x,1.-u.x), (1.-r)*0.3);
      }
    } else if(shape == 2.){
      float r = length(u-.5)*2.; if(r > 1.) discard;
      edge = (1.-r)*0.5;
    }
    float frame = 1. - smoothstep(0.07, 0.07+max(fw.x,fw.y), edge);
    float mull = 1. - smoothstep(0.035, 0.035+fw.x, abs(u.x-.5));
    float tran = 1. - smoothstep(0.03, 0.03+fw.y, shape == 2. ? abs(u.y-.5) : min(abs(u.y-.36), abs(u.y-.68)));
    float f = max(frame, max(mull, tran));
    vec3 glass = uPal[7]*(0.8 + 0.4*u.y);
    bool lit = vVar > 0.985 || vVar > 1.0 - 0.45*uNight + 0.07*sin(uTime*0.13 + vId*1.7);
    if(lit){ glass = vec3(1.0,0.78,0.38)*(0.84 + 0.2*hash11(vId) + 0.1*vnoise(vec2(uTime*2.5, vId))); emis = 1.; }
    col = mix(glass, uFrame*mix(0.75,1.,tone), f);
    ink = (1.-smoothstep(0.0, 1.5*max(fw.x,fw.y), abs(edge-0.07))) * 0.7;
    ink = max(ink, (1.-smoothstep(0.,1.5*fw.x, abs(abs(u.x-.5)-0.035)))*0.5);
    tone = mix(tone, 0.5, 0.5);
  } else if(m==11){ // door: vertical planks
    vec2 u = vUv; vec2 fw = fwidth(u);
    float fx = fract(u.x*4.); ink = (1.-smoothstep(0., 1.2*fw.x*4., min(fx,1.-fx)))*0.7;
    col *= 0.9 + 0.2*hash11(floor(u.x*4.)+seed);
  } else if(m==14){ // water: horizontal dashes
    vec2 q = vWorld.xz; float fw = length(fwidth(q));
    float row = floor(q.y/0.9); float fy = fract(q.y/0.9);
    float dash = step(0.62, vnoise(vec2(q.x*0.35, row*4.7)));
    ink = lineAA(abs(fy-.5)*0.9, fw, 1.0)*dash*0.8 * smoothstep(0.4, 0.1, fw);
    col = base * mix(0.85, 1.05, vnoise(q*0.08));
    tone = 0.7;
  } else if(m==16){ // smoke: soft wash, no texture
    col = base * mix(0.85, 1.05, tone);
    tone = mix(tone, 0.8, 0.6);
  } else {
    ink = pattern(m, vUv, dark, seed) * uDetail;
    ink = max(ink, hatch(vUv, tone, vWorld, seed));
  }

  ink = max(ink, ivyM*step(0.78, ivyLeaf)*0.55);
  float r = length(vWorld.xz);
  float paint = 1. - smoothstep(uFade.x, uFade.y, r);
  // under construction: ink sketch only, paint washes in from below
  if(vWorld.y > uSketch + (vnoise(vWorld.xz*1.1 + vWorld.y*0.3) - .5)*0.9) paint = min(paint, 0.32);
  paint *= smoothstep(-9.5, -3.5, vWorld.y) * (1. - uSea) + uSea;
  if(m==14) paint = 1. - smoothstep(uFade.x*1.2, uFade.y*2.5, r);

  oColor = vec4(col, clamp(ink,0.,1.));
  oNormal = vec4(N*.5+.5, vViewZ/uFar);
  float sens = (m==9||m==10||m==13||m==14||m==16) ? 0.5 : 1.;
  oInfo = vec4(fract(vId*0.6180339887), emis > .5 ? 2. : tone, paint, sens);
}`;

/** Pass 2: compose — wobbly ink lines, watercolor bleed, edge darkening, paper. */
export const postVert = /* glsl */ `
precision highp float;
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*.5+.5; gl_Position = vec4(position.xy, 0., 1.); }`;

export const postFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tCol, tNrm, tInfo;
uniform vec2 uRes; uniform float uBoil, uScale;
uniform vec3 uPaper, uInk, uCloudA, uCloudB; uniform float uCloud, uFadeLight;
uniform float uLineW, uWobble, uBleed;
uniform float uNight, uFog, uRain, uTime, uFlash; uniform vec3 uGlow;
out vec4 fragColor;
${NOISE}

vec2 edgeAt(vec2 uv, float r){
  vec2 px = r/uRes;
  vec4 nc = texture(tNrm, uv); vec4 ci = texture(tInfo, uv); float ic = ci.r; float oc = ci.a;
  float e = 0.; float pm = ci.b*ci.a;
  vec2 dirs[4] = vec2[4](vec2(1,0), vec2(0,1), vec2(-1,0), vec2(0,-1));
  for(int i=0;i<4;i++){
    vec2 s = uv + dirs[i]*px;
    vec4 nn = texture(tNrm, s); vec4 inf = texture(tInfo, s);
    pm = max(pm, inf.b*inf.a);
    if(oc < .25 && inf.a < .25) continue;
    if(oc < .25 || inf.a < .25){ e = max(e, 1.); continue; }
    float sens = min(oc, inf.a);
    float dz = abs(nn.a - nc.a)/max(min(nn.a, nc.a), 1e-4);
    e = max(e, smoothstep(0.025, 0.06, dz));
    float nd = 1. - dot(nn.xyz*2.-1., nc.xyz*2.-1.);
    e = max(e, sens > .75 ? smoothstep(0.12, 0.3, nd) : smoothstep(0.5, 0.9, nd)*0.7);
    e = max(e, step(0.0015, abs(inf.r - ic))*0.85);
  }
  return vec2(e, pm);
}

void main(){
  vec2 frag = vUv*uRes;
  float sc = uScale; // device pixel scale so look is resolution-independent
  vec2 f = frag/sc;
  float bs = uBoil;

  // --- ink lines: wobbly sample position, varying thickness
  vec2 wob = vec2(vnoise(f/34. + bs*7.1), vnoise(f/34. + bs*3.7 + 19.)) - .5;
  vec2 uvL = vUv + wob*2.*uWobble*sc/uRes;
  float r = uLineW*sc*(0.65 + 0.8*vnoise(f/80. + bs*2.3));
  vec2 E = edgeAt(uvL, r); float e = E.x;
  e *= mix(0.55, 1., smoothstep(0.2, 0.45, vnoise(f/11. + bs*5.)));   // dry-brush breaks
  vec2 wob2 = vec2(vnoise(f/23. + bs*4.3 + 41.), vnoise(f/23. + bs*6.1 + 73.)) - .5;
  float e2 = edgeAt(vUv + wob2*2.*uWobble*1.8*sc/uRes, uLineW*sc*0.6).x;
  e2 *= smoothstep(0.35, 0.6, vnoise(f/28. + bs*2.9 + 9.));
  e = max(e, e2*0.45);

  // --- color: bled sample, independent wobble
  vec2 wc = vec2(vnoise(f/55. + 31.), vnoise(f/55. + 57.)) - .5;
  vec2 uvC = vUv + wc*2.*uBleed*sc/uRes;
  vec4 col = texture(tCol, uvC);
  vec4 info = texture(tInfo, uvC);
  float pInk = texture(tCol, uvL).a * step(.25, texture(tInfo, uvL).a);

  // edge darkening (pigment pools at wash borders)
  vec3 avg = vec3(0.); float n = 0.;
  for(int i=0;i<6;i++){
    float a = float(i)*1.047 + 0.3;
    vec2 s = uvC + vec2(cos(a), sin(a))*5.*sc/uRes;
    vec4 c2 = texture(tCol, s); float o2 = step(.25, texture(tInfo, s).a);
    avg += mix(uPaper, c2.rgb, o2); n += 1.;
  }
  avg /= n;
  float ed = clamp(length(col.rgb - avg)*2.2, 0., 1.);
  float grain = vnoise(f/1.7)*.5 + vnoise(f/4.3)*.5;
  float turb = fbm(f/160.);
  float dens = 1. + 0.75*ed + 0.45*(turb - .5) + 0.35*(grain - .5);
  vec3 c = col.rgb;
  c = clamp(c - (c - c*c)*(dens - 1.)*1.4, 0., 1.);

  // paper
  float fib = fbm(f/2.2)*.6 + fbm(f/14.)*.4;
  vec3 paper = uPaper*(0.955 + 0.075*fib);

  // background: painted clouds
  vec3 bg = paper;
  if(uCloud > 0.){
    vec2 cu = vec2(vUv.x*uRes.x/uRes.y, vUv.y);
    float cn = fbm(cu*vec2(2.2,3.0) + vec2(1.3, 0.)) + 0.25*fbm(cu*9.);
    float m1 = smoothstep(0.52, 0.56, cn);
    float rim = m1 - smoothstep(0.56, 0.68, cn);
    vec3 cc = mix(uCloudA, uCloudB, smoothstep(0.35, 0.65, fbm(cu*1.7 + 7.)));
    bg = mix(bg, cc*(0.97 + 0.06*fib), m1*0.85*uCloud);
    bg = mix(bg, cc*0.88, rim*0.5*uCloud);
  }

  // coverage: paint dissolves into paper at the base and in highlights
  float blot = fbm(f/65. + 3.);
  float paint = info.b;
  float cov = step(.25, info.a) * smoothstep(0.35, 0.55, paint + (blot - .5)*0.55);
  float tn = info.g > 1.5 ? 0.5 : info.g;
  cov *= 1. - uFadeLight*smoothstep(0.78, 0.95, tn)*smoothstep(0.35, 0.7, blot);
  vec3 painted = mix(bg, c*(0.96 + 0.06*fib), cov);

  // ink survives longer than paint (sketchy unfinished base)
  float inkFade = smoothstep(0.05, 0.3, E.y + (blot - .5)*0.4);
  float ink = max(e, pInk*0.85) * inkFade;
  ink *= 0.82 + 0.18*grain;
  vec3 outc = mix(painted, uInk, clamp(ink, 0., 1.)*0.92);

  // fog: distance washes back to paper
  float isObj = step(.25, info.a);
  float dn = texture(tNrm, uvC).a;
  float fogA = uFog * isObj * smoothstep(0.05, 0.3, dn + (blot - .5)*0.05);
  outc = mix(outc, paper*vec3(0.97, 0.98, 1.0), fogA*0.85);

  // night: blue ink wash, stars, lit windows keep their colour and glow
  float emisC = step(1.5, info.g)*isObj;
  vec3 nightCol = outc*vec3(0.30, 0.34, 0.52);
  if(isObj < .5){
    vec2 sg = floor(f/6.);
    float st = step(0.9965, hash21(sg)) * smoothstep(0.35, 0.6, vUv.y) * (1. - uFog);
    nightCol = mix(nightCol, vec3(0.95, 0.92, 0.8), st*0.85);
  }
  outc = mix(outc, mix(nightCol, outc*1.05, emisC), uNight);
  float halo = 0.;
  for(int i=0;i<12;i++){
    float a = float(i)*2.399, rr = (2. + float(i)*1.7)*sc;
    vec4 ii = texture(tInfo, vUv + vec2(cos(a), sin(a))*rr/uRes);
    halo += step(1.5, ii.g)*step(.25, ii.a)*(1. - float(i)/13.);
  }
  outc += uGlow*(halo/5.)*uNight*(1. - uFog*0.5);

  // rain: slanted ink streaks
  if(uRain > 0.01){
    vec2 rp = vec2(f.x + f.y*0.22, f.y);
    float cid = floor(rp.x/6.); float h = hash11(cid*1.37);
    float v = fract((rp.y + uTime*(650. + 450.*h))/(170. + 130.*h) + h*13.);
    float d = abs(fract(rp.x/6.) - .5)*6.;
    float streak = step(h, 0.45*uRain) * (1. - smoothstep(0.3, 1.0, d)) * smoothstep(0.0, 0.03, v) * (1. - smoothstep(0.1, 0.22, v));
    outc *= 1. - 0.12*uRain;
    outc = mix(outc, uInk, streak*0.4);
  }

  outc = mix(outc, vec3(0.98, 0.97, 1.0), uFlash*0.55);

  // gentle vignette into paper tone
  vec2 vv = vUv - .5;
  outc = mix(outc, paper*0.92, smoothstep(0.45, 0.85, length(vv*vec2(1.0, 0.8)))*0.35);
  fragColor = vec4(outc, 1.);
}`;

/** Characters → the same G-buffer (texture colour, recoloured per part). Define SKINNED for skinned parts. */
export const charVert = /* glsl */ `
precision highp float; precision highp sampler2D;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform mat3 uUvT;
out vec3 vWorld; out vec2 vUv; out float vViewZ;
#ifdef SKINNED
in vec4 skinIndex; in vec4 skinWeight;
uniform mat4 bindMatrix, bindMatrixInverse;
uniform sampler2D boneTexture;
mat4 bone(const in float i){
  int size = textureSize(boneTexture, 0).x; int j = int(i)*4; int x = j % size; int y = j / size;
  return mat4(texelFetch(boneTexture, ivec2(x, y), 0), texelFetch(boneTexture, ivec2(x+1, y), 0),
              texelFetch(boneTexture, ivec2(x+2, y), 0), texelFetch(boneTexture, ivec2(x+3, y), 0));
}
#endif
void main(){
#ifdef SKINNED
  vec4 sv = bindMatrix*vec4(position, 1.);
  vec4 s = bone(skinIndex.x)*sv*skinWeight.x + bone(skinIndex.y)*sv*skinWeight.y
         + bone(skinIndex.z)*sv*skinWeight.z + bone(skinIndex.w)*sv*skinWeight.w;
  vec4 wp = modelMatrix*vec4((bindMatrixInverse*s).xyz, 1.);
#else
  vec4 wp = modelMatrix*vec4(position, 1.);
#endif
  vWorld = wp.xyz; vUv = (uUvT*vec3(uv, 1.)).xy;
  vec4 vp = viewMatrix*wp; vViewZ = -vp.z;
  gl_Position = projectionMatrix*vp;
}`;

export const charFrag = /* glsl */ `
precision highp float;
in vec3 vWorld; in vec2 vUv; in float vViewZ;
uniform sampler2D uMap; uniform float uId;
uniform vec4 uRecol; uniform vec3 uSkin;
uniform vec3 uShade, uLight, uSun, uCam; uniform float uFar;
uniform sampler2D uShadow; uniform mat4 uLightVP;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
layout(location=2) out vec4 oInfo;
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y)/(6.*d + e)), d/(q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.))*6. - 3.); return c.z*mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
float shadowAt(vec3 wp, vec3 N){
  vec4 lp = uLightVP*vec4(wp + N*0.08, 1.);
  vec3 s = lp.xyz/lp.w*.5+.5;
  if(any(lessThan(s.xy, vec2(0.))) || any(greaterThan(s.xy, vec2(1.)))) return 1.;
  return step(s.z - 0.002, texture(uShadow, s.xy).r);
}
void main(){
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if(dot(N, uCam - vWorld) < 0.) N = -N;
  vec3 base = texture(uMap, vUv).rgb;
  vec3 h = rgb2hsv(base);
  bool skin = h.x > 0.045 && h.x < 0.1 && h.y > 0.2 && h.y < 0.46 && h.z > 0.82;
  if(skin) base *= uSkin;
  else if(h.y > 0.12){ h.x = fract(h.x + uRecol.x); h.y = clamp(h.y*uRecol.y, 0., 1.); h.z = clamp(h.z*uRecol.z, 0., 1.); base = hsv2rgb(h); }
  else base = mix(base, hsv2rgb(vec3(uRecol.x, 0.45, h.z*uRecol.z)), uRecol.w); // dye grey cloth & metal
  float lit = smoothstep(-0.05, 0.3, dot(N, uSun))*shadowAt(vWorld, N);
  float tone = clamp(0.3 + 0.58*lit + 0.12*(0.5 + 0.5*N.y), 0., 1.);
  vec3 col = mix(base, vec3(dot(base, vec3(.333))), 0.1)*mix(uShade, uLight, tone);
  oColor = vec4(col, 0.);
  oNormal = vec4(N*.5+.5, vViewZ/uFar);
  oInfo = vec4(fract(uId*0.6180339887), tone, 1., 1.);
}`;
