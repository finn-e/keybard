// The round 5 pointing shader, copied verbatim from the design prototype
// (pointing-review-5/app.js). Keybard draws only the physical style (uStyle 0);
// the matcap and photographic branches stay so the source matches the prototype.
/* eslint-disable */
export const VS = `#version 300 es
in vec2 aPos; out vec2 vP; uniform float uHalf;
void main(){ vP = aPos * uHalf; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 outColor;
uniform int uKind;      // 0 ball, 1 touchpad, 3 bake pearl map, 4 bake matcap
uniform int uStyle;     // 0 physical, 1 matcap, 2 photographic
uniform int uMat;       // 0 pearl, 1 flake
uniform int uPhotoMode; // 0 as shot, 1 pattern only
uniform int uBake;      // matcap bake: 0 diffuse, 1 sharp, 2 soft
uniform vec2 uBakeSize;
uniform float uPx;
uniform mat3 uRot;
uniform vec3 uSeed, uDeep, uBody, uSwirl, uHi, uBase, uFlakeTint, uGround, uGlass;
uniform float uContrast, uArea, uVein;
uniform float uMetal, uRough, uCoat, uFlake, uFlakeFreq, uTilt, uHueJit, uRimDark, uDark, uRoomLift;
// multi-layer sparkle (silver and black); every value comes from SPARKLE in the script
uniform int uSpk;
uniform vec3 uSpkF, uSpkMinPx, uSpkTilt, uSpkCov, uSpkRough, uSpkRad, uSpkCol, uSpkGain;
uniform float uRimK, uBox, uSheen;   // the clear coat's Fresnel rise at the rim, set by the gloss
uniform float uCoatRough, uSpkHue, uSpkMottle, uSpkLift, uSpkCloud;
uniform vec2 uSize; uniform float uCorner;
uniform sampler2D uPat, uPhoto, uMcD, uMcS, uMcR, uGlassTex;

const float PI = 3.14159265;
const vec3 V = vec3(0.0, 0.0, 1.0);
const vec3 LB = vec3(-0.5212, 0.6949, 0.4952);
const vec3 KEY = vec3(1.0, 0.985, 0.96);

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 vnoise(vec3 p){ return vec3(snoise(p), snoise(p+vec3(31.4,7.1,2.9)), snoise(p+vec3(5.7,19.3,41.1))); }
vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec4 flakeCell(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); float best=8.0; vec3 id=vec3(0.0);
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 o=vec3(float(x),float(y),float(z)); vec3 h=hash33(i+o);
    vec3 d=o+h-f; float dd=dot(d,d);
    if(dd<best){ best=dd; id=hash33(i+o+17.17); }
  }
  return vec4(id, sqrt(best));
}

/* --- the shared studio ------------------------------------------- */
float sdRound(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
float gBox = 1.0;   // the softbox's size in the clear coat's reflection (the gloss sets it; 1 elsewhere)
float softbox(vec3 R, float rough){
  float dn = dot(R, LB);
  if (dn <= 0.05) return 0.0;
  vec3 ux = normalize(cross(vec3(0.0,0.0,1.0), LB));
  vec3 uy = cross(LB, ux);
  vec3 h = R / dn - LB;
  vec2 q = vec2(dot(h, ux), dot(h, uy));
  q.y += 0.30 * q.x * q.x;
  q /= gBox;
  float f = 0.035 + rough * 1.5;
  float sd = sdRound(q, vec2(0.50, 0.40), 0.22);
  float fe = f + 0.22 * smoothstep(-0.25, 0.45, q.y);
  float m = 1.0 - smoothstep(-fe, fe * 0.6, sd);
  m *= mix(0.08, 1.0, smoothstep(-0.40 - f, 0.36, -q.y));
  return m / (1.0 + rough * rough * 22.0);
}
float strip(vec3 R, float rough){
  float a = atan(R.y, R.x);
  float el = R.z;
  float f = 0.04 + rough * 0.5;
  float m = (1.0 - smoothstep(0.35, 0.75 + f, abs(a + 0.25))) * smoothstep(-0.14, 0.04 + f, el) * (1.0 - smoothstep(0.03, 0.22 + f, el));
  return m / (1.0 + rough * rough * 22.0);
}
vec3 room(vec3 R){
  vec3 ceil = vec3(0.16) + uRoomLift, wall = vec3(0.12) + uRoomLift * 0.6;
  vec3 floorC = mix(wall, uGround * 0.20 + wall * 0.3, smoothstep(0.0, -0.5, R.z));
  floorC = mix(floorC, uGround * 0.06 + wall * 0.25, smoothstep(-0.75, -1.0, R.z));
  return R.z > 0.0 ? mix(wall, ceil, smoothstep(0.1, 0.9, R.z)) : floorC;
}
vec3 env(vec3 R, float rough){
  vec3 rm = mix(room(R), room(normalize(R + vec3(0.0, 0.0, 0.6))), smoothstep(0.1, 0.6, rough));
  return rm + KEY * (24.0 * softbox(R, rough) + 3.2 * strip(R, rough));
}
vec3 irradiance(vec3 N){
  float k = max(dot(N, normalize(LB + vec3(0.0, 0.0, 0.25))), 0.0);
  float wrap = max((dot(N, LB) + 0.35) / 1.35, 0.0);
  vec3 amb = mix(uGround * 0.18 + 0.06, vec3(0.30), N.z * 0.5 + 0.5);
  return KEY * (0.62 * k + 0.30 * wrap * wrap) + amb;
}
float schlick(float f0, float c){ return f0 + (1.0 - f0) * pow(1.0 - c, 5.0); }
// the lacquer on every ball: uCoat its strength, uRimK how far it rises toward the rim, uCoatRough its haze
float coatF(float c){ return (0.04 + 0.96 * pow(1.0 - c, 5.0) * uRimK) * uCoat; }

/* --- matcaps: the studio above, baked into three images --------- */
vec3 dec(vec3 e){ e = min(e, vec3(0.996)); return e / (1.0 - e); }
vec2 mcUV(vec3 N){ return N.xy * 0.49 + 0.5; }
vec3 mcD(vec3 N){ return dec(texture(uMcD, mcUV(N)).rgb); }
vec3 mcS(vec3 N){ return dec(texture(uMcS, mcUV(N)).rgb); }
vec3 mcR(vec3 N){ return dec(texture(uMcR, mcUV(N)).rgb); }

/* --- pearl field (baked into an equirect map) -------------------- */
vec3 flowT(vec3 P){
  vec3 A = normalize(vec3(0.35, 1.0, 0.25));
  vec3 v = 0.55 * cross(A, P) + vnoise(P * 0.75 + uSeed * 0.37);
  v -= P * dot(v, P);
  return v / max(length(v), 0.55);
}
float fbm2(vec3 p){ return snoise(p) + 0.5 * snoise(p * 2.07 + vec3(4.1, 7.7, 1.3)); }
vec2 pearlField(vec3 P, vec3 T){
  float m = 0.0, w = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k); float wk = 1.0 - abs(fk) / 5.0;
    vec3 x = P + T * (fk * 0.13);
    vec3 q = x * 1.25 + uSeed;
    q += 0.30 * vnoise(q * 0.6);
    m += wk * fbm2(q); w += wk;
  }
  m /= w;
  float f = 0.0, fw = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k); float wk = 1.0 - abs(fk) / 5.0;
    vec3 x = P + T * (fk * 0.035);
    f += wk * snoise(x * 9.0 + uSeed * 1.7); fw += wk;
  }
  f /= fw;
  float g = 0.0;
  for (int k = -3; k <= 3; k++) {
    vec3 x = P + T * (float(k) * 0.012);
    g += snoise(x * 30.0 + uSeed * 2.3);
  }
  return vec2(m * 1.7, (f + g / 7.0 * 0.35) * 2.2);
}
vec2 eqUV(vec3 d){ return vec2(atan(d.x, d.z) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5); }
void eqFrame(vec3 d, out vec3 east, out vec3 north){
  float lon = atan(d.x, d.z); float lat = asin(clamp(d.y, -1.0, 1.0));
  east = vec3(cos(lon), 0.0, -sin(lon));
  north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
}
// returns m, f and the fiber tangent (object space)
vec2 patSample(vec3 Po, out vec3 To){
  vec4 s = texture(uPat, eqUV(Po));
  vec3 e, n; eqFrame(Po, e, n);
  To = normalize(e * (s.b * 2.0 - 1.0) + n * (s.a * 2.0 - 1.0) + 1e-4);
  return vec2((s.r - 0.5) * 6.0, (s.g - 0.5) * 6.0);
}

vec3 pearlAlbedo(float m, float f, float md, out float silk){
  float th = mix(0.95, 0.35, uArea / 0.3);
  float sheet = smoothstep(th - 0.10, th + 0.22, m);
  float wisp = smoothstep(th - 0.55, th - 0.05, m) * (1.0 - sheet);
  float fib = smoothstep(-0.6, 0.9, f);
  silk = sheet * mix(0.6, 1.0, fib) + wisp * fib * 0.35;
  float deepSheet = smoothstep(th - 0.35, th + 0.25, md);
  float bodyT = smoothstep(-0.9, 0.6, m);
  vec3 col = mix(uDeep, uBody, bodyT);
  vec3 pig = mix(uSwirl, uHi, fib * sheet * 0.55);
  col = mix(col, uSwirl * 0.6 + uDeep * 0.4, deepSheet * 0.55 * uContrast);
  col = mix(col, pig, clamp(silk, 0.0, 1.0) * uContrast);
  return col;
}

vec3 shadePearl(vec3 N, vec3 Po, float NdotV){
  vec3 To; vec2 fld = patSample(Po, To);
  vec3 rd = refract(-V, N, 1.0 / 1.5);
  vec3 Pd = normalize(uRot * (N + rd * 0.07));
  vec3 Td; float md = patSample(Pd, Td).x;
  float silk;
  vec3 col = pearlAlbedo(fld.x, fld.y, md, silk);
  vec3 R = reflect(-V, N);
  float Fc = uStyle == 0 ? coatF(NdotV) : schlick(0.04, NdotV);
  if (uStyle == 1) {
    vec3 c = col * mcD(N);
    c += uHi * silk * pow(1.0 - NdotV, 3.0) * 0.12;
    return c * (1.0 - Fc) + mcS(N) * Fc;
  }
  vec3 c = col * irradiance(N);
  vec3 Tw = transpose(uRot) * To;
  vec3 H = normalize(LB + V);
  float tH = dot(Tw, H);
  float kk = pow(sqrt(max(1.0 - tH * tH, 0.0)), 70.0);
  c += mix(uHi, vec3(1.0), 0.35) * kk * silk * 0.55 * uSheen * smoothstep(-0.1, 0.6, dot(N, LB)) * (1.0 - 0.6 * uVein);
  c += uHi * silk * pow(1.0 - NdotV, 3.0) * 0.18;
  gBox = uBox; vec3 ce = env(R, uCoatRough); gBox = 1.0;
  return c * (1.0 - Fc) + ce * Fc;
}

vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// flake glints, shared by every style; spec(n) is the reflection lookup for that style
vec3 flakeMirror(vec3 N, vec3 Po, vec3 F0, out float inF){
  float F = min(uFlakeFreq, uPx / 2.4);
  vec4 fc = flakeCell(Po * F);
  inF = 1.0 - smoothstep(0.30, 0.40, fc.w);
  vec3 nf = normalize(N + uTilt * (fc.xyz * 2.0 - 1.0));
  vec3 R = reflect(-V, N);
  vec3 rf = reflect(-V, nf);
  float near = smoothstep(cos(radians(50.0)), 1.0, dot(R, LB));
  vec3 hc = hueRot(vec3(1.0, 0.45, 0.45), fc.x * 6.2832);
  vec3 tint = uFlakeTint * mix(vec3(1.0), hc * 1.3, 0.4 * uHueJit) * mix(0.7, 1.25, fc.z);
  vec3 e = uStyle == 1 ? mcS(nf) : env(rf, 0.06);
  return e * mix(F0, vec3(1.0), 0.35) * tint * mix(0.55, 1.0, near);
}
vec3 shadeFlake(vec3 N, vec3 Po, float NdotV, vec3 alb0){
  vec3 R = reflect(-V, N);
  float rim = mix(uRimDark, 1.0, pow(NdotV, 0.55));
  vec3 alb = alb0 * rim;
  vec3 F0 = mix(vec3(0.04), alb, uMetal);
  vec3 Fm = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0) * (1.0 - uMetal * 0.6) * (uStyle == 1 ? 1.0 : uRimK);
  vec3 diff, spec;
  if (uStyle == 1) { diff = alb * (1.0 - uMetal) * mcD(N); spec = Fm * mix(mcS(N), mcR(N), smoothstep(0.1, 0.4, uRough)); }
  else { diff = alb * (1.0 - uMetal) * irradiance(N); spec = Fm * env(R, uRough); }
  float inF; vec3 mirror = flakeMirror(N, Po, F0, inF);
  mirror = max(mirror, spec * 0.75);
  vec3 c = diff + mix(spec, mirror, inF * uFlake);
  float Fc = uStyle == 1 ? schlick(0.04, NdotV) * uCoat : coatF(NdotV);
  gBox = uBox; vec3 ce = uStyle == 1 ? mcS(N) : env(R, uCoatRough); gBox = 1.0;
  c = c * (1.0 - Fc) + ce * Fc;
  c += alb0 * 0.05 * (1.0 - uMetal) * smoothstep(0.2, -0.8, dot(N, LB));
  return c;
}

/* --- multi-layer sparkle -----------------------------------------
   Three flake layers at different sizes. Each flake is a tiny mirror with its own normal,
   fixed in the ball, so it winks as the ball turns through the fixed light. A layer's
   flakes are never drawn smaller than uSpkMinPx screen pixels: below that the layer's
   frequency is held at the pixel limit, so density and contrast read the same at every
   size and nothing aliases into noise. Each flake replaces (mixes over) the body instead of
   adding to it, and the body is the same studio seen through a rougher surface, so the
   average brightness stays put whatever the flake settings. */
float gRimFade = 1.0;
float lum3(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 spkLayer(vec3 c, vec3 Po, vec3 Fc, float F, float minPx, float tilt, float cov, float rs, float rad, float gain, float seed, bool cube){
  float Fe = min(F, uPx / minPx);                 // cells per unit radius actually drawn
  float fw = Fe / uPx;                             // one pixel, in cell units
  vec3 id; float inF;
  if (cube) {                                      // fine grain: every cell is a flake
    id = hash33(floor(Po * Fe) + seed);
    inF = 1.0;
  } else {
    vec4 fc = flakeCell(Po * Fe + seed);
    id = fc.xyz;
    inF = 1.0 - smoothstep(rad - fw * 0.7, rad + fw * 0.7, fc.w);
  }
  vec3 nfo = normalize(Po + tilt * (id * 2.0 - 1.0));
  vec3 nf = transpose(uRot) * nfo;                 // the flake normal turns with the ball
  vec3 rf = reflect(-V, nf);
  vec3 tintc = mix(vec3(1.0), hueRot(vec3(1.0, 0.8, 0.8), id.y * 6.2832) * 1.08, uSpkHue);
  vec3 e = Fc * tintc * env(rf, rs) * mix(0.75, 1.25, id.z) * gain;
  float w = cov * inF * gRimFade;               // flakes thin out at the silhouette
  return mix(c, e, clamp(w, 0.0, 1.0));
}
vec3 shadeSparkle(vec3 N, vec3 Po, float NdotV){
  vec3 R = reflect(-V, N);
  gRimFade = smoothstep(0.04, 0.4, NdotV);
  float rim = mix(uRimDark, 1.0, pow(NdotV, 0.55));
  vec3 F0 = uBase * rim;
  vec3 c = F0 * env(R, uRough) + uBase * (1.0 - uMetal) * irradiance(N);
  vec3 Fc = uSpkCol * rim;
  c = spkLayer(c, Po, Fc, uSpkF.x, uSpkMinPx.x, uSpkTilt.x, uSpkCov.x, uSpkRough.x, uSpkRad.x, uSpkGain.x, 0.0, true);
  c = spkLayer(c, Po, Fc, uSpkF.y, uSpkMinPx.y, uSpkTilt.y, uSpkCov.y, uSpkRough.y, uSpkRad.y, uSpkGain.y, 41.7, false);
  c = spkLayer(c, Po, Fc, uSpkF.z, uSpkMinPx.z, uSpkTilt.z, uSpkCov.z, uSpkRough.z, uSpkRad.z, uSpkGain.z, 83.3, false);
  // frost: a soft, even mottle at the two finest flake sizes, around the same average
  float F0e = min(uSpkF.x, uPx / uSpkMinPx.x), F1e = min(uSpkF.y, uPx / uSpkMinPx.y);
  float mt = (hash33(floor(Po * F0e) + 7.1).x - 0.5) + 0.7 * (hash33(floor(Po * F1e) + 3.3).y - 0.5);
  float cl = snoise(Po * 2.3 + 5.1) + 0.5 * snoise(Po * 5.1 + 1.7);   // broad frost clouds, as in the photo
  c *= uSpkLift * (1.0 + uSpkMottle * mt) * (1.0 + uSpkCloud * cl);
  float Fcoat = coatF(NdotV);                     // the clear coat, set by the gloss
  gBox = uBox; vec3 ce = env(R, uCoatRough); gBox = 1.0;
  return c * (1.0 - Fcoat) + ce * Fcoat;
}

vec3 shadePhoto(vec3 N, vec3 Po, float NdotV){
  vec3 alb = texture(uPhoto, eqUV(Po)).rgb * (1.0 - 0.13 * uDark);
  if (uPhotoMode == 0) return alb;
  vec3 R = reflect(-V, N);
  float Fc = schlick(0.04, NdotV);
  vec3 c;
  if (uMat == 1 && uMetal > 0.9) {            // silver: frosted metal, photo grain as the body
    c = alb * (irradiance(N) * 0.55 + env(R, 0.55) * 0.35);
    float inF; vec3 mir = flakeMirror(N, Po, alb, inF);
    c = mix(c, max(c, mir), inF * 0.8);
  } else {
    c = alb * irradiance(N) * 0.92;
    if (uMat == 1) { float inF; vec3 mir = flakeMirror(N, Po, alb, inF); c = mix(c, max(c, mir * 0.6), inF * uFlake * 0.6); }
    c = c * (1.0 - Fc) + env(R, 0.03) * Fc * 0.9;
  }
  return c;
}

vec4 over(vec4 top, vec4 bot){ return top + bot * (1.0 - top.a); }
vec3 tonemap(vec3 color){
  const float startCompression = 0.8 - 0.04, desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, newPeak * vec3(1.0), g);
}

bool gRaw = false;
vec4 ball(vec2 p){
  float r = length(p);
  float t = max(length(p - vec2(0.03, -0.05)) - 0.985, 0.0);
  float sa = mix(0.24, 0.5, uDark) * (0.7 * exp(-t * 26.0) + 0.3 * exp(-pow(t / 0.13, 2.0)));
  sa *= 1.0 - smoothstep(0.16, 0.26, t);
  vec4 acc = vec4(0.0, 0.0, 0.0, sa);
  float cov = clamp((1.0 - r) * uPx / 1.5, 0.0, 1.0);
  if (cov > 0.0) {
    float rr = min(r, 0.9995);
    vec3 N = vec3(p / max(r, 1e-5) * rr, sqrt(1.0 - rr * rr));
    vec3 Po = uRot * N;
    float NdotV = N.z;
    vec3 c;
    if (uStyle == 2) { c = shadePhoto(N, Po, NdotV); gRaw = uPhotoMode == 0; }
    else if (uMat == 0) c = shadePearl(N, Po, NdotV);
    else if (uSpk == 1 && uStyle == 0) c = shadeSparkle(N, Po, NdotV);
    else c = shadeFlake(N, Po, NdotV, uBase);
    acc = over(vec4(c * cov, cov), acc);
  }
  return acc;
}

vec4 touchpad(vec2 p){
  vec2 hb = uSize * 0.5;
  float sdG = sdRound(p, hb, uCorner);
  float aa = 1.0 / uPx;
  float t = max(sdRound(p - vec2(0.03, -0.045), hb, uCorner), 0.0);
  float sa = mix(0.16, 0.4, uDark) * (0.6 * exp(-t * 22.0) + 0.4 * exp(-pow(t / 0.22, 2.0))) * (1.0 - smoothstep(0.10, 0.18, t));
  vec4 acc = vec4(0.0, 0.0, 0.0, sa);
  float covG = clamp(0.5 - sdG * uPx, 0.0, 1.0);
  vec2 pn = p / hb;
  vec2 n2 = normalize(p + 1e-5);
  float sheen = exp(-dot(pn - vec2(-0.55, 0.6), pn - vec2(-0.55, 0.6)) * 0.9);
  float grain = (hash12(floor(gl_FragCoord.xy)) - 0.5) * 0.03;
  vec3 g;
  if (uStyle == 2) {
    vec2 uv = vec2(pn.x * 0.5 + 0.5, pn.y * 0.5 + 0.5);
    vec3 ph = texture(uGlassTex, uv).rgb;
    g = ph * (uGlass / vec3(0.30)) * (0.92 + 0.30 * sheen);
  } else if (uStyle == 1) {
    vec3 N = normalize(vec3(-0.25 * pn.x, 0.25 * pn.y, 1.0));
    g = uGlass * (0.55 * mcD(N) + 0.10) + 0.05 * mcR(N) * uGlass * 3.0;
  } else {
    g = uGlass * (0.78 + 0.55 * sheen + 0.10 * dot(pn, vec2(-0.5, 0.5)) + grain);
  }
  // the glass edge: a hairline polished chamfer, lit from the upper left
  float ch = 1.0 - smoothstep(0.0, 1.8 * aa, -sdG);
  g += ch * 0.12 * clamp(dot(n2, vec2(-0.6, 0.8)) + 0.3, 0.0, 1.0);
  g *= 1.0 - ch * 0.25 * clamp(dot(n2, vec2(0.6, -0.8)), 0.0, 1.0);
  acc = over(vec4(g * covG, covG), acc);
  return acc;
}

void main(){
  if (uKind == 3) {
    vec2 uv = gl_FragCoord.xy / uBakeSize;
    float lon = (uv.x - 0.5) * 2.0 * PI, lat = (uv.y - 0.5) * PI;
    vec3 P = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    vec3 T = flowT(P);
    vec2 f = pearlField(P, T);
    vec3 e, n; eqFrame(P, e, n);
    outColor = vec4(clamp(f.x / 6.0 + 0.5, 0.0, 1.0), clamp(f.y / 6.0 + 0.5, 0.0, 1.0), dot(T, e) * 0.5 + 0.5, dot(T, n) * 0.5 + 0.5);
    return;
  }
  if (uKind == 4) {
    vec2 q = (gl_FragCoord.xy / uBakeSize - 0.5) / 0.49;
    float r = min(length(q), 0.9995);
    vec3 N = vec3(q / max(length(q), 1e-5) * r, sqrt(1.0 - r * r));
    vec3 R = reflect(-V, N);
    vec3 c = uBake == 0 ? irradiance(N) : uBake == 1 ? env(R, 0.03) : env(R, 0.5);
    outColor = vec4(c / (1.0 + c), 1.0);
    return;
  }
  vec4 c = uKind == 0 ? ball(vP) : touchpad(vP);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  if (!gRaw) rgb = tonemap(rgb);
  rgb = mix(12.92 * rgb, 1.055 * pow(max(rgb, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, rgb));
  rgb += (hash12(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  outColor = vec4(rgb * c.a, c.a);
}`;
