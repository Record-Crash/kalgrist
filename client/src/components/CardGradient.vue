<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  options: Array,
  colors: Array,
  percentages: Object,
})

const canvas = ref(null)
let rafId = null
let debounceTimer = null
let ro = null

// current/target indexed by option index (not position)
// each entry: { x, y, r, alpha, rgb:[r,g,b] }
let current = null
let target  = null
let isAnimating = false

// ── helpers ───────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function lerp(a, b, t) { return a + (b - a) * t }

// Evenly-spaced polygon positions for n points.
// Angle offset of -PI/4 so 2-option case lands top-right / bottom-left.
function polygonPositions(n) {
  const OFFSET = -Math.PI / 4
  const RX = 0.30
  const RY = 0.30
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI / n) * i + OFFSET
    return [0.5 + RX * Math.cos(angle), 0.5 + RY * Math.sin(angle)]
  })
}

// Build blob state. Options are sorted by dominance so the most dominant
// option is assigned position[0], second-most gets position[1], etc.
function buildBlobs(options, colors, percentages) {
  const n = options.length
  const total = options.reduce((s, o) => s + (percentages[o.id] || 0), 0)
  const fracs = options.map(o => total > 0 ? (percentages[o.id] || 0) / total : 1 / n)

  // Map each option to a polygon position slot by dominance rank
  const rankByOptIdx = new Array(n)
  fracs
    .map((frac, i) => ({ i, frac }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }, rank) => { rankByOptIdx[i] = rank })

  const positions = polygonPositions(n)

  return options.map((opt, i) => {
    const frac = fracs[i]
    const [x, y] = positions[rankByOptIdx[i]]
    return {
      x, y,
      // Smaller radius so they don't all overlap the center at once
      r: 0.35 + frac * 0.45, 
      // Higher alpha for more "vibrant" color pools
      alpha: 0.2 + frac * 0.5, 
      rgb: hexToRgb(colors[i % colors.length]),
    }
  })
}

// ── drawing ───────────────────────────────────────────────────────────────
function draw() {
  const cvs = canvas.value
  if (!cvs || !current?.length) return
  const ctx = cvs.getContext('2d')

  ctx.globalCompositeOperation = 'screen';

  const { width: w, height: h } = cvs
  ctx.clearRect(0, 0, w, h)

  ctx.fillStyle = '#0d0d0d' 
  ctx.fillRect(0, 0, w, h)

  for (const blob of current) {
    const cx = blob.x * w
    const cy = blob.y * h
    // Increase the multiplier to make the "glow" spread further but softer
    const radius = blob.r * Math.max(w, h) * 1.2 
    const [r, g, b] = blob.rgb.map(Math.round)
    
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    // 0% is the core color
    grad.addColorStop(0, `rgba(${r},${g},${b},${blob.alpha.toFixed(3)})`)
    // 40% starts a much slower fade
    grad.addColorStop(0.4, `rgba(${r},${g},${b},${(blob.alpha * 0.4).toFixed(3)})`)
    // 100% is completely transparent
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
}

// ── animation loop ────────────────────────────────────────────────────────
function tick() {
  if (!current || !target) { isAnimating = false; return }

  const SPEED = 0.028
  let settled = true

  for (let i = 0; i < current.length; i++) {
    const c = current[i]
    const t = target[i]
    c.x     = lerp(c.x,     t.x,     SPEED)
    c.y     = lerp(c.y,     t.y,     SPEED)
    c.r     = lerp(c.r,     t.r,     SPEED)
    c.alpha = lerp(c.alpha, t.alpha, SPEED)
    c.rgb   = c.rgb.map((v, j) => lerp(v, t.rgb[j], SPEED))
    if (Math.abs(c.x - t.x) > 0.0005 || Math.abs(c.r - t.r) > 0.0005) settled = false
  }

  draw()

  if (settled) {
    current = target.map(b => ({ ...b, rgb: [...b.rgb] }))
    draw()
    isAnimating = false
    return
  }

  rafId = requestAnimationFrame(tick)
}

function startAnimation() {
  if (isAnimating) return
  isAnimating = true
  rafId = requestAnimationFrame(tick)
}

// ── debounced update (2 s quiet before applying new percentages) ──────────
function scheduleUpdate() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (!props.options?.length) return
    const newTarget = buildBlobs(props.options, props.colors, props.percentages)

    if (!current || current.length !== newTarget.length) {
      current = newTarget.map(b => ({ ...b, rgb: [...b.rgb] }))
      target  = newTarget
      draw()
      return
    }

    target = newTarget
    startAnimation()
  }, 2000)
}

watch(() => props.percentages, scheduleUpdate, { deep: true })

// ── lifecycle ─────────────────────────────────────────────────────────────
onMounted(() => {
  const cvs = canvas.value
  if (!cvs) return

  function resize() {
    cvs.width  = cvs.offsetWidth
    cvs.height = cvs.offsetHeight
    draw()
  }

  ro = new ResizeObserver(resize)
  ro.observe(cvs)
  resize()

  if (props.options?.length) {
    const blobs = buildBlobs(props.options, props.colors, props.percentages)
    current = blobs.map(b => ({ ...b, rgb: [...b.rgb] }))
    target  = blobs.map(b => ({ ...b, rgb: [...b.rgb] }))
    draw()
  }
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  clearTimeout(debounceTimer)
  ro?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="card-gradient-canvas" />
</template>

<style scoped>
.card-gradient-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
