<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({ file: File })
const emit = defineEmits(['confirm', 'cancel'])

const PREVIEW = 220   // px — display size
const OUTPUT  = 256   // px — exported canvas size

const imgSrc  = ref(null)
const zoom    = ref(1)
const ox      = ref(0)  // image offset within preview
const oy      = ref(0)

let natW = 0, natH = 0
let minZoom = 1

// Load file → data URL
const reader = new FileReader()
reader.onload = e => { imgSrc.value = e.target.result }
reader.readAsDataURL(props.file)

function onImgLoad(e) {
  natW = e.target.naturalWidth
  natH = e.target.naturalHeight
  // Minimum zoom: image must cover the full preview square
  minZoom = Math.max(PREVIEW / natW, PREVIEW / natH)
  zoom.value = minZoom
  ox.value = (PREVIEW - natW * zoom.value) / 2
  oy.value = (PREVIEW - natH * zoom.value) / 2
  clamp()
}

const imgW = computed(() => natW * zoom.value)
const imgH = computed(() => natH * zoom.value)

function clamp() {
  ox.value = Math.min(0, Math.max(ox.value, PREVIEW - imgW.value))
  oy.value = Math.min(0, Math.max(oy.value, PREVIEW - imgH.value))
}

// ── drag ─────────────────────────────────────────────────────────────────
let dragging = false
let startX = 0, startY = 0, startOx = 0, startOy = 0

function onPointerDown(e) {
  dragging = true
  startX = e.clientX; startY = e.clientY
  startOx = ox.value; startOy = oy.value
  e.currentTarget.setPointerCapture(e.pointerId)
}

function onPointerMove(e) {
  if (!dragging) return
  ox.value = startOx + (e.clientX - startX)
  oy.value = startOy + (e.clientY - startY)
  clamp()
}

function onPointerUp() { dragging = false }

// ── zoom slider ───────────────────────────────────────────────────────────
function onZoom(e) {
  const newZoom = parseFloat(e.target.value)
  // Keep center of preview pinned
  const cx = PREVIEW / 2, cy = PREVIEW / 2
  const ratio = newZoom / zoom.value
  ox.value = cx - (cx - ox.value) * ratio
  oy.value = cy - (cy - oy.value) * ratio
  zoom.value = newZoom
  clamp()
}

// ── export ────────────────────────────────────────────────────────────────
function confirm() {
  const canvas = document.createElement('canvas')
  canvas.width  = OUTPUT
  canvas.height = OUTPUT
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.src = imgSrc.value
  // Visible region in natural-image coordinates
  const srcX = -ox.value / zoom.value
  const srcY = -oy.value / zoom.value
  const srcW =  PREVIEW  / zoom.value
  const srcH =  PREVIEW  / zoom.value
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT, OUTPUT)
  emit('confirm', canvas.toDataURL('image/webp', 0.88))
}
</script>

<template>
  <div class="cropper-backdrop" @click.self="emit('cancel')">
    <div class="cropper-box">
      <div class="cropper-title">Crop icon</div>

      <div
        class="cropper-preview"
        :style="{ width: PREVIEW + 'px', height: PREVIEW + 'px' }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <img
          v-if="imgSrc"
          :src="imgSrc"
          :style="{
            position: 'absolute',
            left: ox + 'px',
            top:  oy + 'px',
            width:  imgW + 'px',
            height: imgH + 'px',
            userSelect: 'none',
            pointerEvents: 'none',
          }"
          draggable="false"
          @load="onImgLoad"
        />
        <div class="cropper-grid" />
      </div>

      <div class="cropper-zoom-row">
        <span class="zoom-label">Zoom</span>
        <input
          type="range"
          :min="minZoom"
          :max="minZoom * 4"
          :step="0.001"
          :value="zoom"
          class="zoom-slider"
          @input="onZoom"
        />
        <span class="zoom-value">{{ (zoom / minZoom).toFixed(1) }}×</span>
      </div>

      <div class="cropper-hint">Drag to reposition · 256×256 output</div>

      <div class="cropper-actions">
        <button class="action-btn action-btn--ghost" @click="emit('cancel')">Cancel</button>
        <button class="action-btn action-btn--accent" @click="confirm">Confirm</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cropper-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.cropper-box {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 280px;
}

.cropper-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--muted);
}

.cropper-preview {
  position: relative;
  overflow: hidden;
  cursor: grab;
  background: #111;
  flex-shrink: 0;
  outline: 2px solid var(--accent);
}

.cropper-preview:active { cursor: grabbing; }

/* Subtle rule-of-thirds grid overlay */
.cropper-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px);
  background-size: 33.33% 33.33%;
  pointer-events: none;
}

.cropper-zoom-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.zoom-label {
  font-size: 0.72rem;
  color: var(--muted);
  flex-shrink: 0;
}

.zoom-slider {
  flex: 1;
  accent-color: var(--accent);
}

.zoom-value {
  font-size: 0.72rem;
  color: var(--text);
  width: 28px;
  text-align: right;
  flex-shrink: 0;
}

.cropper-hint {
  font-size: 0.68rem;
  color: var(--muted);
  opacity: 0.6;
}

.cropper-actions {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: flex-end;
}
</style>
