<script setup>
import { ref } from 'vue'
import { useGristAnimation } from '../composables/useGristAnimation'
import GristParticles from './GristParticles.vue'
import GristIcon from './GristIcon.vue'

const props = defineProps({
  payouts: Array, // [{ amount, reason, title }]
})
const emit = defineEmits(['close'])

const { particles, animateGrist } = useGristAnimation()
const okBtnRef = ref(null)

const totalWon = props.payouts
  .filter(p => p.reason === 'bet_payout')
  .reduce((s, p) => s + parseFloat(p.amount), 0)

const hasWinnings = totalWon > 0

function handleClose() {
  if (hasWinnings && okBtnRef.value) {
    const balanceEl = document.getElementById('balance-display')
    if (balanceEl) {
      animateGrist(okBtnRef.value, balanceEl, Math.min(Math.ceil(totalWon / 10), 10))
    }
    setTimeout(() => emit('close'), 800)
  } else {
    emit('close')
  }
}
</script>

<template>
  <GristParticles :particles="particles" />
  <div class="modal-overlay" @click.self="handleClose">
    <div class="payout-modal pixel-corners">
      <h2 class="payout-title" :class="{ win: hasWinnings }">
        {{ hasWinnings ? 'You Won!' : 'Market Results' }}
      </h2>
      <div class="payout-list">
        <div v-for="(p, i) in payouts" :key="i" class="payout-item">
          <span class="payout-market">{{ p.title || 'Market' }}</span>
          <span class="payout-amount" :class="{ win: p.reason === 'bet_payout', refund: p.reason === 'bet_refund' }">
            {{ p.reason === 'bet_payout' ? '+' : '' }}{{ parseFloat(p.amount).toFixed(0) }} <GristIcon />
            <span class="payout-type">{{ p.reason === 'bet_payout' ? 'won' : 'refund' }}</span>
          </span>
        </div>
      </div>
      <button ref="okBtnRef" class="btn" @click="handleClose">
        {{ hasWinnings ? 'Collect!' : 'Okay' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.payout-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 360px;
  padding: 24px;
  text-align: center;
}

.payout-title {
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 16px;
}
.payout-title.win {
  color: #48bb78;
}

.payout-list {
  margin-bottom: 16px;
}

.payout-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.payout-item:last-child {
  border-bottom: none;
}

.payout-market {
  font-size: 0.8rem;
  color: var(--text);
  flex: 1;
  text-align: left;
}

.payout-amount {
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
  margin-left: 8px;
}
.payout-amount.win { color: #48bb78; }
.payout-amount.refund { color: var(--accent); }

.payout-type {
  font-size: 0.6rem;
  font-weight: normal;
  color: var(--muted);
  margin-left: 4px;
}
</style>
