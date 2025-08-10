import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js'
import { createDrandClient, getLatestVerifiedBeacon, getBeaconForRound, stopDrandClient } from './drand'
import { createTesseract, createSimplex4D, createCrossPolytope4D, create24Cell, rotateVertices4D, project4Dto3D, type RotationAngles4D } from './geometry4d'

type UiRefs = {
  status: HTMLElement
  round: HTMLElement
  verified: HTMLElement
  randhex: HTMLElement
  shape: HTMLElement
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el
}

function seedAnglesFromHex(hex: string): RotationAngles4D {
  // Use the hex randomness to derive stable angles
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  const toAngle = (i: number) => ((bytes[i % bytes.length] / 255) * Math.PI * 2) - Math.PI
  return { xy: toAngle(0), xz: toAngle(1), xw: toAngle(2), yz: toAngle(3), yw: toAngle(4), zw: toAngle(5) }
}

function hueFromHex(hex: string): number {
  // Map first two bytes to hue [0,360)
  const h = parseInt(hex.slice(0, 4), 16)
  return (h % 360)
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return function () {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function chooseShape(hex: string): 'tesseract' | 'simplex' {
  const b = parseInt(hex.slice(0, 2), 16)
  return (b % 2 === 0) ? 'tesseract' : 'simplex'
}

type ShapeMode = 'auto' | 'tesseract' | 'simplex' | 'cross' | '24cell'

export async function bootstrapApp(): Promise<void> {
  const ui: UiRefs = {
    status: $('status'),
    round: $('round'),
    verified: $('verified'),
    randhex: $('randhex'),
    shape: $('shape'),
  }

  // Controls
  const shapeSelect = document.getElementById('shapeSelect') as HTMLSelectElement
  const lineOpacity = document.getElementById('lineOpacity') as HTMLInputElement
  const bloomStrength = document.getElementById('bloomStrength') as HTMLInputElement
  const speedCtrl = document.getElementById('speed') as HTMLInputElement
  const trailCtrl = document.getElementById('trail') as HTMLInputElement
  let shapeMode: ShapeMode = (shapeSelect?.value as ShapeMode) ?? 'auto'

  const canvas = document.getElementById('scene') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor('#0b0e14', 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100)
  camera.position.set(0, 0, 6)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  const ambient = new THREE.AmbientLight('#88a', 0.6)
  scene.add(ambient)
  const dir = new THREE.DirectionalLight('#fff', 0.8)
  dir.position.set(2, 3, 4)
  scene.add(dir)

  // Postprocessing composer with bloom
  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.6, 0.9)
  const afterimage = new AfterimagePass(0.94)
  afterimage.enabled = false
  composer.addPass(afterimage)
  composer.addPass(bloom)

  // Geometry buffers
  // Placeholder; will be replaced after randomness decides the shape
  let vertices = createTesseract(1).vertices
  let edges = createTesseract(1).edges
  const lineGeometry = new THREE.BufferGeometry()
  // Each edge contributes 2 vertices
  let positions = new Float32Array(edges.length * 2 * 3)
  let colors = new Float32Array(edges.length * 2 * 3)
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending })
  const lines = new THREE.LineSegments(lineGeometry, material)
  scene.add(lines)

  // Background starfield seeded by randomness
  const starGeo = new THREE.BufferGeometry()
  const MAX_STARS = 1500
  const starPositions = new Float32Array(MAX_STARS * 3)
  const starColors = new Float32Array(MAX_STARS * 3)
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3))
  const starMat = new THREE.PointsMaterial({ size: 0.012, transparent: true, opacity: 0.9, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const stars = new THREE.Points(starGeo, starMat)
  scene.add(stars)

  // Randomness and animation state
  const client = createDrandClient()
  let angles: RotationAngles4D = { xy: 0, xz: 0, xw: 0, yz: 0, yw: 0, zw: 0 }
  let baseHue = 210
  let speedMul = parseFloat((document.getElementById('speed') as HTMLInputElement)?.value ?? '1.5')
  let trail = (document.getElementById('trail') as HTMLInputElement)?.checked ?? true

  async function refreshBeacon(): Promise<void> {
    try {
      ui.status.textContent = 'Fetching randomness…'
      const url = new URL(window.location.href)
      const roundParam = url.searchParams.get('round')
      const beacon = roundParam ? await getBeaconForRound(client, Number(roundParam)) : await getLatestVerifiedBeacon(client)
      // Use beacon fields directly for UI & seeding
      ui.round.textContent = `round: ${beacon.round}`
      ui.verified.textContent = `verified: ${beacon.verified ? 'true' : 'false'}`
      ui.verified.classList.toggle('ok', beacon.verified)
      ui.verified.classList.toggle('fail', !beacon.verified)
      ui.randhex.textContent = `randomness: ${beacon.randomness}`
      angles = seedAnglesFromHex(beacon.randomness)
      baseHue = hueFromHex(beacon.randomness)

      // Choose shape
      const autoShape = chooseShape(beacon.randomness)
      const selected = shapeMode === 'auto' ? autoShape : (shapeMode === 'cross' ? 'cross' : (shapeMode === '24cell' ? '24cell' : shapeMode))
      ui.shape.textContent = `shape: ${selected}`
      const size = 1
      if (selected === 'tesseract') {
        const res = createTesseract(size)
        vertices = res.vertices; edges = res.edges
      } else if (selected === 'simplex') {
        const res = createSimplex4D(size * 1.2)
        vertices = res.vertices; edges = res.edges
      } else if (selected === 'cross') {
        const res = createCrossPolytope4D(size * 1.2)
        vertices = res.vertices; edges = res.edges
      } else {
        const res = create24Cell(size * 0.9)
        vertices = res.vertices; edges = res.edges
      }

      // Rebuild line buffers based on new edges
      const needed = edges.length * 2 * 3
      if (positions.length !== needed) {
        positions = new Float32Array(needed)
        colors = new Float32Array(needed)
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      }

      // Seed background stars deterministically
      const seed = parseInt(beacon.randomness.slice(0, 8), 16) >>> 0
      const rand = mulberry32(seed)
      for (let i = 0, p = 0, c = 0; i < MAX_STARS; i++) {
        // sphere shell
        const r = 6 * Math.pow(rand(), 0.6)
        const theta = rand() * Math.PI * 2
        const phi = Math.acos(2 * rand() - 1)
        const sx = r * Math.sin(phi) * Math.cos(theta)
        const sy = r * Math.sin(phi) * Math.sin(theta)
        const sz = r * Math.cos(phi)
        starPositions[p++] = sx; starPositions[p++] = sy; starPositions[p++] = sz
        const sc = new THREE.Color().setHSL(((baseHue / 360) + rand() * 0.2) % 1, 0.6, 0.5)
        starColors[c++] = sc.r; starColors[c++] = sc.g; starColors[c++] = sc.b
      }
      starGeo.deleteAttribute('position')
      starGeo.deleteAttribute('color')
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3))

      // Tune bloom by seed
      bloom.strength = parseFloat(bloomStrength.value) || 0.9
      bloom.radius = 0.4 + ((seed >> 10) % 200) / 1000
      bloom.threshold = 0.7
      ui.status.textContent = 'Randomness ready'
    } catch (err) {
      console.error(err)
      ui.status.textContent = 'Randomness error'
      ui.verified.textContent = 'verified: false'
      ui.verified.classList.remove('ok')
      ui.verified.classList.add('fail')
    }
  }

  await refreshBeacon()
  let refreshInterval = 30_000
  let refreshTimer: number | null = null
  const setAutoRefresh = () => {
    if (refreshTimer) window.clearInterval(refreshTimer)
    const auto = (document.getElementById('autoRefresh') as HTMLInputElement).checked
    const iv = parseInt((document.getElementById('interval') as HTMLInputElement).value, 10) * 1000
    refreshInterval = iv
    if (auto) refreshTimer = window.setInterval(refreshBeacon, refreshInterval) as unknown as number
    else refreshTimer = null
  }
  setAutoRefresh()

  // Animation
  const clock = new THREE.Clock()
  function animate() {
    const dt = clock.getDelta() * speedMul
    controls.update()

    // Rotate a little over time to animate, plus base from the beacon
    const timeAngles: RotationAngles4D = {
      xy: angles.xy + dt * 0.35,
      xz: angles.xz + dt * 0.27,
      xw: angles.xw + dt * 0.31,
      yz: angles.yz + dt * 0.29,
      yw: angles.yw + dt * 0.33,
      zw: angles.zw + dt * 0.37,
    }

    const rotated = rotateVertices4D(vertices, timeAngles)
    // Project and color by w (stored in t)
    const projected = rotated.map(v => project4Dto3D(v, 3))

    // Update line segments positions and colors
    let ptr = 0
    let cptr = 0
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i]
      const va = projected[a]
      const vb = projected[b]
      positions[ptr++] = va.x
      positions[ptr++] = va.y
      positions[ptr++] = va.z
      positions[ptr++] = vb.x
      positions[ptr++] = vb.y
      positions[ptr++] = vb.z

      const colA = new THREE.Color().setHSL(((baseHue / 360) + va.t * 0.15) % 1, 0.7, 0.6)
      const colB = new THREE.Color().setHSL(((baseHue / 360) + vb.t * 0.15) % 1, 0.7, 0.6)
      colors[cptr++] = colA.r; colors[cptr++] = colA.g; colors[cptr++] = colA.b
      colors[cptr++] = colB.r; colors[cptr++] = colB.g; colors[cptr++] = colB.b
    }
    lineGeometry.attributes.position.needsUpdate = true
    lineGeometry.attributes.color.needsUpdate = true

    // AfterimagePass handles trails internally
    renderer.clear()
    composer.render()
    requestAnimationFrame(animate)
  }
  animate()

  function onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    composer.setSize(w, h)
  }
  window.addEventListener('resize', onResize)

  // Keyboard shortcuts: press 's' to save a screenshot
  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() === 's') {
      const link = document.createElement('a')
      link.download = `tesseract-${Date.now()}.png`
      link.href = renderer.domElement.toDataURL('image/png')
      link.click()
    }
  })

  // Control bindings
  shapeSelect.addEventListener('change', () => {
    shapeMode = shapeSelect.value as ShapeMode
    refreshBeacon()
  })
  lineOpacity.addEventListener('input', () => {
    material.opacity = parseFloat(lineOpacity.value)
    material.needsUpdate = true
  })
  bloomStrength.addEventListener('input', () => {
    const v = parseFloat(bloomStrength.value)
    if (!Number.isNaN(v)) (bloom as any).strength = v
  })
  speedCtrl.addEventListener('input', () => {
    const v = parseFloat(speedCtrl.value); if (!Number.isNaN(v)) speedMul = v
  })
  trailCtrl.addEventListener('change', () => { trail = trailCtrl.checked; afterimage.enabled = trail })
  const trailIntensity = document.getElementById('trailIntensity') as HTMLInputElement
  trailIntensity.addEventListener('input', () => {
    const v = parseFloat(trailIntensity.value)
    if (!Number.isNaN(v)) (afterimage as any).uniforms['damp'].value = v
  })
  const autoRefresh = document.getElementById('autoRefresh') as HTMLInputElement
  const interval = document.getElementById('interval') as HTMLInputElement
  autoRefresh.addEventListener('change', () => { setAutoRefresh(); if (autoRefresh.checked) refreshBeacon() })
  interval.addEventListener('input', () => { setAutoRefresh() })
  const refreshNow = document.getElementById('refreshNow') as HTMLButtonElement
  refreshNow.addEventListener('click', refreshBeacon)

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopDrandClient(client)
    window.clearInterval(refreshInterval)
  })
}


