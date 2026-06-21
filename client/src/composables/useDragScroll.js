import { onMounted, onUnmounted } from 'vue'

export function useDragScroll(elRef) {
  let isDown = false
  let startX = 0
  let scrollLeft = 0
  let didDrag = false

  function onMouseDown(e) {
    isDown = true
    didDrag = false
    startX = e.pageX - elRef.value.offsetLeft
    scrollLeft = elRef.value.scrollLeft
    elRef.value.style.cursor = 'grabbing'
    elRef.value.style.userSelect = 'none'
  }

  function onMouseUp() {
    if (!isDown) return
    isDown = false
    elRef.value.style.cursor = ''
    elRef.value.style.userSelect = ''
  }

  function onMouseMove(e) {
    if (!isDown) return
    const x = e.pageX - elRef.value.offsetLeft
    const walk = x - startX
    if (Math.abs(walk) > 3) didDrag = true
    elRef.value.scrollLeft = scrollLeft - walk
  }

  function onClickCapture(e) {
    if (didDrag) {
      e.stopPropagation()
      didDrag = false
    }
  }

  onMounted(() => {
    const el = elRef.value
    if (!el) return
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('mouseleave', onMouseUp)
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('click', onClickCapture, true)
  })

  onUnmounted(() => {
    const el = elRef.value
    if (!el) return
    el.removeEventListener('mousedown', onMouseDown)
    el.removeEventListener('mouseleave', onMouseUp)
    el.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mousemove', onMouseMove)
    el.removeEventListener('click', onClickCapture, true)
  })
}
