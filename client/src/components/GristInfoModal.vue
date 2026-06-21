<script setup>
const emit = defineEmits(['close'])
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="grist-modal pixel-corners">
      <button class="modal-close" @click="emit('close')">×</button>
      <h2 class="grist-title">What is Grist?</h2>
      <div class="grist-body">
        <p>Grist is the virtual currency used in prediction markets. You earn it by participating in the server, and spend it by placing bets.</p>

        <h3>How to earn Grist</h3>
        <ul>
          <li><strong>Send messages</strong> — You earn grist for each message you send in the server.</li>
          <li><strong>Win bets</strong> — When a market resolves in your favor, you receive a proportional share of the entire pool.</li>
        </ul>

        <h3>How to spend Grist</h3>
        <ul>
          <li><strong>Place bets</strong> — Click on any market to bet grist on an outcome. If you win, you earn your share of the total pool!</li>
        </ul>

        <h3>Payouts</h3>
        <p>When a market resolves, the entire pool is split among winners proportionally to how much they bet. The earlier you bet and the less popular your choice, the higher your potential payout.</p>
      </div>
      <button class="btn" @click="emit('close')">Got it!</button>
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

.grist-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 440px;
  padding: 24px;
  position: relative;
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 14px;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 1.2rem;
  cursor: pointer;
  font-family: inherit;
}
.modal-close:hover { color: var(--text); }

.grist-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--accent);
}

.grist-body {
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text);
  margin-bottom: 16px;
}

.grist-body h3 {
  font-size: 0.8rem;
  font-weight: 700;
  margin: 12px 0 4px;
  color: var(--accent);
}

.grist-body ul {
  padding-left: 16px;
  margin: 4px 0;
}

.grist-body li {
  margin-bottom: 4px;
}

.grist-body p {
  margin-bottom: 8px;
}
</style>
