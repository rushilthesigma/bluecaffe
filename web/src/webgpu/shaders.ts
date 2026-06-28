// WGSL for the layer compositor. One draw per active clip, blended back-to-front.
export const COMPOSITOR_WGSL = /* wgsl */ `
struct Layer {
  p0 : vec4<f32>,   // x, y, scale, opacity
  p1 : vec4<f32>,   // hue(0..1), brightness, time, useTexture
  p2 : vec4<f32>,   // saturation, contrast, temperature, reserved
  p3 : vec4<f32>,   // aspectX, aspectY (contain-fit half-extents), rotation(rad), aspect(W/H)
  p4 : vec4<f32>,   // blur(0..1), vignette(0..1), grain(0..1), pixelate(0..1)
};

@group(0) @binding(0) var<uniform> L : Layer;
@group(1) @binding(0) var samp : sampler;
@group(1) @binding(1) var tex  : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>( 1.0, 1.0)
  );
  let base = quad[vi];
  // scale uniformly, then shrink the over-long axis to the source's own aspect
  // so off-16:9 media fits inside the frame instead of stretching to fill it
  var local = base * vec2<f32>(L.p0.z * L.p3.x, L.p0.z * L.p3.y);
  // rotate around the clip's centre. NDC is anisotropic (x covers the wider
  // canvas dimension), so move into a square space (×aspect on x), rotate, then
  // back — otherwise a square would shear instead of spinning cleanly.
  let ang = L.p3.z;
  let aspect = L.p3.w;
  if (abs(ang) > 0.0001) {
    let sq = vec2<f32>(local.x * aspect, local.y);
    let ca = cos(ang);
    let sa = sin(ang);
    // clockwise on screen (NDC y is up), matching the Canvas2D fallback's rotate
    let r = vec2<f32>(sq.x * ca + sq.y * sa, -sq.x * sa + sq.y * ca);
    local = vec2<f32>(r.x / aspect, r.y);
  }
  let p = local + vec2<f32>(L.p0.x, L.p0.y);
  var out : VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = base * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = vec3<f32>(5.0, 3.0, 1.0);
  let p = abs(fract(vec3<f32>(h, h, h) + k / 6.0) * 6.0 - vec3<f32>(3.0));
  return v * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

// shared color grade: temperature -> saturation -> contrast
fn grade(rgb: vec3<f32>, sat: f32, contrast: f32, temp: f32) -> vec3<f32> {
  var c = rgb;
  // temperature: warm pushes red up / blue down, cool the reverse
  c = c + vec3<f32>(temp * 0.12, temp * 0.03, -temp * 0.12);
  // saturation around perceptual luma
  let luma = dot(c, vec3<f32>(0.299, 0.587, 0.114));
  c = mix(vec3<f32>(luma), c, sat);
  // contrast around mid-grey
  c = (c - vec3<f32>(0.5)) * contrast + vec3<f32>(0.5);
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let opacity = L.p0.w;
  let hue     = L.p1.x;
  let bright  = L.p1.y;
  let t       = L.p1.z;
  let useTex  = L.p1.w;
  let sat      = L.p2.x;
  let contrast = L.p2.y;
  let temp     = L.p2.z;
  let blur     = L.p4.x;
  let vignette = L.p4.y;
  let grain    = L.p4.z;
  let pixelate = L.p4.w;

  // texture-space UV (y-flipped for WebGPU convention)
  var suv = vec2<f32>(uv.x, 1.0 - uv.y);

  // pixelate: snap UV to block centers before sampling
  if (pixelate > 0.001) {
    let cell = pixelate * 0.13 + 0.002;
    suv = floor(suv / cell) * cell + cell * 0.5;
    suv = clamp(suv, vec2<f32>(0.0), vec2<f32>(1.0));
  }

  if (useTex > 0.5) {
    var col: vec4<f32>;

    // blur: 9-sample 3×3 box kernel
    if (blur > 0.001) {
      let s = blur * 0.04;
      let lo = vec2<f32>(0.0);
      let hi = vec2<f32>(1.0);
      col  = textureSample(tex, samp, clamp(suv + vec2<f32>(-s, -s), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>(0.0, -s), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>( s, -s), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>(-s, 0.0), lo, hi));
      col += textureSample(tex, samp, suv);
      col += textureSample(tex, samp, clamp(suv + vec2<f32>( s, 0.0), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>(-s,  s), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>(0.0,  s), lo, hi));
      col += textureSample(tex, samp, clamp(suv + vec2<f32>( s,  s), lo, hi));
      col /= 9.0;
    } else {
      col = textureSample(tex, samp, suv);
    }

    var rgb = grade(col.rgb * bright, sat, contrast, temp);

    // vignette: darken toward frame edges (quadratic falloff)
    if (vignette > 0.001) {
      let dist = length(uv - vec2<f32>(0.5)) * 1.4142;
      rgb *= max(0.0, 1.0 - vignette * dist * dist);
    }

    // grain: time-animated film noise
    if (grain > 0.001) {
      let n = fract(sin(dot(uv * 127.1, vec2<f32>(12.9898, 78.233)) + t * 91.13) * 43758.5453);
      rgb = clamp(rgb + vec3<f32>((n - 0.5) * grain * 0.45), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    return vec4<f32>(rgb, col.a * opacity);
  }

  // procedural: color swatch with gradient and subtle built-in vignette
  let base = hsv2rgb(hue, 0.5, 0.82);
  let gd   = mix(0.72, 1.08, uv.y);
  let band = 0.05 * sin((uv.x + uv.y) * 6.2831 - t * 0.5);
  let vign0 = 1.0 - 0.18 * length(uv - vec2<f32>(0.5, 0.5));
  var pcol = base * (gd + band) * vign0 * bright;
  if (grain > 0.001) {
    let n = fract(sin(dot(uv * 127.1, vec2<f32>(12.9898, 78.233)) + t * 91.13) * 43758.5453);
    pcol = clamp(pcol + vec3<f32>((n - 0.5) * grain * 0.45), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(grade(pcol, sat, contrast, temp), opacity);
}
`;
