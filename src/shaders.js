'use strict';
/* ---------- GLSL ---------- */
const VS = `#version 300 es
in vec2 a; out vec2 v_uv;
void main(){ v_uv=a*0.5+0.5; gl_Position=vec4(a,0.,1.); }`;

const FS_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D; precision highp usampler2D;
in vec2 v_uv; out vec4 o;
float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
vec3 enc(vec3 c){ c=max(c,0.); return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(0.0031308,c)); }
vec3 dec(vec3 v){ v=max(v,0.); return mix(v/12.92, pow((v+0.055)/1.055,vec3(2.4)), step(0.04045,v)); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.,0.)),f.x), mix(hash12(i+vec2(0.,1.)),hash12(i+vec2(1.,1.)),f.x), f.y); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
`;

const SH = {};

SH.convert = `uniform usampler2D u_t;
void main(){ // LibRaw hands back BT.709-encoded 16-bit values; undo that curve to get linear light
  vec3 v=vec3(texelFetch(u_t,ivec2(gl_FragCoord.xy),0).rgb)/65535.;
  o=vec4(mix(v/4.5,pow((v+0.099)/1.099,vec3(1./0.45)),step(0.081,v)),1.); }`;

SH.geo = `uniform sampler2D u_src; uniform mat3 u_M; uniform vec2 u_srcSize;
uniform float u_gain,u_distort,u_lensVig; uniform vec2 u_ca;
uniform int u_nSpots; uniform vec4 u_spot[16]; uniform vec4 u_spotSrc[16];
vec3 S(vec2 uv){
  vec2 asp=u_srcSize/max(u_srcSize.x,u_srcSize.y);
  vec2 d=uv-0.5; vec2 da=d*asp; float r2=dot(da,da)*4.; float r2c=dot(asp,asp);
  float k=(1.+u_distort*r2)/(1.+max(u_distort,0.)*r2c);
  vec3 c;
  if(u_ca.x!=0.||u_ca.y!=0.){
    c.r=texture(u_src,0.5+d*k*(1.+u_ca.x*r2)).r; c.g=texture(u_src,0.5+d*k).g; c.b=texture(u_src,0.5+d*k*(1.+u_ca.y*r2)).b;
  } else c=texture(u_src,0.5+d*k).rgb;
  return c*(1.+u_lensVig*r2);
}
void main(){
  vec2 suv=(u_M*vec3(v_uv,1.)).xy;
  vec3 c=S(suv);
  float lg=max(u_srcSize.x,u_srcSize.y);
  for(int i=0;i<16;i++){ if(i>=u_nSpots) break;
    vec4 s=u_spot[i]; float dd=length((suv-s.xy)*u_srcSize)/lg;
    float w=1.-smoothstep(s.z*(1.-s.w),s.z,dd);
    if(w>0.) c=mix(c,S(suv+u_spotSrc[i].xy-s.xy),w*u_spotSrc[i].z);
  }
  o=vec4(max(c,0.)*u_gain,1.);
}`;

SH.denoise = `uniform sampler2D u_t; uniform vec2 u_px; uniform float u_nl,u_nc;
void main(){
  vec3 g0=sqrt(max(texture(u_t,v_uv).rgb,0.)); float l0=luma(g0);
  float sl=0.,wl=0.,wc=0.; vec3 sc=vec3(0.);
  float sigL=0.003+u_nl*u_nl*0.10, sigC=0.01+u_nc*u_nc*0.5;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec2 off=vec2(float(x),float(y));
    vec3 g=sqrt(max(texture(u_t,v_uv+off*u_px*1.4).rgb,0.)); float l=luma(g);
    float ds=exp(-dot(off,off)/8.), dl=l-l0;
    float a=ds*exp(-dl*dl/(sigL*sigL)); sl+=l*a; wl+=a;
    float b=ds*exp(-dl*dl/(sigC*sigC)); sc+=(g-l)*b; wc+=b;
  }
  float L=u_nl>0.?sl/wl:l0; vec3 C=u_nc>0.?sc/wc:g0-l0;
  vec3 g=max(vec3(L)+C,0.); o=vec4(g*g,1.);
}`;

SH.down = `uniform sampler2D u_t; uniform int u_prep;
void main(){ vec4 c=texture(u_t,v_uv); if(u_prep==1) c.a=min(c.r,min(c.g,c.b)); o=c; }`;

SH.gauss = `uniform sampler2D u_t; uniform vec2 u_dir; uniform float u_sigma;
void main(){ vec4 s=vec4(0.); float w=0.;
  for(int i=-10;i<=10;i++){ float f=float(i); float g=exp(-f*f/(2.*u_sigma*u_sigma)); s+=texture(u_t,v_uv+u_dir*f)*g; w+=g; }
  o=s/w; }`;

SH.extract = `uniform sampler2D u_t; uniform float u_thr,u_knee;
void main(){ vec3 c=min(texture(u_t,v_uv).rgb,vec3(16.)); float l=max(c.r,max(c.g,c.b));
  float w=smoothstep(u_thr-u_knee,u_thr+u_knee,l); o=vec4(c*w,1.); }`;

SH.develop = `uniform sampler2D u_img,u_b1,u_b2,u_curve;
uniform sampler2D u_mT0,u_mT1,u_mT2,u_mT3,u_mT4,u_mT5;
uniform vec2 u_px; uniform mat3 u_M; uniform vec2 u_srcSize;
uniform vec3 u_wb; uniform float u_exp,u_con,u_hi,u_sh,u_wh,u_bl,u_tex,u_cla,u_deh,u_vib,u_sat,u_base;
uniform vec3 u_sharp;
uniform float u_hH[8]; uniform float u_hS[8]; uniform float u_hL[8]; uniform int u_hslOn,u_bw,u_curveOn,u_gradeOn;
uniform vec3 u_gS,u_gM,u_gH,u_gLum; uniform float u_gBal,u_gBlend;
uniform int u_mType[6]; uniform vec4 u_mA[6]; uniform vec4 u_mB[6]; uniform vec4 u_mAdj[6]; uniform vec3 u_mWb[6];
uniform int u_selMask;
const float HC[9]=float[9](0.,30.,60.,120.,180.,240.,270.,300.,360.);
vec3 hslAdj(float h){
  for(int i=0;i<8;i++){ float a=HC[i], b=HC[i+1];
    if(h>=a&&h<=b){ float t=(h-a)/(b-a); int j=i==7?0:i+1;
      return vec3(mix(u_hH[i],u_hH[j],t),mix(u_hS[i],u_hS[j],t),mix(u_hL[i],u_hL[j],t)); } }
  return vec3(0.);
}
float mshape(int i,vec2 suv){
  int t=u_mType[i]; vec4 A=u_mA[i]; vec2 p=suv*u_srcSize; float w=0.;
  if(t==1){ vec2 a=A.xy*u_srcSize, b=A.zw*u_srcSize, ab=b-a; float tt=dot(p-a,ab)/max(dot(ab,ab),1e-6); w=1.-smoothstep(0.,1.,tt); }
  else if(t==2){ vec2 d=(p-A.xy*u_srcSize)/max(A.zw*u_srcSize,vec2(1e-3)); w=1.-smoothstep(1.-u_mB[i].x,1.,length(d)); }
  return w;
}
vec3 scurve(vec3 v,float k){
  vec3 m=max(v,vec3(1.)); vec3 x=clamp(v,0.,1.);
  vec3 lo=0.5*pow(2.*x,vec3(k)), hi=1.-0.5*pow(2.*(1.-x),vec3(k));
  return mix(lo,hi,step(0.5,x))*m;
}
#define MASK(i,T) if(u_mType[i]!=0){ float w=(u_mType[i]==3)?texture(T,suv).a:mshape(i,suv); if(u_mB[i].y>0.5) w=1.-w; w*=u_mB[i].z; lExp+=w*u_mAdj[i].x; lCon+=w*u_mAdj[i].y; lSat+=w*u_mAdj[i].z; lCla+=w*u_mAdj[i].w; lWb*=mix(vec3(1.),u_mWb[i],w); if(u_selMask==i) selW=w; }
void main(){
  vec3 c0=texture(u_img,v_uv).rgb; vec3 c=c0;
  vec4 b1=texture(u_b1,v_uv), b2=texture(u_b2,v_uv);
  float L0=luma(c0);
  // capture sharpening (luminance only)
  if(u_sharp.x>0.){
    vec2 r=u_px*u_sharp.y;
    vec3 n=texture(u_img,v_uv+vec2(r.x,0.)).rgb+texture(u_img,v_uv-vec2(r.x,0.)).rgb+texture(u_img,v_uv+vec2(0.,r.y)).rgb+texture(u_img,v_uv-vec2(0.,r.y)).rgb;
    vec3 dg=texture(u_img,v_uv+r).rgb+texture(u_img,v_uv-r).rgb+texture(u_img,v_uv+vec2(r.x,-r.y)).rgb+texture(u_img,v_uv+vec2(-r.x,r.y)).rgb;
    float dl=L0-luma((n*2.+dg)/12.);
    float mk=smoothstep(u_sharp.z*0.03,u_sharp.z*0.15+1e-4,abs(dl)/(L0+0.05));
    c=max(c+vec3(dl)*u_sharp.x*2.5*mk,0.);
  }
  // local adjustments
  vec2 suv=(u_M*vec3(v_uv,1.)).xy;
  float lExp=0.,lCon=0.,lSat=0.,lCla=0.,selW=0.; vec3 lWb=vec3(1.);
  MASK(0,u_mT0) MASK(1,u_mT1) MASK(2,u_mT2) MASK(3,u_mT3) MASK(4,u_mT4) MASK(5,u_mT5)
  float gain=exp2(u_exp+lExp);
  c*=u_wb*lWb*gain;
  // raw base rendering
  if(u_base>0.){ vec3 t=c*1.15; t=t*(1.+t/9.)/(1.+t); c=mix(c,dec(scurve(enc(t),1.18)),u_base); }
  // dehaze
  if(u_deh!=0.){
    float dk=clamp(b2.a*gain,0.,1.);
    if(u_deh>0.){ float t=1.-0.85*u_deh*dk; c=max((c-(1.-t))/t,0.); c=mix(vec3(luma(c)),c,1.+0.25*u_deh); }
    else c=mix(c,vec3(0.82),-u_deh*0.55);
  }
  // highlights & shadows (guided by wide blur)
  float gl=luma(b2.rgb*u_wb*lWb)*gain; float gg=clamp(pow(max(gl,0.),1./2.2),0.,1.3);
  float wS=pow(clamp(1.-gg,0.,1.),2.5), wH=smoothstep(0.25,1.,gg); wH*=wH;
  c*=exp2(u_sh*1.8*wS+u_hi*1.1*wH);
  // whites & blacks
  if(u_wh!=0.||u_bl!=0.){
    float L=luma(c), Lg=pow(max(L,0.),1./2.2);
    float Lg2=max(Lg+u_wh*0.28*Lg*Lg+u_bl*0.16*pow(clamp(1.-Lg,0.,1.),4.),0.);
    c=Lg>1e-3?c*pow(Lg2/Lg,2.2):vec3(pow(Lg2,2.2));
  }
  // contrast
  float con=u_con+lCon;
  if(con!=0.) c=dec(scurve(enc(c),exp2(con*0.9)));
  // texture & clarity (local contrast from two blur radii)
  float cla=u_cla+lCla;
  if(u_tex!=0.||cla!=0.){
    float e=0.003;
    float r1=clamp((L0+e)/(luma(b1.rgb)+e),0.25,4.), r2=clamp((luma(b1.rgb)+e)/(luma(b2.rgb)+e),0.25,4.);
    float Lg=clamp(pow(max(luma(c),0.),1./2.2),0.,1.); float mw=1.-pow(abs(2.*Lg-1.),3.);
    c*=pow(r1,u_tex*0.9)*pow(r2*mix(1.,r1,0.4),cla*0.9*mw);
  }
  // tone curve
  if(u_curveOn==1){
    vec3 v=enc(c); vec3 m=max(v,vec3(1.)); vec3 x=clamp(v,0.,1.)*(255./256.)+0.5/256.;
    v=vec3(texture(u_curve,vec2(x.r,0.5)).r,texture(u_curve,vec2(x.g,0.5)).g,texture(u_curve,vec2(x.b,0.5)).b)*m;
    c=dec(v);
  }
  // colour mixer
  if(u_hslOn==1||u_bw==1){
    vec3 v=enc(c); vec3 h=rgb2hsv(v); vec3 ad=hslAdj(h.x*360.); float sw=smoothstep(0.02,0.25,h.y);
    if(u_bw==1){ float L=luma(c)*exp2(ad.z*1.6*sw); c=vec3(L); }
    else { h.x=fract(h.x+ad.x*sw*(30./360.)); h.y=clamp(h.y*(1.+ad.y),0.,1.); v=hsv2rgb(h)*exp2(ad.z*0.9*sw); c=dec(v); }
  }
  // vibrance & saturation
  if(u_bw==0){
    float L=luma(c); float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float s=(mx-mn)/(mx+1e-4);
    float k=(1.+u_vib*(1.-s))*(1.+u_sat+lSat);
    c=max(mix(vec3(L),c,max(k,0.)),0.);
  }
  // colour grading
  if(u_gradeOn==1){
    vec3 v=enc(c); float L=clamp(luma(v),0.,1.); float Lb=pow(L,exp2(-u_gBal));
    float ws=1.-smoothstep(0.,0.3+0.5*u_gBlend,Lb), wh=smoothstep(0.7-0.5*u_gBlend,1.,Lb), wm=max(1.-ws-wh,0.);
    v+=u_gS*ws+u_gM*wm+u_gH*wh; v*=1.+dot(u_gLum,vec3(ws,wm,wh))*0.5;
    c=dec(v);
  }
  o=vec4(max(c,0.),selW);
}`;

SH.finish = `uniform sampler2D u_a,u_h1,u_h2,u_bm; uniform sampler3D u_lut; uniform float u_lutAmt;
uniform vec3 u_halTint; uniform float u_halAmt,u_bloomAmt;
uniform float u_filmAmt,u_fSat,u_fShoulder,u_fExp; uniform int u_fMono;
uniform mat3 u_fM; uniform vec3 u_fGamma,u_fLo,u_fHi,u_fShT,u_fHiT,u_fMonoW,u_fTone;
uniform vec4 u_vig; uniform float u_fade; uniform vec4 u_grain; uniform vec2 u_full; uniform float u_seed;
uniform vec3 u_leak; uniform vec2 u_dust; uniform float u_border,u_borderRound; uniform vec3 u_borderCol;
vec3 sc3(vec3 x,vec3 k){ x=clamp(x,0.,1.); vec3 lo=0.5*pow(2.*x,k), hi=1.-0.5*pow(2.*(1.-x),k); return mix(lo,hi,step(0.5,x)); }
vec3 film(vec3 c){
  c=max(u_fM*c,0.)*exp2(u_fExp);
  if(u_fMono==1) c=vec3(max(dot(c,u_fMonoW),0.));
  vec3 v=enc(c);
  float kn=min(1.-u_fShoulder*0.45,0.97);
  v=mix(v,kn+(1.-kn)*tanh((v-kn)/(1.-kn)),step(kn,v));
  v=sc3(v,u_fGamma);
  v=u_fLo+v*(u_fHi-u_fLo);
  vec3 d=1.-v; v+=u_fShT*d*d*d*4.+u_fHiT*v*v*v*4.;
  v=mix(vec3(luma(v)),v,u_fSat)*u_fTone;
  return v;
}
float gn(vec2 p,float s){ return (vnoise(p+s)-0.5)*2.*(1.-u_grain.z*0.6)+(vnoise(p*0.43+s*1.7+31.7)-0.5)*2.4*u_grain.z; }
void main(){
  vec4 A=texture(u_a,v_uv); vec3 c=A.rgb;
  vec2 asp=u_full/max(u_full.x,u_full.y);
  // halation: red-weighted scatter around highlights; bloom: neutral
  if(u_halAmt>0.){ vec3 h=texture(u_h1,v_uv).rgb*0.6+texture(u_h2,v_uv).rgb*0.4; c+=dot(h,vec3(0.55,0.35,0.10))*u_halTint*u_halAmt; }
  if(u_bloomAmt>0.){ c=c*(1.-0.15*u_bloomAmt)+texture(u_bm,v_uv).rgb*u_bloomAmt; }
  vec3 v=enc(c);
  if(u_filmAmt>0.) v=mix(clamp(v,0.,1.),film(c),u_filmAmt);
  v=clamp(v,0.,1.);
  if(u_lutAmt>0.){ float n=float(textureSize(u_lut,0).x); v=mix(v,texture(u_lut,v*((n-1.)/n)+0.5/n).rgb,u_lutAmt); }
  if(u_fade>0.) v=v*(1.-0.22*u_fade)+0.09*u_fade+0.05*u_fade*(1.-v)*(1.-v);
  // vignette
  if(u_vig.x!=0.){
    vec2 d=(v_uv-0.5)*2.; d*=mix(vec2(1.),asp,max(u_vig.z,0.)); float n=mix(2.,6.,max(-u_vig.z,0.));
    float dist=pow(pow(abs(d.x),n)+pow(abs(d.y),n),1./n);
    float m=mix(0.2,1.4,u_vig.y); float w=smoothstep(m-u_vig.w*0.8-0.001,m+u_vig.w*0.8,dist);
    if(u_vig.x<0.) v*=1.+u_vig.x*w*0.92; else v=mix(v,vec3(1.),u_vig.x*w*0.8);
  }
  // light leaks
  if(u_leak.x>0.){
    vec3 acc=vec3(0.);
    for(int i=0;i<3;i++){ float fi=float(i); float a=hash12(vec2(u_leak.y*3.7,fi*7.1+1.))*6.2832; vec2 dir=vec2(cos(a),sin(a));
      float off=0.15+0.45*hash12(vec2(u_leak.y+3.,fi+2.));
      float d=dot(v_uv-0.5,dir)+0.5-off+ (vnoise(v_uv*2.2+u_leak.y+fi*5.)-0.5)*0.35;
      float m=smoothstep(0.,0.6,d);
      acc+=hsv2rgb(vec3(fract(u_leak.z+(hash12(vec2(fi+4.,u_leak.y))-0.5)*0.1),0.8,1.))*m*m; }
    v=1.-(1.-v)*(1.-clamp(acc*u_leak.x,0.,1.));
  }
  // grain (resolution independent: sized against the full image)
  if(u_grain.x>0.){
    vec2 p=v_uv*asp*(2600./u_grain.y);
    float g=gn(p,u_seed*13.1); vec3 n3=mix(vec3(g),vec3(gn(p,u_seed*13.1+71.3),g,gn(p,u_seed*13.1+153.9)),u_grain.w);
    float L=luma(v); float amp=u_grain.x*0.22*(0.35+0.65*smoothstep(0.,0.12,L))*(1.-0.6*L*L);
    v+=n3*amp;
  }
  // dust, fibres and scratches
  if(u_dust.x>0.){
    vec2 p=v_uv*asp*42.; vec2 i=floor(p), f=fract(p); float hh=hash12(i+u_seed*1.37);
    if(hh<u_dust.x*0.22){ vec2 cc=vec2(hash12(i+1.3),hash12(i+7.7))*0.7+0.15; float r=0.025+0.11*hash12(i+3.1)*hash12(i+5.9);
      float s=1.-smoothstep(r*0.5,r,length(f-cc)); v=mix(v,hash12(i+9.2)<0.8?vec3(0.96):vec3(0.05),s*0.9); }
    p=v_uv*asp*7.; i=floor(p); f=fract(p); hh=hash12(i+u_seed*2.11+40.);
    if(hh<u_dust.x*0.18){ float a=hash12(i+11.)*3.1416; vec2 t=vec2(cos(a),sin(a)), nn=vec2(-t.y,t.x); vec2 q=f-0.5;
      float x=dot(q,t), y=dot(q,nn)+ (hash12(i+13.)-0.5)*3.*x*x; float len=0.12+0.25*hash12(i+17.);
      float s=(1.-smoothstep(0.004,0.011,abs(y)))*(1.-smoothstep(len*0.8,len,abs(x))); v=mix(v,vec3(0.95),s*0.8); }
  }
  if(u_dust.y>0.){
    float x=v_uv.x*asp.x*70.; float i=floor(x), f=fract(x); float hh=hash12(vec2(i,u_seed*3.3+5.));
    if(hh<u_dust.y*0.2){ float cx=0.2+0.6*hash12(vec2(i,9.)); float wob=(vnoise(vec2(i,v_uv.y*3.))-0.5)*0.15;
      float s=1.-smoothstep(0.012,0.03,abs(f-cx-wob)); s*=smoothstep(0.35,0.6,vnoise(vec2(i*3.1,v_uv.y*asp.y*9.+u_seed)));
      v=mix(v,vec3(0.93),s*0.7); }
  }
  // border
  if(u_border>0.){
    vec2 p=v_uv*u_full; float b=u_border*min(u_full.x,u_full.y); float rr=u_borderRound*b*1.5;
    vec2 q=abs(p-u_full*0.5)-(u_full*0.5-b-rr); float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-rr;
    v=mix(v,u_borderCol,smoothstep(-0.5,0.5,sd/max(fwidth(sd),1e-4)*0.5));
  }
  v+=(hash12(gl_FragCoord.xy+0.37)-0.5)/255.;
  o=vec4(clamp(v,0.,1.),A.a);
}`;

SH.display = `uniform sampler2D u_f,u_g; uniform mat3 u_V; uniform vec2 u_res; uniform float u_split;
uniform int u_mode,u_clip,u_overlay; uniform vec3 u_bg;
void main(){
  vec2 sp=vec2(gl_FragCoord.x,u_res.y-gl_FragCoord.y); vec2 uv=(u_V*vec3(sp,1.)).xy;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.){ o=vec4(u_bg,1.); return; }
  vec4 f=texture(u_f,uv); vec3 c=f.rgb;
  bool before=u_mode==1||(u_mode==2&&sp.x<u_split);
  if(before) c=clamp(enc(texture(u_g,uv).rgb),0.,1.);
  else {
    if(u_overlay==1) c=mix(c,vec3(1.,0.16,0.1),f.a*0.55);
    if(u_clip==1){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); if(mn>=0.996) c=vec3(1.,0.,0.); else if(mx<=0.006) c=vec3(0.,0.35,1.); }
  }
  if(u_mode==2&&abs(sp.x-u_split)<1.) c=vec3(1.);
  o=vec4(c,1.);
}`;

SH.copy = `uniform sampler2D u_t; void main(){ o=texture(u_t,v_uv); }`;
