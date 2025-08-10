export type Vec4 = { x: number; y: number; z: number; w: number }

export type RotationAngles4D = {
  xy: number
  xz: number
  xw: number
  yz: number
  yw: number
  zw: number
}

export function createTesseract(size = 1): { vertices: Vec4[]; edges: Array<[number, number]> } {
  const s = size
  const vertices: Vec4[] = []
  // 16 vertices at +/-s along each axis
  for (let i = 0; i < 16; i++) {
    const x = (i & 1) ? s : -s
    const y = (i & 2) ? s : -s
    const z = (i & 4) ? s : -s
    const w = (i & 8) ? s : -s
    vertices.push({ x, y, z, w })
  }

  const edges: Array<[number, number]> = []
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < 4; k++) {
      const j = i ^ (1 << k)
      if (i < j) edges.push([i, j])
    }
  }

  return { vertices, edges }
}

export function createSimplex4D(size = 1): { vertices: Vec4[]; edges: Array<[number, number]> } {
  // 5 vertices equidistant in 4D (regular 5-cell). We'll use a simple construction then normalize.
  const s = size
  const raw: Vec4[] = [
    { x: 1, y: 1, z: 1, w: -1 },
    { x: 1, y: -1, z: -1, w: -1 },
    { x: -1, y: 1, z: -1, w: -1 },
    { x: -1, y: -1, z: 1, w: -1 },
    { x: 0, y: 0, z: 0, w: 4 },
  ]
  // Normalize and scale to roughly match size
  const vertices = raw.map(v => {
    const len = Math.hypot(v.x, v.y, v.z, v.w) || 1
    return { x: (v.x / len) * s, y: (v.y / len) * s, z: (v.z / len) * s, w: (v.w / len) * s }
  })
  // Complete graph edges between 5 vertices
  const edges: Array<[number, number]> = []
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) edges.push([i, j])
  }
  return { vertices, edges }
}

export function apply4dRotation(v: Vec4, a: RotationAngles4D): Vec4 {
  let { x, y, z, w } = v
  // XY rotation
  if (a.xy !== 0) {
    const c = Math.cos(a.xy), s = Math.sin(a.xy)
    const nx = c * x - s * y
    const ny = s * x + c * y
    x = nx; y = ny
  }
  // XZ rotation
  if (a.xz !== 0) {
    const c = Math.cos(a.xz), s = Math.sin(a.xz)
    const nx = c * x - s * z
    const nz = s * x + c * z
    x = nx; z = nz
  }
  // XW rotation
  if (a.xw !== 0) {
    const c = Math.cos(a.xw), s = Math.sin(a.xw)
    const nx = c * x - s * w
    const nw = s * x + c * w
    x = nx; w = nw
  }
  // YZ rotation
  if (a.yz !== 0) {
    const c = Math.cos(a.yz), s = Math.sin(a.yz)
    const ny = c * y - s * z
    const nz = s * y + c * z
    y = ny; z = nz
  }
  // YW rotation
  if (a.yw !== 0) {
    const c = Math.cos(a.yw), s = Math.sin(a.yw)
    const ny = c * y - s * w
    const nw = s * y + c * w
    y = ny; w = nw
  }
  // ZW rotation
  if (a.zw !== 0) {
    const c = Math.cos(a.zw), s = Math.sin(a.zw)
    const nz = c * z - s * w
    const nw = s * z + c * w
    z = nz; w = nw
  }
  return { x, y, z, w }
}

export function rotateVertices4D(vertices: Vec4[], angles: RotationAngles4D): Vec4[] {
  const out = new Array<Vec4>(vertices.length)
  for (let i = 0; i < vertices.length; i++) out[i] = apply4dRotation(vertices[i], angles)
  return out
}

export function project4Dto3D(v: Vec4, perspectiveDistance = 3): { x: number; y: number; z: number; t: number } {
  const denom = (perspectiveDistance - v.w)
  const k = denom !== 0 ? perspectiveDistance / denom : 1
  const x = v.x * k
  const y = v.y * k
  const z = v.z * k
  // Map w to [0,1] smoothly using tanh
  const t = 0.5 + 0.5 * Math.tanh(v.w / perspectiveDistance)
  return { x, y, z, t }
}


