import * as THREE from "three";

/** Isolated browser experiment: fixed UV-cell facets with view/light dependent
 * direct glints and a smooth distance limit. This is deliberately simpler than
 * a filtered stochastic microfacet BRDF and has no REDengine parity claim. */
export function installProceduralGlintStudy(material: THREE.MeshPhysicalMaterial) {
  if (THREE.REVISION !== "186") throw Error("Glint study requires Three r186");
  const priorCompile = material.onBeforeCompile;
  const priorKey = material.customProgramCacheKey;
  const uniforms = {
    xfsGlintEnabled: {value: false},
    xfsGlintColor: {value: new THREE.Color("#f5df9f")},
    xfsGlintStrength: {value: 8},
    xfsGlintPower: {value: 220},
  };
  let disposed = false;
  const replace = (source: string, token: string, replacement: string) => {
    if (source.split(token).length !== 2) throw Error(`Glint study shader marker changed: ${token}`);
    return source.replace(token, replacement);
  };
  const compile: typeof material.onBeforeCompile = function(this: THREE.MeshPhysicalMaterial, shader, renderer) {
    priorCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replace(shader.vertexShader, "#include <common>", `
#include <common>
varying vec2 xfsGlintUv;
`);
    shader.vertexShader = replace(shader.vertexShader, "#include <uv_vertex>", `
#include <uv_vertex>
xfsGlintUv = uv;
`);
    shader.fragmentShader = replace(shader.fragmentShader, "#include <common>", `
#include <common>
varying vec2 xfsGlintUv;
uniform bool xfsGlintEnabled;
uniform vec3 xfsGlintColor;
uniform float xfsGlintStrength;
uniform float xfsGlintPower;

mat3 xfsGlintFrame( vec3 surfaceNormal, vec2 uv ) {
  // Recover the surface's deformed UV directions from local screen gradients.
  // This stays defined even when the physical material has no normal map.
  vec3 px = dFdx( -vViewPosition );
  vec3 py = dFdy( -vViewPosition );
  vec2 ux = dFdx( uv );
  vec2 uy = dFdy( uv );
  float determinant = ux.x * uy.y - ux.y * uy.x;
  vec3 n = normalize( surfaceNormal );
  if ( abs( determinant ) < 1e-8 ) {
    vec3 fallback = abs( n.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
    vec3 tangent = normalize( cross( fallback, n ) );
    return mat3( tangent, cross( n, tangent ), n );
  }
  vec3 tangent = ( px * uy.y - py * ux.y ) / determinant;
  tangent = normalize( tangent - n * dot( tangent, n ) );
  vec3 bitangent = normalize( cross( n, tangent ) ) * sign( determinant );
  return mat3( tangent, bitangent, n );
}

uint xfsGlintHash( uvec2 cell, uint salt ) {
  uint h = 2166136261u ^ salt;
  h = ( h ^ cell.x ) * 16777619u;
  h = ( h ^ cell.y ) * 16777619u;
  h ^= h >> 16;
  h *= 2246822519u;
  h ^= h >> 13;
  return h;
}
float xfsGlintUnit( uvec2 cell, uint salt ) {
  return float( xfsGlintHash( cell, salt ) & 16777215u ) / 16777216.0;
}
vec3 xfsGlintDirect( vec2 uv, vec3 halfTangent, vec3 lightColor ) {
  // One jittered candidate per cell, anchored in UV, never in frame/screen space.
  const float grid = 576.0;
  vec2 position = uv * grid;
  ivec2 base = ivec2( floor( position ) );
  vec2 pixelFootprint = vec2( length( dFdx( uv ) ), length( dFdy( uv ) ) );
  float widthUv = 0.5 * length( pixelFootprint );
  float footprintCells = grid * max( pixelFootprint.x, pixelFootprint.y );
  float discreteWeight = 1.0 - smoothstep( 0.8, 2.0, footprintCells );
  float response = 0.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      uvec2 cell = uvec2( base + ivec2( x, y ) );
      vec2 jitter = vec2( xfsGlintUnit( cell, 1u ), xfsGlintUnit( cell, 2u ) );
      vec2 centre = ( vec2( base + ivec2( x, y ) ) + 0.1 + 0.8 * jitter ) / grid;
      float radius = 0.00015 + 0.00035 * xfsGlintUnit( cell, 3u );
      float distanceUv = length( uv - centre );
      float spatial = 1.0 - smoothstep( max( 0.0, radius - widthUv ), radius + widthUv, distanceUv );
      vec2 slope = 0.8 * ( vec2( xfsGlintUnit( cell, 4u ), xfsGlintUnit( cell, 5u ) ) - 0.5 );
      vec3 facet = normalize( vec3( slope, 1.0 ) );
      response += spatial * pow( max( dot( facet, halfTangent ), 0.0 ), xfsGlintPower );
    }
  }
  // At minification the exact cell set becomes too large for fixed work. Fade
  // toward a low-energy broad mean instead of inventing frame-random glints.
  float meanResponse = 0.055 * pow( max( halfTangent.z, 0.0 ), 32.0 );
  return lightColor * xfsGlintColor * xfsGlintStrength *
    mix( meanResponse, response, discreteWeight );
}
`);
    shader.fragmentShader = replace(shader.fragmentShader, "#include <opaque_fragment>", `
if ( xfsGlintEnabled ) {
  #if NUM_DIR_LIGHTS > 0
    // The UV derivative frame stays attached to the deformed eye plate.
    vec3 xfsGlintView = normalize( vViewPosition );
    mat3 xfsGlintTbn = xfsGlintFrame( nonPerturbedNormal, xfsGlintUv );
    for ( int xfsLight = 0; xfsLight < NUM_DIR_LIGHTS; xfsLight ++ ) {
      vec3 xfsGlintHalf = normalize( xfsGlintView + directionalLights[ xfsLight ].direction );
      vec3 xfsGlintHalfTangent = normalize( transpose( xfsGlintTbn ) * xfsGlintHalf );
      outgoingLight += xfsGlintDirect( xfsGlintUv, xfsGlintHalfTangent,
        directionalLights[ xfsLight ].color );
    }
  #endif
}
#include <opaque_fragment>
`);
  };
  const cacheKey = function(this: THREE.MeshPhysicalMaterial) {
    return `${priorKey.call(this)}|xfs-uv-cell-glint-study-r186-1`;
  };
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  return {
    setEnabled(value: boolean) {
      if (disposed) throw Error("Glint study disposed");
      uniforms.xfsGlintEnabled.value = value;
    },
    setStrength(value: number) {
      if (disposed) throw Error("Glint study disposed");
      if (!Number.isFinite(value) || value < 0 || value > 32) throw Error("Invalid glint strength");
      uniforms.xfsGlintStrength.value = value;
    },
    setPower(value: number) {
      if (disposed) throw Error("Glint study disposed");
      if (!Number.isFinite(value) || value < 20 || value > 1200) throw Error("Invalid glint angular power");
      uniforms.xfsGlintPower.value = value;
    },
    dispose() {
      if (disposed) return;
      if (material.onBeforeCompile === compile) material.onBeforeCompile = priorCompile;
      if (material.customProgramCacheKey === cacheKey) material.customProgramCacheKey = priorKey;
      material.needsUpdate = true;
      disposed = true;
    },
  };
}
