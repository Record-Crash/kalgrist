import anime from 'animejs'
import gristImgUrl from '../assets/grist.png'

export function useGristAnimation() {
  function animateGrist(fromEl, toEl, count = 50) {
    if (!fromEl || !toEl) return

    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()
    const originX = fromRect.left + fromRect.width / 2
    const originY = fromRect.top + fromRect.height / 2
    const destX = toRect.left + toRect.width / 2
    const destY = toRect.top + toRect.height / 2

    const fragments = []

    for (let i = 0; i < count; i++) {
      const img = document.createElement('img')
      img.src = gristImgUrl
      const size = Math.random() * 8 + 6 // 6–14px varying sizes
      img.style.cssText = `
        position: fixed;
        width: ${size}px;
        height: ${size}px;
        left: ${originX - size / 2}px;
        top: ${originY - size / 2}px;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
      `
      img.dataset.syncDelay = String(Math.random() * 150)
      img.dataset.inDuration = String(Math.random() * 500 + 700)
      document.body.appendChild(img)
      fragments.push(img)
    }

    const burstDuration = 450

    const tl = anime.timeline({
      complete() {
        fragments.forEach(f => f.remove())
      },
    })

    // Phase A: Explosive burst — left/top/scale/rotate/opacity all in one call
    // (must be one call: animejs v3 separate instances overwrite each other's transform)
    tl.add({
      targets: fragments,
      left: () => `${originX - 12 + (Math.random() - 0.5) * 150}px`,
      top: () => `${originY - 12 + (Math.random() - 0.5) * 150}px`,
      scale: () => Math.random() * 1.2 + 0.8,
      rotate: () => Math.random() * 720 - 360,
      opacity: 1,
      duration: burstDuration,
      delay: el => Number(el.dataset.syncDelay),
      easing: 'easeOutCubic',
    }, 0)

    // Phase B: Slingshot position to destination — left/top only, no transforms
    // Runs concurrently with Phase C; split so each can have its own easing
    tl.add({
      targets: fragments,
      left: () => `${destX - 12 + (Math.random() * 10 - 5)}px`,
      top: () => `${destY - 12 + (Math.random() * 10 - 5)}px`,
      duration: el => Number(el.dataset.inDuration),
      delay: el => Number(el.dataset.syncDelay),
      easing: 'easeInBack',
    }, burstDuration)

    // Phase C: Fade + shrink + continued chaotic rotation — transforms/opacity only, no left/top
    // No conflict with Phase B since they touch completely different CSS properties
    tl.add({
      targets: fragments,
      rotate: () => `+=${Math.random() * 2880 - 1440}`,
      scale: 0,
      opacity: 0,
      duration: el => Number(el.dataset.inDuration),
      delay: el => Number(el.dataset.syncDelay),
      easing: 'easeInExpo',
    }, burstDuration)
  }

  const particles = { value: [] }
  return { particles, animateGrist }
}
