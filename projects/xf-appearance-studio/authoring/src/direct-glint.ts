import * as THREE from "three";

/** Browser study shader shared by the original 960-cell pilot and the
 * separately versioned 1536-cell Studio profile. It is deliberately simpler
 * than a filtered stochastic microfacet BRDF and has no REDengine parity. */
export function installProceduralGlintStudy(material: THREE.MeshPhysicalMaterial) {
  if (THREE.REVISION !== "186") throw Error("Glint study requires Three r186");
  const priorCompile = material.onBeforeCompile;
  const priorKey = material.customProgramCacheKey;
  const uniforms = {
    xfsGlintEnabled: {value: false},
    xfsGlintColor: {value: new THREE.Color("#f5df9f")},
    xfsGlintStrength: {value: 8},
    xfsGlintPower: {value: 220},
    xfsGlintShape: {value: 0},
    xfsGlintSeed: {value: 0},
    xfsGlintDensity: {value: 0.9},
    xfsGlintFineShare: {value: 0.65},
    xfsGlintProductionProfile: {value:false},
    xfsGlintBodyColor: {value: new THREE.Color("#d2aca8")},
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
uniform int xfsGlintShape;
uniform int xfsGlintSeed;
uniform float xfsGlintDensity;
uniform float xfsGlintFineShare;
uniform bool xfsGlintProductionProfile;
uniform vec3 xfsGlintBodyColor;

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
  uint h = 2166136261u ^ salt ^ uint( xfsGlintSeed );
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
vec2 xfsGlintVertexDirection( int sides, int vertex ) {
  if ( vertex == 0 ) return vec2( 1.0, 0.0 );
  if ( sides == 3 ) {
    if ( vertex == 1 ) return vec2( -0.5, 0.8660254 );
    return vec2( -0.5, -0.8660254 );
  }
  if ( vertex == 1 ) return vec2( 0.0, 1.0 );
  if ( vertex == 2 ) return vec2( -1.0, 0.0 );
  return vec2( 0.0, -1.0 );
}
float xfsGlintPolygonDistance( uvec2 cell, vec2 point, float radius, float angle ) {
  // Convex triangle or quadrilateral in cell coordinates. Rotating the query
  // once keeps straight sides without trigonometry inside the edge loop.
  int sides = xfsGlintUnit( cell, 6u ) < 0.5 ? 3 : 4;
  float c = cos( angle ), s = sin( angle );
  vec2 local = vec2( c * point.x + s * point.y, -s * point.x + c * point.y );
  vec2 aspect = vec2( 0.75 + 0.5 * xfsGlintUnit( cell, 8u ),
                       0.75 + 0.5 * xfsGlintUnit( cell, 9u ) );
  float shortest = 1e10;
  float outermost = -1e10;
  for ( int edgeIndex = 0; edgeIndex < 4; edgeIndex ++ ) {
    if ( edgeIndex >= sides ) break;
    int nextIndex = edgeIndex + 1 == sides ? 0 : edgeIndex + 1;
    vec2 a = xfsGlintVertexDirection( sides, edgeIndex ) * aspect * radius *
      ( 0.82 + 0.36 * xfsGlintUnit( cell, 10u + uint( edgeIndex ) ) );
    vec2 b = xfsGlintVertexDirection( sides, nextIndex ) * aspect * radius *
      ( 0.82 + 0.36 * xfsGlintUnit( cell, 10u + uint( nextIndex ) ) );
    vec2 side = b - a;
    vec2 fromA = local - a;
    float sideLength2 = max( dot( side, side ), 1e-12 );
    vec2 closest = fromA - side * clamp( dot( fromA, side ) / sideLength2, 0.0, 1.0 );
    shortest = min( shortest, length( closest ) );
    outermost = max( outermost, ( side.y * fromA.x - side.x * fromA.y ) / sqrt( sideLength2 ) );
  }
  return outermost <= 0.0 ? -shortest : shortest;
}
vec4 xfsGlintDirect( vec2 uv, vec3 halfTangent, vec3 lightColor ) {
  // One jittered candidate per cell, anchored in UV, never in frame/screen space.
  // Increase polygon candidate count without inflating individual flakes.
  // The original circle comparison remains on its fixed 576-cell grid.
  float grid = xfsGlintShape == 1 ? ( xfsGlintProductionProfile ? 1536.0 : 960.0 ) : 576.0;
  vec2 position = uv * grid;
  ivec2 base = ivec2( floor( position ) );
  vec2 pixelFootprint = vec2( length( dFdx( uv ) ), length( dFdy( uv ) ) );
  float widthUv = 0.5 * length( pixelFootprint );
  float footprintCells = grid * max( pixelFootprint.x, pixelFootprint.y );
  float discreteWeight = 1.0 - smoothstep( 0.8, 2.0, footprintCells );
  float response = 0.0;
  float bodyCoverage = 0.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      uvec2 cell = uvec2( base + ivec2( x, y ) );
      // Each UV cell has a stable candidate. Density changes the occupied
      // fraction without adding fragment loops or reshuffling retained flakes.
      if ( xfsGlintShape == 1 && xfsGlintUnit( cell, 14u ) >= xfsGlintDensity ) continue;
      vec2 jitter = vec2( xfsGlintUnit( cell, 1u ), xfsGlintUnit( cell, 2u ) );
      vec2 centre = ( vec2( base + ivec2( x, y ) ) + 0.1 + 0.8 * jitter ) / grid;
      // More, smaller facets create fine areal coverage. The largest vertex
      // stays within one neighbouring cell, so the 3x3 search is exact at
      // magnification. Keep the original circle pilot untouched.
      float sizeNoise = xfsGlintUnit( cell, 3u );
      bool fine = xfsGlintUnit( cell, 15u ) < xfsGlintFineShare;
      float radius = xfsGlintShape == 1
        ? ( xfsGlintProductionProfile
          ? ( fine ? 0.00005 + 0.00010 * sizeNoise : 0.00018 + 0.00014 * sizeNoise )
          : ( fine ? 0.000075 + 0.00012 * sizeNoise : 0.00025 + 0.00020 * sizeNoise ) )
        : 0.00015 + 0.00035 * sizeNoise;
      float spatial;
      if ( xfsGlintShape == 0 ) {
        // Keep the original circular pilot exactly available as the baseline.
        float distanceUv = length( uv - centre );
        spatial = 1.0 - smoothstep( max( 0.0, radius - widthUv ), radius + widthUv, distanceUv );
      } else {
        vec2 offsetCells = ( uv - centre ) * grid;
        float widthCells = max( widthUv * grid, 1e-5 );
        // The largest possible vertex lies within 1.475 radii. Skip full
        // edge distance work only beyond the entire antialias support.
        spatial = 0.0;
        if ( length( offsetCells ) <= radius * grid * 1.475 + widthCells ) {
          float angle = 6.2831853 * xfsGlintUnit( cell, 7u );
          float signedCells = xfsGlintPolygonDistance( cell, offsetCells, radius * grid, angle );
          spatial = 1.0 - smoothstep( -widthCells, widthCells, signedCells );
        }
      }
      // For the polygon study, imagine a linear height ramp drawn on each
      // primitive before rotation/tiling. Its normal has a constant slope;
      // rotating the primitive rotates that slope as well. The circular pilot
      // keeps its original independent orientation distribution.
      float rampAngle = 6.2831853 * xfsGlintUnit( cell, 7u );
      // Several facet populations matter: a few near-flat pieces, many
      // shallow ones, and some conspicuously tilted ones. The previous
      // 0.15..0.5 slope made almost every polygon read as one flat plane.
      float tiltClass = xfsGlintUnit( cell, 16u );
      float tiltNoise = xfsGlintUnit( cell, 4u );
      float rampStrength = tiltClass < 0.22 ? 0.0
        : tiltClass < 0.75 ? 0.10 + 0.30 * tiltNoise
        : tiltClass < 0.94 ? 0.60 + 0.50 * tiltNoise
        : 1.25 + 0.85 * tiltNoise;
      vec2 slope = xfsGlintShape == 1
        ? rampStrength * vec2( cos( rampAngle ), sin( rampAngle ) )
        : 0.8 * ( vec2( xfsGlintUnit( cell, 4u ), xfsGlintUnit( cell, 5u ) ) - 0.5 );
      vec3 facet = normalize( vec3( slope, 1.0 ) );
      if ( xfsGlintShape == 1 ) {
        float facing = max( dot( facet, halfTangent ), 0.0 );
        bodyCoverage += spatial * ( 0.30 + 0.70 * pow( facing, 4.0 ) );
      }
      // A wider angular response makes more of the densely placed facets
      // sparkle under a fixed key light. The circular baseline keeps its
      // original sharpness and output arithmetic.
      float angularPower = xfsGlintShape == 1 ? max( 20.0, xfsGlintPower * 0.35 ) : xfsGlintPower;
      response += spatial * pow( max( dot( facet, halfTangent ), 0.0 ), angularPower );
    }
  }
  // At minification the exact cell set becomes too large for fixed work. Fade
  // toward a low-energy broad mean instead of inventing frame-random glints.
  float meanResponse = ( xfsGlintShape == 1 ? xfsGlintDensity : 1.0 ) *
    0.055 * pow( max( halfTangent.z, 0.0 ), 32.0 );
  float coverage = xfsGlintShape == 1
    ? mix( 0.34 * xfsGlintDensity, min( bodyCoverage, 1.0 ), discreteWeight )
    : 0.0;
  return vec4( lightColor * xfsGlintColor * xfsGlintStrength *
    mix( meanResponse, response, discreteWeight ), coverage );
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
      vec4 xfsGlintSample = xfsGlintDirect( xfsGlintUv, xfsGlintHalfTangent,
        directionalLights[ xfsLight ].color );
      // A quiet coloured flake body remains visible between specular flashes.
      // This is a provisional colour cue, not the Substance histogram pipeline.
      // Apply it only once even when multiple direct lights are present.
      if ( xfsLight == 0 && xfsGlintShape == 1 ) {
        outgoingLight = mix( outgoingLight,
          outgoingLight * 0.82 + xfsGlintBodyColor * 0.12,
          xfsGlintSample.a * 0.65 );
      }
      outgoingLight += xfsGlintSample.rgb;
    }
  #endif
}
#include <opaque_fragment>
`);
  };
  const cacheKey = function(this: THREE.MeshPhysicalMaterial) {
    return `${priorKey.call(this)}|xfs-uv-cell-glint-study-r186-4`;
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
    setShape(value: "circle" | "polygon") {
      if (disposed) throw Error("Glint study disposed");
      if (value !== "circle" && value !== "polygon") throw Error("Invalid glint shape");
      uniforms.xfsGlintShape.value = value === "polygon" ? 1 : 0;
    },
    setSeed(value: number) {
      if (disposed) throw Error("Glint study disposed");
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw Error("Invalid glint seed");
      uniforms.xfsGlintSeed.value = value;
    },
    setDensity(value: number) {
      if (disposed) throw Error("Glint study disposed");
      if (!Number.isFinite(value) || value < 0 || value > 1) throw Error("Invalid flake density");
      uniforms.xfsGlintDensity.value = value;
    },
    setFineShare(value: number) {
      if (disposed) throw Error("Glint study disposed");
      if (!Number.isFinite(value) || value < 0 || value > 1) throw Error("Invalid fine-speckle share");
      uniforms.xfsGlintFineShare.value = value;
    },
    setProductionProfile(value:boolean){
      if(disposed)throw Error("Glint study disposed");
      uniforms.xfsGlintProductionProfile.value=value;
    },
    setColor(value:string){
      if(disposed)throw Error("Glint study disposed");
      if(!/^#[0-9a-f]{6}$/i.test(value))throw Error("Invalid glint colour");
      uniforms.xfsGlintColor.value.set(value);
    },
    setBodyColor(value:string){
      if(disposed)throw Error("Glint study disposed");
      if(!/^#[0-9a-f]{6}$/i.test(value))throw Error("Invalid glint body colour");
      uniforms.xfsGlintBodyColor.value.set(value);
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
